// 로컬 개인용 앱이므로 localhost로 들어온 요청만 받는다.
// 인증이 없는 앱을 DNS 리바인딩으로 외부 웹페이지가 읽거나 조작하는 것을 막기 위한 장치다.

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Host 헤더(예: "127.0.0.1:3000")가 루프백 주소인지 확인한다. 포트는 따지지 않는다. */
export function isLoopbackHost(hostHeader: string | null | undefined): boolean {
  if (!hostHeader) return false;
  const h = hostHeader.trim().toLowerCase();
  // "이름" 또는 "이름:포트" 형태만 받는다. IPv6는 "[::1]:3000"처럼 대괄호로 감싼다.
  const m = /^(\[[0-9a-f:.]+\]|[^:[\]]+)(?::\d{1,5})?$/.exec(h);
  if (!m) return false;
  const name = m[1]!;
  if (LOOPBACK.has(name)) return true;
  return name.endsWith(".localhost") && /^[a-z0-9.-]+$/.test(name);
}
