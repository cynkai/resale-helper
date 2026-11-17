import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "@/lib/db/client";
import {
  countTrashedItems,
  createItem,
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
  listPostedPricesByItem,
  listPrices,
  listSaleReviews,
  listTrashedItems,
  listTriageCandidates,
  purgeItem,
  restoreItem,
  trashItem,
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
