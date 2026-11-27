// 저장해 둔 계산(비용 시나리오)이 지금도 믿을 만한지 확인한다.
// 기준으로 삼은 가격 자료가 나중에 수정·삭제·만료되면, 저장된 금액은 더 이상 근거가 없다.

import { isQuoteExpired } from "./compare";
import { computeNet, type CostInputs } from "./net";
import { COST_KEYS, plannedCostItems, type CostItems } from "./review";
import type { Currency, PriceType, SaleMethod } from "./types";

export type BasisIssue = "BASIS_DELETED" | "BASIS_TYPE_CHANGED" | "BASIS_WRONG_METHOD" | "BASIS_AMOUNT_CHANGED" | "BASIS_NOT_KRW" | "BASIS_EXPIRED";

export const BASIS_ISSUE_LABEL: Record<BasisIssue, string> = {
  BASIS_TYPE_CHANGED: "기준 자료의 가격 유형이 선택할 때와 달라졌습니다.",
  BASIS_WRONG_METHOD: "기준 자료의 가격 유형이 판매 방식과 맞지 않습니다.",
  BASIS_DELETED: "기준으로 삼은 가격 자료가 삭제되었습니다.",
  BASIS_AMOUNT_CHANGED: "기준으로 삼은 가격 자료의 금액이 저장 후 바뀌었습니다.",
  BASIS_NOT_KRW: "기준으로 삼은 가격 자료가 원화가 아닙니다.",
  BASIS_EXPIRED: "기준으로 삼은 견적의 유효기간이 지났습니다. 지금 받을 수 있는 금액이 아닐 수 있습니다.",
};

export function usableBasisType(method: SaleMethod, priceType: PriceType): boolean {
  return method === "BUYBACK" ? priceType === "BUYBACK_QUOTE" : priceType !== "BUYBACK_QUOTE";
}

export type ScenarioBasis = {
  method?: SaleMethod;
  saleAmount: number;
  basisPriceRecordId: number | null;
  /** 저장 당시 기준 자료의 유형. 자료가 삭제되어도 남는다. */
  basisPriceType: PriceType | null;
};

export type BasisRecord = {
  amountMinor: number;
  currency: Currency;
  priceType: PriceType;
  quoteValidUntil: string | null;
};

export function basisIssues(sc: ScenarioBasis, basis: BasisRecord | undefined, today: string): BasisIssue[] {
  if (sc.basisPriceRecordId === null) {
    return sc.basisPriceType !== null ? ["BASIS_DELETED"] : [];
  }
  if (!basis) return ["BASIS_DELETED"];
  const issues: BasisIssue[] = [];
  if (sc.basisPriceType !== basis.priceType) issues.push("BASIS_TYPE_CHANGED");
  else if (sc.method && !usableBasisType(sc.method, basis.priceType)) issues.push("BASIS_WRONG_METHOD");
  if (basis.currency !== "KRW") issues.push("BASIS_NOT_KRW");
  else if (basis.amountMinor !== sc.saleAmount) issues.push("BASIS_AMOUNT_CHANGED");
  if (isQuoteExpired(basis, today)) issues.push("BASIS_EXPIRED");
  return issues;
}

export type ChosenEstimate = {
  readonly channel: string;
  readonly expectedMinutes: number | null;
  readonly costs: CostItems;
};

export type ChosenSnapshot = {
  chosenEstimate?: ChosenEstimate | null;
  chosenMethod: string | null;
  chosenChannel?: string | null;
  chosenSaleAmount: number | null;
  chosenNetAmount: number | null;
};

/** 판매 방법을 고른 뒤 그 방법의 금액·비용을 바꿨는지. 바뀌었으면 선택 당시 숫자는 지금 계산과 다르다. */
export function isChoiceOutdated(item: ChosenSnapshot, scenario: (CostInputs & { method: string; expectedMinutes?: number | null }) | undefined): boolean {
  if (!item.chosenMethod) return false;
  if (!scenario || scenario.method !== item.chosenMethod) return true;
  if (scenario.saleAmount !== item.chosenSaleAmount || computeNet(scenario).net !== item.chosenNetAmount) return true;
  const estimate = item.chosenEstimate;
  if (!estimate) return false;
  const costs = plannedCostItems(scenario);
  return scenario.expectedMinutes !== estimate.expectedMinutes || COST_KEYS.some((key) => costs[key] !== estimate.costs[key]);
}

/** 판매처 이름 최대 길이(판매 결과의 판매처 칸과 같다). */
export const CHANNEL_MAX = 100;

/** 계산 이름 표시: 판매처 이름이 없으면 방식 이름만. */
export function scenarioLabel(methodLabel: string, channel: string): string {
  return channel === "" ? methodLabel : `${methodLabel} · ${channel}`;
}

type Pickable = { method: string; isPrimary: boolean };

/**
 * 손익분기·분류가 쓸 그 방식의 기준 계산.
 * 하나뿐이면 그것, 여러 개면 사용자가 기준으로 표시한 것. 여러 개인데 표시가 없으면 고르지 않는다(undefined).
 */
export function primaryScenario<T extends Pickable>(scenarios: T[], method: string): T | undefined {
  const of = scenarios.filter((s) => s.method === method);
  if (of.length === 1) return of[0];
  const marked = of.filter((s) => s.isPrimary);
  return marked.length === 1 ? marked[0] : undefined;
}

/** 그 방식에 계산이 여러 개인데 기준을 아직 정하지 않았는지. */
export function needsPrimary(scenarios: Pickable[], method: string): boolean {
  return scenarios.filter((s) => s.method === method).length > 1 && primaryScenario(scenarios, method) === undefined;
}

/**
 * 판매글에 쓸 개인 판매 계산: 개인 판매 계산을 골랐으면 그것, 아니면 개인 판매의 기준 계산(없으면 undefined).
 * 물건 화면의 판매글 초안·템플릿과 템플릿 화면의 미리보기가 같은 금액을 쓰도록 한곳에 둔다.
 */
export function listingScenario<T extends Pickable & { channel: string }>(
  item: { chosenMethod: string | null; chosenChannel?: string | null },
  scenarios: T[],
): T | undefined {
  const chosen = chosenScenario(item, scenarios);
  return chosen?.method === "DIRECT" ? chosen : primaryScenario(scenarios, "DIRECT");
}

/** 사용자가 고른 계산(방식과 판매처 이름이 모두 같은 것). */
export function chosenScenario<T extends { method: string; channel: string }>(
  item: { chosenMethod: string | null; chosenChannel?: string | null },
  scenarios: T[],
): T | undefined {
  if (!item.chosenMethod) return undefined;
  return scenarios.find((s) => s.method === item.chosenMethod && s.channel === (item.chosenChannel ?? ""));
}
