import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { restoreBackup, validateBackup } from "@/lib/db/backup";
import { openDb } from "@/lib/db/client";
import { seedDemo } from "@/lib/db/demo-seed";
import { createItem, listItems, listSaleReviews, setChosenMethod, upsertSaleResult, upsertScenario } from "@/lib/db/repo";
import type { ValidItemInput } from "@/lib/domain/item-input";
import { channelKey, countOutcomes, countTimeOutcomes, timeOutcome, groupOutcomes, reviewRow } from "@/lib/domain/review";

const book: ValidItemInput = {
  category: "BOOK",
  status: "OWNED",
  name: "백업 테스트 책",
  identifier: "9780306406157",
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
};

describe("판매 결과 돌아보기", () => {
  const base = { chosenSaleAmount: 19000, chosenNetAmount: 14335, expectedMinutes: 60, amount: 18000, costTotal: 4000, minutesSpent: 50 };
  it("판매금액·실수령액·시간 차이를 실제 − 예상으로 계산한다", () => {
    expect(reviewRow(base)).toEqual({ actualNet: 14000, saleDiff: -1000, netDiff: -335, minutesDiff: -10, outcome: "BELOW" });
    expect(reviewRow({ ...base, costTotal: 3000 }).outcome).toBe("ABOVE");
    expect(reviewRow({ ...base, costTotal: 3665 }).outcome).toBe("EQUAL");
  });
  it("실제 비용이 '모름'이면 0원으로 보지 않고 실수령액 비교를 하지 않는다", () => {
    const r = reviewRow({ ...base, costTotal: null });
    expect(r.actualNet).toBeNull();
    expect(r.netDiff).toBeNull();
    expect(r.outcome).toBe("UNKNOWN");
    expect(r.saleDiff).toBe(-1000);
  });
  it("선택 당시 실수령액이 불완전했거나 방법을 고르지 않았으면 비교 불가", () => {
    expect(reviewRow({ ...base, chosenNetAmount: null }).outcome).toBe("UNKNOWN");
    const none = reviewRow({ ...base, chosenSaleAmount: null, chosenNetAmount: null, expectedMinutes: null });
    expect(none).toMatchObject({ saleDiff: null, netDiff: null, minutesDiff: null, outcome: "UNKNOWN" });
  });
  it("건수만 센다", () => {
    const rows = [reviewRow(base), reviewRow({ ...base, costTotal: 0 }), reviewRow({ ...base, costTotal: null })];
    expect(countOutcomes(rows)).toEqual({ ABOVE: 1, EQUAL: 0, BELOW: 1, UNKNOWN: 1 });
  });
});

describe("시간 어림 돌아보기", () => {
  it("걸린 시간이 어림보다 많음/같음/적음을 가르고, 모르면 비교 불가", () => {
    expect(timeOutcome({ minutesDiff: 10 })).toBe("OVER");
    expect(timeOutcome({ minutesDiff: 0 })).toBe("EQUAL");
    expect(timeOutcome({ minutesDiff: -5 })).toBe("UNDER");
    expect(timeOutcome({ minutesDiff: null })).toBe("UNKNOWN");
  });
  it("건수만 센다", () => {
    expect(countTimeOutcomes([{ minutesDiff: 10 }, { minutesDiff: 30 }, { minutesDiff: null }, { minutesDiff: -1 }])).toEqual({ OVER: 2, EQUAL: 0, UNDER: 1, UNKNOWN: 1 });
  });
});

