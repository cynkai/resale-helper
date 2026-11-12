// 사이트 공통 도우미. 페이지가 스스로 공개한 구조화 정보(schema.org JSON-LD의 Product)만 읽는다.
// 화면 글자를 훑어 가격을 짐작하지 않는다(추천 매물의 가격을 잘못 집을 수 있다).

import type { ClipResult, ListingStatus } from "./types";

type Json = Record<string, unknown>;

function isObj(v: unknown): v is Json {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function typeIs(v: Json, name: string): boolean {
  const t = v["@type"];
  return t === name || (Array.isArray(t) && t.includes(name));
}

/** 문서의 JSON-LD에서 Product 노드를 찾는다(최상위, 배열, @graph 안). 해석할 수 없는 스크립트는 건너뛴다. */
export function findProducts(doc: Document): Json[] {
  const out: Json[] = [];
  const visit = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(visit);
    else if (isObj(v)) {
      if (typeIs(v, "Product")) out.push(v);
      if (Array.isArray(v["@graph"])) v["@graph"].forEach(visit);
    }
  };
  for (const s of Array.from(doc.querySelectorAll('script[type="application/ld+json"]'))) {
    try {
      visit(JSON.parse(s.textContent ?? ""));
    } catch {
      // 깨진 JSON-LD는 무시한다.
    }
  }
  return out;
}

function firstOffer(product: Json): Json | null {
  const o = product["offers"];
  if (isObj(o)) return o;
  if (Array.isArray(o) && o.length === 1 && isObj(o[0])) return o[0];
  return null; // 여러 offer가 있으면 어느 것이 이 매물 가격인지 알 수 없다.
}

/** 330000, "330000", "470000.0" → 정수 원. 그 밖(음수, 소수점 이하 값, 문자 섞임)은 null. */
export function wonFromOfferPrice(v: unknown): number | null {
  const s = typeof v === "number" ? String(v) : typeof v === "string" ? v.trim() : "";
  const m = /^(\d{1,12})(?:\.0+)?$/.exec(s);
  if (!m) return null;
  const n = Number(m[1]);
  return n > 0 ? n : null;
}

/** schema.org availability → 판매 상태. 판매 중/판매 완료로 분명히 읽히는 값만 받는다. */
export function statusFromAvailability(v: unknown): ListingStatus | null {
  if (typeof v !== "string") return null;
  const key = v.replace(/^https?:\/\/schema\.org\//i, "").toLowerCase();
  if (key === "instock") return "ON_SALE";
  if (key === "soldout" || key === "outofstock") return "SOLD";
  return null;
}

/** 저장할 URL: 프로토콜·호스트·경로만 남긴다(추적 파라미터와 해시 제거). */
export function cleanUrl(url: URL): string {
  return `${url.protocol}//${url.host}${url.pathname}`;
}

/** JSON-LD Product 하나에서 제목·가격·상태를 읽는다. seller 등 다른 항목은 건드리지 않는다. */
export function readProduct(doc: Document, base: Pick<ClipResult, "sourceName" | "url" | "externalId">): ClipResult {
  const result: ClipResult = { ...base, title: null, price: null, status: null, problems: [] };
  const products = findProducts(doc);
  if (products.length !== 1) {
    result.problems.push(
      products.length === 0
        ? "이 페이지에서 상품 정보를 찾지 못했습니다. 가격과 판매 상태를 직접 입력해 주세요."
        : "상품 정보가 여러 개라 어느 것이 이 매물인지 알 수 없습니다. 가격과 판매 상태를 직접 입력해 주세요.",
    );
    return result;
  }
  const product = products[0]!;
  const name = product["name"];
  if (typeof name === "string" && name.trim() !== "") result.title = name.trim().slice(0, 200);

  const offer = firstOffer(product);
  const currency = offer?.["priceCurrency"];
  if (!offer) result.problems.push("가격 정보를 찾지 못했습니다. 직접 입력해 주세요.");
  else if (currency !== "KRW") result.problems.push("원화 가격이 아니거나 통화를 알 수 없습니다. 직접 입력해 주세요.");
  else {
    result.price = wonFromOfferPrice(offer["price"]);
    if (result.price === null) result.problems.push("가격을 읽지 못했습니다. 직접 입력해 주세요.");
  }
  result.status = offer ? statusFromAvailability(offer["availability"]) : null;
  if (result.status === null) result.problems.push("판매 상태를 읽지 못했습니다. 페이지를 보고 유형을 직접 골라 주세요.");
  return result;
}
