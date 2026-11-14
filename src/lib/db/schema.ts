import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type {
  BundleType,
  Category,
  Condition,
  Currency,
  InputRoute,
  ItemStatus,
  PriceType,
  SaleMethod,
  TriState,
} from "../domain/types";

const timestamps = {
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
};

/** 보유 물건 */
export const items = sqliteTable(
  "items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    isDemo: integer("is_demo", { mode: "boolean" }).notNull().default(false),
    category: text("category").$type<Category>().notNull(),
    status: text("status").$type<ItemStatus>().notNull().default("OWNED"),
    name: text("name").notNull(), // 도서는 제목
    identifier: text("identifier"), // 도서: ISBN-13(정규화), 그 외: 모델명
    condition: text("condition").$type<Condition>().notNull(),
    defects: text("defects"),
    components: text("components"),
    memo: text("memo"),
    // 도서 전용
    author: text("author"),
    publisher: text("publisher"),
    edition: text("edition"),
    hasWriting: text("has_writing").$type<TriState>().notNull().default("UNKNOWN"),
    hasUnderline: text("has_underline").$type<TriState>().notNull().default("UNKNOWN"),
    hasDamage: text("has_damage").$type<TriState>().notNull().default("UNKNOWN"),
    hasSupplement: text("has_supplement").$type<TriState>().notNull().default("UNKNOWN"),
    // 판매 방식 선택 결과(선택 시점의 금액 스냅샷)
    chosenMethod: text("chosen_method").$type<SaleMethod>(),
    chosenSaleAmount: integer("chosen_sale_amount"),
    chosenNetAmount: integer("chosen_net_amount"), // 선택 당시 비용이 불완전했으면 null
    chosenAt: text("chosen_at"),
    ...timestamps,
  },
  (t) => [index("items_demo_idx").on(t.isDemo, t.status)],
);

/** 가격 자료. 유형(priceType)은 필수이며 유형이 다른 자료는 서로 합산하지 않는다. */
export const priceRecords = sqliteTable(
  "price_records",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    itemId: integer("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    isDemo: integer("is_demo", { mode: "boolean" }).notNull().default(false),
    priceType: text("price_type").$type<PriceType>().notNull(),
    amountMinor: integer("amount_minor").notNull(), // 최소통화단위 정수
    currency: text("currency").$type<Currency>().notNull().default("KRW"),
    sourceName: text("source_name").notNull(),
    sourceUrl: text("source_url"),
    normalizedUrl: text("normalized_url"),
    externalId: text("external_id"),
    checkedDate: text("checked_date").notNull(), // YYYY-MM-DD
    tradeDate: text("trade_date"),
    productIdentifier: text("product_identifier"),
    condition: text("condition").$type<Condition>(),
    components: text("components"),
    bundleType: text("bundle_type").$type<BundleType>().notNull().default("SINGLE"),
    shippingIncluded: text("shipping_included").$type<TriState>().notNull().default("UNKNOWN"),
    verificationMethod: text("verification_method"),
    quoteValidUntil: text("quote_valid_until"),
    deductionTerms: text("deduction_terms"),
    inputRoute: text("input_route").$type<InputRoute>().notNull(),
    memo: text("memo"),
    includedInComparison: integer("included_in_comparison", { mode: "boolean" }).notNull().default(true),
    ...timestamps,
  },
  (t) => [
    index("price_item_idx").on(t.itemId),
    // 같은 매물 중복 수집 방지: 출처+외부 ID, 또는 정규화 URL이 같으면 같은 매물로 본다.
    uniqueIndex("price_external_uq")
      .on(t.itemId, t.sourceName, t.externalId)
      .where(sql`${t.externalId} is not null`),
    uniqueIndex("price_url_uq")
      .on(t.itemId, t.normalizedUrl)
      .where(sql`${t.normalizedUrl} is not null`),
  ],
);

/**
 * 같은 매물의 이전 값. 가격 자료를 고칠 때 금액이나 확인일이 바뀌면 바뀌기 전 값을 여기에 남긴다.
 * 유형은 가격 자료를 따른다(이력은 비교·요약에 쓰지 않고 보여 주기만 한다).
 */
