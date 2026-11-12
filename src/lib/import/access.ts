// 가져오기 API 접근 통제. 순수 함수이며 요청 객체나 DB에 의존하지 않는다.
//
// 왜 Host 검사만으로 부족한가: 사용자가 방문한 아무 웹사이트나 브라우저를 통해
// http://127.0.0.1:3000 으로 POST를 보낼 수 있다(CSRF). 그래서 쓰기 API는
// (1) 사용자가 발급한 토큰과 (2) 허용된 Origin을 둘 다 요구한다.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { InputRoute } from "../domain/types";

export const TOKEN_PREFIX = "rh_";

/** 새 토큰을 만든다. 원문은 발급 화면에 한 번만 보여 주고, 저장은 해시로만 한다. */
export function generateImportToken(): { token: string; hash: string } {
  const token = TOKEN_PREFIX + randomBytes(32).toString("base64url");
  return { token, hash: hashImportToken(token) };
}

export function hashImportToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** 제시된 토큰이 저장된 해시와 맞는지 상수 시간으로 비교한다. */
export function verifyImportToken(presented: string, storedHash: string): boolean {
  const a = Buffer.from(hashImportToken(presented), "hex");
  const b = Buffer.from(storedHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Chrome 확장 ID 형식(a~p 32자). */
export function isValidExtensionId(id: string): boolean {
  return /^[a-p]{32}$/.test(id);
}

export function extensionOrigin(id: string): string {
  return `chrome-extension://${id}`;
}

export type ImportAccessSettings = {
  tokenHash: string | null;
  extensionId: string | null;
};

export type ImportAccess =
  | { ok: true; route: Extract<InputRoute, "CLIP" | "EXTERNAL">; corsOrigin: string | null }
  | { ok: false; status: 401 | 403; error: string; corsOrigin: string | null };

/**
 * Origin 판정.
 * - Origin 없음: 브라우저가 아닌 로컬 도구(curl, 스크립트). EXTERNAL.
 * - 설정에 등록한 확장의 origin: CLIP.
 * - 그 밖의 모든 Origin(일반 웹사이트, 등록하지 않은 확장, "null", 이 앱 자신의 화면): 거부.
 */
export function classifyOrigin(
  origin: string | null,
  extensionId: string | null,
): { allowed: true; route: "CLIP" | "EXTERNAL"; corsOrigin: string | null } | { allowed: false } {
  if (origin === null || origin === "") return { allowed: true, route: "EXTERNAL", corsOrigin: null };
  if (extensionId && isValidExtensionId(extensionId) && origin === extensionOrigin(extensionId)) {
    return { allowed: true, route: "CLIP", corsOrigin: origin };
  }
  return { allowed: false };
}

/**
 * 가져오기 API 요청을 받아도 되는지 판단한다. 입력 경로(CLIP/EXTERNAL)는 요청 본문이 아니라
 * 여기서 Origin으로 정한다(클라이언트가 경로를 스스로 주장할 수 없다).
 * 오류 문구에는 토큰 값을 넣지 않는다.
 */
export function authorizeImport(
  headers: { authorization: string | null; origin: string | null },
  settings: ImportAccessSettings,
): ImportAccess {
  const o = classifyOrigin(headers.origin, settings.extensionId);
  if (!o.allowed) {
    return { ok: false, status: 403, error: "허용되지 않은 Origin입니다. 설정에 등록한 확장 또는 로컬 도구만 사용할 수 있습니다.", corsOrigin: null };
  }
  if (!settings.tokenHash) {
    return {
      ok: false,
      status: 403,
      error: "가져오기 API가 꺼져 있습니다. 앱의 설정 화면에서 가져오기 토큰을 먼저 만들어 주세요.",
      corsOrigin: o.corsOrigin,
    };
  }
  const m = /^Bearer ([A-Za-z0-9_-]{1,200})$/.exec(headers.authorization ?? "");
  if (!m || !verifyImportToken(m[1]!, settings.tokenHash)) {
    return { ok: false, status: 401, error: "가져오기 토큰이 없거나 올바르지 않습니다.", corsOrigin: o.corsOrigin };
  }
  return { ok: true, route: o.route, corsOrigin: o.corsOrigin };
}

/** 허용된 origin에만 CORS 헤더를 붙인다. "*"는 쓰지 않는다. */
export function corsHeaders(corsOrigin: string | null): Record<string, string> {
  if (!corsOrigin) return {};
  return {
    "Access-Control-Allow-Origin": corsOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}
