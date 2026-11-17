// 물건 화면의 여러 구역이 함께 쓰는 작은 조각들.

import { Badge } from "@/components/ui";
import { vsPurchase } from "@/lib/domain/purchase";
import type { CostScenario } from "@/lib/db/schema";
import { bpToPercentString, formatMoney } from "@/lib/domain/money";
import { COST_LABEL, type NetResult } from "@/lib/domain/net";
import { BASIS_ISSUE_LABEL, type BasisIssue } from "@/lib/domain/scenario";
import { PRICE_TYPE_INFO, type TriState } from "@/lib/domain/types";

export const WINDOWS = [
  { value: "30", label: "최근 30일" },
  { value: "90", label: "최근 90일" },
  { value: "180", label: "최근 180일" },
  { value: "365", label: "최근 1년" },
  { value: "all", label: "전체 기간" },
];

export const TRI_TEXT: Record<TriState, string> = { YES: "있음", NO: "없음", UNKNOWN: "모름" };

export function signed(n: number): string {
  return `${n > 0 ? "+" : ""}${formatMoney(n)}`;
}

export function scenarioInitial(sc: CostScenario | undefined): Record<string, string> {
  if (!sc) return { feeMode: "AMOUNT" };
  const str = (n: number | null) => (n === null ? "" : String(n));
  return {
    channel: sc.channel,
    basisPriceRecordId: str(sc.basisPriceRecordId),
    saleAmount: String(sc.saleAmount),
    feeMode: sc.feeMode,
    feeAmount: str(sc.feeAmount),
    feeRate: sc.feeRateBp === null ? "" : bpToPercentString(sc.feeRateBp),
    shipping: str(sc.shipping),
    packing: str(sc.packing),
    transport: str(sc.transport),
    expectedMinutes: str(sc.expectedMinutes),
    memo: sc.memo ?? "",
  };
}

/** tid: 그 방식의 기준 계산(또는 하나뿐인 계산)이면 방식 이름, 아니면 방식-계산 id. */
export function NetBox({
  sc,
  net,
  issues,
  tid,
  purchaseAmount,
}: {
  sc: CostScenario;
  net: NetResult;
  issues: BasisIssue[];
  tid: string;
  purchaseAmount: number | null;
}) {
  const overPurchase = vsPurchase(net.net, purchaseAmount);
  const basisType = sc.basisPriceType;
  const row = (label: string, value: number | null) => (
    <div className="flex justify-between gap-4">
      <dt className="text-stone-700">− {label}</dt>
      <dd className={value === null ? "font-medium text-amber-900" : ""}>{value === null ? "모름" : formatMoney(value)}</dd>
    </div>
  );
  return (
    <div className="rounded-md border border-stone-300 bg-stone-50 p-3 text-sm">
      <div className="mb-2 flex flex-wrap gap-1.5">
        {basisType === "BUYBACK_QUOTE" ? (
          <Badge tone="amber">매입 견적 기준</Badge>
        ) : basisType ? (
          <Badge tone="neutral">예상 금액 · {PRICE_TYPE_INFO[basisType].label} 참고</Badge>
        ) : (
          <Badge tone="neutral">직접 입력한 예상 금액</Badge>
        )}
        {issues.includes("BASIS_EXPIRED") ? <Badge tone="red">견적 만료</Badge> : null}
        {issues.some((i) => i !== "BASIS_EXPIRED") ? <Badge tone="red">기준 자료 변경됨</Badge> : null}
      </div>
      {issues.length > 0 ? (
        <div className="warn mb-2" data-testid={`basis-issues-${tid}`}>
          {issues.map((i) => (
            <p key={i}>{BASIS_ISSUE_LABEL[i]}</p>
          ))}
          <p className="mt-1">아래에서 기준 금액을 다시 고르고 저장해 주세요. 그 전까지 이 방법은 선택할 수 없습니다.</p>
        </div>
      ) : null}
      <dl className="space-y-1">
        <div className="flex justify-between gap-4">
          <dt className="text-stone-700">{sc.method === "BUYBACK" ? "매입 금액" : "예상 판매금액"}</dt>
          <dd>{formatMoney(sc.saleAmount)}</dd>
        </div>
        {row(
          sc.feeMode === "RATE" && sc.feeRateBp !== null ? `수수료 (${bpToPercentString(sc.feeRateBp)}%)` : "수수료",
          net.fee,
        )}
        {row("내가 내는 배송비", sc.shipping)}
        {row("포장비", sc.packing)}
        {row("교통비", sc.transport)}
        <div className="flex justify-between gap-4 border-t border-stone-300 pt-1 text-base font-semibold">
          <dt>예상 실수령액</dt>
          <dd data-testid={`net-${tid}`}>{net.complete ? formatMoney(net.net!) : "계산 불완전"}</dd>
        </div>
      </dl>
      {!net.complete ? (
        <p className="warn mt-2">
          {net.missing.map((k) => COST_LABEL[k]).join(", ")}을(를) 아직 입력하지 않았습니다. 입력한 비용만 빼면{" "}
          {formatMoney(net.netBeforeMissing)}이지만, 실제로 남는 금액은 이보다 적을 수 있습니다.
        </p>
      ) : null}
      {sc.expectedMinutes !== null ? (
        <p className="mt-2 text-stone-700">내가 어림한 소요시간: {sc.expectedMinutes}분</p>
      ) : null}
      {overPurchase !== null ? (
        <p className="mt-2 text-stone-700" data-testid={`vs-purchase-${tid}`}>
          산 가격({formatMoney(purchaseAmount!)})과 견주면 {overPurchase === 0 ? "같음" : signed(overPurchase)}
        </p>
      ) : null}
      {sc.memo ? <p className="mt-1 whitespace-pre-wrap text-stone-700">메모: {sc.memo}</p> : null}
    </div>
  );
}
