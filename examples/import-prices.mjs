#!/usr/bin/env node
// 가져오기 API 예시: 내가 정리해 둔 JSON 파일의 가격 자료를 로컬 앱에 넣는다.
// 수집기가 아니다. 이 스크립트는 로컬 파일만 읽고, 요청은 내 컴퓨터의 앱(127.0.0.1)으로만 보낸다.
//
// 사용:
//   export RESALE_IMPORT_TOKEN='<설정 화면에서 만든 토큰>'
//   node examples/import-prices.mjs examples/import-prices-example.json
//   (앱을 다른 포트로 띄웠다면 RESALE_APP_ORIGIN=http://127.0.0.1:<포트>)
//
// 파일 모양: { "itemId": 1, "records": [ { "price_type": "ASKING", "amount": 15000, ... } ] }
// 레코드 필드는 CSV 열과 같다(docs/usage.md의 "CSV 형식"). 100건씩 나눠 보낸다.
// 토큰은 화면에 찍지 않는다.

import fs from "node:fs";
import { fileURLToPath } from "node:url";

export const APP_ORIGIN = "http://127.0.0.1:3000";

/** 앱 주소. 기본은 127.0.0.1:3000이고, RESALE_APP_ORIGIN으로 다른 포트를 줄 수 있다(내 컴퓨터 주소만 허용). */
export function appOrigin(env = process.env.RESALE_APP_ORIGIN) {
  if (!env) return APP_ORIGIN;
  if (!/^http:\/\/(127\.0\.0\.1|localhost):\d{1,5}$/.test(env)) throw new Error("RESALE_APP_ORIGIN은 http://127.0.0.1:<포트> 또는 http://localhost:<포트>만 쓸 수 있습니다.");
  return env;
}
export const MAX_RECORDS_PER_REQUEST = 100;

/** 레코드를 한 요청에 넣을 수 있는 크기로 나눈다. */
export function chunk(records, size = MAX_RECORDS_PER_REQUEST) {
  const out = [];
  for (let i = 0; i < records.length; i += size) out.push(records.slice(i, i + size));
  return out;
}

/** 파일 내용을 검사해 보낼 요청 본문 목록을 만든다. 잘못된 모양이면 Error. */
export function buildBodies(input) {
  if (!input || typeof input !== "object") throw new Error("파일은 { itemId, records } 모양의 JSON이어야 합니다.");
  const { itemId, records } = input;
  if (!Number.isSafeInteger(itemId) || itemId <= 0) throw new Error("itemId는 앱의 물건 번호(양의 정수)여야 합니다.");
  if (!Array.isArray(records) || records.length === 0) throw new Error("records가 비어 있습니다.");
  return chunk(records).map((part) => ({ itemId, records: part }));
}

async function main() {
  const file = process.argv[2];
  const token = process.env.RESALE_IMPORT_TOKEN ?? "";
  if (!file) throw new Error("가져올 JSON 파일 경로를 주세요.");
  if (!token) throw new Error("환경변수 RESALE_IMPORT_TOKEN에 가져오기 토큰을 넣어 주세요.");
  const bodies = buildBodies(JSON.parse(fs.readFileSync(file, "utf8")));
  let imported = 0;
  let rejected = 0;
  for (const [n, body] of bodies.entries()) {
    const res = await fetch(`${appOrigin()}/api/import/prices`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`요청 ${n + 1}/${bodies.length} 실패(HTTP ${res.status}): ${json.error ?? "알 수 없는 오류"}`);
    imported += json.imported;
    rejected += json.rejected;
    for (const r of json.results ?? []) {
      const index = n * MAX_RECORDS_PER_REQUEST + r.index;
      console.log(r.ok ? `#${index} 저장(가격 자료 ${r.id})` : `#${index} 거부: ${r.error}`);
    }
  }
  console.log(`저장 ${imported}건, 거부 ${rejected}건`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
}
