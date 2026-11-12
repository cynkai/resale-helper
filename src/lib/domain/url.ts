// 원문 URL 검증·정규화. 중복 매물 판별에만 사용하며, 서버가 이 URL을 요청하는 일은 없다.

const TRACKING_PARAMS = /^(utm_.+|fbclid|gclid|ref|ref_|spm|share|from)$/i;

/** http(s) URL만 허용하고, 추적 파라미터·해시·끝 슬래시를 제거해 비교용 문자열을 만든다. */
export function normalizeUrl(raw: string): { ok: true; url: string; normalized: string } | { ok: false; error: string } {
  const s = raw.trim();
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return { ok: false, error: "URL 형식이 올바르지 않습니다. https:// 로 시작하는 주소를 넣어 주세요." };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { ok: false, error: "http 또는 https 주소만 입력할 수 있습니다." };
  }
  if (u.username || u.password) return { ok: false, error: "계정 정보가 포함된 URL은 저장할 수 없습니다." };
  const params = [...u.searchParams.entries()].filter(([k]) => !TRACKING_PARAMS.test(k));
  params.sort(([a], [b]) => a.localeCompare(b));
  const query = params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
  const host = u.hostname.toLowerCase().replace(/^www\./, "").replace(/^m\./, "");
  const path = u.pathname.replace(/\/+$/, "");
  return { ok: true, url: s, normalized: `${host}${path}${query ? `?${query}` : ""}` };
}
