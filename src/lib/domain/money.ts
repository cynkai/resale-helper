// 금액 처리. 모든 금액은 최소통화단위 정수(KRW·JPY=1단위, USD·EUR=센트)로 다룬다.
// 부동소수점 연산을 피하기 위해 문자열 파싱과 BigInt 연산만 사용한다.

import { CURRENCY_EXPONENT, type Currency } from "./types";

export type ParseResult = { ok: true; minor: number } | { ok: false; error: string };

const MAX_MINOR = 1_000_000_000_000; // 1조 최소단위: 입력 실수 방지용 상한

/** "12,000" / "12.50" 같은 문자열을 최소단위 정수로 변환한다. 음수·지수표기·초과 소수 자릿수는 거부한다. */
export function parseAmount(raw: string, currency: Currency): ParseResult {
  const s = raw.trim().replace(/,/g, "").replace(/원$/, "");
  if (s === "") return { ok: false, error: "금액을 입력해 주세요." };
  const m = /^(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) return { ok: false, error: "금액은 0 이상의 숫자로 입력해 주세요." };
  const exp = CURRENCY_EXPONENT[currency];
  const frac = m[2] ?? "";
  if (frac.length > exp) {
    return {
      ok: false,
      error: exp === 0 ? `${currency} 금액에는 소수점을 쓸 수 없습니다.` : `${currency} 금액은 소수 ${exp}자리까지 입력할 수 있습니다.`,
    };
  }
  const minor = Number(m[1]! + frac.padEnd(exp, "0"));
  if (!Number.isSafeInteger(minor) || minor > MAX_MINOR) return { ok: false, error: "금액이 너무 큽니다." };
  return { ok: true, minor };
}

/** 최소단위 정수를 내보내기용 문자열("12000", "12.50")로 변환한다. */
export function minorToPlain(minor: number, currency: Currency): string {
  const exp = CURRENCY_EXPONENT[currency];
  if (exp === 0) return String(minor);
  const s = String(minor).padStart(exp + 1, "0");
  return `${s.slice(0, -exp)}.${s.slice(-exp)}`;
}

/** 화면 표시용. KRW는 "12,000원", 그 외는 "USD 12.50"처럼 원래 통화로만 표시한다(환산하지 않음). */
export function formatMoney(minor: number, currency: Currency = "KRW"): string {
  const sign = minor < 0 ? "-" : "";
  const plain = minorToPlain(Math.abs(minor), currency);
  const [int, frac] = plain.split(".");
  const grouped = int!.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const body = frac ? `${grouped}.${frac}` : grouped;
  return currency === "KRW" ? `${sign}${body}원` : `${sign}${currency} ${body}`;
}

/** 정수 나눗셈 반올림(0.5 이상 올림, half-up). 음이 아닌 값 전용. */
export function divRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (numerator * 2n + denominator) / (denominator * 2n);
}

/** 수수료율(만분율, 1% = 100bp)을 적용한 수수료. 원 미만은 반올림(half-up)한다. */
export function feeFromRate(amountMinor: number, rateBp: number): number {
  return Number(divRoundHalfUp(BigInt(amountMinor) * BigInt(rateBp), 10_000n));
}

/** "3.5" 같은 백분율 문자열을 만분율 정수로 변환(소수 둘째 자리까지). */
export function parsePercentToBp(raw: string): { ok: true; bp: number } | { ok: false; error: string } {
  const s = raw.trim().replace(/%$/, "");
  const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return { ok: false, error: "수수료율은 0~100 사이 숫자(소수 둘째 자리까지)로 입력해 주세요." };
  const bp = Number(m[1]!) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  if (bp > 10_000) return { ok: false, error: "수수료율은 100%를 넘을 수 없습니다." };
  return { ok: true, bp };
}

export function bpToPercentString(bp: number): string {
  const s = (bp / 100).toFixed(2);
  return s.replace(/\.?0+$/, "");
}

/** 정렬된 정수 배열의 중앙값. 짝수 건이면 가운데 두 값의 평균을 half-up 반올림한다. */
export function medianInt(values: number[]): number {
  if (values.length === 0) throw new Error("빈 배열의 중앙값은 계산할 수 없습니다.");
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return Number(divRoundHalfUp(BigInt(sorted[mid - 1]!) + BigInt(sorted[mid]!), 2n));
}
