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
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
};
