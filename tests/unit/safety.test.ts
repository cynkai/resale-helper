import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { openDb } from "@/lib/db/client";
import { seedDemo } from "@/lib/db/demo-seed";
import { createItem, listItems, listPrices } from "@/lib/db/repo";
import {
  authorizeImport,
  classifyOrigin,
  corsHeaders,
  generateImportToken,
  hashImportToken,
  verifyImportToken,
} from "@/lib/import/access";
import { readJsonBody } from "@/lib/import/http";
import { importRecords, MAX_IMPORT_BODY_BYTES, MAX_IMPORT_RECORDS } from "@/lib/import/records";
import { buildComparison } from "@/lib/domain/compare";
import { isLoopbackHost } from "@/lib/host";
import { basisIssues, isChoiceOutdated } from "@/lib/domain/scenario";

const TODAY = "2026-11-11";

describe("localhost 전용 접근", () => {
  it("루프백 Host만 허용한다(포트 무관)", () => {
    for (const h of ["127.0.0.1:3000", "localhost", "LOCALHOST:3217", "[::1]:3000", "app.localhost:3000"]) {
      expect(isLoopbackHost(h), h).toBe(true);
    }
  });
  it("DNS 리바인딩에 쓰이는 외부 도메인·우회 표기를 거부한다", () => {
    for (const h of [
      "evil.example",
      "evil.example:3000",
      "127.0.0.1.nip.io",
      "localhost.evil.example",
      "192.168.0.10:3000",
      "0.0.0.0:3000",
      "[::1].evil.example",
      "",
      null,
      undefined,
    ]) {
      expect(isLoopbackHost(h), String(h)).toBe(false);
    }
  });
});

describe("저장된 계산의 기준 자료 확인", () => {
  const sc = { saleAmount: 7000, basisPriceRecordId: 5, basisPriceType: "BUYBACK_QUOTE" as const };
  const basis = { amountMinor: 7000, currency: "KRW" as const, priceType: "BUYBACK_QUOTE" as const, quoteValidUntil: "2026-11-20" };

  it("직접 입력한 금액이면 확인할 기준 자료가 없다", () => {
    expect(basisIssues({ saleAmount: 7000, basisPriceRecordId: null, basisPriceType: null }, undefined, TODAY)).toEqual([]);
  });
  it("기준 자료가 그대로면 문제 없음", () => {
    expect(basisIssues(sc, basis, TODAY)).toEqual([]);
  });
  it("기준 자료가 삭제되면(id가 비고 유형 스냅샷만 남음) 알린다", () => {
    expect(basisIssues({ ...sc, basisPriceRecordId: null }, undefined, TODAY)).toEqual(["BASIS_DELETED"]);
    expect(basisIssues(sc, undefined, TODAY)).toEqual(["BASIS_DELETED"]);
  });
  it("기준 자료 금액이 바뀌면 저장된 금액을 그대로 믿지 않는다", () => {
    expect(basisIssues(sc, { ...basis, amountMinor: 6000 }, TODAY)).toEqual(["BASIS_AMOUNT_CHANGED"]);
  });
  it("기준 자료가 외화로 바뀌거나 견적이 만료되면 알린다", () => {
    expect(basisIssues(sc, { ...basis, currency: "USD" }, TODAY)).toEqual(["BASIS_NOT_KRW"]);
    expect(basisIssues(sc, { ...basis, quoteValidUntil: "2026-11-10" }, TODAY)).toEqual(["BASIS_EXPIRED"]);
  });
});

describe("판매 방법 선택 후 계산이 바뀐 경우", () => {
  const scenario = {
    method: "DIRECT",
    saleAmount: 19000,
    feeMode: "AMOUNT" as const,
    feeAmount: 0,
    feeRateBp: null,
    shipping: 3500,
    packing: 500,
    transport: 0,
  };
  it("선택 당시와 금액·실수령액이 같으면 그대로다", () => {
    expect(isChoiceOutdated({ chosenMethod: "DIRECT", chosenSaleAmount: 19000, chosenNetAmount: 15000 }, scenario)).toBe(false);
  });
  it("비용이 바뀌어 실수령액이 달라지면 알린다", () => {
    expect(
      isChoiceOutdated({ chosenMethod: "DIRECT", chosenSaleAmount: 19000, chosenNetAmount: 15000 }, { ...scenario, shipping: 4000 }),
    ).toBe(true);
  });
  it("선택 당시 불완전(null)이었는데 지금 계산이 완전해져도 알린다", () => {
    expect(isChoiceOutdated({ chosenMethod: "DIRECT", chosenSaleAmount: 19000, chosenNetAmount: null }, scenario)).toBe(true);
  });
  it("선택하지 않았으면 해당 없음", () => {
    expect(isChoiceOutdated({ chosenMethod: null, chosenSaleAmount: null, chosenNetAmount: null }, undefined)).toBe(false);
  });
});

