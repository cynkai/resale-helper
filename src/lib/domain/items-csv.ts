// 물건 목록 CSV 가져오기/내보내기. 물건 정보만 다룬다(가격 자료·계산·판매 결과는 담지 않는다).
// 가져오기는 물건 등록 폼과 같은 검증(validateItemInput)을 거친다.

import { buildImportableCsv, planCsvRows, type CsvPlan } from "./csv";
import { validateItemInput, type ItemField, type ValidItemInput } from "./item-input";

export const ITEM_CSV_COLUMNS: { header: string; field: ItemField }[] = [
  { header: "category", field: "category" },
  { header: "name", field: "name" },
  { header: "identifier", field: "identifier" },
  { header: "condition", field: "condition" },
  { header: "status", field: "status" },
  { header: "defects", field: "defects" },
  { header: "components", field: "components" },
  { header: "memo", field: "memo" },
  { header: "author", field: "author" },
  { header: "publisher", field: "publisher" },
  { header: "edition", field: "edition" },
  { header: "has_writing", field: "hasWriting" },
  { header: "has_underline", field: "hasUnderline" },
  { header: "has_damage", field: "hasDamage" },
  { header: "has_supplement", field: "hasSupplement" },
  { header: "purchase_amount", field: "purchaseAmount" },
  { header: "purchase_date", field: "purchaseDate" },
];
export const ITEM_CSV_REQUIRED_HEADERS = ["category", "name", "condition"];
const ITEM_CSV_METADATA = ["is_demo"];
/** 코드값으로 적는 열. 대소문자를 가리지 않는다. */
const CODE_FIELDS: ItemField[] = ["category", "condition", "status", "hasWriting", "hasUnderline", "hasDamage", "hasSupplement"];

export const MAX_ITEM_CSV_ROWS = 500;

export type ItemIdentity = { category: string; name: string; identifier: string | null };

/** 같은 물건으로 보는 기준: 카테고리와 이름, 식별자(ISBN·모델명)가 모두 같다. */
export function isSameItem(a: ItemIdentity, b: ItemIdentity): boolean {
  return a.category === b.category && a.name === b.name && (a.identifier ?? "") === (b.identifier ?? "");
}

export type ItemsCsvPlan = CsvPlan<ValidItemInput>;

/**
 * CSV를 읽어 등록할 물건과 건너뛸 행을 나눈다. 오류가 있는 행만 건너뛰고 나머지는 등록한다.
 * existing: 이미 등록된 물건(같은 파일을 다시 가져와도 두 번 등록되지 않게 한다).
 */
export function planItemsCsvImport(text: string, existing: ItemIdentity[], today?: string): ItemsCsvPlan {
  const headerLabel = new Map(ITEM_CSV_COLUMNS.map((c) => [c.field, c.header]));
  const seen = [...existing];
  return planCsvRows<ItemField, ValidItemInput>(text, {
    columns: ITEM_CSV_COLUMNS,
    required: ITEM_CSV_REQUIRED_HEADERS,
    metadata: ITEM_CSV_METADATA,
    isDemo: false,
    maxRows: MAX_ITEM_CSV_ROWS,
  }, (raw) => {
    for (const field of CODE_FIELDS) {
      const value = raw[field];
      if (value !== undefined) raw[field] = value.trim().toUpperCase();
    }
    const result = validateItemInput(raw, today);
    if (!result.ok) return {
      messages: Object.entries(result.errors).map(([f, m]) => `${headerLabel.get(f as ItemField) ?? f}: ${m}`),
    };
    if (seen.some((s) => isSameItem(s, result.value))) {
      return { messages: ["카테고리·이름·식별자가 같은 물건이 이미 있어 건너뜁니다. 같은 물건을 하나 더 등록하려면 물건 등록 화면을 이용해 주세요."] };
    }
    seen.push(result.value);
    return { value: result.value };
  });
}

export type ItemExportRow = ValidItemInput & { isDemo: boolean };

export function buildItemsCsv(rows: ItemExportRow[]): string {
  const headers = [...ITEM_CSV_COLUMNS.map((c) => c.header), ...ITEM_CSV_METADATA];
  return buildImportableCsv(headers, rows.map((r) => [
    ...ITEM_CSV_COLUMNS.map((c) => String(r[c.field] ?? "")),
    r.isDemo ? "true" : "false",
  ]));
}
