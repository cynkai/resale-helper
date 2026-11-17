"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getDb, getSqlite, resolveDbPath } from "@/lib/db/client";
import { createSnapshot, deleteSnapshot } from "@/lib/db/snapshots";
import { seedDemo } from "@/lib/db/demo-seed";
import * as repo from "@/lib/db/repo";
import { isQuoteExpired } from "@/lib/domain/compare";
import { MAX_CSV_BYTES, planCsvImport, type CsvRowError } from "@/lib/domain/csv";
import { ITEM_FIELDS, validateItemInput, type ItemInputRaw } from "@/lib/domain/item-input";
import { parseAmount, parsePercentToBp } from "@/lib/domain/money";
import { computeNet } from "@/lib/domain/net";
import { isValidYmd, PRICE_FIELDS, validatePriceInput, type PriceInputRaw } from "@/lib/domain/price-input";
import { validateCostPreset } from "@/lib/domain/cost-preset";
import { planItemsCsvImport } from "@/lib/domain/items-csv";
import { validateTemplateInput } from "@/lib/domain/listing-template";
import { validatePostedPriceInput } from "@/lib/domain/posted-price";
import { OFFER_STATUSES, validateOfferInput, type OfferStatus } from "@/lib/domain/offer";
import { COST_KEYS, resolveActualCostTotal } from "@/lib/domain/review";
import { basisIssues, CHANNEL_MAX } from "@/lib/domain/scenario";
import { validateTimeValue } from "@/lib/domain/settings-input";
import { SALE_METHODS, type PriceType, type SaleMethod } from "@/lib/domain/types";
import { generateImportToken, isValidExtensionId } from "@/lib/import/access";
import { isDemoMode, MODE_COOKIE } from "@/lib/mode";
import { todayYmd } from "@/lib/today";

export type FormState = {
  errors?: Record<string, string>;
  message?: string;
  ok?: boolean;
  values?: Record<string, string>;
};

function s(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
}

function values(fd: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (typeof v === "string" && !k.startsWith("$")) out[k] = v;
  return out;
}

function intId(raw: string): number | null {
  return /^\d{1,12}$/.test(raw) ? Number(raw) : null;
}

async function requireItem(rawId: string) {
  const id = intId(rawId);
  const isDemo = await isDemoMode();
  const item = id === null ? undefined : repo.getItem(getDb(), isDemo, id);
  if (!item) throw new Error("물건을 찾을 수 없습니다.");
  return { item, isDemo, db: getDb() };
}

// ---- 물건 ----

export async function saveItemAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const raw: ItemInputRaw = {};
  for (const f of ITEM_FIELDS) raw[f] = s(fd, f);
  const result = validateItemInput(raw, todayYmd());
  if (!result.ok) return { errors: result.errors, values: values(fd), message: "입력 내용을 확인해 주세요." };

  const db = getDb();
  const isDemo = await isDemoMode();
  const existingId = intId(s(fd, "id"));
  let id: number;
  if (existingId !== null) {
    if (!repo.getItem(db, isDemo, existingId)) return { message: "물건을 찾을 수 없습니다.", values: values(fd) };
    repo.updateItem(db, isDemo, existingId, result.value);
    id = existingId;
  } else {
    id = repo.createItem(db, isDemo, result.value);
  }
  revalidatePath("/");
  redirect(`/items/${id}`);
}

export async function deleteItemAction(fd: FormData): Promise<void> {
  const { item, isDemo, db } = await requireItem(s(fd, "itemId"));
  // 바로 지우지 않고 휴지통으로 옮긴다(딸린 자료는 그대로 두므로 되살릴 수 있다).
  repo.trashItem(db, isDemo, item.id);
  revalidatePath("/");
  redirect("/?trashed=1");
}

// ---- 휴지통 ----

export async function restoreItemAction(fd: FormData): Promise<void> {
  const id = intId(s(fd, "itemId"));
  if (id === null) return;
  repo.restoreItem(getDb(), await isDemoMode(), id);
  revalidatePath("/");
  revalidatePath("/trash");
}

export async function purgeItemAction(fd: FormData): Promise<void> {
  const id = intId(s(fd, "itemId"));
  if (id === null) return;
  repo.purgeItem(getDb(), await isDemoMode(), id);
  revalidatePath("/trash");
}

