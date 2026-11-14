// 판매 결과 돌아보기: 판매 방법을 고를 때의 예상과 실제 판매 결과를 물건별로 비교한다.
// 실제 결과는 사용자가 기록한 값이며 외부에서 검증된 체결가가 아니다.
// 서로 다른 물건의 금액을 더한 총액은 만들지 않는다(물건마다 기준과 비용 항목이 다르다).

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
