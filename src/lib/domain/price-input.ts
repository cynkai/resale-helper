// 가격 자료 입력 검증. 직접 입력 폼, CSV 가져오기, (향후) API 어댑터가 모두 이 함수를 거친다.

import { z } from "zod";
import { parseAmount } from "./money";
import { normalizeUrl } from "./url";
import {
  BUNDLE_TYPES,
  CONDITIONS,
  CURRENCIES,
  PRICE_TYPES,
  TRI_STATES,
  type BundleType,
  type Condition,
  type Currency,
  type InputRoute,
  type PriceType,
  type TriState,
} from "./types";

export type PriceInputRaw = Partial<Record<PriceField, string>>;

export const PRICE_FIELDS = [
  "priceType",
  "amount",
  "currency",
  "sourceName",
  "sourceUrl",
  "externalId",
  "checkedDate",
  "tradeDate",
  "productIdentifier",
  "condition",
  "components",
  "bundleType",
  "shippingIncluded",
  "verificationMethod",
  "quoteValidUntil",
  "deductionTerms",
  "memo",
] as const;
export type PriceField = (typeof PRICE_FIELDS)[number];

export type ValidPriceInput = {
  priceType: PriceType;
  amountMinor: number;
  currency: Currency;
  sourceName: string;
  sourceUrl: string | null;
  normalizedUrl: string | null;
  externalId: string | null;
  checkedDate: string;
  tradeDate: string | null;
  productIdentifier: string | null;
  condition: Condition | null;
  components: string | null;
  bundleType: BundleType;
  shippingIncluded: TriState;
  verificationMethod: string | null;
  quoteValidUntil: string | null;
  deductionTerms: string | null;
  memo: string | null;
};

export type PriceValidation =
  | { ok: true; value: ValidPriceInput }
  | { ok: false; errors: Partial<Record<PriceField, string>> };

export type PriceInputContext = {
  route: InputRoute;
  today: string; // YYYY-MM-DD
  /**
   * API 경로에서만 의미가 있다. 해당 제공자가 "실제 체결가격을 제공한다"고 공식 문서로 확인된 경우에만 true.
   * 직접 입력·CSV에서는 이 값과 무관하게 VERIFIED_SALE을 거부한다.
   */
  providerAttestsVerifiedSales?: boolean;
};

