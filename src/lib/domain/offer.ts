// 받은 제안(흥정) 기록. 사용자가 직접 적는 값이며 가격 자료가 아니다(비교·요약에 넣지 않는다).
// 제안 금액을 내 계산의 비용에 넣어 보는 산수만 한다. 받을지 말지는 앱이 정하지 않는다.
// 상대방의 닉네임·연락처 같은 개인정보는 받지도 저장하지도 않는다(스키마에 칸이 없다).

import { parseAmount } from "./money";
import { computeNet, type CostInputs, type NetResult } from "./net";
import { isValidYmd } from "./price-input";
import { channelKey } from "./review";
import { primaryScenario } from "./scenario";

export const OFFER_STATUSES = ["OPEN", "ACCEPTED", "DECLINED"] as const;
export type OfferStatus = (typeof OFFER_STATUSES)[number];

export const OFFER_STATUS_LABEL: Record<OfferStatus, string> = {
  OPEN: "답하지 않음",
  ACCEPTED: "받기로 함",
  DECLINED: "거절함",
};

export type ValidOfferInput = {
  receivedDate: string;
  amount: number;
  channel: string;
  memo: string | null;
};

export type OfferValidation = { ok: true; value: ValidOfferInput } | { ok: false; errors: Record<string, string> };

export function validateOfferInput(raw: { receivedDate?: string; amount?: string; channel?: string; memo?: string }, today: string): OfferValidation {
  const errors: Record<string, string> = {};
  const receivedDate = (raw.receivedDate ?? "").trim();
  if (!isValidYmd(receivedDate)) errors.receivedDate = "제안받은 날짜를 YYYY-MM-DD 형식으로 입력해 주세요.";
  else if (receivedDate > today) errors.receivedDate = "제안받은 날짜는 오늘 이후일 수 없습니다.";
  let amount = 0;
  const a = parseAmount(raw.amount ?? "", "KRW");
  if (!a.ok) errors.amount = a.error;
  else if (a.minor <= 0) errors.amount = "금액은 0보다 커야 합니다.";
  else amount = a.minor;
  const channel = (raw.channel ?? "").trim();
  if (channel.length > 100) errors.channel = "100자 이내로 입력해 주세요.";
  const memo = (raw.memo ?? "").trim();
  if (memo.length > 500) errors.memo = "500자 이내로 입력해 주세요.";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { receivedDate, amount, channel, memo: memo === "" ? null : memo } };
}

type OfferScenario = CostInputs & { method: string; channel: string; isPrimary: boolean };

/**
 * 제안 금액을 넣어 볼 개인 판매 계산을 고른다.
 * 1) 제안의 판매처 이름과 같은 이름의 개인 판매 계산, 2) 내가 고른 개인 판매 계산, 3) 개인 판매의 기준 계산.
 * 셋 다 없으면 고르지 않는다(계산이 여러 개인데 기준이 없을 때 앱이 임의로 고르지 않는다).
 */
export function pickOfferScenario<S extends OfferScenario>(
  scenarios: S[],
  item: { chosenMethod: string | null; chosenChannel?: string | null },
  offerChannel: string,
): S | undefined {
  const direct = scenarios.filter((s) => s.method === "DIRECT");
  if (offerChannel.trim() !== "") {
    const named = direct.find((s) => s.channel !== "" && channelKey(s.channel) === channelKey(offerChannel));
    if (named) return named;
  }
  if (item.chosenMethod === "DIRECT") {
    const chosen = direct.find((s) => s.channel === (item.chosenChannel ?? ""));
    if (chosen) return chosen;
  }
  return primaryScenario(scenarios, "DIRECT");
}

export type OfferEvaluation = {
  /** 제안 금액을 판매금액 자리에 넣은 실수령액 계산(비용은 그 계산에 입력한 값 그대로, 비율 수수료는 다시 계산). */
  net: NetResult;
  /** 제안 금액 − 그 계산에 적어 둔 예상 판매금액. */
  vsPlanned: number;
  /** 제안을 받았을 때의 실수령액 − 업체 판매 실수령액. 어느 한쪽을 모르면 null. */
  vsBuybackNet: number | null;
};

export function evaluateOffer(amount: number, direct: CostInputs, buybackNet: number | null): OfferEvaluation {
  const net = computeNet({ ...direct, saleAmount: amount });
  return {
    net,
    vsPlanned: amount - direct.saleAmount,
    vsBuybackNet: net.net !== null && buybackNet !== null ? net.net - buybackNet : null,
  };
}

/** 상태별 건수. 금액을 더하거나 평균 내지 않는다. */
export function countOfferStatuses(statuses: OfferStatus[]): Record<OfferStatus, number> {
  const c = { OPEN: 0, ACCEPTED: 0, DECLINED: 0 };
  for (const s of statuses) c[s] += 1;
  return c;
}
