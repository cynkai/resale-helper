import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { restoreBackup, validateBackup } from "@/lib/db/backup";
import { openDb } from "@/lib/db/client";
import { createItem, listItems, trashItem } from "@/lib/db/repo";
import { createSnapshot, deleteSnapshot, isSnapshotName, listSnapshots, snapshotDir, snapshotPath } from "@/lib/db/snapshots";
import type { ValidItemInput } from "@/lib/domain/item-input";

const input = (name: string): ValidItemInput => ({
  category: "CONSOLE",
  status: "OWNED",
  name,
  identifier: null,
  condition: "GOOD",
  defects: null,
  components: null,
  memo: null,
  author: null,
  publisher: null,
  edition: null,
  hasWriting: "UNKNOWN",
  hasUnderline: "UNKNOWN",
  hasDamage: "UNKNOWN",
  hasSupplement: "UNKNOWN",
});

let tmpDir: string;
let dbPath: string;
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "resale-snap-"));
  dbPath = path.join(tmpDir, "resale.db");
});
afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

describe("백업 사본", () => {
  it("DB마다 다른 폴더에, 한국 시간 이름으로 만들고, 만든 사본은 온전한 DB다", () => {
    const { db, sqlite, close } = openDb(dbPath);
    createItem(db, false, input("게임기"));
    const r = createSnapshot(sqlite, dbPath, new Date("2026-11-17T03:04:05Z"));
    expect(r).toMatchObject({ ok: true, items: 1, prices: 0, snapshot: { name: "resale-20261117-120405.db", createdLabel: "2026-11-17 12:04:05" } });
    expect(snapshotDir(dbPath)).toBe(path.join(tmpDir, "backups", "resale"));
    expect(snapshotDir(path.join(tmpDir, "e2e.db"))).toBe(path.join(tmpDir, "backups", "e2e"));
    expect(validateBackup(path.join(snapshotDir(dbPath), "resale-20261117-120405.db"))).toMatchObject({ ok: true, items: 1 });
    // 같은 초에 다시 만들면 덮어쓰지 않는다
    expect(createSnapshot(sqlite, dbPath, new Date("2026-11-17T03:04:05Z"))).toMatchObject({ ok: false });
    createSnapshot(sqlite, dbPath, new Date("2026-11-17T03:05:00Z"));
    expect(listSnapshots(dbPath).map((s) => s.name)).toEqual(["resale-20261117-120500.db", "resale-20261117-120405.db"]);
    close();
  });

  it("앱이 정한 형식의 이름만 다룬다(경로를 끼워 넣을 수 없다)", () => {
    const { sqlite, close } = openDb(dbPath);
    createSnapshot(sqlite, dbPath, new Date("2026-11-17T03:04:05Z"));
    close();
    for (const bad of ["../resale.db", "resale.db", "..%2Fresale.db", "e2e-20261117-120405.db", "resale-20261117-120405.db/../x", "resale-2026-11-17.db", ""]) {
      expect(isSnapshotName(dbPath, bad)).toBe(false);
      expect(snapshotPath(dbPath, bad)).toBeNull();
      expect(deleteSnapshot(dbPath, bad)).toBe(false);
    }
    expect(fs.existsSync(dbPath)).toBe(true);
    // 폴더에 다른 파일이 있어도 목록에 나오지 않는다
    fs.writeFileSync(path.join(snapshotDir(dbPath), "메모.txt"), "x");
    expect(listSnapshots(dbPath)).toHaveLength(1);
    expect(snapshotPath(dbPath, "resale-20261117-999999.db")).toBeNull(); // 없는 파일
    expect(deleteSnapshot(dbPath, "resale-20261117-120405.db")).toBe(true);
    expect(listSnapshots(dbPath)).toHaveLength(0);
    expect(fs.existsSync(path.join(snapshotDir(dbPath), "메모.txt"))).toBe(true);
  });

  it("사본으로 되돌리면 그때의 자료(휴지통 포함)가 돌아온다", () => {
    const a = openDb(dbPath);
    const id = createItem(a.db, false, input("지울 게임기"));
    const snap = createSnapshot(a.sqlite, dbPath, new Date("2026-11-17T03:04:05Z"));
    if (!snap.ok) throw new Error(snap.error);
    trashItem(a.db, false, id);
    expect(listItems(a.db, false)).toHaveLength(0);
    a.close();
    const r = restoreBackup(path.join(snapshotDir(dbPath), snap.snapshot.name), dbPath);
    expect(r).toMatchObject({ ok: true, items: 1 });
    const b = openDb(dbPath);
    expect(listItems(b.db, false).map((x) => x.item.name)).toEqual(["지울 게임기"]);
    b.close();
  });

  it("사본이 없으면 빈 목록", () => {
    expect(listSnapshots(dbPath)).toEqual([]);
  });
});
