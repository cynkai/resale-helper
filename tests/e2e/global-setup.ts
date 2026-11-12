import fs from "node:fs";
import path from "node:path";

// 매 실행마다 E2E 전용 DB를 새로 만든다. 개인 DB(data/resale.db)는 건드리지 않는다.
export default function globalSetup() {
  for (const suffix of ["", "-wal", "-shm"]) {
    fs.rmSync(path.resolve(process.cwd(), `data/e2e.db${suffix}`), { force: true });
  }
}
