import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema";

export type Db = BetterSQLite3Database<typeof schema>;

export function resolveDbPath(): string {
  return path.resolve(/*turbopackIgnore: true*/ process.cwd(), process.env.DATABASE_PATH || "./data/resale.db");
}

/** DB 파일을 열고 마이그레이션을 적용한다. 테스트에서는 ":memory:" 또는 임시 파일 경로를 넘긴다. */
export function openDb(file: string): { db: Db; sqlite: Database.Database; close: () => void } {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: path.resolve(/*turbopackIgnore: true*/ process.cwd(), "drizzle") });
  return { db, sqlite, close: () => sqlite.close() };
}

const globalForDb = globalThis as unknown as { __resaleConn?: { db: Db; sqlite: Database.Database } };

function conn() {
  if (!globalForDb.__resaleConn) globalForDb.__resaleConn = openDb(resolveDbPath());
  return globalForDb.__resaleConn;
}

/** 앱 전역 연결(개발 서버의 모듈 재로딩에도 하나만 유지). */
export function getDb(): Db {
  return conn().db;
}

/** 백업처럼 SQLite 자체 기능이 필요할 때만 쓴다. */
export function getSqlite(): Database.Database {
  return conn().sqlite;
}
