# 보안

이 앱은 **내 컴퓨터에서만 쓰는 1인용 도구**다. 로그인이 없고, 서버는 `127.0.0.1`에만 열린다. 인터넷이나 공유 네트워크에 공개 배포하는 것은 지원하지 않는다.

## 무엇을 막는가

| 위협 | 막는 방법 | 확인하는 테스트 |
|---|---|---|
| 내가 방문한 웹사이트가 DNS 리바인딩으로 이 앱을 읽거나 조작 | 모든 요청의 `Host`가 `localhost`·`127.0.0.1`·`[::1]`이 아니면 403 (`src/proxy.ts`, `src/lib/host.ts`) | `tests/unit/safety.test.ts`, E2E "localhost가 아닌 Host…" |
| 웹사이트가 브라우저를 통해 가져오기 API에 쓰기 요청 | `Origin` 검사(등록한 확장 한 개 또는 Origin 없는 로컬 도구만), 토큰 필수, CORS `*` 없음 (`src/lib/import/access.ts`) | `tests/unit/safety.test.ts`, E2E "가져오기 API…" |
| 토큰 유출 | 원문은 만든 직후 한 번만 표시, DB에는 SHA-256 해시만, 상수 시간 비교, 응답·오류·로그·내보내기에 넣지 않음 | `tests/unit/safety.test.ts`, `tests/unit/full-export.test.ts` |
| 주입된 스크립트 실행, 외부로의 전송 | 요청마다 새 nonce로만 스크립트를 허용하는 CSP(`unsafe-inline`·`unsafe-eval` 없음), `connect-src 'self'` (`src/lib/security-headers.ts`) | `tests/unit/safety.test.ts`, E2E "보안 헤더…" |
| 다른 사이트가 이 앱을 프레임에 넣어 클릭 유도 | `frame-ancestors 'none'`, `X-Frame-Options: DENY` | E2E "보안 헤더…" |
| 원문 URL로 나갈 때 이 앱의 주소 노출 | `Referrer-Policy: no-referrer`, 링크에 `noopener noreferrer` | E2E "보안 헤더…" |
| 서버가 임의 주소로 요청(SSRF) | 사용자가 넣은 원문 URL을 서버가 요청하지 않는다. 서버가 접속하는 곳은 코드에 고정된 서지정보 API 두 곳(`openlibrary.org`, `www.nl.go.kr`)뿐 | `tests/unit/safety.test.ts` "서버가 밖으로 나가는 곳" |
| CSV·가져오기로 잘못된 자료 유입 | 모든 경로가 같은 검증(`price-input.ts`)과 저장 함수(`insertPrice`)를 거친다. `VERIFIED_SALE`은 어떤 입력 경로로도 만들 수 없다 | `tests/unit/data.test.ts`, `tests/unit/safety.test.ts` |
| 개인정보 수집 | 판매자 닉네임·연락처·프로필·위치를 받을 칸이 스키마에 없다. 가져오기 API는 모르는 필드가 있으면 그 행을 거부 | `tests/unit/safety.test.ts`, `extension/tests/` |

## 막지 않는 것 (범위 밖)

- **같은 컴퓨터의 다른 프로그램·다른 사용자.** DB 파일(`data/resale.db`)은 암호화하지 않는다. 내 계정으로 실행되는 프로그램은 이 파일을 읽을 수 있다. 가져오기 토큰을 아는 로컬 프로그램은 물건 목록을 읽고 가격 자료를 추가할 수 있다.
- **브라우저 확장.** 내 브라우저에 설치된 다른 확장은 이 앱의 화면을 읽을 수 있다.
- **백업 파일과 내보내기 파일.** 내려받은 뒤의 보관은 사용자의 몫이다.
- **외부에 공개된 배포.** 인증이 없으므로 `127.0.0.1` 밖에 여는 구성은 안전하지 않다.

## 브라우저 확장 "직접 담기"

권한은 `activeTab`, `scripting`, `storage`와 로컬 앱 주소(`http://127.0.0.1:3000/*`)뿐이다. 백그라운드·콘텐츠 스크립트가 없고, 사용자가 누른 탭 하나를 한 번 읽는다. 이유와 결정은 [docs/integrations.md](docs/integrations.md).

## 취약점을 찾았다면

공개 이슈에 재현 방법을 그대로 적지 말고, 이 저장소의 **Security 탭 → Report a vulnerability**(GitHub 비공개 취약점 신고)를 이용해 달라. 그 메뉴가 보이지 않으면 세부 내용 없이 "보안 문의"라는 제목의 이슈만 열어 달라.