export async function emptyTrashAction(): Promise<void> {
  repo.emptyTrash(getDb(), await isDemoMode());
  revalidatePath("/trash");
}

/** 보유 중 ↔ 판매 중 빠른 변경. 판매 완료는 판매 결과 기록으로만 된다. */
export async function setItemStatusAction(fd: FormData): Promise<void> {
  const { item, isDemo, db } = await requireItem(s(fd, "itemId"));
  const status = s(fd, "status");
  if (status !== "OWNED" && status !== "LISTED") return;
  repo.setItemStatus(db, isDemo, item.id, status);
  revalidatePath(`/items/${item.id}`);
  revalidatePath("/");
  revalidatePath("/triage");
}

export async function duplicateItemAction(fd: FormData): Promise<void> {
  const { item, isDemo, db } = await requireItem(s(fd, "itemId"));
  const id = repo.duplicateItem(db, isDemo, item.id);
  if (id === null) throw new Error("물건을 찾을 수 없습니다.");
  revalidatePath("/");
  redirect(`/items/${id}/edit?copied=1`);
}

// ---- 가격 자료 ----

export async function savePriceAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { item, db } = await requireItem(s(fd, "itemId"));
  const raw: PriceInputRaw = {};
  for (const f of PRICE_FIELDS) raw[f] = s(fd, f);
  // 폼에서 온 자료는 항상 직접 입력(MANUAL)이다. 클라이언트가 보낸 경로 값은 믿지 않는다.
  const result = validatePriceInput(raw, { route: "MANUAL", today: todayYmd() });
  if (!result.ok) return { errors: result.errors, values: values(fd), message: "입력 내용을 확인해 주세요." };

  const priceId = intId(s(fd, "priceId"));
  const saved =
    priceId !== null
      ? repo.updatePrice(db, item, priceId, result.value)
      : repo.insertPrice(db, item, result.value, "MANUAL");
  if (!saved.ok) {
    return {
      values: values(fd),
      message: "이미 등록된 매물입니다(출처 ID 또는 원문 URL이 같음). 가격이 바뀌었다면 기존 자료를 수정해 주세요.",
    };
  }
  revalidatePath(`/items/${item.id}`);
  redirect(`/items/${item.id}#prices`);
}

export async function deletePriceAction(fd: FormData): Promise<void> {
  const { item, db } = await requireItem(s(fd, "itemId"));
  const priceId = intId(s(fd, "priceId"));
  if (priceId !== null) repo.deletePrice(db, item.id, priceId);
  revalidatePath(`/items/${item.id}`);
}

/** 가격이 그대로인 것을 출처에서 다시 확인했을 때 확인일만 오늘로 바꾼다. */
export async function recheckPriceAction(fd: FormData): Promise<void> {
  const { item, db } = await requireItem(s(fd, "itemId"));
  const priceId = intId(s(fd, "priceId"));
  if (priceId !== null) repo.recheckPrice(db, item.id, priceId, todayYmd());
  revalidatePath(`/items/${item.id}`);
  revalidatePath("/checkup");
}

export async function togglePriceAction(fd: FormData): Promise<void> {
  const { item, db } = await requireItem(s(fd, "itemId"));
  const priceId = intId(s(fd, "priceId"));
  if (priceId !== null) repo.setPriceIncluded(db, item.id, priceId, s(fd, "include") === "1");
  revalidatePath(`/items/${item.id}`);
}

const BULK_PRICE_OPS = ["EXCLUDE", "INCLUDE", "DELETE"] as const;
/** 한 번에 고를 수 있는 자료 수(입력 실수·남용 방지). */
const MAX_BULK_PRICES = 1000;

/** 고른 가격 자료를 한꺼번에 비교에서 빼기·다시 포함·삭제. 유형이나 금액은 바꾸지 않는다. */
export async function bulkPriceAction(fd: FormData): Promise<void> {
  const { item, db } = await requireItem(s(fd, "itemId"));
  const op = s(fd, "op") as (typeof BULK_PRICE_OPS)[number];
  if (!BULK_PRICE_OPS.includes(op)) return;
  const ids = [...new Set(fd.getAll("priceIds").map((v) => (typeof v === "string" ? intId(v) : null)))].filter((v): v is number => v !== null);
  if (ids.length === 0 || ids.length > MAX_BULK_PRICES) return;
  if (op === "DELETE") repo.deletePrices(db, item.id, ids);
  else repo.setPricesIncluded(db, item.id, ids, op === "INCLUDE");
  revalidatePath(`/items/${item.id}`);
}

