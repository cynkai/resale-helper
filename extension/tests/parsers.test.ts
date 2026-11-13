import { describe, expect, it } from "vitest";
import { extract, parsers } from "../src/parsers";
import { statusFromAvailability, wonFromOfferPrice } from "../src/parsers/common";
import { buildDraft, toRecord } from "../src/suggest";

// 픽스처는 모두 직접 만든 최소 HTML이다. 실제 게시물을 저장한 것이 아니며 가상의 값만 들어 있다.
function page(html: string): Document {
  return new DOMParser().parseFromString(`<!doctype html><html><head>${html}</head><body><h1>가상 매물</h1></body></html>`, "text/html");
}
const ld = (obj: unknown) => `<script type="application/ld+json">${JSON.stringify(obj)}</script>`;
const product = (offers: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  "@context": "https://schema.org",
  "@type": "Product",
  name: "가상 헤드폰 X1",
  description: "픽스처용 가상 설명",
  offers: { "@type": "Offer", priceCurrency: "KRW", ...offers, seller: { "@type": "Person", name: "가상판매자" } },
  ...extra,
});

const DAANGN = "https://www.daangn.com/kr/buy-sell/%EA%B0%80%EC%83%81-x1-ab1cdefghijk/?in=test&utm_source=x#top";
const JOONGNA = "https://web.joongna.com/product/123456789#popup-1";
const BUNJANG = "https://m.bunjang.co.kr/products/987654321?ref_source=test";

describe("매물 상세 페이지만 읽는다", () => {
  it("목록·검색 결과·다른 사이트는 지원하지 않는 페이지로 처리한다", () => {
    for (const href of [
      "https://www.daangn.com/kr/buy-sell/",
      "https://www.daangn.com/kr/search/buy-sell/?q=x",
      "https://web.joongna.com/search/x",
      "https://m.bunjang.co.kr/search/products?q=x",
      "not a url",
    ]) {
      const r = extract(page(ld(product({ price: 1000, availability: "https://schema.org/InStock" }))), href);
      expect(r.supported, href).toBe(false);
    }
  });
});

describe("그 밖의 사이트(일반 상품 정보)", () => {
  const OTHER = "https://www.used.example/goods/77?utm_source=x#a";
  it("상품 정보가 하나면 읽되, 출처 이름은 호스트 이름을 제안하고 확인 안내를 붙인다", () => {
    const r = extract(page(ld(product({ price: 12000, availability: "https://schema.org/InStock" }))), OTHER);
    if (!r.supported) throw new Error("unsupported");
    expect(r.clip).toMatchObject({ sourceName: "used.example", url: "https://www.used.example/goods/77", externalId: null, title: "가상 헤드폰 X1", price: 12000, status: "ON_SALE" });
    expect(r.clip.problems[0]).toMatch(/전용 지원 사이트가 아니라/);
    expect(JSON.stringify(r.clip)).not.toContain("가상판매자");
  });
  it("전용 사이트와 이름이 비슷한 다른 도메인은 그 사이트 이름을 쓰지 않는다", () => {
    const r = extract(page(ld(product({ price: 1000, availability: "https://schema.org/InStock" }))), "https://web.joongna.com.evil.example/product/1");
    expect(r.supported && r.clip.sourceName).toBe("web.joongna.com.evil.example");
  });
  it("상품 정보가 없거나 여러 개거나, 가격·상태를 모두 못 읽으면 지원하지 않는 페이지로 처리한다", () => {
    expect(extract(page(""), OTHER).supported).toBe(false);
    const two = ld(product({ price: 1000 })) + ld(product({ price: 2000 }));
    expect(extract(page(two), OTHER).supported).toBe(false);
    expect(extract(page(ld(product({ price: 1000, priceCurrency: "USD" }))), OTHER).supported).toBe(false);
  });
  it("원화가 아니면 가격을 채우지 않는다", () => {
    const r = extract(page(ld(product({ price: 1000, priceCurrency: "USD", availability: "https://schema.org/InStock" }))), OTHER);
    expect(r.supported && r.clip.price).toBeNull();
  });
  it("전용 사이트의 목록·검색 페이지는 일반 상품 정보로도 읽지 않는다", () => {
    const r = extract(page(ld(product({ price: 1000, availability: "https://schema.org/InStock" }))), "https://www.daangn.com/kr/buy-sell/");
    expect(r.supported).toBe(false);
  });
});

