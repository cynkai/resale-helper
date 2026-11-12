import { bunjang } from "./bunjang";
import { daangn } from "./daangn";
import { joongna } from "./joongna";
import type { ClipResult, Parser } from "./types";

export const parsers: Parser[] = [daangn, bunjang, joongna];

export type ExtractResult =
  | { supported: true; clip: ClipResult }
  /** 지원하는 사이트의 매물 상세 페이지가 아니다. 주소만 넘기고 나머지는 사용자가 입력한다. */
  | { supported: false; url: string };

/** 현재 문서 한 건을 읽는다. 파서가 예외를 던지면 읽기 실패로 처리하고 값은 채우지 않는다. */
export function extract(doc: Document, href: string): ExtractResult {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return { supported: false, url: href };
  }
  const parser = parsers.find((p) => p.matches(url));
  if (!parser) return { supported: false, url: `${url.protocol}//${url.host}${url.pathname}` };
  try {
    return { supported: true, clip: parser.parse(doc, url) };
  } catch {
    return {
      supported: true,
      clip: {
        sourceName: parser.sourceName,
        url: `${url.protocol}//${url.host}${url.pathname}`,
        externalId: null,
        title: null,
        price: null,
        status: null,
        problems: ["이 페이지를 읽지 못했습니다(사이트 구조가 바뀌었을 수 있습니다). 직접 입력해 주세요."],
      },
    };
  }
}
