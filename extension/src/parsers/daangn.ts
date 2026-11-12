// 당근 중고거래 매물 상세. 2026-11-13에 상세 페이지 한 건을 열어 JSON-LD Product가 있는 것을 확인했다.
// 사이트 구조가 바뀌면 읽지 못할 수 있고, 그때는 직접 입력으로 넘어간다.

import { cleanUrl, readProduct } from "./common";
import type { Parser } from "./types";

// /kr/buy-sell/<제목>-<매물 번호>/ 또는 예전 주소 /articles/<숫자>
const NEW_PATH = /^\/kr\/buy-sell\/[^/]+-([a-z0-9]{6,})\/?$/;
const OLD_PATH = /^\/articles\/(\d+)\/?$/;

export const daangn: Parser = {
  id: "daangn",
  sourceName: "당근",
  matches: (url) => /^(www\.)?daangn\.com$/.test(url.hostname) && (NEW_PATH.test(url.pathname) || OLD_PATH.test(url.pathname)),
  parse(doc, url) {
    const id = NEW_PATH.exec(url.pathname)?.[1] ?? OLD_PATH.exec(url.pathname)?.[1] ?? null;
    return readProduct(doc, { sourceName: this.sourceName, url: cleanUrl(url), externalId: id });
  },
};