describe("당근", () => {
  it("가격·제목·매물 번호·판매 상태를 읽고, URL에서 추적 파라미터와 해시를 뗀다", () => {
    const r = extract(page(ld(product({ price: "470000.0", availability: "https://schema.org/InStock" })) + ld({ "@type": "BreadcrumbList" })), DAANGN);
    if (!r.supported) throw new Error("unsupported");
    expect(r.clip).toEqual({
      sourceName: "당근",
      url: "https://www.daangn.com/kr/buy-sell/%EA%B0%80%EC%83%81-x1-ab1cdefghijk/",
      externalId: "ab1cdefghijk",
      title: "가상 헤드폰 X1",
      price: 470000,
      status: "ON_SALE",
      problems: [],
    });
  });
  it("예전 주소(/articles/숫자)도 매물 번호를 읽는다", () => {
    const r = extract(page(ld(product({ price: 5000, availability: "https://schema.org/SoldOut" }))), "https://www.daangn.com/articles/12345");
    expect(r.supported && r.clip.externalId).toBe("12345");
    expect(r.supported && r.clip.status).toBe("SOLD");
  });
});

describe("중고나라", () => {
  it("@graph 안의 상품 정보를 읽는다", () => {
    const r = extract(page(ld({ "@context": "https://schema.org", "@graph": [product({ price: 330000, availability: "https://schema.org/InStock" }, { sku: "x" })] })), JOONGNA);
    if (!r.supported) throw new Error("unsupported");
    expect(r.clip).toMatchObject({ sourceName: "중고나라", url: "https://web.joongna.com/product/123456789", externalId: "123456789", price: 330000, status: "ON_SALE" });
  });
});

describe("번개장터", () => {
  it("URL과 매물 번호만 읽고, 화면 글자에서 가격을 짐작하지 않는다", () => {
    const doc = page("");
    doc.body.innerHTML = "<main><span>40,000원</span><p>18,000원</p><p>판매완료</p></main>";
    const r = extract(doc, BUNJANG);
    if (!r.supported) throw new Error("unsupported");
    expect(r.clip).toMatchObject({ sourceName: "번개장터", url: "https://m.bunjang.co.kr/products/987654321", externalId: "987654321", title: null, price: null, status: null });
    expect(r.clip.problems).toHaveLength(1);
  });
});

describe("읽지 못하면 채우지 않는다", () => {
  it("상품 정보가 없거나, 깨졌거나, 여러 개면 가격·상태를 비우고 이유를 알린다", () => {
    for (const head of [
      "",
      '<script type="application/ld+json">{broken</script>',
      ld(product({ price: 1000, availability: "https://schema.org/InStock" })) + ld(product({ price: 2000, availability: "https://schema.org/InStock" })),
    ]) {
      const r = extract(page(head), JOONGNA);
      if (!r.supported) throw new Error("unsupported");
      expect(r.clip.price).toBeNull();
      expect(r.clip.status).toBeNull();
      expect(r.clip.problems.length).toBeGreaterThan(0);
      expect(r.clip.externalId).toBe("123456789"); // URL에서 얻는 값은 그대로
    }
  });
  it("원화가 아니거나 가격 형식이 이상하면 가격을 비운다", () => {
    const usd = extract(page(ld(product({ price: 30, priceCurrency: "USD", availability: "https://schema.org/InStock" }))), JOONGNA);
    expect(usd.supported && usd.clip.price).toBeNull();
    for (const v of ["1.5만", "12,000", "-1", "0", "100.5", "", null, undefined, {}, 1e20]) expect(wonFromOfferPrice(v), String(v)).toBeNull();
    expect(wonFromOfferPrice("470000.0")).toBe(470000);
    expect(wonFromOfferPrice(330000)).toBe(330000);
  });
  it("판매 상태는 분명한 값만 받는다(예약·알 수 없는 값은 비움)", () => {
    expect(statusFromAvailability("https://schema.org/InStock")).toBe("ON_SALE");
    expect(statusFromAvailability("http://schema.org/OutOfStock")).toBe("SOLD");
    expect(statusFromAvailability("SoldOut")).toBe("SOLD");
    for (const v of ["https://schema.org/LimitedAvailability", "https://schema.org/PreOrder", "판매완료", "", null, 1]) {
      expect(statusFromAvailability(v), String(v)).toBeNull();
    }
  });
  it("여러 offer가 있으면 어느 가격인지 알 수 없으므로 비운다", () => {
    const p = product({});
    (p as { offers: unknown }).offers = [
      { "@type": "Offer", price: 1000, priceCurrency: "KRW" },
      { "@type": "Offer", price: 2000, priceCurrency: "KRW" },
    ];
    const r = extract(page(ld(p)), JOONGNA);
    expect(r.supported && r.clip.price).toBeNull();
  });
});

