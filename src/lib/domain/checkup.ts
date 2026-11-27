// 자료 점검: 아직 팔지 않은 물건의 가격 자료·계산 중 "다시 확인할 것"을 모은다.
// 금액을 평가하거나 예측하지 않는다. 날짜와 저장된 사실만 본다.

import { breakEvenDirectSale } from "./break-even";
import { daysBetween, isQuoteExpired, OLD_DATA_DAYS } from "./compare";
import { computeNet, type CostInputs } from "./net";
import { summarizePosted, type PostedPoint } from "./posted-price";
import { basisIssues, primaryScenario, type BasisIssue } from "./scenario";
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
  channel?: string;
  saleAmount: number;
  basisPriceRecordId: number | null;
  basisPriceType: PriceType | null;
  /** 아래는 손익분기 계산용. 없으면 "올린 가격이 손익분기보다 낮음" 점검을 하지 않는다. */
  isPrimary?: boolean;
} & Partial<Omit<CostInputs, "saleAmount">>;

export type CheckupFinding =
  /** 유효기간이 지난 매입 견적 */
  | { kind: "QUOTE_EXPIRED"; priceId: number; sourceName: string; amountMinor: number; currency: Currency; validUntil: string; daysAgo: number }
  /** 유효기간이 남은 매입 견적(며칠 남았는지만 알려 준다. "임박" 기준은 두지 않는다) */
  | { kind: "QUOTE_VALID"; priceId: number; sourceName: string; amountMinor: number; currency: Currency; validUntil: string; daysLeft: number }
  /** 비교에 포함된 자료 중 확인한 지 오래된 것 */
  | { kind: "OLD_DATA"; count: number; oldestCheckedDate: string; oldestDays: number }
  /** 저장한 계산의 기준 자료에 문제가 있음 */
  | { kind: "BASIS_ISSUE"; method: SaleMethod; channel: string; issues: BasisIssue[] }
  /** 답하지 않은 제안이 있음(며칠 지났는지만 알려 준다. "빨리 답하라"는 기준은 두지 않는다) */
  | { kind: "OPEN_OFFERS"; count: number; oldestReceivedDate: string; oldestDays: number }
  /** 지금 올린 내 판매글 가격이 손익분기 개인 판매금액보다 낮음(내가 입력한 비용으로 한 산수) */
  | { kind: "POSTED_BELOW_BREAK_EVEN"; posted: number; breakEven: number };

export type CheckupOffer = { status: string; receivedDate: string };

export type CheckupInput = { prices: CheckupPrice[]; scenarios: CheckupScenario[]; offers?: CheckupOffer[]; posted?: PostedPoint[] };

function costsOf(sc: CheckupScenario): CostInputs | null {
  const { feeMode, feeAmount, feeRateBp, shipping, packing, transport } = sc;
  if (feeMode === undefined || feeAmount === undefined || feeRateBp === undefined || shipping === undefined || packing === undefined || transport === undefined) {
    return null;
  }
  return { saleAmount: sc.saleAmount, feeMode, feeAmount, feeRateBp, shipping, packing, transport };
}

/**
 * 물건 화면과 같은 규칙의 손익분기 개인 판매금액: 개인 판매·업체 기준 계산이 있고,
 * 업체 계산의 기준 자료에 문제가 없고, 개인 판매 비용을 모두 알 때만. 아니면 null.
 */
export function breakEvenFor(scenarios: CheckupScenario[], prices: CheckupPrice[], today: string): number | null {
  const pickable = scenarios.map((s) => ({ ...s, isPrimary: s.isPrimary ?? false }));
  const direct = primaryScenario(pickable, "DIRECT");
  const buyback = primaryScenario(pickable, "BUYBACK");
  if (!direct || !buyback) return null;
  const directCosts = costsOf(direct);
  const buybackCosts = costsOf(buyback);
  if (!directCosts || !buybackCosts) return null;
  const basis = buyback.basisPriceRecordId !== null ? prices.find((p) => p.id === buyback.basisPriceRecordId) : undefined;
  if (basisIssues(buyback, basis, today).length > 0) return null;
  const even = breakEvenDirectSale(directCosts, computeNet(buybackCosts).net);
  return even.ok ? even.saleAmount : null;
}

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
    if (issues.length > 0) out.push({ kind: "BASIS_ISSUE", method: sc.method, channel: sc.channel ?? "", issues });
  }
  // 지금 올린 가격이 손익분기보다 낮은지(올린 가격을 적어 둔 물건만). 그 가격에 팔면 업체에 넘길 때보다 덜 남는다는 산수일 뿐 추천이 아니다.
  const latest = summarizePosted(input.posted ?? [])?.latest;
  if (latest !== undefined) {
    const even = breakEvenFor(input.scenarios, input.prices, today);
    if (even !== null && latest < even) out.push({ kind: "POSTED_BELOW_BREAK_EVEN", posted: latest, breakEven: even });
  }
  const open = (input.offers ?? []).filter((o) => o.status === "OPEN");
  if (open.length > 0) {
    const oldest = open.reduce((a, b) => (a.receivedDate <= b.receivedDate ? a : b));
    out.push({ kind: "OPEN_OFFERS", count: open.length, oldestReceivedDate: oldest.receivedDate, oldestDays: daysBetween(oldest.receivedDate, today) });
  }
  return out;
}

/** 손볼 것이 있는지. 유효기간이 남은 견적은 참고 정보라 세지 않는다. */
export function needsAttention(findings: CheckupFinding[]): boolean {
  return findings.some((f) => f.kind !== "QUOTE_VALID");
}

export function countFindings(all: CheckupFinding[][]): Record<CheckupFinding["kind"], number> {
  const c = { QUOTE_EXPIRED: 0, QUOTE_VALID: 0, OLD_DATA: 0, BASIS_ISSUE: 0, OPEN_OFFERS: 0, POSTED_BELOW_BREAK_EVEN: 0 };
  for (const list of all) for (const f of list) c[f.kind] += f.kind === "OLD_DATA" || f.kind === "OPEN_OFFERS" ? f.count : 1;
  return c;
}
