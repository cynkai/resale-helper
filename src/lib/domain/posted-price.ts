// 내 판매글에 올린 가격 기록. 사용자가 직접 적는다. 가격 자료가 아니며 비교·요약에 넣지 않는다.
// 올린 가격이 어떻게 바뀌었는지 보여 주고 입력한 숫자끼리 견줄 뿐, 얼마에 올리라고 하거나 언제 팔릴지 예측하지 않는다.

import { parseAmount } from "./money";
import { isValidYmd } from "./price-input";

export type ValidPostedPriceInput = { postedDate: string; amount: number; channel: string; memo: string | null };

export type PostedPriceValidation = { ok: true; value: ValidPostedPriceInput } | { ok: false; errors: Record<string, string> };

export function validatePostedPriceInput(
  raw: { postedDate?: string; amount?: string; channel?: string; memo?: string },
  today: string,
): PostedPriceValidation {
  const errors: Record<string, string> = {};
  const postedDate = (raw.postedDate ?? "").trim();
  if (!isValidYmd(postedDate)) errors.postedDate = "올린 날짜를 YYYY-MM-DD 형식으로 입력해 주세요.";
  else if (postedDate > today) errors.postedDate = "올린 날짜는 오늘 이후일 수 없습니다.";
  let amount = 0;
  const a = parseAmount(raw.amount ?? "", "KRW");
  if (!a.ok) errors.amount = a.error;
  else if (a.minor <= 0) errors.amount = "금액은 0보다 커야 합니다.";
  else amount = a.minor;
  const channel = (raw.channel ?? "").trim();
  if (channel.length > 100) errors.channel = "100자 이내로 입력해 주세요.";
  const memo = (raw.memo ?? "").trim();
  if (memo.length > 500) errors.memo = "500자 이내로 입력해 주세요.";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { postedDate, amount, channel, memo: memo === "" ? null : memo } };
}

export type PostedPoint = { id: number; postedDate: string; amount: number };

/** 날짜순(같은 날은 적은 순서)으로 정렬한다. */
export function sortPosted<T extends PostedPoint>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.postedDate.localeCompare(b.postedDate) || a.id - b.id);
}

export type PostedSummary = {
  first: number;
  /** 처음 올린 날 YYYY-MM-DD */
  firstDate: string;
  latest: number;
  /** 가격을 내린 횟수 / 올린 횟수(직전 기록과 견줌). 같은 가격으로 다시 올린 것은 세지 않는다. */
  lowered: number;
  raised: number;
};

export function summarizePosted(rows: PostedPoint[]): PostedSummary | null {
  const sorted = sortPosted(rows);
  if (sorted.length === 0) return null;
  let lowered = 0;
  let raised = 0;
  for (let i = 1; i < sorted.length; i++) {
    const d = sorted[i]!.amount - sorted[i - 1]!.amount;
    if (d < 0) lowered += 1;
    else if (d > 0) raised += 1;
  }
  return { first: sorted[0]!.amount, firstDate: sorted[0]!.postedDate, latest: sorted.at(-1)!.amount, lowered, raised };
}

/** 직전 기록과의 차이(첫 기록은 null). 입력 순서와 무관하게 날짜순으로 계산해 id → 차이로 돌려준다. */
export function postedDeltas(rows: PostedPoint[]): Map<number, number | null> {
  const sorted = sortPosted(rows);
  return new Map(sorted.map((r, i) => [r.id, i === 0 ? null : r.amount - sorted[i - 1]!.amount]));
}

/**
 * 처음 올린 날부터 판 날까지 며칠 걸렸는지(내가 적은 날짜끼리의 차이, 예측 아님).
 * 판 날이 처음 올린 날보다 앞서면(기록이 어긋남) null.
 */
export function daysFromFirstPost(firstDate: string, soldDate: string): number | null {
  const a = Date.parse(`${firstDate}T00:00:00Z`);
  const b = Date.parse(`${soldDate}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return null;
  return Math.round((b - a) / 86_400_000);
}

export type SoldVsFirstPosted = "BELOW" | "EQUAL" | "ABOVE";

/** 실제 판매금액이 처음 올린 가격보다 낮았는지. */
export function soldVsFirstPosted(firstPosted: number, soldAmount: number): SoldVsFirstPosted {
  return soldAmount < firstPosted ? "BELOW" : soldAmount > firstPosted ? "ABOVE" : "EQUAL";
}

export function countSoldVsFirstPosted(list: SoldVsFirstPosted[]): Record<SoldVsFirstPosted, number> {
  const c = { BELOW: 0, EQUAL: 0, ABOVE: 0 };
  for (const x of list) c[x] += 1;
  return c;
}
