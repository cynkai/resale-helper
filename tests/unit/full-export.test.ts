import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "@/lib/db/client";
import { seedDemo } from "@/lib/db/demo-seed";
import {
  createItem,
  getItem,
  insertPrice,
  listFullExportSources,
  setChosenMethod,
  setImportTokenHash,
  upsertSaleResult,
  upsertScenario,
} from "@/lib/db/repo";
import { buildFullExport } from "@/lib/domain/full-export";
import type { ValidItemInput } from "@/lib/domain/item-input";
import { validatePriceInput } from "@/lib/domain/price-input";

const TODAY = "2026-11-14";
const item = (name: string, over: Partial<ValidItemInput> = {}): ValidItemInput => ({
  category: "CONSOLE",
  status: "OWNED",
  name,
  identifier: null,
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
  ...over,
});

let dir: string;
let db: Db;
let close: () => void;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "resale-export-"));
  ({ db, close } = openDb(path.join(dir, "t.db")));
});
afterEach(() => {
  try {
    close();
  } catch {}
  fs.rmSync(dir, { recursive: true, force: true });
});

function addPrice(itemId: number, raw: Record<string, string>) {
  const v = validatePriceInput({ sourceName: "가상장터", checkedDate: TODAY, ...raw }, { route: "MANUAL", today: TODAY });
  if (!v.ok) throw new Error(JSON.stringify(v.errors));
  const r = insertPrice(db, getItem(db, false, itemId)!, v.value, "MANUAL");
  if (!r.ok) throw new Error("dup");
  return r.id;
}

describe("전체 내보내기", () => {
  it("물건마다 가격 자료·계산·선택·판매 결과를 묶고, 모름은 null로 둔다", () => {
    const id = createItem(db, false, item("가상 게임기"));
    const basis = addPrice(id, { priceType: "ASKING", amount: "100000", externalId: "a1" });
    addPrice(id, { priceType: "BUYBACK_QUOTE", amount: "60000", memo: "방문 견적" });
    upsertScenario(db, id, "DIRECT", {
      saleAmount: 100000,
      basisPriceRecordId: basis,
      basisPriceType: "ASKING",
      feeMode: "AMOUNT",
      feeAmount: 0,
      feeRateBp: null,
      shipping: 4000,
      packing: null, // 모름
      transport: 0,
      expectedMinutes: 120,
      memo: null,
    });
    upsertScenario(db, id, "BUYBACK", {
      saleAmount: 60000,
      basisPriceRecordId: null,
      basisPriceType: null,
      feeMode: "AMOUNT",
      feeAmount: 0,
      feeRateBp: null,
      shipping: 0,
      packing: 0,
      transport: 2000,
      expectedMinutes: 30,
      memo: null,
    });
    setChosenMethod(db, false, id, { method: "BUYBACK", saleAmount: 60000, netAmount: 58000 });
    upsertSaleResult(db, false, id, { channel: "가상매입점", soldDate: TODAY, amount: 59000, costTotal: null, minutesSpent: 40, memo: null });

    const out = buildFullExport({ demo: false, exportedDate: TODAY, sources: listFullExportSources(db, false) });
    expect(out).toMatchObject({ format: "resale-helper-export", version: 1, mode: "REAL", itemCount: 1 });
    const it0 = out.items[0]!;
    expect(it0.status).toBe("SOLD");
    expect(it0.book).toBeNull();
    expect(it0.prices.map((p) => [p.priceType, p.amount])).toEqual([
      ["ASKING", 100000],
      ["BUYBACK_QUOTE", 60000],
    ]);
    const direct = it0.scenarios.find((s) => s.method === "DIRECT")!;
    expect(direct.packing).toBeNull();
    expect(direct.computed).toEqual({ fee: 0, complete: false, missing: ["packing"], net: null });
    expect(it0.scenarios.find((s) => s.method === "BUYBACK")!.computed.net).toBe(58000);
    expect(it0.chosen).toMatchObject({ method: "BUYBACK", saleAmount: 60000, netAmount: 58000 });
    expect(it0.saleResult).toMatchObject({ amount: 59000, costTotal: null, minutesSpent: 40 });
    expect(it0.saleResult!.review).toEqual({ actualNet: null, saleDiff: -1000, netDiff: null, minutesDiff: 10, outcome: "UNKNOWN" });
  });

  it("물건을 가로지르는 합계 칸이 없다", () => {
    createItem(db, false, item("가"));
    createItem(db, false, item("나"));
    const out = buildFullExport({ demo: false, exportedDate: TODAY, sources: listFullExportSources(db, false) });
    expect(Object.keys(out).sort()).toEqual(["exportedDate", "format", "itemCount", "items", "mode", "notes", "version"]);
    expect(JSON.stringify(Object.keys(out))).not.toMatch(/total|sum|합계/i);
  });

  it("데모와 실제 자료를 섞지 않고, 데모에는 가상 자료라는 안내가 붙는다", () => {
    const realId = createItem(db, false, item("실제 물건"));
    seedDemo(db, TODAY);
    const real = buildFullExport({ demo: false, exportedDate: TODAY, sources: listFullExportSources(db, false) });
    expect(real.items.map((i) => i.id)).toEqual([realId]);
    expect(real.notes.join(" ")).not.toMatch(/데모/);
    const demo = buildFullExport({ demo: true, exportedDate: TODAY, sources: listFullExportSources(db, true) });
    expect(demo.mode).toBe("DEMO");
    expect(demo.items.length).toBeGreaterThan(0);
    expect(demo.items.some((i) => i.id === realId)).toBe(false);
    expect(demo.notes.join(" ")).toMatch(/가상 자료/);
  });

  it("도서는 도서 전용 항목을 싣고, 설정(토큰 해시)은 싣지 않는다", () => {
    setImportTokenHash(db, "f".repeat(64));
    createItem(db, false, item("가상 책", { category: "BOOK", identifier: "9780306406157", author: "가상 저자", hasWriting: "NO" }));
    const out = buildFullExport({ demo: false, exportedDate: TODAY, sources: listFullExportSources(db, false) });
    expect(out.items[0]!.book).toMatchObject({ author: "가상 저자", hasWriting: "NO", hasUnderline: "UNKNOWN" });
    expect(JSON.stringify(out)).not.toContain("f".repeat(64));
    expect(JSON.stringify(out)).not.toMatch(/token/i);
  });

  it("물건이 없으면 빈 목록", () => {
    const out = buildFullExport({ demo: false, exportedDate: TODAY, sources: listFullExportSources(db, false) });
    expect(out).toMatchObject({ itemCount: 0, items: [] });
  });
});
