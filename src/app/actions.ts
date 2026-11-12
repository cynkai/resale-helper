"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db/client";
import { seedDemo } from "@/lib/db/demo-seed";
import * as repo from "@/lib/db/repo";
import { isQuoteExpired } from "@/lib/domain/compare";
import { MAX_CSV_BYTES, planCsvImport, type CsvRowError } from "@/lib/domain/csv";
import { ITEM_FIELDS, validateItemInput, type ItemInputRaw } from "@/lib/domain/item-input";
import { parseAmount, parsePercentToBp } from "@/lib/domain/money";
import { computeNet } from "@/lib/domain/net";
import { isValidYmd, PRICE_FIELDS, validatePriceInput, type PriceInputRaw } from "@/lib/domain/price-input";
import { basisIssues } from "@/lib/domain/scenario";
import { validateTimeValue } from "@/lib/domain/settings-input";
import { SALE_METHODS, type PriceType, type SaleMethod } from "@/lib/domain/types";
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
  const result = validateItemInput(raw);
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
  repo.deleteItem(db, isDemo, item.id);
  revalidatePath("/");
  redirect("/");
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

export async function togglePriceAction(fd: FormData): Promise<void> {
  const { item, db } = await requireItem(s(fd, "itemId"));
  const priceId = intId(s(fd, "priceId"));
  if (priceId !== null) repo.setPriceIncluded(db, item.id, priceId, s(fd, "include") === "1");
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

  repo.upsertScenario(db, item.id, method, {
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
  });
  revalidatePath(`/items/${item.id}`);
  // 제출한 값을 그대로 돌려줘 저장 후에도 폼이 입력값을 유지하게 한다(React의 폼 자동 초기화 대비).
  return { ok: true, message: "저장했습니다.", values: values(fd) };
}

export async function chooseMethodAction(fd: FormData): Promise<void> {
  const { item, isDemo, db } = await requireItem(s(fd, "itemId"));
  const method = s(fd, "method");
  if (method === "") {
    repo.setChosenMethod(db, isDemo, item.id, null);
  } else if (SALE_METHODS.includes(method as SaleMethod)) {
    const sc = repo.listScenarios(db, item.id).find((x) => x.method === method);
    if (!sc) throw new Error("먼저 이 방식의 금액과 비용을 저장해 주세요.");
    // 기준 자료가 바뀌었거나 만료된 계산으로는 선택을 저장하지 않는다(화면에서도 버튼을 막는다).
    const basis = sc.basisPriceRecordId !== null ? repo.getPrice(db, item.id, sc.basisPriceRecordId) : undefined;
    if (basisIssues(sc, basis, todayYmd()).length > 0) {
      throw new Error("기준 가격 자료가 바뀌었거나 만료되었습니다. 금액·비용을 다시 저장한 뒤 선택해 주세요.");
    }
    const net = computeNet(sc);
    // 선택 시점의 금액을 스냅샷으로 남긴다. 비용이 불완전하면 실수령액은 null로 둔다.
    repo.setChosenMethod(db, isDemo, item.id, {
      method: method as SaleMethod,
      saleAmount: sc.saleAmount,
      netAmount: net.net,
    });
  }
  revalidatePath(`/items/${item.id}`);
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
  const costTotal = optionalWon(s(fd, "costTotal"), "costTotal", errors);
  const minutesSpent = optionalMinutes(s(fd, "minutesSpent"), "minutesSpent", errors);
  const memo = s(fd, "memo").trim().slice(0, 1000) || null;
  if (Object.keys(errors).length > 0) return { errors, values: values(fd), message: "입력 내용을 확인해 주세요." };

  repo.upsertSaleResult(db, isDemo, item.id, { channel, soldDate, amount, costTotal, minutesSpent, memo });
  revalidatePath(`/items/${item.id}`);
  revalidatePath("/");
  return { ok: true, message: "판매 결과를 저장했습니다.", values: values(fd) };
}

export async function deleteSaleResultAction(fd: FormData): Promise<void> {
  const { item, db } = await requireItem(s(fd, "itemId"));
  repo.deleteSaleResult(db, item.id);
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
