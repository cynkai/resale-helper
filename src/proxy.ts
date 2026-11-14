import { NextResponse, type NextRequest } from "next/server";
import { isLoopbackHost } from "@/lib/host";
import { contentSecurityPolicy, STATIC_SECURITY_HEADERS } from "@/lib/security-headers";

// 모든 요청에서 Host 헤더를 확인한다. 이 앱은 127.0.0.1에만 열리지만,
// 외부 도메인을 127.0.0.1로 다시 가리키는 DNS 리바인딩 공격은 Host 헤더로만 구별할 수 있다.
// 통과한 요청에는 보안 헤더(CSP 등)를 붙인다.
export function proxy(request: NextRequest) {
  if (!isLoopbackHost(request.headers.get("host"))) {
    return new NextResponse("이 앱은 localhost에서만 사용할 수 있습니다.", {
      status: 403,
      headers: { "Content-Type": "text/plain; charset=utf-8", ...STATIC_SECURITY_HEADERS },
    });
  }
  const nonce = btoa(crypto.randomUUID());
  const csp = contentSecurityPolicy(nonce, process.env.NODE_ENV === "development");
  // Next.js는 요청 헤더의 CSP에서 nonce를 읽어 자신이 넣는 스크립트에 붙인다.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  for (const [k, v] of Object.entries(STATIC_SECURITY_HEADERS)) response.headers.set(k, v);
  return response;
}
