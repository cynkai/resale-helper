import { getDb } from "@/lib/db/client";
import { listImportTargets } from "@/lib/db/repo";
import { checkAccess, json, logImport, preflight } from "@/lib/import/http";

// 가져오기 대상 물건을 고르기 위한 목록. 가져오기 API와 같은 토큰·Origin 검사를 거치고,
// 실제 모드 물건만 돌려준다(가격·메모 등은 돌려주지 않는다).
export function GET(req: Request) {
  const a = checkAccess(req, "items");
  if ("response" in a) return a.response;
  logImport({ endpoint: "items", outcome: "OK", status: 200, route: a.access.route, origin: req.headers.get("origin") });
  const q = (new URL(req.url).searchParams.get("q") ?? "").slice(0, 100);
  const items = listImportTargets(getDb(), q);
  return json({ items }, 200, a.access.corsOrigin);
}

export function OPTIONS(req: Request) {
  return preflight(req);
}
