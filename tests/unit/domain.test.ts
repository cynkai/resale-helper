import { describe, expect, it } from "vitest";
import { buildComparison, isSameListing, type ComparableRecord } from "@/lib/domain/compare";
import { normalizeIdentifier, normalizeIsbn } from "@/lib/domain/isbn";
import { nextStep } from "@/lib/domain/next-step";
import { buildListingDraft } from "@/lib/domain/listing";
import { feeFromRate, formatMoney, medianInt, parseAmount, parsePercentToBp } from "@/lib/domain/money";
import { computeNet, netDifference } from "@/lib/domain/net";
import { validatePriceInput } from "@/lib/domain/price-input";
import { normalizeUrl } from "@/lib/domain/url";

const TODAY = "2026-11-11";

describe("ISBN", () => {
  it("유효한 ISBN-13은 하이픈·공백을 제거해 그대로 정규화한다", () => {
    expect(normalizeIsbn("978-0-306-40615-7")).toEqual({ ok: true, isbn13: "9780306406157", inputKind: "ISBN13" });
    expect(normalizeIsbn(" 979 11 0000 001 7 ").ok).toBe(false); // 체크섬 오류
  });
  it("유효한 ISBN-10은 ISBN-13으로 변환한다(X 체크숫자 포함)", () => {
    expect(normalizeIsbn("0-306-40615-2")).toMatchObject({ ok: true, isbn13: "9780306406157", inputKind: "ISBN10" });
    expect(normalizeIsbn("080442957x")).toMatchObject({ ok: true, isbn13: "9780804429573" });
  });
  it("체크섬·길이·접두어 오류를 거부한다", () => {
    expect(normalizeIsbn("9780306406158").ok).toBe(false);
    expect(normalizeIsbn("0306406153").ok).toBe(false);
    expect(normalizeIsbn("12345").ok).toBe(false);
    expect(normalizeIsbn("1234567890128").ok).toBe(false); // 978/979 아님
    expect(normalizeIsbn("").ok).toBe(false);
    expect(normalizeIsbn("97803064061X7").ok).toBe(false);
  });
  it("ISBN-10과 ISBN-13 표기가 달라도 같은 책으로 식별한다", () => {
    expect(normalizeIdentifier("0-306-40615-2")).toBe(normalizeIdentifier("9780306406157"));
    expect(normalizeIdentifier("hac-001 ")).toBe("HAC001");
    expect(normalizeIdentifier("  ")).toBeNull();
  });
});

describe("금액 파싱과 반올림", () => {
  it("KRW는 정수만, USD는 소수 둘째 자리까지 최소단위 정수로 바꾼다", () => {
    expect(parseAmount("12,000", "KRW")).toEqual({ ok: true, minor: 12000 });
    expect(parseAmount("12000.5", "KRW").ok).toBe(false);
    expect(parseAmount("12.5", "USD")).toEqual({ ok: true, minor: 1250 });
    expect(parseAmount("0.07", "USD")).toEqual({ ok: true, minor: 7 });
    expect(parseAmount("12.345", "USD").ok).toBe(false);
  });
  it("음수·지수 표기·빈 값·문자를 거부한다", () => {
    for (const bad of ["-100", "1e5", "", "만원", "12 000원쯤"]) expect(parseAmount(bad, "KRW").ok).toBe(false);
  });
  it("수수료율 적용은 원 미만 half-up 반올림", () => {
    expect(feeFromRate(10000, 350)).toBe(350); // 3.5%
    expect(feeFromRate(12345, 350)).toBe(432); // 432.075 → 432
    expect(feeFromRate(15, 1000)).toBe(2); // 1.5 → 2 (half-up)
    expect(feeFromRate(14, 1000)).toBe(1); // 1.4 → 1
    expect(feeFromRate(33333, 333)).toBe(1110); // 1109.9889 → 1110
  });
  it("백분율 문자열을 만분율로 정확히 변환한다", () => {
    expect(parsePercentToBp("3.5")).toEqual({ ok: true, bp: 350 });
    expect(parsePercentToBp("0")).toEqual({ ok: true, bp: 0 });
    expect(parsePercentToBp("100.01").ok).toBe(false);
    expect(parsePercentToBp("3.555").ok).toBe(false);
  });
  it("중앙값: 짝수 건은 가운데 두 값 평균을 half-up 반올림", () => {
    expect(medianInt([3, 1, 2])).toBe(2);
    expect(medianInt([10000, 10001])).toBe(10001); // 10000.5 → 10001
    expect(medianInt([10000, 20000, 30000, 40000])).toBe(25000);
  });
  it("외화는 원화로 환산하지 않고 원래 통화로 표시한다", () => {
    expect(formatMoney(1250, "USD")).toBe("USD 12.50");
    expect(formatMoney(1234567)).toBe("1,234,567원");
  });
});

