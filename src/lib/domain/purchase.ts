// 내가 산 가격과 견주기. 산 가격은 사용자가 적은 값이며 가격 자료가 아니다(비교·요약에 넣지 않는다).
// 입력한 숫자끼리 빼기만 한다. 손해를 줄이라거나 언제 팔라는 말은 하지 않는다.

import { daysBetween } from "./compare";

/** 실수령액 − 산 가격. 어느 한쪽을 모르면 null(모름을 0으로 치지 않는다). */
export function vsPurchase(net: number | null, purchaseAmount: number | null | undefined): number | null {
  if (net === null || purchaseAmount === null || purchaseAmount === undefined) return null;
  return net - purchaseAmount;
}

/** 산 날부터 그 날짜까지 지난 일수. 산 날짜를 모르거나 날짜가 앞서면 null. */
export function heldDays(purchaseDate: string | null | undefined, until: string): number | null {
  if (!purchaseDate || until < purchaseDate) return null;
  return daysBetween(purchaseDate, until);
}

export type PurchaseOutcome = "ABOVE" | "EQUAL" | "BELOW";

export function purchaseOutcome(diff: number): PurchaseOutcome {
  return diff > 0 ? "ABOVE" : diff < 0 ? "BELOW" : "EQUAL";
}

/** 산 가격보다 더 남김/같음/덜 남김 건수. 금액을 더하지 않는다. */
export function countPurchaseOutcomes(diffs: number[]): Record<PurchaseOutcome, number> {
  const c = { ABOVE: 0, EQUAL: 0, BELOW: 0 };
  for (const d of diffs) c[purchaseOutcome(d)] += 1;
  return c;
}
