import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/client-bits";
import { Badge } from "@/components/ui";
import { getDb } from "@/lib/db/client";
import { getItem, listPrices, listScenarios } from "@/lib/db/repo";
import { isQuoteExpired } from "@/lib/domain/compare";
import { formatMoney } from "@/lib/domain/money";
import { computeNet } from "@/lib/domain/net";
import { chosenScenario, scenarioLabel } from "@/lib/domain/scenario";
import { CATEGORY_LABEL, CONDITION_LABEL, PRICE_TYPE_INFO, SALE_METHOD_LABEL, type TriState } from "@/lib/domain/types";
import { isDemoMode } from "@/lib/mode";
import { todayYmd } from "@/lib/today";
import { itemTitle } from "../meta";

const TRI: Record<TriState, string | null> = { YES: "있음", NO: "없음", UNKNOWN: null };

// 물건 한 장 요약. 매입 매장에 가져가거나 인쇄해 두는 용도라 내 메모와 산 가격은 넣지 않는다.

export function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  return itemTitle(params, "한 장 요약");
}

export default async function ItemSummaryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const demo = await isDemoMode();
  const item = /^\d+$/.test(id) ? getItem(db, demo, Number(id)) : undefined;
  if (!item) notFound();
  const today = todayYmd();
  const prices = listPrices(db, item.id);
  const quotes = prices.filter((p) => p.priceType === "BUYBACK_QUOTE").sort((a, b) => b.checkedDate.localeCompare(a.checkedDate) || b.id - a.id);
  const scenarios = listScenarios(db, item.id);
  const chosen = chosenScenario(item, scenarios);
  const facts: [string, string | null][] = [
    ["품목", CATEGORY_LABEL[item.category]],
    [item.category === "BOOK" ? "ISBN" : "모델명", item.identifier],
    ["상태", CONDITION_LABEL[item.condition]],
    ["하자", item.defects],
    ["구성품", item.components],
    ...(item.category === "BOOK"
      ? ([
          ["저자", item.author],
          ["출판사", item.publisher],
          ["판본", item.edition],
          ["필기", TRI[item.hasWriting]],
          ["밑줄", TRI[item.hasUnderline]],
          ["파손", TRI[item.hasDamage]],
          ["부록", TRI[item.hasSupplement]],
        ] as [string, string | null][])
      : []),
  ];

  return (
    <div className="space-y-4" data-testid="item-summary">
      <div className="no-print flex flex-wrap items-center justify-between gap-2 text-sm">
        <Link href={`/items/${item.id}`} className="underline">
          ← {item.name}
        </Link>
        <PrintButton />
      </div>
      <div className="card space-y-1">
        <h1 className="text-xl font-bold">{item.name}</h1>
        <p className="text-xs text-stone-600">
          {today} 기준 요약{demo ? " · 가상 데이터(데모)" : ""}. 내 메모와 산 가격은 넣지 않았습니다.
        </p>
        {item.isDemo ? <Badge tone="amber">가상 데이터</Badge> : null}
      </div>

      <section className="card" aria-labelledby="s-facts">
        <h2 id="s-facts" className="mb-2 font-semibold">물건 정보</h2>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          {facts
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <div key={k} className="flex gap-2">
                <dt className="w-20 shrink-0 text-stone-600">{k}</dt>
                <dd className="whitespace-pre-wrap">{v}</dd>
              </div>
            ))}
        </dl>
      </section>

      <section className="card" aria-labelledby="s-quotes">
        <h2 id="s-quotes" className="mb-2 font-semibold">받은 매입 견적</h2>
        {quotes.length === 0 ? (
          <p className="text-sm text-stone-600">기록한 매입 견적이 없습니다.</p>
        ) : (
          <table className="w-full text-left text-sm" data-testid="summary-quotes">
            <thead className="text-xs text-stone-600">
              <tr>
                <th scope="col" className="py-1 pr-3 font-medium">업체</th>
                <th scope="col" className="py-1 pr-3 font-medium">금액</th>
                <th scope="col" className="py-1 pr-3 font-medium">확인일</th>
                <th scope="col" className="py-1 pr-3 font-medium">유효기간</th>
                <th scope="col" className="py-1 pr-3 font-medium">감액 조건</th>
              </tr>
            </thead>
            <tbody>
              {quotes.map((q) => (
                <tr key={q.id} className="border-t border-stone-200 align-top">
                  <td className="py-1 pr-3">{q.sourceName}</td>
                  <td className="whitespace-nowrap py-1 pr-3">{formatMoney(q.amountMinor, q.currency)}</td>
                  <td className="whitespace-nowrap py-1 pr-3">{q.checkedDate}</td>
                  <td className="whitespace-nowrap py-1 pr-3">
                    {q.quoteValidUntil ?? "기록 없음"}
                    {isQuoteExpired(q, today) ? " (만료)" : ""}
                  </td>
                  <td className="py-1 pr-3">{q.deductionTerms ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="mt-2 text-xs text-stone-600">{PRICE_TYPE_INFO.BUYBACK_QUOTE.help}</p>
      </section>

      <section className="card" aria-labelledby="s-calc">
        <h2 id="s-calc" className="mb-2 font-semibold">내 계산</h2>
        {scenarios.length === 0 ? (
          <p className="text-sm text-stone-600">저장한 계산이 없습니다.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {scenarios.map((sc) => {
              const net = computeNet(sc);
              return (
                <li key={sc.id}>
                  {scenarioLabel(SALE_METHOD_LABEL[sc.method], sc.channel)}: 금액 {formatMoney(sc.saleAmount)} → 예상 실수령액{" "}
                  {net.complete ? formatMoney(net.net!) : "계산 불완전(모르는 비용 있음)"}
                  {chosen?.id === sc.id ? " · 고른 방법" : ""}
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-2 text-xs text-stone-600">내가 입력한 금액과 비용으로 한 계산이며 실제로 받을 금액을 보장하지 않습니다.</p>
      </section>
    </div>
  );
}
