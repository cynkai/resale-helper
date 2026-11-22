// 데이터 접근 계층. 모든 조회·변경은 isDemo로 범위를 제한해 데모와 실제 자료가 섞이지 않게 한다.

import { and, asc, desc, eq, inArray, isNotNull, isNull, like, or, sql } from "drizzle-orm";
import type { Db } from "./client";
import {
  costPresets,
  costScenarios,
  items,
  listingTemplates,
  offers,
  postedPrices,
  priceHistory,
  priceRecords,
  saleResults,
  userSettings,
  type CostScenario,
  type Item,
  type PostedPrice,
  type PriceHistoryRow,
  type PriceRecord,
} from "./schema";
import { isSameListing } from "../domain/compare";
import type { CsvPrice, ExportRow } from "../domain/csv";
import type { ValidCostPreset } from "../domain/cost-preset";
import type { ValidItemInput } from "../domain/item-input";
import type { OfferStatus, ValidOfferInput } from "../domain/offer";
import type { ValidPostedPriceInput } from "../domain/posted-price";
import type { ValidPriceInput } from "../domain/price-input";
import type { Category, InputRoute, ItemStatus, PriceType, SaleMethod } from "../domain/types";

const now = sql`(datetime('now'))`;

/** 물건 번호별로 묶는다(물건마다 전체 배열을 다시 훑지 않도록). */
function byItem<T extends { itemId: number }>(rows: T[]): Map<number, T[]> {
  const m = new Map<number, T[]>();
  for (const r of rows) {
    const list = m.get(r.itemId);
    if (list) list.push(r);
    else m.set(r.itemId, [r]);
  }
  return m;
}

/** 그 모드의, 휴지통에 들어가지 않은 물건. 물건을 읽는 모든 조회가 이 조건을 쓴다. */
const live = (isDemo: boolean) => and(eq(items.isDemo, isDemo), isNull(items.deletedAt))!;

// ---- 물건 ----

export const ITEM_SORTS = ["updated", "registered", "name"] as const;
export type ItemSort = (typeof ITEM_SORTS)[number];
export const ITEM_SORT_LABEL: Record<ItemSort, string> = {
  updated: "최근에 고친 순",
  registered: "최근에 등록한 순",
  name: "이름순",
};

export type ItemFilter = {
  q?: string;
  category?: Category;
  status?: ItemStatus;
  sort?: ItemSort;
  /** true면 이름·식별자·저자만 찾는다(가져오기 API용: 메모·하자 같은 내용을 검색으로 알아낼 수 없게). */
  basicSearch?: boolean;
};

export function listItems(db: Db, isDemo: boolean, f: ItemFilter = {}) {
  const conds = [live(isDemo)];
  if (f.category) conds.push(eq(items.category, f.category));
  if (f.status) conds.push(eq(items.status, f.status));
  if (f.q && f.q.trim() !== "") {
    // 이름·식별자·저자에 더해 출판사·구성품·하자·메모도 찾는다. 검색어의 %·_는 와일드카드로 쓰지 않는다.
    const pat = `%${f.q.trim().replace(/[%_]/g, "")}%`;
    const basic = [like(items.name, pat), like(items.identifier, pat), like(items.author, pat)];
    conds.push(
      or(
        ...basic,
        ...(f.basicSearch ? [] : [like(items.publisher, pat), like(items.components, pat), like(items.defects, pat), like(items.memo, pat)]),
      )!,
    );
  }
  return db
    .select({
      item: items,
      // 하위 질의 안에서 열 이름이 모호해지지 않도록 테이블 이름을 직접 적는다.
      priceCount: sql<number>`(select count(*) from price_records p where p.item_id = "items"."id" and p.deleted_at is null)`,
      scenarioCount: sql<number>`(select count(*) from cost_scenarios c where c.item_id = "items"."id")`,
      resultCount: sql<number>`(select count(*) from sale_results r where r.item_id = "items"."id")`,
      openOfferCount: sql<number>`(select count(*) from offers o where o.item_id = "items"."id" and o.status = 'OPEN')`,
    })
    .from(items)
    .where(and(...conds))
    .orderBy(
      ...(f.sort === "name"
        ? [asc(items.name), asc(items.id)]
        : f.sort === "registered"
          ? [desc(items.id)]
          : [desc(items.updatedAt), desc(items.id)]),
    )
    .all();
}

