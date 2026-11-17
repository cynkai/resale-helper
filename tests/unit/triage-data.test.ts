import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "@/lib/db/client";
import { seedDemo } from "@/lib/db/demo-seed";
import {
  clearDemo,
  createItem,
  deletePrice,
  getItem,
  getTimeValuePerHour,
  insertPrice,
  listTriageCandidates,
  setTimeValuePerHour,
  upsertSaleResult,
  upsertScenario,
  type ScenarioInput,
} from "@/lib/db/repo";
import type { ValidItemInput } from "@/lib/domain/item-input";
import { validatePriceInput } from "@/lib/domain/price-input";
import { validateTimeValue } from "@/lib/domain/settings-input";
import { buildResultsCsv, buildTriageCsv, RESULTS_CSV_HEADERS, TRIAGE_CSV_HEADERS } from "@/lib/domain/report-csv";
import { triageItem } from "@/lib/domain/triage";

const TODAY = "2026-11-11";

const item = (name: string): ValidItemInput => ({
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

const scenario = (over: Partial<ScenarioInput> = {}): ScenarioInput => ({
  saleAmount: 10000,
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
  ...over,
});

let tmpDir: string;
let db: Db;
let close: () => void;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "resale-triage-"));
  ({ db, close } = openDb(path.join(tmpDir, "t.db")));
});
afterEach(() => {
  try {
    close();
  } catch {}
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("시간당 가치 입력 검증", () => {
  it("빈칸은 모름(null), 0은 유효한 값, 쉼표·'원'은 허용", () => {
    expect(validateTimeValue("")).toEqual({ ok: true, value: null });
    expect(validateTimeValue("   ")).toEqual({ ok: true, value: null });
    expect(validateTimeValue("0")).toEqual({ ok: true, value: 0 });
    expect(validateTimeValue("12,000")).toEqual({ ok: true, value: 12000 });
    expect(validateTimeValue("12000원")).toEqual({ ok: true, value: 12000 });
  });
  it("음수·소수·문자·지나치게 큰 값은 거부한다", () => {
    for (const bad of ["-1", "1.5", "abc", "1e4"]) {
      expect(validateTimeValue(bad), bad).toEqual({ ok: false, error: "0 이상의 정수(원)로 입력해 주세요." });
    }
    expect(validateTimeValue("100000001")).toEqual({ ok: false, error: "금액이 너무 큽니다." });
  });
});

describe("시간당 가치 저장", () => {
  it("저장 전에는 null이고, 0과 null을 구분해 저장하며 데모와 실제 값이 따로 있다", () => {
    expect(getTimeValuePerHour(db, false)).toBeNull();
    setTimeValuePerHour(db, false, 0);
    expect(getTimeValuePerHour(db, false)).toBe(0);
    setTimeValuePerHour(db, true, 15000);
    expect(getTimeValuePerHour(db, false)).toBe(0);
    expect(getTimeValuePerHour(db, true)).toBe(15000);
    setTimeValuePerHour(db, false, null);
    expect(getTimeValuePerHour(db, false)).toBeNull();
    expect(getTimeValuePerHour(db, true)).toBe(15000);
  });
  it("데모 초기화는 데모 설정만 지운다", () => {
    setTimeValuePerHour(db, false, 9000);
    setTimeValuePerHour(db, true, 15000);
    clearDemo(db);
    expect(getTimeValuePerHour(db, true)).toBeNull();
    expect(getTimeValuePerHour(db, false)).toBe(9000);
  });
});

describe("배분 대상 조회", () => {
  it("실제 모드 배분 화면에는 데모 물건이 나오지 않고, 반대도 마찬가지다", () => {
    const realId = createItem(db, false, item("실제 게임기"));
    seedDemo(db, TODAY);
    const real = listTriageCandidates(db, false);
    expect(real.map((c) => c.item.id)).toEqual([realId]);
    const demo = listTriageCandidates(db, true);
    expect(demo.length).toBeGreaterThan(0);
    expect(demo.every((c) => c.item.isDemo)).toBe(true);
    expect(demo.some((c) => c.item.id === realId)).toBe(false);
  });

  it("판매 완료 물건은 빼고 보유 중·판매 중만 담는다", () => {
    const owned = createItem(db, false, item("보유"));
    const listed = createItem(db, false, { ...item("판매 중"), status: "LISTED" });
    const sold = createItem(db, false, item("팔림"));
    upsertSaleResult(db, false, sold, { channel: "장터", soldDate: TODAY, amount: 1000, costTotal: 0, minutesSpent: null, memo: null });
    expect(listTriageCandidates(db, false).map((c) => c.item.id)).toEqual([owned, listed]);
  });

  it("시나리오와 기준 자료를 함께 가져와, 기준 자료가 지워지면 판단을 보류한다", () => {
    const id = createItem(db, false, item("기준 자료 있음"));
    const it = getItem(db, false, id)!;
    const p = validatePriceInput(
      { priceType: "BUYBACK_QUOTE", amount: "7000", sourceName: "매입점", checkedDate: TODAY, memo: "방문 견적" },
      { route: "MANUAL", today: TODAY },
    );
    if (!p.ok) throw new Error(JSON.stringify(p.errors));
    const saved = insertPrice(db, it, p.value, "MANUAL");
    if (!saved.ok) throw new Error("insert failed");
    upsertScenario(db, id, "BUYBACK", scenario({ saleAmount: 7000, basisPriceRecordId: saved.id, basisPriceType: "BUYBACK_QUOTE", expectedMinutes: 0 }));
    upsertScenario(db, id, "DIRECT", scenario({ saleAmount: 15000 }));

    const before = listTriageCandidates(db, false)[0]!;
    expect(before.scenarios).toHaveLength(2);
    expect(before.basisRecords.map((r) => r.id)).toEqual([saved.id]);
    const ok = triageItem(before, 5000, TODAY);
    expect(ok.verdict).toBe("DIRECT"); // 8,000원/시간 ≥ 5,000원

    deletePrice(db, id, saved.id);
    const after = triageItem(listTriageCandidates(db, false)[0]!, 5000, TODAY);
    expect(after.verdict).toBe("UNDECIDED");
    expect(after.reasons).toEqual([{ code: "BASIS_ISSUE", method: "BUYBACK", issues: ["BASIS_DELETED"] }]);
  });
});

describe("자료 점검 대상 조회", () => {
  it("현재 모드의 아직 팔지 않은 물건만, 가격 자료·시나리오와 함께 가져온다", async () => {
    const { listCheckupSources } = await import("@/lib/db/repo");
    const owned = createItem(db, false, item("보유"));
    const sold = createItem(db, false, item("팔림"));
    upsertSaleResult(db, false, sold, { channel: "장터", soldDate: TODAY, amount: 1000, costTotal: 0, minutesSpent: null, memo: null });
    seedDemo(db, TODAY);
    const p = validatePriceInput({ priceType: "ASKING", amount: "5000", sourceName: "장터", checkedDate: TODAY }, { route: "MANUAL", today: TODAY });
    if (!p.ok) throw new Error("price");
    insertPrice(db, getItem(db, false, owned)!, p.value, "MANUAL");
    upsertScenario(db, owned, "DIRECT", scenario({ saleAmount: 5000 }));
    const real = listCheckupSources(db, false);
    expect(real.map((r) => r.item.id)).toEqual([owned]);
    expect(real[0]!.prices).toHaveLength(1);
    expect(real[0]!.scenarios).toHaveLength(1);
    expect(listCheckupSources(db, true).every((r) => r.item.isDemo)).toBe(true);
  });
});

describe("배분·결과 CSV", () => {
  it("배분 CSV: 물건별 값만 담고, 모르는 값은 빈 칸이며 합계 행이 없다", () => {
    const a = createItem(db, false, item("가 게임기"));
    upsertScenario(db, a, "BUYBACK", scenario({ saleAmount: 5000, expectedMinutes: 20 }));
    upsertScenario(db, a, "DIRECT", scenario({ saleAmount: 20000, expectedMinutes: 80 }));
    const b = createItem(db, false, item('나 "따옴표", 게임기'));
    upsertScenario(db, b, "DIRECT", scenario({ shipping: null }));
    const rows = listTriageCandidates(db, false).map((c) => ({
      name: c.item.name,
      category: c.item.category,
      status: c.item.status,
      isDemo: c.item.isDemo,
      result: triageItem(c, 10000, TODAY),
    }));
    const lines = buildTriageCsv(rows).replace(/^\uFEFF/, "").trim().split("\r\n");
    expect(lines[0]).toBe(TRIAGE_CSV_HEADERS.join(","));
    expect(lines).toHaveLength(3); // 머리글 + 물건 2개. 합계 행 없음
    expect(lines[1]).toContain("가 게임기,게임기,보유 중,직접 판매,5000,20000,15000,60,15000,");
    expect(lines[2]).toContain('"나 ""따옴표"", 게임기"');
    expect(lines[2]).toContain("판단 보류,,,,,,"); // 업체 계산 없음·직접 판매 비용 모름 → 빈 칸(0이 아니다)
    expect(buildTriageCsv(rows)).not.toMatch(/합계|total|sum/i);
  });

  it("결과 CSV: 실제 비용을 모르면 실수령액과 차이를 비워 둔다", () => {
    const csv = buildResultsCsv([
      {
        name: "가", category: "BOOK", soldDate: "2026-11-01", channel: "가 장터", chosen: "개인에게 직접 판매 · 가 장터",
        chosenSaleAmount: 10000, chosenNetAmount: 9000, expectedMinutes: 30, amount: 9500, costTotal: 1000, minutesSpent: 40,
        firstPostedPrice: 11000, firstPostedDate: "2026-10-20", purchaseAmount: 12000, isDemo: false,
      },
      {
        name: "나", category: "CONSOLE", soldDate: "2026-11-02", channel: "직거래", chosen: "",
        chosenSaleAmount: null, chosenNetAmount: null, expectedMinutes: null, amount: 5000, costTotal: null, minutesSpent: null,
        firstPostedPrice: null, isDemo: false,
      },
    ]);
    const lines = csv.replace(/^\uFEFF/, "").trim().split("\r\n");
    expect(lines[0]).toBe(RESULTS_CSV_HEADERS.join(","));
    expect(lines[1]).toBe("가,도서,2026-11-01,가 장터,개인에게 직접 판매 · 가 장터,10000,9500,9000,1000,8500,-500,30,40,11000,2026-10-20,12,12000,false");
    expect(lines[2]).toBe("나,게임기,2026-11-02,직거래,,,5000,,,,,,,,,,,false");
    expect(lines).toHaveLength(3);
  });
});
