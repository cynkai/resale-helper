import { Fragment } from "react";
import { formatMoney } from "@/lib/domain/money";
import { shortWon, type PriceStrip } from "@/lib/domain/price-strip";
import { PRICE_TYPE_INFO, type PriceType } from "@/lib/domain/types";

// 유형별 점 색(배지 색과 같은 계열). 어두운 화면에서는 팔레트가 뒤집혀도 같은 클래스가 그대로 맞는다.
const FILLED: Record<PriceType, string> = {
  ASKING: "border-sky-700 bg-sky-700",
  SOLD_LISTING: "border-violet-700 bg-violet-700",
  VERIFIED_SALE: "border-teal-700 bg-teal-700",
  BUYBACK_QUOTE: "border-amber-600 bg-amber-600",
  USER_REPORTED: "border-stone-600 bg-stone-600",
};
const HOLLOW: Record<PriceType, string> = {
  ASKING: "border-sky-700 bg-white",
  SOLD_LISTING: "border-violet-700 bg-white",
  VERIFIED_SALE: "border-teal-700 bg-white",
  BUYBACK_QUOTE: "border-amber-600 bg-white",
  USER_REPORTED: "border-stone-600 bg-white",
};

const pct = (x: number) => `${(x * 100).toFixed(2)}%`;
// 겹치는 점의 세로 위치(가운데 · 위 · 아래)
const LANE_TOP = ["50%", "calc(50% - 7px)", "calc(50% + 7px)"];

/** 가격 자료 분포: 유형마다 한 줄, 같은 금액 축. 점 하나가 자료 한 건이며 같은 자료가 아래 표에 있다. */
export function PriceStripFigure({ strip }: { strip: PriceStrip }) {
  const sale = strip.markers.find((m) => m.key === "SALE");
  const even = strip.markers.find((m) => m.key === "BREAK_EVEN");
  return (
    <figure className="mt-3" data-testid="price-strip" aria-labelledby="price-strip-title">
      <figcaption id="price-strip-title" className="text-sm font-medium">
        가격 자료 분포 <span className="font-normal text-stone-600">— 유형마다 따로 그리고 같은 금액 축(원, 만 = 10,000원)에 나란히 둡니다. 유형끼리 합치지 않습니다.</span>
      </figcaption>
      <ul className="sr-only">
        {strip.rows.map((r) => {
          const amounts = r.points.map((p) => p.amount);
          return (
            <li key={r.priceType}>
              {PRICE_TYPE_INFO[r.priceType].label}: {r.points.length}건(비교에 포함 {r.eligibleCount}건), {formatMoney(Math.min(...amounts))}~{formatMoney(Math.max(...amounts))}
              {r.median ? `, 중앙값 ${formatMoney(r.median.amount)}` : ""}
            </li>
          );
        })}
      </ul>
      <div aria-hidden className="mt-2 grid grid-cols-[6.5rem_1fr] items-center gap-x-3 gap-y-1 text-xs sm:grid-cols-[8rem_1fr]">
        {strip.rows.map((r) => (
          <Fragment key={r.priceType}>
            <div className="truncate text-stone-700">
              {PRICE_TYPE_INFO[r.priceType].label} <span className="text-stone-500">{r.points.length}</span>
            </div>
            <div className="relative h-7 rounded bg-stone-100" data-testid={`strip-${r.priceType}`}>
              {sale ? <span className="absolute inset-y-0 w-0 border-l-2 border-teal-700" style={{ left: pct(sale.x) }} /> : null}
              {even ? <span className="absolute inset-y-0 w-0 border-l-2 border-dashed border-red-700" style={{ left: pct(even.x) }} /> : null}
              {r.median ? (
                <span className="absolute inset-y-1 w-0.5 -translate-x-1/2 bg-stone-900" style={{ left: pct(r.median.x) }} title={`중앙값 ${formatMoney(r.median.amount)}`} />
              ) : null}
              {r.points.map((p) => (
                <span
                  key={p.id}
                  data-testid="strip-point"
                  data-eligible={p.eligible ? "yes" : "no"}
                  title={`${formatMoney(p.amount)} · ${p.eligible ? "비교에 포함" : "비교에서 제외"}`}
                  className={`absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 opacity-90 ${p.eligible ? FILLED[r.priceType] : HOLLOW[r.priceType]}`}
                  style={{ left: pct(p.x), top: LANE_TOP[p.lane] }}
                />
              ))}
            </div>
          </Fragment>
        ))}
        <div />
        <div className="relative h-4 text-[11px] text-stone-600">
          {strip.ticks.map((t, i) => (
            <span
              key={t.amount}
              className={`absolute whitespace-nowrap ${i === 0 ? "" : i === strip.ticks.length - 1 ? "-translate-x-full" : "-translate-x-1/2"}`}
              style={{ left: pct(t.x) }}
            >
              {shortWon(t.amount)}
            </span>
          ))}
        </div>
      </div>
      <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-700">
        <span>● 비교에 포함 ○ 비교에서 제외</span>
        <span>┃ 중앙값(적합 자료 3건 이상일 때)</span>
        {sale ? <span data-testid="strip-sale">초록 선: 내 개인 판매 계산 {formatMoney(sale.amount)}</span> : null}
        {even ? <span data-testid="strip-break-even">빨간 점선: 손익분기 개인 판매금액 {formatMoney(even.amount)}</span> : null}
      </p>
      {strip.omittedForeign > 0 ? (
        <p className="mt-1 text-xs text-stone-600">외화 자료 {strip.omittedForeign}건은 원화 축에 놓을 수 없어 그림에서 뺐습니다(아래 표에는 있습니다).</p>
      ) : null}
    </figure>
  );
}
