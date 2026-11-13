// 그 밖의 사이트. 당근·번개장터·중고나라 전용 파서가 없는 페이지에서, 페이지가 스스로 공개한
// schema.org Product 정보가 딱 하나 있을 때만 읽는다. 화면 글자에서 가격을 짐작하지 않는다.
// 어떤 사이트인지 모르므로 출처 이름은 호스트 이름을 제안만 하고, 사용자가 확인·수정한다.

import { cleanUrl, findProducts, readProduct } from "./common";
import type { ClipResult } from "./types";

/** 전용 파서가 있는 사이트. 이 사이트들은 전용 파서의 규칙(매물 상세 주소만)을 따르고 여기로 오지 않는다. */
const KNOWN_HOSTS = /(^|\.)(daangn\.com|bunjang\.co\.kr|joongna\.com)$/;

export const GENERIC_NOTE =
  "전용 지원 사이트가 아니라 페이지의 상품 정보(schema.org)로 읽었습니다. 중고 매물 한 건이 맞는지, 출처 이름이 맞는지 확인해 주세요.";

/** 읽을 수 있으면 ClipResult, 아니면 null(지원하지 않는 페이지로 처리). */
export function readGeneric(doc: Document, url: URL): ClipResult | null {
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (KNOWN_HOSTS.test(url.hostname)) return null;
  if (findProducts(doc).length !== 1) return null;
  const clip = readProduct(doc, { sourceName: url.hostname.replace(/^www\./, ""), url: cleanUrl(url), externalId: null });
  // 가격도 상태도 못 읽으면 일반 상품 페이지로 볼 근거가 약하다.
  if (clip.price === null && clip.status === null) return null;
  return { ...clip, problems: [GENERIC_NOTE, ...clip.problems] };
}
