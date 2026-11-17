import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "@/lib/db/client";
import { seedDemo } from "@/lib/db/demo-seed";
import {
  clearDemo,
  createItem,
  deleteItem,
  deleteOffer,
  deletePostedPrice,
  insertOffer,
  insertPostedPrice,
  listPostedPrices,
  listPostedPricesByItem,
  listFullExportSources,
  listItems,
  listOffers,
  listPrices,
  setOfferStatus,
} from "@/lib/db/repo";
import { buildComparison } from "@/lib/domain/compare";
import { buildFullExport } from "@/lib/domain/full-export";
import type { ValidItemInput } from "@/lib/domain/item-input";
import {
  countSoldVsFirstPosted,
  postedDeltas,
  soldVsFirstPosted,
  summarizePosted,
  validatePostedPriceInput,
} from "@/lib/domain/posted-price";
import { buildTimeline, utcToSeoulYmd } from "@/lib/domain/timeline";
import { countOfferStatuses, evaluateOffer, pickOfferScenario, validateOfferInput } from "@/lib/domain/offer";

const TODAY = "2026-11-17";

const item = (name: string): ValidItemInput => ({
  category: "CONSOLE",
  status: "LISTED",
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

const sc = (over: Record<string, unknown> = {}) => ({
  method: "DIRECT",
  channel: "",
  isPrimary: false,
  saleAmount: 20000,
  feeMode: "AMOUNT" as const,
  feeAmount: 0 as number | null,
  feeRateBp: null as number | null,
  shipping: 3000 as number | null,
  packing: 500 as number | null,
  transport: 0 as number | null,
  ...over,
});

let tmpDir: string;
let db: Db;
let close: () => void;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "resale-offers-"));
  ({ db, close } = openDb(path.join(tmpDir, "t.db")));
});
afterEach(() => {
  try {
    close();
  } catch {}
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("받은 제안 입력 검증", () => {
  it("날짜·금액은 필수이고 미래 날짜와 0원은 거부한다", () => {
    expect(validateOfferInput({ receivedDate: TODAY, amount: "18,000" }, TODAY)).toEqual({
      ok: true,
      value: { receivedDate: TODAY, amount: 18000, channel: "", memo: null },
    });
    const bad = validateOfferInput({ receivedDate: "2026-11-18", amount: "0", channel: "가".repeat(101), memo: "나".repeat(501) }, TODAY);
    expect(bad.ok).toBe(false);
    expect(Object.keys(bad.ok ? {} : bad.errors).sort()).toEqual(["amount", "channel", "memo", "receivedDate"]);
    expect(validateOfferInput({ receivedDate: "", amount: "" }, TODAY).ok).toBe(false);
  });
});

describe("제안을 넣어 볼 계산 고르기", () => {
  const none = { chosenMethod: null };
  it("제안의 판매처 이름과 같은 개인 판매 계산이 먼저다(공백·대소문자 무시)", () => {
    const list = [sc({ channel: "가 장터" }), sc({ channel: "나 직거래", isPrimary: true })];
    expect(pickOfferScenario(list, none, " 가  장터 ")).toBe(list[0]);
  });
  it("이름이 없거나 맞는 계산이 없으면 내가 고른 개인 판매 계산, 그다음 기준 계산", () => {
    const list = [sc({ channel: "가" }), sc({ channel: "나", isPrimary: true })];
    expect(pickOfferScenario(list, { chosenMethod: "DIRECT", chosenChannel: "가" }, "")).toBe(list[0]);
    expect(pickOfferScenario(list, { chosenMethod: "BUYBACK", chosenChannel: "가" }, "다")).toBe(list[1]);
    expect(pickOfferScenario(list, none, "")).toBe(list[1]);
  });
  it("계산이 여러 개인데 기준이 없으면 고르지 않고, 업체 계산은 쓰지 않는다", () => {
    expect(pickOfferScenario([sc({ channel: "가" }), sc({ channel: "나" })], none, "")).toBeUndefined();
    expect(pickOfferScenario([sc({ method: "BUYBACK" })], none, "")).toBeUndefined();
    expect(pickOfferScenario([], none, "가")).toBeUndefined();
  });
});

describe("제안 따져 보기", () => {
  it("제안 금액을 판매금액 자리에 넣고 비용은 그대로 뺀다", () => {
    const ev = evaluateOffer(18000, sc(), 15000);
    expect(ev.net.net).toBe(14500);
    expect(ev.vsPlanned).toBe(-2000);
    expect(ev.vsBuybackNet).toBe(-500);
  });
  it("비율 수수료는 제안 금액으로 다시 계산한다", () => {
    const ev = evaluateOffer(10000, sc({ feeMode: "RATE", feeAmount: null, feeRateBp: 350, shipping: 0, packing: 0 }), null);
    expect(ev.net.fee).toBe(350);
    expect(ev.net.net).toBe(9650);
    expect(ev.vsBuybackNet).toBeNull(); // 업체 실수령액을 모르면 비교하지 않는다
  });
  it("모르는 비용이 있으면 실수령액을 내지 않는다(0으로 치지 않는다)", () => {
    const ev = evaluateOffer(18000, sc({ shipping: null }), 15000);
    expect(ev.net.complete).toBe(false);
    expect(ev.net.net).toBeNull();
    expect(ev.vsBuybackNet).toBeNull();
  });
  it("상태는 건수만 센다", () => {
    expect(countOfferStatuses(["OPEN", "DECLINED", "OPEN", "ACCEPTED"])).toEqual({ OPEN: 2, ACCEPTED: 1, DECLINED: 1 });
  });
});

describe("받은 제안 저장", () => {
  it("최신순으로 보여 주고, 다른 물건의 제안은 바꾸거나 지울 수 없다", () => {
    const mine = createItem(db, false, item("게임기"));
    const other = createItem(db, false, item("다른 게임기"));
    insertOffer(db, mine, { receivedDate: "2026-11-10", amount: 15000, channel: "", memo: null });
    const late = insertOffer(db, mine, { receivedDate: "2026-11-15", amount: 17000, channel: "가", memo: "직거래 희망" });
    const theirs = insertOffer(db, other, { receivedDate: "2026-11-12", amount: 9000, channel: "", memo: null });
    expect(listOffers(db, mine).map((o) => o.amount)).toEqual([17000, 15000]);
    setOfferStatus(db, mine, late, "ACCEPTED");
    setOfferStatus(db, mine, theirs, "ACCEPTED");
    deleteOffer(db, mine, theirs);
    expect(listOffers(db, mine)[0]).toMatchObject({ status: "ACCEPTED", channel: "가", memo: "직거래 희망" });
    expect(listOffers(db, other)).toMatchObject([{ status: "OPEN", amount: 9000 }]);
  });

  it("제안은 가격 자료가 아니다: 가격 목록·비교에 나타나지 않고, 물건을 지우면 함께 지워진다", () => {
    const id = createItem(db, false, item("게임기"));
    insertOffer(db, id, { receivedDate: TODAY, amount: 15000, channel: "", memo: null });
    expect(listPrices(db, id)).toHaveLength(0);
    const it0 = listItems(db, false)[0]!.item;
    expect(JSON.stringify(buildComparison(it0, listPrices(db, id), TODAY, null))).not.toContain("15000");
    deleteItem(db, false, id);
    expect(listOffers(db, id)).toHaveLength(0);
  });

  it("전체 내보내기에 실리고, 데모 제안은 데모를 지우면 사라진다", () => {
    const id = createItem(db, false, item("게임기"));
    insertOffer(db, id, { receivedDate: TODAY, amount: 15000, channel: "가", memo: null });
    const out = buildFullExport({ demo: false, exportedDate: TODAY, sources: listFullExportSources(db, false) });
    expect(out.items[0]!.offers).toEqual([{ receivedDate: TODAY, amount: 15000, channel: "가", status: "OPEN", memo: null }]);

    seedDemo(db, TODAY);
    const demo = buildFullExport({ demo: true, exportedDate: TODAY, sources: listFullExportSources(db, true) });
    expect(demo.items.flatMap((i) => i.offers)).toHaveLength(1);
    clearDemo(db);
    expect(listFullExportSources(db, true)).toHaveLength(0);
    expect(listOffers(db, id)).toHaveLength(1); // 실제 자료는 그대로
  });
});

describe("내 판매글에 올린 가격", () => {
  it("입력 검증: 날짜·금액 필수, 미래 날짜와 0원 거부", () => {
    expect(validatePostedPriceInput({ postedDate: TODAY, amount: "24,000" }, TODAY)).toEqual({
      ok: true,
      value: { postedDate: TODAY, amount: 24000, channel: "", memo: null },
    });
    const bad = validatePostedPriceInput({ postedDate: "2026-11-18", amount: "0" }, TODAY);
    expect(Object.keys(bad.ok ? {} : bad.errors).sort()).toEqual(["amount", "postedDate"]);
  });

  it("날짜순으로 정리해 처음·지금 가격과 내린·올린 횟수를 센다(금액을 더하지 않는다)", () => {
    const rows = [
      { id: 3, postedDate: "2026-11-10", amount: 22000 },
      { id: 1, postedDate: "2026-11-01", amount: 24000 },
      { id: 2, postedDate: "2026-11-05", amount: 24000 },
      { id: 4, postedDate: "2026-11-12", amount: 23000 },
    ];
    expect(summarizePosted(rows)).toEqual({ first: 24000, latest: 23000, lowered: 1, raised: 1 });
    expect(summarizePosted([])).toBeNull();
    const d = postedDeltas(rows);
    expect([d.get(1), d.get(2), d.get(3), d.get(4)]).toEqual([null, 0, -2000, 1000]);
  });

  it("처음 올린 가격과 실제 판매금액은 건수로만 견준다", () => {
    expect(soldVsFirstPosted(24000, 22000)).toBe("BELOW");
    expect(soldVsFirstPosted(24000, 24000)).toBe("EQUAL");
    expect(soldVsFirstPosted(24000, 25000)).toBe("ABOVE");
    expect(countSoldVsFirstPosted(["BELOW", "BELOW", "EQUAL"])).toEqual({ BELOW: 2, EQUAL: 1, ABOVE: 0 });
  });

  it("저장: 가격 자료와 따로 두고, 모드를 섞지 않으며, 내보내기에 실린다", () => {
    const id = createItem(db, false, item("게임기"));
    const other = createItem(db, false, item("다른 게임기"));
    insertPostedPrice(db, id, { postedDate: "2026-11-10", amount: 22000, channel: "", memo: null });
    const first = insertPostedPrice(db, id, { postedDate: "2026-11-01", amount: 24000, channel: "가", memo: null });
    expect(listPostedPrices(db, id).map((p) => p.amount)).toEqual([24000, 22000]);
    expect(listPrices(db, id)).toHaveLength(0);
    deletePostedPrice(db, other, first); // 다른 물건의 기록은 못 지운다
    expect(listPostedPrices(db, id)).toHaveLength(2);
    expect(listPostedPricesByItem(db, false).get(id)).toHaveLength(2);
    expect(listPostedPricesByItem(db, true).size).toBe(0);
    const out = buildFullExport({ demo: false, exportedDate: TODAY, sources: listFullExportSources(db, false) });
    expect(out.items[0]!.postedPrices).toEqual([
      { postedDate: "2026-11-01", amount: 24000, channel: "가", memo: null },
      { postedDate: "2026-11-10", amount: 22000, channel: "", memo: null },
    ]);
    seedDemo(db, TODAY);
    expect(listPostedPricesByItem(db, true).size).toBe(1);
    clearDemo(db);
    expect(listPostedPricesByItem(db, true).size).toBe(0);
    expect(listPostedPrices(db, id)).toHaveLength(2);
  });
});

describe("기록 한눈에 보기", () => {
  it("UTC 저장 시각을 한국 날짜로 바꾼다", () => {
    expect(utcToSeoulYmd("2026-11-16 14:59:59")).toBe("2026-11-16");
    expect(utcToSeoulYmd("2026-11-16 15:00:00")).toBe("2026-11-17");
    expect(utcToSeoulYmd(null)).toBeNull();
    expect(utcToSeoulYmd("어제")).toBeNull();
  });

  it("저장된 기록을 날짜순(최신이 위)으로 늘어놓고, 줄마다 무엇의 금액인지 적는다", () => {
    const tl = buildTimeline({
      item: { createdAt: "2026-10-31 16:00:00", chosenMethod: "DIRECT", chosenChannel: "가 장터", chosenSaleAmount: 24000, chosenAt: "2026-11-05 01:00:00" },
      prices: [{ id: 1, priceType: "ASKING", amountMinor: 20000, currency: "KRW", sourceName: "나 장터", checkedDate: "2026-11-10" }],
      history: new Map([[1, [{ id: 7, priceType: "ASKING", amountMinor: 22000, currency: "KRW", checkedDate: "2026-11-02" }]]]),
      posted: [
        { id: 1, postedDate: "2026-11-05", amount: 24000, channel: "가 장터" },
        { id: 2, postedDate: "2026-11-12", amount: 22000, channel: "" },
      ],
      offers: [{ id: 1, receivedDate: "2026-11-12", amount: 21000, channel: "", status: "ACCEPTED" }],
      result: { soldDate: "2026-11-13", amount: 21000, channel: "가 장터" },
    });
    expect(tl.map((e) => `${e.date} ${e.kind}`)).toEqual([
      "2026-11-13 SOLD",
      "2026-11-12 OFFER",
      "2026-11-12 POSTED",
      "2026-11-10 PRICE_CHECKED",
      "2026-11-05 CHOSEN",
      "2026-11-05 POSTED",
      "2026-11-02 PRICE_PREVIOUS",
      "2026-11-01 REGISTERED",
    ]);
    expect(tl[0]!.text).toBe("가 장터에서 21,000원에 판매(내가 기록한 값)");
    expect(tl[1]!.text).toBe("제안 21,000원 — 받기로 함");
    expect(tl[3]!.text).toBe("[판매 중 희망가] 나 장터 20,000원 확인");
    expect(tl[4]!.text).toBe("개인에게 직접 판매 · 가 장터로 정함 (당시 금액 24,000원)");
    expect(tl[6]!.text).toContain("22,000원 확인(나중에 바뀜)");
  });

  it("기록이 없으면 등록만 나온다. 외화 자료는 원래 통화로 적는다", () => {
    const base = { item: { createdAt: "2026-11-01 00:00:00", chosenMethod: null, chosenSaleAmount: null, chosenAt: null }, history: new Map(), posted: [], offers: [], result: undefined };
    expect(buildTimeline({ ...base, prices: [] }).map((e) => e.kind)).toEqual(["REGISTERED"]);
    const fx = buildTimeline({ ...base, prices: [{ id: 1, priceType: "ASKING", amountMinor: 1250, currency: "USD", sourceName: "해외", checkedDate: "2026-11-02" }] });
    expect(fx[0]!.text).toBe("[판매 중 희망가] 해외 USD 12.50 확인");
  });
});
