// 가격 자료 CSV 가져오기/내보내기. 외부 라이브러리 없이 RFC 4180 방식으로 처리한다.

import { isSameListing } from "./compare";
import { fxRateToPlain } from "./fx";
import { minorToPlain } from "./money";
import {
  validatePriceInput,
  type PriceField,
  type ValidPriceInput,
} from "./price-input";
import type { Currency, InputRoute, PriceType } from "./types";

// CSV 열 이름(snake_case) ↔ 내부 필드
export const CSV_COLUMNS: { header: string; field: PriceField }[] = [
  { header: "price_type", field: "priceType" },
  { header: "amount", field: "amount" },
  { header: "currency", field: "currency" },
  { header: "fx_rate", field: "fxRate" },
  { header: "fx_date", field: "fxDate" },
  { header: "source_name", field: "sourceName" },
  { header: "source_url", field: "sourceUrl" },
  { header: "external_id", field: "externalId" },
  { header: "checked_date", field: "checkedDate" },
  { header: "trade_date", field: "tradeDate" },
  { header: "product_identifier", field: "productIdentifier" },
  { header: "condition", field: "condition" },
  { header: "components", field: "components" },
  { header: "components_match", field: "componentsMatch" },
  { header: "bundle_type", field: "bundleType" },
  { header: "shipping_included", field: "shippingIncluded" },
  { header: "verification_method", field: "verificationMethod" },
  { header: "quote_valid_until", field: "quoteValidUntil" },
  { header: "deduction_terms", field: "deductionTerms" },
  { header: "memo", field: "memo" },
];
export const CSV_REQUIRED_HEADERS = ["price_type", "amount", "source_name", "checked_date"];
const PRICE_RECORD_HEADERS = ["input_route", "is_demo", "item_name", "item_id", "included_in_comparison"];

export const MAX_CSV_ROWS = 1000;
export const MAX_CSV_BYTES = 1_000_000;

type CsvRecord = { readonly line: number; readonly cells: string[] };

class CsvSyntaxError extends Error {
  constructor(line: number, message: string) {
    super(`${line}행: ${message}`);
  }
}

function readCsvRecords(text: string): CsvRecord[] {
  const rows: CsvRecord[] = [];
  let cells: string[] = [];
  let cell = "";
  let state: "plain" | "quoted" | "closed" = "plain";
  let line = 1;
  let start = 1;
  const finishRow = () => {
    if (cells.length > 0 || cell.trim() !== "" || state === "closed") {
      cells.push(cell);
      rows.push({ line: start, cells });
    }
    cells = [];
    cell = "";
    state = "plain";
  };
  const src = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src.charAt(i);
    if (ch === "\n" || ch === "\r") {
      const newline = ch === "\r" && src[i + 1] === "\n" ? "\r\n" : ch;
      i += newline.length - 1;
      line++;
      if (state === "quoted") cell += newline;
      else {
        finishRow();
        start = line;
      }
    } else if (state === "quoted") {
      if (ch !== '"') cell += ch;
      else if (src[i + 1] === '"') {
        cell += '"';
        i++;
      } else state = "closed";
    } else if (ch === ",") {
      cells.push(cell);
      cell = "";
      state = "plain";
    } else if (state === "closed") {
      throw new CsvSyntaxError(start, "닫는 따옴표 뒤에는 쉼표나 줄바꿈이 와야 합니다.");
    } else if (ch === '"') {
      if (cell !== "") throw new CsvSyntaxError(start, "따옴표가 있는 값은 칸 전체를 큰따옴표로 감싸 주세요.");
      state = "quoted";
    } else cell += ch;
  }
  if (state === "quoted") throw new CsvSyntaxError(start, "닫는 따옴표가 없습니다.");
  finishRow();
  return rows;
}

/** RFC 4180 파서. 따옴표 안의 쉼표·줄바꿈·"" 이스케이프를 처리한다. */
export function parseCsv(text: string): string[][] {
  return readCsvRecords(text).map(({ cells }) => cells);
}

const formulaPrefix = /^[=+\-@\t\r]/;
const escapedColumnsHeader = "escaped_columns";

