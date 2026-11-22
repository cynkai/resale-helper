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
  purgePrice,
  exportRows,
  getItem,
  getSaleResult,
  importPrices,
  insertPrice,
  listItems,
  listPriceHistory,
  listFullExportSources,
  listPrices,
  listScenarios,
  recheckPrice,
  setChosenMethod,
  setPricesIncluded,
  updatePrice,
  upsertSaleResult,
  upsertScenario,
} from "@/lib/db/repo";
import { buildComparison } from "@/lib/domain/compare";
import { buildFullExport } from "@/lib/domain/full-export";
import { buildCsv, escapeCsvCell, parseCsv, planCsvImport } from "@/lib/domain/csv";
import type { ValidItemInput } from "@/lib/domain/item-input";
import { validateItemInput } from "@/lib/domain/item-input";
import { convertToKrw, fxRateToPlain, parseFxRate } from "@/lib/domain/fx";
import { validatePriceInput } from "@/lib/domain/price-input";
import { basisIssues } from "@/lib/domain/scenario";
import { lookupBook, type BibliographicProvider } from "@/lib/providers/bibliographic";
import { priceProviders } from "@/lib/providers/price";

const TODAY = "2026-11-11";

const bookInput: ValidItemInput = {
  category: "BOOK",
  status: "OWNED",
  name: "테스트 도서",
  identifier: "9780306406157",
  condition: "GOOD",
  defects: null,
  components: null,
  memo: null,
  author: null,
  publisher: null,
  edition: "1판",
  hasWriting: "UNKNOWN",
  hasUnderline: "UNKNOWN",
  hasDamage: "UNKNOWN",
  hasSupplement: "UNKNOWN",
};

function price(over: Record<string, string> = {}) {
  const r = validatePriceInput(
    { priceType: "ASKING", amount: "10000", sourceName: "장터", checkedDate: "2026-11-01", ...over },
    { route: "MANUAL", today: TODAY },
  );
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.value;
}