describe("가격 입력 검증", () => {
  const base = {
    priceType: "ASKING",
    amount: "15000",
    sourceName: "어느 장터",
    checkedDate: "2026-11-01",
  };
  it("직접 입력은 VERIFIED_SALE로 저장할 수 없다", () => {
    const r = validatePriceInput({ ...base, priceType: "VERIFIED_SALE" }, { route: "MANUAL", today: TODAY });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.priceType).toContain("검증된 체결가");
  });
  it("CSV도 VERIFIED_SALE로 저장할 수 없고, URL·검증 방법·증명 플래그를 넣어도 승격되지 않는다", () => {
    const r = validatePriceInput(
      {
        ...base,
        priceType: "verified_sale",
        sourceUrl: "https://example.com/sold/1",
        verificationMethod: "판매완료 캡처 있음",
      },
      { route: "CSV", today: TODAY, providerAttestsVerifiedSales: true },
    );
    expect(r.ok).toBe(false);
  });
  it("API 경로도 제공자의 체결가 제공이 확인되지 않으면 VERIFIED_SALE을 거부한다", () => {
    const raw = { ...base, priceType: "VERIFIED_SALE", verificationMethod: "제공자 문서" };
    expect(validatePriceInput(raw, { route: "API", today: TODAY }).ok).toBe(false);
    expect(validatePriceInput(raw, { route: "API", today: TODAY, providerAttestsVerifiedSales: true }).ok).toBe(true);
    expect(
      validatePriceInput(
        { ...raw, verificationMethod: "" },
        { route: "API", today: TODAY, providerAttestsVerifiedSales: true },
      ).ok,
    ).toBe(false);
  });
  it("가격 유형은 필수이며 임의 값은 거부한다", () => {
    expect(validatePriceInput({ ...base, priceType: "" }, { route: "MANUAL", today: TODAY }).ok).toBe(false);
    expect(validatePriceInput({ ...base, priceType: "실거래가" }, { route: "MANUAL", today: TODAY }).ok).toBe(false);
  });
  it("0원·미래 확인일·잘못된 날짜·http가 아닌 URL을 거부한다", () => {
    const ctx = { route: "MANUAL" as const, today: TODAY };
    expect(validatePriceInput({ ...base, amount: "0" }, ctx).ok).toBe(false);
    expect(validatePriceInput({ ...base, checkedDate: "2026-11-12" }, ctx).ok).toBe(false);
    expect(validatePriceInput({ ...base, checkedDate: "2026-02-30" }, ctx).ok).toBe(false);
    expect(validatePriceInput({ ...base, sourceUrl: "javascript:alert(1)" }, ctx).ok).toBe(false);
    expect(validatePriceInput({ ...base, sourceUrl: "file:///etc/passwd" }, ctx).ok).toBe(false);
  });
  it("URL 없는 매입 견적은 메모가 필요하다", () => {
    const ctx = { route: "MANUAL" as const, today: TODAY };
    const q = { ...base, priceType: "BUYBACK_QUOTE" };
    const r = validatePriceInput(q, ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.memo).toBeDefined();
    expect(validatePriceInput({ ...q, memo: "매장 방문 견적" }, ctx).ok).toBe(true);
  });
  it("유효기간은 매입 견적에만 붙일 수 있다", () => {
    const r = validatePriceInput({ ...base, quoteValidUntil: "2026-12-01" }, { route: "MANUAL", today: TODAY });
    expect(r.ok).toBe(false);
  });
});

