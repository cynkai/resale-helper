// 판매 결과 돌아보기: 판매 방법을 고를 때의 예상과 실제 판매 결과를 물건별로 비교한다.
// 실제 결과는 사용자가 기록한 값이며 외부에서 검증된 체결가가 아니다.
// 서로 다른 물건의 금액을 더한 총액은 만들지 않는다(물건마다 기준과 비용 항목이 다르다).

import { formatMoney } from "./money";
import { COST_LABEL, resolveFee, type CostInputs, type CostKey } from "./net";

export type ReviewInput = {
  chosenSaleAmount: number | null;
  chosenNetAmount: number | null;
  expectedMinutes: number | null; // 고른 방법의 예상 소요시간
  amount: number; // 실제 판매금액
  costTotal: number | null; // 실제 비용(모름 = null)
  minutesSpent: number | null;
};

export type ReviewRow = {
  actualNet: number | null;
  saleDiff: number | null; // 실제 판매금액 − 선택 당시 판매금액
  netDiff: number | null; // 실제 실수령액 − 선택 당시 예상 실수령액
  minutesDiff: number | null;
  /** 실수령액 기준 비교. 둘 중 하나라도 모르면 "UNKNOWN". */
  outcome: "ABOVE" | "EQUAL" | "BELOW" | "UNKNOWN";
};

export function reviewRow(r: ReviewInput): ReviewRow {
  const actualNet = r.costTotal === null ? null : r.amount - r.costTotal;
  const saleDiff = r.chosenSaleAmount === null ? null : r.amount - r.chosenSaleAmount;
  const netDiff = actualNet === null || r.chosenNetAmount === null ? null : actualNet - r.chosenNetAmount;
  const minutesDiff = r.minutesSpent === null || r.expectedMinutes === null ? null : r.minutesSpent - r.expectedMinutes;
  const outcome = netDiff === null ? "UNKNOWN" : netDiff > 0 ? "ABOVE" : netDiff < 0 ? "BELOW" : "EQUAL";
  return { actualNet, saleDiff, netDiff, minutesDiff, outcome };
}

export function countOutcomes(rows: ReviewRow[]): Record<ReviewRow["outcome"], number> {
  const c = { ABOVE: 0, EQUAL: 0, BELOW: 0, UNKNOWN: 0 };
  for (const r of rows) c[r.outcome]++;
  return c;
}

export type OutcomeGroup = { key: string; total: number; counts: Record<ReviewRow["outcome"], number> };

/**
 * 묶음별 건수. 금액은 묶음 안에서도 더하지 않는다(물건마다 기준이 다르다).
 * 건수가 많은 묶음부터, 같으면 이름순.
 */
export function groupOutcomes<T>(rows: T[], keyOf: (row: T) => string, reviewOf: (row: T) => ReviewRow): OutcomeGroup[] {
  const map = new Map<string, ReviewRow[]>();
  for (const r of rows) {
    const k = keyOf(r);
    const list = map.get(k);
    if (list) list.push(reviewOf(r));
    else map.set(k, [reviewOf(r)]);
  }
  return [...map.entries()]
    .map(([key, list]) => ({ key, total: list.length, counts: countOutcomes(list) }))
    .sort((a, b) => b.total - a.total || a.key.localeCompare(b.key, "ko"));
}

/** 판매처 이름을 묶을 때 쓰는 키: 앞뒤·중복 공백을 정리하고 영문 대소문자를 구분하지 않는다. 표시 이름은 처음 나온 표기를 쓴다. */
export function channelKey(channel: string): string {
  return channel.trim().replace(/\s+/g, " ").toLowerCase();
}

export type TimeOutcome = "OVER" | "EQUAL" | "UNDER" | "UNKNOWN";

/** 걸린 시간이 어림보다 많았는지. 어림이나 실제 시간을 모르면 "UNKNOWN"(0분으로 치지 않는다). */
export function timeOutcome(r: Pick<ReviewRow, "minutesDiff">): TimeOutcome {
  if (r.minutesDiff === null) return "UNKNOWN";
  return r.minutesDiff > 0 ? "OVER" : r.minutesDiff < 0 ? "UNDER" : "EQUAL";
}

/** 시간 어림 건수. 분을 더하거나 평균 내지 않는다. */
export function countTimeOutcomes(rows: Pick<ReviewRow, "minutesDiff">[]): Record<TimeOutcome, number> {
  const c = { OVER: 0, EQUAL: 0, UNDER: 0, UNKNOWN: 0 };
  for (const r of rows) c[timeOutcome(r)]++;
  return c;
}

