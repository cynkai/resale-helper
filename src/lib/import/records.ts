// 가져오기 API 본문 해석과 저장. 검증은 price-input.ts, 중복 판정과 저장은 기존 insertPrice를 그대로 쓴다.

import type { Db } from "../db/client";
import { getItem, insertPrice } from "../db/repo";
import { CSV_COLUMNS } from "../domain/csv";
import { validatePriceInput, type PriceField, type PriceInputRaw } from "../domain/price-input";

export const MAX_IMPORT_RECORDS = 100;
export const MAX_IMPORT_BODY_BYTES = 256_000;

/** 받는 필드는 CSV 열과 같다(snake_case). 이 목록에 없는 필드는 받지 않는다. */
const FIELD_BY_KEY = new Map<string, PriceField>(CSV_COLUMNS.map((c) => [c.header, c.field]));
export const IMPORT_RECORD_KEYS = [...FIELD_BY_KEY.keys()];

export type ImportRowResult =
  | { index: number; ok: true; id: number }
  /**
   * duplicateOf: 이미 저장된 같은 매물의 가격 자료 번호. changed: 보낸 유형·금액·통화가 저장된 값과 다른지.
   * 중복은 여전히 저장하지 않는다. 저장된 금액 자체는 돌려주지 않는다.
   */
  | { index: number; ok: false; error: string; duplicateOf?: number; changed?: boolean };

export type ImportOutcome =
  | { ok: true; results: ImportRowResult[]; imported: number; rejected: number }
  | { ok: false; status: 400 | 404 | 413; error: string };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** 레코드 하나를 검증 입력으로 바꾼다. 모르는 필드가 있으면 조용히 버리지 않고 그 행을 거부한다. */
export function toPriceInputRaw(record: unknown): { ok: true; raw: PriceInputRaw } | { ok: false; error: string } {
  if (!isPlainObject(record)) return { ok: false, error: "레코드는 객체여야 합니다." };
  const raw: PriceInputRaw = {};
  const unknown: string[] = [];
  for (const [key, value] of Object.entries(record)) {
    const field = FIELD_BY_KEY.get(key);
    if (!field) {
      unknown.push(key);
      continue;
    }
    if (value === null || value === undefined) continue;
    if (typeof value === "string") raw[field] = value;
    else if (typeof value === "number" && Number.isFinite(value)) {
      if ((field === "externalId" || field === "productIdentifier") && Number.isInteger(value) && !Number.isSafeInteger(value)) {
        return { ok: false, error: `${key}: 정확하게 표현할 수 없는 숫자 ID입니다. 원래 ID를 문자열로 보내 주세요.` };
      }
      raw[field] = String(value);
    }
    else return { ok: false, error: `${key}: 문자열 또는 숫자여야 합니다.` };
  }
  if (unknown.length > 0) {
    return {
      ok: false,
      error: `받지 않는 필드입니다: ${unknown.slice(0, 5).join(", ")}. 가격 자료 필드만 보낼 수 있습니다(판매자 정보 등은 받지 않음).`,
    };
  }
  return { ok: true, raw };
}

/**
 * 본문 { itemId, records }를 처리한다. 항상 실제 모드 물건에만 저장한다(데모 물건 ID는 404).
 * 일부 행이 실패해도 올바른 행은 저장하고, 행마다 결과를 돌려준다(CSV 가져오기와 같은 동작).
 */
export function importRecords(db: Db, body: unknown, route: "CLIP" | "EXTERNAL", today: string): ImportOutcome {
  if (!isPlainObject(body)) return { ok: false, status: 400, error: "본문은 { itemId, records } 형태의 JSON이어야 합니다." };
  const { itemId, records } = body;
  if (typeof itemId !== "number" || !Number.isSafeInteger(itemId) || itemId <= 0) {
    return { ok: false, status: 400, error: "itemId는 양의 정수여야 합니다." };
  }
  if (!Array.isArray(records) || records.length === 0) {
    return { ok: false, status: 400, error: "records는 한 건 이상의 배열이어야 합니다." };
  }
  if (records.length > MAX_IMPORT_RECORDS) {
    return { ok: false, status: 413, error: `한 번에 ${MAX_IMPORT_RECORDS}건까지 보낼 수 있습니다.` };
  }
  const item = getItem(db, false, itemId);
  if (!item) return { ok: false, status: 404, error: "물건을 찾을 수 없습니다." };

  const results: ImportRowResult[] = [];
  records.forEach((record, index) => {
    const conv = toPriceInputRaw(record);
    if (!conv.ok) {
      results.push({ index, ok: false, error: conv.error });
      return;
    }
    // 경로는 서버가 정한 값만 쓴다. CLIP·EXTERNAL은 VERIFIED_SALE을 만들 수 없다(validatePriceInput에서 거부).
    const v = validatePriceInput(conv.raw, { route, today });
    if (!v.ok) {
      results.push({ index, ok: false, error: Object.values(v.errors).join(" / ") });
      return;
    }
    const saved = insertPrice(db, item, v.value, route);
    if (!saved.ok) {
      if (saved.reason === "CONFLICT") {
        results.push({ index, ok: false, error: "출처 ID와 원문 URL이 서로 다른 자료를 가리킵니다(휴지통 포함). 저장하지 않았습니다. 보낸 ID와 URL을 확인해 주세요." });
        return;
      }
      if (saved.inTrash) {
        // 휴지통의 자료는 고칠 수 없으므로 수정 화면 번호(duplicateOf)를 주지 않는다.
        results.push({ index, ok: false, error: "같은 매물이 앱의 휴지통에 있습니다. 저장하지 않았습니다. 앱의 휴지통에서 되살리거나 완전히 지운 뒤 다시 보내 주세요." });
        return;
      }
      const existing = saved.duplicate;
      const changed = existing.amountMinor !== v.value.amountMinor || existing.currency !== v.value.currency || existing.priceType !== v.value.priceType;
      results.push({
        index,
        ok: false,
        error:
          changed
            ? "이미 등록된 매물인데 보낸 가격·유형이 저장된 값과 다릅니다. 저장하지 않았습니다. 가격이 바뀌었다면 앱에서 그 자료를 수정해 주세요(이전 값은 이력에 남습니다)."
            : "이미 등록된 매물이고 가격·유형이 저장된 값과 같습니다. 저장하지 않았습니다. 다시 확인한 것이라면 앱에서 '오늘 다시 확인함'을 눌러 주세요.",
        duplicateOf: existing.id,
        changed,
      });
      return;
    }
    results.push({ index, ok: true, id: saved.id });
  });
  const imported = results.filter((r) => r.ok).length;
  return { ok: true, results, imported, rejected: results.length - imported };
}
