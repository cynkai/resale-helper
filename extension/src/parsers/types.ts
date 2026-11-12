// 파서 공통 타입. 파서는 "지금 열려 있는 문서"만 읽는 순수 함수다. 네트워크 요청을 하지 않는다.
// 판매자 닉네임·프로필·연락처·위치·사진·본문은 읽지 않고, 결과 타입에도 칸이 없다.

export type ListingStatus = "ON_SALE" | "SOLD";

export type ClipResult = {
  /** 사이트 표시 이름. 가격 자료의 출처 이름으로 쓴다. */
  sourceName: string;
  /** 원문 URL(추적 파라미터·해시 제거). */
  url: string;
  /** URL에서 얻은 매물 번호. 못 얻으면 null. */
  externalId: string | null;
  title: string | null;
  /** 원화 가격(정수). 찾지 못했거나 원화가 아니면 null. 추측해서 채우지 않는다. */
  price: number | null;
  /** 페이지가 구조화 정보로 밝힌 판매 상태. 없으면 null(사용자가 직접 고른다). */
  status: ListingStatus | null;
  /** 읽지 못한 항목에 대한 안내. 팝업에 그대로 보여 준다. */
  problems: string[];
};

export type Parser = {
  id: string;
  sourceName: string;
  /** 이 사이트의 "매물 상세" 페이지인지. 목록·검색 결과 페이지는 false. */
  matches(url: URL): boolean;
  parse(doc: Document, url: URL): ClipResult;
};
