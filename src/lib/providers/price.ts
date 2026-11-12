// 가격정보 제공자 어댑터 인터페이스. 서지정보 제공자와 분리되어 있다.
//
// 현재 등록된 제공자는 없다(2026-11 기준 이용 가능한 공식 가격 API를 확보하지 못함: docs/data-sources.md 참고).
// 그래서 가격 자료는 직접 입력과 CSV로만 들어온다. 조회가 되는 것처럼 보이는 가짜 구현은 두지 않는다.

import type { PriceInputRaw } from "../domain/price-input";
import type { PriceType } from "../domain/types";

export interface PriceProvider {
  id: string;
  label: string;
  /** 이 제공자가 돌려주는 가격의 의미. 공식 문서로 확인한 유형만 적는다. */
  priceTypes: PriceType[];
  /**
   * 실제 체결가격을 제공한다고 공식 문서로 확인된 경우에만 true.
   * true인 제공자만 VERIFIED_SALE을 만들 수 있고, 그때도 검증 근거(verificationMethod)가 필요하다.
   */
  attestsVerifiedSales: boolean;
  isConfigured(): boolean;
  /** 결과는 validatePriceInput(route="API")을 거쳐 저장한다. */
  search(identifier: string): Promise<PriceInputRaw[]>;
}

export const priceProviders: PriceProvider[] = [];
