// 응답 보안 헤더. 로컬 전용 앱이지만, 브라우저 안에서는 다른 웹사이트와 같은 창에 있으므로
// 끼워 넣기(frame)·스크립트 주입·주소 유출을 헤더로 한 번 더 막는다.

/** 페이지마다 새로 만드는 nonce로만 스크립트를 허용한다. dev에서는 React 디버깅용 eval만 추가로 허용한다. */
export function contentSecurityPolicy(nonce: string, isDev: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // Next.js가 인라인 스타일을 넣는다. 스타일은 스크립트를 실행하지 못한다.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self'${isDev ? " ws://127.0.0.1:* ws://localhost:*" : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/** CSP 외의 고정 헤더 */
export const STATIC_SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  // 원문 URL을 눌러 매물 사이트로 나갈 때 이 앱의 주소(물건 번호 등)를 넘기지 않는다.
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Opener-Policy": "same-origin",
  // 다른 웹사이트가 <img>·<script> 같은 태그로 이 앱의 응답(백업 파일, 내보내기 등)을 끌어다 쓰지 못하게 한다.
  // 본문은 원래도 동일 출처 정책으로 읽을 수 없지만, 브라우저가 응답 자체를 넘겨주지 않게 해 부채널을 한 번 더 막는다.
  // 확장의 가져오기 요청은 CORS 요청이라 영향을 받지 않는다.
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
};

/**
 * 다른 웹사이트에서 온 API 요청인지(브라우저가 붙이는 Sec-Fetch-Site 헤더로 판단).
 * 내가 방문한 사이트가 <img>·<script>·form으로 내보내기·백업·서지정보 조회 같은 API를 부르게 해도 서버가 일하지 않게 한다.
 * - 이 앱 화면에서 누른 링크·요청은 same-origin, 주소창에 직접 친 주소는 none이라 통과한다.
 * - 헤더를 보내지 않는 브라우저·로컬 도구(curl 등)는 막지 않는다(명시적으로 다른 사이트라고 할 때만 막는다).
 * - 가져오기 API(/api/import/)는 확장·로컬 도구가 쓰는 길이라 여기서 다루지 않고 자체 검사(Origin·토큰)를 거친다.
 */
export function isCrossSiteApiRequest(pathname: string, secFetchSite: string | null): boolean {
  if (!pathname.startsWith("/api/") || pathname.startsWith("/api/import/")) return false;
  const site = (secFetchSite ?? "").trim().toLowerCase();
  return site === "cross-site" || site === "same-site";
}
