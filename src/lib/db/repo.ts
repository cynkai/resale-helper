// 데이터 접근 계층. 모든 조회·변경은 isDemo로 범위를 제한해 데모와 실제 자료가 섞이지 않게 한다.

import { and, asc, desc, eq, inArray, like, or, sql } from "drizzle-orm";
import type { Db } from "./client";
import {
  costScenarios,
  items,
  listingTemplates,
  offers,
  priceHistory,
  priceRecords,
  saleResults,
  userSettings,
  type CostScenario,
  type Item,
  type PriceHistoryRow,
  type PriceRecord,
} from "./schema";
import { isSameListing } from "../domain/compare";
import type { ExportRow } from "../domain/csv";
import type { ValidItemInput } from "../domain/item-input";
import type { OfferStatus, ValidOfferInput } from "../domain/offer";
import type { ValidPriceInput } from "../domain/price-input";
import type { Category, InputRoute, ItemStatus, PriceType, SaleMethod } from "../domain/types";

const now = sql`(datetime('now'))`;

// ---- 물건 ----

export type ItemFilter = { q?: string; category?: Category; status?: ItemStatus };

export function listItems(db: Db, isDemo: boolean, f: ItemFilter = {}) {
  const conds = [eq(items.isDemo, isDemo)];
  if (f.category) conds.push(eq(items.category, f.category));
  if (f.status) conds.push(eq(items.status, f.status));
  if (f.q && f.q.trim() !== "") {
    const pat = `%${f.q.trim().replace(/[%_]/g, "")}%`;
    conds.push(or(like(items.name, pat), like(items.identifier, pat), like(items.author, pat))!);
  }
  return db
    .select({
      item: items,
      // 하위 질의 안에서 열 이름이 모호해지지 않도록 테이블 이름을 직접 적는다.
      priceCount: sql<number>`(select count(*) from price_records p where p.item_id = "items"."id")`,
      scenarioCount: sql<number>`(select count(*) from cost_scenarios c where c.item_id = "items"."id")`,
      resultCount: sql<number>`(select count(*) from sale_results r where r.item_id = "items"."id")`,
    })
    .from(items)
    .where(and(...conds))
    .orderBy(desc(items.updatedAt), desc(items.id))
    .all();
}

export function getItem(db: Db, isDemo: boolean, id: number): Item | undefined {
  return db
    .select()
    .from(items)
    .where(and(eq(items.id, id), eq(items.isDemo, isDemo)))
    .get();
}

export function createItem(db: Db, isDemo: boolean, v: ValidItemInput): number {
  const r = db
    .insert(items)
    .values({ ...v, isDemo })
    .returning({ id: items.id })
    .get();
  return r.id;
}

export function updateItem(db: Db, isDemo: boolean, id: number, v: ValidItemInput): void {
  db.update(items)
    .set({ ...v, updatedAt: now })
    .where(and(eq(items.id, id), eq(items.isDemo, isDemo)))
    .run();
}

/** 물건 여러 개를 한 번에 등록한다(전부 성공하거나 전부 실패). */
export function createItems(db: Db, isDemo: boolean, values: ValidItemInput[]): number {
  if (values.length === 0) return 0;
  db.transaction((tx) => {
    for (const v of values) tx.insert(items).values({ ...v, isDemo }).run();
  });
  return values.length;
}

/** 현재 모드의 물건 전체(등록 순서). CSV 내보내기·중복 확인용. */
export function listAllItems(db: Db, isDemo: boolean): Item[] {
  return db.select().from(items).where(eq(items.isDemo, isDemo)).orderBy(asc(items.id)).all();
}

export function deleteItem(db: Db, isDemo: boolean, id: number): void {
  db.delete(items)
    .where(and(eq(items.id, id), eq(items.isDemo, isDemo)))
    .run();
}

// ---- 가격 자료 ----

export function listPrices(db: Db, itemId: number): PriceRecord[] {
  return db
    .select()
    .from(priceRecords)
    .where(eq(priceRecords.itemId, itemId))
    .orderBy(asc(priceRecords.priceType), desc(priceRecords.checkedDate), asc(priceRecords.id))
    .all();
}

export function getPrice(db: Db, itemId: number, id: number): PriceRecord | undefined {
  return db
    .select()
    .from(priceRecords)
    .where(and(eq(priceRecords.id, id), eq(priceRecords.itemId, itemId)))
    .get();
}