export type CsvImportState = {
  message?: string;
  imported?: number;
  headerError?: string;
  rowErrors?: CsvRowError[];
};

export async function importCsvAction(_prev: CsvImportState, fd: FormData): Promise<CsvImportState> {
  const { item, db } = await requireItem(s(fd, "itemId"));
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return { headerError: "CSV 파일을 선택해 주세요." };
  if (file.size > MAX_CSV_BYTES) return { headerError: "파일이 너무 큽니다(최대 1MB)." };
  const text = await file.text();
  const plan = planCsvImport(text, todayYmd(), repo.listPrices(db, item.id));
  if (plan.headerError) return { headerError: plan.headerError };
  const imported = plan.valid.length > 0 ? repo.importPrices(db, item, plan.valid.map((v) => v.value)) : 0;
  revalidatePath(`/items/${item.id}`);
  return {
    imported,
    rowErrors: plan.errors,
    message:
      plan.errors.length === 0
        ? `${imported}건을 가져왔습니다.`
        : `${imported}건을 가져왔고, ${plan.errors.length}건은 오류로 건너뛰었습니다.`,
  };
}

/** 물건 목록 CSV 가져오기. 실제 사용 모드에서만 받는다(데모 자료와 섞이지 않게). */
export async function importItemsCsvAction(_prev: CsvImportState, fd: FormData): Promise<CsvImportState> {
  if (await isDemoMode()) return { headerError: "데모 모드에서는 물건을 가져올 수 없습니다. 실제 사용으로 돌아간 뒤 다시 해 주세요." };
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return { headerError: "CSV 파일을 선택해 주세요." };
  if (file.size > MAX_CSV_BYTES) return { headerError: "파일이 너무 큽니다(최대 1MB)." };
  const db = getDb();
  const plan = planItemsCsvImport(await file.text(), repo.listAllItems(db, false));
  if (plan.headerError) return { headerError: plan.headerError };
  const imported = repo.createItems(db, false, plan.valid.map((v) => v.value));
  revalidatePath("/");
  return {
    imported,
    rowErrors: plan.errors,
    message:
      plan.errors.length === 0
        ? `물건 ${imported}개를 등록했습니다.`
        : `물건 ${imported}개를 등록했고, ${plan.errors.length}행은 건너뛰었습니다.`,
  };
}

// ---- 비용 시나리오 ----

function optionalWon(raw: string, field: string, errors: Record<string, string>): number | null {
  if (raw.trim() === "") return null; // 빈칸 = 모름 (0원과 다름)
  const r = parseAmount(raw, "KRW");
  if (!r.ok) {
    errors[field] = r.error;
    return null;
  }
  return r.minor;
}

function optionalMinutes(raw: string, field: string, errors: Record<string, string>): number | null {
  if (raw.trim() === "") return null;
  if (!/^\d{1,6}$/.test(raw.trim())) {
    errors[field] = "분 단위 정수로 입력해 주세요.";
    return null;
  }
  return Number(raw.trim());
}

