// 가져오기 API 라우트 공통 처리. 인증 → 크기 → 본문 순서로 확인하고, 토큰은 로그·응답에 남기지 않는다.

import { getDb } from "../db/client";
import { getImportSettings } from "../db/repo";
import { authorizeImport, classifyOrigin, corsHeaders, type ImportAccess } from "./access";
import { MAX_IMPORT_BODY_BYTES } from "./records";

export function json(body: unknown, status: number, corsOrigin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...corsHeaders(corsOrigin) },
  });
}

/** 요청 헤더로 접근을 판정한다. 실패면 바로 돌려줄 응답을 함께 준다. */
export function checkAccess(req: Request): { access: Extract<ImportAccess, { ok: true }> } | { response: Response } {
  const s = getImportSettings(getDb());
  const access = authorizeImport(
    { authorization: req.headers.get("authorization"), origin: req.headers.get("origin") },
    { tokenHash: s.tokenHash, extensionId: s.extensionId },
  );
  if (!access.ok) return { response: json({ error: access.error }, access.status, access.corsOrigin) };
  return { access };
}

/** CORS 사전 요청. 등록된 확장 origin에만 허용 헤더를 돌려준다. */
export function preflight(req: Request): Response {
  const o = classifyOrigin(req.headers.get("origin"), getImportSettings(getDb()).extensionId);
  if (!o.allowed || !o.corsOrigin) return new Response(null, { status: 403 });
  return new Response(null, { status: 204, headers: corsHeaders(o.corsOrigin) });
}

export type BodyResult = { ok: true; body: unknown } | { ok: false; status: 400 | 413 | 415; error: string };

/** JSON 본문을 크기 상한 안에서 읽는다. */
export async function readJsonBody(req: Request): Promise<BodyResult> {
  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    return { ok: false, status: 415, error: "Content-Type은 application/json이어야 합니다." };
  }
  const tooLarge = { ok: false as const, status: 413 as const, error: `본문이 너무 큽니다(최대 ${MAX_IMPORT_BODY_BYTES}바이트).` };
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_IMPORT_BODY_BYTES) return tooLarge;
  const text = await req.text();
  if (Buffer.byteLength(text, "utf8") > MAX_IMPORT_BODY_BYTES) return tooLarge;
  try {
    return { ok: true, body: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, status: 400, error: "본문이 올바른 JSON이 아닙니다." };
  }
}
