import Link from "next/link";
import { Badge } from "@/components/ui";
import { getDb } from "@/lib/db/client";
import { listSaleReviews } from "@/lib/db/repo";
import { formatMoney } from "@/lib/domain/money";
import { countOutcomes, reviewRow } from "@/lib/domain/review";
import { CATEGORY_LABEL, SALE_METHOD_LABEL } from "@/lib/domain/types";
import { isDemoMode } from "@/lib/mode";

function signed(n: number | null, unit: "won" | "min"): string {
  if (n === null) return "—";
  const sign = n > 0 ? "+" : "";
  return unit === "won" ? `${sign}${formatMoney(n)}` : `${sign}${n}분`;
}

function tone(n: number | null): string {
  if (n === null || n === 0) return "";
  return n > 0 ? "text-teal-900" : "text-red-800";
}

export default async function ResultsPage() {
  const demo = await isDemoMode();
  const rows = listSaleReviews(getDb(), demo).map((r) => ({
    ...r,
    review: reviewRow({
      chosenSaleAmount: r.item.chosenSaleAmount,
      chosenNetAmount: r.item.chosenNetAmount,
      expectedMinutes: r.expectedMinutes,
      amount: r.result.amount,
      costTotal: r.result.costTotal,
      minutesSpent: r.result.minutesSpent,
    }),
  }));
  const counts = countOutcomes(rows.map((r) => r.review));

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">판매 결과 돌아보기{demo ? " (데모)" : ""}</h1>
      <p className="notice">
        판매 방법을 고를 때의 예상과, 팔고 난 뒤 직접 기록한 결과를 물건별로 비교합니다. 실제 결과는 내가 기록한 값이며 외부에서 검증된 거래가격이 아닙니다.
        물건마다 기준과 비용 항목이 달라 금액을 합친 총액은 보여 주지 않습니다.
      </p>

      {rows.length === 0 ? (
        <div className="card py-10 text-center">
          <p className="font-medium">아직 기록한 판매 결과가 없습니다.</p>
          <p className="mt-1 text-sm text-stone-600">물건 상세 화면의 ‘5. 판매 결과’에서 실제로 판 금액을 기록하면 여기에 모입니다.</p>
          <Link href="/" className="btn mt-4">
            내 물건 보기
          </Link>
        </div>
      ) : (
        <>
          <section aria-label="요약" className="card text-sm" data-testid="review-counts">
            <p>
              기록 {rows.length}건 — 실수령액이 예상보다 <strong>많음 {counts.ABOVE}건</strong>, <strong>같음 {counts.EQUAL}건</strong>,{" "}
              <strong>적음 {counts.BELOW}건</strong>, 비교 불가 {counts.UNKNOWN}건
            </p>
            {counts.UNKNOWN > 0 ? (
              <p className="mt-1 text-stone-600">
                비교 불가: 판매 방법을 고르지 않았거나, 선택 당시 또는 실제 비용을 모르는 기록입니다.
              </p>
            ) : null}
          </section>

          <div className="card overflow-x-auto p-0">
            <table className="w-full min-w-[760px] border-collapse text-sm">
              <caption className="sr-only">판매 결과와 예상 비교</caption>
              <thead>
                <tr className="border-b border-stone-300 text-left text-xs text-stone-600">
                  <th scope="col" className="px-3 py-2 font-medium">물건</th>
                  <th scope="col" className="px-3 py-2 font-medium">판매</th>
                  <th scope="col" className="px-3 py-2 font-medium">판매금액 (예상 → 실제)</th>
                  <th scope="col" className="px-3 py-2 font-medium">실수령액 (예상 → 실제)</th>
                  <th scope="col" className="px-3 py-2 font-medium">시간 (어림 → 실제)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-200">
                {rows.map(({ item, result, expectedMinutes, review }) => (
                  <tr key={result.id} data-testid={`review-${item.id}`}>
                    <td className="px-3 py-2 align-top">
                      <Link href={`/items/${item.id}#result`} className="font-medium underline">
                        {item.name}
                      </Link>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {item.isDemo ? <Badge tone="amber">가상</Badge> : null}
                        <Badge>{CATEGORY_LABEL[item.category]}</Badge>
                      </div>
                    </td>
                    <td className="px-3 py-2 align-top">
                      {result.soldDate}
                      <div className="text-xs text-stone-600">{result.channel}</div>
                      <div className="text-xs text-stone-600">
                        {item.chosenMethod ? `선택: ${SALE_METHOD_LABEL[item.chosenMethod]}` : "방법 선택 안 함"}
                      </div>
                    </td>
                    <td className="px-3 py-2 align-top">
                      {item.chosenSaleAmount !== null ? formatMoney(item.chosenSaleAmount) : "—"} → {formatMoney(result.amount)}
                      <div className={`text-xs ${tone(review.saleDiff)}`}>{signed(review.saleDiff, "won")}</div>
                    </td>
                    <td className="px-3 py-2 align-top">
                      {item.chosenNetAmount !== null ? formatMoney(item.chosenNetAmount) : "모름"} →{" "}
                      {review.actualNet !== null ? formatMoney(review.actualNet) : "모름"}
                      <div className={`text-xs ${tone(review.netDiff)}`}>{signed(review.netDiff, "won")}</div>
                    </td>
                    <td className="px-3 py-2 align-top">
                      {expectedMinutes !== null ? `${expectedMinutes}분` : "모름"} →{" "}
                      {result.minutesSpent !== null ? `${result.minutesSpent}분` : "모름"}
                      <div className="text-xs text-stone-700">{signed(review.minutesDiff, "min")}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
