// 설정 화면의 "DB 점검". 읽기만 하고 아무것도 고치지 않는다.
// SQLite 자체 검사(파일 손상, 끊어진 참조)와 이 앱이 지키는 규칙(데모 격리, 검증된 체결가는 직접 만들 수 없음 등)을 함께 본다.

import type Database from "better-sqlite3";

export type HealthCheck = { key: string; label: string; ok: boolean; detail: string };
export type HealthReport = { ok: boolean; checks: HealthCheck[] };

/** 손상 메시지는 길 수 있어 앞의 몇 줄만 보여 준다. */
const MAX_DETAIL_LINES = 5;

const count = (sqlite: Database.Database, q: string) => (sqlite.prepare(q).get() as { n: number }).n;

export function checkDbHealth(sqlite: Database.Database): HealthReport {
  const checks: HealthCheck[] = [];

  const integrity = sqlite.pragma("integrity_check") as { integrity_check: string }[];
  const integrityOk = integrity.length === 1 && integrity[0]!.integrity_check === "ok";
  checks.push({
    key: "integrity",
    label: "파일 손상 검사(SQLite integrity_check)",
    ok: integrityOk,
    detail: integrityOk
      ? "이상 없음"
      : integrity
          .slice(0, MAX_DETAIL_LINES)
          .map((r) => r.integrity_check)
          .join(" / ") + (integrity.length > MAX_DETAIL_LINES ? ` 외 ${integrity.length - MAX_DETAIL_LINES}건` : ""),
  });

  const fk = sqlite.pragma("foreign_key_check") as { table: string }[];
  const byTable = new Map<string, number>();
  for (const r of fk) byTable.set(r.table, (byTable.get(r.table) ?? 0) + 1);
  checks.push({
    key: "foreign_keys",
    label: "끊어진 참조(SQLite foreign_key_check)",
    ok: fk.length === 0,
    detail: fk.length === 0 ? "이상 없음" : [...byTable].map(([t, n]) => `${t} ${n}건`).join(", "),
  });

  // 데모 격리: 가격 자료의 데모 표시는 그 물건과 같아야 한다.
  const demoMismatch = count(sqlite, "select count(*) as n from price_records p join items i on i.id = p.item_id where p.is_demo <> i.is_demo");
  checks.push({
    key: "demo_isolation",
    label: "데모 자료와 실제 자료가 섞이지 않았는지",
    ok: demoMismatch === 0,
    detail: demoMismatch === 0 ? "이상 없음" : `물건과 데모 표시가 다른 가격 자료 ${demoMismatch}건`,
  });

  // 검증된 체결가는 직접 입력·CSV·확장·가져오기 API로 만들 수 없다(지금은 이 유형을 만드는 연동이 없다).
  const verified = count(sqlite, "select count(*) as n from price_records where price_type = 'VERIFIED_SALE'");
  checks.push({
    key: "verified_sale",
    label: "검증된 체결가가 직접 만들어지지 않았는지",
    ok: verified === 0,
    detail: verified === 0 ? "이상 없음" : `검증된 체결가 ${verified}건(이 앱에는 이 유형을 만드는 연동이 없습니다)`,
  });

  const negative = count(sqlite, "select count(*) as n from price_records where amount_minor < 0");
  checks.push({
    key: "amounts",
    label: "가격 자료 금액",
    ok: negative === 0,
    detail: negative === 0 ? "이상 없음" : `0보다 작은 금액 ${negative}건`,
  });

  const multiPrimary = count(
    sqlite,
    "select count(*) as n from (select item_id, method from cost_scenarios where is_primary = 1 group by item_id, method having count(*) > 1)",
  );
  checks.push({
    key: "primary",
    label: "방식마다 기준 계산이 하나뿐인지",
    ok: multiPrimary === 0,
    detail: multiPrimary === 0 ? "이상 없음" : `기준 계산이 둘 이상인 물건·방식 ${multiPrimary}곳`,
  });

  // 계산의 기준 자료는 같은 물건의 가격 자료여야 한다.
  const foreignBasis = count(
    sqlite,
    "select count(*) as n from cost_scenarios c join price_records p on p.id = c.basis_price_record_id where p.item_id <> c.item_id",
  );
  checks.push({
    key: "basis_owner",
    label: "계산의 기준 자료가 같은 물건의 것인지",
    ok: foreignBasis === 0,
    detail: foreignBasis === 0 ? "이상 없음" : `다른 물건의 가격 자료를 기준으로 한 계산 ${foreignBasis}개`,
  });

  return { ok: checks.every((c) => c.ok), checks };
}

export type DataStats = {
  /** 모드별(실제·데모) 건수. 금액은 담지 않는다. */
  modes: { isDemo: boolean; items: number; trashedItems: number; prices: number; trashedPrices: number; results: number }[];
  /** DB 파일과 보조 파일(-wal, -shm)을 합친 크기(바이트). 파일이 없으면 0. */
  fileBytes: number;
};

/** 설정 화면의 "내 자료 현황": 건수와 파일 크기만. */
export function dataStats(sqlite: Database.Database, dbFile: string, fileSize: (f: string) => number): DataStats {
  const n = (q: string, isDemo: boolean) => (sqlite.prepare(q).get(isDemo ? 1 : 0) as { n: number }).n;
  const modes = [false, true].map((isDemo) => ({
    isDemo,
    items: n("select count(*) as n from items where is_demo = ? and deleted_at is null", isDemo),
    trashedItems: n("select count(*) as n from items where is_demo = ? and deleted_at is not null", isDemo),
    prices: n(
      "select count(*) as n from price_records p join items i on i.id = p.item_id where p.is_demo = ? and p.deleted_at is null and i.deleted_at is null",
      isDemo,
    ),
    trashedPrices: n(
      "select count(*) as n from price_records p join items i on i.id = p.item_id where p.is_demo = ? and (p.deleted_at is not null or i.deleted_at is not null)",
      isDemo,
    ),
    results: n("select count(*) as n from sale_results r join items i on i.id = r.item_id where i.is_demo = ? and i.deleted_at is null", isDemo),
  }));
  const fileBytes = ["", "-wal", "-shm"].reduce((sum, x) => sum + fileSize(`${dbFile}${x}`), 0);
  return { modes, fileBytes };
}
