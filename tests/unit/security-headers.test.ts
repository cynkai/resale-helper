import { describe, expect, it } from "vitest";
import { isBlockedCrossSiteRequest, STATIC_SECURITY_HEADERS } from "@/lib/security-headers";

describe("고정 보안 헤더", () => {
  it("다른 사이트가 응답을 태그로 끌어다 쓰지 못하게 CORP를 same-origin으로 둔다", () => {
    expect(STATIC_SECURITY_HEADERS["Cross-Origin-Resource-Policy"]).toBe("same-origin");
    expect(STATIC_SECURITY_HEADERS["Cross-Origin-Opener-Policy"]).toBe("same-origin");
  });
});

describe("다른 웹사이트에서 온 요청", () => {
  it("API는 방법과 관계없이 cross-site·same-site면 거절하고, 이 앱 화면·주소창·헤더 없는 도구는 통과시킨다", () => {
    for (const path of ["/api/backup", "/api/export/all", "/api/books/lookup", "/api/backup/snapshots/x.db"]) {
      for (const method of ["GET", "POST"]) {
        expect(isBlockedCrossSiteRequest(method, path, "cross-site")).toBe(true);
        expect(isBlockedCrossSiteRequest(method, path, "Same-Site")).toBe(true);
        expect(isBlockedCrossSiteRequest(method, path, "same-origin")).toBe(false);
        expect(isBlockedCrossSiteRequest(method, path, "none")).toBe(false);
        expect(isBlockedCrossSiteRequest(method, path, null)).toBe(false);
      }
    }
  });

  it("화면 주소는 다른 사이트의 쓰기 요청(서버 액션 폼 제출)만 거절하고, 링크로 여는 것은 둔다", () => {
    for (const path of ["/", "/items/1", "/settings", "/trash"]) {
      expect(isBlockedCrossSiteRequest("POST", path, "cross-site")).toBe(true);
      expect(isBlockedCrossSiteRequest("post", path, "same-site")).toBe(true);
      expect(isBlockedCrossSiteRequest("PUT", path, "cross-site")).toBe(true);
      expect(isBlockedCrossSiteRequest("GET", path, "cross-site")).toBe(false);
      expect(isBlockedCrossSiteRequest("HEAD", path, "cross-site")).toBe(false);
      expect(isBlockedCrossSiteRequest("POST", path, "same-origin")).toBe(false);
      expect(isBlockedCrossSiteRequest("POST", path, null)).toBe(false);
    }
  });

  it("가져오기 API는 여기서 다루지 않는다(자체 Origin·토큰 검사)", () => {
    expect(isBlockedCrossSiteRequest("POST", "/api/import/prices", "cross-site")).toBe(false);
    expect(isBlockedCrossSiteRequest("GET", "/api/import/items", "cross-site")).toBe(false);
    expect(isBlockedCrossSiteRequest("GET", "/apix/backup", "cross-site")).toBe(false);
  });
});
