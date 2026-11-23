// 물건 화면의 조회·계산.

import { breakEvenDirectSale } from "@/lib/domain/break-even";
import { type BasisOption, type CopyOption } from "@/components/ScenarioForm";
import { countTrashedPrices, getSaleResult, listSameIdentifierItems, listChannelNames, listCostPresets, listOffers, listPastSalesForSameIdentifier, listPostedPrices, listPriceHistory, listPrices, listScenarios, listTemplates } from "@/lib/db/repo";
import { presetFormValues } from "@/lib/domain/cost-preset";
import { postedDeltas, summarizePosted } from "@/lib/domain/posted-price";
import { buildTimeline } from "@/lib/domain/timeline";
import { COST_KEYS, costItemDiffs } from "@/lib/domain/review";
import { countOfferStatuses } from "@/lib/domain/offer";
import type { PriceRecord } from "@/lib/db/schema";
import { buildComparison, isQuoteExpired, PRICE_SORTS, type PriceSort } from "@/lib/domain/compare";
import { buildListingDraft } from "@/lib/domain/listing";
import { formatMoney } from "@/lib/domain/money";
import { computeNet, netDifference, type NetResult } from "@/lib/domain/net";
import { basisIssues, chosenScenario, isChoiceOutdated, needsPrimary, primaryScenario, scenarioLabel, usableBasisType, type BasisIssue } from "@/lib/domain/scenario";
import { PRICE_TYPE_INFO, SALE_METHOD_LABEL, SALE_METHODS, type SaleMethod } from "@/lib/domain/types";
import type { Db } from "@/lib/db/client";
import type { Item } from "@/lib/db/schema";
import { scenarioInitial, WINDOWS } from "./_sections/shared";

/**
 * 물건 화면이 보여 줄 값을 한 번에 계산한다(조회와 순수 계산만, 화면 조각은 _sections에 있다).
 * 구역 컴포넌트는 여기서 만든 값만 받아 그린다.
 */
