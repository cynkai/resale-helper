// DB 파일을 만들고 마이그레이션을 적용한다. (앱 시작 시에도 자동 적용되지만, 명시적으로 초기화할 때 사용)
import { openDb, resolveDbPath } from "../src/lib/db/client";

const file = resolveDbPath();
const { close } = openDb(file);
close();
console.log(`마이그레이션 적용 완료: ${file}`);
