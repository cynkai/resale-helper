import { getDb } from "@/lib/db/client";
import { listPostedPricesByItem, listSaleReviews } from "@/lib/db/repo";
import { summarizePosted } from "@/lib/domain/posted-price";
import { buildResultsCsv } from "@/lib/domain/report-csv";
import { scenarioLabel } from "@/lib/domain/scenario";
import { SALE_METHOD_LABEL } from "@/lib/domain/types";
import { isDemoMode } from "@/lib/mode";
import { todayYmd } from "@/lib/today";

// 판매 결과 돌아보기의 물건별 기록을 CSV로 내보낸다. 현재 모드의 자료만. 합계 행은 없다.
export async function GET() {
  const demo = await isDemoMode();
  const db = getDb();
  const posted = listPostedPricesByItem(db, demo);
  const rows = listSaleReviews(db, demo).map((r) => ({
    name: r.item.name,
    category: r.item.category,
    soldDate: r.result.soldDate,
    channel: r.result.channel,
    chosen: r.item.chosenMethod ? scenarioLabel(SALE_METHOD_LABEL[r.item.chosenMethod], r.item.chosenChannel ?? "") : "",
    chosenSaleAmount: r.item.chosenSaleAmount,
    chosenNetAmount: r.item.chosenNetAmount,
    expectedMinutes: r.expectedMinutes,
    amount: r.result.amount,
    costTotal: r.result.costTotal,
    minutesSpent: r.result.minutesSpent,
    firstPostedPrice: summarizePosted(posted.get(r.item.id) ?? [])?.first ?? null,
    purchaseAmount: r.item.purchaseAmount,
    isDemo: r.item.isDemo,
  }));
  return new Response(buildResultsCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${demo ? "DEMO-" : ""}results-${todayYmd()}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
