import { describe, expect, it } from "vitest";
import { buildComparison } from "@/lib/domain/compare";
import { isLoopbackHost } from "@/lib/host";
import { basisIssues, isChoiceOutdated } from "@/lib/domain/scenario";

const TODAY = "2026-11-11";

describe("localhost 전용 접근", () => {
  it("루프백 Host만 허용한다(포트 무관)", () => {
    for (const h of ["127.0.0.1:3000", "localhost", "LOCALHOST:3217", "[::1]:3000", "app.localhost:3000"]) {
      expect(isLoopbackHost(h), h).toBe(true);
    }
  });
  it("DNS 리바인딩에 쓰이는 외부 도메인·우회 표기를 거부한다", () => {
    for (const h of [
      "evil.example",
      "evil.example:3000",
      "127.0.0.1.nip.io",
      "localhost.evil.example",
      "192.168.0.10:3000",
      "0.0.0.0:3000",
      "[::1].evil.example",
      "",
      null,
      undefined,
    ]) {
      expect(isLoopbackHost(h), String(h)).toBe(false);
    }
  });
});

describe("저장된 계산의 기준 자료 확인", () => {
  const sc = { saleAmount: 7000, basisPriceRecordId: 5, basisPriceType: "BUYBACK_QUOTE" as const };
  const basis = { amountMinor: 7000, currency: "KRW" as const, priceType: "BUYBACK_QUOTE" as const, quoteValidUntil: "2026-11-20" };

  it("직접 입력한 금액이면 확인할 기준 자료가 없다", () => {
    expect(basisIssues({ saleAmount: 7000, basisPriceRecordId: null, basisPriceType: null }, undefined, TODAY)).toEqual([]);
  });
  it("기준 자료가 그대로면 문제 없음", () => {
    expect(basisIssues(sc, basis, TODAY)).toEqual([]);
  });
  it("기준 자료가 삭제되면(id가 비고 유형 스냅샷만 남음) 알린다", () => {
    expect(basisIssues({ ...sc, basisPriceRecordId: null }, undefined, TODAY)).toEqual(["BASIS_DELETED"]);
    expect(basisIssues(sc, undefined, TODAY)).toEqual(["BASIS_DELETED"]);
  });
  it("기준 자료 금액이 바뀌면 저장된 금액을 그대로 믿지 않는다", () => {
    expect(basisIssues(sc, { ...basis, amountMinor: 6000 }, TODAY)).toEqual(["BASIS_AMOUNT_CHANGED"]);
  });
  it("기준 자료가 외화로 바뀌거나 견적이 만료되면 알린다", () => {
    expect(basisIssues(sc, { ...basis, currency: "USD" }, TODAY)).toEqual(["BASIS_NOT_KRW"]);
    expect(basisIssues(sc, { ...basis, quoteValidUntil: "2026-11-10" }, TODAY)).toEqual(["BASIS_EXPIRED"]);
  });
});

describe("판매 방법 선택 후 계산이 바뀐 경우", () => {
  const scenario = {
    method: "DIRECT",
    saleAmount: 19000,
    feeMode: "AMOUNT" as const,
    feeAmount: 0,
    feeRateBp: null,
    shipping: 3500,
    packing: 500,
    transport: 0,
  };
  it("선택 당시와 금액·실수령액이 같으면 그대로다", () => {
    expect(isChoiceOutdated({ chosenMethod: "DIRECT", chosenSaleAmount: 19000, chosenNetAmount: 15000 }, scenario)).toBe(false);
  });
  it("비용이 바뀌어 실수령액이 달라지면 알린다", () => {
    expect(
      isChoiceOutdated({ chosenMethod: "DIRECT", chosenSaleAmount: 19000, chosenNetAmount: 15000 }, { ...scenario, shipping: 4000 }),
    ).toBe(true);
  });
  it("선택 당시 불완전(null)이었는데 지금 계산이 완전해져도 알린다", () => {
    expect(isChoiceOutdated({ chosenMethod: "DIRECT", chosenSaleAmount: 19000, chosenNetAmount: null }, scenario)).toBe(true);
  });
  it("선택하지 않았으면 해당 없음", () => {
    expect(isChoiceOutdated({ chosenMethod: null, chosenSaleAmount: null, chosenNetAmount: null }, undefined)).toBe(false);
  });
});

describe("오래된 자료 표시", () => {
  const item = { identifier: null, condition: "GOOD" as const };
  const rec = (checkedDate: string) => ({
    id: 1,
    priceType: "ASKING" as const,
    amountMinor: 10000,
    currency: "KRW" as const,
    checkedDate,
    productIdentifier: null,
    condition: "GOOD" as const,
    bundleType: "SINGLE" as const,
    quoteValidUntil: null,
    includedInComparison: true,
  });
  it("90일이 넘은 자료는 기간 안이면 포함하되 '오래됨' 경고를 붙인다", () => {
    const c = buildComparison(item, [rec("2026-08-12"), rec("2026-08-13")], TODAY, 180);
    const [older, newer] = c.groups[0]!.eligible;
    expect(older!.warnings).toContain("OLD_DATA");
    expect(newer!.warnings).not.toContain("OLD_DATA");
  });
  it("기간 밖이면 경고 대신 제외한다", () => {
    const c = buildComparison(item, [rec("2026-01-01")], TODAY, 180);
    expect(c.groups[0]!.excluded[0]!.exclusions).toEqual(["OUT_OF_WINDOW"]);
    expect(c.groups[0]!.excluded[0]!.warnings).not.toContain("OLD_DATA");
  });
});