export function isValidYmd(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

const text = (max: number) => z.string().trim().max(max, `${max}자 이내로 입력해 주세요.`);
const optionalText = (max: number) => text(max).transform((v) => (v === "" ? null : v));
const optionalDate = z
  .string()
  .trim()
  .refine((v) => v === "" || isValidYmd(v), "날짜는 YYYY-MM-DD 형식으로 입력해 주세요.")
  .transform((v) => (v === "" ? null : v));

const baseSchema = z.object({
  priceType: z.enum(PRICE_TYPES, "가격 유형을 선택해 주세요."),
  amount: z.string(),
  currency: z.enum(CURRENCIES, "지원하지 않는 통화입니다(KRW, USD, JPY, EUR)."),
  sourceName: text(100).min(1, "출처 이름(업체명·플랫폼명)을 입력해 주세요."),
  sourceUrl: z.string().trim().max(2000, "URL이 너무 깁니다."),
  externalId: optionalText(200),
  checkedDate: z.string().trim().refine(isValidYmd, "확인일을 YYYY-MM-DD 형식으로 입력해 주세요."),
  tradeDate: optionalDate,
  productIdentifier: optionalText(100),
  condition: z
    .string()
    .trim()
    .refine((v) => v === "" || (CONDITIONS as readonly string[]).includes(v), "상태 값이 올바르지 않습니다.")
    .transform((v) => (v === "" ? null : (v as Condition))),
  components: optionalText(500),
  bundleType: z.enum(BUNDLE_TYPES, "단품/묶음 값이 올바르지 않습니다(SINGLE 또는 BUNDLE)."),
  shippingIncluded: z.enum(TRI_STATES, "배송비 포함 여부 값이 올바르지 않습니다(YES, NO, UNKNOWN)."),
  verificationMethod: optionalText(500),
  quoteValidUntil: optionalDate,
  deductionTerms: optionalText(500),
  memo: optionalText(1000),
});

export function validatePriceInput(raw: PriceInputRaw, ctx: PriceInputContext): PriceValidation {
  const withDefaults = {
    priceType: raw.priceType?.trim() ?? "",
    amount: raw.amount ?? "",
    currency: (raw.currency?.trim() || "KRW").toUpperCase(),
    sourceName: raw.sourceName ?? "",
    sourceUrl: raw.sourceUrl ?? "",
    externalId: raw.externalId ?? "",
    checkedDate: raw.checkedDate ?? "",
    tradeDate: raw.tradeDate ?? "",
    productIdentifier: raw.productIdentifier ?? "",
    condition: raw.condition ?? "",
    components: raw.components ?? "",
    bundleType: (raw.bundleType?.trim() || "SINGLE").toUpperCase(),
    shippingIncluded: (raw.shippingIncluded?.trim() || "UNKNOWN").toUpperCase(),
    verificationMethod: raw.verificationMethod ?? "",
    quoteValidUntil: raw.quoteValidUntil ?? "",
    deductionTerms: raw.deductionTerms ?? "",
    memo: raw.memo ?? "",
  };
  withDefaults.priceType = withDefaults.priceType.toUpperCase();
  withDefaults.condition = withDefaults.condition.trim().toUpperCase();

  const errors: Partial<Record<PriceField, string>> = {};
  const parsed = baseSchema.safeParse(withDefaults);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = issue.path[0] as PriceField | undefined;
      if (field && !errors[field]) errors[field] = issue.message;
    }
  }
  const d = parsed.success ? parsed.data : null;

  // 유형 승격 방지: 앱 내 공식 제공자(API) 외의 경로(직접 입력·CSV·확장·가져오기 API)는 어떤 경우에도 VERIFIED_SALE이 될 수 없다.
  if (withDefaults.priceType === "VERIFIED_SALE") {
    if (ctx.route !== "API") {
      errors.priceType =
        "직접 입력·CSV·확장·가져오기 API 자료는 '검증된 체결가'로 저장할 수 없습니다. 직접 거래한 금액이면 USER_REPORTED(직접 입력한 거래가), 판매완료 게시글이면 SOLD_LISTING(판매완료 게시가)을 사용해 주세요.";
    } else if (!ctx.providerAttestsVerifiedSales) {
      errors.priceType = "이 출처는 실제 체결가격 제공이 확인되지 않아 '검증된 체결가'로 저장할 수 없습니다.";
    } else if (!withDefaults.verificationMethod.trim()) {
      errors.verificationMethod = "검증된 체결가는 검증 근거를 함께 저장해야 합니다.";
    }
  }

  // 금액
  let amountMinor = 0;
  const currency = (CURRENCIES as readonly string[]).includes(withDefaults.currency)
    ? (withDefaults.currency as Currency)
    : null;
  if (currency) {
    const a = parseAmount(withDefaults.amount, currency);
    if (!a.ok) errors.amount = a.error;
    else if (a.minor <= 0) errors.amount = "금액은 0보다 커야 합니다.";
    else amountMinor = a.minor;
  }

  // URL: 형식만 확인한다. URL이 있다고 검증된 가격으로 취급하지 않는다.
  let sourceUrl: string | null = null;
  let normalizedUrl: string | null = null;
  if (withDefaults.sourceUrl.trim() !== "") {
    const u = normalizeUrl(withDefaults.sourceUrl);
    if (!u.ok) errors.sourceUrl = errors.sourceUrl ?? u.error;
    else {
      sourceUrl = u.url;
      normalizedUrl = u.normalized;
    }
  }

  if (d) {
    if (d.checkedDate > ctx.today) errors.checkedDate = "확인일은 오늘 이후일 수 없습니다.";
    if (d.tradeDate && d.tradeDate > ctx.today) errors.tradeDate = "거래일은 오늘 이후일 수 없습니다.";
    if (d.priceType !== "BUYBACK_QUOTE" && (d.quoteValidUntil || d.deductionTerms)) {
      const msg = "유효기간·감액 조건은 매입 견적에만 입력할 수 있습니다.";
      if (d.quoteValidUntil) errors.quoteValidUntil = msg;
      else errors.deductionTerms = msg;
    }
    if (d.priceType === "BUYBACK_QUOTE" && !sourceUrl && !errors.sourceUrl && !d.memo) {
      errors.memo = "원문 URL이 없는 견적은 어떻게 받았는지(전화·방문·앱 화면 등) 메모를 남겨 주세요.";
    }
    if (d.priceType === "ASKING" && d.tradeDate) {
      errors.tradeDate = "판매 중 희망가에는 거래일이 없습니다. 비워 두세요.";
    }
  }

  if (Object.keys(errors).length > 0 || !d || !currency) return { ok: false, errors };
  return {
    ok: true,
    value: {
      priceType: d.priceType,
      amountMinor,
      currency,
      sourceName: d.sourceName,
      sourceUrl,
      normalizedUrl,
      externalId: d.externalId,
      checkedDate: d.checkedDate,
      tradeDate: d.tradeDate,
      productIdentifier: d.productIdentifier,
      condition: d.condition,
      components: d.components,
      bundleType: d.bundleType,
      shippingIncluded: d.shippingIncluded,
      verificationMethod: d.verificationMethod,
      quoteValidUntil: d.quoteValidUntil,
      deductionTerms: d.deductionTerms,
      memo: d.memo,
    },
  };
}
