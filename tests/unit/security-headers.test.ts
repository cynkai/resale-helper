import { describe, expect, it } from "vitest";
import { STATIC_SECURITY_HEADERS } from "@/lib/security-headers";

describe("고정 보안 헤더", () => {
  it("다른 사이트가 응답을 태그로 끌어다 쓰지 못하게 CORP를 same-origin으로 둔다", () => {
    expect(STATIC_SECURITY_HEADERS["Cross-Origin-Resource-Policy"]).toBe("same-origin");
    expect(STATIC_SECURITY_HEADERS["Cross-Origin-Opener-Policy"]).toBe("same-origin");
  });
});
