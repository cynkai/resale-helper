// 가격 비교 규칙. 순수 함수이며 DB에 의존하지 않는다.
// 원칙: 유형이 다른 자료는 절대 합치지 않고, 제외한 자료는 사유와 함께 남긴다.

import { normalizeIdentifier } from "./isbn";
import { medianInt } from "./money";
import {
  MIN_SAMPLES_FOR_SUMMARY,
  PRICE_TYPES,
  type BundleType,
  type Condition,
  type Currency,
  type PriceType,
} from "./types";

export type ComparableItem = {
  identifier: string | null;
  condition: Condition;
};

export type ComparableRecord = {
  id: number;
  priceType: PriceType;
  amountMinor: number;
  currency: Currency;
  checkedDate: string;
  productIdentifier: string | null;
  condition: Condition | null;
  bundleType: BundleType;
  quoteValidUntil: string | null;
  includedInComparison: boolean;
};

export type ExclusionCode =
  | "USER_EXCLUDED"
  | "FOREIGN_CURRENCY"
  | "DIFFERENT_PRODUCT"
  | "BUNDLE"
  | "DIFFERENT_CONDITION"
  | "QUOTE_EXPIRED"
  | "OUT_OF_WINDOW";

export const EXCLUSION_LABEL: Record<ExclusionCode, string> = {
  USER_EXCLUDED: "직접 제외함",
  FOREIGN_CURRENCY: "외화 자료(원화 비교에서 제외)",
  DIFFERENT_PRODUCT: "다른 상품(식별정보 불일치)",
  BUNDLE: "묶음 상품",
  DIFFERENT_CONDITION: "상태가 다름",
  QUOTE_EXPIRED: "견적 유효기간 만료",
  OUT_OF_WINDOW: "기준 기간보다 오래됨",
};

export type WarningCode = "IDENTIFIER_UNCHECKED" | "CONDITION_UNCHECKED" | "OLD_DATA";
export const WARNING_LABEL: Record<WarningCode, string> = {
  IDENTIFIER_UNCHECKED: "상품 식별정보 미확인",
  CONDITION_UNCHECKED: "상태 미확인",
  OLD_DATA: "확인한 지 오래됨",
};

/** 기준 기간 안에 있더라도 이보다 오래 전에 확인한 자료는 "오래됨" 경고를 붙인다(표시 정책). */
export const OLD_DATA_DAYS = 90;

export type Classified<R extends ComparableRecord> = {
  record: R;
  eligible: boolean;
  exclusions: ExclusionCode[];
  warnings: WarningCode[];
};

export type TypeGroup<R extends ComparableRecord> = {
  priceType: PriceType;
  eligible: Classified<R>[];
  excluded: Classified<R>[];
  /** 적합 자료가 MIN_SAMPLES_FOR_SUMMARY건 이상일 때만 제공. 그 미만이면 null(개별 자료만 표시). */
  summary: { count: number; median: number; min: number; max: number } | null;
};

export type Comparison<R extends ComparableRecord> = {
  windowDays: number | null;
  groups: TypeGroup<R>[];
  eligibleCount: number;
  excludedCount: number;
};

export function daysBetween(fromYmd: string, toYmd: string): number {
  const a = Date.parse(`${fromYmd}T00:00:00Z`);
  const b = Date.parse(`${toYmd}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

export function isQuoteExpired(r: Pick<ComparableRecord, "priceType" | "quoteValidUntil">, today: string): boolean {
  return r.priceType === "BUYBACK_QUOTE" && r.quoteValidUntil !== null && r.quoteValidUntil < today;
}

export function classifyRecord<R extends ComparableRecord>(
  item: ComparableItem,
  record: R,
  today: string,
  windowDays: number | null,
): Classified<R> {
  const exclusions: ExclusionCode[] = [];
  const warnings: WarningCode[] = [];

  if (!record.includedInComparison) exclusions.push("USER_EXCLUDED");
  if (record.currency !== "KRW") exclusions.push("FOREIGN_CURRENCY");

  const itemId = normalizeIdentifier(item.identifier);
  const recId = normalizeIdentifier(record.productIdentifier);
  if (itemId && recId) {
    if (itemId !== recId) exclusions.push("DIFFERENT_PRODUCT");
  } else {
    warnings.push("IDENTIFIER_UNCHECKED");
  }

  if (record.bundleType === "BUNDLE") exclusions.push("BUNDLE");

  if (record.condition === null) warnings.push("CONDITION_UNCHECKED");
  else if (record.condition !== item.condition) exclusions.push("DIFFERENT_CONDITION");

  if (isQuoteExpired(record, today)) exclusions.push("QUOTE_EXPIRED");
  const age = daysBetween(record.checkedDate, today);
  if (windowDays !== null && age > windowDays) exclusions.push("OUT_OF_WINDOW");
  else if (age > OLD_DATA_DAYS) warnings.push("OLD_DATA");

  return { record, eligible: exclusions.length === 0, exclusions, warnings };
}

/**
 * 유형별로 나눠 비교 결과를 만든다.
 * - 유형이 다른 자료는 하나의 숫자로 합치지 않는다.
 * - 적합 자료가 3건 미만이면 요약값을 만들지 않는다.
 */
export function buildComparison<R extends ComparableRecord>(
  item: ComparableItem,
  records: R[],
  today: string,
  windowDays: number | null,
): Comparison<R> {
  const classified = records.map((r) => classifyRecord(item, r, today, windowDays));
  const groups: TypeGroup<R>[] = [];
  for (const priceType of PRICE_TYPES) {
    const ofType = classified.filter((c) => c.record.priceType === priceType);
    if (ofType.length === 0) continue;
    const eligible = ofType.filter((c) => c.eligible).sort((a, b) => a.record.amountMinor - b.record.amountMinor);
    const excluded = ofType.filter((c) => !c.eligible);
    const amounts = eligible.map((c) => c.record.amountMinor);
    const summary =
      amounts.length >= MIN_SAMPLES_FOR_SUMMARY
        ? { count: amounts.length, median: medianInt(amounts), min: amounts[0]!, max: amounts[amounts.length - 1]! }
        : null;
    groups.push({ priceType, eligible, excluded, summary });
  }
  return {
    windowDays,
    groups,
    eligibleCount: classified.filter((c) => c.eligible).length,
    excludedCount: classified.filter((c) => !c.eligible).length,
  };
}

// ---- 중복 판별 ----

export type DedupKeyed = { sourceName: string; externalId: string | null; normalizedUrl: string | null };

function sourceKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * 같은 매물인지 판단한다. 출처+외부 ID가 같거나 정규화 URL이 같을 때만 중복이다.
 * 금액·날짜가 같다는 이유만으로는 중복으로 보지 않는다.
 */
export function isSameListing(a: DedupKeyed, b: DedupKeyed): boolean {
  if (a.externalId && b.externalId && sourceKey(a.sourceName) === sourceKey(b.sourceName)) {
    if (a.externalId.trim() === b.externalId.trim()) return true;
  }
  if (a.normalizedUrl && b.normalizedUrl && a.normalizedUrl === b.normalizedUrl) return true;
  return false;
}
