// 가격 자료 폼에서 원문 URL을 붙였을 때 출처 이름과 매물 번호를 제안한다(순수 함수, 네트워크 요청 없음).
// 주소 모양만 본다. 규칙은 브라우저 확장의 사이트 파서(extension/src/parsers)와 같게 둔다(테스트로 확인).
// 제안일 뿐이며, 빈 칸에만 채우고 사용자가 확인·수정한다.

export type UrlSuggestion = { sourceName: string; externalId: string | null };

type Rule = { sourceName: string; host: RegExp; ids: RegExp[] };

const RULES: Rule[] = [
  { sourceName: "당근", host: /^(www\.)?daangn\.com$/, ids: [/^\/kr\/buy-sell\/[^/]+-([a-z0-9]{6,})\/?$/, /^\/articles\/(\d+)\/?$/] },
  { sourceName: "번개장터", host: /^(m\.|www\.)?bunjang\.co\.kr$/, ids: [/^\/products\/(\d+)\/?$/] },
  { sourceName: "중고나라", host: /^web\.joongna\.com$/, ids: [/^\/product\/(\d+)\/?$/] },
];

/**
 * http(s) 주소가 아니면 null. 아는 사이트의 매물 주소면 사이트 이름과 매물 번호,
 * 그 밖의 주소면 호스트 이름(www. 뺌)만 제안한다(매물 번호는 짐작하지 않는다).
 */
export function suggestFromUrl(raw: string): UrlSuggestion | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const host = url.hostname.toLowerCase();
  if (host === "") return null;
  for (const r of RULES) {
    if (!r.host.test(host)) continue;
    for (const re of r.ids) {
      // 한글 제목이 들어간 당근 주소는 퍼센트 인코딩된 채로 비교한다(번호 부분은 영문·숫자).
      const m = re.exec(url.pathname);
      if (m) return { sourceName: r.sourceName, externalId: m[1]! };
    }
    return { sourceName: r.sourceName, externalId: null };
  }
  return { sourceName: host.replace(/^www\./, ""), externalId: null };
}
