// 앱 안에서 만드는 백업 사본. DB 파일 옆의 backups/<db이름>/ 폴더에 쌓아 둔다.
// 사용자가 버튼을 눌렀을 때만 만든다(예약·자동 실행 없음). 자동으로 지우지도 않는다.
// 파일 이름은 앱이 정한 형식만 받는다(경로를 끼워 넣을 수 없게).

import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { validateBackup } from "./backup";

/** 사본을 두는 폴더. DB 파일마다 따로 둔다(테스트용 DB의 사본이 실제 DB의 사본과 섞이지 않게). */
export function snapshotDir(dbPath: string): string {
  return path.join(path.dirname(dbPath), "backups", path.basename(dbPath, path.extname(dbPath)));
}

function prefix(dbPath: string): string {
  return path.basename(dbPath, path.extname(dbPath)).replace(/[^A-Za-z0-9_-]/g, "_");
}

/** 한국 시간 기준 YYYYMMDD-HHMMSS */
function stamp(now: Date): string {
  const s = new Date(now.getTime() + 9 * 3600 * 1000).toISOString(); // Asia/Seoul = UTC+9 고정
  return `${s.slice(0, 10).replace(/-/g, "")}-${s.slice(11, 19).replace(/:/g, "")}`;
}

/** 이 DB의 사본 파일 이름인지(형식이 맞는 이름만 다룬다). */
export function isSnapshotName(dbPath: string, name: string): boolean {
  const m = /^([A-Za-z0-9_-]+)-\d{8}-\d{6}\.db$/.exec(name);
  return m !== null && m[1] === prefix(dbPath);
}

export type Snapshot = { name: string; bytes: number; createdLabel: string };

function label(name: string): string {
  const m = /-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.db$/.exec(name)!;
  return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}`;
}

/** 최근에 만든 것부터. */
export function listSnapshots(dbPath: string): Snapshot[] {
  const dir = snapshotDir(dbPath);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((n) => isSnapshotName(dbPath, n))
    .sort()
    .reverse()
    .map((name) => ({ name, bytes: fs.statSync(path.join(dir, name)).size, createdLabel: label(name) }));
}

export type SnapshotResult = { ok: true; snapshot: Snapshot; items: number; prices: number } | { ok: false; error: string };

/** 지금 DB의 일관된 사본을 만든다(WAL에만 있는 내용도 포함). 만든 뒤 열어서 온전한지 확인한다. */
export function createSnapshot(sqlite: Database.Database, dbPath: string, now: Date = new Date()): SnapshotResult {
  const dir = snapshotDir(dbPath);
  fs.mkdirSync(dir, { recursive: true });
  const name = `${prefix(dbPath)}-${stamp(now)}.db`;
  const file = path.join(dir, name);
  if (fs.existsSync(file)) return { ok: false, error: "방금 만든 사본과 이름이 같습니다. 잠시 뒤에 다시 해 주세요." };
  fs.writeFileSync(file, sqlite.serialize(), { flag: "wx" });
  const check = validateBackup(file);
  if (!check.ok) {
    fs.rmSync(file, { force: true });
    return { ok: false, error: `사본을 만들었지만 확인에 실패해 지웠습니다: ${check.error}` };
  }
  return { ok: true, snapshot: { name, bytes: fs.statSync(file).size, createdLabel: label(name) }, items: check.items, prices: check.prices };
}

/** 사본 파일의 전체 경로. 형식이 맞지 않거나 없는 이름이면 null. */
export function snapshotPath(dbPath: string, name: string): string | null {
  if (!isSnapshotName(dbPath, name)) return null;
  const file = path.join(snapshotDir(dbPath), name);
  return fs.existsSync(file) ? file : null;
}

export function deleteSnapshot(dbPath: string, name: string): boolean {
  const file = snapshotPath(dbPath, name);
  if (!file) return false;
  fs.rmSync(file);
  // 사본을 다른 프로그램으로 열어 봤다면 보조 파일이 남아 있을 수 있다. 함께 지운다.
  for (const x of ["-wal", "-shm"]) fs.rmSync(`${file}${x}`, { force: true });
  return true;
}
