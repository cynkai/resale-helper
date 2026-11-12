// 도메인 상수와 한국어 라벨. 화면·서버 검증·CSV가 모두 이 정의를 공유한다.

export const PRICE_TYPES = [
  "ASKING",
  "SOLD_LISTING",
  "VERIFIED_SALE",
  "BUYBACK_QUOTE",
  "USER_REPORTED",
] as const;
export type PriceType = (typeof PRICE_TYPES)[number];

export const PRICE_TYPE_INFO: Record<PriceType, { label: string; help: string; summaryLabel: string }> = {
  ASKING: {
    label: "판매 중 희망가",
    help: "현재 판매글에 올라와 있는 희망 가격입니다. 이 가격에 팔렸다는 뜻이 아닙니다.",
    summaryLabel: "판매 중 희망가 중앙값",
  },
  SOLD_LISTING: {
    label: "판매완료 게시가",
    help: "판매완료로 표시된 게시글의 가격입니다. 실제 합의된 금액은 다를 수 있습니다.",
    summaryLabel: "판매완료 게시가 중앙값",
  },
  VERIFIED_SALE: {
    label: "검증된 체결가",
    help: "실제 체결가격을 제공한다고 확인된 출처의 거래가격입니다. 직접 입력·CSV로는 등록할 수 없습니다.",
    summaryLabel: "검증된 체결가 중앙값",
  },
  BUYBACK_QUOTE: {
    label: "매입 견적",
    help: "매입업체가 제시한 견적입니다. 유효기간이 있고 검수 후 감액될 수 있습니다.",
    summaryLabel: "매입 견적 중앙값",
  },
  USER_REPORTED: {
    label: "직접 입력한 거래가",
    help: "사용자가 직접 입력한 거래가격입니다. 외부에서 검증되지 않았습니다.",
    summaryLabel: "직접 입력한 거래가 중앙값",
  },
};

export const INPUT_ROUTES = ["MANUAL", "CSV", "API"] as const;
export type InputRoute = (typeof INPUT_ROUTES)[number];
export const INPUT_ROUTE_LABEL: Record<InputRoute, string> = {
  MANUAL: "직접 입력",
  CSV: "CSV 가져오기",
  API: "API 조회",
};

export const CATEGORIES = ["BOOK", "CONSOLE", "ELECTRONICS"] as const;
export type Category = (typeof CATEGORIES)[number];
export const CATEGORY_LABEL: Record<Category, string> = {
  BOOK: "도서",
  CONSOLE: "게임기",
  ELECTRONICS: "전자기기",
};

export const ITEM_STATUSES = ["OWNED", "LISTED", "SOLD"] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];
export const ITEM_STATUS_LABEL: Record<ItemStatus, string> = {
  OWNED: "보유 중",
  LISTED: "판매 중",
  SOLD: "판매 완료",
};

// 상태 등급. 등급 간 가격 보정 비율은 두지 않는다(근거 없는 보정 금지).
export const CONDITIONS = ["UNOPENED", "LIKE_NEW", "GOOD", "FAIR", "POOR", "BROKEN"] as const;
export type Condition = (typeof CONDITIONS)[number];
export const CONDITION_LABEL: Record<Condition, string> = {
  UNOPENED: "미개봉",
  LIKE_NEW: "사용감 거의 없음",
  GOOD: "사용감 적음",
  FAIR: "사용감 있음",
  POOR: "사용감 많음",
  BROKEN: "고장·부품용",
};

export const TRI_STATES = ["UNKNOWN", "YES", "NO"] as const;
export type TriState = (typeof TRI_STATES)[number];

export const BUNDLE_TYPES = ["SINGLE", "BUNDLE"] as const;
export type BundleType = (typeof BUNDLE_TYPES)[number];
export const BUNDLE_LABEL: Record<BundleType, string> = { SINGLE: "단품", BUNDLE: "묶음" };

export const SALE_METHODS = ["BUYBACK", "DIRECT"] as const;
export type SaleMethod = (typeof SALE_METHODS)[number];
export const SALE_METHOD_LABEL: Record<SaleMethod, string> = {
  BUYBACK: "업체에 판매(매입)",
  DIRECT: "개인에게 직접 판매",
};

// 지원 통화와 최소통화단위 자릿수. 금액은 항상 최소단위 정수로 저장한다.
export const CURRENCIES = ["KRW", "USD", "JPY", "EUR"] as const;
export type Currency = (typeof CURRENCIES)[number];
export const CURRENCY_EXPONENT: Record<Currency, number> = { KRW: 0, JPY: 0, USD: 2, EUR: 2 };

export const DISCLAIMER =
  "표시된 가격은 출처와 상품 상태에 따른 참고자료입니다. 실제 판매·매입 금액을 보장하지 않으며, 판매완료 게시가격은 최종 합의금액과 다를 수 있습니다.";

// 유형별 요약값(중앙값·범위)을 보여주는 최소 건수. MVP 표시 정책이며 통계적 정확성 기준이 아니다.
export const MIN_SAMPLES_FOR_SUMMARY = 3;