export type SaveResult = { ok: true; id: number } | { ok: false; reason: "DUPLICATE" };

/** 같은 매물(출처+외부 ID 또는 정규화 URL)이 이미 있으면 저장하지 않는다. */
export function insertPrice(db: Db, item: Item, v: ValidPriceInput, route: InputRoute): SaveResult {
  const existing = listPrices(db, item.id);
  if (existing.some((e) => isSameListing(e, v))) return { ok: false, reason: "DUPLICATE" };
  const r = db
    .insert(priceRecords)
    .values({ ...v, itemId: item.id, isDemo: item.isDemo, inputRoute: route })
    .returning({ id: priceRecords.id })
    .get();
  return { ok: true, id: r.id };
}

export function updatePrice(db: Db, item: Item, id: number, v: ValidPriceInput): SaveResult {
  const others = listPrices(db, item.id).filter((e) => e.id !== id);
  if (others.some((e) => isSameListing(e, v))) return { ok: false, reason: "DUPLICATE" };
  const before = getPrice(db, item.id, id);
  db.transaction((tx) => {
    // 금액·통화·확인일·유형 중 하나라도 바뀌면 바뀌기 전 값을 이력으로 남긴다.
    if (
      before &&
      (before.amountMinor !== v.amountMinor || before.currency !== v.currency || before.checkedDate !== v.checkedDate || before.priceType !== v.priceType)
    ) {
      tx.insert(priceHistory)
        .values({
          priceRecordId: id,
          priceType: before.priceType,
          amountMinor: before.amountMinor,
          currency: before.currency,
          checkedDate: before.checkedDate,
        })
        .run();
    }
    tx.update(priceRecords)
      .set({ ...v, updatedAt: now })
      .where(and(eq(priceRecords.id, id), eq(priceRecords.itemId, item.id)))
      .run();
  });
  return { ok: true, id };
}

/**
 * 출처에서 다시 확인했더니 가격이 그대로일 때: 확인일만 오늘로 바꾸고, 이전 확인일을 이력에 남긴다.
 * 이미 오늘 확인한 자료이거나 확인일이 오늘보다 뒤면 아무것도 하지 않는다.
 */
export function recheckPrice(db: Db, itemId: number, id: number, today: string): boolean {
  const before = getPrice(db, itemId, id);
  if (!before || before.checkedDate >= today) return false;
  db.transaction((tx) => {
    tx.insert(priceHistory)
      .values({
        priceRecordId: id,
        priceType: before.priceType,
        amountMinor: before.amountMinor,
        currency: before.currency,
        checkedDate: before.checkedDate,
      })
      .run();
    tx.update(priceRecords)
      .set({ checkedDate: today, updatedAt: now })
      .where(and(eq(priceRecords.id, id), eq(priceRecords.itemId, itemId)))
      .run();
  });
  return true;
}

/** 물건의 가격 자료들에 남은 이전 값(가격 자료별, 오래된 것부터). */
export function listPriceHistory(db: Db, itemId: number): Map<number, PriceHistoryRow[]> {
  const rows = db
    .select({ h: priceHistory })
    .from(priceHistory)
    .innerJoin(priceRecords, eq(priceRecords.id, priceHistory.priceRecordId))
    .where(eq(priceRecords.itemId, itemId))
    .orderBy(asc(priceHistory.checkedDate), asc(priceHistory.id))
    .all();
  const map = new Map<number, PriceHistoryRow[]>();
  for (const { h } of rows) {
    const list = map.get(h.priceRecordId);
    if (list) list.push(h);
    else map.set(h.priceRecordId, [h]);
  }
  return map;
}

export function deletePrice(db: Db, itemId: number, id: number): void {
  db.delete(priceRecords)
    .where(and(eq(priceRecords.id, id), eq(priceRecords.itemId, itemId)))
    .run();
}

export function setPriceIncluded(db: Db, itemId: number, id: number, included: boolean): void {
  db.update(priceRecords)
    .set({ includedInComparison: included, updatedAt: now })
    .where(and(eq(priceRecords.id, id), eq(priceRecords.itemId, itemId)))
    .run();
}

export function importPrices(db: Db, item: Item, values: ValidPriceInput[]): number {
  return db.transaction((tx) => {
    for (const v of values) {
      tx.insert(priceRecords)
        .values({ ...v, itemId: item.id, isDemo: item.isDemo, inputRoute: "CSV" })
        .run();
    }
    return values.length;
  });
}