describe("개인정보를 읽지 않는다", () => {
  it("결과에 판매자 이름·설명이 들어가지 않는다", () => {
    const r = extract(page(ld(product({ price: 1000, availability: "https://schema.org/InStock" }))), DAANGN);
    const text = JSON.stringify(r);
    expect(text).not.toContain("가상판매자");
    expect(text).not.toContain("픽스처용 가상 설명");
    if (r.supported) expect(Object.keys(r.clip).sort()).toEqual(["externalId", "price", "problems", "sourceName", "status", "title", "url"]);
  });
  it("파서는 사이트마다 한 개이고 이름이 겹치지 않는다", () => {
    expect(parsers.map((p) => p.id).sort()).toEqual(["bunjang", "daangn", "joongna"]);
  });
});

describe("미리보기 초기값", () => {
  const TODAY = "2026-11-13";
  it("판매 중 → ASKING, 판매 완료 → SOLD_LISTING을 제안만 하고, 상태 등급은 항상 비워 둔다", () => {
    const on = buildDraft(extract(page(ld(product({ price: 1000, availability: "https://schema.org/InStock" }))), JOONGNA), TODAY);
    expect(on).toMatchObject({ priceType: "ASKING", amount: "1000", condition: "", checkedDate: TODAY, sourceName: "중고나라", memo: "가상 헤드폰 X1" });
    const sold = buildDraft(extract(page(ld(product({ price: 1000, availability: "https://schema.org/SoldOut" }))), JOONGNA), TODAY);
    expect(sold.priceType).toBe("SOLD_LISTING");
  });
  it("판매 상태를 못 읽으면 유형을 비워 사용자가 고르게 한다. 지원하지 않는 페이지는 주소만 넘긴다", () => {
    expect(buildDraft(extract(page(""), BUNJANG), TODAY)).toMatchObject({ priceType: "", amount: "" });
    const other = buildDraft(extract(page(""), "https://example.com/a?b=1"), TODAY);
    expect(other).toMatchObject({ priceType: "", amount: "", sourceName: "", sourceUrl: "https://example.com/a" });
    expect(other.problems).toHaveLength(1);
    // 브라우저 내부 페이지 주소는 원문 URL로 넣지 않는다
    expect(buildDraft({ supported: false, url: "chrome-extension://abc/popup.html" }, TODAY).sourceUrl).toBe("");
    expect(buildDraft({ supported: false, url: "" }, TODAY).sourceUrl).toBe("");
  });
  it("보내는 레코드에는 가격 자료 필드만 있고 VERIFIED_SALE을 만들 길이 없다", () => {
    const rec = toRecord({ priceType: "ASKING", amount: " 1000 ", sourceName: "당근", sourceUrl: "", externalId: "a1", memo: "", condition: "", checkedDate: TODAY });
    expect(rec).toEqual({ price_type: "ASKING", amount: "1000", source_name: "당근", checked_date: TODAY, external_id: "a1" });
  });
});