describe("오래된 자료 표시", () => {
  const item = { identifier: null, condition: "GOOD" as const };
  const rec = (checkedDate: string) => ({
    id: 1,
    priceType: "ASKING" as const,
    amountMinor: 10000,
    currency: "KRW" as const,
    checkedDate,
    productIdentifier: null,
    condition: "GOOD" as const,
    bundleType: "SINGLE" as const,
    quoteValidUntil: null,
    includedInComparison: true,
  });
  it("90일이 넘은 자료는 기간 안이면 포함하되 '오래됨' 경고를 붙인다", () => {
    const c = buildComparison(item, [rec("2026-08-12"), rec("2026-08-13")], TODAY, 180);
    const [older, newer] = c.groups[0]!.eligible;
    expect(older!.warnings).toContain("OLD_DATA");
    expect(newer!.warnings).not.toContain("OLD_DATA");
  });
  it("기간 밖이면 경고 대신 제외한다", () => {
    const c = buildComparison(item, [rec("2026-01-01")], TODAY, 180);
    expect(c.groups[0]!.excluded[0]!.exclusions).toEqual(["OUT_OF_WINDOW"]);
    expect(c.groups[0]!.excluded[0]!.warnings).not.toContain("OLD_DATA");
  });
});

describe("가져오기 API 접근 통제", () => {
  const EXT = "abcdefghijklmnopabcdefghijklmnop";
  const { token, hash } = generateImportToken();
  const settings = { tokenHash: hash, extensionId: EXT };
  const bearer = `Bearer ${token}`;

  it("토큰은 해시로만 저장되고, 해시에서 원문을 알 수 없다", () => {
    expect(token.startsWith("rh_")).toBe(true);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token);
    expect(hashImportToken(token)).toBe(hash);
    expect(verifyImportToken(token, hash)).toBe(true);
    expect(verifyImportToken(token + "x", hash)).toBe(false);
    expect(generateImportToken().token).not.toBe(token);
  });

  it("토큰을 만들지 않은 상태(기본)에서는 올바른 형식의 토큰을 보내도 꺼져 있다", () => {
    const r = authorizeImport({ authorization: bearer, origin: null }, { tokenHash: null, extensionId: null });
    expect(r).toMatchObject({ ok: false, status: 403 });
  });

  it("토큰이 없거나 틀리면 거부하고, 오류 문구에 토큰을 넣지 않는다", () => {
    for (const authorization of [null, "", "Bearer ", "Bearer wrong-token", `Basic ${token}`, token, `bearer ${token} extra`]) {
      const r = authorizeImport({ authorization, origin: null }, settings);
      expect(r, String(authorization)).toMatchObject({ ok: false, status: 401 });
      if (!r.ok) expect(r.error).not.toContain(token);
    }
  });

  it("일반 웹 origin은 올바른 토큰이 있어도 거부한다(CSRF 방어)", () => {
    for (const origin of [
      "https://evil.example",
      "http://127.0.0.1:3000", // 이 앱 자신의 화면도 이 API를 쓰지 않는다
      "http://localhost:3000",
      "null",
      "chrome-extension://ponmlkjihgfedcbaponmlkjihgfedcba", // 등록하지 않은 확장
      `chrome-extension://${EXT}.evil.example`,
      `moz-extension://${EXT}`,
    ]) {
      const r = authorizeImport({ authorization: bearer, origin }, settings);
      expect(r, origin).toMatchObject({ ok: false, status: 403, corsOrigin: null });
    }
  });

  it("확장 ID를 등록하지 않았으면 확장 origin도 거부한다", () => {
    expect(classifyOrigin(`chrome-extension://${EXT}`, null)).toEqual({ allowed: false });
    expect(classifyOrigin(`chrome-extension://${EXT}`, "not-an-id")).toEqual({ allowed: false });
  });

  it("입력 경로는 서버가 Origin으로 정한다: Origin 없음 → EXTERNAL, 등록된 확장 → CLIP", () => {
    expect(authorizeImport({ authorization: bearer, origin: null }, settings)).toEqual({ ok: true, route: "EXTERNAL", corsOrigin: null });
    expect(authorizeImport({ authorization: bearer, origin: `chrome-extension://${EXT}` }, settings)).toEqual({
      ok: true,
      route: "CLIP",
      corsOrigin: `chrome-extension://${EXT}`,
    });
  });

  it("CORS 헤더는 허용된 origin에만 붙이고 *를 쓰지 않는다", () => {
    expect(corsHeaders(null)).toEqual({});
    const h = corsHeaders(`chrome-extension://${EXT}`);
    expect(h["Access-Control-Allow-Origin"]).toBe(`chrome-extension://${EXT}`);
    expect(Object.values(h)).not.toContain("*");
  });
});

