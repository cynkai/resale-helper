import { describe, expect, it } from "vitest";
import { suggestFromUrl } from "@/lib/domain/url-suggest";
import { bunjang } from "../../extension/src/parsers/bunjang";
import { daangn } from "../../extension/src/parsers/daangn";
import { joongna } from "../../extension/src/parsers/joongna";

describe("원문 URL에서 출처 이름·매물 번호 제안", () => {
  it("아는 사이트의 매물 주소는 사이트 이름과 매물 번호", () => {
    expect(suggestFromUrl("https://www.daangn.com/kr/buy-sell/%EC%B1%85-abc123xyz/")).toEqual({ sourceName: "당근", externalId: "abc123xyz" });
    expect(suggestFromUrl("https://www.daangn.com/articles/123456789")).toEqual({ sourceName: "당근", externalId: "123456789" });
    expect(suggestFromUrl("https://m.bunjang.co.kr/products/987654?ref=x")).toEqual({ sourceName: "번개장터", externalId: "987654" });
    expect(suggestFromUrl("https://web.joongna.com/product/555")).toEqual({ sourceName: "중고나라", externalId: "555" });
  });

  it("아는 사이트라도 매물 주소가 아니면 이름만, 그 밖의 사이트는 호스트 이름만(번호는 짐작하지 않음)", () => {
    expect(suggestFromUrl("https://www.daangn.com/kr/")).toEqual({ sourceName: "당근", externalId: null });
    expect(suggestFromUrl("https://www.Example.com/item/77")).toEqual({ sourceName: "example.com", externalId: null });
    expect(suggestFromUrl("http://shop.example.kr/p?id=1")).toEqual({ sourceName: "shop.example.kr", externalId: null });
  });

  it("주소가 아니거나 http(s)가 아니면 제안하지 않는다", () => {
    for (const bad of ["", "abc", "chrome://extensions", "javascript:alert(1)", "ftp://x.com/a", "file:///etc/passwd"]) expect(suggestFromUrl(bad)).toBeNull();
  });

  it("확장의 사이트 파서와 같은 주소를 같은 매물 번호로 읽는다", () => {
    const samples = [
      "https://www.daangn.com/kr/buy-sell/%EC%B1%85-abc123xyz/",
      "https://daangn.com/articles/42",
      "https://www.daangn.com/kr/",
      "https://m.bunjang.co.kr/products/987654",
      "https://www.bunjang.co.kr/search",
      "https://web.joongna.com/product/555",
      "https://web.joongna.com/search",
    ];
    for (const href of samples) {
      const url = new URL(href);
      const parser = [daangn, bunjang, joongna].find((p) => p.matches(url));
      const s = suggestFromUrl(href)!;
      if (parser) {
        expect(s.sourceName).toBe(parser.sourceName);
        expect(s.externalId).not.toBeNull();
      } else {
        expect(s.externalId).toBeNull();
      }
    }
  });
});
