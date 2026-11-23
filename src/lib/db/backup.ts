// 전체 DB 백업 파일 검증과 복구. 복구는 앱을 끈 상태에서 스크립트(pnpm db:restore)로만 한다.

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const REQUIRED_TABLES = ["items", "price_records", "cost_scenarios", "sale_results", "__drizzle_migrations"];

export type BackupCheck = { ok: true; items: number; prices: number } | { ok: false; error: string };

function checkContents(db: Database.Database): BackupCheck {
  const integrity = db.pragma("integrity_check", { simple: true });
  if (integrity !== "ok") return { ok: false, error: `파일이 손상되었습니다(integrity_check: ${String(integrity)}).` };
  const tables = new Set(db.prepare<[], string>("select name from sqlite_master where type = 'table'").pluck().all());
  const missing = REQUIRED_TABLES.filter((t) => !tables.has(t));
  if (missing.length > 0) return { ok: false, error: `이 앱의 백업 파일이 아닙니다(없는 테이블: ${missing.join(", ")}).` };
  const count = (table: "items" | "price_records") =>
    db.prepare<[], number>(`select count(*) from ${table} where is_demo = 0`).pluck().get() ?? 0;
  return { ok: true, items: count("items"), prices: count("price_records") };
}

export function validateBackup(file: string): BackupCheck {
  try {
    const source = new Database(file, { readonly: true, fileMustExist: true });
    try {
      return checkContents(source);
    } finally {
      source.close();
    }
  } catch (error) {
    return { ok: false, error: `SQLite 백업 파일을 확인할 수 없습니다(${error instanceof Error ? error.message : String(error)}).` };
  }
}

export type RestoreResult =
  | { ok: true; safetyCopy: string | null; items: number; prices: number }
  | { ok: false; error: string };

function saveCurrent(target: string, now: Date): string {
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const safetyCopy = path.join(path.dirname(target), `${path.basename(target, ".db")}.before-restore-${stamp}.db`);
  const current = new Database(target, { readonly: true, fileMustExist: true });
  try {
    const contents = current.serialize();
    const fd = fs.openSync(safetyCopy, "wx", 0o600);
    try {
      fs.writeFileSync(fd, contents);
      fs.fsyncSync(fd);
    } catch (error) {
      fs.rmSync(safetyCopy);
      throw error;
    } finally {
      fs.closeSync(fd);
    }
  } finally {
    current.close();
  }
  return safetyCopy;
}

/** 검증한 읽기 트랜잭션의 내용(WAL 포함)을 SQLite가 한 번에 복구한다. */
export async function restoreBackup(source: string, target: string, now: Date = new Date()): Promise<RestoreResult> {
  let safetyCopy: string | null = null;
  try {
    const sourceStat = fs.statSync(source, { bigint: true });
    const targetStat = fs.statSync(target, { bigint: true, throwIfNoEntry: false });
    if (sourceStat.dev === targetStat?.dev && sourceStat.ino === targetStat.ino) {
      return { ok: false, error: "백업 파일과 현재 DB가 같은 파일입니다." };
    }
    const input = new Database(source, { readonly: true, fileMustExist: true });
    try {
      input.exec("BEGIN");
      const check = checkContents(input);
      if (!check.ok) return check;

      fs.mkdirSync(path.dirname(target), { recursive: true });
      if (targetStat) safetyCopy = saveCurrent(target, now);
      const copied = await input.backup(target);
      // SQLite가 대상의 쓰기 잠금을 얻지 못한 첫 단계에서는 0페이지가 반환될 수 있다.
      if (copied.totalPages === 0) {
        const saved = safetyCopy ? ` 복구 전 DB 사본: ${safetyCopy}` : "";
        return { ok: false, error: `현재 DB가 사용 중입니다. 앱과 DB를 사용하는 프로그램을 끈 뒤 다시 시도해 주세요.${saved}` };
      }
      return { ...check, safetyCopy };
    } finally {
      input.close();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const saved = safetyCopy ? ` 복구 전 DB 사본: ${safetyCopy}` : "";
    return { ok: false, error: `SQLite 백업을 복구할 수 없습니다(${message}).${saved}` };
  }
}
