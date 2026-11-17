// 물건 하나의 기록을 날짜순으로 한 줄씩 늘어놓는다(가격 자료 확인, 올린 가격, 받은 제안, 방법 선택, 판매).
// 이미 저장된 사실을 날짜로 정렬해 보여 줄 뿐이며, 새 값을 계산하거나 추세를 말하지 않는다.
// 유형이 다른 금액을 한 줄에 섞지 않도록 줄마다 무엇의 금액인지 적는다.

import { formatMoney } from "./money";
import { OFFER_STATUS_LABEL, type OfferStatus } from "./offer";
import { scenarioLabel } from "./scenario";
import { PRICE_TYPE_INFO, SALE_METHOD_LABEL, type Currency, type PriceType, type SaleMethod } from "./types";

export type TimelineKind = "PURCHASED" | "REGISTERED" | "PRICE_CHECKED" | "PRICE_PREVIOUS" | "POSTED" | "OFFER" | "CHOSEN" | "SOLD";

export const TIMELINE_KIND_LABEL: Record<TimelineKind, string> = {
  PURCHASED: "구입",
  REGISTERED: "등록",
  PRICE_CHECKED: "가격 자료",
  PRICE_PREVIOUS: "가격 자료(이전 값)",
  POSTED: "올린 가격",
  OFFER: "받은 제안",
  CHOSEN: "방법 선택",
  SOLD: "판매",
};

// 같은 날짜 안에서의 순서(위에서 아래로 = 나중 일부터)
const KIND_ORDER: TimelineKind[] = ["SOLD", "CHOSEN", "OFFER", "POSTED", "PRICE_CHECKED", "PRICE_PREVIOUS", "REGISTERED", "PURCHASED"];

export type TimelineEvent = { date: string; kind: TimelineKind; text: string; key: string };

/** DB의 UTC 시각("YYYY-MM-DD HH:MM:SS")을 한국 날짜(YYYY-MM-DD)로. 형식이 다르면 null. */
export function utcToSeoulYmd(utc: string | null): string | null {
  if (!utc) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(utc);
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
  if (Number.isNaN(t)) return null;
  return new Date(t + 9 * 3600 * 1000).toISOString().slice(0, 10); // Asia/Seoul은 UTC+9 고정(서머타임 없음)
}

/** DB의 UTC 시각을 한국 시각 "YYYY-MM-DD HH:MM"으로. 형식이 다르면 원문 그대로. */
export function utcToSeoulDateTime(utc: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(utc);
  if (!m) return utc;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
  return new Date(t + 9 * 3600 * 1000).toISOString().slice(0, 16).replace("T", " ");
}

export type TimelineInput = {
  item: {
    createdAt: string;
    purchaseAmount?: number | null;
    purchaseDate?: string | null;
    chosenMethod: SaleMethod | null;
    chosenChannel?: string | null;
    chosenSaleAmount: number | null;
    chosenAt: string | null;
  };
  prices: { id: number; priceType: PriceType; amountMinor: number; currency: Currency; sourceName: string; checkedDate: string }[];
  /** 가격 자료 id → 이전 값 */
  history: Map<number, { id: number; priceType: PriceType; amountMinor: number; currency: Currency; checkedDate: string }[]>;
  posted: { id: number; postedDate: string; amount: number; channel: string }[];
  offers: { id: number; receivedDate: string; amount: number; channel: string; status: OfferStatus }[];
  result: { soldDate: string; amount: number; channel: string } | undefined;
};

export function buildTimeline(input: TimelineInput): TimelineEvent[] {
  const ev: TimelineEvent[] = [];
  const registered = utcToSeoulYmd(input.item.createdAt);
  if (registered) ev.push({ date: registered, kind: "REGISTERED", text: "물건을 등록함", key: "registered" });
  if (input.item.purchaseDate) {
    ev.push({
      date: input.item.purchaseDate,
      kind: "PURCHASED",
      text: input.item.purchaseAmount != null ? `${formatMoney(input.item.purchaseAmount)}에 삼(내가 적은 값)` : "삼(가격은 적지 않음)",
      key: "purchased",
    });
  }
  for (const p of input.prices) {
    const label = `[${PRICE_TYPE_INFO[p.priceType].label}] ${p.sourceName}`;
    ev.push({ date: p.checkedDate, kind: "PRICE_CHECKED", text: `${label} ${formatMoney(p.amountMinor, p.currency)} 확인`, key: `price-${p.id}` });
    for (const h of input.history.get(p.id) ?? []) {
      ev.push({
        date: h.checkedDate,
        kind: "PRICE_PREVIOUS",
        text: `[${PRICE_TYPE_INFO[h.priceType].label}] ${p.sourceName} ${formatMoney(h.amountMinor, h.currency)} 확인(나중에 바뀜)`,
        key: `history-${h.id}`,
      });
    }
  }
  for (const p of input.posted) {
    ev.push({
      date: p.postedDate,
      kind: "POSTED",
      text: `내 판매글 가격 ${formatMoney(p.amount)}${p.channel ? ` (${p.channel})` : ""}`,
      key: `posted-${p.id}`,
    });
  }
  for (const o of input.offers) {
    ev.push({
      date: o.receivedDate,
      kind: "OFFER",
      text: `제안 ${formatMoney(o.amount)}${o.channel ? ` (${o.channel})` : ""} — ${OFFER_STATUS_LABEL[o.status]}`,
      key: `offer-${o.id}`,
    });
  }
  const chosenDate = utcToSeoulYmd(input.item.chosenAt);
  if (input.item.chosenMethod && chosenDate) {
    ev.push({
      date: chosenDate,
      kind: "CHOSEN",
      text: `${scenarioLabel(SALE_METHOD_LABEL[input.item.chosenMethod], input.item.chosenChannel ?? "")}로 정함${
        input.item.chosenSaleAmount !== null ? ` (당시 금액 ${formatMoney(input.item.chosenSaleAmount)})` : ""
      }`,
      key: "chosen",
    });
  }
  if (input.result) {
    ev.push({
      date: input.result.soldDate,
      kind: "SOLD",
      text: `${input.result.channel}에서 ${formatMoney(input.result.amount)}에 판매(내가 기록한 값)`,
      key: "sold",
    });
  }
  // 최신 날짜가 위. 같은 날짜는 종류 순서, 그다음 key로 고정해 순서가 흔들리지 않게 한다.
  return ev.sort(
    (a, b) => b.date.localeCompare(a.date) || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.key.localeCompare(b.key, "en", { numeric: true }),
  );
}
