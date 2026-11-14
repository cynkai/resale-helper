// 자료 점검: 아직 팔지 않은 물건의 가격 자료·계산 중 "다시 확인할 것"을 모은다.
// 금액을 평가하거나 예측하지 않는다. 날짜와 저장된 사실만 본다.

import { daysBetween, isQuoteExpired, OLD_DATA_DAYS } from "./compare";
import { basisIssues, type BasisIssue } from "./scenario";
import type { Currency, PriceType, SaleMethod } from "./types";

export type CheckupPrice = {
  id: number;
  priceType: PriceType;
  amountMinor: number;
  currency: Currency;
  sourceName: string;
  checkedDate: string;
  quoteValidUntil: string | null;
  includedInComparison: boolean;
};

export type CheckupScenario = {
  method: SaleMethod;
  saleAmount: number;
  basisPriceRecordId: number | null;
  basisPriceType: PriceType | null;
};

export type CheckupFinding =
  /** 유효기간이 지난 매입 견적 */
  | { kind: "QUOTE_EXPIRED"; priceId: number; sourceName: string; amountMinor: number; currency: Currency; validUntil: string; daysAgo: number }
  /** 유효기간이 남은 매입 견적(며칠 남았는지만 알려 준다. "임박" 기준은 두지 않는다) */
  | { kind: "QUOTE_VALID"; priceId: number; sourceName: string; amountMinor: number; currency: Currency; validUntil: string; daysLeft: number }
  /** 비교에 포함된 자료 중 확인한 지 오래된 것 */
  | { kind: "OLD_DATA"; count: number; oldestCheckedDate: string; oldestDays: number }
  /** 저장한 계산의 기준 자료에 문제가 있음 */
  | { kind: "BASIS_ISSUE"; method: SaleMethod; issues: BasisIssue[] };

export type CheckupInput = { prices: CheckupPrice[]; scenarios: CheckupScenario[] };

export function checkupItem(input: CheckupInput, today: string): CheckupFinding[] {
  const out: CheckupFinding[] = [];
  const quotes = input.prices
    .filter((p) => p.priceType === "BUYBACK_QUOTE" && p.quoteValidUntil !== null)
    .sort((a, b) => a.quoteValidUntil!.localeCompare(b.quoteValidUntil!) || a.id - b.id);
  for (const p of quotes) {
    const base = { priceId: p.id, sourceName: p.sourceName, amountMinor: p.amountMinor, currency: p.currency, validUntil: p.quoteValidUntil! };
    if (isQuoteExpired(p, today)) out.push({ kind: "QUOTE_EXPIRED", ...base, daysAgo: daysBetween(p.quoteValidUntil!, today) });
    else out.push({ kind: "QUOTE_VALID", ...base, daysLeft: daysBetween(today, p.quoteValidUntil!) });
  }
  // 외화 자료는 원화 비교에서 원래 빠지므로 세지 않는다.
  const old = input.prices.filter((p) => p.includedInComparison && p.currency === "KRW" && daysBetween(p.checkedDate, today) > OLD_DATA_DAYS);
  if (old.length > 0) {
    const oldest = old.reduce((a, b) => (a.checkedDate <= b.checkedDate ? a : b));
    out.push({ kind: "OLD_DATA", count: old.length, oldestCheckedDate: oldest.checkedDate, oldestDays: daysBetween(oldest.checkedDate, today) });
  }
  for (const sc of input.scenarios) {
    const basis = sc.basisPriceRecordId !== null ? input.prices.find((p) => p.id === sc.basisPriceRecordId) : undefined;
    const issues = basisIssues(sc, basis, today);
    if (issues.length > 0) out.push({ kind: "BASIS_ISSUE", method: sc.method, issues });
  }
  return out;
}

/** 손볼 것이 있는지. 유효기간이 남은 견적은 참고 정보라 세지 않는다. */
export function needsAttention(findings: CheckupFinding[]): boolean {
  return findings.some((f) => f.kind !== "QUOTE_VALID");
}

export function countFindings(all: CheckupFinding[][]): Record<CheckupFinding["kind"], number> {
  const c = { QUOTE_EXPIRED: 0, QUOTE_VALID: 0, OLD_DATA: 0, BASIS_ISSUE: 0 };
  for (const list of all) for (const f of list) c[f.kind] += f.kind === "OLD_DATA" ? f.count : 1;
  return c;
}
