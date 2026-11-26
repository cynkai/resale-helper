import { describe, expect, it } from "vitest";
import { isCrossSiteApiRequest, STATIC_SECURITY_HEADERS } from "@/lib/security-headers";

describe("고정 보안 헤더", () => {
  it("다른 사이트가 응답을 태그로 끌어다 쓰지 못하게 CORP를 same-origin으로 둔다", () => {
    expect(STATIC_SECURITY_HEADERS["Cross-Origin-Resource-Policy"]).toBe("same-origin");
    expect(STATIC_SECURITY_HEADERS["Cross-Origin-Opener-Policy"]).toBe("same-origin");
  });
});

describe("다른 웹사이트에서 온 API 요청", () => {
  it("API는 cross-site·same-site면 거절하고, 이 앱 화면·주소창·헤더 없는 도구는 통과시킨다", () => {
    for (const path of ["/api/backup", "/api/export/all", "/api/books/lookup", "/api/backup/snapshots/x.db"]) {
      expect(isCrossSiteApiRequest(path, "cross-site")).toBe(true);
      expect(isCrossSiteApiRequest(path, "Same-Site")).toBe(true);
      expect(isCrossSiteApiRequest(path, "same-origin")).toBe(false);
      expect(isCrossSiteApiRequest(path, "none")).toBe(false);
      expect(isCrossSiteApiRequest(path, null)).toBe(false);
    }
  });

  it("화면 주소와 가져오기 API는 여기서 다루지 않는다", () => {
    expect(isCrossSiteApiRequest("/", "cross-site")).toBe(false);
    expect(isCrossSiteApiRequest("/items/1", "cross-site")).toBe(false);
    expect(isCrossSiteApiRequest("/api/import/prices", "cross-site")).toBe(false);
    expect(isCrossSiteApiRequest("/api/import/items", "cross-site")).toBe(false);
    expect(isCrossSiteApiRequest("/apix/backup", "cross-site")).toBe(false);
  });
});