export function escapeCsvCell(value: string): string {
  const v = formulaPrefix.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** 수식 보호 문자가 붙은 열을 명시해 원래 값의 작은따옴표와 구분한다. */
export function buildImportableCsv(headers: readonly string[], rows: readonly string[][]): string {
  const needsEscapeInfo = rows.some((row) => row.some((cell) => formulaPrefix.test(cell)));
  const lines = [(needsEscapeInfo ? [...headers, escapedColumnsHeader] : headers).join(",")];
  for (const cells of rows) {
    const encoded = cells.map(escapeCsvCell);
    if (needsEscapeInfo) {
      const protectedHeaders = headers.filter((_, index) => formulaPrefix.test(cells[index] ?? ""));
      encoded.push(protectedHeaders.join(" "));
    }
    lines.push(encoded.join(","));
  }
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}

export type CsvRowError = { line: number; messages: string[] };
export type CsvPlan<Value> = {
  headerError: string | null;
  valid: { line: number; value: Value }[];
  errors: CsvRowError[];
};
export type CsvPrice = ValidPriceInput & { readonly includedInComparison: boolean };
export type CsvImportPlan = CsvPlan<CsvPrice>;
type CsvTarget = { readonly id: number; readonly name: string; readonly isDemo: boolean };

type CsvFormat<Field extends string> = {
  readonly columns: readonly { readonly header: string; readonly field: Field }[];
  readonly required: readonly string[];
  readonly metadata: readonly string[];
  readonly isDemo: boolean;
  readonly maxRows: number;
};

export function planCsvRows<Field extends string, Value>(
  text: string,
  format: CsvFormat<Field>,
  validate: (raw: Partial<Record<Field, string>>, metadata: ReadonlyMap<string, string>) => { value: Value } | { messages: string[] },
): CsvPlan<Value> {
  const plan: CsvPlan<Value> = { headerError: null, valid: [], errors: [] };
  let rows: CsvRecord[];
  try {
    rows = readCsvRecords(text);
  } catch (error) {
    if (!(error instanceof CsvSyntaxError)) throw error;
    return { ...plan, headerError: error.message };
  }
  const [first, ...records] = rows;
  if (!first) return { ...plan, headerError: "빈 파일입니다. 첫 줄에 열 이름이 있어야 합니다." };
  const headers = first.cells.map((h) => h.trim().toLowerCase());
  if (headers.includes("")) return { ...plan, headerError: "이름이 비어 있는 열이 있습니다." };
  const names = new Set<string>();
  for (const header of headers) {
    if (names.has(header)) return { ...plan, headerError: `같은 열 이름이 두 번 이상 있습니다: ${header}` };
    names.add(header);
  }
  const missing = format.required.filter((h) => !headers.includes(h));
  if (missing.length) return { ...plan, headerError: `필수 열이 없습니다: ${missing.join(", ")}` };
  const known = new Set([...format.columns.map((c) => c.header), ...format.metadata, escapedColumnsHeader]);
  const unknown = headers.filter((h) => !known.has(h));
  if (unknown.length) return { ...plan, headerError: `알 수 없는 열이 있습니다: ${unknown.join(", ")}` };
  if (records.length > format.maxRows) return { ...plan, headerError: `한 번에 ${format.maxRows}행까지 가져올 수 있습니다.` };

  const fields = new Map(format.columns.map((col) => [col.header, col.field]));
  const escapedIndex = headers.indexOf(escapedColumnsHeader);
  for (const { line, cells } of records) {
    if (cells.length !== headers.length) {
      plan.errors.push({ line, messages: [`머리글은 ${headers.length}열인데 이 행은 ${cells.length}열입니다. 빈 칸의 쉼표와 값 안의 따옴표를 확인해 주세요.`] });
      continue;
    }
    const escaped = new Set((cells[escapedIndex] ?? "").split(" "));
    const raw: Partial<Record<Field, string>> = {};
    const metadata = new Map<string, string>();
    headers.forEach((header, index) => {
      const cell = cells[index] ?? "";
      const value = escaped.has(header) && cell.startsWith("'") && formulaPrefix.test(cell.slice(1)) ? cell.slice(1) : cell;
      const field = fields.get(header);
      if (field !== undefined) raw[field] = value;
      else metadata.set(header, value);
    });
    const mode = metadata.get("is_demo")?.trim().toLowerCase();
    if (mode && mode !== String(format.isDemo)) {
      const message = mode === "true" || mode === "false"
        ? `이 행은 ${mode === "true" ? "데모" : "실제"} 자료입니다. 현재 모드와 달라 건너뜁니다.`
        : "is_demo에는 true 또는 false를 적어 주세요.";
      plan.errors.push({ line, messages: [message] });
      continue;
    }
    const result = validate(raw, metadata);
    if ("messages" in result) plan.errors.push({ line, messages: result.messages });
    else plan.valid.push({ line, value: result.value });
  }
  return plan;
}

export function planCsvImport(
  text: string,
  today: string,
  existing: { sourceName: string; externalId: string | null; normalizedUrl: string | null }[],
  target: CsvTarget,
): CsvImportPlan {
  const headerLabel = new Map(CSV_COLUMNS.map((c) => [c.field, c.header]));
  const seen = [...existing];
  return planCsvRows<PriceField, CsvPrice>(text, {
    columns: CSV_COLUMNS,
    required: CSV_REQUIRED_HEADERS,
    metadata: PRICE_RECORD_HEADERS,
    isDemo: target.isDemo,
    maxRows: MAX_CSV_ROWS,
  }, (raw, metadata) => {
    const name = metadata.get("item_name")?.trim();
    const id = metadata.get("item_id")?.trim();
    if ((name && name !== target.name) || (id && id !== String(target.id))) {
      return { messages: [`이 행의 물건(${name || "이름 없음"}${id ? ` #${id}` : ""})이 선택한 물건(${target.name} #${target.id})과 다릅니다.`] };
    }
    const inclusion = metadata.get("included_in_comparison")?.trim().toLowerCase();
    if (inclusion && inclusion !== "true" && inclusion !== "false") {
      return { messages: ["included_in_comparison에는 true 또는 false를 적어 주세요."] };
    }
    const result = validatePriceInput(raw, { route: "CSV", today });
    if (!result.ok) return {
      messages: Object.entries(result.errors).map(([f, m]) => `${headerLabel.get(f as PriceField) ?? f}: ${m}`),
    };
    const matches = seen.filter((s) => isSameListing(s, result.value));
    if (matches.length > 1) {
      return { messages: ["출처 ID와 원문 URL이 서로 다른 자료를 가리켜 건너뜁니다(충돌, 휴지통 포함). 입력한 ID와 URL을 확인해 주세요."] };
    }
    if (matches.length === 1) {
      return { messages: ["이미 등록된 매물(휴지통 포함)과 출처 ID 또는 URL이 같아 건너뜁니다(중복)."] };
    }
    seen.push(result.value);
    return { value: { ...result.value, includedInComparison: inclusion !== "false" } };
  });
}

export type ExportRow = {
  priceType: PriceType;
  amountMinor: number;
  currency: Currency;
  fxRateE4: number | null;
  fxDate: string | null;
  sourceName: string;
  sourceUrl: string | null;
  externalId: string | null;
  checkedDate: string;
  tradeDate: string | null;
  productIdentifier: string | null;
  condition: string | null;
  components: string | null;
  componentsMatch: string;
  bundleType: string;
  shippingIncluded: string;
  verificationMethod: string | null;
  quoteValidUntil: string | null;
  deductionTerms: string | null;
  memo: string | null;
  inputRoute: InputRoute;
  isDemo: boolean;
  itemName: string;
  itemId: number;
  includedInComparison: boolean;
};

export function buildCsv(rows: ExportRow[]): string {
  const headers = [...CSV_COLUMNS.map((c) => c.header), ...PRICE_RECORD_HEADERS];
  return buildImportableCsv(headers, rows.map((r) => [
    r.priceType,
    minorToPlain(r.amountMinor, r.currency),
    r.currency,
    r.fxRateE4 === null ? "" : fxRateToPlain(r.fxRateE4),
    r.fxDate ?? "",
    r.sourceName,
    r.sourceUrl ?? "",
    r.externalId ?? "",
    r.checkedDate,
    r.tradeDate ?? "",
    r.productIdentifier ?? "",
    r.condition ?? "",
    r.components ?? "",
    r.componentsMatch,
    r.bundleType,
    r.shippingIncluded,
    r.verificationMethod ?? "",
    r.quoteValidUntil ?? "",
    r.deductionTerms ?? "",
    r.memo ?? "",
    r.inputRoute,
    r.isDemo ? "true" : "false",
    r.itemName,
    String(r.itemId),
    String(r.includedInComparison),
  ]));
}
