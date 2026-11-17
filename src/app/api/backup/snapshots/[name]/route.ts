import fs from "node:fs";
import { resolveDbPath } from "@/lib/db/client";
import { snapshotPath } from "@/lib/db/snapshots";

// 앱 안에서 만든 백업 사본 내려받기. 이름은 앱이 정한 형식만 받는다(다른 파일을 읽을 수 없게).
export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const file = snapshotPath(resolveDbPath(), name);
  if (!file) return new Response("사본을 찾을 수 없습니다.", { status: 404 });
  const data = fs.readFileSync(file);
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": "application/vnd.sqlite3",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Content-Length": String(data.length),
      "Cache-Control": "no-store",
    },
  });
}
