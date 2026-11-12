// 로컬 앱(얼마에 팔까)과만 통신한다. 매물 사이트로는 어떤 요청도 보내지 않는다.

export const APP_ORIGIN = "http://127.0.0.1:3000";

export type AppItem = { id: number; name: string; identifier: string | null; category: string; condition: string; status: string };
export type RowResult = { index: number; ok: boolean; id?: number; error?: string };

export class AppError extends Error {}

async function call(path: string, token: string, init: RequestInit = {}): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`${APP_ORIGIN}${path}`, {
      ...init,
      headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` },
      credentials: "omit",
    });
  } catch {
    throw new AppError("앱에 연결하지 못했습니다. '얼마에 팔까'가 http://127.0.0.1:3000 에서 실행 중인지 확인해 주세요.");
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // 본문이 JSON이 아니면 상태 코드만으로 안내한다.
  }
  if (!res.ok) {
    const msg = typeof body === "object" && body !== null && "error" in body ? String((body as { error: unknown }).error) : `요청이 거부되었습니다(${res.status}).`;
    throw new AppError(msg);
  }
  return body;
}

export async function searchItems(token: string, q: string): Promise<AppItem[]> {
  const body = (await call(`/api/import/items?q=${encodeURIComponent(q)}`, token)) as { items?: AppItem[] };
  return body.items ?? [];
}

export async function importOne(token: string, itemId: number, record: Record<string, string>): Promise<RowResult> {
  const body = (await call("/api/import/prices", token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ itemId, records: [record] }),
  })) as { results?: RowResult[] };
  const row = body.results?.[0];
  if (!row) throw new AppError("앱의 응답을 해석하지 못했습니다.");
  return row;
}
