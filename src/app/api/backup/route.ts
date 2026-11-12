import { getSqlite } from "@/lib/db/client";
import { todayYmd } from "@/lib/today";

// 전체 DB 백업 다운로드. 실제 자료와 데모 자료가 모두 들어 있는 DB 파일 그대로다(데모는 is_demo로 구분).
// localhost 외 요청은 proxy에서 이미 거부된다.
export async function GET() {
  const data = getSqlite().serialize();
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": "application/vnd.sqlite3",
      "Content-Disposition": `attachment; filename="resale-backup-${todayYmd()}.db"`,
      "Content-Length": String(data.length),
      "Cache-Control": "no-store",
    },
  });
}
