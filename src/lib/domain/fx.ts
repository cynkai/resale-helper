// 외화 자료의 원화 환산 "참고값". 환율과 기준일은 사용자가 직접 확인해 입력한다.
// 앱은 환율을 조회하거나 기본값을 두지 않는다. 환산값은 보여 주기만 하고 원화 자료와 비교·요약에 섞지 않는다.

import { divRoundHalfUp, normalizeMoneyInput } from "./money";
import { CURRENCY_EXPONENT, type Currency } from "./types";

/** 환율은 "외화 1단위당 원"을 소수 넷째 자리까지, 10000배 정수로 다룬다(부동소수점 회피). */
const FX_SCALE = 10_000;
const MAX_FX_RATE_E4 = 1_000_000 * FX_SCALE; // 1단위당 100만 원: 입력 실수 방지용 상한

export type FxRateParse = { ok: true; rateE4: number } | { ok: false; error: string };

export function parseFxRate(raw: string): FxRateParse {
  const s = normalizeMoneyInput(raw);
  const m = /^(\d{1,7})(?:\.(\d{1,4}))?$/.exec(s);
  if (!m) return { ok: false, error: "환율은 외화 1단위당 원으로, 소수 넷째 자리까지 숫자로 입력해 주세요(예: 1385.5)." };
  const rateE4 = Number(m[1]!) * FX_SCALE + Number((m[2] ?? "").padEnd(4, "0"));
  if (rateE4 <= 0) return { ok: false, error: "환율은 0보다 커야 합니다." };
  if (rateE4 > MAX_FX_RATE_E4) return { ok: false, error: "환율이 너무 큽니다." };
  return { ok: true, rateE4 };
}

/** 저장된 환율을 입력·내보내기용 문자열로("1385.5"). */
export function fxRateToPlain(rateE4: number): string {
  const int = Math.floor(rateE4 / FX_SCALE);
  const frac = String(rateE4 % FX_SCALE).padStart(4, "0").replace(/0+$/, "");
  return frac === "" ? String(int) : `${int}.${frac}`;
}

/** 외화 금액(최소단위)을 입력한 환율로 원화로 환산한다. 원 미만은 반올림(half-up). */
export function convertToKrw(amountMinor: number, currency: Currency, rateE4: number): number {
  const unit = 10n ** BigInt(CURRENCY_EXPONENT[currency]);
  return Number(divRoundHalfUp(BigInt(amountMinor) * BigInt(rateE4), unit * BigInt(FX_SCALE)));
}
