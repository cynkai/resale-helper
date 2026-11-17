import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "@/lib/db/client";
import {
  adjacentItems,
  bulkItems,
  countTrashedItems,
  countTrashedPrices,
  createItem,
  deletePrices,
  duplicateItem,
  emptyTrash,
  exportRows,
  getItem,
  insertOffer,
  insertPostedPrice,
  insertPrice,
  listAllItems,
  listChannelNames,
  listCheckupSources,
  listFullExportSources,
  listItems,
  listOffers,
  listPastSalesForSameIdentifier,
  listPostedPricesByItem,
  listPriceHistory,
  listPrices,
  listSourceNames,
  listSaleReviews,
  listTrashedItems,
  listTrashedPrices,
  purgePrice,
  restorePrice,
  listTriageCandidates,
  purgeItem,
  recheckPrices,
  restoreItem,
  setItemStatus,
  setPricesIncluded,
  trashItem,
  updatePrice,
  upsertSaleResult,
  upsertScenario,
} from "@/lib/db/repo";
import type { ValidItemInput } from "@/lib/domain/item-input";
import { planItemsCsvImport } from "@/lib/domain/items-csv";
import { validatePriceInput } from "@/lib/domain/price-input";

const TODAY = "2026-11-17";

const input = (name: string): ValidItemInput => ({
  category: "CONSOLE",
  status: "OWNED",
  name,
  identifier: "ABC-1",
  condition: "GOOD",
  defects: null,
  components: null,
  memo: null,
  author: null,
  publisher: null,
  edition: null,
  hasWriting: "UNKNOWN",
  hasUnderline: "UNKNOWN",
  hasDamage: "UNKNOWN",
  hasSupplement: "UNKNOWN",
});

const scenario = {
  saleAmount: 10000,
  basisPriceRecordId: null,
  basisPriceType: null,
  feeMode: "AMOUNT" as const,
  feeAmount: 0,
  feeRateBp: null,
  shipping: 0,
  packing: 0,
  transport: 0,
  expectedMinutes: 30,
  memo: null,
};

