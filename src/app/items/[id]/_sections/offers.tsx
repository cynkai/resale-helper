import { deleteOfferAction, setOfferStatusAction } from "@/app/actions";
import { ConfirmSubmit, OfferForm } from "@/components/client-bits";
import { Badge, Section } from "@/components/ui";
import { evaluateOffer, OFFER_STATUS_LABEL, OFFER_STATUSES, pickOfferScenario } from "@/lib/domain/offer";
import { formatMoney } from "@/lib/domain/money";
import { COST_LABEL } from "@/lib/domain/net";
import { needsPrimary, scenarioLabel } from "@/lib/domain/scenario";
import { SALE_METHOD_LABEL } from "@/lib/domain/types";
import { signed } from "./shared";
import type { ItemView } from "../view";

export function OffersSection({ v }: { v: ItemView }) {
  const { item, today, scenarios, channelNames, offers, offerCounts, offerBuybackNet } = v;

  return (
    <Section id="offers" title="받은 제안">
      <p className="text-sm text-stone-700">
        구매 희망자가 부른 금액을 적어 두면, 그 금액을 내 개인 판매 계산의 비용에 넣어 따져 봅니다. 입력한 숫자로 한 산수이며, 받을지 말지는 직접
        판단해 주세요. 가격 자료와 따로 두고 비교·요약에는 넣지 않습니다.
      </p>
      {offers.length > 0 ? (
        <>
          <p className="mt-3 text-sm" data-testid="offer-counts">
            기록 {offers.length}건 — {OFFER_STATUSES.map((st) => `${OFFER_STATUS_LABEL[st]} ${offerCounts[st]}건`).join(", ")}
          </p>
          <ul className="mt-2 divide-y divide-stone-200 text-sm">
            {offers.map((o) => {
              const sc = pickOfferScenario(scenarios, item, o.channel);
              const ev = sc ? evaluateOffer(o.amount, sc, offerBuybackNet) : null;
              return (
                <li key={o.id} className="space-y-1 py-3" data-testid={`offer-${o.id}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <strong>{formatMoney(o.amount)}</strong>
                    <span className="text-stone-600">
                      {o.receivedDate}
                      {o.channel ? ` · ${o.channel}` : ""}
                    </span>
                    <Badge tone={o.status === "ACCEPTED" ? "teal" : o.status === "DECLINED" ? "neutral" : "amber"}>
                      {OFFER_STATUS_LABEL[o.status]}
                    </Badge>
                  </div>
                  {sc && ev ? (
                    <ul className="list-disc space-y-0.5 pl-5 text-stone-700">
                      <li>
                        {scenarioLabel(SALE_METHOD_LABEL.DIRECT, sc.channel)} 계산의 예상 판매금액 {formatMoney(sc.saleAmount)}보다{" "}
                        {ev.vsPlanned === 0 ? "같음" : signed(ev.vsPlanned)}
                      </li>
                      <li>
                        이 금액에 팔면 예상 실수령액{" "}
                        {ev.net.complete ? (
                          <strong>{formatMoney(ev.net.net!)}</strong>
                        ) : (
                          <span className="text-amber-900">
                            계산 불완전({ev.net.missing.map((k) => COST_LABEL[k]).join(", ")} 미입력)
                          </span>
                        )}
                        {ev.vsBuybackNet !== null
                          ? ` · 업체 판매 실수령액보다 ${ev.vsBuybackNet === 0 ? "같음" : signed(ev.vsBuybackNet)}`
                          : ev.net.complete
                            ? " · 업체 판매 계산이 없거나 불완전해 비교하지 않음"
                            : ""}
                      </li>
                    </ul>
                  ) : (
                    <p className="text-amber-900">
                      {needsPrimary(scenarios, "DIRECT")
                        ? "개인 판매 계산이 여러 개입니다. 제안에 판매처 이름을 적거나 2단계에서 기준 계산을 정하면 따져 볼 수 있습니다."
                        : "개인 판매 금액·비용을 2단계에서 저장하면 이 제안의 실수령액을 따져 볼 수 있습니다."}
                    </p>
                  )}
                  {o.memo ? <p className="whitespace-pre-wrap text-stone-700">메모: {o.memo}</p> : null}
                  <div className="flex flex-wrap gap-2">
                    {OFFER_STATUSES.filter((st) => st !== o.status).map((st) => (
                      <form key={st} action={setOfferStatusAction}>
                        <input type="hidden" name="itemId" value={item.id} />
                        <input type="hidden" name="offerId" value={o.id} />
                        <input type="hidden" name="status" value={st} />
                        <button type="submit" className="btn px-2 py-0.5 text-xs">
                          {st === "OPEN" ? "답하지 않음으로 되돌리기" : `${OFFER_STATUS_LABEL[st]}으로 표시`}
                        </button>
                      </form>
                    ))}
                    <form action={deleteOfferAction}>
                      <input type="hidden" name="itemId" value={item.id} />
                      <input type="hidden" name="offerId" value={o.id} />
                      <ConfirmSubmit message="이 제안 기록을 지울까요?" className="btn-danger px-2 py-0.5 text-xs">
                        지우기
                      </ConfirmSubmit>
                    </form>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
      <div className="mt-3">
        <OfferForm itemId={item.id} today={today} channelNames={channelNames} />
      </div>
    </Section>
  );
}