export function getItem(db: Db, isDemo: boolean, id: number): Item | undefined {
  return db
    .select()
    .from(items)
    .where(and(eq(items.id, id), live(isDemo)))
    .get();
}

export function createItem(db: Db, isDemo: boolean, v: ValidItemInput): number {
  const r = db
    .insert(items)
    .values({ ...v, purchaseAmount: v.purchaseAmount ?? null, purchaseDate: v.purchaseDate ?? null, isDemo })
    .returning({ id: items.id })
    .get();
  return r.id;
}

export function updateItem(db: Db, isDemo: boolean, id: number, v: ValidItemInput): void {
  db.update(items)
    .set({ ...v, purchaseAmount: v.purchaseAmount ?? null, purchaseDate: v.purchaseDate ?? null, updatedAt: now })
    .where(and(eq(items.id, id), live(isDemo)))
    .run();
}

/**
 * 물건 상태를 보유 중·판매 중 사이에서 바꾼다(수정 화면을 거치지 않는 빠른 변경).
 * 판매 완료는 판매 결과를 기록할 때만 되므로 여기서는 만들지 않고, 판매 결과가 있는 물건은 바꾸지 않는다.
 */
export function setItemStatus(db: Db, isDemo: boolean, id: number, status: "OWNED" | "LISTED"): boolean {
  const hasResult = db.select({ id: saleResults.id }).from(saleResults).where(eq(saleResults.itemId, id)).get();
  if (hasResult) return false;
  return (
    db
      .update(items)
      .set({ status, updatedAt: now })
      .where(and(eq(items.id, id), live(isDemo)))
      .returning({ id: items.id })
      .all().length === 1
  );
}

/**
 * 여러 물건을 한꺼번에 판매 중·보유 중으로 바꾸거나 휴지통으로 옮긴다(현재 모드의 살아 있는 물건만).
 * 상태 변경은 판매 결과가 있는 물건(판매 완료)을 건너뛴다. 바뀐 수와 건너뛴 수를 돌려준다.
 */
export function bulkItems(db: Db, isDemo: boolean, ids: number[], op: "LISTED" | "OWNED" | "TRASH"): { done: number; skipped: number } {
  return db.transaction(() => {
    let done = 0;
    for (const id of ids) {
      if (op === "TRASH") {
        const r = db.update(items).set({ deletedAt: now, updatedAt: now }).where(and(eq(items.id, id), live(isDemo))).returning({ id: items.id }).all();
        done += r.length;
      } else if (setItemStatus(db, isDemo, id, op)) done += 1;
    }
    return { done, skipped: ids.length - done };
  });
}

/** 등록 순서로 바로 앞·뒤 물건(같은 모드, 휴지통 제외). 여러 물건을 차례로 손볼 때 쓴다. */
export function adjacentItems(db: Db, isDemo: boolean, id: number): { prev: { id: number; name: string } | null; next: { id: number; name: string } | null } {
  const pick = { id: items.id, name: items.name };
  const prev = db.select(pick).from(items).where(and(live(isDemo), sql`${items.id} < ${id}`)).orderBy(desc(items.id)).limit(1).get();
  const next = db.select(pick).from(items).where(and(live(isDemo), sql`${items.id} > ${id}`)).orderBy(asc(items.id)).limit(1).get();
  return { prev: prev ?? null, next: next ?? null };
}

// ---- 휴지통 ----

/** 물건을 휴지통으로 옮긴다. 딸린 자료는 그대로 두므로 되살리면 모두 돌아온다. */
export function trashItem(db: Db, isDemo: boolean, id: number): void {
  db.update(items).set({ deletedAt: now, updatedAt: now }).where(and(eq(items.id, id), live(isDemo))).run();
}

const trashed = (isDemo: boolean) => and(eq(items.isDemo, isDemo), isNotNull(items.deletedAt))!;

/** 휴지통의 물건(최근에 넣은 것부터)과 딸린 자료 건수. */
export function listTrashedItems(db: Db, isDemo: boolean) {
  return db
    .select({
      item: items,
      priceCount: sql<number>`(select count(*) from price_records p where p.item_id = "items"."id")`,
      scenarioCount: sql<number>`(select count(*) from cost_scenarios c where c.item_id = "items"."id")`,
      resultCount: sql<number>`(select count(*) from sale_results r where r.item_id = "items"."id")`,
    })
    .from(items)
    .where(trashed(isDemo))
    .orderBy(desc(items.deletedAt), desc(items.id))
    .all();
}

