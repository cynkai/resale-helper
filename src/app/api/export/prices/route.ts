import { getDb } from "@/lib/db/client";
import { exportRows, getItem } from "@/lib/db/repo";
import { buildCsv } from "@/lib/domain/csv";
import { isDemoMode } from "@/lib/mode";
import { todayYmd } from "@/lib/today";

// 가격 자료 CSV 내보내기. 현재 모드(실제/데모)의 자료만 내보내며 둘을 섞지 않는다.
export async function GET(req: Request) {
  const demo = await isDemoMode();
  const db = getDb();
  const rawId = new URL(req.url).searchParams.get("itemId");
  let itemId: number | undefined;
  if (rawId !== null) {
    if (!/^\d{1,12}$/.test(rawId) || !getItem(db, demo, Number(rawId))) {
      return new Response("물건을 찾을 수 없습니다.", { status: 404 });
    }
    itemId = Number(rawId);
  }
  const csv = buildCsv(exportRows(db, demo, itemId));
  const name = `${demo ? "DEMO-" : ""}prices-${itemId ?? "all"}-${todayYmd()}.csv`;
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}
