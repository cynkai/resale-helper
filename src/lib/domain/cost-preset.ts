// 내 비용 묶음: 자주 쓰는 수수료·배송비·포장비·교통비·소요시간 조합을 사용자가 직접 저장해 둔 것.
// 앱이 판매처별 요율이나 기본 비용을 내장하지 않는다는 원칙은 그대로다. 묶음의 값은 모두 사용자가 적은 것이고,
// 계산에 불러온 뒤에도 물건마다 고칠 수 있다. 빈칸은 모름이며 0원과 다르다.

import { bpToPercentString, parseAmount, parsePercentToBp } from "./money";

export const PRESET_NAME_MAX = 50;

export type ValidCostPreset = {
  name: string;
  feeMode: "AMOUNT" | "RATE";
  feeAmount: number | null;
  feeRateBp: number | null;
  shipping: number | null;
  packing: number | null;
  transport: number | null;
  expectedMinutes: number | null;
};

export type CostPresetValidation = { ok: true; value: ValidCostPreset } | { ok: false; errors: Record<string, string> };

export function validateCostPreset(raw: Record<string, string | undefined>): CostPresetValidation {
  const errors: Record<string, string> = {};
  const name = (raw.name ?? "").trim();
  if (name === "") errors.name = "묶음 이름을 입력해 주세요.";
  else if (name.length > PRESET_NAME_MAX) errors.name = `${PRESET_NAME_MAX}자 이내로 입력해 주세요.`;

  const won = (field: string): number | null => {
    const v = (raw[field] ?? "").trim();
    if (v === "") return null; // 빈칸 = 모름
    const r = parseAmount(v, "KRW");
    if (!r.ok) {
      errors[field] = r.error;
      return null;
    }
    return r.minor;
  };
  const feeMode = raw.feeMode === "RATE" ? "RATE" : "AMOUNT";
  let feeAmount: number | null = null;
  let feeRateBp: number | null = null;
  if (feeMode === "RATE") {
    const v = (raw.feeRate ?? "").trim();
    if (v !== "") {
      const r = parsePercentToBp(v);
      if (!r.ok) errors.feeRate = r.error;
      else feeRateBp = r.bp;
    }
  } else feeAmount = won("feeAmount");
  const shipping = won("shipping");
  const packing = won("packing");
  const transport = won("transport");
  let expectedMinutes: number | null = null;
  const m = (raw.expectedMinutes ?? "").trim();
  if (m !== "") {
    if (!/^\d{1,6}$/.test(m)) errors.expectedMinutes = "분 단위 정수로 입력해 주세요.";
    else expectedMinutes = Number(m);
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { name, feeMode, feeAmount, feeRateBp, shipping, packing, transport, expectedMinutes } };
}

/** 폼에 넣을 문자열 값(계산 폼의 칸 이름과 같다). 모름은 빈 문자열. */
export function presetFormValues(p: Omit<ValidCostPreset, "name">): Record<string, string> {
  const str = (n: number | null) => (n === null ? "" : String(n));
  return {
    feeMode: p.feeMode,
    feeAmount: str(p.feeAmount),
    feeRate: p.feeRateBp === null ? "" : bpToPercentString(p.feeRateBp),
    shipping: str(p.shipping),
    packing: str(p.packing),
    transport: str(p.transport),
    expectedMinutes: str(p.expectedMinutes),
  };
}
