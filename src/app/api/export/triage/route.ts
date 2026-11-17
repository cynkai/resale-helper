import { getDb } from "@/lib/db/client";
import { getTimeValuePerHour, listTriageCandidates } from "@/lib/db/repo";
import { buildTriageCsv } from "@/lib/domain/report-csv";
import { compareTriage, triageItem } from "@/lib/domain/triage";
import { isDemoMode } from "@/lib/mode";
import { todayYmd } from "@/lib/today";

// 배분 화면의 물건별 판단을 CSV로 내보낸다. 현재 모드의 자료만, 화면과 같은 순서로. 합계 행은 없다.
export async function GET() {
  const demo = await isDemoMode();
  const db = getDb();
  const today = todayYmd();
  const timeValue = getTimeValuePerHour(db, demo);
  const rows = listTriageCandidates(db, demo)
    .map((c) => ({ c, result: triageItem(c, timeValue, today) }))
    .sort((a, b) => compareTriage(a.result, b.result) || a.c.item.id - b.c.item.id)
    .map(({ c, result }) => ({ name: c.item.name, category: c.item.category, status: c.item.status, isDemo: c.item.isDemo, result }));
  return new Response(buildTriageCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${demo ? "DEMO-" : ""}triage-${today}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