describe("판매 결과 묶어 보기", () => {
  const mk = (cat: string, channel: string, netDiff: number | null) => ({
    cat,
    channel,
    review: { actualNet: null, saleDiff: null, netDiff, minutesDiff: null, outcome: netDiff === null ? "UNKNOWN" : netDiff > 0 ? "ABOVE" : netDiff < 0 ? "BELOW" : "EQUAL" } as const,
  });
  const rows = [mk("BOOK", "가상장터", 100), mk("BOOK", " 가상장터 ", -50), mk("CONSOLE", "Market A", null), mk("BOOK", "market  a", 0)];
  it("묶음별로 건수만 세고, 건수가 많은 묶음부터 보여 준다", () => {
    const g = groupOutcomes(rows, (r) => r.cat, (r) => r.review);
    expect(g).toEqual([
      { key: "BOOK", total: 3, counts: { ABOVE: 1, EQUAL: 1, BELOW: 1, UNKNOWN: 0 } },
      { key: "CONSOLE", total: 1, counts: { ABOVE: 0, EQUAL: 0, BELOW: 0, UNKNOWN: 1 } },
    ]);
    expect(JSON.stringify(g)).not.toMatch(/amount|net|sum|avg/i);
  });
  it("판매처는 공백·대소문자 차이를 같은 곳으로 묶는다", () => {
    const g = groupOutcomes(rows, (r) => channelKey(r.channel), (r) => r.review);
    expect(Object.fromEntries(g.map((x) => [x.key, x.total]))).toEqual({ "market a": 2, 가상장터: 2 });
  });
  it("기록이 없으면 빈 목록", () => {
    expect(groupOutcomes([], () => "x", () => reviewRow({ chosenSaleAmount: null, chosenNetAmount: null, expectedMinutes: null, amount: 1, costTotal: null, minutesSpent: null }))).toEqual([]);
  });
});

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "resale-backup-"));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("판매 결과 조회", () => {
  it("현재 모드의 기록만 가져오고 고른 방법의 예상 시간을 붙인다", () => {
    const { db, close } = openDb(path.join(dir, "r.db"));
    const id = createItem(db, false, book);
    upsertScenario(db, id, "DIRECT", {
      saleAmount: 19000,
      basisPriceRecordId: null,
      basisPriceType: null,
      feeMode: "AMOUNT",
      feeAmount: 0,
      feeRateBp: null,
      shipping: 0,
      packing: 0,
      transport: 0,
      expectedMinutes: 60,
      memo: null,
    });
    setChosenMethod(db, false, id, { method: "DIRECT", saleAmount: 19000, netAmount: 19000 });
    upsertSaleResult(db, false, id, { channel: "직거래", soldDate: "2026-11-10", amount: 18000, costTotal: 0, minutesSpent: 40, memo: null });
    seedDemo(db, "2026-11-11");
    const demoId = listItems(db, true)[0]!.item.id;
    upsertSaleResult(db, true, demoId, { channel: "가상", soldDate: "2026-11-09", amount: 1, costTotal: null, minutesSpent: null, memo: null });

    const real = listSaleReviews(db, false);
    expect(real).toHaveLength(1);
    expect(real[0]!.item.id).toBe(id);
    expect(real[0]!.expectedMinutes).toBe(60);
    const demo = listSaleReviews(db, true);
    expect(demo.map((r) => r.item.id)).toEqual([demoId]);
    expect(demo[0]!.expectedMinutes).toBeNull();
    close();
  });
});

describe("백업 검증과 복구", () => {
  function makeDb(file: string, name: string) {
    const { db, close } = openDb(file);
    createItem(db, false, { ...book, name });
    close();
  }

  it("이 앱의 DB는 통과하고, SQLite가 아니거나 다른 앱의 DB는 거부한다", () => {
    const good = path.join(dir, "good.db");
    makeDb(good, "책");
    expect(validateBackup(good)).toEqual({ ok: true, items: 1, prices: 0 });

    const text = path.join(dir, "note.db");
    fs.writeFileSync(text, "hello");
    expect(validateBackup(text)).toMatchObject({ ok: false, error: expect.stringContaining("SQLite") });

    const foreign = path.join(dir, "foreign.db");
    const f = new Database(foreign);
    f.exec("create table something (id integer)");
    f.close();
    expect(validateBackup(foreign)).toMatchObject({ ok: false, error: expect.stringContaining("백업 파일이 아닙니다") });
    expect(validateBackup(path.join(dir, "none.db")).ok).toBe(false);
  });

  it("복구하면 현재 DB를 안전 사본으로 남기고 백업 내용으로 바꾼다", () => {
    const current = path.join(dir, "resale.db");
    const backup = path.join(dir, "backup.db");
    makeDb(current, "지금 책");
    makeDb(backup, "백업 책");

    const r = restoreBackup(backup, current, new Date("2026-11-11T00:00:00Z"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.safetyCopy).toContain("before-restore-2026-11-11");

    const reopened = openDb(current);
    expect(listItems(reopened.db, false).map((x) => x.item.name)).toEqual(["백업 책"]);
    reopened.close();
    const safety = openDb(r.safetyCopy!);
    expect(listItems(safety.db, false).map((x) => x.item.name)).toEqual(["지금 책"]);
    safety.close();
  });

  it("검증에 실패한 파일로는 현재 DB를 건드리지 않는다", () => {
    const current = path.join(dir, "resale.db");
    makeDb(current, "지금 책");
    const before = fs.readFileSync(current);
    const bad = path.join(dir, "bad.db");
    fs.writeFileSync(bad, "not sqlite");
    expect(restoreBackup(bad, current).ok).toBe(false);
    expect(fs.readFileSync(current).equals(before)).toBe(true);
    expect(fs.readdirSync(dir).some((f) => f.includes("before-restore"))).toBe(false);
  });
});
