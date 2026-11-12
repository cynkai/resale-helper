// 사용자 설정 입력 검증. 빈칸은 "모름(null)"이고 0은 유효한 값이다.

import { z } from "zod";

/** 입력 실수 방지용 상한(시간당 1억 원). 근거 있는 값이 아니라 오타를 거르는 용도다. */
export const MAX_TIME_VALUE_PER_HOUR = 100_000_000;

const INTEGER_MSG = "0 이상의 정수(원)로 입력해 주세요.";

// 빈칸 판정은 스키마 밖에서 한다(union을 쓰면 오류가 "Invalid input"으로 뭉개진다).
const timeValueSchema = z
  .string()
  .regex(/^\d{1,12}$/, INTEGER_MSG)
  .transform(Number)
  .pipe(z.number().int().min(0, INTEGER_MSG).max(MAX_TIME_VALUE_PER_HOUR, "금액이 너무 큽니다."));

export type TimeValueResult = { ok: true; value: number | null } | { ok: false; error: string };

/** 시간당 가치(원/시간). 빈칸 → null(모름), "0" → 0(시간을 공짜로 봄). 음수·소수·문자는 거부. */
export function validateTimeValue(raw: string): TimeValueResult {
  const s = raw.trim().replace(/,/g, "").replace(/원$/, "").trim();
  if (s === "") return { ok: true, value: null };
  const r = timeValueSchema.safeParse(s);
  if (r.success) return { ok: true, value: r.data };
  return { ok: false, error: r.error.issues[0]?.message ?? INTEGER_MSG };
}
