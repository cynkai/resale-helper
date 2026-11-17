import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb } from "@/lib/db/client";
import { getItem, listItems, listPrices, listSaleReviews, listScenarios, listTriageCandidates } from "@/lib/db/repo";
import { chosenScenario, isChoiceOutdated, primaryScenario } from "@/lib/domain/scenario";

// 예전 버전의 DB(자료가 들어 있는 상태)에 새 마이그레이션을 올려도 자료가 그대로이고 앱이 그 자료를 읽을 수 있는지 확인한다.
// 기준: 0005까지 적용된 DB(판매처별 계산·휴지통 등이 생기기 전).
const BASE_MIGRATIONS = 6;

let tmpDir: string;
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "resale-upgrade-"));
});
afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

/** drizzle 폴더를 복사하되 저널을 앞의 n개로 잘라 "예전 버전"의 마이그레이션 폴더를 만든다. */
function oldMigrationsFolder(n: number): string {
  const src = path.resolve(process.cwd(), "drizzle");
  const dst = path.join(tmpDir, "drizzle-old");
  fs.cpSync(src, dst, { recursive: true });
  const journalFile = path.join(dst, "meta", "_journal.json");
  const journal = JSON.parse(fs.readFileSync(journalFile, "utf8")) as { entries: { idx: number }[] };
  expect(journal.entries.length).toBeGreaterThan(n);
  journal.entries = journal.entries.filter((e) => e.idx < n);
  fs.writeFileSync(journalFile, JSON.stringify(journal));
  return dst;
}

describe("예전 DB에 새 마이그레이션 올리기", () => {
  it("자료가 그대로 남고, 새 칸은 '없음/모름'으로 채워지며, 앱이 그 자료로 그대로 동작한다", () => {
    const file = path.join(tmpDir, "old.db");
    const old = new Database(file);
    old.pragma("journal_mode = WAL");
    old.pragma("foreign_keys = ON");
    migrate(drizzle(old), { migrationsFolder: oldMigrationsFolder(BASE_MIGRATIONS) });

    // 예전 스키마에 있던 칸만 써서 자료를 넣는다.
    old.exec(`
      insert into items (id, is_demo, category, status, name, identifier, condition, chosen_method, chosen_sale_amount, chosen_net_amount, chosen_at)
        values (1, 0, 'CONSOLE', 'SOLD', '예전 게임기', 'OLD-1', 'GOOD', 'DIRECT', 20000, 17000, '2026-11-10 01:00:00'),
               (2, 0, 'BOOK', 'OWNED', '예전 책', '9780306406157', 'FAIR', null, null, null, null),
               (3, 1, 'CONSOLE', 'OWNED', '(데모) 예전 물건', null, 'GOOD', null, null, null, null);
      insert into price_records (id, item_id, is_demo, price_type, amount_minor, currency, source_name, external_id, checked_date, input_route)
        values (1, 1, 0, 'ASKING', 21000, 'KRW', '가 장터', 'A-1', '2026-11-01', 'MANUAL'),
               (2, 1, 0, 'ASKING', 1250, 'USD', '해외', 'U-1', '2026-11-02', 'CSV'),
               (3, 2, 0, 'BUYBACK_QUOTE', 6000, 'KRW', '가 서점', 'B-1', '2026-11-03', 'MANUAL');
      insert into cost_scenarios (id, item_id, method, sale_amount, fee_mode, fee_amount, shipping, packing, transport, expected_minutes)
        values (1, 1, 'BUYBACK', 15000, 'AMOUNT', 0, 0, 0, 0, 20),
               (2, 1, 'DIRECT', 20000, 'AMOUNT', 0, 3000, 0, 0, 80),
               (3, 2, 'BUYBACK', 6000, 'AMOUNT', 0, 0, 0, null, null);
      insert into sale_results (id, item_id, channel, sold_date, amount, cost_total, minutes_spent)
        values (1, 1, '가 장터', '2026-11-12', 19000, 3000, 90);
    `);
    const appliedBefore = (old.prepare("select count(*) n from __drizzle_migrations").get() as { n: number }).n;
    expect(appliedBefore).toBe(BASE_MIGRATIONS);
    old.close();

    // 지금 버전의 앱이 그 DB를 연다(남은 마이그레이션이 모두 적용된다).
    const { db, sqlite, close } = openDb(file);
    try {
      const appliedAfter = (sqlite.prepare("select count(*) n from __drizzle_migrations").get() as { n: number }).n;
      expect(appliedAfter).toBeGreaterThan(BASE_MIGRATIONS);
      expect(sqlite.pragma("integrity_check", { simple: true })).toBe("ok");
      expect(sqlite.pragma("foreign_key_check")).toEqual([]);

      // 물건: 모두 살아 있고(휴지통 아님), 새 칸은 비어 있다
      const real = listItems(db, false);
      expect(real.map((r) => r.item.name).sort()).toEqual(["예전 게임기", "예전 책"]);
      expect(listItems(db, true).map((r) => r.item.name)).toEqual(["(데모) 예전 물건"]);
      const sold = getItem(db, false, 1)!;
      expect(sold).toMatchObject({ deletedAt: null, purchaseAmount: null, purchaseDate: null, chosenMethod: "DIRECT", chosenChannel: null, chosenSaleAmount: 20000 });

      // 가격 자료: 금액·유형 그대로, 새 칸(환율, 구성 일치)은 모름
      const prices = listPrices(db, 1);
      expect(prices.map((p) => [p.priceType, p.amountMinor, p.currency])).toEqual([
        ["ASKING", 1250, "USD"],
        ["ASKING", 21000, "KRW"],
      ]);
      expect(prices.every((p) => p.fxRateE4 === null && p.fxDate === null && p.componentsMatch === "UNKNOWN" && p.includedInComparison)).toBe(true);

      // 계산: 이름 없는 계산 하나씩으로 남고, 방식마다 하나뿐이라 표시 없이도 기준이다
      const scs = listScenarios(db, 1);
      expect(scs.map((s) => [s.method, s.channel, s.isPrimary, s.saleAmount])).toEqual([
        ["BUYBACK", "", false, 15000],
        ["DIRECT", "", false, 20000],
      ]);
      expect(primaryScenario(scs, "DIRECT")?.saleAmount).toBe(20000);
      // 예전 선택(판매처 이름 칸이 없던 때)이 그 계산을 가리키고, 낡은 선택으로 보이지 않는다
      const chosen = chosenScenario(sold, scs);
      expect(chosen?.id).toBe(2);
      expect(isChoiceOutdated(sold, chosen)).toBe(false);
      expect(listScenarios(db, 2)[0]).toMatchObject({ transport: null, expectedMinutes: null }); // 모름은 모름으로 남는다

      // 판매 결과: 합계 그대로, 항목별 칸은 비어 있고, 돌아보기가 고른 계산의 예상 시간을 찾는다
      const reviews = listSaleReviews(db, false);
      expect(reviews).toHaveLength(1);
      expect(reviews[0]!.result).toMatchObject({ amount: 19000, costTotal: 3000, feeActual: null, shippingActual: null });
      expect(reviews[0]!.expectedMinutes).toBe(80);

      // 배분: 아직 팔지 않은 물건만
      expect(listTriageCandidates(db, false).map((c) => c.item.name)).toEqual(["예전 책"]);
    } finally {
      close();
    }
  });
});