export async function saveScenarioAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { item, db } = await requireItem(s(fd, "itemId"));
  const method = s(fd, "method") as SaleMethod;
  if (!SALE_METHODS.includes(method)) return { message: "판매 방식이 올바르지 않습니다." };
  const errors: Record<string, string> = {};
  const today = todayYmd();

  // 판매처 이름은 구분용이다. 같은 방식 안에서 이름이 겹치면 저장하지 않는다(다른 계산을 덮어쓰지 않게).
  const existing = repo.listScenarios(db, item.id).filter((x) => x.method === method);
  const idRaw = s(fd, "scenarioId");
  const editing = idRaw === "" ? undefined : existing.find((x) => x.id === intId(idRaw));
  if (idRaw !== "" && !editing) return { message: "고치려는 계산을 찾을 수 없습니다. 화면을 새로 고쳐 주세요.", values: values(fd) };
  const channel = s(fd, "channel").trim();
  if (channel.length > CHANNEL_MAX) errors.channel = `${CHANNEL_MAX}자 이내로 입력해 주세요.`;
  else if (existing.some((x) => x.channel === channel && x.id !== editing?.id)) {
    errors.channel =
      channel === ""
        ? "이름 없는 계산이 이미 있습니다. 판매처 이름을 적어 구분해 주세요."
        : "같은 이름의 계산이 이미 있습니다. 이름을 다르게 적거나 그 계산을 고쳐 주세요.";
  }

  // 기준 금액: 가격 자료를 고르면 서버가 그 자료의 금액을 사용한다(화면에서 보낸 금액은 무시).
  let saleAmount = 0;
  let basisPriceRecordId: number | null = null;
  let basisPriceType: PriceType | null = null;
  const basisRaw = s(fd, "basisPriceRecordId");
  if (basisRaw !== "") {
    const rec = intId(basisRaw) !== null ? repo.getPrice(db, item.id, intId(basisRaw)!) : undefined;
    if (!rec) errors.basisPriceRecordId = "선택한 가격 자료를 찾을 수 없습니다.";
    else if (rec.currency !== "KRW") errors.basisPriceRecordId = "원화 자료만 기준 금액으로 쓸 수 있습니다.";
    else if (isQuoteExpired(rec, today)) {
      errors.basisPriceRecordId =
        "유효기간이 지난 견적은 기준 금액으로 쓸 수 없습니다. 새 견적을 받거나 예상 금액을 직접 입력해 주세요.";
    } else {
      saleAmount = rec.amountMinor;
      basisPriceRecordId = rec.id;
      basisPriceType = rec.priceType;
    }
  } else {
    const a = parseAmount(s(fd, "saleAmount"), "KRW");
    if (!a.ok) errors.saleAmount = a.error;
    else if (a.minor <= 0) errors.saleAmount = "금액은 0보다 커야 합니다.";
    else saleAmount = a.minor;
  }

  const feeMode = s(fd, "feeMode") === "RATE" ? "RATE" : "AMOUNT";
  let feeAmount: number | null = null;
  let feeRateBp: number | null = null;
  if (feeMode === "RATE") {
    const raw = s(fd, "feeRate");
    if (raw.trim() !== "") {
      const p = parsePercentToBp(raw);
      if (!p.ok) errors.feeRate = p.error;
      else feeRateBp = p.bp;
    }
  } else {
    feeAmount = optionalWon(s(fd, "feeAmount"), "feeAmount", errors);
  }
  const shipping = optionalWon(s(fd, "shipping"), "shipping", errors);
  const packing = optionalWon(s(fd, "packing"), "packing", errors);
  const transport = optionalWon(s(fd, "transport"), "transport", errors);
  const expectedMinutes = optionalMinutes(s(fd, "expectedMinutes"), "expectedMinutes", errors);
  const memo = s(fd, "memo").trim().slice(0, 500) || null;

  if (Object.keys(errors).length > 0) return { errors, values: values(fd), message: "입력 내용을 확인해 주세요." };

  const input: repo.ScenarioInput = {
    saleAmount,
    basisPriceRecordId,
    basisPriceType,
    feeMode,
    feeAmount,
    feeRateBp,
    shipping,
    packing,
    transport,
    expectedMinutes,
    memo,
  };
  if (editing) repo.updateScenario(db, item.id, editing.id, channel, input);
  else repo.upsertScenario(db, item.id, method, input, channel);
  revalidatePath(`/items/${item.id}`);
  revalidatePath("/triage");
  // 제출한 값을 그대로 돌려줘 저장 후에도 폼이 입력값을 유지하게 한다(React의 폼 자동 초기화 대비).
  return { ok: true, message: "저장했습니다.", values: values(fd) };
}

export async function chooseMethodAction(fd: FormData): Promise<void> {
  const { item, isDemo, db } = await requireItem(s(fd, "itemId"));
  const idRaw = s(fd, "scenarioId");
  if (idRaw === "") {
    repo.setChosenMethod(db, isDemo, item.id, null);
  } else {
    const sc = repo.listScenarios(db, item.id).find((x) => x.id === intId(idRaw));
    if (!sc) throw new Error("먼저 이 방식의 금액과 비용을 저장해 주세요.");
    // 기준 자료가 바뀌었거나 만료된 계산으로는 선택을 저장하지 않는다(화면에서도 버튼을 막는다).
    const basis = sc.basisPriceRecordId !== null ? repo.getPrice(db, item.id, sc.basisPriceRecordId) : undefined;
    if (basisIssues(sc, basis, todayYmd()).length > 0) {
      throw new Error("기준 가격 자료가 바뀌었거나 만료되었습니다. 금액·비용을 다시 저장한 뒤 선택해 주세요.");
    }
    const net = computeNet(sc);
    // 선택 시점의 금액을 스냅샷으로 남긴다. 비용이 불완전하면 실수령액은 null로 둔다.
    repo.setChosenMethod(db, isDemo, item.id, {
      method: sc.method,
      channel: sc.channel,
      saleAmount: sc.saleAmount,
      netAmount: net.net,
    });
  }
  revalidatePath(`/items/${item.id}`);
  revalidatePath("/");
}

