// 저장해 둔 계산(비용 시나리오)이 지금도 믿을 만한지 확인한다.
// 기준으로 삼은 가격 자료가 나중에 수정·삭제·만료되면, 저장된 금액은 더 이상 근거가 없다.

import { isQuoteExpired } from "./compare";
import { computeNet, type CostInputs } from "./net";
import type { Currency, PriceType } from "./types";

export type BasisIssue = "BASIS_DELETED" | "BASIS_AMOUNT_CHANGED" | "BASIS_NOT_KRW" | "BASIS_EXPIRED";

export const BASIS_ISSUE_LABEL: Record<BasisIssue, string> = {
  BASIS_DELETED: "기준으로 삼은 가격 자료가 삭제되었습니다.",
  BASIS_AMOUNT_CHANGED: "기준으로 삼은 가격 자료의 금액이 저장 후 바뀌었습니다.",
  BASIS_NOT_KRW: "기준으로 삼은 가격 자료가 원화가 아닙니다.",
  BASIS_EXPIRED: "기준으로 삼은 견적의 유효기간이 지났습니다. 지금 받을 수 있는 금액이 아닐 수 있습니다.",
};

export type ScenarioBasis = {
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
  if (basis.currency !== "KRW") issues.push("BASIS_NOT_KRW");
  else if (basis.amountMinor !== sc.saleAmount) issues.push("BASIS_AMOUNT_CHANGED");
  if (isQuoteExpired(basis, today)) issues.push("BASIS_EXPIRED");
  return issues;
}

export type ChosenSnapshot = {
  chosenMethod: string | null;
  chosenSaleAmount: number | null;
  chosenNetAmount: number | null;
};

/** 판매 방법을 고른 뒤 그 방법의 금액·비용을 바꿨는지. 바뀌었으면 선택 당시 숫자는 지금 계산과 다르다. */
export function isChoiceOutdated(item: ChosenSnapshot, scenario: (CostInputs & { method: string }) | undefined): boolean {
  if (!item.chosenMethod) return false;
  if (!scenario || scenario.method !== item.chosenMethod) return true;
  return scenario.saleAmount !== item.chosenSaleAmount || computeNet(scenario).net !== item.chosenNetAmount;
}
