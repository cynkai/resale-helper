import { chooseMethodAction } from "@/app/actions";
import { Section } from "@/components/ui";
import { formatMoney } from "@/lib/domain/money";
import { scenarioLabel } from "@/lib/domain/scenario";
import { SALE_METHOD_LABEL, SALE_METHODS } from "@/lib/domain/types";
import type { ItemView } from "../view";

export function ChooseSection({ v }: { v: ItemView }) {
  const { item, scenarios, byMethod, ofMethod, netOf, issuesOf, issuesByMethod, undecidedPrimary, chosenSc, diff, directSc, breakEven, choiceOutdated } = v;

  return (
    <Section id="choose" step={3} title="판매 방법 선택">
      {scenarios.length === 0 ? (
        <p className="text-sm text-stone-600">위 2단계에서 금액과 비용을 저장하면 여기에서 두 방법을 비교하고 선택할 수 있습니다.</p>
      ) : (
        <div className="space-y-3 text-sm">
          <p data-testid="net-diff" className={diff === null ? "warn" : "notice"}>
            {diff === null
              ? undecidedPrimary.length > 0
                ? `${undecidedPrimary.map((m) => SALE_METHOD_LABEL[m]).join(", ")} 계산이 여러 개라 두 방법의 차이를 계산하지 않았습니다. 위 2단계에서 기준으로 쓸 계산을 정해 주세요.`
                : SALE_METHODS.some((m) => ofMethod(m).length === 0)
                ? "한 가지 방법만 입력했습니다. 두 방법을 모두 입력하면 남는 금액의 차이를 보여 드립니다."
                : SALE_METHODS.some((m) => issuesByMethod[m].length > 0)
                  ? "기준 가격 자료가 바뀌었거나 만료된 계산이 있어 두 방법의 차이를 계산하지 않았습니다."
                  : "비용을 모르는 항목이 있어 두 방법의 차이를 계산하지 않았습니다. 비용이 없으면 0을 입력해 주세요."
              : diff === 0
                ? "두 방법의 예상 실수령액이 같습니다."
                : `개인에게 직접 팔면 업체 판매보다 예상 실수령액이 ${formatMoney(Math.abs(diff))} ${diff > 0 ? "더 많습니다" : "더 적습니다"}.`}
            {diff !== null && SALE_METHODS.some((m) => ofMethod(m).length > 1)
              ? ` (기준 계산끼리 비교: ${SALE_METHODS.map((m) => scenarioLabel(SALE_METHOD_LABEL[m], byMethod(m)!.channel)).join(" / ")})`
              : ""}
          </p>
          {SALE_METHODS.some((m) => ofMethod(m).length > 1) ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm" data-testid="scenario-table">
                <caption className="mb-1 text-left text-xs text-stone-600">
                  저장한 계산을 입력한 순서대로 나란히 놓았습니다. 순위가 아니며, 어느 쪽이 나은지는 직접 판단해 주세요.
                </caption>
                <thead className="text-xs text-stone-600">
                  <tr>
                    <th scope="col" className="py-1 pr-3 font-medium">방식 · 판매처</th>
                    <th scope="col" className="py-1 pr-3 font-medium">금액</th>
                    <th scope="col" className="py-1 pr-3 font-medium">예상 실수령액</th>
                    <th scope="col" className="py-1 pr-3 font-medium">어림한 시간</th>
                  </tr>
                </thead>
                <tbody>
                  {scenarios.map((sc) => {
                    const net = netOf.get(sc.id)!;
                    const bad = issuesOf.get(sc.id)!.length > 0;
                    return (
                      <tr key={sc.id} className="border-t border-stone-200">
                        <th scope="row" className="py-1 pr-3 font-normal">
                          {scenarioLabel(SALE_METHOD_LABEL[sc.method], sc.channel)}
                          {ofMethod(sc.method).length > 1 && byMethod(sc.method)?.id === sc.id ? <span className="ml-1 text-xs text-teal-900">(기준)</span> : null}
                        </th>
                        <td className="whitespace-nowrap py-1 pr-3">{formatMoney(sc.saleAmount)}</td>
                        <td className="whitespace-nowrap py-1 pr-3">
                          {bad ? (
                            <span className="text-red-900">기준 자료 다시 확인</span>
                          ) : net.complete ? (
                            formatMoney(net.net!)
                          ) : (
                            <span className="text-amber-900">계산 불완전</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap py-1 pr-3">
                          {sc.expectedMinutes === null ? <span className="text-amber-900">모름</span> : `${sc.expectedMinutes}분`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
          {breakEven?.ok && directSc ? (
            <p data-testid="break-even" className="text-stone-700">
              지금 입력한 비용대로라면, 개인 판매금액이 <strong>{formatMoney(breakEven.saleAmount)}</strong> 이상일 때 업체 판매와 실수령액이 같거나
              많아집니다(입력한 개인 판매금액: {formatMoney(directSc.saleAmount)}). 그 금액에 팔린다는 뜻이 아니며, 들이는 시간은 반영하지 않았습니다.
            </p>
          ) : null}
          {diff !== null && byMethod("DIRECT")?.expectedMinutes != null && byMethod("BUYBACK")?.expectedMinutes != null ? (
            <p className="text-stone-700">
              내가 어림한 소요시간은 개인 판매 {byMethod("DIRECT")!.expectedMinutes}분, 업체 판매 {byMethod("BUYBACK")!.expectedMinutes}분입니다.
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {scenarios.map((sc) => {
              const picked = chosenSc?.id === sc.id;
              const bad = issuesOf.get(sc.id)!.length > 0;
              return (
                <form key={sc.id} action={chooseMethodAction}>
                  <input type="hidden" name="itemId" value={item.id} />
                  <input type="hidden" name="scenarioId" value={sc.id} />
                  <button
                    type="submit"
                    className={picked ? "btn-primary" : "btn"}
                    aria-pressed={picked}
                    disabled={bad}
                    title={bad ? "기준 가격 자료를 다시 확인해 저장한 뒤 선택할 수 있습니다." : undefined}
                  >
                    {scenarioLabel(SALE_METHOD_LABEL[sc.method], sc.channel)}
                    {picked ? " ✓" : "로 정하기"}
                  </button>
                </form>
              );
            })}
            {item.chosenMethod ? (
              <form action={chooseMethodAction}>
                <input type="hidden" name="itemId" value={item.id} />
                <input type="hidden" name="scenarioId" value="" />
                <button type="submit" className="btn">선택 취소</button>
              </form>
            ) : null}
          </div>
          {item.chosenMethod && choiceOutdated ? (
            <p className="warn" data-testid="choice-outdated">
              선택한 뒤 이 방법의 금액이나 비용을 바꿨거나 그 계산을 지웠습니다. 아래 숫자는 선택 당시 값입니다. 지금 계산으로 바꾸려면 다시 선택해 주세요.
            </p>
          ) : null}
          {item.chosenMethod ? (
            <p data-testid="chosen" className="font-medium">
              선택한 방법: {scenarioLabel(SALE_METHOD_LABEL[item.chosenMethod], item.chosenChannel ?? "")} — 선택 당시 금액 {formatMoney(item.chosenSaleAmount ?? 0)}, 예상 실수령액{" "}
              {item.chosenNetAmount === null ? "계산 불완전(비용 미입력)" : formatMoney(item.chosenNetAmount)}
            </p>
          ) : (
            <p className="text-stone-600">아직 판매 방법을 정하지 않았습니다. 어느 쪽이 나은지는 금액과 내 시간을 보고 직접 판단해 주세요.</p>
          )}
        </div>
      )}
    </Section>
  );
}