describe("URL 정규화와 중복 판별", () => {
  it("추적 파라미터·www·끝 슬래시·해시가 달라도 같은 매물 URL로 본다", () => {
    const a = normalizeUrl("https://www.example.com/item/123/?utm_source=x&b=2&a=1#top");
    const b = normalizeUrl("http://example.com/item/123?a=1&b=2");
    expect(a.ok && b.ok && a.normalized === b.normalized).toBe(true);
  });
  it("경로나 의미 있는 파라미터가 다르면 다른 매물이다", () => {
    const a = normalizeUrl("https://example.com/item?id=1");
    const b = normalizeUrl("https://example.com/item?id=2");
    expect(a.ok && b.ok && a.normalized !== b.normalized).toBe(true);
  });
  it("같은 출처+외부 ID 또는 같은 URL이면 중복, 금액만 같으면 중복이 아니다", () => {
    const x = { sourceName: "장터", externalId: "A1", normalizedUrl: null };
    expect(isSameListing(x, { sourceName: " 장터 ", externalId: "A1", normalizedUrl: null })).toBe(true);
    expect(isSameListing(x, { sourceName: "다른장터", externalId: "A1", normalizedUrl: null })).toBe(false);
    expect(isSameListing(x, { sourceName: "장터", externalId: "A2", normalizedUrl: null })).toBe(false);
    // ID·URL이 없는 자료끼리는 금액이 같아도 서로 다른 매물로 둔다
    const n = { sourceName: "장터", externalId: null, normalizedUrl: null };
    expect(isSameListing(n, { ...n })).toBe(false);
    expect(
      isSameListing(
        { sourceName: "a", externalId: null, normalizedUrl: "example.com/1" },
        { sourceName: "b", externalId: null, normalizedUrl: "example.com/1" },
      ),
    ).toBe(true);
  });
});

