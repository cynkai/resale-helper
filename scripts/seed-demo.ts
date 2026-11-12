// 데모(가상) 자료를 다시 만든다. is_demo=true 자료만 지우고 새로 넣으며 실제 자료는 건드리지 않는다.
import { openDb, resolveDbPath } from "../src/lib/db/client";
import { seedDemo } from "../src/lib/db/demo-seed";

const file = resolveDbPath();
const { db, close } = openDb(file);
seedDemo(db, new Date().toISOString().slice(0, 10));
close();
console.log(`데모 자료를 넣었습니다: ${file} (앱에서 '데모 보기'를 눌러야 보입니다)`);
