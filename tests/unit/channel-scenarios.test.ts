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
import { sql } from "drizzle-orm";
import { buildFullExport } from "@/lib/domain/full-export";
import {
  channelOutcome,
  costItemDiffs,
  countChannelOutcomes,
  countCostItemOutcomes,
  plannedCostItems,
  resolveActualCostTotal,
} from "@/lib/domain/review";
import { listFullExportSources } from "@/lib/db/repo";
import type { ValidItemInput } from "@/lib/domain/item-input";
import { chosenScenario, isChoiceOutdated, needsPrimary, primaryScenario, scenarioLabel } from "@/lib/domain/scenario";
import { reasonText, triageAlternatives, triageItem } from "@/lib/domain/triage";

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

  it("고른 계산의 이름만 바꾸면 선택이 그 계산을 계속 가리킨다(다른 계산의 이름 변경은 영향 없음)", () => {
    const id = createItem(db, false, item("책"));
    upsertScenario(db, id, "DIRECT", scenario({ expectedMinutes: 30 }), "가");
    upsertScenario(db, id, "DIRECT", scenario({ expectedMinutes: 90 }), "나");
    upsertScenario(db, id, "BUYBACK", scenario(), "가");
    const [a, b, c] = listScenarios(db, id);
    setChosenMethod(db, false, id, { method: "DIRECT", channel: "가", saleAmount: 10000, netAmount: 10000 });
    updateScenario(db, id, b!.id, "나 장터", scenario({ expectedMinutes: 90 }));
    updateScenario(db, id, c!.id, "가 서점", scenario()); // 방식이 다른 계산
    expect(getItem(db, false, id)!.chosenChannel).toBe("가");
    updateScenario(db, id, a!.id, "가 장터", scenario({ expectedMinutes: 30 }));
    const it1 = getItem(db, false, id)!;
    expect(it1.chosenChannel).toBe("가 장터");
    expect(isChoiceOutdated(it1, chosenScenario(it1, listScenarios(db, id)))).toBe(false);
  });

  it("옛 선택(chosen_channel이 null)의 이름 없는 계산에 이름을 붙여도 선택이 따라간다", () => {
    const id = createItem(db, false, item("책"));
    upsertScenario(db, id, "DIRECT", scenario());
    setChosenMethod(db, false, id, { method: "DIRECT", saleAmount: 10000, netAmount: 10000 });
    db.run(sql`update items set chosen_channel = null where id = ${id}`);
    updateScenario(db, id, listScenarios(db, id)[0]!.id, "가", scenario());
    expect(getItem(db, false, id)!.chosenChannel).toBe("가");
  });

  it("적어 둔 판매처와 실제 판매처 비교: 이름이 없으면 비교하지 않는다", () => {
    expect(channelOutcome("가 장터", " 가  장터 ")).toBe("SAME");
    expect(channelOutcome("Ga Market", "ga market")).toBe("SAME");
    expect(channelOutcome("가 장터", "나 서점")).toBe("DIFFERENT");
    expect(channelOutcome("", "나 서점")).toBe("UNKNOWN");
    expect(channelOutcome(null, "나 서점")).toBe("UNKNOWN");
    expect(countChannelOutcomes(["SAME", "DIFFERENT", "SAME", "UNKNOWN"])).toEqual({ SAME: 2, DIFFERENT: 1, UNKNOWN: 1 });
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

  it("판매처별로 따져 보기: 기준이 아닌 계산을 기준 자리에 넣어 같은 규칙으로 판단한다(입력 순서)", () => {
    const id = createItem(db, false, item("책"));
    upsertScenario(db, id, "BUYBACK", scenario({ saleAmount: 5000, expectedMinutes: 10 }));
    upsertScenario(db, id, "DIRECT", scenario({ saleAmount: 4000 }), "가");
    upsertScenario(db, id, "DIRECT", scenario({ saleAmount: 20000, expectedMinutes: 70 }), "나");
    // 기준이 없으면 그 방식의 계산을 모두 따져 본다
    const all = triageAlternatives(listTriageCandidates(db, false)[0]!, 1000, TODAY);
    expect(all.map((a) => [a.scenario.channel, a.result.verdict])).toEqual([
      ["가", "BUYBACK"],
      ["나", "DIRECT"],
    ]);
    expect(all[1]!.result).toMatchObject({ extra: 15000, extraMinutes: 60, extraPerHour: 15000 });

    // 기준을 정하면 기준이 아닌 것만 남는다. 계산이 하나뿐인 방식(업체)은 대상이 아니다
    setPrimaryScenario(db, id, listScenarios(db, id)[1]!.id);
    const rest = triageAlternatives(listTriageCandidates(db, false)[0]!, 1000, TODAY);
    expect(rest.map((a) => a.scenario.channel)).toEqual(["나"]);
    // 고른 방법과 다르다는 경고는 물건 단위 판단에만 붙는다
    setChosenMethod(db, false, id, { method: "BUYBACK", saleAmount: 5000, netAmount: 5000 });
    const withChoice = triageAlternatives(listTriageCandidates(db, false)[0]!, 1000, TODAY);
    expect(withChoice[0]!.result.warnings.some((w) => w.code === "CHOSEN_DIFFERS")).toBe(false);
  });

  it("판매처별로 따져 보기: 상대 방식의 기준이 없으면 보류한다", () => {
    const id = createItem(db, false, item("책"));
    upsertScenario(db, id, "BUYBACK", scenario({ saleAmount: 5000 }), "가 서점");
    upsertScenario(db, id, "BUYBACK", scenario({ saleAmount: 6000 }), "나 서점");
    upsertScenario(db, id, "DIRECT", scenario({ saleAmount: 9000 }), "다");
    upsertScenario(db, id, "DIRECT", scenario({ saleAmount: 9500 }), "라");
    const alts = triageAlternatives(listTriageCandidates(db, false)[0]!, 1000, TODAY);
    expect(alts).toHaveLength(4);
    expect(alts.every((a) => a.result.verdict === "UNDECIDED")).toBe(true);
    expect(alts[0]!.result.reasons).toEqual([{ code: "NEEDS_PRIMARY", method: "DIRECT" }]);
    expect(alts[2]!.result.reasons).toEqual([{ code: "NEEDS_PRIMARY", method: "BUYBACK" }]);
  });

  it("계산이 방식마다 하나뿐이면 따져 볼 것이 없다", () => {
    const id = createItem(db, false, item("책"));
    upsertScenario(db, id, "BUYBACK", scenario());
    upsertScenario(db, id, "DIRECT", scenario());
    expect(triageAlternatives(listTriageCandidates(db, false)[0]!, 1000, TODAY)).toEqual([]);
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

describe("실제 비용 항목별", () => {
  const none = { fee: null, shipping: null, packing: null, transport: null };

  it("항목을 적지 않으면 적은 합계 그대로(없으면 모름)", () => {
    expect(resolveActualCostTotal(null, none)).toEqual({ ok: true, total: null });
    expect(resolveActualCostTotal(3000, none)).toEqual({ ok: true, total: 3000 });
  });

  it("네 항목을 모두 적으면 합계는 그 합이고, 따로 적은 합계가 다르면 거부한다", () => {
    const all = { fee: 500, shipping: 3000, packing: 0, transport: 0 };
    expect(resolveActualCostTotal(null, all)).toEqual({ ok: true, total: 3500 });
    expect(resolveActualCostTotal(3500, all)).toEqual({ ok: true, total: 3500 });
    expect(resolveActualCostTotal(4000, all)).toMatchObject({ ok: false });
  });

  it("일부만 적으면 모르는 항목을 0으로 치지 않는다", () => {
    const some = { ...none, shipping: 3000 };
    expect(resolveActualCostTotal(null, some)).toEqual({ ok: true, total: null });
    expect(resolveActualCostTotal(5000, some)).toEqual({ ok: true, total: 5000 });
    expect(resolveActualCostTotal(2000, some)).toMatchObject({ ok: false });
  });

  it("항목별 차이: 어림이나 실제를 모르면 비교 불가, 비율 수수료는 예상 판매금액 기준", () => {
    const planned = plannedCostItems({ saleAmount: 20000, feeMode: "RATE", feeAmount: null, feeRateBp: 1000, shipping: 3000, packing: null, transport: 0 });
    expect(planned).toEqual({ fee: 2000, shipping: 3000, packing: null, transport: 0 });
    const d = costItemDiffs(planned, { fee: 1800, shipping: 3500, packing: 500, transport: null });
    expect(d.fee.diff).toBe(-200);
    expect(d.shipping.diff).toBe(500);
    expect(d.packing.diff).toBeNull();
    expect(d.transport.diff).toBeNull();
    expect(costItemDiffs(null, { fee: 1800, shipping: 0, packing: 0, transport: 0 }).fee).toEqual({ planned: null, actual: 1800, diff: null });
    const counts = countCostItemOutcomes([d, costItemDiffs(planned, { fee: 2000, shipping: 3000, packing: 0, transport: 0 })]);
    expect(counts.fee).toEqual({ OVER: 0, EQUAL: 1, UNDER: 1, UNKNOWN: 0 });
    expect(counts.shipping).toEqual({ OVER: 1, EQUAL: 1, UNDER: 0, UNKNOWN: 0 });
    expect(counts.packing).toEqual({ OVER: 0, EQUAL: 0, UNDER: 0, UNKNOWN: 2 });
  });

  it("항목별 비용이 저장되고, 돌아보기에 고른 계산이 함께 온다. 항목 없이 다시 저장하면 지워진다", () => {
    const id = createItem(db, false, item("책"));
    upsertScenario(db, id, "DIRECT", scenario({ shipping: 3000 }), "가");
    setChosenMethod(db, false, id, { method: "DIRECT", channel: "가", saleAmount: 10000, netAmount: 7000 });
    upsertSaleResult(db, false, id, {
      channel: "가", soldDate: TODAY, amount: 10000, costTotal: 3500,
      feeActual: 0, shippingActual: 3500, packingActual: 0, transportActual: 0, minutesSpent: null, memo: null,
    });
    const row = listSaleReviews(db, false)[0]!;
    expect(row.result).toMatchObject({ feeActual: 0, shippingActual: 3500, costTotal: 3500 });
    expect(row.scenario).toMatchObject({ channel: "가", shipping: 3000 });
    const out = buildFullExport({ demo: false, exportedDate: TODAY, sources: listFullExportSources(db, false) });
    expect(out.items[0]!.saleResult!.costItems).toEqual({ fee: 0, shipping: 3500, packing: 0, transport: 0 });
    upsertSaleResult(db, false, id, { channel: "가", soldDate: TODAY, amount: 10000, costTotal: null, minutesSpent: null, memo: null });
    expect(listSaleReviews(db, false)[0]!.result).toMatchObject({ feeActual: null, shippingActual: null, costTotal: null });
  });
});
