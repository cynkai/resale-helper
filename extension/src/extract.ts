// 팝업에서 버튼을 눌렀을 때만 현재 탭에 주입되는 스크립트. 열려 있는 문서를 한 번 읽고 끝난다.
// 네트워크 요청, 페이지 이동, 반복 실행을 하지 않는다.
import { extract } from "./parsers";

(globalThis as { __resaleHelperClip?: unknown }).__resaleHelperClip = extract(document, location.href);
