import { describe, expect, it } from "vitest";
import { buildComparison, type ComparableRecord } from "@/lib/domain/compare";
import { buildPriceStrip, niceStep, shortWon } from "@/lib/domain/price-strip";

const TODAY = "2026-11-27";
const item = { identifier: null, condition: "GOOD" as const };
let nextId = 1;
const rec = (o: Partial<ComparableRecord>): ComparableRecord => ({
  id: nextId++,
  priceType: "ASKING",
  amountMinor: 10000,
  currency: "KRW",
  checkedDate: TODAY,
  productIdentifier: null,
  condition: "GOOD",
  bundleType: "SINGLE",
  componentsMatch: "UNKNOWN",
  quoteValidUntil: null,
  includedInComparison: true,
  ...o,
});

describe("가격 자료 분포 그림", () => {
  it("눈금 간격은 1·2·5 × 10^k", () => {
    expect(niceStep(27000)).toBe(10000);
    expect(niceStep(9000)).toBe(2000);
    expect(niceStep(400)).toBe(100);
    expect(niceStep(3000, 5)).toBe(1000);
  });

  it("눈금 금액은 짧게 쓴다", () => {
    expect([0, 500, 2000, 2500, 10000, 15000, 120000, 1000000].map(shortWon)).toEqual(["0", "500", "2천", "2.5천", "1만", "1.5만", "12만", "100만"]);
  });

  it("원화 자료가 2건 미만이면 그리지 않는다", () => {
    expect(buildPriceStrip(buildComparison(item, [], TODAY, null))).toBeNull();
    expect(buildPriceStrip(buildComparison(item, [rec({ amountMinor: 15000 })], TODAY, null))).toBeNull();
    // 외화 자료는 축에 놓지 않으므로 원화 1건 + 외화 1건도 그리지 않는다
    expect(buildPriceStrip(buildComparison(item, [rec({}), rec({ currency: "USD", amountMinor: 1500 })], TODAY, null))).toBeNull();
  });

  it("유형마다 줄을 따로 두고, 같은 축에서 0~1 위치를 준다(섞지 않음)", () => {
    const records = [
      rec({ amountMinor: 18000 }),
      rec({ amountMinor: 20000 }),
      rec({ amountMinor: 24000 }),
      rec({ amountMinor: 45000, bundleType: "BUNDLE" }), // 제외(묶음)
      rec({ priceType: "BUYBACK_QUOTE", amountMinor: 7500 }),
      rec({ priceType: "ASKING", currency: "USD", amountMinor: 1500 }), // 외화: 그림에서 빠짐
    ];
    const s = buildPriceStrip(buildComparison(item, records, TODAY, null))!;
    expect(s.rows.map((r) => r.priceType)).toEqual(["ASKING", "BUYBACK_QUOTE"]);
    expect(s.omittedForeign).toBe(1);
    expect(s.lo).toBe(0);
    expect(s.hi).toBe(50000);
    expect(s.ticks.map((t) => t.amount)).toEqual([0, 10000, 20000, 30000, 40000, 50000]);
    const asking = s.rows[0]!;
    expect(asking.points.map((p) => [p.amount, p.eligible])).toEqual([
      [18000, true],
      [20000, true],
      [24000, true],
      [45000, false],
    ]);
    expect(asking.points.map((p) => p.x)).toEqual([0.36, 0.4, 0.48, 0.9]);
    expect(asking.eligibleCount).toBe(3);
    // 중앙값은 비교 요약과 같은 값(적합 3건 이상)
    expect(asking.median).toEqual({ amount: 20000, x: 0.4 });
    expect(s.rows[1]!.median).toBeNull();
    for (const r of s.rows) {
      for (const p of r.points) {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(1);
      }
    }
  });

  it("제외된 자료 숨기기를 따르고, 내 계산 금액·손익분기는 축 범위에 넣는다", () => {
    const records = [rec({ amountMinor: 20000 }), rec({ amountMinor: 22000 }), rec({ amountMinor: 90000, includedInComparison: false })];
    const hidden = buildPriceStrip(buildComparison(item, records, TODAY, null), { hideExcluded: true, saleAmount: 25000, breakEven: 12000 })!;
    expect(hidden.rows[0]!.points.map((p) => p.amount)).toEqual([20000, 22000]);
    expect(hidden.markers.map((m) => [m.key, m.amount])).toEqual([
      ["SALE", 25000],
      ["BREAK_EVEN", 12000],
    ]);
    expect(hidden.lo).toBeLessThanOrEqual(12000);
    expect(hidden.hi).toBeGreaterThanOrEqual(25000);
    for (const m of hidden.markers) {
      expect(m.x).toBeGreaterThanOrEqual(0);
      expect(m.x).toBeLessThanOrEqual(1);
    }
  });

  it("같거나 거의 같은 금액의 점은 다른 칸에 놓아 가려지지 않게 한다", () => {
    const s = buildPriceStrip(
      buildComparison(item, [rec({ amountMinor: 20000 }), rec({ amountMinor: 20000 }), rec({ amountMinor: 20000 }), rec({ amountMinor: 20000 }), rec({ amountMinor: 40000 })], TODAY, null),
    )!;
    expect(s.rows[0]!.points.map((p) => p.lane)).toEqual([0, 1, 2, 0, 0]);
  });

  it("모든 금액이 같아도 범위를 넓혀 그린다", () => {
    const s = buildPriceStrip(buildComparison(item, [rec({ amountMinor: 15000 }), rec({ amountMinor: 15000 })], TODAY, null))!;
    expect(s.hi).toBeGreaterThan(s.lo);
    expect(s.rows[0]!.points.every((p) => p.x > 0 && p.x < 1)).toBe(true);
  });
});
