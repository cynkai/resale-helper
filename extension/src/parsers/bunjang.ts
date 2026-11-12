// 번개장터 매물 상세. 2026-11-13에 상세 페이지 한 건을 열어 보니 상품 JSON-LD가 없고,
// 가격·제목에 안정적인 표식(id, data 속성)도 없었다. 화면 글자에서 가격을 짐작하면 추천 매물의
// 가격을 집을 수 있어, 이 파서는 URL과 매물 번호만 읽고 나머지는 직접 입력하게 한다.

import { cleanUrl } from "./common";
import type { Parser } from "./types";

const PATH = /^\/products\/(\d+)\/?$/;

export const bunjang: Parser = {
  id: "bunjang",
  sourceName: "번개장터",
  matches: (url) => /^(m\.|www\.)?bunjang\.co\.kr$/.test(url.hostname) && PATH.test(url.pathname),
  parse(_doc, url) {
    return {
      sourceName: this.sourceName,
      url: cleanUrl(url),
      externalId: PATH.exec(url.pathname)?.[1] ?? null,
      title: null,
      price: null,
      status: null,
      problems: ["번개장터는 가격과 판매 상태를 자동으로 읽지 못합니다. 페이지를 보고 직접 입력해 주세요."],
    };
  },
};
