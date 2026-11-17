import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "@/lib/db/client";
import { authorizeImport, generateImportToken } from "@/lib/import/access";
import { clearImportEvents, countSuspiciousImportEvents, listImportEvents, MAX_IMPORT_EVENTS, recordImportEvent } from "@/lib/import/events";

let tmpDir: string;
let db: Db;
let close: () => void;
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "resale-import-log-"));
  ({ db, close } = openDb(path.join(tmpDir, "t.db")));
});
afterEach(() => {
  try {
    close();
  } catch {}
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("가져오기 API 사용 기록", () => {
  it("거부 이유를 구분한다(Origin, 토큰 없음, 토큰 틀림)", () => {
    const { token, hash } = generateImportToken();
    const settings = { tokenHash: hash, extensionId: null };
    expect(authorizeImport({ authorization: `Bearer ${token}`, origin: "https://evil.example" }, settings)).toMatchObject({ ok: false, reason: "ORIGIN" });
    expect(authorizeImport({ authorization: `Bearer ${token}`, origin: null }, { tokenHash: null, extensionId: null })).toMatchObject({ ok: false, reason: "DISABLED" });
    expect(authorizeImport({ authorization: "Bearer rh_wrong", origin: null }, settings)).toMatchObject({ ok: false, reason: "TOKEN" });
    expect(authorizeImport({ authorization: `Bearer ${token}`, origin: null }, settings)).toMatchObject({ ok: true, route: "EXTERNAL" });
  });

  it("가격 저장은 건마다 남기고, 같은 거부 요청과 물건 목록 읽기는 한 줄에 횟수만 올린다", () => {
    recordImportEvent(db, { endpoint: "prices", outcome: "OK", status: 200, route: "EXTERNAL", itemId: 3, imported: 2, rejected: 1 });
    recordImportEvent(db, { endpoint: "prices", outcome: "OK", status: 200, route: "EXTERNAL", itemId: 3, imported: 2, rejected: 1 });
    for (let i = 0; i < 5; i++) recordImportEvent(db, { endpoint: "prices", outcome: "DENIED_ORIGIN", status: 403, origin: "https://evil.example" });
    recordImportEvent(db, { endpoint: "prices", outcome: "DENIED_ORIGIN", status: 403, origin: "https://other.example" });
    for (let i = 0; i < 3; i++) recordImportEvent(db, { endpoint: "items", outcome: "OK", status: 200, route: "CLIP", origin: "chrome-extension://abc" });
    const rows = listImportEvents(db).reverse();
    expect(rows.map((r) => [r.endpoint, r.outcome, r.count, r.origin])).toEqual([
      ["prices", "OK", 1, null],
      ["prices", "OK", 1, null],
      ["prices", "DENIED_ORIGIN", 5, "https://evil.example"],
      ["prices", "DENIED_ORIGIN", 1, "https://other.example"],
      ["items", "OK", 3, "chrome-extension://abc"],
    ]);
    expect(rows[0]).toMatchObject({ itemId: 3, imported: 2, rejected: 1, route: "EXTERNAL" });
    expect(countSuspiciousImportEvents(db)).toBe(6);
  });

  it("토큰이나 요청 내용을 담을 칸이 없고, Origin은 길이를 자른다", () => {
    recordImportEvent(db, { endpoint: "prices", outcome: "BAD_TOKEN", status: 401, origin: `https://${"a".repeat(500)}.example` });
    const row = listImportEvents(db)[0]!;
    expect(Object.keys(row).sort()).toEqual(["at", "count", "endpoint", "id", "imported", "itemId", "origin", "outcome", "rejected", "route", "status"]);
    expect(row.origin!.length).toBe(200);
    expect(JSON.stringify(row)).not.toMatch(/rh_|Bearer|authorization/i);
  });

  it("정해 둔 줄 수를 넘으면 오래된 것부터 지우고, 비우기로 모두 지운다", () => {
    for (let i = 0; i < MAX_IMPORT_EVENTS + 20; i++) {
      recordImportEvent(db, { endpoint: "prices", outcome: "OK", status: 200, route: "EXTERNAL", itemId: i, imported: 1, rejected: 0 });
    }
    const all = listImportEvents(db, 10_000);
    expect(all).toHaveLength(MAX_IMPORT_EVENTS);
    expect(all[0]!.itemId).toBe(MAX_IMPORT_EVENTS + 19);
    expect(all.at(-1)!.itemId).toBe(20);
    clearImportEvents(db);
    expect(listImportEvents(db)).toHaveLength(0);
    expect(countSuspiciousImportEvents(db)).toBe(0);
  });
});