export function countTrashedItems(db: Db, isDemo: boolean): number {
  return db.select({ n: sql<number>`count(*)` }).from(items).where(trashed(isDemo)).get()!.n;
}

/** 휴지통에서 되살린다. 휴지통에 있는 물건에만 동작한다. */
export function restoreItem(db: Db, isDemo: boolean, id: number): void {
  db.update(items).set({ deletedAt: null, updatedAt: now }).where(and(eq(items.id, id), trashed(isDemo))).run();
}

/** 휴지통의 물건 하나를 완전히 지운다(딸린 자료도 함께). 살아 있는 물건은 지우지 않는다. */
export function purgeItem(db: Db, isDemo: boolean, id: number): void {
  db.delete(items).where(and(eq(items.id, id), trashed(isDemo))).run();
}

/** 휴지통을 비운다. 지운 물건 수를 돌려준다. */
export function emptyTrash(db: Db, isDemo: boolean): number {
  return db.transaction((tx) => {
    tx.delete(priceRecords).where(trashedPrice(isDemo)).run();
    return tx.delete(items).where(trashed(isDemo)).returning({ id: items.id }).all().length;
  });
}

/** 물건 여러 개를 한 번에 등록한다(전부 성공하거나 전부 실패). */
export function createItems(db: Db, isDemo: boolean, values: ValidItemInput[]): number {
  if (values.length === 0) return 0;
  db.transaction((tx) => {
    for (const v of values) tx.insert(items).values({ ...v, isDemo }).run();
  });
  return values.length;
}

/**
 * 같은 물건을 하나 더 등록한다(책 두 권, 같은 기기 두 대). 물건 정보만 베끼고 상태는 보유 중으로 둔다.
 * 가격 자료·계산·선택·판매 결과·제안·올린 가격·산 가격은 베끼지 않는다(물건마다 따로 확인해야 하는 값이다).
 */
export function duplicateItem(db: Db, isDemo: boolean, id: number): number | null {
  const src = getItem(db, isDemo, id);
  if (!src) return null;
  return createItem(db, isDemo, {
    category: src.category,
    status: "OWNED",
    name: src.name,
    identifier: src.identifier,
    condition: src.condition,
    defects: src.defects,
    components: src.components,
    memo: src.memo,
    author: src.author,
    publisher: src.publisher,
    edition: src.edition,
    hasWriting: src.hasWriting,
    hasUnderline: src.hasUnderline,
    hasDamage: src.hasDamage,
    hasSupplement: src.hasSupplement,
  });
}

/** 현재 모드의 물건 전체(등록 순서). CSV 내보내기·중복 확인용. */
export function listAllItems(db: Db, isDemo: boolean): Item[] {
  return db.select().from(items).where(live(isDemo)).orderBy(asc(items.id)).all();
}

// ---- 가격 자료 ----

/** 휴지통에 없는 가격 자료. 비교·점검·내보내기 등 자료를 읽는 곳은 모두 이 조건을 쓴다. */
const livePrice = isNull(priceRecords.deletedAt);

export function listPrices(db: Db, itemId: number): PriceRecord[] {
  return db
    .select()
    .from(priceRecords)
    .where(and(eq(priceRecords.itemId, itemId), livePrice))
    .orderBy(asc(priceRecords.priceType), desc(priceRecords.checkedDate), asc(priceRecords.id))
    .all();
}

export function getPrice(db: Db, itemId: number, id: number): PriceRecord | undefined {
  return db
    .select()
    .from(priceRecords)
    .where(and(eq(priceRecords.id, id), eq(priceRecords.itemId, itemId), livePrice))
    .get();
}

/** 중복 판별용: 휴지통에 있는 자료까지 포함한 물건의 가격 자료 전체. */
export function listPricesForDedup(db: Db, itemId: number): PriceRecord[] {
  return db.select().from(priceRecords).where(eq(priceRecords.itemId, itemId)).all();
}

/** 같은 매물이 있는지. 휴지통에 있는 자료와 겹치면 inTrash가 true다. */
function findDuplicate(db: Db, itemId: number, v: Parameters<typeof isSameListing>[1], exceptId?: number) {
  const dup = listPricesForDedup(db, itemId).find((e) => e.id !== exceptId && isSameListing(e, v));
  return dup ? { ok: false as const, reason: "DUPLICATE" as const, inTrash: dup.deletedAt !== null } : null;
}