export const priceHistory = sqliteTable(
  "price_history",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    priceRecordId: integer("price_record_id")
      .notNull()
      .references(() => priceRecords.id, { onDelete: "cascade" }),
    priceType: text("price_type").$type<PriceType>().notNull(), // 바뀌기 전 유형
    amountMinor: integer("amount_minor").notNull(),
    currency: text("currency").$type<Currency>().notNull(),
    checkedDate: text("checked_date").notNull(),
    recordedAt: text("recorded_at").notNull().default(sql`(datetime('now'))`),
  },
  (t) => [index("price_history_record_idx").on(t.priceRecordId)],
);

/** 비용 시나리오: 물건별로 판매 방식(업체/개인)마다 하나 */
export const costScenarios = sqliteTable(
  "cost_scenarios",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    itemId: integer("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    method: text("method").$type<SaleMethod>().notNull(),
    saleAmount: integer("sale_amount").notNull(), // KRW
    basisPriceRecordId: integer("basis_price_record_id").references(() => priceRecords.id, {
      onDelete: "set null",
    }),
    // 저장 당시 기준 자료의 유형. 기준 자료가 삭제되어 id가 비어도 "자료 기준이었다"는 사실을 남긴다.
    basisPriceType: text("basis_price_type").$type<PriceType>(),
    feeMode: text("fee_mode").$type<"AMOUNT" | "RATE">().notNull().default("AMOUNT"),
    feeAmount: integer("fee_amount"), // null = 모름
    feeRateBp: integer("fee_rate_bp"), // null = 모름
    shipping: integer("shipping"),
    packing: integer("packing"),
    transport: integer("transport"),
    expectedMinutes: integer("expected_minutes"), // 사용자가 입력한 예상 소요시간
    memo: text("memo"),
    ...timestamps,
  },
  (t) => [uniqueIndex("scenario_item_method_uq").on(t.itemId, t.method)],
);

/** 실제 판매 결과(사용자 신고). VERIFIED_SALE과 별개로 저장한다. */
export const saleResults = sqliteTable("sale_results", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  itemId: integer("item_id")
    .notNull()
    .unique()
    .references(() => items.id, { onDelete: "cascade" }),
  channel: text("channel").notNull(),
  soldDate: text("sold_date").notNull(),
  amount: integer("amount").notNull(), // KRW
  costTotal: integer("cost_total"), // null = 모름
  minutesSpent: integer("minutes_spent"),
  memo: text("memo"),
  ...timestamps,
});

/**
 * 사용자 설정. 데모와 실제 모드가 각각 한 행씩만 가진다(is_demo가 기본키).
 * 값이 없으면(행 없음 또는 null) "아직 정하지 않음"이며 앱이 기본값을 채우지 않는다.
 */
export const userSettings = sqliteTable("user_settings", {
  isDemo: integer("is_demo", { mode: "boolean" }).primaryKey(),
  timeValuePerHour: integer("time_value_per_hour"), // 원/시간. null = 모름, 0 = 시간을 공짜로 봄
  // 가져오기 API 접근 설정(실제 모드 행에서만 쓴다). 토큰 원문은 저장하지 않고 SHA-256 해시만 둔다.
  importTokenHash: text("import_token_hash"), // null = 토큰 없음 → 가져오기 API 비활성
  importTokenCreatedAt: text("import_token_created_at"),
  importExtensionId: text("import_extension_id"), // 허용할 브라우저 확장 ID. null = 확장 요청 거부
  ...timestamps,
});

/** 외부 서지정보 조회 캐시 */
export const lookupCache = sqliteTable(
  "lookup_cache",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    provider: text("provider").notNull(),
    key: text("key").notNull(),
    payload: text("payload").notNull(), // JSON. 조회 결과 없음도 캐시한다.
    fetchedAt: text("fetched_at").notNull(),
  },
  (t) => [uniqueIndex("lookup_cache_uq").on(t.provider, t.key)],
);

export type Item = typeof items.$inferSelect;
export type PriceRecord = typeof priceRecords.$inferSelect;
export type PriceHistoryRow = typeof priceHistory.$inferSelect;
export type CostScenario = typeof costScenarios.$inferSelect;
export type SaleResult = typeof saleResults.$inferSelect;
export type UserSettings = typeof userSettings.$inferSelect;
