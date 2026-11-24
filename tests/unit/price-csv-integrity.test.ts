import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb } from "@/lib/db/client";
import { createItem, deletePrice, getItem, importPrices, insertPrice, listPriceHistory, listPricesForDedup } from "@/lib/db/repo";
import { planCsvImport } from "@/lib/domain/csv";
import { validateItemInput } from "@/lib/domain/item-input";
import { validatePriceInput } from "@/lib/domain/price-input";

const TODAY = "2026-11-24";
const HEADER = "price_type,amount,source_name,checked_date,external_id,source_url";
let connection: ReturnType<typeof openDb>;

beforeEach(() => { connection = openDb(":memory:"); });
afterEach(() => { connection.close(); });

function itemFixture() {
  const input = validateItemInput({ category: "CONSOLE", name: "게임기", condition: "GOOD" });
  if (!input.ok) throw new Error("Invalid item fixture");
  const item = getItem(connection.db, false, createItem(connection.db, false, input.value));
  if (!item) throw new Error("Missing item fixture");
  return item;
}

function csvRow(id: string, url: string) {
  return `ASKING,12000, MARKET ,${TODAY},${id},${url}`;
}

describe("CSV 매물 식별 충돌", () => {
  it.each([
    [false, false], [false, true], [true, false], [true, true],
  ] as const)("저장된 서로 다른 행과 충돌하면 건너뛰고 정상 행만 추가한다 (휴지통 %s, 역순 %s)", (trash, reverse) => {
    // Given
    const { db } = connection;
    const item = itemFixture();
    for (const key of reverse ? ["B", "A"] : ["A", "B"]) {
      const input = validatePriceInput({
        priceType: "ASKING", amount: "10000", sourceName: "Market", checkedDate: TODAY,
        externalId: key, sourceUrl: `https://example.com/${key}`, memo: `original ${key}`,
      }, { route: "MANUAL", today: TODAY });
      if (!input.ok) throw new Error("Invalid price fixture");
      const saved = insertPrice(db, item, input.value, "MANUAL");
      if (!saved.ok) throw new Error("Missing price fixture");
      if (trash && key === "B") deletePrice(db, item.id, saved.id);
    }
    const before = listPricesForDedup(db, item.id);
    const csv = [HEADER, csvRow("A", "https://www.example.com/B/?utm_source=csv"), csvRow("C", "https://example.com/C")].join("\n");

    // When
    const plan = planCsvImport(csv, TODAY, before, item);
    const imported = importPrices(db, item, plan.valid.map(({ value }) => value));

    // Then
    expect(plan.errors).toEqual([{ line: 2, messages: [expect.stringContaining("충돌")] }]);
    expect(plan.valid.map(({ line }) => line)).toEqual([3]);
    expect(imported).toBe(1);
    const after = listPricesForDedup(db, item.id);
    expect(after.filter(({ id }) => before.some((row) => row.id === id))).toEqual(before);
    expect(after.filter(({ externalId }) => externalId === "C")).toMatchObject([{ amountMinor: 12000, inputRoute: "CSV" }]);
    expect(listPriceHistory(db, item.id).size).toBe(0);
  });

  it("같은 파일의 앞선 두 행을 가리키는 충돌도 일반 중복과 구분한다", () => {
    // Given
    const item = itemFixture();
    const csv = [
      HEADER,
      csvRow("A", "https://example.com/A"),
      csvRow("B", "https://example.com/B"),
      csvRow("A", "https://example.com/B"),
      csvRow("B", "https://example.com/B"),
      csvRow("C", "https://example.com/C"),
    ].join("\n");

    // When
    const plan = planCsvImport(csv, TODAY, [], item);

    // Then
    expect(plan.valid.map(({ line }) => line)).toEqual([2, 3, 6]);
    expect(plan.errors).toEqual([
      { line: 4, messages: [expect.stringContaining("충돌")] },
      { line: 5, messages: [expect.stringContaining("중복")] },
    ]);
  });

  it.each([
    ["A", "https://example.com/A"],
    ["A", "https://example.com/new"],
    ["NEW", "https://example.com/A"],
  ])("하나의 기존 행과만 일치하면 일반 중복으로 유지한다 (%s, %s)", (id, url) => {
    // Given
    const item = itemFixture();
    const existing = [{ sourceName: "Market", externalId: "A", normalizedUrl: "example.com/A" }];

    // When
    const plan = planCsvImport([HEADER, csvRow(id, url)].join("\n"), TODAY, existing, item);

    // Then
    expect(plan.valid).toEqual([]);
    expect(plan.errors).toEqual([{ line: 2, messages: [expect.stringContaining("중복")] }]);
  });
});
