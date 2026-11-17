// 물건 목록 CSV 가져오기/내보내기. 물건 정보만 다룬다(가격 자료·계산·판매 결과는 담지 않는다).
// 가져오기는 물건 등록 폼과 같은 검증(validateItemInput)을 거친다.

import { escapeCsvCell, parseCsv, type CsvRowError } from "./csv";
import { validateItemInput, type ItemField, type ItemInputRaw, type ValidItemInput } from "./item-input";

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
// 내보내기 전용 열(가져올 때는 무시)
export const ITEM_CSV_EXPORT_ONLY_HEADERS = ["is_demo"];
/** 코드값으로 적는 열. 대소문자를 가리지 않는다. */
const CODE_FIELDS: ItemField[] = ["category", "condition", "status", "hasWriting", "hasUnderline", "hasDamage", "hasSupplement"];

export const MAX_ITEM_CSV_ROWS = 500;

export type ItemIdentity = { category: string; name: string; identifier: string | null };

/** 같은 물건으로 보는 기준: 카테고리와 이름, 식별자(ISBN·모델명)가 모두 같다. */
export function isSameItem(a: ItemIdentity, b: ItemIdentity): boolean {
  return a.category === b.category && a.name === b.name && (a.identifier ?? "") === (b.identifier ?? "");
}

export type ItemsCsvPlan = {
  headerError: string | null;
  valid: { line: number; value: ValidItemInput }[];
  errors: CsvRowError[];
};

/**
 * CSV를 읽어 등록할 물건과 건너뛸 행을 나눈다. 오류가 있는 행만 건너뛰고 나머지는 등록한다.
 * existing: 이미 등록된 물건(같은 파일을 다시 가져와도 두 번 등록되지 않게 한다).
 */
export function planItemsCsvImport(text: string, existing: ItemIdentity[]): ItemsCsvPlan {
  const plan: ItemsCsvPlan = { headerError: null, valid: [], errors: [] };
  const rows = parseCsv(text);
  if (rows.length === 0) {
    plan.headerError = "빈 파일입니다. 첫 줄에 열 이름이 있어야 합니다.";
    return plan;
  }
  const headers = rows[0]!.map((h) => h.trim().toLowerCase());
  const missing = ITEM_CSV_REQUIRED_HEADERS.filter((h) => !headers.includes(h));
  if (missing.length > 0) {
    plan.headerError = `필수 열이 없습니다: ${missing.join(", ")}`;
    return plan;
  }
  const known = new Set([...ITEM_CSV_COLUMNS.map((c) => c.header), ...ITEM_CSV_EXPORT_ONLY_HEADERS]);
  const unknown = headers.filter((h) => h !== "" && !known.has(h));
  if (unknown.length > 0) {
    plan.headerError = `알 수 없는 열이 있습니다: ${unknown.join(", ")}`;
    return plan;
  }
  if (rows.length - 1 > MAX_ITEM_CSV_ROWS) {
    plan.headerError = `한 번에 ${MAX_ITEM_CSV_ROWS}행까지 가져올 수 있습니다.`;
    return plan;
  }

  const headerLabel = new Map(ITEM_CSV_COLUMNS.map((c) => [c.field, c.header]));
  const seen: ItemIdentity[] = [...existing];
  for (let i = 1; i < rows.length; i++) {
    const line = i + 1;
    const cells = rows[i]!;
    const raw: ItemInputRaw = {};
    for (const col of ITEM_CSV_COLUMNS) {
      const idx = headers.indexOf(col.header);
      if (idx < 0) continue;
      const cell = (cells[idx] ?? "").trim();
      raw[col.field] = CODE_FIELDS.includes(col.field) ? cell.toUpperCase() : cell;
    }
    const result = validateItemInput(raw);
    if (!result.ok) {
      plan.errors.push({
        line,
        messages: Object.entries(result.errors).map(([f, m]) => `${headerLabel.get(f as ItemField) ?? f}: ${m}`),
      });
      continue;
    }
    if (seen.some((s) => isSameItem(s, result.value))) {
      plan.errors.push({
        line,
        messages: ["카테고리·이름·식별자가 같은 물건이 이미 있어 건너뜁니다. 같은 물건을 하나 더 등록하려면 물건 등록 화면을 이용해 주세요."],
      });
      continue;
    }
    seen.push(result.value);
    plan.valid.push({ line, value: result.value });
  }
  return plan;
}

export type ItemExportRow = ValidItemInput & { isDemo: boolean };

export function buildItemsCsv(rows: ItemExportRow[]): string {
  const headers = [...ITEM_CSV_COLUMNS.map((c) => c.header), ...ITEM_CSV_EXPORT_ONLY_HEADERS];
  const lines = [headers.join(",")];
  for (const r of rows) {
    const cells = [...ITEM_CSV_COLUMNS.map((c) => r[c.field] ?? ""), r.isDemo ? "true" : "false"];
    lines.push(cells.map((c) => escapeCsvCell(String(c))).join(","));
  }
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}