let tmpDir: string;
let db: Db;
let close: () => void;
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "resale-trash-"));
  ({ db, close } = openDb(path.join(tmpDir, "t.db")));
});
afterEach(() => {
  try {
    close();
  } catch {}
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** 물건 하나에 가격 자료·계산·제안·올린 가격·판매 결과를 모두 붙인다. */
function fullItem(name: string, sold: boolean): number {
  const id = createItem(db, false, input(name));
  const item = getItem(db, false, id)!;
  const p = validatePriceInput({ priceType: "ASKING", amount: "12000", sourceName: "장터", checkedDate: TODAY, externalId: `x-${id}` }, { route: "MANUAL", today: TODAY });
  if (!p.ok) throw new Error("price");
  insertPrice(db, item, p.value, "MANUAL");
  upsertScenario(db, id, "DIRECT", scenario, "휴지통 장터");
  insertOffer(db, id, { receivedDate: TODAY, amount: 9000, channel: "", memo: null });
  insertPostedPrice(db, id, { postedDate: TODAY, amount: 11000, channel: "", memo: null });
  if (sold) upsertSaleResult(db, false, id, { channel: "휴지통 서점", soldDate: TODAY, amount: 9000, costTotal: 0, minutesSpent: null, memo: null });
  return id;
}

describe("휴지통", () => {
  it("휴지통의 물건은 어떤 목록·계산·내보내기에도 나오지 않는다", () => {
    const owned = fullItem("보유 게임기", false);
    const sold = fullItem("판 게임기", true);
    const keep = createItem(db, false, { ...input("남는 게임기"), identifier: "KEEP-1" });
    trashItem(db, false, owned);
    trashItem(db, false, sold);

    expect(getItem(db, false, owned)).toBeUndefined();
    expect(listItems(db, false).map((r) => r.item.id)).toEqual([keep]);
    expect(listAllItems(db, false).map((i) => i.id)).toEqual([keep]);
    expect(listTriageCandidates(db, false).map((c) => c.item.id)).toEqual([keep]);
    expect(listCheckupSources(db, false).map((c) => c.item.id)).toEqual([keep]);
    expect(listFullExportSources(db, false).map((c) => c.item.id)).toEqual([keep]);
    expect(listSaleReviews(db, false)).toHaveLength(0);
    expect(listChannelNames(db, false)).toEqual([]);
    expect(listPostedPricesByItem(db, false).size).toBe(0);
    expect(exportRows(db, false)).toHaveLength(0);
    expect(duplicateItem(db, false, owned)).toBeNull();
    expect(countTrashedItems(db, false)).toBe(2);
    expect(countTrashedItems(db, true)).toBe(0);
  });

  it("되살리면 딸린 자료가 모두 그대로 돌아온다", () => {
    const id = fullItem("게임기", true);
    trashItem(db, false, id);
    expect(listTrashedItems(db, false)[0]).toMatchObject({ priceCount: 1, scenarioCount: 1, resultCount: 1 });
    restoreItem(db, false, id);
    expect(getItem(db, false, id)).toMatchObject({ name: "게임기", deletedAt: null, status: "SOLD" });
    expect(listPrices(db, id)).toHaveLength(1);
    expect(listOffers(db, id)).toHaveLength(1);
    expect(listSaleReviews(db, false)).toHaveLength(1);
    expect(listChannelNames(db, false)).toEqual(["휴지통 서점", "휴지통 장터"]);
    expect(countTrashedItems(db, false)).toBe(0);
  });

  it("완전히 지우기와 비우기는 휴지통의 물건에만 동작하고, 다른 모드는 건드리지 않는다", () => {
    const live = fullItem("살아 있는 게임기", false);
    const gone = fullItem("지울 게임기", false);
    const demo = createItem(db, true, input("데모 게임기"));
    trashItem(db, true, demo);
    purgeItem(db, false, live); // 살아 있는 물건은 지우지 않는다
    expect(getItem(db, false, live)).toBeDefined();
    restoreItem(db, false, live); // 살아 있는 물건에는 아무 일도 없다
    trashItem(db, false, gone);
    trashItem(db, true, live); // 다른 모드로는 옮길 수 없다
    expect(getItem(db, false, live)).toBeDefined();
    purgeItem(db, true, gone); // 다른 모드로는 지울 수 없다
    expect(countTrashedItems(db, false)).toBe(1);
    expect(emptyTrash(db, false)).toBe(1);
    expect(listPrices(db, gone)).toHaveLength(0); // 딸린 자료도 함께 지워진다
    expect(listPrices(db, live)).toHaveLength(1);
    expect(countTrashedItems(db, true)).toBe(1); // 데모 휴지통은 그대로
  });

  it("휴지통에 있는 물건과 같은 물건을 CSV로 다시 등록할 수 있다", () => {
    const id = createItem(db, false, input("게임기"));
    const csv = "category,name,identifier,condition\nCONSOLE,게임기,ABC-1,GOOD";
    expect(planItemsCsvImport(csv, listAllItems(db, false)).valid).toHaveLength(0);
    trashItem(db, false, id);
    expect(planItemsCsvImport(csv, listAllItems(db, false)).valid).toHaveLength(1);
  });
});

describe("가격 자료 한꺼번에 다루기", () => {
  const add = (item: NonNullable<ReturnType<typeof getItem>>, n: number) => {
    const p = validatePriceInput({ priceType: "ASKING", amount: String(10000 + n), sourceName: "장터", checkedDate: TODAY, externalId: `b-${item.id}-${n}` }, { route: "MANUAL", today: TODAY });
    if (!p.ok) throw new Error("price");
    const r = insertPrice(db, item, p.value, "MANUAL");
    if (!r.ok) throw new Error("insert");
    return r.id;
  };

  it("고른 자료만, 그 물건의 것만 바꾼다. 유형과 금액은 그대로다", () => {
    const a = getItem(db, false, createItem(db, false, input("가")))!;
    const b = getItem(db, false, createItem(db, false, { ...input("나"), identifier: "B-1" }))!;
    const [a1, a2, a3] = [add(a, 1), add(a, 2), add(a, 3)];
    const b1 = add(b, 1);
    expect(setPricesIncluded(db, a.id, [a1, a2, b1], false)).toBe(2); // 다른 물건의 자료는 바뀌지 않는다
    expect(listPrices(db, a.id).map((p) => [p.id, p.includedInComparison, p.priceType, p.amountMinor])).toEqual([
      [a1, false, "ASKING", 10001],
      [a2, false, "ASKING", 10002],
      [a3, true, "ASKING", 10003],
    ]);
    expect(listPrices(db, b.id)[0]!.includedInComparison).toBe(true);
    expect(setPricesIncluded(db, a.id, [a1], true)).toBe(1);
    expect(deletePrices(db, a.id, [a2, b1, 99999])).toBe(1);
    expect(listPrices(db, a.id).map((p) => p.id)).toEqual([a1, a3]);
    expect(deletePrices(db, a.id, [a2])).toBe(0); // 이미 휴지통에 있는 자료는 다시 세지 않는다
    expect(listPrices(db, b.id)).toHaveLength(1);
    expect(setPricesIncluded(db, a.id, [], false)).toBe(0);
    // 오늘 다시 확인함: 그 물건의 자료만, 오늘 이미 확인한 것은 건너뛰고, 이전 확인일은 이력에 남는다
    expect(recheckPrices(db, a.id, [a1, a3, b1], "2026-11-20")).toBe(2);
    expect(listPrices(db, a.id).map((p) => p.checkedDate)).toEqual(["2026-11-20", "2026-11-20"]);
    expect(listPrices(db, b.id)[0]!.checkedDate).toBe(TODAY);
    expect(recheckPrices(db, a.id, [a1], "2026-11-20")).toBe(0);
    expect(listPriceHistory(db, a.id).get(a1)!.map((h) => h.checkedDate)).toEqual([TODAY]);
    expect(deletePrices(db, a.id, [])).toBe(0);
  });
});

describe("물건 목록 정렬", () => {
  it("이름순·등록순·최근에 고친 순", () => {
    const b = createItem(db, false, { ...input("나 게임기"), identifier: "N-1" });
    const a = createItem(db, false, { ...input("가 게임기"), identifier: "G-1" });
    const c = createItem(db, false, { ...input("다 게임기"), identifier: "D-1" });
    expect(listItems(db, false, { sort: "name" }).map((r) => r.item.id)).toEqual([a, b, c]);
    expect(listItems(db, false, { sort: "registered" }).map((r) => r.item.id)).toEqual([c, a, b]);
    db.run(sql`update items set updated_at = '2030-01-01 00:00:00' where id = ${b}`);
    expect(listItems(db, false, { sort: "updated" }).map((r) => r.item.id)[0]).toBe(b);
    expect(listItems(db, false).map((r) => r.item.id)[0]).toBe(b); // 기본은 최근에 고친 순
  });
});

describe("물건 상태 빠른 변경", () => {
  it("보유 중과 판매 중 사이에서만 바꾸고, 판매 결과가 있는 물건은 바꾸지 않는다", () => {
    const id = createItem(db, false, input("게임기"));
    expect(setItemStatus(db, false, id, "LISTED")).toBe(true);
    expect(getItem(db, false, id)!.status).toBe("LISTED");
    expect(setItemStatus(db, true, id, "OWNED")).toBe(false); // 다른 모드
    upsertSaleResult(db, false, id, { channel: "가", soldDate: TODAY, amount: 1000, costTotal: null, minutesSpent: null, memo: null });
    expect(getItem(db, false, id)!.status).toBe("SOLD");
    expect(setItemStatus(db, false, id, "OWNED")).toBe(false);
    expect(getItem(db, false, id)!.status).toBe("SOLD");
    const trashedId = createItem(db, false, { ...input("버린 게임기"), identifier: "T-1" });
    trashItem(db, false, trashedId);
    expect(setItemStatus(db, false, trashedId, "LISTED")).toBe(false); // 휴지통의 물건
  });
});

describe("이전·다음 물건", () => {
  it("등록 순서로 이웃을 찾고, 휴지통과 다른 모드의 물건은 건너뛴다", () => {
    const a = createItem(db, false, { ...input("가"), identifier: "1" });
    const demo = createItem(db, true, { ...input("데모"), identifier: "d" });
    const b = createItem(db, false, { ...input("나"), identifier: "2" });
    const c = createItem(db, false, { ...input("다"), identifier: "3" });
    expect(adjacentItems(db, false, b)).toEqual({ prev: { id: a, name: "가" }, next: { id: c, name: "다" } });
    expect(adjacentItems(db, false, a)).toEqual({ prev: null, next: { id: b, name: "나" } });
    expect(adjacentItems(db, true, demo)).toEqual({ prev: null, next: null });
    trashItem(db, false, b);
    expect(adjacentItems(db, false, a).next).toEqual({ id: c, name: "다" });
    expect(adjacentItems(db, false, c).prev).toEqual({ id: a, name: "가" });
  });
});

describe("같은 식별자로 전에 판 기록", () => {
  it("카테고리와 식별자(대소문자·공백 무시)가 같은 다른 물건의 판매 결과만, 최근 것부터", () => {
    const now = createItem(db, false, { ...input("지금 게임기"), identifier: "abc 1" });
    const a = createItem(db, false, { ...input("전에 판 게임기 1"), identifier: "ABC-1".replace("-", "") });
    const b = createItem(db, false, { ...input("전에 판 게임기 2"), identifier: "ABC1" });
    const notSold = createItem(db, false, { ...input("안 판 게임기"), identifier: "ABC1" });
    const otherCat = createItem(db, false, { ...input("책"), category: "BOOK", identifier: "ABC1" });
    const other = createItem(db, false, { ...input("다른 모델"), identifier: "XYZ" });
    const demo = createItem(db, true, { ...input("데모"), identifier: "ABC1" });
    const sell = (id: number, soldDate: string, amount: number, isDemo = false) =>
      upsertSaleResult(db, isDemo, id, { channel: "가 장터", soldDate, amount, costTotal: 1000, minutesSpent: null, memo: null });
    sell(a, "2026-10-01", 20000);
    sell(b, "2026-11-01", 18000);
    sell(otherCat, "2026-11-02", 5000);
    sell(other, "2026-11-03", 9000);
    sell(demo, "2026-11-04", 1000, true);
    void notSold;
    const item = getItem(db, false, now)!;
    expect(listPastSalesForSameIdentifier(db, false, item).map((r) => [r.itemId, r.amount, r.soldDate])).toEqual([
      [b, 18000, "2026-11-01"],
      [a, 20000, "2026-10-01"],
    ]);
    // 자기 자신은 빠지고, 휴지통의 물건도 빠진다
    expect(listPastSalesForSameIdentifier(db, false, getItem(db, false, b)!).map((r) => r.itemId)).toEqual([a]);
    trashItem(db, false, a);
    expect(listPastSalesForSameIdentifier(db, false, item).map((r) => r.itemId)).toEqual([b]);
    // 식별자가 없으면 찾지 않는다
    expect(listPastSalesForSameIdentifier(db, false, { id: 999, category: "CONSOLE", identifier: null })).toEqual([]);
    expect(listPastSalesForSameIdentifier(db, false, { id: 999, category: "CONSOLE", identifier: "  " })).toEqual([]);
    // 가격 자료로 들어가지 않는다
    expect(listPrices(db, now)).toHaveLength(0);
  });
});

describe("물건 검색", () => {
  it("이름·식별자·저자·출판사·구성품·하자·메모에서 찾고, %·_는 글자로만 본다", () => {
    const a = createItem(db, false, { ...input("게임기"), identifier: "G-1", components: "본체, 충전 독", memo: "책상 서랍" });
    const b = createItem(db, false, { ...input("책"), category: "BOOK", identifier: null, publisher: "가나출판", defects: "표지 얼룩" });
    const find = (q: string) => listItems(db, false, { q }).map((r) => r.item.id).sort();
    expect(find("충전 독")).toEqual([a]);
    expect(find("서랍")).toEqual([a]);
    expect(find("가나출판")).toEqual([b]);
    expect(find("얼룩")).toEqual([b]);
    expect(find("%")).toEqual([a, b].sort()); // %는 지워져 빈 검색어처럼 모두 찾는다
    expect(find("없는말")).toEqual([]);
    // 가져오기 API용 검색은 메모·하자·구성품을 찾지 않는다
    expect(listItems(db, false, { q: "서랍", basicSearch: true })).toHaveLength(0);
    expect(listItems(db, false, { q: "G-1", basicSearch: true }).map((r) => r.item.id)).toEqual([a]);
    trashItem(db, false, a);
    expect(find("서랍")).toEqual([]);
  });
});

describe("가격 자료 휴지통", () => {
  const priceInput = (ext: string, amount = "12000") => {
    const p = validatePriceInput({ priceType: "ASKING", amount, sourceName: "장터", checkedDate: TODAY, externalId: ext }, { route: "MANUAL", today: TODAY });
    if (!p.ok) throw new Error("price");
    return p.value;
  };

  it("지운 자료는 비교·점검·내보내기에서 빠지고, 되살리면 이력과 함께 돌아온다", () => {
    const id = createItem(db, false, input("가"));
    const item = getItem(db, false, id)!;
    const r1 = insertPrice(db, item, priceInput("t-1"), "MANUAL");
    const r2 = insertPrice(db, item, priceInput("t-2"), "MANUAL");
    if (!r1.ok || !r2.ok) throw new Error("insert");
    recheckPrices(db, id, [r1.id], "2026-11-20");
    upsertScenario(db, id, "DIRECT", { ...scenario, basisPriceRecordId: r1.id, basisPriceType: "ASKING" });

    expect(deletePrices(db, id, [r1.id])).toBe(1);
    expect(listPrices(db, id).map((p) => p.id)).toEqual([r2.id]);
    expect(exportRows(db, false).map((p) => p.externalId)).toEqual(["t-2"]);
    expect(listCheckupSources(db, false)[0]!.prices.map((p) => p.id)).toEqual([r2.id]);
    expect(listFullExportSources(db, false)[0]!.prices.map((p) => p.id)).toEqual([r2.id]);
    expect(listTriageCandidates(db, false)[0]!.basisRecords).toEqual([]); // 기준 자료가 사라진 것으로 본다
    expect(listItems(db, false)[0]!.priceCount).toBe(1);
    expect(countTrashedPrices(db, false)).toBe(1);
    expect(countTrashedPrices(db, false, id)).toBe(1);
    expect(countTrashedPrices(db, true)).toBe(0); // 데모 모드에는 보이지 않는다
    expect(listTrashedPrices(db, false).map((r) => [r.p.id, r.itemName])).toEqual([[r1.id, "가"]]);
    // 휴지통의 자료는 고치거나 다시 확인할 수 없다
    expect(recheckPrices(db, id, [r1.id], "2026-11-21")).toBe(0);
    setPricesIncluded(db, id, [r1.id], false);

    expect(restorePrice(db, true, r1.id)).toBeNull(); // 다른 모드에서는 되살릴 수 없다
    expect(restorePrice(db, false, r1.id)).toBe(id);
    const back = listPrices(db, id).find((p) => p.id === r1.id)!;
    expect(back.includedInComparison).toBe(true);
    expect(back.checkedDate).toBe("2026-11-20");
    expect(listPriceHistory(db, id).get(r1.id)!.map((h) => h.checkedDate)).toEqual([TODAY]);
    expect(listTriageCandidates(db, false)[0]!.basisRecords.map((p) => p.id)).toEqual([r1.id]);
    expect(restorePrice(db, false, r1.id)).toBeNull(); // 이미 살아 있음
  });

  it("휴지통에 있는 매물과 같은 매물은 다시 넣을 수 없다(되살릴 때 중복이 생기지 않게)", () => {
    const id = createItem(db, false, input("가"));
    const item = getItem(db, false, id)!;
    const r1 = insertPrice(db, item, priceInput("dup-1"), "MANUAL");
    const r2 = insertPrice(db, item, priceInput("dup-2"), "MANUAL");
    if (!r1.ok || !r2.ok) throw new Error("insert");
    deletePrices(db, id, [r1.id]);
    expect(insertPrice(db, item, priceInput("dup-1", "9000"), "MANUAL")).toEqual({ ok: false, reason: "DUPLICATE", inTrash: true });
    expect(insertPrice(db, item, priceInput("dup-2"), "MANUAL")).toEqual({ ok: false, reason: "DUPLICATE", inTrash: false });
    // 살아 있는 자료를 휴지통의 매물과 같게 고칠 수도 없다
    expect(updatePrice(db, item, r2.id, priceInput("dup-1"))).toEqual({ ok: false, reason: "DUPLICATE", inTrash: true });
    // 완전히 지우면 다시 넣을 수 있다
    purgePrice(db, false, r1.id);
    expect(insertPrice(db, item, priceInput("dup-1", "9000"), "MANUAL").ok).toBe(true);
  });

  it("물건이 휴지통에 있으면 그 물건의 가격 자료는 따로 보이거나 되살아나지 않고, 휴지통 비우기는 둘 다 지운다", () => {
    const a = createItem(db, false, input("가"));
    const b = createItem(db, false, { ...input("나"), identifier: "B-1" });
    const pa = insertPrice(db, getItem(db, false, a)!, priceInput("e-a"), "MANUAL");
    const pb = insertPrice(db, getItem(db, false, b)!, priceInput("e-b"), "MANUAL");
    if (!pa.ok || !pb.ok) throw new Error("insert");
    deletePrices(db, a, [pa.id]);
    deletePrices(db, b, [pb.id]);
    trashItem(db, false, b);
    expect(listTrashedPrices(db, false).map((r) => r.p.id)).toEqual([pa.id]);
    expect(countTrashedPrices(db, false)).toBe(1);
    expect(restorePrice(db, false, pb.id)).toBeNull();
    expect(purgePrice(db, false, pa.id)).toBeUndefined();
    deletePrices(db, a, []);
    const pa2 = insertPrice(db, getItem(db, false, a)!, priceInput("e-a2"), "MANUAL");
    if (!pa2.ok) throw new Error("insert");
    deletePrices(db, a, [pa2.id]);
    expect(emptyTrash(db, false)).toBe(1);
    expect(countTrashedPrices(db, false)).toBe(0);
    expect(listPricesAll(a)).toEqual([]);
  });

  const listPricesAll = (itemId: number) => db.all(sql`select id from price_records where item_id = ${itemId}`);
});

describe("출처 이름 제안", () => {
  it("현재 모드의 살아 있는 자료에 쓴 출처를 많이 쓴 순으로, 휴지통·다른 모드·휴지통 물건은 빼고", () => {
    const a = getItem(db, false, createItem(db, false, input("가")))!;
    const b = getItem(db, false, createItem(db, false, { ...input("나"), identifier: "B-1" }))!;
    const demo = getItem(db, true, createItem(db, true, { ...input("데모"), identifier: "D-1" }))!;
    const add = (item: typeof a, source: string, ext: string) => {
      const p = validatePriceInput({ priceType: "ASKING", amount: "1000", sourceName: source, checkedDate: TODAY, externalId: ext }, { route: "MANUAL", today: TODAY });
      if (!p.ok) throw new Error("price");
      const r = insertPrice(db, item, p.value, "MANUAL");
      if (!r.ok) throw new Error("insert");
      return r.id;
    };
    add(a, "나 장터", "1");
    add(a, "가 장터", "2");
    add(b, "나 장터", "3");
    const trashedId = add(a, "버린 장터", "4");
    add(b, "휴지통 물건 장터", "5");
    add(demo, "데모 장터", "6");
    deletePrices(db, a.id, [trashedId]);
    const c = getItem(db, false, createItem(db, false, { ...input("다"), identifier: "C-1" }))!;
    add(c, "휴지통 물건 장터2", "7");
    trashItem(db, false, c.id);
    expect(listSourceNames(db, false)).toEqual(["나 장터", "가 장터", "휴지통 물건 장터"]);
    expect(listSourceNames(db, true)).toEqual(["데모 장터"]);
    expect(listSourceNames(db, false, 1)).toEqual(["나 장터"]);
  });
});

describe("물건 한꺼번에 다루기", () => {
  it("판매 중·보유 중 표시는 판매 완료를 건너뛰고, 휴지통 이동은 현재 모드의 살아 있는 물건만", () => {
    const a = createItem(db, false, input("가"));
    const b = createItem(db, false, { ...input("나"), identifier: "B-1" });
    const sold = fullItem("판 물건", true);
    const demo = createItem(db, true, { ...input("데모"), identifier: "D-1" });
    expect(bulkItems(db, false, [a, b, sold, demo, 99999], "LISTED")).toEqual({ done: 2, skipped: 3 });
    expect([a, b].map((id) => getItem(db, false, id)!.status)).toEqual(["LISTED", "LISTED"]);
    expect(getItem(db, false, sold)!.status).toBe("SOLD");
    expect(getItem(db, true, demo)!.status).toBe("OWNED");
    expect(bulkItems(db, false, [a], "OWNED")).toEqual({ done: 1, skipped: 0 });
    expect(getItem(db, false, a)!.status).toBe("OWNED");
    expect(bulkItems(db, false, [a, sold, demo], "TRASH")).toEqual({ done: 2, skipped: 1 });
    expect(listTrashedItems(db, false).map((r) => r.item.id).sort()).toEqual([a, sold].sort());
    expect(getItem(db, true, demo)).toBeDefined();
    expect(bulkItems(db, false, [a], "TRASH")).toEqual({ done: 0, skipped: 1 }); // 이미 휴지통
  });
});
