import { getDb } from "@/lib/db/client";
import { listAllItems } from "@/lib/db/repo";
import { buildItemsCsv } from "@/lib/domain/items-csv";
import { isDemoMode } from "@/lib/mode";
import { todayYmd } from "@/lib/today";

// 물건 목록 CSV 내보내기. 현재 모드(실제/데모)의 물건 정보만 담는다(가격 자료·계산·판매 결과는 담지 않는다).
export async function GET() {
  const demo = await isDemoMode();
  const csv = buildItemsCsv(listAllItems(getDb(), demo));
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${demo ? "DEMO-" : ""}items-${todayYmd()}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
