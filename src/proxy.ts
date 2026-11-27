import { NextResponse, type NextRequest } from "next/server";
import { isLoopbackHost } from "@/lib/host";
import { contentSecurityPolicy, isBlockedCrossSiteRequest, STATIC_SECURITY_HEADERS } from "@/lib/security-headers";

// 모든 요청에서 Host 헤더를 확인한다. 이 앱은 127.0.0.1에만 열리지만,
// 외부 도메인을 127.0.0.1로 다시 가리키는 DNS 리바인딩 공격은 Host 헤더로만 구별할 수 있다.
// 다른 웹사이트에서 온 API 요청과 쓰기 요청(Sec-Fetch-Site)도 여기서 거절한다(가져오기 API는 자체 검사).
// 통과한 요청에는 보안 헤더(CSP 등)를 붙인다.
export function proxy(request: NextRequest) {
  if (!isLoopbackHost(request.headers.get("host"))) {
    return new NextResponse("이 앱은 localhost에서만 사용할 수 있습니다.", {
      status: 403,
      headers: { "Content-Type": "text/plain; charset=utf-8", ...STATIC_SECURITY_HEADERS },
    });
  }
  if (isBlockedCrossSiteRequest(request.method, request.nextUrl.pathname, request.headers.get("sec-fetch-site"))) {
    return new NextResponse("다른 웹사이트에서 온 요청은 받지 않습니다.", {
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
