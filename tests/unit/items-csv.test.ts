import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "@/lib/db/client";
import { createItems, listAllItems, listItems, listPrices } from "@/lib/db/repo";
import { validateItemInput } from "@/lib/domain/item-input";
import { buildListingDraft } from "@/lib/domain/listing";
import { TEMPLATE_TOKENS } from "@/lib/domain/listing-template";
import { countPurchaseOutcomes, heldDays, vsPurchase } from "@/lib/domain/purchase";
import { buildTimeline } from "@/lib/domain/timeline";
import { buildItemsCsv, isSameItem, MAX_ITEM_CSV_ROWS, planItemsCsvImport } from "@/lib/domain/items-csv";

const HEAD = "category,name,identifier,condition,edition,defects";

describe("물건 CSV 읽기", () => {
  it("필수 열이 없거나 모르는 열이 있으면 아무것도 등록하지 않는다", () => {
    expect(planItemsCsvImport("", []).headerError).toContain("빈 파일");
    expect(planItemsCsvImport("category,name\nBOOK,책", []).headerError).toContain("condition");
    expect(planItemsCsvImport("category,name,condition,price\nBOOK,책,GOOD,1000", []).headerError).toContain("price");
    const many = [HEAD, ...Array.from({ length: MAX_ITEM_CSV_ROWS + 1 }, (_, i) => `CONSOLE,기기${i},,GOOD,,`)].join("\n");
    expect(planItemsCsvImport(many, []).headerError).toContain(`${MAX_ITEM_CSV_ROWS}행`);
  });

  it("등록 폼과 같은 검증을 거친다: ISBN 정규화, 코드값 대소문자 무시, 도서 전용 칸 정리", () => {
    const plan = planItemsCsvImport(
      [HEAD + ",has_writing", "book,예시 도서,0-306-40615-2,good,2판,,yes", "Console,예시 게임기,ABC-100,FAIR,2판,스틱 쏠림,YES"].join("\n"),
      [],
    );
    expect(plan.errors).toEqual([]);
    expect(plan.valid[0]!.value).toMatchObject({ category: "BOOK", identifier: "9780306406157", condition: "GOOD", edition: "2판", hasWriting: "YES", status: "OWNED" });
    expect(plan.valid[1]!.value).toMatchObject({ category: "CONSOLE", edition: null, hasWriting: "UNKNOWN", defects: "스틱 쏠림" });
  });

  it("오류 행은 행 번호와 이유를 남기고 건너뛴다. 상태 등급을 비우면 추정하지 않고 거부한다", () => {
    const plan = planItemsCsvImport([HEAD, "BOOK,잘못된 ISBN,123,GOOD,,", "CONSOLE,상태 없음,,,,", "TOY,모르는 품목,,GOOD,,", "CONSOLE,정상,,POOR,,"].join("\n"), []);
    expect(plan.valid.map((v) => v.line)).toEqual([5]);
    expect(plan.errors.map((e) => e.line)).toEqual([2, 3, 4]);
    expect(plan.errors[0]!.messages[0]).toContain("identifier");
    expect(plan.errors[1]!.messages[0]).toContain("condition");
    expect(plan.errors[2]!.messages[0]).toContain("category");
  });

  it("이미 있는 물건과 파일 안에서 겹치는 행은 건너뛴다", () => {
    const plan = planItemsCsvImport(
      [HEAD, "CONSOLE,게임기,ABC-1,GOOD,,", "CONSOLE,게임기,ABC-1,FAIR,,", "CONSOLE,게임기,ABC-2,GOOD,,", "BOOK,게임기,,GOOD,,"].join("\n"),
      [{ category: "CONSOLE", name: "게임기", identifier: "ABC-2" }],
    );
    expect(plan.valid.map((v) => v.line)).toEqual([2, 5]);
    expect(plan.errors.map((e) => e.line)).toEqual([3, 4]);
    expect(isSameItem({ category: "BOOK", name: "가", identifier: null }, { category: "BOOK", name: "가", identifier: "" })).toBe(true);
  });

  it("가격 열은 받지 않는다(물건 정보만)", () => {
    for (const col of ["price", "amount", "asking", "sale_amount"]) {
      expect(planItemsCsvImport(`category,name,condition,${col}\nBOOK,책,GOOD,1000`, []).headerError).toContain(col);
    }
  });
});

