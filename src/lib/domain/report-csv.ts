// 배분·판매 결과 화면을 표 계산 프로그램에서 볼 수 있게 CSV로 내보낸다.
// 화면에 보이는 물건별 값만 담는다. 물건을 가로지르는 합계·평균 행은 만들지 않는다.
// 모르는 값(null)은 빈 칸으로 두고 0으로 쓰지 않는다.

import { escapeCsvCell } from "./csv";
import { reviewRow, type ReviewInput } from "./review";
import { reasonText, VERDICT_LABEL, type TriageResult } from "./triage";
import { CATEGORY_LABEL, ITEM_STATUS_LABEL, type Category, type ItemStatus } from "./types";

type Cell = string | number | null;

function toCsv(headers: string[], rows: Cell[][]): string {
  // 숫자 칸은 그대로 쓴다(음수의 "-"가 수식 주입 방지 규칙에 걸려 '-500처럼 글자가 되지 않게). 글자 칸만 이스케이프한다.
  const cell = (c: Cell) => (c === null ? "" : typeof c === "number" ? String(c) : escapeCsvCell(c));
  const lines = [headers.join(","), ...rows.map((r) => r.map(cell).join(","))];
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}

export const TRIAGE_CSV_HEADERS = [
  "item_name",
  "category",
  "status",
  "verdict",
  "buyback_net",
  "direct_net",
  "extra",
  "extra_minutes",
  "extra_per_hour",
  "reasons",
  "is_demo",
];

export type TriageCsvRow = { name: string; category: Category; status: ItemStatus; isDemo: boolean; result: TriageResult };

export function buildTriageCsv(rows: TriageCsvRow[]): string {
  return toCsv(
    TRIAGE_CSV_HEADERS,
    rows.map(({ name, category, status, isDemo, result: r }) => [
      name,
      CATEGORY_LABEL[category],
      ITEM_STATUS_LABEL[status],
      VERDICT_LABEL[r.verdict],
      r.buybackNet?.net ?? null,
      r.directNet?.net ?? null,
      r.extra,
      r.extraMinutes,
      r.extraPerHour,
      r.reasons.map(reasonText).join(" "),
      isDemo ? "true" : "false",
    ]),
  );
}

export const RESULTS_CSV_HEADERS = [
  "item_name",
  "category",
  "sold_date",
  "channel",
  "chosen",
  "planned_sale_amount",
  "sale_amount",
  "planned_net",
  "cost_total",
  "actual_net",
  "net_diff",
  "expected_minutes",
  "minutes_spent",
  "first_posted_price",
  "is_demo",
];

export type ResultsCsvRow = ReviewInput & {
  name: string;
  category: Category;
  soldDate: string;
  channel: string;
  /** 고른 방법 표시(없으면 빈 문자열) */
  chosen: string;
  firstPostedPrice: number | null;
  isDemo: boolean;
};

export function buildResultsCsv(rows: ResultsCsvRow[]): string {
  return toCsv(
    RESULTS_CSV_HEADERS,
    rows.map((r) => {
      const review = reviewRow(r);
      return [
        r.name,
        CATEGORY_LABEL[r.category],
        r.soldDate,
        r.channel,
        r.chosen,
        r.chosenSaleAmount,
        r.amount,
        r.chosenNetAmount,
        r.costTotal,
        review.actualNet,
        review.netDiff,
        r.expectedMinutes,
        r.minutesSpent,
        r.firstPostedPrice,
        r.isDemo ? "true" : "false",
      ];
    }),
  );
}
