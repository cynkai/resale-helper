// 미리보기 초기값 만들기(순수 함수). 유형은 제안일 뿐이고 저장 전에 사용자가 확인하고 고른다.

import type { ExtractResult } from "./parsers";

export const CLIP_PRICE_TYPES = ["ASKING", "SOLD_LISTING"] as const;
export type ClipPriceType = (typeof CLIP_PRICE_TYPES)[number];

export type PreviewDraft = {
  /** 제안 유형. 판매 상태를 읽지 못했으면 ""(사용자가 반드시 골라야 저장된다). */
  priceType: ClipPriceType | "";
  amount: string;
  sourceName: string;
  sourceUrl: string;
  externalId: string;
  memo: string;
  /** 상태 등급은 추정하지 않는다. 항상 빈칸에서 시작한다. */
  condition: "";
  checkedDate: string;
  problems: string[];
};

export function buildDraft(r: ExtractResult, today: string): PreviewDraft {
  if (!r.supported) {
    return {
      priceType: "",
      amount: "",
      sourceName: "",
      // 브라우저 내부 페이지(chrome:// 등)의 주소는 원문 URL이 될 수 없으므로 넣지 않는다.
      sourceUrl: /^https?:\/\//i.test(r.url) ? r.url : "",
      externalId: "",
      memo: "",
      condition: "",
      checkedDate: today,
      problems: ["이 페이지에서 매물 정보를 읽지 못했습니다(당근·번개장터·중고나라는 매물 한 건 페이지, 그 밖의 사이트는 상품 정보를 공개한 페이지만 읽습니다). 값을 직접 입력해 주세요."],
    };
  }
  const c = r.clip;
  return {
    priceType: c.status === "ON_SALE" ? "ASKING" : c.status === "SOLD" ? "SOLD_LISTING" : "",
    amount: c.price === null ? "" : String(c.price),
    sourceName: c.sourceName,
    sourceUrl: c.url,
    externalId: c.externalId ?? "",
    memo: c.title ?? "",
    condition: "",
    checkedDate: today,
    problems: c.problems,
  };
}

/** 가져오기 API에 보낼 레코드. 빈 값은 보내지 않는다. 판매자 정보 칸은 없다. */
export function toRecord(d: {
  priceType: string;
  amount: string;
  sourceName: string;
  sourceUrl: string;
  externalId: string;
  memo: string;
  condition: string;
  checkedDate: string;
}): Record<string, string> {
  const rec: Record<string, string> = {
    price_type: d.priceType,
    amount: d.amount.trim(),
    source_name: d.sourceName.trim(),
    checked_date: d.checkedDate,
  };
  if (d.sourceUrl.trim()) rec.source_url = d.sourceUrl.trim();
  if (d.externalId.trim()) rec.external_id = d.externalId.trim();
  if (d.condition) rec.condition = d.condition;
  if (d.memo.trim()) rec.memo = d.memo.trim();
  return rec;
}