export function loadItemView(db: Db, demo: boolean, item: Item, sp: Record<string, string | undefined>, today: string) {
  const windowParam = WINDOWS.some((w) => w.value === sp.days) ? sp.days! : "180";
  const windowDays = windowParam === "all" ? null : Number(windowParam);
  // 가격 자료 목록의 보기 순서와 제외 자료 숨김. 보기만 바꾸며 요약·비교에는 영향이 없다.
  const priceSort: PriceSort = PRICE_SORTS.includes(sp.sort as PriceSort) ? (sp.sort as PriceSort) : "default";
  const hideExcluded = sp.hide === "excluded";
  const pricesHref = (over: { days?: string; sort?: PriceSort; hide?: boolean }) => {
    const days = over.days ?? windowParam;
    const sort = over.sort ?? priceSort;
    const hide = over.hide ?? hideExcluded;
    const q = new URLSearchParams();
    if (days !== "180") q.set("days", days);
    if (sort !== "default") q.set("sort", sort);
    if (hide) q.set("hide", "excluded");
    const qs = q.toString();
    return `/items/${item.id}${qs ? `?${qs}` : ""}#prices`;
  };
  const prices = listPrices(db, item.id);
  const trashedPriceCount = countTrashedPrices(db, demo, item.id);
  const history = listPriceHistory(db, item.id);
  const comparison = buildComparison(item, prices, today, windowDays);
  const scenarios = listScenarios(db, item.id);
  const result = getSaleResult(db, item.id);

  // 방식마다 계산이 여러 개일 수 있다. 두 방법의 차이·손익분기는 방식별 "기준" 계산으로만 한다
  // (하나뿐이면 그것, 여러 개면 사용자가 표시한 것. 표시가 없으면 앱이 고르지 않는다).
  const byMethod = (m: SaleMethod) => primaryScenario(scenarios, m);
  const ofMethod = (m: SaleMethod) => scenarios.filter((s) => s.method === m);
  const netOf = new Map(scenarios.map((sc) => [sc.id, computeNet(sc)]));
  const issuesOf = new Map(
    scenarios.map((sc) => {
      const basis = sc.basisPriceRecordId !== null ? prices.find((p) => p.id === sc.basisPriceRecordId) : undefined;
      return [sc.id, basisIssues(sc, basis, today)];
    }),
  );
  const nets = Object.fromEntries(
    SALE_METHODS.map((m) => {
      const sc = byMethod(m);
      return [m, sc ? netOf.get(sc.id)! : null];
    }),
  ) as Record<SaleMethod, NetResult | null>;
  const issuesByMethod = Object.fromEntries(
    SALE_METHODS.map((m) => {
      const sc = byMethod(m);
      return [m, sc ? issuesOf.get(sc.id)! : []];
    }),
  ) as Record<SaleMethod, BasisIssue[]>;
  const undecidedPrimary = SALE_METHODS.filter((m) => needsPrimary(scenarios, m));
  const chosenSc = chosenScenario(item, scenarios);
  const channelNames = listChannelNames(db, demo);
  // 비용 베껴 오기: 내가 저장해 둔 비용 묶음(모든 계산 폼)과 이 물건의 다른 계산(새 계산 폼).
  // 묶음의 id는 계산 id와 겹치지 않게 음수로 준다.
  const presetOptions: CopyOption[] = listCostPresets(db, demo).map((p) => ({
    id: -p.id,
    label: `내 비용 묶음: ${p.name}`,
    values: presetFormValues(p),
  }));
  const copyOptions: CopyOption[] = [
    ...presetOptions,
    ...scenarios.map((sc) => ({
      id: sc.id,
      label: scenarioLabel(SALE_METHOD_LABEL[sc.method], sc.channel),
      values: scenarioInitial(sc),
    })),
  ];
  // 기준 자료에 문제가 있는 계산은 차액 비교에도 쓰지 않는다.
  const diff = netDifference(
    issuesByMethod.DIRECT.length === 0 ? nets.DIRECT : null,
    issuesByMethod.BUYBACK.length === 0 ? nets.BUYBACK : null,
  );
  // 손익분기: 업체 계산이 믿을 만하고(기준 자료 문제 없음) 개인 판매 비용을 모두 알 때만.
  const directSc = byMethod("DIRECT");
  const breakEven =
    directSc && byMethod("BUYBACK") && issuesByMethod.BUYBACK.length === 0 ? breakEvenDirectSale(directSc, nets.BUYBACK?.net ?? null) : null;
  const choiceOutdated = isChoiceOutdated(item, chosenSc);
  // 실제 비용을 항목별로 적으면 선택할 때 저장해 둔 어림값과 견준다.
  const resultActual = result
    ? { fee: result.feeActual, shipping: result.shippingActual, packing: result.packingActual, transport: result.transportActual }
    : null;
  const resultCostDiffs =
    resultActual && COST_KEYS.some((k) => resultActual[k] !== null)
      ? costItemDiffs(item.chosenEstimate?.costs ?? null, resultActual)
      : null;
  const templates = listTemplates(db, demo);
  const posted = listPostedPrices(db, item.id);
  const postedSummary = summarizePosted(posted);
  const postedDelta = postedDeltas(posted);
  const offers = listOffers(db, item.id);
  const offerCounts = countOfferStatuses(offers.map((o) => o.status));
  // 제안을 받았을 때 비교할 업체 실수령액: 업체 기준 계산이 완전하고 기준 자료 문제가 없을 때만.
  const offerBuybackNet = byMethod("BUYBACK") && issuesByMethod.BUYBACK.length === 0 ? (nets.BUYBACK?.net ?? null) : null;
  const acceptedOffer = offers.find((o) => o.status === "ACCEPTED");
  const timeline = buildTimeline({ item, prices, history, posted, offers, result });

  const usable = prices.filter((p) => p.currency === "KRW" && !isQuoteExpired(p, today));
  const optionLabel = (p: PriceRecord) =>
    `[${PRICE_TYPE_INFO[p.priceType].label}] ${p.sourceName} ${formatMoney(p.amountMinor)} (확인 ${p.checkedDate})`;
  const basisOptions: Record<SaleMethod, BasisOption[]> = {
    BUYBACK: usable
      .filter((p) => usableBasisType("BUYBACK", p.priceType))
      .map((p) => ({ id: p.id, label: optionLabel(p), amount: p.amountMinor })),
    DIRECT: usable
      .filter((p) => usableBasisType("DIRECT", p.priceType))
      .map((p) => ({ id: p.id, label: optionLabel(p), amount: p.amountMinor })),
  };

  // 판매글 금액: 개인 판매 계산을 골랐으면 그 계산, 아니면 개인 판매의 기준 계산.
  const direct = chosenSc?.method === "DIRECT" ? chosenSc : byMethod("DIRECT");
  const draft = buildListingDraft(item, direct?.saleAmount ?? null);

  // 같은 ISBN·모델명의 물건을 전에 판 내 기록(보여 주기만, 비교에는 넣지 않는다).
  const pastSales = listPastSalesForSameIdentifier(db, demo, item);
  // 같은 식별자로 등록한 다른 물건(아직 안 판 것). 두 번 등록했는지 알아차리게 한다.
  const siblings = listSameIdentifierItems(db, demo, item);

  return {
    item,
    pastSales,
    siblings,
    demo,
    today,
    windowParam,
    windowDays,
    priceSort,
    hideExcluded,
    pricesHref,
    prices,
    trashedPriceCount,
    history,
    comparison,
    scenarios,
    result,
    byMethod,
    ofMethod,
    netOf,
    issuesOf,
    nets,
    issuesByMethod,
    undecidedPrimary,
    chosenSc,
    channelNames,
    presetOptions,
    copyOptions,
    diff,
    directSc,
    breakEven,
    choiceOutdated,
    resultActual,
    resultCostDiffs,
    templates,
    posted,
    postedSummary,
    postedDelta,
    offers,
    offerCounts,
    offerBuybackNet,
    acceptedOffer,
    timeline,
    usable,
    optionLabel,
    basisOptions,
    direct,
    draft,
  };
}

export type ItemView = ReturnType<typeof loadItemView>;
