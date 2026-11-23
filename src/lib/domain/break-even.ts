// 손익분기 판매금액: 개인 판매의 실수령액이 업체 판매의 실수령액과 같아지는 가장 낮은 개인 판매금액.
// 사용자가 입력한 비용으로 하는 산수일 뿐이며, 그 금액에 팔린다는 예측이 아니다. 시간은 반영하지 않는다.

import { MAX_MINOR } from "./money";
import { computeNet, type CostInputs } from "./net";
import { perHour } from "./triage";

export type BreakEven =
  | { ok: true; saleAmount: number }
  /** 업체 실수령액을 모름(비용 미입력 등) / 개인 판매 비용 중 모르는 항목이 있음 / 입력 가능한 범위에서 도달할 수 없음 */
  | { ok: false; reason: "BUYBACK_NET_UNKNOWN" | "DIRECT_COST_UNKNOWN" | "UNREACHABLE" };

export type DirectCosts = Omit<CostInputs, "saleAmount">;

/** 조건을 처음 만족하는 가장 낮은 판매금액. 조건은 판매금액이 오를수록 거짓→참으로만 바뀌어야 한다. */
function lowestSaleAmount(direct: DirectCosts, satisfied: (net: number) => boolean): BreakEven {
  const initial = computeNet({ ...direct, saleAmount: 0 });
  if (initial.net === null) return { ok: false, reason: "DIRECT_COST_UNKNOWN" };
  // 판매금액이 1원 오를 때 수수료는 많아야 1원 오르므로 실수령액은 줄지 않는다.
  const netAt = (saleAmount: number) => computeNet({ ...direct, saleAmount }).netBeforeMissing;
  if (satisfied(initial.net)) return { ok: true, saleAmount: 0 };
  if (!satisfied(netAt(MAX_MINOR))) return { ok: false, reason: "UNREACHABLE" };
  let lo = 1;
  let hi = MAX_MINOR;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (satisfied(netAt(mid))) hi = mid;
    else lo = mid + 1;
  }
  return { ok: true, saleAmount: lo };
}

export function breakEvenDirectSale(direct: DirectCosts, buybackNet: number | null): BreakEven {
  if (buybackNet === null) return { ok: false, reason: "BUYBACK_NET_UNKNOWN" };
  return lowestSaleAmount(direct, (net) => net >= buybackNet);
}

/**
 * 배분 판단이 "직접 판매"가 되는 가장 낮은 개인 판매금액:
 * 업체보다 더 남고(차액 > 0), 그 차액 ÷ 추가 소요시간이 내 시간당 가치 이상.
 * 배분 판단(triage)과 같은 반올림(perHour)을 쓴다. 추가 소요시간이 0 이하면 시간 조건이 없으므로 null을 돌려준다.
 */
export function directThresholdWithTime(
  direct: DirectCosts,
  buybackNet: number | null,
  extraMinutes: number | null,
  timeValuePerHour: number | null,
): BreakEven | null {
  if (extraMinutes === null || timeValuePerHour === null || extraMinutes <= 0) return null;
  if (buybackNet === null) return { ok: false, reason: "BUYBACK_NET_UNKNOWN" };
  return lowestSaleAmount(direct, (net) => net - buybackNet > 0 && perHour(net - buybackNet, extraMinutes) >= timeValuePerHour);
}