export function exportRows(db: Db, isDemo: boolean, itemId?: number): ExportRow[] {
  const conds = [eq(priceRecords.isDemo, isDemo), eq(items.isDemo, isDemo)];
  if (itemId !== undefined) conds.push(eq(priceRecords.itemId, itemId));
  return db
    .select({ p: priceRecords, itemName: items.name })
    .from(priceRecords)
    .innerJoin(items, eq(items.id, priceRecords.itemId))
    .where(and(...conds))
    .orderBy(asc(priceRecords.itemId), asc(priceRecords.id))
    .all()
    .map(({ p, itemName }) => ({ ...p, itemName }));
}

// ---- 비용 시나리오·판매 방식 ----

export type ScenarioInput = {
  saleAmount: number;
  basisPriceRecordId: number | null;
  basisPriceType: PriceType | null;
  feeMode: "AMOUNT" | "RATE";
  feeAmount: number | null;
  feeRateBp: number | null;
  shipping: number | null;
  packing: number | null;
  transport: number | null;
  expectedMinutes: number | null;
  memo: string | null;
};

/** 입력한 순서대로. */
export function listScenarios(db: Db, itemId: number) {
  return db.select().from(costScenarios).where(eq(costScenarios.itemId, itemId)).orderBy(asc(costScenarios.id)).all();
}

/** 같은 방식·같은 판매처 이름의 계산이 있으면 고치고 없으면 만든다. */
export function upsertScenario(db: Db, itemId: number, method: SaleMethod, v: ScenarioInput, channel = ""): void {
  db.insert(costScenarios)
    .values({ ...v, itemId, method, channel })
    .onConflictDoUpdate({
      target: [costScenarios.itemId, costScenarios.method, costScenarios.channel],
      set: { ...v, updatedAt: now },
    })
    .run();
}

/** 저장된 계산을 고친다(판매처 이름도 바꿀 수 있다). 이름이 겹치는지는 호출하는 쪽에서 먼저 확인한다. */
export function updateScenario(db: Db, itemId: number, id: number, channel: string, v: ScenarioInput): void {
  db.transaction((tx) => {
    const before = tx.select().from(costScenarios).where(and(eq(costScenarios.id, id), eq(costScenarios.itemId, itemId))).get();
    if (!before) return;
    tx.update(costScenarios).set({ ...v, channel, updatedAt: now }).where(eq(costScenarios.id, id)).run();
    // 고른 계산의 이름만 바꾼 것이면 선택이 그 계산을 계속 가리키게 한다(금액 스냅샷은 건드리지 않는다).
    if (before.channel !== channel) {
      tx.update(items)
        .set({ chosenChannel: channel })
        .where(
          and(
            eq(items.id, itemId),
            eq(items.chosenMethod, before.method),
            eq(sql`coalesce(${items.chosenChannel}, '')`, before.channel),
          ),
        )
        .run();
    }
  });
}

export function deleteScenario(db: Db, itemId: number, id: number): void {
  db.delete(costScenarios).where(and(eq(costScenarios.id, id), eq(costScenarios.itemId, itemId))).run();
}

/** 그 방식의 기준 계산을 하나로 정한다(같은 방식의 다른 계산은 기준에서 내린다). */
export function setPrimaryScenario(db: Db, itemId: number, id: number): void {
  db.transaction((tx) => {
    const sc = tx.select().from(costScenarios).where(and(eq(costScenarios.id, id), eq(costScenarios.itemId, itemId))).get();
    if (!sc) return;
    tx.update(costScenarios)
      .set({ isPrimary: false })
      .where(and(eq(costScenarios.itemId, itemId), eq(costScenarios.method, sc.method)))
      .run();
    tx.update(costScenarios).set({ isPrimary: true, updatedAt: now }).where(eq(costScenarios.id, id)).run();
  });
}

/** 현재 모드에서 내가 적어 본 판매처 이름(계산과 판매 결과). 입력 자동완성용이며 앱이 가진 목록이 아니다. */
export function listChannelNames(db: Db, isDemo: boolean): string[] {
  const a = db
    .selectDistinct({ c: costScenarios.channel })
    .from(costScenarios)
    .innerJoin(items, eq(items.id, costScenarios.itemId))
    .where(eq(items.isDemo, isDemo))
    .all();
  const b = db
    .selectDistinct({ c: saleResults.channel })
    .from(saleResults)
    .innerJoin(items, eq(items.id, saleResults.itemId))
    .where(eq(items.isDemo, isDemo))
    .all();
  return [...new Set([...a, ...b].map((r) => r.c).filter((c) => c !== ""))].sort((x, y) => x.localeCompare(y, "ko"));
}