describe("가격 비교", () => {
  const item = { identifier: "9780306406157", condition: "GOOD" as const };
  let seq = 0;
  const rec = (over: Partial<ComparableRecord>): ComparableRecord => ({
    id: ++seq,
    priceType: "ASKING",
    amountMinor: 10000,
    currency: "KRW",
    checkedDate: "2026-11-01",
    productIdentifier: "9780306406157",
    condition: "GOOD",
    bundleType: "SINGLE",
    quoteValidUntil: null,
    includedInComparison: true,
    ...over,
  });

  it("자료가 없으면 그룹도 요약도 없다", () => {
    const c = buildComparison(item, [], TODAY, 180);
    expect(c.groups).toEqual([]);
    expect(c.eligibleCount).toBe(0);
  });

  it("유형이 다른 자료는 섞이지 않는다: 각 유형이 2건이면 합쳐서 4건이어도 요약값이 없다", () => {
    const c = buildComparison(
      item,
      [
        rec({ amountMinor: 10000 }),
        rec({ amountMinor: 12000 }),
        rec({ priceType: "SOLD_LISTING", amountMinor: 8000 }),
        rec({ priceType: "SOLD_LISTING", amountMinor: 9000 }),
      ],
      TODAY,
      180,
    );
    expect(c.groups.map((g) => g.priceType)).toEqual(["ASKING", "SOLD_LISTING"]);
    expect(c.groups.every((g) => g.summary === null)).toBe(true);
    expect(c.groups.every((g) => g.eligible.length === 2)).toBe(true);
  });

  it("유형별 요약은 그 유형의 자료만으로 계산한다", () => {
    const c = buildComparison(
      item,
      [
        rec({ amountMinor: 10000 }),
        rec({ amountMinor: 12000 }),
        rec({ amountMinor: 20000 }),
        rec({ priceType: "BUYBACK_QUOTE", amountMinor: 3000 }),
        rec({ priceType: "USER_REPORTED", amountMinor: 99000 }),
      ],
      TODAY,
      180,
    );
    const asking = c.groups.find((g) => g.priceType === "ASKING")!;
    expect(asking.summary).toEqual({ count: 3, median: 12000, min: 10000, max: 20000 });
    expect(c.groups.find((g) => g.priceType === "BUYBACK_QUOTE")!.summary).toBeNull();
    expect(c.groups.find((g) => g.priceType === "USER_REPORTED")!.summary).toBeNull();
  });

  it("적합 자료가 3건 미만이면 요약 없이 개별 자료만 남긴다", () => {
    const c = buildComparison(item, [rec({}), rec({ amountMinor: 11000 })], TODAY, 180);
    expect(c.groups[0]!.summary).toBeNull();
    expect(c.groups[0]!.eligible).toHaveLength(2);
  });

  it("제외 자료 때문에 3건 미만이 되면 요약을 내지 않는다", () => {
    const c = buildComparison(
      item,
      [rec({}), rec({}), rec({ condition: "POOR" }), rec({ bundleType: "BUNDLE" }), rec({ includedInComparison: false })],
      TODAY,
      180,
    );
    expect(c.groups[0]!.summary).toBeNull();
    expect(c.groups[0]!.excluded).toHaveLength(3);
  });

  it("만료된 매입 견적은 제외하고, 유효한 견적·기한 없는 견적은 남긴다", () => {
    const c = buildComparison(
      item,
      [
        rec({ priceType: "BUYBACK_QUOTE", quoteValidUntil: "2026-11-10" }),
        rec({ priceType: "BUYBACK_QUOTE", quoteValidUntil: "2026-11-11" }),
        rec({ priceType: "BUYBACK_QUOTE", quoteValidUntil: null }),
      ],
      TODAY,
      180,
    );
    const g = c.groups[0]!;
    expect(g.excluded).toHaveLength(1);
    expect(g.excluded[0]!.exclusions).toEqual(["QUOTE_EXPIRED"]);
    expect(g.eligible).toHaveLength(2);
  });

  it("다른 상품·묶음·다른 상태·외화·기간 밖 자료를 사유와 함께 제외한다", () => {
    const c = buildComparison(
      item,
      [
        rec({ productIdentifier: "9780804429573" }),
        rec({ bundleType: "BUNDLE" }),
        rec({ condition: "BROKEN" }),
        rec({ currency: "USD", amountMinor: 1250 }),
        rec({ checkedDate: "2026-01-01" }),
      ],
      TODAY,
      180,
    );
    expect(c.eligibleCount).toBe(0);
    expect(c.groups[0]!.excluded.map((e) => e.exclusions[0])).toEqual([
      "DIFFERENT_PRODUCT",
      "BUNDLE",
      "DIFFERENT_CONDITION",
      "FOREIGN_CURRENCY",
      "OUT_OF_WINDOW",
    ]);
  });

  it("외화 자료는 금액이 원화 요약에 절대 들어가지 않는다", () => {
    const c = buildComparison(
      item,
      [rec({ amountMinor: 10000 }), rec({ amountMinor: 11000 }), rec({ amountMinor: 12000 }), rec({ currency: "USD", amountMinor: 5 })],
      TODAY,
      180,
    );
    expect(c.groups[0]!.summary).toEqual({ count: 3, median: 11000, min: 10000, max: 12000 });
  });

  it("ISBN-10으로 적힌 자료도 같은 책으로 맞춘다. 식별정보·상태가 비어 있으면 경고만 붙인다", () => {
    const c = buildComparison(
      item,
      [rec({ productIdentifier: "0-306-40615-2" }), rec({ productIdentifier: null, condition: null })],
      TODAY,
      null,
    );
    expect(c.eligibleCount).toBe(2);
    expect(c.groups[0]!.eligible.find((e) => e.record.productIdentifier === null)!.warnings).toEqual([
      "IDENTIFIER_UNCHECKED",
      "CONDITION_UNCHECKED",
    ]);
  });

  it("금액이 같은 서로 다른 매물은 각각 표본으로 센다", () => {
    const c = buildComparison(item, [rec({}), rec({}), rec({})], TODAY, 180);
    expect(c.groups[0]!.summary?.count).toBe(3);
  });
});

