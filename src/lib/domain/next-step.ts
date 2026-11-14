// 물건마다 "다음에 할 일" 한 가지를 고른다. 이미 입력된 것만 보고 정하며, 판매를 권하거나 금액을 판단하지 않는다.

import type { ItemStatus, SaleMethod } from "./types";

export type NextStepInput = {
  status: ItemStatus;
  priceCount: number;
  scenarioCount: number;
  chosenMethod: SaleMethod | null;
  hasResult: boolean;
};

export type NextStepCode = "ADD_PRICES" | "ENTER_COSTS" | "CHOOSE_METHOD" | "POST_LISTING" | "RECORD_RESULT" | "DONE";

export const NEXT_STEP_LABEL: Record<NextStepCode, string> = {
  ADD_PRICES: "가격 자료 넣기",
  ENTER_COSTS: "판매 금액·비용 입력하기",
  CHOOSE_METHOD: "판매 방법 정하기",
  POST_LISTING: "판매글 복사해 올리기",
  RECORD_RESULT: "팔리면 판매 결과 기록하기",
  DONE: "판매 결과까지 기록함",
};

export function nextStep(s: NextStepInput): NextStepCode {
  if (s.hasResult) return "DONE";
  // 판매 완료로 표시했는데 결과 기록이 없으면 기록이 먼저다.
  if (s.status === "SOLD") return "RECORD_RESULT";
  if (s.priceCount === 0) return "ADD_PRICES";
  if (s.scenarioCount === 0) return "ENTER_COSTS";
  if (s.chosenMethod === null) return "CHOOSE_METHOD";
  // 업체에 넘기기로 했으면 판매글이 필요 없다.
  if (s.status === "OWNED" && s.chosenMethod === "DIRECT") return "POST_LISTING";
  return "RECORD_RESULT";
}