let tmpDir: string;
let dbFile: string;
let db: Db;
let close: () => void;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "resale-test-"));
  dbFile = path.join(tmpDir, "test.db");
  ({ db, close } = openDb(dbFile));
});
afterEach(() => {
  try {
    close();
  } catch {}
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("물건 입력 검증", () => {
  it("도서 ISBN은 ISBN-13으로 정규화해 저장하고, 틀린 ISBN은 필드 오류로 돌려준다", () => {
    const ok = validateItemInput({ category: "BOOK", name: "책", identifier: "0-306-40615-2", condition: "GOOD" });
    expect(ok.ok && ok.value.identifier).toBe("9780306406157");
    const bad = validateItemInput({ category: "BOOK", name: "책", identifier: "9780306406150", condition: "GOOD" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.identifier).toBeDefined();
  });
  it("기기 모델명은 ISBN 검증을 하지 않는다", () => {
    const r = validateItemInput({ category: "CONSOLE", name: "게임기", identifier: "HAC-001", condition: "FAIR" });
    expect(r.ok && r.value.identifier).toBe("HAC-001");
  });
});

describe("중복 저장 방지", () => {
  it("같은 출처 ID·같은 URL은 거부하고, 금액만 같은 다른 매물은 저장한다", () => {
    const item = getItem(db, false, createItem(db, false, bookInput))!;
    expect(insertPrice(db, item, price({ externalId: "A1" }), "MANUAL").ok).toBe(true);
    expect(insertPrice(db, item, price({ externalId: "A1", amount: "9000" }), "MANUAL")).toEqual({
      ok: false,
      reason: "DUPLICATE",
      inTrash: false,
    });
    expect(insertPrice(db, item, price({ sourceUrl: "https://example.com/p/1?utm_source=a" }), "MANUAL").ok).toBe(true);
    expect(insertPrice(db, item, price({ sourceUrl: "https://www.example.com/p/1/" }), "MANUAL").ok).toBe(false);
    // 식별자 없는 동일 금액 자료 두 건은 서로 다른 매물로 저장된다
    expect(insertPrice(db, item, price(), "MANUAL").ok).toBe(true);
    expect(insertPrice(db, item, price(), "MANUAL").ok).toBe(true);
    expect(listPrices(db, item.id)).toHaveLength(4);
    // 목록의 가격 자료 건수는 물건별로 정확히 센다
    const other = createItem(db, false, { ...bookInput, name: "자료 없는 책" });
    const counts = Object.fromEntries(listItems(db, false).map((r) => [r.item.id, r.priceCount]));
    expect(counts).toEqual({ [item.id]: 4, [other]: 0 });
  });
});

describe("같은 매물의 가격 변동 이력", () => {
  it("금액이나 확인일이 바뀌면 바뀌기 전 값을 남기고, 다른 항목만 고치면 남기지 않는다", () => {
    const item = getItem(db, false, createItem(db, false, bookInput))!;
    const saved = insertPrice(db, item, price({ externalId: "H1", amount: "20000", checkedDate: "2026-10-01" }), "MANUAL");
    if (!saved.ok) throw new Error("insert");
    // 메모만 고침 → 이력 없음
    updatePrice(db, item, saved.id, price({ externalId: "H1", amount: "20000", checkedDate: "2026-10-01", memo: "메모만" }));
    expect(listPriceHistory(db, item.id).size).toBe(0);
    // 가격 인하를 다시 확인
    updatePrice(db, item, saved.id, price({ externalId: "H1", amount: "17000", checkedDate: "2026-10-20" }));
    updatePrice(db, item, saved.id, price({ externalId: "H1", amount: "15000", checkedDate: "2026-11-05" }));
    const h = listPriceHistory(db, item.id).get(saved.id)!;
    expect(h.map((x) => [x.checkedDate, x.amountMinor, x.priceType])).toEqual([
      ["2026-10-01", 20000, "ASKING"],
      ["2026-10-20", 17000, "ASKING"],
    ]);
    // 지금 값은 가격 자료에 그대로 한 건
    const now = listPrices(db, item.id);
    expect(now).toHaveLength(1);
    expect(now[0]!.amountMinor).toBe(15000);
  });
  it("가격이 그대로면 확인일만 오늘로 바꾸고 이전 확인일을 이력에 남긴다", () => {
    const item = getItem(db, false, createItem(db, false, bookInput))!;
    const saved = insertPrice(db, item, price({ externalId: "R1", amount: "20000", checkedDate: "2026-08-01" }), "MANUAL");
    if (!saved.ok) throw new Error("insert");
    expect(recheckPrice(db, item.id, saved.id, TODAY)).toBe(true);
    const now = listPrices(db, item.id)[0]!;
    expect([now.amountMinor, now.checkedDate]).toEqual([20000, TODAY]);
    expect(listPriceHistory(db, item.id).get(saved.id)!.map((h) => [h.checkedDate, h.amountMinor])).toEqual([["2026-08-01", 20000]]);
    // 같은 날 다시 눌러도 이력이 늘지 않는다
    expect(recheckPrice(db, item.id, saved.id, TODAY)).toBe(false);
    expect(listPriceHistory(db, item.id).get(saved.id)).toHaveLength(1);
    // 다른 물건의 번호로는 바꿀 수 없다
    const other = createItem(db, false, { ...bookInput, name: "다른 책" });
    expect(recheckPrice(db, other, saved.id, "2026-12-01")).toBe(false);
  });
  it("유형을 바꾸면 당시 유형을 이력에 남기고, 가격 자료를 지우면 이력도 지워진다", () => {
    const item = getItem(db, false, createItem(db, false, bookInput))!;
    const saved = insertPrice(db, item, price({ externalId: "H2", amount: "20000" }), "MANUAL");
    if (!saved.ok) throw new Error("insert");
    updatePrice(db, item, saved.id, price({ externalId: "H2", amount: "20000", priceType: "SOLD_LISTING" }));
    expect(listPriceHistory(db, item.id).get(saved.id)!.map((x) => x.priceType)).toEqual(["ASKING"]);
    deletePrice(db, item.id, saved.id);
    expect(listPriceHistory(db, item.id).size).toBe(0);
  });
  it("중복으로 거부된 수정은 이력을 남기지 않는다", () => {
    const item = getItem(db, false, createItem(db, false, bookInput))!;
    const a = insertPrice(db, item, price({ externalId: "A", amount: "1000" }), "MANUAL");
    const b = insertPrice(db, item, price({ externalId: "B", amount: "2000" }), "MANUAL");
    if (!a.ok || !b.ok) throw new Error("insert");
    expect(updatePrice(db, item, b.id, price({ externalId: "A", amount: "3000" }))).toEqual({ ok: false, reason: "DUPLICATE", inTrash: false });
    expect(listPriceHistory(db, item.id).size).toBe(0);
  });
});

describe("구성 일치 여부 입력", () => {
  it("빈칸은 모름으로 저장하고, YES/NO만 받으며, CSV로 내보냈다가 다시 읽을 수 있다", () => {
    expect(price().componentsMatch).toBe("UNKNOWN");
    expect(price({ componentsMatch: "no" }).componentsMatch).toBe("NO");
    const bad = validatePriceInput(
      { priceType: "ASKING", amount: "1000", sourceName: "장터", checkedDate: "2026-11-01", componentsMatch: "아마도" },
      { route: "MANUAL", today: TODAY },
    );
    expect(bad.ok).toBe(false);
    const item = getItem(db, false, createItem(db, false, bookInput))!;
    insertPrice(db, item, price({ externalId: "C1", componentsMatch: "NO" }), "MANUAL");
    const csv = buildCsv(exportRows(db, false, item.id));
    expect(csv.split("\n")[0]).toContain("components_match");
    const plan = planCsvImport(csv, TODAY, [], item);
    expect(plan.headerError).toBeNull();
    expect(plan.valid[0]!.value.componentsMatch).toBe("NO");
  });
});

describe("외화 자료의 환산 참고", () => {
  const raw = (over: Record<string, string>) =>
    validatePriceInput(
      { priceType: "ASKING", amount: "12.50", currency: "USD", sourceName: "해외 장터", checkedDate: "2026-11-01", ...over },
      { route: "MANUAL", today: TODAY },
    );
  const errorsOf = (over: Record<string, string>) => {
    const r = raw(over);
    return r.ok ? {} : r.errors;
  };

  it("환율 파싱과 환산은 정수 연산이며 원 미만은 반올림한다", () => {
    expect(parseFxRate("1,385.5")).toEqual({ ok: true, rateE4: 13_855_000 });
    expect(parseFxRate("9.1234")).toEqual({ ok: true, rateE4: 91_234 });
    for (const bad of ["", "0", "-1", "1e3", "1.23456", "abc", "13,85.5"]) expect(parseFxRate(bad).ok).toBe(false);
    expect(fxRateToPlain(13_855_000)).toBe("1385.5");
    expect(fxRateToPlain(14_000_000)).toBe("1400");
    expect(convertToKrw(1250, "USD", 13_855_000)).toBe(17319); // 12.50 × 1385.5 = 17318.75
    expect(convertToKrw(1000, "JPY", 91_234)).toBe(9123); // 1000 × 9.1234 = 9123.4
    expect(convertToKrw(1, "USD", 13_855_000)).toBe(14); // 0.01 × 1385.5 = 13.855
  });

  it("환율은 앱이 채우지 않는다: 입력하지 않으면 null", () => {
    const v = price({ currency: "USD", amount: "12.50" });
    expect(v.fxRateE4).toBeNull();
    expect(v.fxDate).toBeNull();
  });

  it("환율과 기준일은 함께 넣어야 하고, 기준일은 오늘 이후일 수 없다", () => {
    expect(raw({ fxRate: "1385.5", fxDate: "2026-11-01" })).toMatchObject({ ok: true, value: { fxRateE4: 13_855_000, fxDate: "2026-11-01" } });
    expect(errorsOf({ fxRate: "1385.5" }).fxDate).toContain("기준일");
    expect(errorsOf({ fxDate: "2026-11-01" }).fxRate).toContain("환율도");
    expect(errorsOf({ fxRate: "1385.5", fxDate: "2026-11-12" }).fxDate).toContain("오늘 이후");
    expect(errorsOf({ fxRate: "천삼백", fxDate: "2026-11-01" }).fxRate).toContain("소수 넷째 자리");
  });

  it("원화 자료에는 환율을 넣을 수 없다", () => {
    expect(errorsOf({ currency: "KRW", amount: "10000", fxRate: "1385.5", fxDate: "2026-11-01" }).fxRate).toContain("원화 자료");
  });

  it("환율을 넣어도 외화 자료는 원화 비교에서 빠지고, CSV·내보내기에 근거가 남는다", () => {
    const item = getItem(db, false, createItem(db, false, bookInput))!;
    insertPrice(db, item, price({ currency: "USD", amount: "12.50", externalId: "F1", fxRate: "1385.5", fxDate: "2026-11-01" }), "MANUAL");
    const stored = listPrices(db, item.id)[0]!;
    expect(stored).toMatchObject({ amountMinor: 1250, currency: "USD", fxRateE4: 13_855_000, fxDate: "2026-11-01" });
    const cmp = buildComparison(item, listPrices(db, item.id), TODAY, null);
    expect(JSON.stringify(cmp)).toContain("FOREIGN_CURRENCY");

    const csv = buildCsv(exportRows(db, false, item.id));
    expect(csv.split("\n")[0]).toContain("currency,fx_rate,fx_date");
    const plan = planCsvImport(csv, TODAY, [], item);
    expect(plan.valid[0]!.value).toMatchObject({ fxRateE4: 13_855_000, fxDate: "2026-11-01" });

    const out = buildFullExport({ demo: false, exportedDate: TODAY, sources: listFullExportSources(db, false) });
    expect(out.items[0]!.prices[0]!.krwReference).toEqual({ amount: 17319, rate: "1385.5", rateDate: "2026-11-01" });

    // 원화로 고치면서 환율을 비우면 환율 근거도 지워진다
    updatePrice(db, item, stored.id, price({ currency: "KRW", amount: "17000", externalId: "F1" }));
    expect(listPrices(db, item.id)[0]).toMatchObject({ currency: "KRW", fxRateE4: null, fxDate: null });
  });
});

describe("데모의 가격 변동 이력", () => {
  it("데모 자료에 이력 예시가 있고, 데모를 지우면 이력도 함께 지워진다", () => {
    seedDemo(db, TODAY);
    const demoBook = listItems(db, true).find((r) => r.priceCount > 0)!.item;
    const h = [...listPriceHistory(db, demoBook.id).values()].flat();
    expect(h.map((x) => x.amountMinor)).toEqual([22000]);
    clearDemo(db);
    expect(listItems(db, true)).toHaveLength(0);
    seedDemo(db, TODAY); // 다시 넣어도 이력이 쌓이지 않는다
    const again = listItems(db, true).find((r) => r.priceCount > 0)!.item;
    expect([...listPriceHistory(db, again.id).values()].flat()).toHaveLength(1);
  });
});

describe("계산의 기준 자료 삭제", () => {
  it("기준 가격 자료를 지우면 id는 비지만 유형 스냅샷이 남아 '삭제됨'을 알 수 있다", () => {
    const item = getItem(db, false, createItem(db, false, bookInput))!;
    const saved = insertPrice(db, item, price({ priceType: "BUYBACK_QUOTE", memo: "방문 견적", externalId: "Q1" }), "MANUAL");
    if (!saved.ok) throw new Error("저장 실패");
    upsertScenario(db, item.id, "BUYBACK", {
      saleAmount: 10000,
      basisPriceRecordId: saved.id,
      basisPriceType: "BUYBACK_QUOTE",
      feeMode: "AMOUNT",
      feeAmount: 0,
      feeRateBp: null,
      shipping: 0,
      packing: 0,
      transport: 0,
      expectedMinutes: null,
      memo: null,
    });
    // 휴지통으로 옮기면 기준 자료를 찾을 수 없어 '삭제됨'으로 보이고, 되살리면 돌아온다(id는 남아 있음).
    deletePrice(db, item.id, saved.id);
    const trashed = listScenarios(db, item.id)[0]!;
    expect(trashed.basisPriceRecordId).toBe(saved.id);
    expect(listPrices(db, item.id).find((p) => p.id === saved.id)).toBeUndefined();
    expect(basisIssues(trashed, undefined, TODAY)).toEqual(["BASIS_DELETED"]);
    // 완전히 지우면 id는 비지만 유형 스냅샷으로 '삭제됨'을 알 수 있다
    purgePrice(db, false, saved.id);
    const sc = listScenarios(db, item.id)[0]!;
    expect(sc.basisPriceRecordId).toBeNull();
    expect(sc.basisPriceType).toBe("BUYBACK_QUOTE");
    expect(basisIssues(sc, undefined, TODAY)).toEqual(["BASIS_DELETED"]);
  });
});

describe("데모와 실제 자료 격리", () => {
  it("데모 시드는 실제 목록·내보내기에 나타나지 않고, 데모 삭제는 실제 자료를 건드리지 않는다", () => {
    const realId = createItem(db, false, bookInput);
    const real = getItem(db, false, realId)!;
    insertPrice(db, real, price({ externalId: "R1" }), "MANUAL");
    seedDemo(db, TODAY);

    expect(listItems(db, false).map((r) => r.item.id)).toEqual([realId]);
    const demoItems = listItems(db, true);
    expect(demoItems.length).toBeGreaterThan(0);
    expect(demoItems.every((r) => r.item.isDemo)).toBe(true);

    const realExport = exportRows(db, false);
    expect(realExport).toHaveLength(1);
    expect(realExport.every((r) => !r.isDemo)).toBe(true);
    const demoExport = exportRows(db, true);
    expect(demoExport.length).toBeGreaterThan(0);
    expect(demoExport.every((r) => r.isDemo)).toBe(true);

    // 실제 모드에서 데모 물건 ID로 접근할 수 없다(반대도 마찬가지)
    expect(getItem(db, false, demoItems[0]!.item.id)).toBeUndefined();
    expect(getItem(db, true, realId)).toBeUndefined();
    // 데모 물건에 추가한 가격 자료는 데모로 저장된다
    const demoItem = getItem(db, true, demoItems[0]!.item.id)!;
    insertPrice(db, demoItem, price({ externalId: "D-NEW" }), "MANUAL");
    expect(exportRows(db, false)).toHaveLength(1);

    clearDemo(db);
    expect(listItems(db, true)).toHaveLength(0);
    expect(exportRows(db, true)).toHaveLength(0);
    expect(listPrices(db, realId)).toHaveLength(1);
  });
});

describe("CSV", () => {
  const target = { id: 1, name: bookInput.name, isDemo: false };
  it("전체 내보내기에서 이름이 같아도 선택한 물건의 행만 가져온다", () => {
    const selected = getItem(db, false, createItem(db, false, { ...bookInput, name: "=같은 이름" }))!;
    const other = getItem(db, false, createItem(db, false, { ...bookInput, name: selected.name }))!;
    insertPrice(db, selected, price({ externalId: "selected" }), "MANUAL");
    insertPrice(db, other, price({ externalId: "other" }), "MANUAL");
    const plan = planCsvImport(buildCsv(exportRows(db, false)), TODAY, [], selected);
    expect(plan.valid.map((v) => v.value.externalId)).toEqual(["selected"]);
    expect(plan.errors.map((e) => e.line)).toEqual([3]);
  });

  it("예전 CSV의 물건 이름과 모드를 확인하고 맞지 않는 행은 건너뛴다", () => {
    const selected = { id: 7, name: "원하는 책", isDemo: false };
    const csv = [
      "price_type,amount,source_name,checked_date,item_name,is_demo",
      "ASKING,1000,장터,2026-11-01,다른 책,false",
      "ASKING,2000,장터,2026-11-01,원하는 책,true",
      "ASKING,3000,장터,2026-11-01,원하는 책,false",
    ].join("\n");
    const plan = planCsvImport(csv, TODAY, [], selected);
    expect(plan.valid.map((v) => v.value.amountMinor)).toEqual([3000]);
    expect(plan.errors.map((e) => e.line)).toEqual([2, 3]);
  });

  it.each(['"닫히지 않음\nASKING,2000,장터,2026-11-01,다른 행', '"메모"추가', '잘못"인용'])("잘못된 따옴표가 있으면 파일의 어느 행도 저장 대상으로 삼지 않는다", (memo) => {
    const csv = `price_type,amount,source_name,checked_date,memo\nASKING,1000,장터,2026-11-01,정상\nASKING,2000,장터,2026-11-01,${memo}`;
    const plan = planCsvImport(csv, TODAY, [], target);
    expect(plan.headerError).toContain("3");
    expect(plan.valid).toHaveLength(0);
  });

  it("열 수가 다른 가격 행을 건너뛰고 실제 줄 번호로 알린다", () => {
    const csv = 'price_type,amount,source_name,checked_date,memo\n\nASKING,1000,장터,2026-11-01,"두\n줄"\nASKING,2000,장터,2026-11-01,잘린,메모';
    const plan = planCsvImport(csv, TODAY, [], target);
    expect(plan.valid.map(({ line }) => line)).toEqual([3]);
    expect(plan.errors.map(({ line }) => line)).toEqual([5]);
  });

  it("가격 CSV를 다시 올려도 수식 기호로 시작하는 매물 ID는 중복으로 감지한다", () => {
    const item = getItem(db, false, createItem(db, false, bookInput))!;
    const record = price({ externalId: "-매물번호", memo: "'@메모" });
    insertPrice(db, item, record, "MANUAL");
    const csv = buildCsv(exportRows(db, false, item.id));
    expect(planCsvImport(csv, TODAY, [], item).valid[0]?.value).toMatchObject({ externalId: "-매물번호", memo: "'@메모" });
    expect(planCsvImport(csv, TODAY, [record], item).valid).toHaveLength(0);
  });

  it("따옴표·쉼표·줄바꿈이 있는 셀을 파싱한다", () => {
    expect(parseCsv('a,b\r\n"x,1","he said ""hi""\nnext"\n')).toEqual([
      ["a", "b"],
      ["x,1", 'he said "hi"\nnext'],
    ]);
  });
  it("수식으로 해석될 수 있는 셀을 무력화한다", () => {
    expect(escapeCsvCell("=HYPERLINK(\"http://evil\")")).toBe("\"'=HYPERLINK(\"\"http://evil\"\")\"");
    expect(escapeCsvCell("+82-10")).toBe("'+82-10");
    expect(escapeCsvCell("-5")).toBe("'-5");
    expect(escapeCsvCell("@cmd")).toBe("'@cmd");
    expect(escapeCsvCell("일반 메모")).toBe("일반 메모");
  });
  it("필수 열 누락·알 수 없는 열은 파일 단위 오류", () => {
    expect(planCsvImport("amount,source_name\n1000,a\n", TODAY, [], target).headerError).toContain("price_type");
    expect(
      planCsvImport("price_type,amount,source_name,checked_date,weird\n", TODAY, [], target).headerError,
    ).toContain("weird");
    expect(planCsvImport("", TODAY, [], target).headerError).not.toBeNull();
  });
  it("행별로 검증해 올바른 행만 계획에 넣고 오류 행은 줄 번호와 사유를 남긴다", () => {
    const csv = [
      "price_type,amount,currency,source_name,external_id,checked_date,memo",
      "ASKING,15000,KRW,장터,X1,2026-11-01,",
      "VERIFIED_SALE,15000,KRW,장터,X2,2026-11-01,", // 3행: 유형 거부
      "ASKING,만오천원,KRW,장터,X3,2026-11-01,", // 4행: 금액 오류
      "ASKING,16000,KRW,장터,X1,2026-11-02,", // 5행: 파일 안 중복
      "ASKING,17000,KRW,장터,OLD,2026-11-02,", // 6행: 기존 자료와 중복
      "SOLD_LISTING,15000,KRW,장터,X6,2026-11-01,", // 금액은 같지만 다른 매물
      "BUYBACK_QUOTE,5000,KRW,매입점,,2026-11-01,", // 8행: 메모 필요
    ].join("\n");
    const plan = planCsvImport(csv, TODAY, [{ sourceName: "장터", externalId: "OLD", normalizedUrl: null }], target);
    expect(plan.headerError).toBeNull();
    expect(plan.valid.map((v) => v.line)).toEqual([2, 7]);
    expect(plan.errors.map((e) => e.line)).toEqual([3, 4, 5, 6, 8]);
    expect(plan.errors[0]!.messages[0]).toContain("price_type");
    expect(plan.errors[1]!.messages[0]).toContain("amount");
  });
  it("내보낸 가격 자료를 다시 가져오면 비교 포함 여부와 금액·메모를 보존한다", () => {
    const item = getItem(db, false, createItem(db, false, bookInput))!;
    insertPrice(
      db,
      item,
      price({ externalId: "E1", memo: '쉼표, "따옴표"\n줄바꿈', sourceUrl: "https://example.com/a?id=3" }),
      "MANUAL",
    );
    insertPrice(db, item, price({ currency: "USD", amount: "12.50", externalId: "E2" }), "MANUAL");
    const records = listPrices(db, item.id);
    setPricesIncluded(db, item.id, [records[0]!.id], false);
    const csv = buildCsv(exportRows(db, false, item.id));
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain("12.50");

    for (const record of records) {
      deletePrice(db, item.id, record.id);
      purgePrice(db, false, record.id);
    }
    const plan = planCsvImport(csv, TODAY, [], item);
    expect(plan.errors).toEqual([]);
    expect(importPrices(db, item, plan.valid.map((v) => v.value))).toBe(2);
    const imported = listPrices(db, item.id);
    expect(imported.map((p) => p.includedInComparison)).toEqual([false, true]);
    expect(imported.map((p) => [p.amountMinor, p.currency, p.inputRoute])).toEqual([
      [10000, "KRW", "CSV"],
      [1250, "USD", "CSV"],
    ]);
    expect(imported[0]!.memo).toBe('쉼표, "따옴표"\n줄바꿈');
  });
});

describe("영속성", () => {
  it("DB를 닫았다가 다시 열어도 물건·가격·시나리오·선택·판매 결과가 유지된다", () => {
    const id = createItem(db, false, bookInput);
    const item = getItem(db, false, id)!;
    insertPrice(db, item, price({ externalId: "P1" }), "MANUAL");
    upsertScenario(db, id, "DIRECT", {
      saleAmount: 20000,
      basisPriceRecordId: null,
      basisPriceType: null,
      feeMode: "RATE",
      feeAmount: null,
      feeRateBp: 350,
      shipping: null,
      packing: 0,
      transport: 0,
      expectedMinutes: 60,
      memo: null,
    });
    setChosenMethod(db, false, id, listScenarios(db, id)[0]!.id);
    upsertSaleResult(db, false, id, {
      channel: "직거래",
      soldDate: "2026-11-10",
      amount: 18000,
      costTotal: null,
      minutesSpent: 45,
      memo: null,
    });
    close();

    const reopened = openDb(dbFile);
    db = reopened.db;
    close = reopened.close;
    const again = getItem(db, false, id)!;
    expect(again.name).toBe("테스트 도서");
    expect(again.status).toBe("SOLD");
    expect(again.chosenMethod).toBe("DIRECT");
    expect(again.chosenNetAmount).toBeNull(); // 불완전 계산은 null로 유지(0으로 바뀌지 않음)
    expect(listPrices(db, id)).toHaveLength(1);
    const sc = listScenarios(db, id)[0]!;
    expect(sc.shipping).toBeNull(); // 모름
    expect(sc.packing).toBe(0); // 0원
    expect(sc.feeRateBp).toBe(350);
    expect(getSaleResult(db, id)).toMatchObject({ amount: 18000, costTotal: null, minutesSpent: 45 });
  });
});

describe("외부 조회", () => {
  const meta = { title: "책", author: null, publisher: null, edition: null, publishedDate: null };
  const provider = (over: Partial<BibliographicProvider>): BibliographicProvider => ({
    id: "p",
    label: "테스트 제공자",
    isConfigured: () => true,
    lookupByIsbn: async () => meta,
    ...over,
  });

  it("가격 제공자는 등록되어 있지 않다(가격 자동 조회 미지원)", () => {
    expect(priceProviders).toEqual([]);
  });
  it("실패하면 값을 지어내지 않고 오류 상태를 돌려주며, 재시도는 1회로 제한한다", async () => {
    let calls = 0;
    const r = await lookupBook("9780306406157", {
      providers: [
        provider({
          lookupByIsbn: async () => {
            calls++;
            throw new Error("network");
          },
        }),
      ],
    });
    expect(r.status).toBe("error");
    expect(calls).toBe(2);
  });
  it("키가 없는 제공자는 호출하지 않고, 결과 없음과 오류를 구분한다", async () => {
    let called = false;
    const r = await lookupBook("9780306406157", {
      providers: [
        provider({
          isConfigured: () => false,
          lookupByIsbn: async () => {
            called = true;
            return meta;
          },
        }),
        provider({ id: "q", lookupByIsbn: async () => null }),
      ],
    });
    expect(called).toBe(false);
    expect(r.status).toBe("not_found");
  });
  it("캐시된 결과는 다시 요청하지 않고, 꺼져 있으면 아무것도 호출하지 않는다", async () => {
    const store = new Map<string, { payload: string; fetchedAt: string }>();
    const cache = {
      get: (p: string, k: string) => store.get(`${p}:${k}`),
      set: (p: string, k: string, payload: string) =>
        void store.set(`${p}:${k}`, { payload, fetchedAt: new Date().toISOString() }),
    };
    let calls = 0;
    const providers = [
      provider({
        lookupByIsbn: async () => {
          calls++;
          return meta;
        },
      }),
    ];
    const first = await lookupBook("9780306406157", { providers, cache });
    const second = await lookupBook("9780306406157", { providers, cache });
    expect(first.status === "found" && !first.cached).toBe(true);
    expect(second.status === "found" && second.cached).toBe(true);
    expect(calls).toBe(1);
    expect((await lookupBook("9780306406157", { providers, disabled: true })).status).toBe("disabled");
    expect(calls).toBe(1);
  });
});
