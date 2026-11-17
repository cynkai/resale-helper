// 가져오기 API 사용 기록. 통과한 요청과 거부한 요청을 모두 남겨, 모르는 프로그램이나 웹사이트가
// 이 문을 두드렸는지 사용자가 설정 화면에서 볼 수 있게 한다.
// 남기지 않는 것: 토큰, Authorization 헤더, 요청 본문(가격·출처 등).

import { desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { importEvents } from "../db/schema";

export const IMPORT_OUTCOMES = ["OK", "DENIED_ORIGIN", "DISABLED", "BAD_TOKEN", "BAD_REQUEST"] as const;
export type ImportOutcome = (typeof IMPORT_OUTCOMES)[number];

export const IMPORT_OUTCOME_LABEL: Record<ImportOutcome, string> = {
  OK: "통과",
  DENIED_ORIGIN: "거부: 허용되지 않은 Origin",
  DISABLED: "거부: 토큰 없음(API 꺼짐)",
  BAD_TOKEN: "거부: 토큰 틀림",
  BAD_REQUEST: "거부: 요청 형식·크기",
};

/** 남겨 두는 줄 수. 넘으면 오래된 것부터 지운다(거부된 요청이 쏟아져도 DB가 계속 커지지 않게). */
export const MAX_IMPORT_EVENTS = 500;
const MAX_ORIGIN_LENGTH = 200;

export type ImportEventInput = {
  endpoint: "prices" | "items";
  outcome: ImportOutcome;
  status: number;
  route?: "CLIP" | "EXTERNAL" | null;
  origin?: string | null;
  itemId?: number | null;
  imported?: number | null;
  rejected?: number | null;
};

/**
 * 기록 한 줄을 남긴다. 직전 줄과 같은 요청(거부, 물건 목록 읽기)이면 새 줄을 만들지 않고 횟수와 시각만 올린다.
 * 기록에 실패해도 요청 처리에는 영향을 주지 않도록 호출하는 쪽에서 예외를 삼킨다.
 */
export function recordImportEvent(db: Db, e: ImportEventInput): void {
  const origin = e.origin ? e.origin.slice(0, MAX_ORIGIN_LENGTH) : null;
  // 한 줄로 묶는 것: 거부된 요청, 그리고 물건 목록 읽기(확장이 팝업을 열 때마다 부른다). 가격 저장은 건마다 남긴다.
  if (e.outcome !== "OK" || e.endpoint === "items") {
    const last = db.select().from(importEvents).orderBy(desc(importEvents.id)).limit(1).get();
    if (last && last.endpoint === e.endpoint && last.outcome === e.outcome && last.status === e.status && (last.origin ?? null) === origin) {
      db.update(importEvents)
        .set({ count: sql`${importEvents.count} + 1`, at: sql`(datetime('now'))` })
        .where(eq(importEvents.id, last.id))
        .run();
      return;
    }
  }
  db.insert(importEvents)
    .values({
      endpoint: e.endpoint,
      outcome: e.outcome,
      status: e.status,
      route: e.route ?? null,
      origin,
      itemId: e.itemId ?? null,
      imported: e.imported ?? null,
      rejected: e.rejected ?? null,
    })
    .run();
  db.run(sql`delete from import_events where id <= (select max(id) from import_events) - ${MAX_IMPORT_EVENTS}`);
}

/** 최근 것부터. */
export function listImportEvents(db: Db, limit = 50) {
  return db.select().from(importEvents).orderBy(desc(importEvents.id)).limit(limit).all();
}

export function clearImportEvents(db: Db): void {
  db.delete(importEvents).run();
}

/** 허용되지 않은 Origin이나 틀린 토큰으로 온 요청 횟수(설정 화면 안내용). */
export function countSuspiciousImportEvents(db: Db): number {
  const r = db
    .select({ n: sql<number>`coalesce(sum(${importEvents.count}), 0)` })
    .from(importEvents)
    .where(inArray(importEvents.outcome, ["DENIED_ORIGIN", "BAD_TOKEN"]))
    .get();
  return r?.n ?? 0;
}
