import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db/client";
import { checkAccess, json, preflight, readJsonBody } from "@/lib/import/http";
import { importRecords } from "@/lib/import/records";
import { todayYmd } from "@/lib/today";

// 가져오기 API: 외부 도구와 브라우저 확장이 가격 자료를 넣는 유일한 쓰기 엔드포인트.
// 토큰(Authorization: Bearer)과 허용된 Origin이 모두 필요하다. 이 서버는 외부 매물 사이트에 요청하지 않는다.
export async function POST(req: Request) {
  const a = checkAccess(req);
  if ("response" in a) return a.response;
  const { route, corsOrigin } = a.access;

  const parsed = await readJsonBody(req);
  if (!parsed.ok) return json({ error: parsed.error }, parsed.status, corsOrigin);

  const out = importRecords(getDb(), parsed.body, route, todayYmd());
  if (!out.ok) return json({ error: out.error }, out.status, corsOrigin);
  if (out.imported > 0) {
    const itemId = (parsed.body as { itemId: number }).itemId;
    revalidatePath(`/items/${itemId}`);
    revalidatePath("/");
  }
  return json({ imported: out.imported, rejected: out.rejected, results: out.results }, 200, corsOrigin);
}

export function OPTIONS(req: Request) {
  return preflight(req);
}
