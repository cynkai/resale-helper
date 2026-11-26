import { describe, expect, it } from "vitest";
import { extract } from "../src/parsers";
import { buildDraft, toRecord } from "../src/suggest";

const CURRENT = "https://web.joongna.com/product/123456789";

// Synthetic data only; each page exposes exactly one Product.
function listing(productUrl?: unknown, offerUrl?: unknown): Document {
  const doc = new DOMParser().parseFromString("<!doctype html><html><head></head><body></body></html>", "text/html");
  const script = doc.createElement("script");
  script.type = "application/ld+json";
  script.textContent = JSON.stringify({
    "@type": "Product", name: "가상 헤드폰", url: productUrl,
    offers: { "@type": "Offer", url: offerUrl, price: 470000, priceCurrency: "KRW", availability: "https://schema.org/InStock" },
  });
  doc.head.append(script);
  return doc;
}

describe("구조화 상품 정보의 매물 주소", () => {
  it.each([
    ["상품 URL", "/product/999", undefined],
    ["판매 제안 URL", undefined, "/product/999"],
    ["다른 출처", "https://used.example/product/123456789", undefined],
    ["잘못된 URL", "http://[", undefined],
    ["문자열이 아닌 URL", { "@id": "/product/999" }, undefined],
  ])("현재 매물과 확인할 수 없는 %s는 미리보기에 채우지 않는다", (_name, productUrl, offerUrl) => {
    // Given
    const doc = listing(productUrl, offerUrl);
    // When
    const draft = buildDraft(extract(doc, CURRENT), "2026-11-24");
    // Then: values belonging to another listing cannot become the current record.
    expect(draft).toMatchObject({ amount: "", priceType: "", memo: "", sourceUrl: CURRENT, externalId: "123456789" });
    expect(draft.problems.length).toBeGreaterThan(0);
  });

  it.each([
    ["주소 없음", undefined, undefined],
    ["같은 절대 주소", CURRENT, CURRENT],
    ["같은 상대 주소", "/product/123456789", "/product/123456789"],
    ["추적값·해시·끝 슬래시", `${CURRENT}/?utm_source=fixture#product`, `${CURRENT}#offer`],
  ])("%s인 상품은 기존 가격과 유형을 제안한다", (_name, productUrl, offerUrl) => {
    // Given
    const doc = listing(productUrl, offerUrl);
    // When
    const draft = buildDraft(extract(doc, CURRENT), "2026-11-24");
    // Then
    expect(draft).toMatchObject({ amount: "470000", priceType: "ASKING", memo: "가상 헤드폰", sourceUrl: CURRENT });
    expect(draft.problems).toEqual([]);
  });

  it("일반 사이트에서도 다른 상품의 가격을 현재 URL에 연결하지 않는다", () => {
    // Given
    const doc = listing("https://used.example/goods/other");
    // When
    const draft = buildDraft(extract(doc, "https://used.example/goods/current"), "2026-11-24");
    // Then
    expect(draft).toMatchObject({ amount: "", priceType: "", memo: "", sourceUrl: "https://used.example/goods/current" });
  });
});

describe("일반 사이트의 쿼리 매물 번호", () => {
  it.each([
    ["다른 번호", "?id=42", "/item?id=99", undefined],
    ["같은 번호", "?id=42", "/item?id=42", undefined],
    ["알 수 없는 값", "?token=synthetic-private", undefined, undefined],
    ["알 수 없는 키", "?b=1", undefined, undefined],
    ["추적값과 번호", "?utm_source=test&id=42", undefined, undefined],
    ["상품 주소에만 번호", "", "/item?id=99", undefined],
    ["제안 주소에만 번호", "", undefined, "/item?id=99"],
  ])("%s는 비공개 쿼리나 공통 경로를 저장 주소로 제안하지 않는다", (_name, query, productUrl, offerUrl) => {
    // Given
    const doc = listing(productUrl, offerUrl);
    // When
    const draft = buildDraft(extract(doc, `https://used.example/item${query}`), "2026-11-24");
    // Then
    expect(draft).toMatchObject({ amount: "", priceType: "", memo: "", sourceUrl: "", externalId: "" });
    expect(toRecord(draft)).not.toHaveProperty("source_url");
    expect(draft.problems.length).toBeGreaterThan(0);
    expect(JSON.stringify(draft)).not.toContain("synthetic-private");
  });

  it("상품 정보가 없어도 쿼리 번호를 지운 공통 경로를 제안하지 않는다", () => {
    // Given
    const doc = new DOMParser().parseFromString("<html></html>", "text/html");
    // When
    const result = extract(doc, "https://used.example/item?id=42");
    expect(result.supported).toBe(false);
    const draft = buildDraft(result, "2026-11-24");
    // Then
    expect(draft.sourceUrl).toBe("");
  });

  it("경로가 매물을 구분하고 알려진 추적값만 있으면 안전한 주소와 가격을 제안한다", () => {
    // Given
    const doc = listing("/item/42?utm_campaign=fixture#product", "/item/42?gclid=fixture");
    // When
    const draft = buildDraft(extract(doc, "https://used.example/item/42?utm_source=fixture#private"), "2026-11-24");
    // Then
    expect(draft).toMatchObject({ amount: "470000", priceType: "ASKING", sourceUrl: "https://used.example/item/42" });
  });

  it.each([
    ["?id=42&token=synthetic-private", ""],
    ["?utm_source=synthetic-private#private", "https://used.example/item/42"],
  ])("읽기 실패 후 원본 탭 주소 %s도 미리보기에 그대로 넣지 않는다", (query, sourceUrl) => {
    // Given: readActiveTab may return the raw tab URL after an injection failure.
    const result = { supported: false, url: `https://used.example/item/42${query}` } as const;
    // When
    const draft = buildDraft(result, "2026-11-24");
    // Then
    expect(draft.sourceUrl).toBe(sourceUrl);
    expect(JSON.stringify(draft)).not.toContain("synthetic-private");
  });
});