export function setChosenMethod(
  db: Db,
  isDemo: boolean,
  itemId: number,
  choice: { method: SaleMethod; channel?: string; saleAmount: number; netAmount: number | null } | null,
): void {
  db.update(items)
    .set({
      chosenMethod: choice?.method ?? null,
      chosenChannel: choice ? (choice.channel ?? "") : null,
      chosenSaleAmount: choice?.saleAmount ?? null,
      chosenNetAmount: choice?.netAmount ?? null,
      chosenAt: choice ? sql`(datetime('now'))` : null,
      updatedAt: now,
    })
    .where(and(eq(items.id, itemId), eq(items.isDemo, isDemo)))
    .run();
}

// ---- 실제 판매 결과 ----

export type SaleResultInput = {
  channel: string;
  soldDate: string;
  amount: number;
  costTotal: number | null;
  /** 항목별 실제 비용(선택). 넘기지 않으면 적지 않은 것으로 저장한다. */
  feeActual?: number | null;
  shippingActual?: number | null;
  packingActual?: number | null;
  transportActual?: number | null;
  minutesSpent: number | null;
  memo: string | null;
};

export function getSaleResult(db: Db, itemId: number) {
  return db.select().from(saleResults).where(eq(saleResults.itemId, itemId)).get();
}

export function upsertSaleResult(db: Db, isDemo: boolean, itemId: number, input: SaleResultInput): void {
  const v = {
    ...input,
    feeActual: input.feeActual ?? null,
    shippingActual: input.shippingActual ?? null,
    packingActual: input.packingActual ?? null,
    transportActual: input.transportActual ?? null,
  };
  db.transaction((tx) => {
    tx.insert(saleResults)
      .values({ ...v, itemId })
      .onConflictDoUpdate({ target: saleResults.itemId, set: { ...v, updatedAt: now } })
      .run();
    tx.update(items)
      .set({ status: "SOLD", updatedAt: now })
      .where(and(eq(items.id, itemId), eq(items.isDemo, isDemo)))
      .run();
  });
}

/** 현재 모드의 판매 완료 기록 전체(판매일 최신순). 고른 계산(있으면)과 그 예상 소요시간도 함께 가져온다. */
export function listSaleReviews(db: Db, isDemo: boolean) {
  return db
    .select({ item: items, result: saleResults, expectedMinutes: costScenarios.expectedMinutes, scenario: costScenarios })
    .from(saleResults)
    .innerJoin(items, eq(items.id, saleResults.itemId))
    .leftJoin(
      costScenarios,
      and(
        eq(costScenarios.itemId, items.id),
        eq(costScenarios.method, items.chosenMethod),
        eq(costScenarios.channel, sql`coalesce(${items.chosenChannel}, '')`),
      ),
    )
    .where(eq(items.isDemo, isDemo))
    .orderBy(desc(saleResults.soldDate), desc(saleResults.id))
    .all();
}

export function deleteSaleResult(db: Db, itemId: number): void {
  db.delete(saleResults).where(eq(saleResults.itemId, itemId)).run();
}

// ---- 받은 제안 ----

/** 받은 날짜 최신순. */
export function listOffers(db: Db, itemId: number) {
  return db.select().from(offers).where(eq(offers.itemId, itemId)).orderBy(desc(offers.receivedDate), desc(offers.id)).all();
}

export function insertOffer(db: Db, itemId: number, v: ValidOfferInput): number {
  return db.insert(offers).values({ ...v, itemId }).returning({ id: offers.id }).get().id;
}

export function setOfferStatus(db: Db, itemId: number, id: number, status: OfferStatus): void {
  db.update(offers).set({ status, updatedAt: now }).where(and(eq(offers.id, id), eq(offers.itemId, itemId))).run();
}

export function deleteOffer(db: Db, itemId: number, id: number): void {
  db.delete(offers).where(and(eq(offers.id, id), eq(offers.itemId, itemId))).run();
}

// ---- 판매글 템플릿 ----

