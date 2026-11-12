// 중고나라 매물 상세. 2026-11-13에 상세 페이지 한 건을 열어 JSON-LD(@graph 안의 Product)가 있는 것을 확인했다.
// 판매 완료 매물에서 availability가 어떤 값으로 나오는지는 확인하지 못했다. 읽지 못하면 사용자가 직접 고른다.

import { cleanUrl, readProduct } from "./common";
import type { Parser } from "./types";

const PATH = /^\/product\/(\d+)\/?$/;

export const joongna: Parser = {
  id: "joongna",
  sourceName: "중고나라",
  matches: (url) => url.hostname === "web.joongna.com" && PATH.test(url.pathname),
  parse(doc, url) {
    return readProduct(doc, { sourceName: this.sourceName, url: cleanUrl(url), externalId: PATH.exec(url.pathname)?.[1] ?? null });
  },
};
