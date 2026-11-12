# 데이터 소스

확인일: **2026-11-11**. 공식 문서를 직접 읽어 확인한 내용만 적었고, 확인하지 못한 부분은 "미확인"으로 표시했다. 접근 조건은 바뀔 수 있으므로 연동 전에 다시 확인해야 한다.

## 한눈에 보기

| 소스 | 종류 | 상태 | 제공하는 것 |
|---|---|---|---|
| Open Library Books API | 서지정보 | ✅ 연동, 실제 호출 확인 | 제목·저자·출판사 |
| 국립중앙도서관 ISBN 서지정보 API | 서지정보 | ⚠️ 문서 기준 구현, **실제 호출 미검증**(키 없음) | 제목·저자·출판사·판사항 |
| 알라딘 OpenAPI | 서지 + 중고 최저가 + 매입가 | ❌ 연동 안 함 — 서비스 종료 공지 | — |
| 알라딘 중고 매입가 조회 화면 | 매입 견적 | ❌ 자동 수집 안 함 — 사람이 보고 직접 입력 | — |
| 중고나라 시세조회 화면 | 시세 | ❌ 자동 수집 안 함 — 사람이 보고 직접 입력 | — |
| eBay Browse API | 판매 중 희망가(해외) | ❌ 연동 안 함 — 문서 미확인, 범위 밖 | — |
| eBay Marketplace Insights API | 판매완료(해외) | ❌ 신규 이용 불가 | — |
| eBay Product Research (Terapeak) | 판매완료(해외) | ❌ 판매자용 화면 도구 | — |

**가격을 자동으로 가져오는 연동은 하나도 없다.** 가격 자료는 전부 직접 입력 또는 CSV로 들어온다. `src/lib/providers/price.ts`에는 인터페이스만 있고 등록된 제공자는 없다(테스트로 고정).

## 연동한 소스

### Open Library Books API (서지정보)

- 문서: <https://openlibrary.org/dev/docs/api/books>, <https://openlibrary.org/developers/api>
- 요청: `GET https://openlibrary.org/api/books?bibkeys=ISBN:{isbn}&jscmd=data&format=json`
- 키: 문서에 API 키 언급 없음. 키 없이 호출해 응답을 확인했다.
- 제한(문서): 식별하지 않은 요청은 초당 1회. 자주 쓰는 앱은 `User-Agent`로 앱을 밝히라고 안내한다. 대량 수집·HTML 스크레이핑 금지, 응답은 캐시할 것.
- 이 앱의 사용 방식: 사용자가 "서지정보 조회"를 누를 때만 1건 조회. `User-Agent: resale-helper/0.1 (local personal tool)`(개인 연락처는 넣지 않음). 결과는 30일 캐시.
- 가져오는 값: `title`(+`subtitle`), `authors[].name`, `publishers[].name`, `publish_date`. **판본 정보는 이 형식에 없어** 사용자가 직접 입력한다.
- 한계: 한국어 도서는 등록되지 않은 경우가 많다. 문서는 이 엔드포인트를 "legacy"라고 부르며 향후 단계적 폐지 가능성을 언급한다.
- 가격 의미: **없음.** 가격 정보를 제공하지 않으며 이 앱도 가격으로 쓰지 않는다.

### 국립중앙도서관 ISBN 서지정보 API (서지정보)

- 문서: <https://www.nl.go.kr/NL/contents/N31101030500.do>, 이용안내 <https://www.nl.go.kr/NL/contents/N31101010000.do>
- 요청: `GET https://www.nl.go.kr/seoji/SearchApi.do` — 필수 `cert_key`, `result_style`(json), `page_no`, `page_size`, 선택 `isbn` 등
- 접근 조건: 회원가입 → 인증키 발급 신청 → **담당자 승인**. 환경변수 `NLK_CERT_KEY`에 넣으면 Open Library보다 먼저 조회한다.
- 사용하는 응답 필드: `TITLE`, `AUTHOR`, `PUBLISHER`, `EDITION_STMT`, `PUBLISH_PREDATE`, `EA_ISBN`
- **미검증 사항**: 키가 없어 실제 호출을 해 보지 못했다. 필드명은 문서에서 확인했지만 응답 최상위 구조(`docs` 배열)는 문서의 응답 예시를 확인하지 못한 채 구현했다. 구조가 다르면 "응답을 해석하지 못했습니다" 오류가 나고 Open Library·직접 입력으로 이어진다. 호출 한도·표시 조건도 읽은 문서에서는 찾지 못했다.
- 가격 의미: 없음. `PRE_PRICE`(정가) 필드가 있지만 중고 가격이 아니므로 사용하지 않는다.

