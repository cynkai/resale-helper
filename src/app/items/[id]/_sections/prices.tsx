import Link from "next/link";
import { bulkPriceAction, deletePriceAction, recheckPriceAction, togglePriceAction } from "@/app/actions";
import { ConfirmSubmit, CsvImportForm } from "@/components/client-bits";
import { convertToKrw, fxRateToPlain } from "@/lib/domain/fx";
import { Badge, PriceTypeBadge, Section } from "@/components/ui";
import type { PriceRecord } from "@/lib/db/schema";
import { daysBetween, EXCLUSION_LABEL, isQuoteExpired, PRICE_SORT_LABEL, PRICE_SORTS, sortForDisplay, WARNING_LABEL, type Classified } from "@/lib/domain/compare";
import { CSV_COLUMNS } from "@/lib/domain/csv";
import { formatMoney } from "@/lib/domain/money";
import { BUNDLE_LABEL, CONDITION_LABEL, DISCLAIMER, INPUT_ROUTE_LABEL, MIN_SAMPLES_FOR_SUMMARY, PRICE_TYPE_INFO, PRICE_TYPES } from "@/lib/domain/types";
import { WINDOWS } from "./shared";
import type { ItemView } from "../view";

export function PricesSection({ v }: { v: ItemView }) {
  const { item, today, windowParam, priceSort, hideExcluded, pricesHref, prices, history, comparison, pastSales } = v;
  const priceRow = (c: Classified<PriceRecord>) => {
    const p = c.record;
    const age = daysBetween(p.checkedDate, today);
    const expired = isQuoteExpired(p, today);
    return (
      <tr key={p.id} className={c.eligible ? "" : "bg-stone-50 text-stone-600"}>
        <td className="whitespace-nowrap px-2 py-2 align-top font-medium">
          {formatMoney(p.amountMinor, p.currency)}
          {p.currency !== "KRW" && p.fxRateE4 !== null && p.fxDate !== null ? (
            <div className="mt-0.5 whitespace-normal text-xs font-normal text-stone-600" data-testid={`fx-${p.id}`}>
              환산 참고 약 {formatMoney(convertToKrw(p.amountMinor, p.currency, p.fxRateE4))}
              <br />
              (내가 입력한 환율: 1 {p.currency} = {fxRateToPlain(p.fxRateE4)}원, 기준일 {p.fxDate})
            </div>
          ) : null}
          <div className="mt-1 flex flex-wrap gap-1 font-normal">
            {p.isDemo ? <Badge tone="amber">가상</Badge> : null}
            {p.bundleType === "BUNDLE" ? <Badge>{BUNDLE_LABEL.BUNDLE}</Badge> : null}
          </div>
          {history.get(p.id)?.length ? (
            <details className="mt-1 text-xs font-normal text-stone-600" data-testid={`price-history-${p.id}`}>
              <summary className="cursor-pointer">이전 값 {history.get(p.id)!.length}건</summary>
              <ul className="mt-1 space-y-0.5">
                {history.get(p.id)!.map((h) => (
                  <li key={h.id}>
                    {h.checkedDate} 확인: {formatMoney(h.amountMinor, h.currency)}
                    {h.priceType !== p.priceType ? ` (당시 유형: ${PRICE_TYPE_INFO[h.priceType].label})` : ""}
                  </li>
                ))}
              </ul>
              <p className="mt-1">이 매물을 전에 확인했을 때의 값입니다(고치거나 다시 확인하면 남습니다). 비교와 요약에는 지금 값만 씁니다.</p>
            </details>
          ) : null}
        </td>
        <td className="px-2 py-2 align-top">
          {p.sourceUrl ? (
            <a href={p.sourceUrl} target="_blank" rel="noopener noreferrer nofollow" className="underline">
              {p.sourceName}
            </a>
          ) : (
            p.sourceName
          )}
          <div className="text-xs text-stone-600">{INPUT_ROUTE_LABEL[p.inputRoute]}</div>
        </td>
        <td className="whitespace-nowrap px-2 py-2 align-top">
          {p.checkedDate}
          <div className="text-xs text-stone-600">{age === 0 ? "오늘 확인" : `${age}일 전 확인`}</div>
          {p.tradeDate ? <div className="text-xs text-stone-600">거래일 {p.tradeDate}</div> : null}
        </td>
        <td className="px-2 py-2 align-top text-xs">
          <div>상태: {p.condition ? CONDITION_LABEL[p.condition] : "모름"}</div>
          <div>배송비: {p.shippingIncluded === "YES" ? "포함" : p.shippingIncluded === "NO" ? "미포함" : "모름"}</div>
          {p.componentsMatch !== "UNKNOWN" ? <div>구성: {p.componentsMatch === "YES" ? "내 물건과 같음" : "내 물건과 다름"}</div> : null}
          {p.priceType === "BUYBACK_QUOTE" ? (
            <div className={expired ? "font-medium text-red-800" : ""}>
              유효기간: {p.quoteValidUntil ?? "기록 없음"}
              {expired ? " (만료)" : ""}
            </div>
          ) : null}
          {p.deductionTerms ? <div>감액 조건: {p.deductionTerms}</div> : null}
          {p.memo ? <div className="text-stone-600">메모: {p.memo}</div> : null}
        </td>
        <td className="px-2 py-2 align-top text-xs">
          {c.eligible ? (
            <Badge tone="teal">비교에 포함</Badge>
          ) : (
            <div className="flex flex-wrap gap-1">
              {c.exclusions.map((x) => (
                <Badge key={x} tone={x === "QUOTE_EXPIRED" ? "red" : "neutral"}>
                  제외: {EXCLUSION_LABEL[x]}
                </Badge>
              ))}
            </div>
          )}
          {c.warnings.length > 0 ? (
            <div className="mt-1 text-amber-900">{c.warnings.map((w) => WARNING_LABEL[w]).join(", ")}</div>
          ) : null}
        </td>
        <td className="px-2 py-2 align-top">
          <label className="mb-1 flex items-center gap-1 text-xs text-stone-700">
            <input
              type="checkbox"
              form="bulk-prices"
              name="priceIds"
              value={p.id}
              aria-label={`${p.sourceName} ${formatMoney(p.amountMinor, p.currency)} 선택`}
            />
            선택
          </label>
          <div className="flex flex-wrap gap-1">
            <form action={togglePriceAction}>
              <input type="hidden" name="itemId" value={item.id} />
              <input type="hidden" name="priceId" value={p.id} />
              <input type="hidden" name="include" value={p.includedInComparison ? "0" : "1"} />
              <button type="submit" className="btn px-2 py-1 text-xs" aria-label={`${p.sourceName} ${formatMoney(p.amountMinor, p.currency)} ${p.includedInComparison ? "비교에서 빼기" : "다시 포함"}`}>
                {p.includedInComparison ? "빼기" : "다시 포함"}
              </button>
            </form>
            {age > 0 ? (
              <form action={recheckPriceAction}>
                <input type="hidden" name="itemId" value={item.id} />
                <input type="hidden" name="priceId" value={p.id} />
                <ConfirmSubmit
                  message="출처에서 다시 확인했더니 가격이 그대로였나요? 확인일을 오늘로 바꾸고 이전 확인일은 '이전 값'에 남깁니다. 가격이 바뀌었다면 '수정'을 눌러 주세요."
                  className="btn px-2 py-1 text-xs"
                >
                  오늘 다시 확인함
                </ConfirmSubmit>
              </form>
            ) : null}
                        <Link href={`/items/${item.id}/prices/${p.id}/edit`} className="btn px-2 py-1 text-xs">
              수정
            </Link>
            <form action={deletePriceAction}>
              <input type="hidden" name="itemId" value={item.id} />
              <input type="hidden" name="priceId" value={p.id} />
              <ConfirmSubmit message="이 가격 자료를 삭제할까요?" className="btn-danger px-2 py-1 text-xs">
                삭제
              </ConfirmSubmit>
            </form>
          </div>
        </td>
      </tr>
    );
  };

  return (
    <Section
      id="prices"
      step={1}
      title="가격 자료와 비교"
      aside={
        <div className="flex flex-wrap gap-2">
          <Link href={`/items/${item.id}/prices/new`} className="btn-primary">
            가격 자료 추가
          </Link>
          {prices.length > 0 ? (
            <a href={`/api/export/prices?itemId=${item.id}`} className="btn">
              CSV 내보내기
            </a>
          ) : null}
        </div>
      }
    >
      <p className="notice">{DISCLAIMER}</p>

      {pastSales.length > 0 ? (
        <div className="mt-3 rounded-md border border-stone-200 p-3 text-sm" data-testid="past-sales">
          <p className="font-medium">
            내가 전에 같은 {item.category === "BOOK" ? "ISBN" : "모델명"}의 물건을 판 기록 {pastSales.length}건
          </p>
          <p className="mt-1 text-xs text-stone-600">
            내가 기록한 판매 결과입니다. 그때의 상태·구성·시기가 지금과 다를 수 있어 가격 비교와 요약에는 넣지 않습니다.
          </p>
          <ul className="mt-2 space-y-1">
            {pastSales.map((ps) => (
              <li key={ps.itemId}>
                <span className="text-stone-600">{ps.soldDate}</span> · {ps.channel} ·{" "}
                <strong>{formatMoney(ps.amount)}</strong>
                {ps.costTotal !== null ? ` (실수령 ${formatMoney(ps.amount - ps.costTotal)})` : ""} · 상태 {CONDITION_LABEL[ps.condition]}
                {ps.components ? ` · 구성 ${ps.components}` : ""} ·{" "}
                <Link href={`/items/${ps.itemId}#result`} className="underline">
                  {ps.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <details className="mt-3 text-sm">
        <summary className="cursor-pointer font-medium">가격 유형 설명 보기</summary>
        <dl className="mt-2 space-y-1.5">
          {PRICE_TYPES.map((t) => (
            <div key={t} className="flex flex-wrap items-baseline gap-2">
              <dt>
                <PriceTypeBadge type={t} />
              </dt>
              <dd className="text-stone-700">{PRICE_TYPE_INFO[t].help}</dd>
            </div>
          ))}
        </dl>
      </details>

      {prices.length === 0 ? (
        <div className="mt-4 rounded-md border border-dashed border-stone-300 p-6 text-center">
          <p className="font-medium">가격 자료 없음</p>
          <p className="mt-1 text-sm text-stone-600">
            이 앱은 가격을 자동으로 찾아 주지 않습니다. 중고 장터의 판매글이나 매입업체 견적을 직접 확인해 추가하거나 CSV로 가져와 주세요.
          </p>
        </div>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-stone-700">기준 기간(확인일):</span>
            {WINDOWS.map((w) => (
              <Link
                key={w.value}
                href={pricesHref({ days: w.value })}
                aria-current={w.value === windowParam ? "true" : undefined}
                className={`rounded-full border px-2.5 py-0.5 ${
                  w.value === windowParam ? "border-teal-800 bg-teal-800 text-white" : "border-stone-300 bg-white hover:bg-stone-100"
                }`}
              >
                {w.label}
              </Link>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm" data-testid="price-sort">
            <span className="text-stone-700">보기 순서:</span>
            {PRICE_SORTS.map((so) => (
              <Link
                key={so}
                href={pricesHref({ sort: so })}
                aria-current={so === priceSort ? "true" : undefined}
                className={`rounded-full border px-2.5 py-0.5 ${
                  so === priceSort ? "border-teal-800 bg-teal-50 font-medium" : "border-stone-300 bg-white hover:bg-stone-100"
                }`}
              >
                {PRICE_SORT_LABEL[so]}
              </Link>
            ))}
            {comparison.excludedCount > 0 ? (
              <Link href={pricesHref({ hide: !hideExcluded })} className="underline" data-testid="toggle-excluded">
                {hideExcluded ? `제외된 자료 ${comparison.excludedCount}건 보이기` : "제외된 자료 숨기기"}
              </Link>
            ) : null}
          </div>
          <p className="mt-2 text-sm text-stone-700">
            전체 {prices.length}건 중 비교에 포함 {comparison.eligibleCount}건, 제외 {comparison.excludedCount}건. 유형이 다른 가격은 서로 합치지 않습니다.
          </p>

          <form id="bulk-prices" action={bulkPriceAction} className="mt-3 flex flex-wrap items-center gap-2 text-sm" data-testid="bulk-prices">
            <input type="hidden" name="itemId" value={item.id} />
            <span className="text-stone-700">‘선택’으로 고른 자료를 한꺼번에:</span>
            <button type="submit" name="op" value="EXCLUDE" className="btn px-2 py-1 text-xs">
              비교에서 빼기
            </button>
            <button type="submit" name="op" value="INCLUDE" className="btn px-2 py-1 text-xs">
              다시 포함
            </button>
            <ConfirmSubmit
              name="op"
              value="RECHECK"
              message="고른 자료를 출처에서 다시 확인했더니 가격이 그대로였나요? 확인일을 오늘로 바꾸고 이전 확인일은 '이전 값'에 남깁니다. 가격이 바뀐 자료는 고르지 말고 '수정'을 눌러 주세요."
              className="btn px-2 py-1 text-xs"
            >
              오늘 다시 확인함
            </ConfirmSubmit>
            <ConfirmSubmit
              name="op"
              value="DELETE"
              message="고른 가격 자료를 지웁니다. 되돌릴 수 없습니다. 계속할까요?"
              className="btn-danger px-2 py-1 text-xs"
            >
              삭제
            </ConfirmSubmit>
          </form>

          <div className="mt-3 space-y-5">
            {comparison.groups.map((g) => (
              <div key={g.priceType} data-testid={`group-${g.priceType}`}>
                <h3 className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                  <PriceTypeBadge type={g.priceType} />
                  <span className="font-normal text-stone-700">
                    포함 {g.eligible.length}건{g.excluded.length > 0 ? ` · 제외 ${g.excluded.length}건` : ""}
                  </span>
                </h3>
                {g.summary ? (
                  <p className="mt-1.5 text-sm" data-testid={`summary-${g.priceType}`}>
                    <strong>
                      {PRICE_TYPE_INFO[g.priceType].summaryLabel} {formatMoney(g.summary.median)}
                    </strong>{" "}
                    · 범위 {formatMoney(g.summary.min)} ~ {formatMoney(g.summary.max)} · {g.summary.count}건 기준
                  </p>
                ) : (
                  <p className="mt-1.5 text-sm text-stone-700" data-testid={`nosummary-${g.priceType}`}>
                    {g.eligible.length === 0
                      ? "비교에 포함할 수 있는 자료가 없습니다."
                      : `포함된 자료가 ${g.eligible.length}건뿐이라 요약 가격을 내지 않습니다(${MIN_SAMPLES_FOR_SUMMARY}건 이상일 때 표시). 아래 개별 자료를 참고해 주세요.`}
                  </p>
                )}
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full min-w-[640px] border-collapse text-sm">
                    <caption className="sr-only">{PRICE_TYPE_INFO[g.priceType].label} 자료 목록</caption>
                    <thead>
                      <tr className="border-b border-stone-300 text-left text-xs text-stone-600">
                        <th scope="col" className="px-2 py-1 font-medium">금액</th>
                        <th scope="col" className="px-2 py-1 font-medium">출처</th>
                        <th scope="col" className="px-2 py-1 font-medium">확인일</th>
                        <th scope="col" className="px-2 py-1 font-medium">조건</th>
                        <th scope="col" className="px-2 py-1 font-medium">비교 여부</th>
                        <th scope="col" className="px-2 py-1 font-medium">관리</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-200">
                      {[...sortForDisplay(g.eligible, priceSort), ...(hideExcluded ? [] : sortForDisplay(g.excluded, priceSort))].map(priceRow)}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <details className="mt-5 rounded-md border border-stone-200 p-3 text-sm">
        <summary className="cursor-pointer font-medium">CSV로 한꺼번에 가져오기</summary>
        <div className="mt-3 space-y-3">
          <p className="text-stone-700">
            첫 줄은 열 이름입니다. 필수 열: <code>price_type, amount, source_name, checked_date</code>. 사용할 수 있는 열:{" "}
            <code>{CSV_COLUMNS.map((c) => c.header).join(", ")}</code>
          </p>
          <pre className="overflow-x-auto rounded bg-stone-100 p-2 text-xs">
            {`price_type,amount,currency,source_name,source_url,checked_date,condition,memo
ASKING,15000,KRW,○○마켓,https://example.com/item/1,${today},GOOD,
BUYBACK_QUOTE,6000,KRW,○○서점,,${today},GOOD,매장 방문 견적`}
          </pre>
          <p className="text-stone-700">
            price_type은 ASKING, SOLD_LISTING, BUYBACK_QUOTE, USER_REPORTED 중 하나입니다(VERIFIED_SALE은 가져올 수 없음). 오류가 있는 행은 건너뛰고 행 번호와 이유를 알려 드립니다.
          </p>
          <CsvImportForm itemId={item.id} />
        </div>
      </details>
    </Section>
  );
}
