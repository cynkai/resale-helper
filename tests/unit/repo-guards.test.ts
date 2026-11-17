// repo.ts의 쿼리 규칙을 코드 모양으로 지킨다.
// 가격 자료(price_records)를 읽는 함수는 휴지통 자료를 빼는 조건(livePrice 또는 SQL의 deleted_at is null)을 써야 한다.
// 휴지통을 다루거나 쓰기만 하는 함수는 아래 목록에 이유와 함께 둔다. 새 함수를 이 목록에 넣을 때는 이유를 확인한다.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ALLOWED_WITHOUT_LIVE_PRICE: Record<string, string> = {
  listTrashedItems: "휴지통 물건에 딸린 자료 수(물건을 되살리면 모두 돌아온다)",
  emptyTrash: "휴지통의 가격 자료를 지운다",
  listPricesForDedup: "같은 매물 판별은 휴지통 자료까지 본다(되살릴 때 중복 방지)",
  insertPrice: "쓰기(중복 판별은 listPricesForDedup)",
  importPrices: "쓰기",
  trashedPrice: "휴지통 조건 자체",
  listTrashedPrices: "휴지통 화면",
  countTrashedPrices: "휴지통 건수",
  restorePrice: "휴지통에서 되살리기",
  purgePrice: "휴지통에서 완전히 지우기",
};

function functionsTouchingPrices(src: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of src.split(/\n(?=export function |function |const [A-Za-z0-9_]+ = \()/)) {
    const m = /^(?:export )?(?:function|const) ([A-Za-z0-9_]+)/.exec(part);
    if (m && (part.includes("priceRecords") || part.includes("price_records"))) out.set(m[1]!, part);
  }
  return out;
}

function missingLivePrice(src: string): string[] {
  return [...functionsTouchingPrices(src)]
    .filter(([name, body]) => !(name in ALLOWED_WITHOUT_LIVE_PRICE) && !body.includes("livePrice") && !body.includes("deleted_at is null"))
    .map(([name]) => name);
}

describe("repo.ts 가격 자료 쿼리 규칙", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "src/lib/db/repo.ts"), "utf8");
  const fns = functionsTouchingPrices(src);

  it("가격 자료를 읽는 함수는 휴지통 자료를 뺀다(예외는 이유와 함께 목록에)", () => {
    expect(missingLivePrice(src)).toEqual([]);
  });

  it("조건을 빠뜨린 새 함수를 찾아낸다", () => {
    const bad = `${src}\nexport function newPriceQuery(db: Db) {\n  return db.select().from(priceRecords).all();\n}\n`;
    expect(missingLivePrice(bad)).toEqual(["newPriceQuery"]);
  });

  it("예외 목록에 더는 없는 함수가 남아 있지 않다", () => {
    expect(Object.keys(ALLOWED_WITHOUT_LIVE_PRICE).filter((n) => !fns.has(n))).toEqual([]);
  });

  it("검사기가 실제로 함수를 찾는다", () => {
    expect(fns.has("listPrices")).toBe(true);
    expect(fns.size).toBeGreaterThan(15);
  });
});