## 연동하지 않은 소스와 이유

### 알라딘 OpenAPI

- 문서: <https://blog.aladin.co.kr/openapi/category/29154404>, <https://blog.aladin.co.kr/openapi/5353304>, 약관 <https://blog.aladin.co.kr/openapi/13851154>
- 매뉴얼상 `ItemLookUp`에 `OptResult=usedList`(중고 판매자 유형별 건수·최저가 → `ASKING`에 해당)와 `c2binfo`(알라딘 매입 여부·매입가 → `BUYBACK_QUOTE`에 해당)가 있어 가장 유력한 후보였다.
- 그러나 공식 블로그 공지에 따르면 **OpenAPI 서비스가 종료**된다: 2026-09-04 신규 키 발급 마감, 2026-10-30 이후 기존 키 호출 불가. 공지 내용으로 확인한 것이며 실제 호출로 확인하지는 않았다(키 없음).
- 약관에는 조회 결과의 저장(캐시 포함)·재배포 제한 조항도 있어, 서비스가 유지됐더라도 가격을 DB에 쌓는 방식은 별도 검토가 필요했다.
- 결론: 어댑터를 만들지 않았다.

### 알라딘 중고 매입가 조회 / 중고나라 시세조회

- <https://www.aladin.co.kr/shop/usedshop/wc2b_search.aspx>, <https://web.joongna.com/search-price>
- 둘 다 사람이 쓰는 웹 화면이고, 해당 페이지에서 공식 API나 데이터 이용 프로그램 안내를 찾지 못했다.
- 화면에 보인다는 이유로 자동 수집·저장이 허용된다고 볼 수 없어 수집기를 만들지 않았다. 알라딘 `robots.txt`는 지정되지 않은 에이전트에 `Disallow: /`다.
- 사용법: 사용자가 직접 화면에서 값을 확인하고 **매입 견적**(알라딘) 또는 **판매 중 희망가/판매완료 게시가**(중고나라)로 입력한다. 중고나라 시세조회가 보여 주는 값이 희망가인지 판매완료가인지는 페이지에서 확인하지 못했으므로, 입력할 때 화면 표시를 보고 유형을 고른다.

### eBay

- Browse API 문서 페이지(<https://developer.ebay.com/develop/api/buy/browse_api>)는 확인 시점에 접근이 거부되어(HTTP 403) **내용을 확인하지 못했다.** 인증 방식·운영 접근 조건·반환 범위는 미확인.
- Buy API 필터 문서(<https://www.developer.ebay.com/api-docs/buy/static/ref-buy-browse-filters.html>)에는 Marketplace Insights API가 "restricted and not open to new users"라고 적혀 있다. 판매완료 필터(`lastSoldDate`)는 그 API에만 있다.
- Product Research(Terapeak)는 Seller Hub의 판매자용 조사 화면이고, 도움말 페이지에 API 안내는 없다.
- 첫 버전은 원화 비교만 하므로 해외 자료는 범위 밖이다. 사용자가 직접 본 값을 외화로 입력하면 원래 통화로만 표시되고 비교에서 제외된다.

## 원칙

- 공식 API 또는 이용이 허용된 데이터만 연동한다. 로그인·CAPTCHA·접근 제한 우회, 비공개 API 사용, 화면 스크레이핑을 하지 않는다.
- 판매자 연락처·채팅 등 개인정보를 수집하지 않는다.
- 사용자가 붙여 넣은 원문 URL을 서버가 요청하지 않는다. 서버가 접속하는 곳은 코드에 고정된 위 두 서지 API뿐이다.
- 외부 조회: 타임아웃 5초, 재시도 1회, 결과 30일 캐시. 실패하면 실패했다고 알리고 직접 입력으로 이어진다. **실패를 가짜 값으로 메우지 않는다.**
- 서지정보 제공자(`src/lib/providers/bibliographic.ts`)와 가격정보 제공자(`src/lib/providers/price.ts`)는 인터페이스가 분리되어 있다.
- 이 문서의 어떤 내용도 외부 데이터의 재배포 권한을 보장하지 않는다.
