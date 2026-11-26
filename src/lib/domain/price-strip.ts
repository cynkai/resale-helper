// 물건 화면의 "가격 자료 분포" 그림에 쓸 값(순수 함수).
// 유형마다 줄을 따로 두어 서로 다른 유형을 한 줄·한 숫자로 섞지 않는다. 같은 금액 축에 나란히 둘 뿐이다.
// 외화 자료는 원화 축에 놓을 수 없으므로 그림에서 빼고 건수만 알린다. 예측선·추세선은 그리지 않는다.

import type { Comparison, ComparableRecord } from "./compare";
import type { PriceType } from "./types";

/** lane: 금액이 거의 같은 점이 겹쳐 가려지지 않도록 위아래로 비켜 그릴 칸(0 = 가운데, 1 = 위, 2 = 아래, 3 = 가운데 …). */
export type StripPoint = { id: number; amount: number; eligible: boolean; x: number; lane: number };
export type StripRow = { priceType: PriceType; points: StripPoint[]; eligibleCount: number; median: { amount: number; x: number } | null };
export type StripMarker = { key: "SALE" | "BREAK_EVEN" | "POSTED"; amount: number; x: number };
export type PriceStrip = { lo: number; hi: number; ticks: { amount: number; x: number }[]; rows: StripRow[]; markers: StripMarker[]; omittedForeign: number };

/** 이보다 가까운(축 길이 대비) 점끼리는 겹친다고 보고 다른 칸에 놓는다. */
const OVERLAP_X = 0.015;

/** 겹치는 점마다 칸 번호를 준다. 같은 금액이 여러 건이면 0, 1, 2, 0 … 순서로 돌린다. */
function assignLanes(points: Omit<StripPoint, "lane">[]): StripPoint[] {
  const placed: StripPoint[] = [];
  for (const p of [...points].sort((a, b) => a.x - b.x || a.id - b.id)) {
    const near = placed.filter((q) => Math.abs(q.x - p.x) < OVERLAP_X).length;
    placed.push({ ...p, lane: near % 3 });
  }
  // 원래 순서(포함 자료 먼저)로 되돌린다.
  return points.map((p) => placed.find((q) => q.id === p.id)!);
}

/** 눈금용 짧은 금액 표기: 25000 → "2.5만", 3000 → "3천", 500 → "500". 좁은 화면에서 눈금 글자가 겹치지 않게 한다. */
export function shortWon(n: number): string {
  const trim = (v: number) => String(Math.round(v * 10) / 10);
  if (n >= 10000) return `${trim(n / 10000)}만`;
  if (n >= 1000) return `${trim(n / 1000)}천`;
  return String(n);
}

/** 1·2·5 × 10^k 가운데 범위를 4~5칸으로 나누는 간격. */
export function niceStep(range: number, maxTicks = 5): number {
  const raw = range / maxTicks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  return (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
}

/**
 * 원화 자료가 2건 이상일 때만 그림을 만든다(1건이면 분포가 없다).
 * markers: 내 개인 판매 계산의 금액, 손익분기 개인 판매금액, 지금 올린 내 판매글 가격(모두 내가 넣은 숫자에서 나온 값). 축 범위에 함께 넣는다.
 * hideExcluded면 비교에서 제외된 자료는 그리지 않는다(목록의 "제외된 자료 숨기기"와 같게).
 */
export function buildPriceStrip<R extends ComparableRecord>(
  comparison: Comparison<R>,
  opts: { hideExcluded?: boolean; saleAmount?: number | null; breakEven?: number | null; posted?: number | null } = {},
): PriceStrip | null {
  const krw = (c: { record: R }) => c.record.currency === "KRW";
  let omittedForeign = 0;
  const rowsRaw = comparison.groups.map((g) => {
    const all = [...g.eligible, ...(opts.hideExcluded ? [] : g.excluded)];
    omittedForeign += all.filter((c) => !krw(c)).length;
    return { g, shown: all.filter(krw) };
  });
  const amounts = rowsRaw.flatMap((r) => r.shown.map((c) => c.record.amountMinor));
  if (amounts.length < 2) return null;
  const markerAmounts = [opts.saleAmount, opts.breakEven, opts.posted].filter((v): v is number => typeof v === "number" && v >= 0);
  const min = Math.min(...amounts, ...markerAmounts);
  const max = Math.max(...amounts, ...markerAmounts);
  const step = niceStep(max > min ? max - min : Math.max(1000, Math.round(min * 0.2)));
  let lo = Math.max(0, Math.floor(min / step) * step);
  let hi = Math.ceil(max / step) * step;
  if (hi === lo) {
    lo = Math.max(0, lo - step);
    hi += step;
  }
  const x = (a: number) => (a - lo) / (hi - lo);
  const ticks: { amount: number; x: number }[] = [];
  for (let a = lo; a <= hi + step / 2; a += step) ticks.push({ amount: a, x: x(a) });
  const rows: StripRow[] = rowsRaw
    .filter((r) => r.shown.length > 0)
    .map(({ g, shown }) => ({
      priceType: g.priceType,
      points: assignLanes(shown.map((c) => ({ id: c.record.id, amount: c.record.amountMinor, eligible: c.eligible, x: x(c.record.amountMinor) }))),
      eligibleCount: shown.filter((c) => c.eligible).length,
      // 중앙값은 비교 요약과 같은 값(적합 자료 3건 이상일 때만)이다.
      median: g.summary ? { amount: g.summary.median, x: x(g.summary.median) } : null,
    }));
  const markers: StripMarker[] = [];
  if (typeof opts.saleAmount === "number") markers.push({ key: "SALE", amount: opts.saleAmount, x: x(opts.saleAmount) });
  if (typeof opts.breakEven === "number") markers.push({ key: "BREAK_EVEN", amount: opts.breakEven, x: x(opts.breakEven) });
  if (typeof opts.posted === "number") markers.push({ key: "POSTED", amount: opts.posted, x: x(opts.posted) });
  return { lo, hi, ticks, rows, markers, omittedForeign };
}