describe("실수령액", () => {
  const full = {
    saleAmount: 20000,
    feeMode: "AMOUNT" as const,
    feeAmount: 0,
    feeRateBp: null,
    shipping: 3500,
    packing: 500,
    transport: 0,
  };
  it("판매금액 − 수수료 − 배송비 − 포장비 − 교통비", () => {
    const r = computeNet(full);
    expect(r).toMatchObject({ complete: true, net: 16000, missing: [] });
  });
  it("0원은 입력된 값이고, 미입력(null)은 계산 불완전이다", () => {
    const zero = computeNet({ ...full, shipping: 0 });
    expect(zero.complete).toBe(true);
    expect(zero.net).toBe(19500);
    const unknown = computeNet({ ...full, shipping: null });
    expect(unknown.complete).toBe(false);
    expect(unknown.net).toBeNull();
    expect(unknown.missing).toEqual(["shipping"]);
    expect(unknown.netBeforeMissing).toBe(19500);
  });
  it("수수료율 모드에서 요율 미입력은 수수료 모름으로 처리한다", () => {
    const r = computeNet({ ...full, feeMode: "RATE", feeAmount: 999, feeRateBp: null });
    expect(r.missing).toEqual(["fee"]);
    const ok = computeNet({ ...full, feeMode: "RATE", feeAmount: null, feeRateBp: 350 });
    expect(ok.fee).toBe(700);
    expect(ok.net).toBe(15300);
  });
  it("비용이 판매금액보다 크면 음수 실수령액을 숨기지 않는다", () => {
    expect(computeNet({ ...full, saleAmount: 3000 }).net).toBe(-1000);
  });
  it("차액은 양쪽이 모두 완전할 때만 계산한다", () => {
    const direct = computeNet(full);
    const buyback = computeNet({ ...full, saleAmount: 9000, shipping: 0, packing: 0 });
    expect(netDifference(direct, buyback)).toBe(7000);
    expect(netDifference(direct, computeNet({ ...full, packing: null }))).toBeNull();
    expect(netDifference(direct, null)).toBeNull();
  });
});

describe("판매글 초안", () => {
  const book = {
    category: "BOOK" as const,
    name: "선형대수학",
    identifier: "9780306406157",
    condition: "FAIR" as const,
    defects: null,
    components: null,
    author: "김저자",
    publisher: "어느출판",
    edition: "2판",
    hasWriting: "YES" as const,
    hasUnderline: "UNKNOWN" as const,
    hasDamage: "NO" as const,
    hasSupplement: "UNKNOWN" as const,
  };
  it("판본과 필기 여부를 빠뜨리지 않는다", () => {
    const d = buildListingDraft(book, 15000);
    expect(d.title).toContain("2판");
    expect(d.body).toContain("판본: 2판");
    expect(d.body).toContain("필기: 있음");
    expect(d.body).toContain("희망 가격: 15,000원");
  });
  it("입력하지 않은 사실은 쓰지 않고 누락 항목으로 알려준다", () => {
    const d = buildListingDraft(book, null);
    expect(d.body).not.toContain("밑줄");
    expect(d.body).not.toContain("하자");
    expect(d.body).not.toMatch(/새것|정상 작동|깨끗/);
    expect(d.missing.join()).toContain("밑줄");
    expect(d.missing.join()).toContain("하자");
    expect(d.body).not.toContain("희망 가격");
  });
  it("기기는 하자와 구성품을 그대로 옮긴다", () => {
    const d = buildListingDraft(
      { ...book, category: "CONSOLE", name: "게임기", identifier: "ABC-1", defects: "스틱 쏠림", components: "본체, 독" },
      null,
    );
    expect(d.body).toContain("하자: 스틱 쏠림");
    expect(d.body).toContain("구성품: 본체, 독");
    expect(d.body).not.toContain("필기");
  });
});

describe("다음에 할 일", () => {
  const base = { status: "OWNED" as const, priceCount: 0, scenarioCount: 0, chosenMethod: null, hasResult: false };
  it("입력된 단계까지만 보고 다음 한 가지를 고른다", () => {
    expect(nextStep(base)).toBe("ADD_PRICES");
    expect(nextStep({ ...base, priceCount: 2 })).toBe("ENTER_COSTS");
    expect(nextStep({ ...base, priceCount: 2, scenarioCount: 1 })).toBe("CHOOSE_METHOD");
    expect(nextStep({ ...base, priceCount: 2, scenarioCount: 2, chosenMethod: "DIRECT" })).toBe("POST_LISTING");
    expect(nextStep({ ...base, status: "LISTED", priceCount: 2, scenarioCount: 2, chosenMethod: "DIRECT" })).toBe("RECORD_RESULT");
  });
  it("업체에 넘기기로 했으면 판매글 단계를 건너뛴다", () => {
    expect(nextStep({ ...base, priceCount: 1, scenarioCount: 1, chosenMethod: "BUYBACK" })).toBe("RECORD_RESULT");
  });
  it("판매 완료인데 결과 기록이 없으면 기록이 먼저, 기록이 있으면 완료", () => {
    expect(nextStep({ ...base, status: "SOLD" })).toBe("RECORD_RESULT");
    expect(nextStep({ ...base, status: "SOLD", hasResult: true })).toBe("DONE");
  });
});
