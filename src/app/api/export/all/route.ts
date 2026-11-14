import { getDb } from "@/lib/db/client";
import { listFullExportSources } from "@/lib/db/repo";
import { buildFullExport } from "@/lib/domain/full-export";
import { isDemoMode } from "@/lib/mode";
import { todayYmd } from "@/lib/today";

// 사람이 읽을 수 있는 전체 내보내기(JSON). 현재 모드의 자료만 담고, 설정(토큰 해시 등)은 담지 않는다.
// 복구용이 아니다. 복구는 DB 백업 파일(/api/backup)과 `pnpm db:restore`를 쓴다.
export async function GET() {
  const demo = await isDemoMode();
  const today = todayYmd();
  const body = buildFullExport({ demo, exportedDate: today, sources: listFullExportSources(getDb(), demo) });
  return new Response(JSON.stringify(body, null, 2) + "\n", {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${demo ? "DEMO-" : ""}resale-export-${today}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