/** 같은 방식의 계산이 여러 개일 때 손익분기·분류가 쓸 기준을 사용자가 정한다. */
export async function setPrimaryScenarioAction(fd: FormData): Promise<void> {
  const { item, db } = await requireItem(s(fd, "itemId"));
  const id = intId(s(fd, "scenarioId"));
  if (id === null) return;
  repo.setPrimaryScenario(db, item.id, id);
  revalidatePath(`/items/${item.id}`);
  revalidatePath("/triage");
}

export async function deleteScenarioAction(fd: FormData): Promise<void> {
  const { item, db } = await requireItem(s(fd, "itemId"));
  const id = intId(s(fd, "scenarioId"));
  if (id === null) return;
  repo.deleteScenario(db, item.id, id);
  revalidatePath(`/items/${item.id}`);
  revalidatePath("/triage");
  revalidatePath("/");
}

// ---- 실제 판매 결과 ----

export async function saveSaleResultAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { item, isDemo, db } = await requireItem(s(fd, "itemId"));
  const errors: Record<string, string> = {};
  const channel = s(fd, "channel").trim();
  if (channel === "") errors.channel = "어디에서 팔았는지 입력해 주세요.";
  else if (channel.length > 100) errors.channel = "100자 이내로 입력해 주세요.";
  const soldDate = s(fd, "soldDate").trim();
  if (!isValidYmd(soldDate)) errors.soldDate = "판매일을 YYYY-MM-DD 형식으로 입력해 주세요.";
  else if (soldDate > todayYmd()) errors.soldDate = "판매일은 오늘 이후일 수 없습니다.";
  let amount = 0;
  const a = parseAmount(s(fd, "amount"), "KRW");
  if (!a.ok) errors.amount = a.error;
  else if (a.minor <= 0) errors.amount = "금액은 0보다 커야 합니다.";
  else amount = a.minor;
  const typedTotal = optionalWon(s(fd, "costTotal"), "costTotal", errors);
  const costItems = {
    fee: optionalWon(s(fd, "feeActual"), "feeActual", errors),
    shipping: optionalWon(s(fd, "shippingActual"), "shippingActual", errors),
    packing: optionalWon(s(fd, "packingActual"), "packingActual", errors),
    transport: optionalWon(s(fd, "transportActual"), "transportActual", errors),
  };
  let costTotal = typedTotal;
  if (!errors.costTotal && !COST_KEYS.some((k) => errors[`${k}Actual`])) {
    const r = resolveActualCostTotal(typedTotal, costItems);
    if (!r.ok) errors.costTotal = r.error;
    else costTotal = r.total;
  }
  const minutesSpent = optionalMinutes(s(fd, "minutesSpent"), "minutesSpent", errors);
  const memo = s(fd, "memo").trim().slice(0, 1000) || null;
  if (Object.keys(errors).length > 0) return { errors, values: values(fd), message: "입력 내용을 확인해 주세요." };

  repo.upsertSaleResult(db, isDemo, item.id, {
    channel,
    soldDate,
    amount,
    costTotal,
    feeActual: costItems.fee,
    shippingActual: costItems.shipping,
    packingActual: costItems.packing,
    transportActual: costItems.transport,
    minutesSpent,
    memo,
  });
  revalidatePath("/results");
  revalidatePath(`/items/${item.id}`);
  revalidatePath("/");
  return { ok: true, message: "판매 결과를 저장했습니다.", values: values(fd) };
}

export async function deleteSaleResultAction(fd: FormData): Promise<void> {
  const { item, db } = await requireItem(s(fd, "itemId"));
  repo.deleteSaleResult(db, item.id);
  revalidatePath(`/items/${item.id}`);
}