export type ChannelOutcome = "SAME" | "DIFFERENT" | "UNKNOWN";

/**
 * 고를 때 적어 둔 판매처 이름과 실제로 판 곳이 같은지. 이름은 channelKey로 맞춘다(앞뒤 공백·대소문자 무시).
 * 판매 방법을 고르지 않았거나 고른 계산에 이름이 없으면 비교하지 않는다(UNKNOWN).
 */
export function channelOutcome(plannedChannel: string | null | undefined, actualChannel: string): ChannelOutcome {
  if (!plannedChannel || plannedChannel.trim() === "") return "UNKNOWN";
  return channelKey(plannedChannel) === channelKey(actualChannel) ? "SAME" : "DIFFERENT";
}

export function countChannelOutcomes(outcomes: ChannelOutcome[]): Record<ChannelOutcome, number> {
  const c = { SAME: 0, DIFFERENT: 0, UNKNOWN: 0 };
  for (const o of outcomes) c[o] += 1;
  return c;
}

// ---- 비용 항목별 ----

export const COST_KEYS = Object.keys(COST_LABEL) as CostKey[];

/** 항목별 비용. null = 모름(0원과 다르다). */
export type CostItems = Record<CostKey, number | null>;

export type CostTotalResolution = { ok: true; total: number | null } | { ok: false; error: string };

/**
 * 실제 비용 합계를 정한다. 사용자가 적은 합계와 항목이 서로 어긋나면 저장하지 않는다.
 * - 항목을 하나도 적지 않음: 적은 합계 그대로(없으면 모름).
 * - 네 항목을 모두 적음: 합계는 항목의 합. 합계를 따로 적었는데 다르면 오류.
 * - 일부만 적음: 모르는 항목을 0으로 치지 않으므로 합계는 적은 값 그대로(없으면 모름). 적은 합계가 아는 항목의 합보다 작으면 오류.
 */
export function resolveActualCostTotal(typedTotal: number | null, items: CostItems): CostTotalResolution {
  const known = COST_KEYS.map((k) => items[k]).filter((v): v is number => v !== null);
  if (known.length === 0) return { ok: true, total: typedTotal };
  const sum = known.reduce((a, b) => a + b, 0);
  if (known.length === COST_KEYS.length) {
    if (typedTotal !== null && typedTotal !== sum) {
      return { ok: false, error: `합계(${formatMoney(typedTotal)})가 항목의 합(${formatMoney(sum)})과 다릅니다. 합계를 비우면 항목의 합을 씁니다.` };
    }
    return { ok: true, total: sum };
  }
  if (typedTotal !== null && typedTotal < sum) {
    return { ok: false, error: `합계(${formatMoney(typedTotal)})가 적어 둔 항목의 합(${formatMoney(sum)})보다 작습니다.` };
  }
  return { ok: true, total: typedTotal };
}

/** 고른 계산에 적어 둔 예상 비용을 항목별로(비율 수수료는 예상 판매금액 기준). */
export function plannedCostItems(sc: CostInputs): CostItems {
  return { fee: resolveFee(sc), shipping: sc.shipping, packing: sc.packing, transport: sc.transport };
}

export type CostItemDiff = { planned: number | null; actual: number | null; diff: number | null };

/** 항목별 "실제 − 예상". 어느 한쪽을 모르면 diff는 null. planned가 없으면(고른 계산 없음·바뀜) 모두 비교 불가. */
export function costItemDiffs(planned: CostItems | null, actual: CostItems): Record<CostKey, CostItemDiff> {
  const out = {} as Record<CostKey, CostItemDiff>;
  for (const k of COST_KEYS) {
    const p = planned ? planned[k] : null;
    const a = actual[k];
    out[k] = { planned: p, actual: a, diff: p === null || a === null ? null : a - p };
  }
  return out;
}

/** 비용 항목마다 "어림보다 더 듦/같음/덜 듦/비교 불가" 건수. 금액은 더하지 않는다. */
export function countCostItemOutcomes(rows: Record<CostKey, CostItemDiff>[]): Record<CostKey, Record<TimeOutcome, number>> {
  const out = {} as Record<CostKey, Record<TimeOutcome, number>>;
  for (const k of COST_KEYS) {
    const c = { OVER: 0, EQUAL: 0, UNDER: 0, UNKNOWN: 0 };
    for (const r of rows) {
      const d = r[k].diff;
      c[d === null ? "UNKNOWN" : d > 0 ? "OVER" : d < 0 ? "UNDER" : "EQUAL"] += 1;
    }
    out[k] = c;
  }
  return out;
}