export function listTemplates(db: Db, isDemo: boolean) {
  return db.select().from(listingTemplates).where(eq(listingTemplates.isDemo, isDemo)).orderBy(asc(listingTemplates.id)).all();
}

export function getTemplate(db: Db, isDemo: boolean, id: number) {
  return db.select().from(listingTemplates).where(and(eq(listingTemplates.id, id), eq(listingTemplates.isDemo, isDemo))).get();
}

export type TemplateSaveResult = { ok: true; id: number } | { ok: false; reason: "DUPLICATE_NAME" | "NOT_FOUND" };

/** id가 있으면 고치고 없으면 만든다. 같은 모드에 같은 이름이 있으면 저장하지 않는다. */
export function saveTemplate(db: Db, isDemo: boolean, id: number | null, v: { name: string; body: string }): TemplateSaveResult {
  const same = listTemplates(db, isDemo).find((t) => t.name === v.name);
  if (same && same.id !== id) return { ok: false, reason: "DUPLICATE_NAME" };
  if (id === null) {
    return { ok: true, id: db.insert(listingTemplates).values({ ...v, isDemo }).returning({ id: listingTemplates.id }).get().id };
  }
  if (!getTemplate(db, isDemo, id)) return { ok: false, reason: "NOT_FOUND" };
  db.update(listingTemplates).set({ ...v, updatedAt: now }).where(and(eq(listingTemplates.id, id), eq(listingTemplates.isDemo, isDemo))).run();
  return { ok: true, id };
}

export function deleteTemplate(db: Db, isDemo: boolean, id: number): void {
  db.delete(listingTemplates).where(and(eq(listingTemplates.id, id), eq(listingTemplates.isDemo, isDemo))).run();
}

// ---- 사용자 설정 ----

/** 현재 모드의 시간당 가치(원/시간). 저장한 적 없거나 비워 두면 null(모름). */
export function getTimeValuePerHour(db: Db, isDemo: boolean): number | null {
  return (
    db.select({ v: userSettings.timeValuePerHour }).from(userSettings).where(eq(userSettings.isDemo, isDemo)).get()?.v ?? null
  );
}

export function setTimeValuePerHour(db: Db, isDemo: boolean, value: number | null): void {
  db.insert(userSettings)
    .values({ isDemo, timeValuePerHour: value })
    .onConflictDoUpdate({ target: userSettings.isDemo, set: { timeValuePerHour: value, updatedAt: now } })
    .run();
}

// ---- 가져오기 API 접근 설정(실제 모드 행에만 둔다) ----

export type ImportSettings = { tokenHash: string | null; tokenCreatedAt: string | null; extensionId: string | null };

export function getImportSettings(db: Db): ImportSettings {
  const r = db.select().from(userSettings).where(eq(userSettings.isDemo, false)).get();
  return {
    tokenHash: r?.importTokenHash ?? null,
    tokenCreatedAt: r?.importTokenCreatedAt ?? null,
    extensionId: r?.importExtensionId ?? null,
  };
}

/** 토큰 해시를 저장한다(새 발급·재발급). null이면 폐기 → 가져오기 API가 꺼진다. */
export function setImportTokenHash(db: Db, hash: string | null): void {
  const set = { importTokenHash: hash, importTokenCreatedAt: hash ? sql`(datetime('now'))` : null, updatedAt: now };
  db.insert(userSettings)
    .values({ isDemo: false, importTokenHash: hash, importTokenCreatedAt: hash ? sql`(datetime('now'))` : null })
    .onConflictDoUpdate({ target: userSettings.isDemo, set })
    .run();
}

export function setImportExtensionId(db: Db, extensionId: string | null): void {
  db.insert(userSettings)
    .values({ isDemo: false, importExtensionId: extensionId })
    .onConflictDoUpdate({ target: userSettings.isDemo, set: { importExtensionId: extensionId, updatedAt: now } })
    .run();
}

// ---- 배분 ----

export type TriageCandidate = {
  item: Item;
  scenarios: CostScenario[];
  /** 시나리오가 기준으로 삼은 가격 자료(남아 있는 것만). basisIssues 확인용. */
  basisRecords: PriceRecord[];
};

