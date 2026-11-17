// 사람이 읽을 수 있는 전체 내보내기(JSON). 현재 모드의 물건·가격 자료·비용 계산·판매 결과를 물건 단위로 묶는다.
// - 가격 유형은 그대로 싣고 서로 합치지 않는다. 물건을 가로지르는 총액도 만들지 않는다.
// - "모름"은 null로 싣는다(0으로 바꾸지 않는다).
// - 설정(가져오기 토큰 해시 등)은 싣지 않는다.

import type { CostScenario, Item, PriceHistoryRow, PriceRecord, SaleResult } from "../db/schema";
import { convertToKrw, fxRateToPlain } from "./fx";
import { computeNet } from "./net";
import { reviewRow } from "./review";
import { chosenScenario } from "./scenario";

export const FULL_EXPORT_VERSION = 1;

export type FullExportSource = {
  item: Item;
  prices: PriceRecord[];
  /** 가격 자료 id → 이전 값(오래된 것부터). 없으면 빈 목록으로 본다. */
  history?: Map<number, PriceHistoryRow[]>;
  scenarios: CostScenario[];
  saleResult: SaleResult | undefined;
};

export function buildFullExport(input: { demo: boolean; exportedDate: string; sources: FullExportSource[] }) {
  return {
    format: "resale-helper-export",
    version: FULL_EXPORT_VERSION,
    exportedDate: input.exportedDate,
    mode: input.demo ? "DEMO" : "REAL",
    notes: [
      "금액은 원(KRW) 정수입니다. null은 '모름'이며 0원과 다릅니다.",
      "외화 가격 자료의 amount는 그 통화의 최소단위 정수이고, krwReference는 사용자가 입력한 환율과 기준일로 환산한 참고값입니다(비교·요약에 쓰지 않음).",
      "가격 유형(priceType)이 다른 자료는 서로 비교하거나 합치지 않습니다.",
      "scenarios의 channel은 사용자가 적은 판매처 이름이고(''은 이름 없음), isPrimary는 같은 방식의 계산이 여러 개일 때 사용자가 기준으로 표시한 것입니다.",
      "previousValues는 같은 매물을 고치기 전의 값이며 별도 표본이 아닙니다.",
      "판매 결과는 사용자가 기록한 값이며 외부에서 검증된 체결가가 아닙니다.",
      ...(input.demo ? ["데모 모드의 가상 자료입니다. 실제 시세가 아닙니다."] : []),
    ],
    itemCount: input.sources.length,
    items: input.sources.map(({ item, prices, history, scenarios, saleResult }) => {
      const chosen = chosenScenario(item, scenarios);
      return {
        id: item.id,
        category: item.category,
        status: item.status,
        name: item.name,
        identifier: item.identifier,
        condition: item.condition,
        defects: item.defects,
        components: item.components,
        memo: item.memo,
        book:
          item.category === "BOOK"
            ? {
                author: item.author,
                publisher: item.publisher,
                edition: item.edition,
                hasWriting: item.hasWriting,
                hasUnderline: item.hasUnderline,
                hasDamage: item.hasDamage,
                hasSupplement: item.hasSupplement,
              }
            : null,
        createdAt: item.createdAt,
        prices: prices.map((p) => ({
          id: p.id,
          priceType: p.priceType,
          amount: p.amountMinor,
          currency: p.currency,
          // 외화 자료의 환산 참고(사용자가 입력한 환율 기준). 원화 자료와 섞어 쓰지 않는다.
          krwReference:
            p.currency !== "KRW" && p.fxRateE4 !== null && p.fxDate !== null
              ? { amount: convertToKrw(p.amountMinor, p.currency, p.fxRateE4), rate: fxRateToPlain(p.fxRateE4), rateDate: p.fxDate }
              : null,
          sourceName: p.sourceName,
          sourceUrl: p.sourceUrl,
          externalId: p.externalId,
          checkedDate: p.checkedDate,
          tradeDate: p.tradeDate,
          condition: p.condition,
          components: p.components,
          componentsMatch: p.componentsMatch,
          bundleType: p.bundleType,
          shippingIncluded: p.shippingIncluded,
          verificationMethod: p.verificationMethod,
          quoteValidUntil: p.quoteValidUntil,
          deductionTerms: p.deductionTerms,
          inputRoute: p.inputRoute,
          includedInComparison: p.includedInComparison,
          memo: p.memo,
          // 같은 매물을 고치기 전의 값. 표본으로 세지 않는다.
          previousValues: (history?.get(p.id) ?? []).map((h) => ({
            priceType: h.priceType,
            amount: h.amountMinor,
            currency: h.currency,
            checkedDate: h.checkedDate,
          })),
        })),
        scenarios: scenarios.map((s) => {
          const net = computeNet(s);
          return {
            method: s.method,
            channel: s.channel,
            isPrimary: s.isPrimary,
            saleAmount: s.saleAmount,
            basisPriceRecordId: s.basisPriceRecordId,
            basisPriceType: s.basisPriceType,
            feeMode: s.feeMode,
            feeAmount: s.feeAmount,
            feeRateBp: s.feeRateBp,
            shipping: s.shipping,
            packing: s.packing,
            transport: s.transport,
            expectedMinutes: s.expectedMinutes,
            memo: s.memo,
            computed: { fee: net.fee, complete: net.complete, missing: net.missing, net: net.net },
          };
        }),
        chosen:
          item.chosenMethod === null
            ? null
            : { method: item.chosenMethod, channel: item.chosenChannel ?? "", saleAmount: item.chosenSaleAmount, netAmount: item.chosenNetAmount, chosenAt: item.chosenAt },
        saleResult: saleResult
          ? {
              channel: saleResult.channel,
              soldDate: saleResult.soldDate,
              amount: saleResult.amount,
              costTotal: saleResult.costTotal,
              minutesSpent: saleResult.minutesSpent,
              memo: saleResult.memo,
              review: reviewRow({
                chosenSaleAmount: item.chosenSaleAmount,
                chosenNetAmount: item.chosenNetAmount,
                expectedMinutes: chosen?.expectedMinutes ?? null,
                amount: saleResult.amount,
                costTotal: saleResult.costTotal,
                minutesSpent: saleResult.minutesSpent,
              }),
            }
          : null,
      };
    }),
  };
}

export type FullExport = ReturnType<typeof buildFullExport>;