describe("가져오기 API 본문 처리", () => {
  const TODAY = "2026-11-11";
  const rec = (over: Record<string, unknown> = {}) => ({
    price_type: "ASKING",
    amount: 12000,
    source_name: "테스트마켓",
    external_id: "X-1",
    checked_date: "2026-11-10",
    ...over,
  });
  function withDb<T>(fn: (db: ReturnType<typeof openDb>["db"], itemId: number) => T): T {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "resale-import-"));
    const { db, close } = openDb(path.join(dir, "i.db"));
    try {
      const itemId = createItem(db, false, {
        category: "CONSOLE",
        status: "OWNED",
        name: "가져오기 대상",
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
      return fn(db, itemId);
    } finally {
      close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  it("VERIFIED_SALE은 어떤 경로로도 만들 수 없고, 다른 유형으로 바꿔 저장하지도 않는다", () => {
    withDb((db, itemId) => {
      for (const route of ["CLIP", "EXTERNAL"] as const) {
        const out = importRecords(
          db,
          { itemId, records: [rec({ price_type: "VERIFIED_SALE", external_id: `V-${route}`, verification_method: "영수증" })] },
          route,
          TODAY,
        );
        expect(out.ok && out.imported).toBe(0);
        expect(out.ok && out.results[0]).toMatchObject({ index: 0, ok: false });
      }
      expect(listPrices(db, itemId)).toHaveLength(0);
    });
  });

  it("행 수 상한을 넘으면 아무것도 저장하지 않고 413", () => {
    withDb((db, itemId) => {
      const records = Array.from({ length: MAX_IMPORT_RECORDS + 1 }, (_, i) => rec({ external_id: `N-${i}` }));
      expect(importRecords(db, { itemId, records }, "EXTERNAL", TODAY)).toMatchObject({ ok: false, status: 413 });
      expect(listPrices(db, itemId)).toHaveLength(0);
    });
  });

  it("본문 크기 상한을 넘으면 읽기 단계에서 413, JSON이 아니면 거부한다", async () => {
    const req = (body: string, headers: Record<string, string> = { "Content-Type": "application/json" }) =>
      new Request("http://127.0.0.1:3000/api/import/prices", { method: "POST", body, headers });
    expect(await readJsonBody(req("x".repeat(MAX_IMPORT_BODY_BYTES + 1)))).toMatchObject({ ok: false, status: 413 });
    expect(await readJsonBody(req("{}", { "Content-Type": "text/plain" }))).toMatchObject({ ok: false, status: 415 });
    expect(await readJsonBody(req("{not json"))).toMatchObject({ ok: false, status: 400 });
    expect(await readJsonBody(req('{"itemId":1}'))).toEqual({ ok: true, body: { itemId: 1 } });
  });

  it("올바른 행만 저장하고 행별 결과를 돌려준다. 중복은 기존 규칙 그대로 거부한다", () => {
    withDb((db, itemId) => {
      const out = importRecords(
        db,
        {
          itemId,
          records: [
            rec(),
            rec({ amount: 13000 }), // 같은 출처+매물 번호 → 중복
            rec({ external_id: "X-2", amount: "1.5만" }),
            rec({ external_id: "X-3", price_type: "SOLD_LISTING", source_url: "https://example.com/p/3?utm_source=a" }),
          ],
        },
        "EXTERNAL",
        TODAY,
      );
      if (!out.ok) throw new Error(out.error);
      expect(out.results.map((r) => r.ok)).toEqual([true, false, false, true]);
      expect(out.results[1]).toMatchObject({ error: expect.stringContaining("이미 등록된 매물") });
      expect(out).toMatchObject({ imported: 2, rejected: 2 });
      const saved = listPrices(db, itemId);
      expect(saved.map((p) => p.inputRoute)).toEqual(["EXTERNAL", "EXTERNAL"]);
      expect(saved.every((p) => !p.isDemo)).toBe(true);
      // 다시 보내면 URL 정규화 기준으로도 중복
      const again = importRecords(db, { itemId, records: [rec({ external_id: "other", price_type: "SOLD_LISTING", source_url: "https://www.example.com/p/3" })] }, "CLIP", TODAY);
      expect(again.ok && again.imported).toBe(0);
    });
  });

  it("가격 자료가 아닌 필드(판매자 정보 등)는 받지 않고 그 행을 거부한다", () => {
    withDb((db, itemId) => {
      const out = importRecords(db, { itemId, records: [rec({ seller_nickname: "누군가" }), rec({ input_route: "API", external_id: "X-9" })] }, "EXTERNAL", TODAY);
      if (!out.ok) throw new Error(out.error);
      expect(out.imported).toBe(0);
      expect(out.results[0]).toMatchObject({ error: expect.stringContaining("seller_nickname") });
      expect(listPrices(db, itemId)).toHaveLength(0);
    });
  });

  it("데모 물건에는 저장하지 않는다(항상 실제 모드), 없는 물건·잘못된 본문은 거부", () => {
    withDb((db, itemId) => {
      seedDemo(db, TODAY);
      const demoId = listItems(db, true)[0]!.item.id;
      expect(importRecords(db, { itemId: demoId, records: [rec()] }, "EXTERNAL", TODAY)).toMatchObject({ ok: false, status: 404 });
      expect(importRecords(db, { itemId: 999999, records: [rec()] }, "EXTERNAL", TODAY)).toMatchObject({ ok: false, status: 404 });
      expect(importRecords(db, { itemId: String(itemId), records: [rec()] }, "EXTERNAL", TODAY)).toMatchObject({ ok: false, status: 400 });
      expect(importRecords(db, { itemId, records: [] }, "EXTERNAL", TODAY)).toMatchObject({ ok: false, status: 400 });
      expect(importRecords(db, [rec()], "EXTERNAL", TODAY)).toMatchObject({ ok: false, status: 400 });
    });
  });
});

describe("보안 헤더", () => {
  it("CSP는 nonce로만 스크립트를 허용하고, 운영에서는 eval과 인라인 스크립트를 허용하지 않는다", async () => {
    const { contentSecurityPolicy, STATIC_SECURITY_HEADERS } = await import("@/lib/security-headers");
    const prod = contentSecurityPolicy("abc123", false);
    const script = prod.split("; ").find((d) => d.startsWith("script-src"))!;
    expect(script).toBe("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(prod).not.toContain("unsafe-eval");
    expect(prod).toContain("default-src 'self'");
    expect(prod).toContain("connect-src 'self'");
    expect(prod).toContain("frame-ancestors 'none'");
    expect(prod).toContain("form-action 'self'");
    expect(prod).toContain("base-uri 'self'");
    expect(prod).not.toMatch(/https?:|\*/); // 외부 출처·와일드카드 없음
    // 개발 모드에서만 eval을 허용한다
    expect(contentSecurityPolicy("abc123", true)).toContain("'unsafe-eval'");
    expect(STATIC_SECURITY_HEADERS).toMatchObject({ "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" });
  });
});

describe("서버가 밖으로 나가는 곳", () => {
  it("외부 요청 코드는 서지정보 제공자 한 파일뿐이고, 접속 주소는 코드에 고정된 두 곳이다", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const root = path.resolve(import.meta.dirname, "../../src");
    const files = (fs.readdirSync(root, { recursive: true }) as string[]).filter((f) => /\.(ts|tsx)$/.test(f));
    const code = (f: string) =>
      fs
        .readFileSync(path.join(root, f), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
    // 네트워크로 나갈 수 있는 수단을 쓰는 서버 파일
    const outbound = files.filter((f) => /\bfetch\b|node:https?|node:net|undici|XMLHttpRequest|WebSocket/.test(code(f))).sort();
    // ItemForm은 브라우저에서 이 앱 자신의 /api/books/lookup만 부른다.
    expect(outbound).toEqual(["components/ItemForm.tsx", "lib/providers/bibliographic.ts"]);
    expect(code("components/ItemForm.tsx")).toMatch(/fetch\(`\/api\/books\/lookup\?/);
    const hosts = [...code("lib/providers/bibliographic.ts").matchAll(/https?:\/\/([a-z0-9.-]+)/g)].map((m) => m[1]);
    expect([...new Set(hosts)].sort()).toEqual(["openlibrary.org", "www.nl.go.kr"]);
  });
});
