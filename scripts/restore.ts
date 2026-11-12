// 사용법: pnpm db:restore <백업 파일 경로>
// 반드시 앱(pnpm dev / pnpm start)을 끈 뒤 실행하세요.
import { resolveDbPath } from "../src/lib/db/client";
import { restoreBackup } from "../src/lib/db/backup";

const source = process.argv[2];
if (!source) {
  console.error("사용법: pnpm db:restore <백업 파일 경로>");
  process.exit(1);
}
const target = resolveDbPath();
const r = restoreBackup(source, target);
if (!r.ok) {
  console.error(`복구하지 않았습니다: ${r.error}`);
  process.exit(1);
}
console.log(`복구했습니다: ${target} (실제 물건 ${r.items}개, 실제 가격 자료 ${r.prices}건)`);
if (r.safetyCopy) console.log(`복구 전 DB는 여기에 남겨 두었습니다: ${r.safetyCopy}`);