/** 현재 모드에서 아직 팔지 않은(보유 중·판매 중) 물건과 그 시나리오·기준 자료. */
export function listTriageCandidates(db: Db, isDemo: boolean): TriageCandidate[] {
  const its = db
    .select()
    .from(items)
    .where(and(eq(items.isDemo, isDemo), inArray(items.status, ["OWNED", "LISTED"])))
    .orderBy(asc(items.id))
    .all();
  if (its.length === 0) return [];
  const ids = its.map((i) => i.id);
  const scs = db.select().from(costScenarios).where(inArray(costScenarios.itemId, ids)).orderBy(asc(costScenarios.id)).all();
  const basisIds = scs.map((s) => s.basisPriceRecordId).filter((x): x is number => x !== null);
  const recs =
    basisIds.length > 0
      ? db
          .select()
          .from(priceRecords)
          .where(and(inArray(priceRecords.id, basisIds), eq(priceRecords.isDemo, isDemo)))
          .all()
      : [];
  return its.map((item) => ({
    item,
    scenarios: scs.filter((s) => s.itemId === item.id),
    basisRecords: recs.filter((r) => r.itemId === item.id),
  }));
}

// ---- 자료 점검 ----

/** 현재 모드에서 아직 팔지 않은 물건과 그 가격 자료·시나리오 전체. */
export function listCheckupSources(db: Db, isDemo: boolean) {
  const its = db
    .select()
    .from(items)
    .where(and(eq(items.isDemo, isDemo), inArray(items.status, ["OWNED", "LISTED"])))
    .orderBy(asc(items.id))
    .all();
  if (its.length === 0) return [];
  const ids = its.map((i) => i.id);
  const prices = db
    .select()
    .from(priceRecords)
    .where(and(inArray(priceRecords.itemId, ids), eq(priceRecords.isDemo, isDemo)))
    .all();
  const scs = db.select().from(costScenarios).where(inArray(costScenarios.itemId, ids)).orderBy(asc(costScenarios.id)).all();
  return its.map((item) => ({
    item,
    prices: prices.filter((p) => p.itemId === item.id),
    scenarios: scs.filter((s) => s.itemId === item.id),
  }));
}

// ---- 데모 ----

export function countDemoItems(db: Db): number {
  return db.select({ n: sql<number>`count(*)` }).from(items).where(eq(items.isDemo, true)).get()!.n;
}

/** 데모 자료만 지운다(가격·시나리오·판매 결과는 FK cascade로 함께 삭제). 데모 설정도 함께 비운다. */
export function clearDemo(db: Db): void {
  db.delete(items).where(eq(items.isDemo, true)).run();
  db.delete(userSettings).where(eq(userSettings.isDemo, true)).run();
  db.delete(listingTemplates).where(eq(listingTemplates.isDemo, true)).run();
}

// ---- 전체 내보내기 ----

/** 현재 모드의 물건 전체와 딸린 자료. 다른 모드의 자료는 섞이지 않는다. */
export function listFullExportSources(db: Db, isDemo: boolean) {
  const its = db.select().from(items).where(eq(items.isDemo, isDemo)).orderBy(asc(items.id)).all();
  if (its.length === 0) return [];
  const ids = its.map((i) => i.id);
  const prices = db
    .select()
    .from(priceRecords)
    .where(and(inArray(priceRecords.itemId, ids), eq(priceRecords.isDemo, isDemo)))
    .orderBy(asc(priceRecords.id))
    .all();
  const scs = db.select().from(costScenarios).where(inArray(costScenarios.itemId, ids)).orderBy(asc(costScenarios.id)).all();
  const results = db.select().from(saleResults).where(inArray(saleResults.itemId, ids)).all();
  const offerRows = db.select().from(offers).where(inArray(offers.itemId, ids)).orderBy(asc(offers.receivedDate), asc(offers.id)).all();
  const histRows =
    prices.length > 0
      ? db
          .select()
          .from(priceHistory)
          .where(inArray(priceHistory.priceRecordId, prices.map((p) => p.id)))
          .orderBy(asc(priceHistory.checkedDate), asc(priceHistory.id))
          .all()
      : [];
  const history = new Map<number, PriceHistoryRow[]>();
  for (const h of histRows) {
    const list = history.get(h.priceRecordId);
    if (list) list.push(h);
    else history.set(h.priceRecordId, [h]);
  }
  return its.map((item) => ({
    item,
    prices: prices.filter((p) => p.itemId === item.id),
    history,
    scenarios: scs.filter((s) => s.itemId === item.id),
    saleResult: results.find((r) => r.itemId === item.id),
    offers: offerRows.filter((o) => o.itemId === item.id),
  }));
}