export type SaveResult = { ok: true; id: number } | { ok: false; reason: "DUPLICATE"; inTrash: boolean };

/** 같은 매물(출처+외부 ID 또는 정규화 URL)이 이미 있으면(휴지통 포함) 저장하지 않는다. */
export function insertPrice(db: Db, item: Item, v: ValidPriceInput, route: InputRoute): SaveResult {
  const dup = findDuplicate(db, item.id, v);
  if (dup) return dup;
  const r = db
    .insert(priceRecords)
    .values({ ...v, itemId: item.id, isDemo: item.isDemo, inputRoute: route })
    .returning({ id: priceRecords.id })
    .get();
  return { ok: true, id: r.id };
}

export function updatePrice(db: Db, item: Item, id: number, v: ValidPriceInput): SaveResult {
  const before = getPrice(db, item.id, id);
  // 없는 자료(휴지통 포함)는 바꾸지 않는다. 예전처럼 조용히 넘어간다.
  if (!before) return { ok: true, id };
  const dup = findDuplicate(db, item.id, v, id);
  if (dup) return dup;
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
      .where(and(eq(priceRecords.id, id), eq(priceRecords.itemId, item.id), livePrice))
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
      .where(and(eq(priceRecords.id, id), eq(priceRecords.itemId, itemId), livePrice))
      .run();
  });
  return true;
}

/** 여러 자료를 한 번에 "오늘 다시 확인함"으로. 이미 오늘 확인한 자료는 건너뛴다. 바뀐 건수를 돌려준다. */
export function recheckPrices(db: Db, itemId: number, ids: number[], today: string): number {
  return db.transaction(() => ids.filter((id) => recheckPrice(db, itemId, id, today)).length);
}

