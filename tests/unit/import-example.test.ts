import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error 예시 스크립트는 타입 선언 없는 .mjs다.
import { APP_ORIGIN, appOrigin, buildBodies, chunk } from "../../examples/import-prices.mjs";
import { CSV_COLUMNS } from "@/lib/domain/csv";
import { MAX_IMPORT_RECORDS, toPriceInputRaw } from "@/lib/import/records";
import { validatePriceInput } from "@/lib/domain/price-input";

describe("가져오기 API 예시 스크립트", () => {
  it("로컬 앱 주소로만 보내고, 한 요청 한도에 맞춰 나눈다", () => {
    expect(APP_ORIGIN).toBe("http://127.0.0.1:3000");
    expect(appOrigin(undefined)).toBe(APP_ORIGIN);
    expect(appOrigin("http://localhost:3100")).toBe("http://localhost:3100");
    for (const bad of ["https://example.com", "http://127.0.0.1.evil.com:3000", "http://192.168.0.2:3000", "http://127.0.0.1:3000/x"]) expect(() => appOrigin(bad)).toThrow();
    expect(chunk(Array.from({ length: 250 }, (_, i) => i)).map((c: number[]) => c.length)).toEqual([MAX_IMPORT_RECORDS, MAX_IMPORT_RECORDS, 50]);
  });

  it("잘못된 파일 모양을 거부한다", () => {
    expect(() => buildBodies(null)).toThrow();
    expect(() => buildBodies({ itemId: 0, records: [{}] })).toThrow("itemId");
    expect(() => buildBodies({ itemId: 1, records: [] })).toThrow("records");
    expect(buildBodies({ itemId: 3, records: [{ a: 1 }] })).toEqual([{ itemId: 3, records: [{ a: 1 }] }]);
  });

  it("예시 JSON의 필드는 모두 CSV 열 이름이다(판매자 정보 칸 없음)", () => {
    const ex = JSON.parse(fs.readFileSync(path.join(process.cwd(), "examples/import-prices-example.json"), "utf8"));
    const allowed = new Set(CSV_COLUMNS.map((c) => c.header));
    for (const r of ex.records) for (const k of Object.keys(r)) expect(allowed.has(k)).toBe(true);
  });

  it("예시 JSON의 자료는 모두 앱의 검증을 통과한다", () => {
    const ex = JSON.parse(fs.readFileSync(path.join(process.cwd(), "examples/import-prices-example.json"), "utf8"));
    for (const r of ex.records) {
      const conv = toPriceInputRaw(r);
      if (!conv.ok) throw new Error(conv.error);
      const v = validatePriceInput(conv.raw, { route: "EXTERNAL", today: "2026-11-18" });
      expect(v.ok ? "ok" : JSON.stringify(v.errors)).toBe("ok");
    }
  });

  it("스크립트에 토큰을 찍는 코드가 없다", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "examples/import-prices.mjs"), "utf8");
    expect(src).not.toMatch(/console\.\w+\([^)]*token/);
  });
});
