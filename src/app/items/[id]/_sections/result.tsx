import { deleteSaleResultAction } from "@/app/actions";
import { ConfirmSubmit, SaleResultForm } from "@/components/client-bits";
import { Badge, Section } from "@/components/ui";
import { heldDays } from "@/lib/domain/purchase";
import { COST_KEYS } from "@/lib/domain/review";
import { formatMoney } from "@/lib/domain/money";
import { COST_LABEL } from "@/lib/domain/net";
import { signed } from "./shared";
import type { ItemView } from "../view";

export function ResultSection({ v }: { v: ItemView }) {
  const { item, today, result, chosenSc, choiceOutdated, resultCostDiffs, acceptedOffer } = v;

  return (
    <Section id="result" step={5} title="실제 판매 결과">
      {result ? (
        <div className="mb-4 space-y-2 text-sm" data-testid="result-summary">
          <div className="flex flex-wrap gap-1.5">
            <Badge tone="neutral" title="내가 직접 기록한 결과이며 외부에서 검증된 체결가가 아닙니다.">
              내가 기록한 결과 · 외부 검증 아님
            </Badge>
          </div>
          <p>
            {result.soldDate} · {result.channel} · 실제 판매금액 <strong>{formatMoney(result.amount)}</strong>
            {result.costTotal !== null ? ` · 실제 비용 ${formatMoney(result.costTotal)}` : " · 실제 비용 모름"}
            {result.minutesSpent !== null ? ` · 들인 시간 ${result.minutesSpent}분` : ""}
          </p>
          {item.purchaseAmount !== null || item.purchaseDate ? (
            <p data-testid="result-vs-purchase">
              {item.purchaseAmount !== null
                ? result.costTotal !== null
                  ? `산 가격 ${formatMoney(item.purchaseAmount)} → 실제 실수령액 ${formatMoney(result.amount - result.costTotal)} (${
                      result.amount - result.costTotal - item.purchaseAmount === 0 ? "같음" : signed(result.amount - result.costTotal - item.purchaseAmount)
                    })`
                  : `산 가격 ${formatMoney(item.purchaseAmount)} — 실제 비용을 몰라 실수령액과 견주지 않았습니다.`
                : ""}
              {heldDays(item.purchaseDate, result.soldDate) !== null
                ? `${item.purchaseAmount !== null ? " · " : ""}산 날부터 판매까지 ${heldDays(item.purchaseDate, result.soldDate)}일`
                : ""}
            </p>
          ) : null}
          {item.chosenSaleAmount !== null ? (
            <ul className="list-disc space-y-1 pl-5" data-testid="result-diff">
              <li>
                판매금액: 선택 당시 {formatMoney(item.chosenSaleAmount)} → 실제 {formatMoney(result.amount)} (
                {signed(result.amount - item.chosenSaleAmount)})
              </li>
              <li>
                실수령액:{" "}
                {item.chosenNetAmount !== null && result.costTotal !== null
                  ? `선택 당시 예상 ${formatMoney(item.chosenNetAmount)} → 실제 ${formatMoney(result.amount - result.costTotal)} (${signed(
                      result.amount - result.costTotal - item.chosenNetAmount,
                    )})`
                  : "예상 또는 실제 비용을 모르는 항목이 있어 비교하지 않았습니다."}
              </li>
            </ul>
          ) : (
            <p className="text-stone-600">판매 방법을 선택하지 않고 판매해서 예상 금액과 비교할 수 없습니다.</p>
          )}
          {resultCostDiffs ? (
            <div data-testid="result-cost-items">
              <p className="font-medium">비용 항목별 (어림 → 실제)</p>
              <ul className="list-disc space-y-0.5 pl-5">
                {COST_KEYS.filter((k) => resultCostDiffs[k].actual !== null).map((k) => {
                  const d = resultCostDiffs[k];
                  return (
                    <li key={k}>
                      {COST_LABEL[k]}: {d.planned !== null ? formatMoney(d.planned) : "어림 없음"} → {formatMoney(d.actual!)}
                      {d.diff !== null ? ` (${d.diff === 0 ? "같음" : signed(d.diff)})` : ""}
                    </li>
                  );
                })}
              </ul>
              {choiceOutdated || !chosenSc ? (
                <p className="text-stone-600">고른 계산이 없거나 선택 뒤에 바뀌어 어림값과는 비교하지 않았습니다.</p>
              ) : null}
            </div>
          ) : null}
          <form action={deleteSaleResultAction}>
            <input type="hidden" name="itemId" value={item.id} />
            <ConfirmSubmit message="판매 결과 기록을 삭제할까요?" className="btn-danger px-2 py-1 text-xs">
              결과 기록 삭제
            </ConfirmSubmit>
          </form>
        </div>
      ) : (
        <p className="mb-3 text-sm text-stone-600">
          팔고 난 뒤 실제 금액을 기록해 두면 예상과 얼마나 달랐는지 확인할 수 있습니다. 저장하면 물건 상태가 ‘판매 완료’로 바뀝니다.
        </p>
      )}
      <SaleResultForm
        itemId={item.id}
        initial={
          result
            ? {
                channel: result.channel,
                soldDate: result.soldDate,
                amount: String(result.amount),
                costTotal: result.costTotal === null ? "" : String(result.costTotal),
                feeActual: result.feeActual === null ? "" : String(result.feeActual),
                shippingActual: result.shippingActual === null ? "" : String(result.shippingActual),
                packingActual: result.packingActual === null ? "" : String(result.packingActual),
                transportActual: result.transportActual === null ? "" : String(result.transportActual),
                minutesSpent: result.minutesSpent === null ? "" : String(result.minutesSpent),
                memo: result.memo ?? "",
              }
            : {
                soldDate: today,
                // 받기로 한 제안이 있으면 그 금액과 판매처를 미리 채운다(고칠 수 있다).
                channel: acceptedOffer?.channel || (item.chosenChannel ?? ""),
                ...(acceptedOffer ? { amount: String(acceptedOffer.amount) } : {}),
              }
        }
      />
    </Section>
  );
}
