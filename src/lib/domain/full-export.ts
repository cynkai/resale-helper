// 사람이 읽을 수 있는 전체 내보내기(JSON). 현재 모드의 물건·가격 자료·비용 계산·판매 결과를 물건 단위로 묶는다.
// - 가격 유형은 그대로 싣고 서로 합치지 않는다. 물건을 가로지르는 총액도 만들지 않는다.
// - "모름"은 null로 싣는다(0으로 바꾸지 않는다).
// - 설정(가져오기 토큰 해시 등)은 싣지 않는다.

import type { CostScenario, Item, PriceRecord, SaleResult } from "../db/schema";
import { computeNet } from "./net";
import { reviewRow } from "./review";

export const FULL_EXPORT_VERSION = 1;

export type FullExportSource = {
  item: Item;
  prices: PriceRecord[];
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
      "가격 유형(priceType)이 다른 자료는 서로 비교하거나 합치지 않습니다.",
      "판매 결과는 사용자가 기록한 값이며 외부에서 검증된 체결가가 아닙니다.",
      ...(input.demo ? ["데모 모드의 가상 자료입니다. 실제 시세가 아닙니다."] : []),
    ],
    itemCount: input.sources.length,
    items: input.sources.map(({ item, prices, scenarios, saleResult }) => {
      const chosenScenario = scenarios.find((s) => s.method === item.chosenMethod);
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
          sourceName: p.sourceName,
          sourceUrl: p.sourceUrl,
          externalId: p.externalId,
          checkedDate: p.checkedDate,
          tradeDate: p.tradeDate,
          condition: p.condition,
          components: p.components,
          bundleType: p.bundleType,
          shippingIncluded: p.shippingIncluded,
          verificationMethod: p.verificationMethod,
          quoteValidUntil: p.quoteValidUntil,
          deductionTerms: p.deductionTerms,
          inputRoute: p.inputRoute,
          includedInComparison: p.includedInComparison,
          memo: p.memo,
        })),
        scenarios: scenarios.map((s) => {
          const net = computeNet(s);
          return {
            method: s.method,
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
            : { method: item.chosenMethod, saleAmount: item.chosenSaleAmount, netAmount: item.chosenNetAmount, chosenAt: item.chosenAt },
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
                expectedMinutes: chosenScenario?.expectedMinutes ?? null,
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
