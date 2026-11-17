import { deleteScenarioAction, setPrimaryScenarioAction } from "@/app/actions";
import { ConfirmSubmit } from "@/components/client-bits";
import { ScenarioForm } from "@/components/ScenarioForm";
import { Badge, Section } from "@/components/ui";
import { needsPrimary } from "@/lib/domain/scenario";
import { SALE_METHOD_LABEL, SALE_METHODS } from "@/lib/domain/types";
import { NetBox, scenarioInitial } from "./shared";
import type { ItemView } from "../view";

export function NetSection({ v }: { v: ItemView }) {
  const { item, scenarios, byMethod, ofMethod, netOf, issuesOf, channelNames, copyOptions, basisOptions } = v;

  return (
    <Section id="net" step={2} title="실수령액 계산">
      <p className="text-sm text-stone-700">
        실수령액 = 선택한 금액 − 수수료 − 내가 내는 배송비 − 포장비 − 교통비. 예상 금액으로 계산한 결과는 예상일 뿐 실제로 받을 금액이 아닙니다.
      </p>
      <div className="mt-3 grid gap-4 md:grid-cols-2">
        {SALE_METHODS.map((m) => {
          const list = ofMethod(m);
          const only = list.length === 1 ? list[0] : undefined;
          const primary = byMethod(m);
          return (
            <div key={m} className="space-y-3 rounded-md border border-stone-200 p-3" data-testid={`scenario-${m}`}>
              <h3 className="font-semibold">{SALE_METHOD_LABEL[m]}</h3>
              {list.length === 0 ? (
                <p className="text-sm text-stone-600">
                  {m === "BUYBACK" ? "받은 매입 견적이 있으면 금액과 비용을 입력해 보세요." : "받고 싶은 금액과 예상 비용을 입력해 보세요."}
                </p>
              ) : null}
              {list.length <= 1 ? (
                <>
                  {only ? (
                    <>
                      {only.channel !== "" ? <p className="text-sm font-medium">{only.channel}</p> : null}
                      <NetBox sc={only} net={netOf.get(only.id)!} issues={issuesOf.get(only.id)!} tid={m} purchaseAmount={item.purchaseAmount} />
                    </>
                  ) : null}
                  <ScenarioForm
                    itemId={item.id}
                    method={m}
                    scenarioId={only?.id}
                    initial={scenarioInitial(only)}
                    basisOptions={basisOptions[m]}
                    channelNames={channelNames}
                  />
                </>
              ) : (
                <>
                  {needsPrimary(scenarios, m) ? (
                    <p className="warn" data-testid={`needs-primary-${m}`}>
                      이 방식의 계산이 여러 개입니다. 두 방법의 차이와 손익분기에 쓸 계산 하나를 ‘기준으로 쓰기’로 정해 주세요. 앱이 대신 고르지 않습니다.
                    </p>
                  ) : null}
                  {list.map((sc) => {
                    const isPrimary = primary?.id === sc.id;
                    return (
                      <div key={sc.id} className="space-y-2 border-t border-stone-200 pt-3" data-testid={`scenario-${m}-${sc.id}`}>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-medium">{sc.channel === "" ? "이름 없는 계산" : sc.channel}</p>
                          {isPrimary ? (
                            <Badge tone="teal">기준</Badge>
                          ) : (
                            <form action={setPrimaryScenarioAction}>
                              <input type="hidden" name="itemId" value={item.id} />
                              <input type="hidden" name="scenarioId" value={sc.id} />
                              <button type="submit" className="btn px-2 py-0.5 text-xs">
                                기준으로 쓰기
                              </button>
                            </form>
                          )}
                        </div>
                        <NetBox sc={sc} net={netOf.get(sc.id)!} issues={issuesOf.get(sc.id)!} tid={isPrimary ? m : `${m}-${sc.id}`} purchaseAmount={item.purchaseAmount} />
                        <details className="text-sm">
                          <summary className="cursor-pointer text-stone-700">이 계산 고치기·지우기</summary>
                          <div className="mt-2 space-y-3">
                            <ScenarioForm
                              itemId={item.id}
                              method={m}
                              scenarioId={sc.id}
                              idSuffix={`-${sc.id}`}
                              initial={scenarioInitial(sc)}
                              basisOptions={basisOptions[m]}
                              channelNames={channelNames}
                            />
                            <form action={deleteScenarioAction}>
                              <input type="hidden" name="itemId" value={item.id} />
                              <input type="hidden" name="scenarioId" value={sc.id} />
                              <ConfirmSubmit message="이 계산을 지울까요? 되돌릴 수 없습니다.">이 계산 지우기</ConfirmSubmit>
                            </form>
                          </div>
                        </details>
                      </div>
                    );
                  })}
                </>
              )}
              {list.length >= 1 ? (
                <details className="text-sm" data-testid={`add-scenario-${m}`}>
                  <summary className="cursor-pointer text-stone-700">다른 판매처 계산 추가</summary>
                  <div className="mt-2">
                    <p className="mb-2 text-xs text-stone-600">
                      수수료와 비용은 판매처마다 직접 확인해 입력해 주세요. 앱에 내장된 판매처 목록이나 요율은 없습니다.
                    </p>
                    <ScenarioForm
                      key={`new-${list.length}-${list.at(-1)!.id}`}
                      itemId={item.id}
                      method={m}
                      idSuffix="-new"
                      submitLabel="새 계산 저장"
                      initial={scenarioInitial(undefined)}
                      basisOptions={basisOptions[m]}
                      channelNames={channelNames}
                      copyOptions={copyOptions}
                    />
                  </div>
                </details>
              ) : null}
            </div>
          );
        })}
      </div>
    </Section>
  );
}
