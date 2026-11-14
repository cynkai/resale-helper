import { describe, expect, it } from "vitest";
import { checkupItem, countFindings, needsAttention, type CheckupPrice, type CheckupScenario } from "@/lib/domain/checkup";
import { OLD_DATA_DAYS } from "@/lib/domain/compare";

const TODAY = "2026-11-14";
const price = (over: Partial<CheckupPrice> = {}): CheckupPrice => ({
  id: 1,
  priceType: "ASKING",
  amountMinor: 10000,
  currency: "KRW",
  sourceName: "가상장터",
  checkedDate: TODAY,
  quoteValidUntil: null,
  includedInComparison: true,
  ...over,
});
const scenario = (over: Partial<CheckupScenario> = {}): CheckupScenario => ({
  method: "BUYBACK",
  saleAmount: 7000,
  basisPriceRecordId: null,
  basisPriceType: null,
  ...over,
});

describe("자료 점검", () => {
  it("최근에 확인한 자료만 있으면 알릴 것이 없다", () => {
    expect(checkupItem({ prices: [price()], scenarios: [scenario()] }, TODAY)).toEqual([]);
  });

  it("견적은 유효기간이 지났는지와 며칠 남았는지를 날짜로만 알려 준다", () => {
    const f = checkupItem(
      {
        prices: [
          price({ id: 1, priceType: "BUYBACK_QUOTE", amountMinor: 7000, quoteValidUntil: "2026-11-10" }),
          price({ id: 2, priceType: "BUYBACK_QUOTE", amountMinor: 8000, quoteValidUntil: "2026-11-14" }),
          price({ id: 3, priceType: "BUYBACK_QUOTE", amountMinor: 9000, quoteValidUntil: "2026-11-20" }),
          price({ id: 4, priceType: "BUYBACK_QUOTE", quoteValidUntil: null }), // 유효기간 기록 없음 → 알릴 날짜가 없다
          price({ id: 5, priceType: "ASKING", quoteValidUntil: "2026-01-01" }), // 견적이 아니면 만료 개념이 없다
        ],
        scenarios: [],
      },
      TODAY,
    );
    expect(f).toEqual([
      { kind: "QUOTE_EXPIRED", priceId: 1, sourceName: "가상장터", amountMinor: 7000, validUntil: "2026-11-10", daysAgo: 4 },
      { kind: "QUOTE_VALID", priceId: 2, sourceName: "가상장터", amountMinor: 8000, validUntil: "2026-11-14", daysLeft: 0 },
      { kind: "QUOTE_VALID", priceId: 3, sourceName: "가상장터", amountMinor: 9000, validUntil: "2026-11-20", daysLeft: 6 },
    ]);
  });

  it(`확인한 지 ${OLD_DATA_DAYS}일을 넘은 자료는 비교에 포함된 것만 센다`, () => {
    const f = checkupItem(
      {
        prices: [
          price({ id: 1, checkedDate: "2026-08-16" }), // 90일 전 → 아직 아님
          price({ id: 2, checkedDate: "2026-08-15" }), // 91일 전
          price({ id: 3, checkedDate: "2026-05-01" }),
          price({ id: 4, checkedDate: "2025-01-01", includedInComparison: false }), // 직접 뺀 자료는 세지 않는다
        ],
        scenarios: [],
      },
      TODAY,
    );
    expect(f).toEqual([{ kind: "OLD_DATA", count: 2, oldestCheckedDate: "2026-05-01", oldestDays: 197 }]);
  });

  it("기준 자료가 지워지거나 금액이 바뀌거나 만료된 계산을 알려 준다", () => {
    const prices = [price({ id: 9, priceType: "BUYBACK_QUOTE", amountMinor: 6500, quoteValidUntil: "2026-11-01" })];
    const f = checkupItem(
      {
        prices,
        scenarios: [
          scenario({ method: "BUYBACK", saleAmount: 7000, basisPriceRecordId: 9, basisPriceType: "BUYBACK_QUOTE" }),
          scenario({ method: "DIRECT", saleAmount: 15000, basisPriceRecordId: null, basisPriceType: "ASKING" }),
        ],
      },
      TODAY,
    );
    expect(f.filter((x) => x.kind === "BASIS_ISSUE")).toEqual([
      { kind: "BASIS_ISSUE", method: "BUYBACK", issues: ["BASIS_AMOUNT_CHANGED", "BASIS_EXPIRED"] },
      { kind: "BASIS_ISSUE", method: "DIRECT", issues: ["BASIS_DELETED"] },
    ]);
  });

  it("유효기간이 남은 견적만 있으면 '확인 필요'가 아니고, 건수는 종류별로 센다", () => {
    const valid = checkupItem({ prices: [price({ priceType: "BUYBACK_QUOTE", quoteValidUntil: "2026-12-01" })], scenarios: [] }, TODAY);
    expect(needsAttention(valid)).toBe(false);
    const old = checkupItem({ prices: [price({ id: 1, checkedDate: "2026-01-01" }), price({ id: 2, checkedDate: "2026-02-01" })], scenarios: [] }, TODAY);
    expect(needsAttention(old)).toBe(true);
    expect(countFindings([valid, old])).toEqual({ QUOTE_EXPIRED: 0, QUOTE_VALID: 1, OLD_DATA: 2, BASIS_ISSUE: 0 });
  });

  it("금액을 평가하는 내용은 없다", () => {
    const f = checkupItem({ prices: [price({ checkedDate: "2026-01-01" })], scenarios: [] }, TODAY);
    expect(JSON.stringify(f)).not.toMatch(/cheap|expensive|싸|비싸|recommend/i);
  });
});
