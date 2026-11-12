// 실수령액 계산. "모름(null)"과 "0원"을 구분하고, 하나라도 모르면 완전한 금액을 내지 않는다.

import { feeFromRate } from "./money";

export type CostInputs = {
  saleAmount: number; // 선택한 판매금액(원)
  feeMode: "AMOUNT" | "RATE";
  feeAmount: number | null; // feeMode=AMOUNT일 때. null = 모름
  feeRateBp: number | null; // feeMode=RATE일 때. null = 모름
  shipping: number | null; // 판매자 부담 배송비
  packing: number | null;
  transport: number | null;
};

export const COST_LABEL = {
  fee: "수수료",
  shipping: "판매자 부담 배송비",
  packing: "포장비",
  transport: "교통비",
} as const;
export type CostKey = keyof typeof COST_LABEL;

export type NetResult = {
  fee: number | null;
  missing: CostKey[];
  complete: boolean;
  /** 모든 비용이 입력된 경우에만 값이 있다. */
  net: number | null;
  /** 입력된 비용만 뺀 금액. 미입력 비용이 있으면 실제 실수령액은 이보다 적을 수 있다. */
  netBeforeMissing: number;
};

export function resolveFee(c: Pick<CostInputs, "saleAmount" | "feeMode" | "feeAmount" | "feeRateBp">): number | null {
  if (c.feeMode === "RATE") return c.feeRateBp === null ? null : feeFromRate(c.saleAmount, c.feeRateBp);
  return c.feeAmount;
}

/** 실수령액 = 판매금액 − 수수료 − 판매자 부담 배송비 − 포장비 − 교통비 */
export function computeNet(c: CostInputs): NetResult {
  const fee = resolveFee(c);
  const parts: Record<CostKey, number | null> = {
    fee,
    shipping: c.shipping,
    packing: c.packing,
    transport: c.transport,
  };
  const missing = (Object.keys(parts) as CostKey[]).filter((k) => parts[k] === null);
  const known = (Object.values(parts) as (number | null)[]).reduce<number>((a, v) => a + (v ?? 0), 0);
  const netBeforeMissing = c.saleAmount - known;
  const complete = missing.length === 0;
  return { fee, missing, complete, net: complete ? netBeforeMissing : null, netBeforeMissing };
}

/** 개인 판매가 업체 판매보다 더 남기는 금액. 둘 중 하나라도 불완전하면 null. */
export function netDifference(direct: NetResult | null, buyback: NetResult | null): number | null {
  if (!direct || !buyback || direct.net === null || buyback.net === null) return null;
  return direct.net - buyback.net;
}