// ---- 내 비용 묶음 ----

export async function saveCostPresetAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const isDemo = await isDemoMode();
  const r = validateCostPreset(values(fd));
  if (!r.ok) return { errors: r.errors, values: values(fd), message: "입력 내용을 확인해 주세요." };
  const idRaw = s(fd, "presetId");
  const saved = repo.saveCostPreset(getDb(), isDemo, idRaw === "" ? null : intId(idRaw), r.value);
  if (!saved.ok) {
    return saved.reason === "DUPLICATE_NAME"
      ? { errors: { name: "같은 이름의 묶음이 이미 있습니다." }, values: values(fd), message: "입력 내용을 확인해 주세요." }
      : { values: values(fd), message: "고치려는 묶음을 찾을 수 없습니다. 화면을 새로 고쳐 주세요." };
  }
  revalidatePath("/presets");
  return idRaw === "" ? { ok: true, message: "묶음을 만들었습니다." } : { ok: true, message: "저장했습니다.", values: values(fd) };
}

export async function deleteCostPresetAction(fd: FormData): Promise<void> {
  const id = intId(s(fd, "presetId"));
  if (id === null) return;
  repo.deleteCostPreset(getDb(), await isDemoMode(), id);
  revalidatePath("/presets");
}

// ---- 판매글 템플릿 ----

export async function saveTemplateAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const isDemo = await isDemoMode();
  const r = validateTemplateInput({ name: s(fd, "name"), body: s(fd, "body") });
  if (!r.ok) return { errors: r.errors, values: values(fd), message: "입력 내용을 확인해 주세요." };
  const idRaw = s(fd, "templateId");
  const saved = repo.saveTemplate(getDb(), isDemo, idRaw === "" ? null : intId(idRaw), r.value);
  if (!saved.ok) {
    return saved.reason === "DUPLICATE_NAME"
      ? { errors: { name: "같은 이름의 템플릿이 이미 있습니다." }, values: values(fd), message: "입력 내용을 확인해 주세요." }
      : { values: values(fd), message: "고치려는 템플릿을 찾을 수 없습니다. 화면을 새로 고쳐 주세요." };
  }
  revalidatePath("/templates");
  return idRaw === "" ? { ok: true, message: "템플릿을 만들었습니다." } : { ok: true, message: "저장했습니다.", values: values(fd) };
}

export async function deleteTemplateAction(fd: FormData): Promise<void> {
  const id = intId(s(fd, "templateId"));
  if (id === null) return;
  repo.deleteTemplate(getDb(), await isDemoMode(), id);
  revalidatePath("/templates");
}

// ---- 내 판매글에 올린 가격 ----

export async function savePostedPriceAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { item, db } = await requireItem(s(fd, "itemId"));
  const r = validatePostedPriceInput(
    { postedDate: s(fd, "postedDate"), amount: s(fd, "amount"), channel: s(fd, "channel"), memo: s(fd, "memo") },
    todayYmd(),
  );
  if (!r.ok) return { errors: r.errors, values: values(fd), message: "입력 내용을 확인해 주세요." };
  repo.insertPostedPrice(db, item.id, r.value);
  revalidatePath(`/items/${item.id}`);
  revalidatePath("/results");
  return { ok: true, message: "기록했습니다." };
}

export async function deletePostedPriceAction(fd: FormData): Promise<void> {
  const { item, db } = await requireItem(s(fd, "itemId"));
  const id = intId(s(fd, "postedPriceId"));
  if (id === null) return;
  repo.deletePostedPrice(db, item.id, id);
  revalidatePath(`/items/${item.id}`);
  revalidatePath("/results");
}

// ---- 받은 제안 ----

export async function saveOfferAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { item, db } = await requireItem(s(fd, "itemId"));
  const r = validateOfferInput(
    { receivedDate: s(fd, "receivedDate"), amount: s(fd, "amount"), channel: s(fd, "channel"), memo: s(fd, "memo") },
    todayYmd(),
  );
  if (!r.ok) return { errors: r.errors, values: values(fd), message: "입력 내용을 확인해 주세요." };
  repo.insertOffer(db, item.id, r.value);
  revalidatePath(`/items/${item.id}`);
  return { ok: true, message: "제안을 기록했습니다." };
}

