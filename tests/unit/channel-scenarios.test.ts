import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "@/lib/db/client";
import {
  createItem,
  deleteScenario,
  getItem,
  listChannelNames,
  listSaleReviews,
  listScenarios,
  listTriageCandidates,
  setChosenMethod,
  setPrimaryScenario,
  updateScenario,
  upsertSaleResult,
  upsertScenario,
  type ScenarioInput,
} from "@/lib/db/repo";
import { buildFullExport } from "@/lib/domain/full-export";
import { listFullExportSources } from "@/lib/db/repo";
import type { ValidItemInput } from "@/lib/domain/item-input";
import { chosenScenario, isChoiceOutdated, needsPrimary, primaryScenario, scenarioLabel } from "@/lib/domain/scenario";
import { reasonText, triageItem } from "@/lib/domain/triage";

const TODAY = "2026-11-17";

const item = (name: string): ValidItemInput => ({
  category: "BOOK",
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
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "resale-channel-"));
  ({ db, close } = openDb(path.join(tmpDir, "t.db")));
});

afterEach(() => {
  try {
    close();
  } catch {}
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("기준 계산 고르기(순수 함수)", () => {
  const s = (method: string, isPrimary = false, channel = "") => ({ method, isPrimary, channel });

  it("방식에 계산이 하나뿐이면 표시가 없어도 그것이 기준이다", () => {
    const list = [s("BUYBACK"), s("DIRECT")];
    expect(primaryScenario(list, "DIRECT")).toBe(list[1]);
    expect(needsPrimary(list, "DIRECT")).toBe(false);
  });

  it("여러 개인데 표시가 없으면 앱이 고르지 않는다", () => {
    const list = [s("DIRECT", false, "가"), s("DIRECT", false, "나")];
    expect(primaryScenario(list, "DIRECT")).toBeUndefined();
    expect(needsPrimary(list, "DIRECT")).toBe(true);
    expect(needsPrimary(list, "BUYBACK")).toBe(false); // 계산이 없는 것은 "기준 필요"가 아니다
  });

  it("여러 개면 사용자가 표시한 것이 기준이다", () => {
    const list = [s("DIRECT", false, "가"), s("DIRECT", true, "나")];
    expect(primaryScenario(list, "DIRECT")).toBe(list[1]);
    expect(needsPrimary(list, "DIRECT")).toBe(false);
  });

  it("고른 계산은 방식과 판매처 이름이 모두 같아야 한다(옛 선택의 null은 이름 없음)", () => {
    const list = [s("DIRECT", false, ""), s("DIRECT", false, "나")];
    expect(chosenScenario({ chosenMethod: "DIRECT", chosenChannel: "나" }, list)).toBe(list[1]);
    expect(chosenScenario({ chosenMethod: "DIRECT", chosenChannel: null }, list)).toBe(list[0]);
    expect(chosenScenario({ chosenMethod: "DIRECT", chosenChannel: "다" }, list)).toBeUndefined();
    expect(chosenScenario({ chosenMethod: null }, list)).toBeUndefined();
  });

  it("이름 표시", () => {
    expect(scenarioLabel("업체", "")).toBe("업체");
    expect(scenarioLabel("업체", "가나서점")).toBe("업체 · 가나서점");
  });
});

describe("판매처별 계산 저장", () => {
  it("같은 방식에 이름이 다른 계산을 여러 개 둘 수 있고, 같은 이름은 덮어쓴다", () => {
    const id = createItem(db, false, item("책"));
    upsertScenario(db, id, "DIRECT", scenario({ saleAmount: 10000 }));
    upsertScenario(db, id, "DIRECT", scenario({ saleAmount: 12000 }), "가 장터");
    upsertScenario(db, id, "DIRECT", scenario({ saleAmount: 13000 }), "가 장터");
    const list = listScenarios(db, id);
    expect(list.map((x) => [x.channel, x.saleAmount])).toEqual([
      ["", 10000],
      ["가 장터", 13000],
    ]);
  });

  it("기준은 방식마다 하나만 남는다", () => {
    const id = createItem(db, false, item("책"));
    upsertScenario(db, id, "DIRECT", scenario(), "가");
    upsertScenario(db, id, "DIRECT", scenario(), "나");
    upsertScenario(db, id, "BUYBACK", scenario(), "다");
    upsertScenario(db, id, "BUYBACK", scenario(), "라");
    const [a, b, c] = listScenarios(db, id);
    setPrimaryScenario(db, id, a!.id);
    setPrimaryScenario(db, id, c!.id);
    setPrimaryScenario(db, id, b!.id);
    expect(listScenarios(db, id).map((x) => [x.channel, x.isPrimary])).toEqual([
      ["가", false],
      ["나", true],
      ["다", true],
      ["라", false],
    ]);
  });

  it("다른 물건의 계산은 기준으로 정하거나 지울 수 없다", () => {
    const mine = createItem(db, false, item("내 책"));
    const other = createItem(db, false, item("다른 책"));
    upsertScenario(db, other, "DIRECT", scenario());
    const sc = listScenarios(db, other)[0]!;
    setPrimaryScenario(db, mine, sc.id);
    deleteScenario(db, mine, sc.id);
    updateScenario(db, mine, sc.id, "바꿈", scenario({ saleAmount: 1 }));
    expect(listScenarios(db, other)).toMatchObject([{ isPrimary: false, channel: "", saleAmount: 10000 }]);
  });

  it("자동완성 이름은 현재 모드에서 내가 적은 것만(빈 이름 제외)", () => {
    const real = createItem(db, false, item("책"));
    const demo = createItem(db, true, item("데모 책"));
    upsertScenario(db, real, "DIRECT", scenario());
    upsertScenario(db, real, "DIRECT", scenario(), "나 장터");
    upsertScenario(db, demo, "DIRECT", scenario(), "데모 장터");
    upsertSaleResult(db, false, real, { channel: "가 서점", soldDate: TODAY, amount: 1000, costTotal: null, minutesSpent: null, memo: null });
    expect(listChannelNames(db, false)).toEqual(["가 서점", "나 장터"]);
    expect(listChannelNames(db, true)).toEqual(["데모 장터"]);
  });
});

describe("선택한 판매처", () => {
  it("선택은 판매처 이름까지 남기고, 결과 돌아보기는 그 계산의 예상 시간을 쓴다", () => {
    const id = createItem(db, false, item("책"));
    upsertScenario(db, id, "DIRECT", scenario({ expectedMinutes: 30 }), "가");
    upsertScenario(db, id, "DIRECT", scenario({ expectedMinutes: 90 }), "나");
    setChosenMethod(db, false, id, { method: "DIRECT", channel: "나", saleAmount: 10000, netAmount: 10000 });
    expect(getItem(db, false, id)).toMatchObject({ chosenMethod: "DIRECT", chosenChannel: "나" });
    upsertSaleResult(db, false, id, { channel: "나", soldDate: TODAY, amount: 9000, costTotal: 0, minutesSpent: 100, memo: null });
    const rows = listSaleReviews(db, false);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.expectedMinutes).toBe(90);
    setChosenMethod(db, false, id, null);
    expect(getItem(db, false, id)).toMatchObject({ chosenMethod: null, chosenChannel: null });
  });

  it("고른 계산을 지우면 선택이 낡은 것으로 표시된다", () => {
    const id = createItem(db, false, item("책"));
    upsertScenario(db, id, "DIRECT", scenario(), "가");
    upsertScenario(db, id, "DIRECT", scenario(), "나");
    setChosenMethod(db, false, id, { method: "DIRECT", channel: "가", saleAmount: 10000, netAmount: 10000 });
    const it0 = getItem(db, false, id)!;
    expect(isChoiceOutdated(it0, chosenScenario(it0, listScenarios(db, id)))).toBe(false);
    deleteScenario(db, id, listScenarios(db, id)[0]!.id);
    expect(isChoiceOutdated(it0, chosenScenario(it0, listScenarios(db, id)))).toBe(true);
  });
});

describe("분류와 내보내기", () => {
  it("계산이 여러 개인데 기준이 없으면 판단을 보류하고, 기준을 정하면 그 계산으로 판단한다", () => {
    const id = createItem(db, false, item("책"));
    upsertScenario(db, id, "BUYBACK", scenario({ saleAmount: 5000, expectedMinutes: 10 }));
    upsertScenario(db, id, "DIRECT", scenario({ saleAmount: 4000 }), "가");
    upsertScenario(db, id, "DIRECT", scenario({ saleAmount: 20000 }), "나");
    const before = triageItem(listTriageCandidates(db, false)[0]!, 1000, TODAY);
    expect(before.verdict).toBe("UNDECIDED");
    expect(before.reasons).toEqual([{ code: "NEEDS_PRIMARY", method: "DIRECT" }]);
    expect(reasonText(before.reasons[0]!)).toContain("기준으로 쓸 계산");

    const direct = listScenarios(db, id).filter((x) => x.method === "DIRECT");
    setPrimaryScenario(db, id, direct[0]!.id);
    expect(triageItem(listTriageCandidates(db, false)[0]!, 1000, TODAY).verdict).toBe("BUYBACK");
    setPrimaryScenario(db, id, direct[1]!.id);
    expect(triageItem(listTriageCandidates(db, false)[0]!, 1000, TODAY).verdict).toBe("DIRECT");
  });

  it("전체 내보내기에 판매처 이름과 기준 표시, 고른 판매처가 실린다", () => {
    const id = createItem(db, false, item("책"));
    upsertScenario(db, id, "DIRECT", scenario(), "가");
    upsertScenario(db, id, "DIRECT", scenario({ expectedMinutes: 45 }), "나");
    setPrimaryScenario(db, id, listScenarios(db, id)[1]!.id);
    setChosenMethod(db, false, id, { method: "DIRECT", channel: "나", saleAmount: 10000, netAmount: 10000 });
    upsertSaleResult(db, false, id, { channel: "나", soldDate: TODAY, amount: 10000, costTotal: 0, minutesSpent: 50, memo: null });
    const out = buildFullExport({ demo: false, exportedDate: TODAY, sources: listFullExportSources(db, false) });
    const it0 = out.items[0]!;
    expect(it0.scenarios.map((x) => [x.channel, x.isPrimary])).toEqual([
      ["가", false],
      ["나", true],
    ]);
    expect(it0.chosen).toMatchObject({ method: "DIRECT", channel: "나" });
    expect(it0.saleResult!.review).toMatchObject({ minutesDiff: 5 }); // 50분 − 고른 계산의 45분
  });
});