describe("산 가격", () => {
  const base = { category: "CONSOLE", name: "게임기", condition: "GOOD" };

  it("빈칸은 모름(null), 0원은 거저 얻음으로 구분한다", () => {
    expect(validateItemInput(base)).toMatchObject({ ok: true, value: { purchaseAmount: null, purchaseDate: null } });
    expect(validateItemInput({ ...base, purchaseAmount: "0" })).toMatchObject({ ok: true, value: { purchaseAmount: 0 } });
    expect(validateItemInput({ ...base, purchaseAmount: "30,000", purchaseDate: "2026-01-05" }, "2026-11-17")).toMatchObject({
      ok: true,
      value: { purchaseAmount: 30000, purchaseDate: "2026-01-05" },
    });
  });

  it("잘못된 금액·날짜와 미래 날짜는 거부한다", () => {
    expect(validateItemInput({ ...base, purchaseAmount: "-1" })).toMatchObject({ ok: false });
    expect(validateItemInput({ ...base, purchaseDate: "2026-13-01" })).toMatchObject({ ok: false });
    const future = validateItemInput({ ...base, purchaseDate: "2026-11-18" }, "2026-11-17");
    expect(future.ok ? "" : future.errors.purchaseDate).toContain("오늘 이후");
  });

  it("실수령액과 견주기: 어느 한쪽을 모르면 비교하지 않는다", () => {
    expect(vsPurchase(17000, 30000)).toBe(-13000);
    expect(vsPurchase(17000, 0)).toBe(17000);
    expect(vsPurchase(null, 30000)).toBeNull();
    expect(vsPurchase(17000, null)).toBeNull();
    expect(vsPurchase(17000, undefined)).toBeNull();
    expect(countPurchaseOutcomes([-13000, 0, 500, 2000])).toEqual({ ABOVE: 2, EQUAL: 1, BELOW: 1 });
  });

  it("산 날부터 지난 일수: 산 날짜를 모르거나 앞뒤가 바뀌면 내지 않는다", () => {
    expect(heldDays("2026-01-05", "2026-01-15")).toBe(10);
    expect(heldDays("2026-01-05", "2026-01-05")).toBe(0);
    expect(heldDays(null, "2026-01-15")).toBeNull();
    expect(heldDays("2026-02-01", "2026-01-15")).toBeNull();
  });

  it("물건 CSV로 넣고 뺄 수 있고, 판매글 초안에는 들어가지 않는다", () => {
    const plan = planItemsCsvImport("category,name,condition,purchase_amount,purchase_date\nCONSOLE,게임기,GOOD,30000,2026-01-05\nCONSOLE,다른 게임기,GOOD,,", []);
    expect(plan.errors).toEqual([]);
    expect(plan.valid[0]!.value).toMatchObject({ purchaseAmount: 30000, purchaseDate: "2026-01-05" });
    expect(plan.valid[1]!.value).toMatchObject({ purchaseAmount: null, purchaseDate: null });
    const csv = buildItemsCsv([{ ...plan.valid[0]!.value, isDemo: false }]);
    expect(csv.split("\r\n")[1]).toContain(",30000,2026-01-05,false");
    const draft = buildListingDraft({ ...plan.valid[0]!.value }, 50000);
    expect(`${draft.title} ${draft.body} ${draft.compact}`).not.toContain("30,000");
    expect(TEMPLATE_TOKENS.map((t) => t.name)).not.toContain("산가격");
  });

  it("타임라인에 구입이 맨 아래에 온다", () => {
    const tl = buildTimeline({
      item: { createdAt: "2026-11-01 00:00:00", purchaseAmount: 30000, purchaseDate: "2026-01-05", chosenMethod: null, chosenSaleAmount: null, chosenAt: null },
      prices: [], history: new Map(), posted: [], offers: [], result: undefined,
    });
    expect(tl.map((e) => e.kind)).toEqual(["REGISTERED", "PURCHASED"]);
    expect(tl[1]!.text).toBe("30,000원에 삼(내가 적은 값)");
  });
});

describe("물건 CSV 저장·내보내기", () => {
  let tmpDir: string;
  let db: Db;
  let close: () => void;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "resale-items-csv-"));
    ({ db, close } = openDb(path.join(tmpDir, "t.db")));
  });
  afterEach(() => {
    try {
      close();
    } catch {}
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("내보낸 파일을 다시 가져오면 전부 중복으로 건너뛰고, 빈 DB에서는 같은 물건이 만들어진다", () => {
    const plan = planItemsCsvImport(
      [HEAD + ",memo", 'BOOK,"쉼표, 있는 제목",9780306406157,GOOD,2판,,"줄\n바꿈"', "CONSOLE,게임기,ABC-1,FAIR,,스틱 쏠림,"].join("\n"),
      [],
    );
    expect(createItems(db, false, plan.valid.map((v) => v.value))).toBe(2);
    expect(listItems(db, false)).toHaveLength(2);
    expect(listItems(db, true)).toHaveLength(0);
    for (const it of listAllItems(db, false)) expect(listPrices(db, it.id)).toHaveLength(0); // 가격은 만들지 않는다

    const csv = buildItemsCsv(listAllItems(db, false));
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv.split("\r\n")[0]).toContain("category,name,identifier,condition,status");
    const again = planItemsCsvImport(csv, listAllItems(db, false));
    expect(again.headerError).toBeNull();
    expect(again.valid).toHaveLength(0);
    expect(again.errors).toHaveLength(2);

    const fresh = planItemsCsvImport(csv, []);
    expect(fresh.errors).toEqual([]);
    expect(fresh.valid.map((v) => v.value.name)).toEqual(["쉼표, 있는 제목", "게임기"]);
    expect(fresh.valid[0]!.value.memo).toBe("줄\n바꿈");
  });
});
