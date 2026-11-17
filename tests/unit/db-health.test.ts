import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "@/lib/db/client";
import { seedDemo } from "@/lib/db/demo-seed";
import { checkDbHealth, dataStats } from "@/lib/db/health";
import { createItem, deletePrices, getItem, insertPrice, listPrices, trashItem } from "@/lib/db/repo";
import { validatePriceInput } from "@/lib/domain/price-input";
import type Database from "better-sqlite3";

let tmpDir: string;
let db: Db;
let sqlite: Database.Database;
let close: () => void;
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "resale-health-"));
  ({ db, sqlite, close } = openDb(path.join(tmpDir, "t.db")));
});
afterEach(() => {
  try {
    close();
  } catch {}
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("DB 점검", () => {
  it("빈 DB와 데모 시드는 모든 점검을 통과한다", () => {
    expect(checkDbHealth(sqlite).ok).toBe(true);
    seedDemo(db, "2026-11-18");
    const r = checkDbHealth(sqlite);
    expect(r.checks.filter((c) => !c.ok)).toEqual([]);
    expect(r.checks.map((c) => c.key)).toEqual(["integrity", "foreign_keys", "demo_isolation", "verified_sale", "amounts", "primary", "basis_owner"]);
  });

  it("앱 규칙이 깨진 자료를 찾아 건수로 알려 주고, 아무것도 고치지 않는다", () => {
    seedDemo(db, "2026-11-18");
    const priceId = (sqlite.prepare("select id from price_records limit 1").get() as { id: number }).id;
    sqlite.prepare("update price_records set is_demo = 0, price_type = 'VERIFIED_SALE', amount_minor = -1 where id = ?").run(priceId);
    const sc = sqlite.prepare("select item_id, method from cost_scenarios limit 1").get() as { item_id: number; method: string };
    sqlite.prepare("insert into cost_scenarios (item_id, method, channel, is_primary, sale_amount) values (?, ?, 'x', 1, 1), (?, ?, 'y', 1, 1)").run(sc.item_id, sc.method, sc.item_id, sc.method);
    const other = (sqlite.prepare("select id from items where id <> (select item_id from price_records where id = ?) limit 1").get(priceId) as { id: number }).id;
    sqlite.prepare("insert into cost_scenarios (item_id, method, channel, sale_amount, basis_price_record_id) values (?, 'BUYBACK', 'z', 1, ?)").run(other, priceId);
    sqlite.pragma("foreign_keys = OFF");
    sqlite.prepare("insert into offers (item_id, amount, received_date, status) values (999999, 1000, '2026-11-18', 'OPEN')").run();
    sqlite.pragma("foreign_keys = ON");

    const r = checkDbHealth(sqlite);
    const bad = Object.fromEntries(r.checks.filter((c) => !c.ok).map((c) => [c.key, c.detail]));
    expect(r.ok).toBe(false);
    expect(bad).toEqual({
      foreign_keys: "offers 1건",
      demo_isolation: "물건과 데모 표시가 다른 가격 자료 1건",
      verified_sale: expect.stringContaining("1건"),
      amounts: "0보다 작은 금액 1건",
      primary: "기준 계산이 둘 이상인 물건·방식 1곳",
      basis_owner: "다른 물건의 가격 자료를 기준으로 한 계산 1개",
    });
    // 읽기만 한다
    expect((sqlite.prepare("select price_type from price_records where id = ?").get(priceId) as { price_type: string }).price_type).toBe("VERIFIED_SALE");
  });
});

describe("내 자료 현황", () => {
  it("모드별 건수(휴지통 따로)와 파일 크기만 센다", () => {
    seedDemo(db, "2026-11-18");
    const base = { category: "BOOK" as const, status: "OWNED" as const, condition: "GOOD" as const, identifier: null, defects: null, components: null, memo: null, author: null, publisher: null, edition: null, hasWriting: "UNKNOWN" as const, hasUnderline: "UNKNOWN" as const, hasDamage: "UNKNOWN" as const, hasSupplement: "UNKNOWN" as const };
    const a = createItem(db, false, { ...base, name: "가" });
    const b = createItem(db, false, { ...base, name: "나" });
    for (const [id, ext] of [[a, "1"], [a, "2"], [b, "3"]] as const) {
      const p = validatePriceInput({ priceType: "ASKING", amount: "1000", sourceName: "장터", checkedDate: "2026-11-18", externalId: ext }, { route: "MANUAL", today: "2026-11-18" });
      if (!p.ok) throw new Error("p");
      insertPrice(db, getItem(db, false, id)!, p.value, "MANUAL");
    }
    deletePrices(db, a, [listPrices(db, a)[0]!.id]);
    trashItem(db, false, b);
    const st = dataStats(sqlite, "/x.db", (f) => (f === "/x.db" ? 4096 : f === "/x.db-wal" ? 1024 : 0));
    expect(st.fileBytes).toBe(5120);
    expect(st.modes[0]).toEqual({ isDemo: false, items: 1, trashedItems: 1, prices: 1, trashedPrices: 2, results: 0 });
    expect(st.modes[1]!.isDemo).toBe(true);
    expect(st.modes[1]!.items).toBeGreaterThan(0);
    expect(st.modes[1]!.trashedItems).toBe(0);
  });
});