export async function setOfferStatusAction(fd: FormData): Promise<void> {
  const { item, db } = await requireItem(s(fd, "itemId"));
  const id = intId(s(fd, "offerId"));
  const status = s(fd, "status") as OfferStatus;
  if (id === null || !OFFER_STATUSES.includes(status)) return;
  repo.setOfferStatus(db, item.id, id, status);
  revalidatePath(`/items/${item.id}`);
}

export async function deleteOfferAction(fd: FormData): Promise<void> {
  const { item, db } = await requireItem(s(fd, "itemId"));
  const id = intId(s(fd, "offerId"));
  if (id === null) return;
  repo.deleteOffer(db, item.id, id);
  revalidatePath(`/items/${item.id}`);
}

// ---- 배분: 시간당 가치 ----

export async function saveTimeValueAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const r = validateTimeValue(s(fd, "timeValuePerHour"));
  if (!r.ok) return { errors: { timeValuePerHour: r.error }, values: values(fd), message: "입력 내용을 확인해 주세요." };
  repo.setTimeValuePerHour(getDb(), await isDemoMode(), r.value);
  revalidatePath("/triage");
  return {
    ok: true,
    message: r.value === null ? "비워 두었습니다(모름). 시간 대비 판단은 보류됩니다." : "저장했습니다.",
    values: values(fd),
  };
}

// ---- 가져오기 API 설정 ----

export type ImportTokenState = { token?: string; message?: string };

/** 토큰을 새로 만든다(이미 있으면 재발급: 이전 토큰은 즉시 못 쓰게 된다). 원문은 이 응답에서 한 번만 보여 준다. */
export async function generateImportTokenAction(_prev: ImportTokenState, _fd: FormData): Promise<ImportTokenState> {
  void _prev;
  void _fd;
  const { token, hash } = generateImportToken();
  repo.setImportTokenHash(getDb(), hash);
  revalidatePath("/settings");
  return { token, message: "새 토큰을 만들었습니다. 지금만 볼 수 있으니 바로 복사해 두세요." };
}

// ---- 백업 사본 ----

/** 지금 DB의 사본을 backups 폴더에 만든다. 사용자가 누를 때만 실행한다. */
export async function createSnapshotAction(_prev: FormState, _fd: FormData): Promise<FormState> {
  void _prev;
  void _fd;
  const r = createSnapshot(getSqlite(), resolveDbPath());
  revalidatePath("/settings");
  if (!r.ok) return { message: r.error };
  return { ok: true, message: `사본을 만들었습니다: ${r.snapshot.name} (실제 물건 ${r.items}개, 실제 가격 자료 ${r.prices}건)` };
}

export async function deleteSnapshotAction(fd: FormData): Promise<void> {
  deleteSnapshot(resolveDbPath(), s(fd, "name"));
  revalidatePath("/settings");
}

export async function revokeImportTokenAction(): Promise<void> {
  repo.setImportTokenHash(getDb(), null);
  revalidatePath("/settings");
}

export async function saveExtensionIdAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const raw = s(fd, "extensionId").trim();
  if (raw !== "" && !isValidExtensionId(raw)) {
    return {
      errors: { extensionId: "확장 ID는 영문 소문자 a~p 32자입니다. chrome://extensions 또는 확장 팝업에서 복사해 주세요." },
      values: values(fd),
      message: "입력 내용을 확인해 주세요.",
    };
  }
  repo.setImportExtensionId(getDb(), raw === "" ? null : raw);
  revalidatePath("/settings");
  return { ok: true, message: raw === "" ? "확장 ID를 지웠습니다. 확장에서 보내는 요청은 거부됩니다." : "저장했습니다.", values: values(fd) };
}

// ---- 모드 전환 ----

export async function enterDemoAction(): Promise<void> {
  const db = getDb();
  if (repo.countDemoItems(db) === 0) seedDemo(db, todayYmd());
  (await cookies()).set(MODE_COOKIE, "demo", { httpOnly: true, sameSite: "lax", path: "/" });
  revalidatePath("/", "layout");
  redirect("/");
}

export async function resetDemoAction(): Promise<void> {
  seedDemo(getDb(), todayYmd());
  revalidatePath("/", "layout");
  redirect("/");
}

export async function exitDemoAction(): Promise<void> {
  (await cookies()).delete(MODE_COOKIE);
  revalidatePath("/", "layout");
  redirect("/");
}
