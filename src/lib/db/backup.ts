// 전체 DB 백업 파일 검증과 복구. 복구는 앱을 끈 상태에서 스크립트(pnpm db:restore)로만 한다.

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const SQLITE_HEADER = "SQLite format 3\u0000";
const REQUIRED_TABLES = ["items", "price_records", "cost_scenarios", "sale_results", "__drizzle_migrations"];

export type BackupCheck = { ok: true; items: number; prices: number } | { ok: false; error: string };

/** 파일이 이 앱의 SQLite DB인지 확인한다. 읽기 전용으로 열며 파일을 바꾸지 않는다. */
export function validateBackup(file: string): BackupCheck {
  if (!fs.existsSync(file)) return { ok: false, error: `파일이 없습니다: ${file}` };
  const fd = fs.openSync(file, "r");
  const head = Buffer.alloc(16);
  fs.readSync(fd, head, 0, 16, 0);
  fs.closeSync(fd);
  if (head.toString("latin1") !== SQLITE_HEADER) return { ok: false, error: "SQLite 데이터베이스 파일이 아닙니다." };

  let db: Database.Database | null = null;
  try {
    db = new Database(file, { readonly: true, fileMustExist: true });
    const integrity = db.pragma("integrity_check", { simple: true });
    if (integrity !== "ok") return { ok: false, error: `파일이 손상되었습니다(integrity_check: ${String(integrity)}).` };
    const tables = new Set(
      (db.prepare("select name from sqlite_master where type = 'table'").all() as { name: string }[]).map((r) => r.name),
    );
    const missing = REQUIRED_TABLES.filter((t) => !tables.has(t));
    if (missing.length > 0) return { ok: false, error: `이 앱의 백업 파일이 아닙니다(없는 테이블: ${missing.join(", ")}).` };
    const count = (t: string) => (db!.prepare(`select count(*) as n from ${t} where is_demo = 0`).get() as { n: number }).n;
    return { ok: true, items: count("items"), prices: count("price_records") };
  } catch (e) {
    return { ok: false, error: `파일을 열 수 없습니다(${e instanceof Error ? e.message : String(e)}).` };
  } finally {
    db?.close();
  }
}

export type RestoreResult =
  | { ok: true; safetyCopy: string | null; items: number; prices: number }
  | { ok: false; error: string };

/**
 * 백업 파일로 현재 DB를 바꾼다. 바꾸기 전에 현재 DB를 safety copy로 남긴다.
 * 앱이 켜져 있으면 열린 연결이 옛 파일을 계속 쓰므로, 반드시 앱을 끈 상태에서 실행한다.
 */
export function restoreBackup(source: string, target: string, now: Date = new Date()): RestoreResult {
  const check = validateBackup(source);
  if (!check.ok) return check;
  if (path.resolve(source) === path.resolve(target)) return { ok: false, error: "백업 파일과 현재 DB가 같은 파일입니다." };

  let safetyCopy: string | null = null;
  if (fs.existsSync(target)) {
    const stamp = now.toISOString().replace(/[:.]/g, "-");
    safetyCopy = path.join(path.dirname(target), `${path.basename(target, ".db")}.before-restore-${stamp}.db`);
    // WAL 내용까지 합친 일관된 사본을 만든다.
    const current = new Database(target, { fileMustExist: true });
    try {
      current.pragma("wal_checkpoint(TRUNCATE)");
      fs.writeFileSync(safetyCopy, current.serialize());
    } finally {
      current.close();
    }
  }
  for (const suffix of ["-wal", "-shm"]) fs.rmSync(`${target}${suffix}`, { force: true });
  fs.copyFileSync(source, target);
  return { ok: true, safetyCopy, items: check.items, prices: check.prices };
}
