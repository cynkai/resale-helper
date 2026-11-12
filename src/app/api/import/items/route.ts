import { getDb } from "@/lib/db/client";
import { listItems } from "@/lib/db/repo";
import { checkAccess, json, preflight } from "@/lib/import/http";

const MAX_ITEMS = 50;

// 가져오기 대상 물건을 고르기 위한 목록. 가져오기 API와 같은 토큰·Origin 검사를 거치고,
// 실제 모드 물건만 돌려준다(가격·메모 등은 돌려주지 않는다).
export function GET(req: Request) {
  const a = checkAccess(req);
  if ("response" in a) return a.response;
  const q = (new URL(req.url).searchParams.get("q") ?? "").slice(0, 100);
  const items = listItems(getDb(), false, { q })
    .slice(0, MAX_ITEMS)
    .map(({ item }) => ({
      id: item.id,
      name: item.name,
      identifier: item.identifier,
      category: item.category,
      condition: item.condition,
      status: item.status,
    }));
  return json({ items }, 200, a.access.corsOrigin);
}

export function OPTIONS(req: Request) {
  return preflight(req);
}
