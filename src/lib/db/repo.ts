// 데이터 접근 계층. 모든 조회·변경은 isDemo로 범위를 제한해 데모와 실제 자료가 섞이지 않게 한다.

import { and, asc, desc, eq, inArray, like, or, sql } from "drizzle-orm";
import type { Db } from "./client";
import {
  costScenarios,
  items,
  priceRecords,
  saleResults,
  userSettings,
  type CostScenario,
  type Item,
  type PriceRecord,
} from "./schema";
import { isSameListing } from "../domain/compare";
import type { ExportRow } from "../domain/csv";
import type { ValidItemInput } from "../domain/item-input";
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
  db.update(priceRecords)
    .set({ ...v, updatedAt: now })
    .where(and(eq(priceRecords.id, id), eq(priceRecords.itemId, item.id)))
    .run();
  return { ok: true, id };
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

export function listScenarios(db: Db, itemId: number) {
  return db.select().from(costScenarios).where(eq(costScenarios.itemId, itemId)).all();
}

export function upsertScenario(db: Db, itemId: number, method: SaleMethod, v: ScenarioInput): void {
  db.insert(costScenarios)
    .values({ ...v, itemId, method })
    .onConflictDoUpdate({
      target: [costScenarios.itemId, costScenarios.method],
      set: { ...v, updatedAt: now },
    })
    .run();
}

export function setChosenMethod(
  db: Db,
  isDemo: boolean,
  itemId: number,
  choice: { method: SaleMethod; saleAmount: number; netAmount: number | null } | null,
): void {
  db.update(items)
    .set({
      chosenMethod: choice?.method ?? null,
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
  minutesSpent: number | null;
  memo: string | null;
};

export function getSaleResult(db: Db, itemId: number) {
  return db.select().from(saleResults).where(eq(saleResults.itemId, itemId)).get();
}

export function upsertSaleResult(db: Db, isDemo: boolean, itemId: number, v: SaleResultInput): void {
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

/** 현재 모드의 판매 완료 기록 전체(판매일 최신순). 고른 방법의 예상 소요시간도 함께 가져온다. */
export function listSaleReviews(db: Db, isDemo: boolean) {
  return db
    .select({ item: items, result: saleResults, expectedMinutes: costScenarios.expectedMinutes })
    .from(saleResults)
    .innerJoin(items, eq(items.id, saleResults.itemId))
    .leftJoin(costScenarios, and(eq(costScenarios.itemId, items.id), eq(costScenarios.method, items.chosenMethod)))
    .where(eq(items.isDemo, isDemo))
    .orderBy(desc(saleResults.soldDate), desc(saleResults.id))
    .all();
}

export function deleteSaleResult(db: Db, itemId: number): void {
  db.delete(saleResults).where(eq(saleResults.itemId, itemId)).run();
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
  const scs = db.select().from(costScenarios).where(inArray(costScenarios.itemId, ids)).all();
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

// ---- 데모 ----

export function countDemoItems(db: Db): number {
  return db.select({ n: sql<number>`count(*)` }).from(items).where(eq(items.isDemo, true)).get()!.n;
}

/** 데모 자료만 지운다(가격·시나리오·판매 결과는 FK cascade로 함께 삭제). 데모 설정도 함께 비운다. */
export function clearDemo(db: Db): void {
  db.delete(items).where(eq(items.isDemo, true)).run();
  db.delete(userSettings).where(eq(userSettings.isDemo, true)).run();
}