/** 물건의 가격 자료들에 남은 이전 값(가격 자료별, 오래된 것부터). */
export function listPriceHistory(db: Db, itemId: number): Map<number, PriceHistoryRow[]> {
  const rows = db
    .select({ h: priceHistory })
    .from(priceHistory)
    .innerJoin(priceRecords, eq(priceRecords.id, priceHistory.priceRecordId))
    .where(and(eq(priceRecords.itemId, itemId), livePrice))
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

/** 가격 자료를 휴지통으로 옮긴다(이전 값 이력도 그대로 둔다). */
export function deletePrice(db: Db, itemId: number, id: number): void {
  deletePrices(db, itemId, [id]);
}

export function setPriceIncluded(db: Db, itemId: number, id: number, included: boolean): void {
  db.update(priceRecords)
    .set({ includedInComparison: included, updatedAt: now })
    .where(and(eq(priceRecords.id, id), eq(priceRecords.itemId, itemId), livePrice))
    .run();
}

/** 여러 자료를 한 번에 비교에 넣거나 뺀다. 그 물건의 자료만 바뀐다. 바뀐 건수를 돌려준다. */
export function setPricesIncluded(db: Db, itemId: number, ids: number[], included: boolean): number {
  if (ids.length === 0) return 0;
  return db
    .update(priceRecords)
    .set({ includedInComparison: included, updatedAt: now })
    .where(and(inArray(priceRecords.id, ids), eq(priceRecords.itemId, itemId), livePrice))
    .returning({ id: priceRecords.id })
    .all().length;
}

/** 여러 자료를 한 번에 휴지통으로 옮긴다. 그 물건의 자료만 옮겨진다. 옮긴 건수를 돌려준다. */
export function deletePrices(db: Db, itemId: number, ids: number[]): number {
  if (ids.length === 0) return 0;
  return db
    .update(priceRecords)
    .set({ deletedAt: now, updatedAt: now })
    .where(and(inArray(priceRecords.id, ids), eq(priceRecords.itemId, itemId), livePrice))
    .returning({ id: priceRecords.id })
    .all().length;
}

const trashedPrice = (isDemo: boolean) => and(eq(priceRecords.isDemo, isDemo), isNotNull(priceRecords.deletedAt))!;

/** 휴지통의 가격 자료(살아 있는 물건의 것만, 최근에 넣은 것부터). 물건째 휴지통에 간 자료는 물건과 함께 보인다. */
export function listTrashedPrices(db: Db, isDemo: boolean) {
  return db
    .select({ p: priceRecords, itemName: items.name })
    .from(priceRecords)
    .innerJoin(items, eq(items.id, priceRecords.itemId))
    .where(and(trashedPrice(isDemo), live(isDemo)))
    .orderBy(desc(priceRecords.deletedAt), desc(priceRecords.id))
    .all();
}

/** 휴지통에 있는 가격 자료 수. itemId를 주면 그 물건의 것만, 아니면 살아 있는 물건 전체의 것. */
export function countTrashedPrices(db: Db, isDemo: boolean, itemId?: number): number {
  return db
    .select({ n: sql<number>`count(*)` })
    .from(priceRecords)
    .innerJoin(items, eq(items.id, priceRecords.itemId))
    .where(and(trashedPrice(isDemo), live(isDemo), itemId !== undefined ? eq(priceRecords.itemId, itemId) : undefined))
    .get()!.n;
}

/** 휴지통의 가격 자료를 되살린다. 물건이 살아 있을 때만. 되살린 자료의 물건 번호를 돌려준다. */
export function restorePrice(db: Db, isDemo: boolean, id: number): number | null {
  const row = db
    .update(priceRecords)
    .set({ deletedAt: null, updatedAt: now })
    .where(and(eq(priceRecords.id, id), trashedPrice(isDemo), inArray(priceRecords.itemId, db.select({ id: items.id }).from(items).where(live(isDemo)))))
    .returning({ itemId: priceRecords.itemId })
    .get();
  return row?.itemId ?? null;
}

/** 휴지통의 가격 자료 하나를 완전히 지운다(그 자료를 기준으로 삼은 계산은 "기준 자료 삭제됨"으로 남는다). */
export function purgePrice(db: Db, isDemo: boolean, id: number): void {
  db.delete(priceRecords).where(and(eq(priceRecords.id, id), trashedPrice(isDemo))).run();
}

export function importPrices(db: Db, item: Item, values: readonly CsvPrice[]): number {
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
  const conds = [eq(priceRecords.isDemo, isDemo), live(isDemo), livePrice];
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
/** 출처 이름 제안: 현재 모드의 살아 있는 가격 자료에 쓴 출처 이름(많이 쓴 순, 같으면 가나다순, 최대 limit개). */
export function listSourceNames(db: Db, isDemo: boolean, limit = 50): string[] {
  return db
    .select({ s: priceRecords.sourceName, n: sql<number>`count(*)` })
    .from(priceRecords)
    .innerJoin(items, eq(items.id, priceRecords.itemId))
    .where(and(live(isDemo), eq(priceRecords.isDemo, isDemo), livePrice))
    .groupBy(priceRecords.sourceName)
    .orderBy(desc(sql`count(*)`), asc(priceRecords.sourceName))
    .limit(limit)
    .all()
    .map((r) => r.s);
}

export function listChannelNames(db: Db, isDemo: boolean): string[] {
  const a = db
    .selectDistinct({ c: costScenarios.channel })
    .from(costScenarios)
    .innerJoin(items, eq(items.id, costScenarios.itemId))
    .where(live(isDemo))
    .all();
  const b = db
    .selectDistinct({ c: saleResults.channel })
    .from(saleResults)
    .innerJoin(items, eq(items.id, saleResults.itemId))
    .where(live(isDemo))
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
    .where(and(eq(items.id, itemId), live(isDemo)))
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
      .where(and(eq(items.id, itemId), live(isDemo)))
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
    .where(live(isDemo))
    .orderBy(desc(saleResults.soldDate), desc(saleResults.id))
    .all();
}

/**
 * 같은 식별자(ISBN·모델명)의 다른 물건을 내가 전에 판 기록. 카테고리가 같고 식별자가 같아야 한다(대소문자·공백 무시).
 * 내가 기록한 값이며 가격 자료가 아니다(비교·요약에 넣지 않고 보여 주기만 한다).
 */
export function listPastSalesForSameIdentifier(db: Db, isDemo: boolean, item: Pick<Item, "id" | "category" | "identifier">) {
  const key = (item.identifier ?? "").trim().toLowerCase().replace(/\s+/g, "");
  if (key === "") return [];
  return db
    .select({
      itemId: items.id,
      name: items.name,
      condition: items.condition,
      components: items.components,
      soldDate: saleResults.soldDate,
      channel: saleResults.channel,
      amount: saleResults.amount,
      costTotal: saleResults.costTotal,
    })
    .from(saleResults)
    .innerJoin(items, eq(items.id, saleResults.itemId))
    .where(
      and(
        live(isDemo),
        eq(items.category, item.category),
        sql`${items.id} <> ${item.id}`,
        sql`lower(replace(coalesce(${items.identifier}, ''), ' ', '')) = ${key}`,
      ),
    )
    .orderBy(desc(saleResults.soldDate), desc(saleResults.id))
    .limit(20)
    .all();
}

/**
 * 같은 식별자(ISBN·모델명)로 등록한 다른 물건 중 아직 판매 결과가 없는 것(현재 모드, 휴지통 제외).
 * 같은 물건을 두 번 등록했는지 알아차리게 할 뿐 막지 않는다(같은 책을 두 권 가질 수 있다).
 */
export function listSameIdentifierItems(db: Db, isDemo: boolean, item: Pick<Item, "id" | "category" | "identifier">) {
  const key = (item.identifier ?? "").trim().toLowerCase().replace(/\s+/g, "");
  if (key === "") return [];
  return db
    .select({ id: items.id, name: items.name, status: items.status, condition: items.condition })
    .from(items)
    .leftJoin(saleResults, eq(saleResults.itemId, items.id))
    .where(
      and(
        live(isDemo),
        isNull(saleResults.id),
        eq(items.category, item.category),
        sql`${items.id} <> ${item.id}`,
        sql`lower(replace(coalesce(${items.identifier}, ''), ' ', '')) = ${key}`,
      ),
    )
    .orderBy(asc(items.id))
    .limit(20)
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

// ---- 내 판매글에 올린 가격 ----

/** 올린 날짜순(같은 날은 적은 순서). */
export function listPostedPrices(db: Db, itemId: number) {
  return db.select().from(postedPrices).where(eq(postedPrices.itemId, itemId)).orderBy(asc(postedPrices.postedDate), asc(postedPrices.id)).all();
}

export function insertPostedPrice(db: Db, itemId: number, v: ValidPostedPriceInput): number {
  return db.insert(postedPrices).values({ ...v, itemId }).returning({ id: postedPrices.id }).get().id;
}

export function deletePostedPrice(db: Db, itemId: number, id: number): void {
  db.delete(postedPrices).where(and(eq(postedPrices.id, id), eq(postedPrices.itemId, itemId))).run();
}

/** 현재 모드의 물건별 올린 가격 기록(날짜순). 결과 돌아보기용. */
export function listPostedPricesByItem(db: Db, isDemo: boolean): Map<number, PostedPrice[]> {
  const rows = db
    .select({ p: postedPrices })
    .from(postedPrices)
    .innerJoin(items, eq(items.id, postedPrices.itemId))
    .where(live(isDemo))
    .orderBy(asc(postedPrices.postedDate), asc(postedPrices.id))
    .all();
  const map = new Map<number, PostedPrice[]>();
  for (const { p } of rows) {
    const list = map.get(p.itemId);
    if (list) list.push(p);
    else map.set(p.itemId, [p]);
  }
  return map;
}

// ---- 내 비용 묶음 ----

export function listCostPresets(db: Db, isDemo: boolean) {
  return db.select().from(costPresets).where(eq(costPresets.isDemo, isDemo)).orderBy(asc(costPresets.id)).all();
}

export type PresetSaveResult = { ok: true; id: number } | { ok: false; reason: "DUPLICATE_NAME" | "NOT_FOUND" };

/** id가 있으면 고치고 없으면 만든다. 같은 모드에 같은 이름이 있으면 저장하지 않는다. */
export function saveCostPreset(db: Db, isDemo: boolean, id: number | null, v: ValidCostPreset): PresetSaveResult {
  const all = listCostPresets(db, isDemo);
  const same = all.find((p) => p.name === v.name);
  if (same && same.id !== id) return { ok: false, reason: "DUPLICATE_NAME" };
  if (id === null) {
    return { ok: true, id: db.insert(costPresets).values({ ...v, isDemo }).returning({ id: costPresets.id }).get().id };
  }
  if (!all.some((p) => p.id === id)) return { ok: false, reason: "NOT_FOUND" };
  db.update(costPresets).set({ ...v, updatedAt: now }).where(and(eq(costPresets.id, id), eq(costPresets.isDemo, isDemo))).run();
  return { ok: true, id };
}

export function deleteCostPreset(db: Db, isDemo: boolean, id: number): void {
  db.delete(costPresets).where(and(eq(costPresets.id, id), eq(costPresets.isDemo, isDemo))).run();
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
    .where(and(live(isDemo), inArray(items.status, ["OWNED", "LISTED"])))
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
          .where(and(inArray(priceRecords.id, basisIds), eq(priceRecords.isDemo, isDemo), livePrice))
          .all()
      : [];
  const scsBy = byItem(scs);
  const recsBy = byItem(recs);
  return its.map((item) => ({
    item,
    scenarios: scsBy.get(item.id) ?? [],
    basisRecords: recsBy.get(item.id) ?? [],
  }));
}

// ---- 자료 점검 ----

/** 현재 모드에서 아직 팔지 않은 물건과 그 가격 자료·시나리오 전체. */
export function listCheckupSources(db: Db, isDemo: boolean) {
  const its = db
    .select()
    .from(items)
    .where(and(live(isDemo), inArray(items.status, ["OWNED", "LISTED"])))
    .orderBy(asc(items.id))
    .all();
  if (its.length === 0) return [];
  const ids = its.map((i) => i.id);
  const prices = db
    .select()
    .from(priceRecords)
    .where(and(inArray(priceRecords.itemId, ids), eq(priceRecords.isDemo, isDemo), livePrice))
    .all();
  const scs = db.select().from(costScenarios).where(inArray(costScenarios.itemId, ids)).orderBy(asc(costScenarios.id)).all();
  const offerRows = db.select().from(offers).where(inArray(offers.itemId, ids)).all();
  const pricesBy = byItem(prices);
  const scsBy = byItem(scs);
  const offersBy = byItem(offerRows);
  return its.map((item) => ({
    item,
    prices: pricesBy.get(item.id) ?? [],
    scenarios: scsBy.get(item.id) ?? [],
    offers: offersBy.get(item.id) ?? [],
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
  db.delete(costPresets).where(eq(costPresets.isDemo, true)).run();
}

// ---- 전체 내보내기 ----

/** 현재 모드의 물건 전체와 딸린 자료. 다른 모드의 자료는 섞이지 않는다. */
export function listFullExportSources(db: Db, isDemo: boolean) {
  const its = db.select().from(items).where(live(isDemo)).orderBy(asc(items.id)).all();
  if (its.length === 0) return [];
  const ids = its.map((i) => i.id);
  const prices = db
    .select()
    .from(priceRecords)
    .where(and(inArray(priceRecords.itemId, ids), eq(priceRecords.isDemo, isDemo), livePrice))
    .orderBy(asc(priceRecords.id))
    .all();
  const scs = db.select().from(costScenarios).where(inArray(costScenarios.itemId, ids)).orderBy(asc(costScenarios.id)).all();
  const results = db.select().from(saleResults).where(inArray(saleResults.itemId, ids)).all();
  const posted = listPostedPricesByItem(db, isDemo);
  const offerRows = db.select().from(offers).where(inArray(offers.itemId, ids)).orderBy(asc(offers.receivedDate), asc(offers.id)).all();
  // 이전 값: 가격 자료 번호를 하나하나 넘기지 않고(자료가 많으면 SQL 변수 한도에 걸린다) 같은 조건으로 묶어 읽는다.
  const histRows = db
    .select({ h: priceHistory })
    .from(priceHistory)
    .innerJoin(priceRecords, eq(priceRecords.id, priceHistory.priceRecordId))
    .innerJoin(items, eq(items.id, priceRecords.itemId))
    .where(and(live(isDemo), eq(priceRecords.isDemo, isDemo), livePrice))
    .orderBy(asc(priceHistory.checkedDate), asc(priceHistory.id))
    .all()
    .map((r) => r.h);
  const history = new Map<number, PriceHistoryRow[]>();
  for (const h of histRows) {
    const list = history.get(h.priceRecordId);
    if (list) list.push(h);
    else history.set(h.priceRecordId, [h]);
  }
  const pricesBy = byItem(prices);
  const scsBy = byItem(scs);
  const resultBy = new Map(results.map((r) => [r.itemId, r]));
  const offersBy = byItem(offerRows);
  return its.map((item) => ({
    item,
    prices: pricesBy.get(item.id) ?? [],
    history,
    scenarios: scsBy.get(item.id) ?? [],
    saleResult: resultBy.get(item.id),
    offers: offersBy.get(item.id) ?? [],
    postedPrices: posted.get(item.id) ?? [],
  }));
}
