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
