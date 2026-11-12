// 데모 시드. 모든 값은 가상이며 is_demo=true로만 저장된다. 실제 시세와 무관하다.

import type { Db } from "./client";
import { clearDemo, createItem, getItem, insertPrice, upsertScenario } from "./repo";
import { isbn13CheckDigit } from "../domain/isbn";
import type { ValidPriceInput } from "../domain/price-input";
import type { PriceType } from "../domain/types";

function daysAgo(today: string, n: number): string {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

export function seedDemo(db: Db, today: string): void {
  clearDemo(db);
  const isbnBody = "979110000001";
  const isbn = isbnBody + String(isbn13CheckDigit(isbnBody));

  const bookId = createItem(db, true, {
    category: "BOOK",
    status: "OWNED",
    name: "(데모) 가상 전공서: 자료구조 입문",
    identifier: isbn,
    condition: "GOOD",
    defects: "표지 모서리 약간 닳음",
    components: null,
    memo: "데모용 가상 물건입니다.",
    author: "홍길동(가상)",
    publisher: "가상출판사",
    edition: "3판",
    hasWriting: "NO",
    hasUnderline: "YES",
    hasDamage: "NO",
    hasSupplement: "UNKNOWN",
  });
  const consoleId = createItem(db, true, {
    category: "CONSOLE",
    status: "OWNED",
    name: "(데모) 가상 휴대용 게임기",
    identifier: "DEMO-1000",
    condition: "FAIR",
    defects: "왼쪽 스틱 쏠림 있음",
    components: "본체, 충전기 (박스 없음)",
    memo: null,
    author: null,
    publisher: null,
    edition: null,
    hasWriting: "UNKNOWN",
    hasUnderline: "UNKNOWN",
    hasDamage: "UNKNOWN",
    hasSupplement: "UNKNOWN",
  });

  const book = getItem(db, true, bookId)!;
  const base = (
    priceType: PriceType,
    amount: number,
    sourceName: string,
    externalId: string,
    ago: number,
    extra: Partial<ValidPriceInput> = {},
  ): ValidPriceInput => ({
    priceType,
    amountMinor: amount,
    currency: "KRW",
    sourceName,
    sourceUrl: null,
    normalizedUrl: null,
    externalId,
    checkedDate: daysAgo(today, ago),
    tradeDate: null,
    productIdentifier: isbn,
    condition: "GOOD",
    components: null,
    bundleType: "SINGLE",
    shippingIncluded: "UNKNOWN",
    verificationMethod: null,
    quoteValidUntil: null,
    deductionTerms: null,
    memo: "데모용 가상 자료",
    ...extra,
  });

  const rows: ValidPriceInput[] = [
    base("ASKING", 18000, "가상마켓 A", "demo-a-1", 2),
    base("ASKING", 20000, "가상마켓 A", "demo-a-2", 5),
    base("ASKING", 20000, "가상마켓 B", "demo-b-1", 5), // 금액이 같아도 다른 매물
    base("ASKING", 24000, "가상마켓 B", "demo-b-2", 9, { shippingIncluded: "YES" }),
    base("ASKING", 9000, "가상마켓 B", "demo-b-3", 4, { condition: "POOR" }), // 상태 다름 → 제외
    base("ASKING", 45000, "가상마켓 A", "demo-a-3", 3, { bundleType: "BUNDLE" }), // 묶음 → 제외
    base("SOLD_LISTING", 17000, "가상마켓 A", "demo-a-s1", 20, { tradeDate: daysAgo(today, 21) }),
    base("SOLD_LISTING", 15000, "가상마켓 B", "demo-b-s1", 40),
    base("BUYBACK_QUOTE", 7500, "가상매입 서점", "demo-q-1", 1, {
      quoteValidUntil: daysAgo(today, -6),
      deductionTerms: "검수 후 밑줄·필기 발견 시 감액 가능",
      memo: "데모용 가상 견적 (앱 화면에서 확인했다고 가정)",
    }),
    base("BUYBACK_QUOTE", 9000, "가상매입 센터", "demo-q-2", 30, {
      quoteValidUntil: daysAgo(today, 16), // 만료 → 제외
      memo: "데모용 가상 견적 (만료됨)",
    }),
  ];
  for (const r of rows) insertPrice(db, book, r, "MANUAL");

  upsertScenario(db, bookId, "BUYBACK", {
    saleAmount: 7500,
    basisPriceRecordId: null,
    basisPriceType: null,
    feeMode: "AMOUNT",
    feeAmount: 0,
    feeRateBp: null,
    shipping: 0,
    packing: 500,
    transport: 0,
    expectedMinutes: 20,
    memo: null,
  });
  upsertScenario(db, bookId, "DIRECT", {
    saleAmount: 19000,
    basisPriceRecordId: null,
    basisPriceType: null,
    feeMode: "AMOUNT",
    feeAmount: 0,
    feeRateBp: null,
    shipping: null, // 일부러 미입력 → "계산 불완전" 예시
    packing: 500,
    transport: 0,
    expectedMinutes: 90,
    memo: null,
  });
  // 배분 화면 예시용 가상 시나리오. 기준 자료 없이 어림한 금액이며 실제 시세와 무관하다.
  const scenario = (saleAmount: number, costs: { shipping: number; packing: number; transport: number }, expectedMinutes: number) => ({
    saleAmount,
    basisPriceRecordId: null,
    basisPriceType: null,
    feeMode: "AMOUNT" as const,
    feeAmount: 0,
    feeRateBp: null,
    ...costs,
    expectedMinutes,
    memo: "데모용 가상 금액",
  });
  upsertScenario(db, consoleId, "BUYBACK", scenario(60000, { shipping: 0, packing: 0, transport: 3000 }, 40));
  upsertScenario(db, consoleId, "DIRECT", scenario(95000, { shipping: 4000, packing: 1000, transport: 0 }, 180));

  const earphoneId = createItem(db, true, {
    category: "ELECTRONICS",
    status: "LISTED",
    name: "(데모) 가상 무선 이어폰",
    identifier: "DEMO-EAR-1",
    condition: "LIKE_NEW",
    defects: null,
    components: "본체, 충전 케이스",
    memo: null,
    author: null,
    publisher: null,
    edition: null,
    hasWriting: "UNKNOWN",
    hasUnderline: "UNKNOWN",
    hasDamage: "UNKNOWN",
    hasSupplement: "UNKNOWN",
  });
  // 직접 팔아도 업체보다 덜 남는 예시
  upsertScenario(db, earphoneId, "BUYBACK", scenario(20000, { shipping: 0, packing: 0, transport: 0 }, 15));
  upsertScenario(db, earphoneId, "DIRECT", scenario(22000, { shipping: 3000, packing: 500, transport: 0 }, 60));
}
