// 가격 자료 CSV 가져오기/내보내기. 외부 라이브러리 없이 RFC 4180 방식으로 처리한다.

import { isSameListing } from "./compare";
import { minorToPlain } from "./money";
import {
  validatePriceInput,
  type PriceField,
  type PriceInputRaw,
  type ValidPriceInput,
} from "./price-input";
import type { Currency, InputRoute, PriceType } from "./types";

// CSV 열 이름(snake_case) ↔ 내부 필드
export const CSV_COLUMNS: { header: string; field: PriceField }[] = [
  { header: "price_type", field: "priceType" },
  { header: "amount", field: "amount" },
  { header: "currency", field: "currency" },
  { header: "source_name", field: "sourceName" },
  { header: "source_url", field: "sourceUrl" },
  { header: "external_id", field: "externalId" },
  { header: "checked_date", field: "checkedDate" },
  { header: "trade_date", field: "tradeDate" },
  { header: "product_identifier", field: "productIdentifier" },
  { header: "condition", field: "condition" },
  { header: "components", field: "components" },
  { header: "bundle_type", field: "bundleType" },
  { header: "shipping_included", field: "shippingIncluded" },
  { header: "verification_method", field: "verificationMethod" },
  { header: "quote_valid_until", field: "quoteValidUntil" },
  { header: "deduction_terms", field: "deductionTerms" },
  { header: "memo", field: "memo" },
];
export const CSV_REQUIRED_HEADERS = ["price_type", "amount", "source_name", "checked_date"];
// 내보내기 전용 열(가져올 때는 무시)
export const CSV_EXPORT_ONLY_HEADERS = ["input_route", "is_demo", "item_name"];

export const MAX_CSV_ROWS = 1000;
export const MAX_CSV_BYTES = 1_000_000;

/** RFC 4180 파서. 따옴표 안의 쉼표·줄바꿈·"" 이스케이프를 처리한다. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else cell += ch;
    } else if (ch === '"' && cell === "") {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0]!.trim() === ""));
}

/**
 * 스프레드시트 수식 주입 방지: =, +, -, @, 탭, CR로 시작하는 셀 앞에 작은따옴표를 붙인다.
 * 그 뒤 필요하면 따옴표로 감싼다.
 */
export function escapeCsvCell(value: string): string {
  let v = value;
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  if (/[",\n\r]/.test(v)) v = `"${v.replace(/"/g, '""')}"`;
  return v;
}

export type CsvRowError = { line: number; messages: string[] };
export type CsvImportPlan = {
  headerError: string | null;
  valid: { line: number; value: ValidPriceInput }[];
  errors: CsvRowError[];
};

/**
 * CSV 텍스트를 검증해 가져오기 계획을 만든다(DB에 쓰지 않음).
 * existing: 같은 물건에 이미 저장된 자료(중복 판별용).
 */
export function planCsvImport(
  text: string,
  today: string,
  existing: { sourceName: string; externalId: string | null; normalizedUrl: string | null }[],
): CsvImportPlan {
  const plan: CsvImportPlan = { headerError: null, valid: [], errors: [] };
  const rows = parseCsv(text);
  if (rows.length === 0) {
    plan.headerError = "빈 파일입니다. 첫 줄에 열 이름이 있어야 합니다.";
    return plan;
  }
  const headers = rows[0]!.map((h) => h.trim().toLowerCase());
  const missing = CSV_REQUIRED_HEADERS.filter((h) => !headers.includes(h));
  if (missing.length > 0) {
    plan.headerError = `필수 열이 없습니다: ${missing.join(", ")}`;
    return plan;
  }
  const known = new Set([...CSV_COLUMNS.map((c) => c.header), ...CSV_EXPORT_ONLY_HEADERS]);
  const unknown = headers.filter((h) => h !== "" && !known.has(h));
  if (unknown.length > 0) {
    plan.headerError = `알 수 없는 열이 있습니다: ${unknown.join(", ")}`;
    return plan;
  }
  if (rows.length - 1 > MAX_CSV_ROWS) {
    plan.headerError = `한 번에 ${MAX_CSV_ROWS}행까지 가져올 수 있습니다.`;
    return plan;
  }

  const headerLabel = new Map(CSV_COLUMNS.map((c) => [c.field, c.header]));
  const seen = [...existing];
  for (let i = 1; i < rows.length; i++) {
    const line = i + 1; // 사람이 보는 줄 번호(머리글 = 1)
    const cells = rows[i]!;
    const raw: PriceInputRaw = {};
    for (const col of CSV_COLUMNS) {
      const idx = headers.indexOf(col.header);
      if (idx >= 0) raw[col.field] = cells[idx] ?? "";
    }
    const result = validatePriceInput(raw, { route: "CSV", today });
    if (!result.ok) {
      plan.errors.push({
        line,
        messages: Object.entries(result.errors).map(([f, m]) => `${headerLabel.get(f as PriceField) ?? f}: ${m}`),
      });
      continue;
    }
    if (seen.some((s) => isSameListing(s, result.value))) {
      plan.errors.push({ line, messages: ["이미 등록된 매물과 출처 ID 또는 URL이 같아 건너뜁니다(중복)."] });
      continue;
    }
    seen.push(result.value);
    plan.valid.push({ line, value: result.value });
  }
  return plan;
}

export type ExportRow = {
  priceType: PriceType;
  amountMinor: number;
  currency: Currency;
  sourceName: string;
  sourceUrl: string | null;
  externalId: string | null;
  checkedDate: string;
  tradeDate: string | null;
  productIdentifier: string | null;
  condition: string | null;
  components: string | null;
  bundleType: string;
  shippingIncluded: string;
  verificationMethod: string | null;
  quoteValidUntil: string | null;
  deductionTerms: string | null;
  memo: string | null;
  inputRoute: InputRoute;
  isDemo: boolean;
  itemName: string;
};

export function buildCsv(rows: ExportRow[]): string {
  const headers = [...CSV_COLUMNS.map((c) => c.header), ...CSV_EXPORT_ONLY_HEADERS];
  const lines = [headers.join(",")];
  for (const r of rows) {
    const cells = [
      r.priceType,
      minorToPlain(r.amountMinor, r.currency),
      r.currency,
      r.sourceName,
      r.sourceUrl ?? "",
      r.externalId ?? "",
      r.checkedDate,
      r.tradeDate ?? "",
      r.productIdentifier ?? "",
      r.condition ?? "",
      r.components ?? "",
      r.bundleType,
      r.shippingIncluded,
      r.verificationMethod ?? "",
      r.quoteValidUntil ?? "",
      r.deductionTerms ?? "",
      r.memo ?? "",
      r.inputRoute,
      r.isDemo ? "true" : "false",
      r.itemName,
    ];
    lines.push(cells.map(escapeCsvCell).join(","));
  }
  // BOM: 엑셀에서 한글이 깨지지 않도록 한다.
  return "﻿" + lines.join("\r\n") + "\r\n";
}
