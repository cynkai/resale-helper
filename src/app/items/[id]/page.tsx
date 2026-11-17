import Link from "next/link";
import { notFound } from "next/navigation";
import {
  chooseMethodAction,
  deleteItemAction,
  deleteOfferAction,
  deletePostedPriceAction,
  deleteScenarioAction,
  setOfferStatusAction,
  setPrimaryScenarioAction,
  deletePriceAction,
  recheckPriceAction,
  deleteSaleResultAction,
  togglePriceAction,
} from "@/app/actions";
import { ConfirmSubmit, CopyButton, CsvImportForm, OfferForm, PostedPriceForm, SaleResultForm } from "@/components/client-bits";
import { breakEvenDirectSale } from "@/lib/domain/break-even";
import { convertToKrw, fxRateToPlain } from "@/lib/domain/fx";
import { ScenarioForm, type BasisOption, type CopyOption } from "@/components/ScenarioForm";
import { Badge, PriceTypeBadge, Section } from "@/components/ui";
import { getDb } from "@/lib/db/client";
import { getItem, getSaleResult, listChannelNames, listOffers, listPostedPrices, listPriceHistory, listPrices, listScenarios, listTemplates } from "@/lib/db/repo";
import { renderTemplate } from "@/lib/domain/listing-template";
import { postedDeltas, summarizePosted } from "@/lib/domain/posted-price";
import { COST_KEYS, costItemDiffs, plannedCostItems } from "@/lib/domain/review";
import { countOfferStatuses, evaluateOffer, OFFER_STATUS_LABEL, OFFER_STATUSES, pickOfferScenario } from "@/lib/domain/offer";
import type { CostScenario, PriceRecord } from "@/lib/db/schema";
import {
  buildComparison,
  daysBetween,
  EXCLUSION_LABEL,
  isQuoteExpired,
  WARNING_LABEL,
  type Classified,
} from "@/lib/domain/compare";
import { CSV_COLUMNS } from "@/lib/domain/csv";
import { buildListingDraft, charCount } from "@/lib/domain/listing";
import { bpToPercentString, formatMoney } from "@/lib/domain/money";
import { COST_LABEL, computeNet, netDifference, type NetResult } from "@/lib/domain/net";
import {
  BASIS_ISSUE_LABEL,
  basisIssues,
  chosenScenario,
  isChoiceOutdated,
  needsPrimary,
  primaryScenario,
  scenarioLabel,
  type BasisIssue,
} from "@/lib/domain/scenario";
import {
  BUNDLE_LABEL,
  CATEGORY_LABEL,
  CONDITION_LABEL,
  DISCLAIMER,
  INPUT_ROUTE_LABEL,
  ITEM_STATUS_LABEL,
  MIN_SAMPLES_FOR_SUMMARY,
  PRICE_TYPE_INFO,
  PRICE_TYPES,
  SALE_METHOD_LABEL,
  SALE_METHODS,
  type SaleMethod,
  type TriState,
} from "@/lib/domain/types";
import { isDemoMode } from "@/lib/mode";
import { todayYmd } from "@/lib/today";

const WINDOWS = [
  { value: "30", label: "최근 30일" },
  { value: "90", label: "최근 90일" },
  { value: "180", label: "최근 180일" },
  { value: "365", label: "최근 1년" },
  { value: "all", label: "전체 기간" },
];

const TRI_TEXT: Record<TriState, string> = { YES: "있음", NO: "없음", UNKNOWN: "모름" };

function signed(n: number): string {
  return `${n > 0 ? "+" : ""}${formatMoney(n)}`;
}

function scenarioInitial(sc: CostScenario | undefined): Record<string, string> {
  if (!sc) return { feeMode: "AMOUNT" };
  const str = (n: number | null) => (n === null ? "" : String(n));
  return {
    channel: sc.channel,
    basisPriceRecordId: str(sc.basisPriceRecordId),
    saleAmount: String(sc.saleAmount),
    feeMode: sc.feeMode,
    feeAmount: str(sc.feeAmount),
    feeRate: sc.feeRateBp === null ? "" : bpToPercentString(sc.feeRateBp),
    shipping: str(sc.shipping),
    packing: str(sc.packing),
    transport: str(sc.transport),
    expectedMinutes: str(sc.expectedMinutes),
    memo: sc.memo ?? "",
  };
}

/** tid: 그 방식의 기준 계산(또는 하나뿐인 계산)이면 방식 이름, 아니면 방식-계산 id. */
function NetBox({ sc, net, issues, tid }: { sc: CostScenario; net: NetResult; issues: BasisIssue[]; tid: string }) {
  const basisType = sc.basisPriceType;
  const row = (label: string, value: number | null) => (
    <div className="flex justify-between gap-4">
      <dt className="text-stone-700">− {label}</dt>
      <dd className={value === null ? "font-medium text-amber-900" : ""}>{value === null ? "모름" : formatMoney(value)}</dd>
    </div>
  );
  return (
    <div className="rounded-md border border-stone-300 bg-stone-50 p-3 text-sm">
      <div className="mb-2 flex flex-wrap gap-1.5">
        {basisType === "BUYBACK_QUOTE" ? (
          <Badge tone="amber">매입 견적 기준</Badge>
        ) : basisType ? (
          <Badge tone="neutral">예상 금액 · {PRICE_TYPE_INFO[basisType].label} 참고</Badge>
        ) : (
          <Badge tone="neutral">직접 입력한 예상 금액</Badge>
        )}
        {issues.includes("BASIS_EXPIRED") ? <Badge tone="red">견적 만료</Badge> : null}
        {issues.some((i) => i !== "BASIS_EXPIRED") ? <Badge tone="red">기준 자료 변경됨</Badge> : null}
      </div>
      {issues.length > 0 ? (
        <div className="warn mb-2" data-testid={`basis-issues-${tid}`}>
          {issues.map((i) => (
            <p key={i}>{BASIS_ISSUE_LABEL[i]}</p>
          ))}
          <p className="mt-1">아래에서 기준 금액을 다시 고르고 저장해 주세요. 그 전까지 이 방법은 선택할 수 없습니다.</p>
        </div>
      ) : null}
      <dl className="space-y-1">
        <div className="flex justify-between gap-4">
          <dt className="text-stone-700">{sc.method === "BUYBACK" ? "매입 금액" : "예상 판매금액"}</dt>
          <dd>{formatMoney(sc.saleAmount)}</dd>
        </div>
        {row(
          sc.feeMode === "RATE" && sc.feeRateBp !== null ? `수수료 (${bpToPercentString(sc.feeRateBp)}%)` : "수수료",
          net.fee,
        )}
        {row("내가 내는 배송비", sc.shipping)}
        {row("포장비", sc.packing)}
        {row("교통비", sc.transport)}
        <div className="flex justify-between gap-4 border-t border-stone-300 pt-1 text-base font-semibold">
          <dt>예상 실수령액</dt>
          <dd data-testid={`net-${tid}`}>{net.complete ? formatMoney(net.net!) : "계산 불완전"}</dd>
        </div>
      </dl>
      {!net.complete ? (
        <p className="warn mt-2">
          {net.missing.map((k) => COST_LABEL[k]).join(", ")}을(를) 아직 입력하지 않았습니다. 입력한 비용만 빼면{" "}
          {formatMoney(net.netBeforeMissing)}이지만, 실제로 남는 금액은 이보다 적을 수 있습니다.
        </p>
      ) : null}
      {sc.expectedMinutes !== null ? (
        <p className="mt-2 text-stone-700">내가 어림한 소요시간: {sc.expectedMinutes}분</p>
      ) : null}
      {sc.memo ? <p className="mt-1 whitespace-pre-wrap text-stone-700">메모: {sc.memo}</p> : null}
    </div>
  );
}

export default async function ItemPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const db = getDb();
  const demo = await isDemoMode();
  const item = /^\d+$/.test(id) ? getItem(db, demo, Number(id)) : undefined;
  if (!item) notFound();

  const today = todayYmd();
  const windowParam = WINDOWS.some((w) => w.value === sp.days) ? sp.days! : "180";
  const windowDays = windowParam === "all" ? null : Number(windowParam);
  const prices = listPrices(db, item.id);
  const history = listPriceHistory(db, item.id);
  const comparison = buildComparison(item, prices, today, windowDays);
  const scenarios = listScenarios(db, item.id);
  const result = getSaleResult(db, item.id);

  // 방식마다 계산이 여러 개일 수 있다. 두 방법의 차이·손익분기는 방식별 "기준" 계산으로만 한다
  // (하나뿐이면 그것, 여러 개면 사용자가 표시한 것. 표시가 없으면 앱이 고르지 않는다).
  const byMethod = (m: SaleMethod) => primaryScenario(scenarios, m);
  const ofMethod = (m: SaleMethod) => scenarios.filter((s) => s.method === m);
  const netOf = new Map(scenarios.map((sc) => [sc.id, computeNet(sc)]));
  const issuesOf = new Map(
    scenarios.map((sc) => {
      const basis = sc.basisPriceRecordId !== null ? prices.find((p) => p.id === sc.basisPriceRecordId) : undefined;
      return [sc.id, basisIssues(sc, basis, today)];
    }),
  );
  const nets = Object.fromEntries(
    SALE_METHODS.map((m) => {
      const sc = byMethod(m);
      return [m, sc ? netOf.get(sc.id)! : null];
    }),
  ) as Record<SaleMethod, NetResult | null>;
  const issuesByMethod = Object.fromEntries(
    SALE_METHODS.map((m) => {
      const sc = byMethod(m);
      return [m, sc ? issuesOf.get(sc.id)! : []];
    }),
  ) as Record<SaleMethod, BasisIssue[]>;
  const undecidedPrimary = SALE_METHODS.filter((m) => needsPrimary(scenarios, m));
  const chosenSc = chosenScenario(item, scenarios);
  const channelNames = listChannelNames(db, demo);
  const copyOptions: CopyOption[] = scenarios.map((sc) => ({
    id: sc.id,
    label: scenarioLabel(SALE_METHOD_LABEL[sc.method], sc.channel),
    values: scenarioInitial(sc),
  }));
  // 기준 자료에 문제가 있는 계산은 차액 비교에도 쓰지 않는다.
  const diff = netDifference(
    issuesByMethod.DIRECT.length === 0 ? nets.DIRECT : null,
    issuesByMethod.BUYBACK.length === 0 ? nets.BUYBACK : null,
  );
  // 손익분기: 업체 계산이 믿을 만하고(기준 자료 문제 없음) 개인 판매 비용을 모두 알 때만.
  const directSc = byMethod("DIRECT");
  const breakEven =
    directSc && byMethod("BUYBACK") && issuesByMethod.BUYBACK.length === 0 ? breakEvenDirectSale(directSc, nets.BUYBACK?.net ?? null) : null;
  const choiceOutdated = isChoiceOutdated(item, chosenSc);
  // 실제 비용을 항목별로 적었을 때만: 고른 계산의 어림값과 항목별로 비교한다(선택 뒤 계산이 바뀌었으면 비교하지 않는다).
  const resultActual = result
    ? { fee: result.feeActual, shipping: result.shippingActual, packing: result.packingActual, transport: result.transportActual }
    : null;
  const resultCostDiffs =
    resultActual && COST_KEYS.some((k) => resultActual[k] !== null)
      ? costItemDiffs(chosenSc && !choiceOutdated ? plannedCostItems(chosenSc) : null, resultActual)
      : null;
  const templates = listTemplates(db, demo);
  const posted = listPostedPrices(db, item.id);
  const postedSummary = summarizePosted(posted);
  const postedDelta = postedDeltas(posted);
  const offers = listOffers(db, item.id);
  const offerCounts = countOfferStatuses(offers.map((o) => o.status));
  // 제안을 받았을 때 비교할 업체 실수령액: 업체 기준 계산이 완전하고 기준 자료 문제가 없을 때만.
  const offerBuybackNet = byMethod("BUYBACK") && issuesByMethod.BUYBACK.length === 0 ? (nets.BUYBACK?.net ?? null) : null;
  const acceptedOffer = offers.find((o) => o.status === "ACCEPTED");

  const usable = prices.filter((p) => p.currency === "KRW" && !isQuoteExpired(p, today));
  const optionLabel = (p: PriceRecord) =>
    `[${PRICE_TYPE_INFO[p.priceType].label}] ${p.sourceName} ${formatMoney(p.amountMinor)} (확인 ${p.checkedDate})`;
  const basisOptions: Record<SaleMethod, BasisOption[]> = {
    BUYBACK: usable
      .filter((p) => p.priceType === "BUYBACK_QUOTE")
      .map((p) => ({ id: p.id, label: optionLabel(p), amount: p.amountMinor })),
    DIRECT: usable
      .filter((p) => p.priceType !== "BUYBACK_QUOTE")
      .map((p) => ({ id: p.id, label: optionLabel(p), amount: p.amountMinor })),
  };

  // 판매글 금액: 개인 판매 계산을 골랐으면 그 계산, 아니면 개인 판매의 기준 계산.
  const direct = chosenSc?.method === "DIRECT" ? chosenSc : byMethod("DIRECT");
  const draft = buildListingDraft(item, direct?.saleAmount ?? null);

  const priceRow = (c: Classified<PriceRecord>) => {
    const p = c.record;
    const age = daysBetween(p.checkedDate, today);
    const expired = isQuoteExpired(p, today);
    return (
      <tr key={p.id} className={c.eligible ? "" : "bg-stone-50 text-stone-600"}>
        <td className="whitespace-nowrap px-2 py-2 align-top font-medium">
          {formatMoney(p.amountMinor, p.currency)}
          {p.currency !== "KRW" && p.fxRateE4 !== null && p.fxDate !== null ? (
            <div className="mt-0.5 whitespace-normal text-xs font-normal text-stone-600" data-testid={`fx-${p.id}`}>
              환산 참고 약 {formatMoney(convertToKrw(p.amountMinor, p.currency, p.fxRateE4))}
              <br />
              (내가 입력한 환율: 1 {p.currency} = {fxRateToPlain(p.fxRateE4)}원, 기준일 {p.fxDate})
            </div>
          ) : null}
          <div className="mt-1 flex flex-wrap gap-1 font-normal">
            {p.isDemo ? <Badge tone="amber">가상</Badge> : null}
            {p.bundleType === "BUNDLE" ? <Badge>{BUNDLE_LABEL.BUNDLE}</Badge> : null}
          </div>
          {history.get(p.id)?.length ? (
            <details className="mt-1 text-xs font-normal text-stone-600" data-testid={`price-history-${p.id}`}>
              <summary className="cursor-pointer">이전 값 {history.get(p.id)!.length}건</summary>
              <ul className="mt-1 space-y-0.5">
                {history.get(p.id)!.map((h) => (
                  <li key={h.id}>
                    {h.checkedDate} 확인: {formatMoney(h.amountMinor, h.currency)}
                    {h.priceType !== p.priceType ? ` (당시 유형: ${PRICE_TYPE_INFO[h.priceType].label})` : ""}
                  </li>
                ))}
              </ul>
              <p className="mt-1">이 매물을 전에 확인했을 때의 값입니다(고치거나 다시 확인하면 남습니다). 비교와 요약에는 지금 값만 씁니다.</p>
            </details>
          ) : null}
        </td>
        <td className="px-2 py-2 align-top">
          {p.sourceUrl ? (
            <a href={p.sourceUrl} target="_blank" rel="noopener noreferrer nofollow" className="underline">
              {p.sourceName}
            </a>
          ) : (
            p.sourceName
          )}
          <div className="text-xs text-stone-600">{INPUT_ROUTE_LABEL[p.inputRoute]}</div>
        </td>
        <td className="whitespace-nowrap px-2 py-2 align-top">
          {p.checkedDate}
          <div className="text-xs text-stone-600">{age === 0 ? "오늘 확인" : `${age}일 전 확인`}</div>
          {p.tradeDate ? <div className="text-xs text-stone-600">거래일 {p.tradeDate}</div> : null}
        </td>
        <td className="px-2 py-2 align-top text-xs">
          <div>상태: {p.condition ? CONDITION_LABEL[p.condition] : "모름"}</div>
          <div>배송비: {p.shippingIncluded === "YES" ? "포함" : p.shippingIncluded === "NO" ? "미포함" : "모름"}</div>
          {p.componentsMatch !== "UNKNOWN" ? <div>구성: {p.componentsMatch === "YES" ? "내 물건과 같음" : "내 물건과 다름"}</div> : null}
          {p.priceType === "BUYBACK_QUOTE" ? (
            <div className={expired ? "font-medium text-red-800" : ""}>
              유효기간: {p.quoteValidUntil ?? "기록 없음"}
              {expired ? " (만료)" : ""}
            </div>
          ) : null}
          {p.deductionTerms ? <div>감액 조건: {p.deductionTerms}</div> : null}
          {p.memo ? <div className="text-stone-600">메모: {p.memo}</div> : null}
        </td>
        <td className="px-2 py-2 align-top text-xs">
          {c.eligible ? (
            <Badge tone="teal">비교에 포함</Badge>
          ) : (
            <div className="flex flex-wrap gap-1">
              {c.exclusions.map((x) => (
                <Badge key={x} tone={x === "QUOTE_EXPIRED" ? "red" : "neutral"}>
                  제외: {EXCLUSION_LABEL[x]}
                </Badge>
              ))}
            </div>
          )}
          {c.warnings.length > 0 ? (
            <div className="mt-1 text-amber-900">{c.warnings.map((w) => WARNING_LABEL[w]).join(", ")}</div>
          ) : null}
        </td>
        <td className="px-2 py-2 align-top">
          <div className="flex flex-wrap gap-1">
            <form action={togglePriceAction}>
              <input type="hidden" name="itemId" value={item.id} />
              <input type="hidden" name="priceId" value={p.id} />
              <input type="hidden" name="include" value={p.includedInComparison ? "0" : "1"} />
              <button type="submit" className="btn px-2 py-1 text-xs" aria-label={`${p.sourceName} ${formatMoney(p.amountMinor, p.currency)} ${p.includedInComparison ? "비교에서 빼기" : "다시 포함"}`}>
                {p.includedInComparison ? "빼기" : "다시 포함"}
              </button>
            </form>
            {age > 0 ? (
              <form action={recheckPriceAction}>
                <input type="hidden" name="itemId" value={item.id} />
                <input type="hidden" name="priceId" value={p.id} />
                <ConfirmSubmit
                  message="출처에서 다시 확인했더니 가격이 그대로였나요? 확인일을 오늘로 바꾸고 이전 확인일은 '이전 값'에 남깁니다. 가격이 바뀌었다면 '수정'을 눌러 주세요."
                  className="btn px-2 py-1 text-xs"
                >
                  오늘 다시 확인함
                </ConfirmSubmit>
              </form>
            ) : null}
                        <Link href={`/items/${item.id}/prices/${p.id}/edit`} className="btn px-2 py-1 text-xs">
              수정
            </Link>
            <form action={deletePriceAction}>
              <input type="hidden" name="itemId" value={item.id} />
              <input type="hidden" name="priceId" value={p.id} />
              <ConfirmSubmit message="이 가격 자료를 삭제할까요?" className="btn-danger px-2 py-1 text-xs">
                삭제
              </ConfirmSubmit>
            </form>
          </div>
        </td>
      </tr>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">{item.name}</h1>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {item.isDemo ? <Badge tone="amber">가상 데이터</Badge> : null}
            <Badge>{CATEGORY_LABEL[item.category]}</Badge>
            <Badge tone={item.status === "SOLD" ? "teal" : "neutral"}>{ITEM_STATUS_LABEL[item.status]}</Badge>
          </div>
        </div>
        <div className="flex gap-2">
          <Link href={`/items/${item.id}/edit`} className="btn">
            물건 수정
          </Link>
          <form action={deleteItemAction}>
            <input type="hidden" name="itemId" value={item.id} />
            <ConfirmSubmit message="이 물건과 연결된 가격 자료·계산·판매 결과가 모두 삭제됩니다. 삭제할까요?">물건 삭제</ConfirmSubmit>
          </form>
        </div>
      </div>

      <nav aria-label="진행 단계" className="flex flex-wrap gap-2 text-sm">
        {[
          ["#info", "물건 정보"],
          ["#prices", "1. 가격 자료·비교"],
          ["#net", "2. 실수령액"],
          ["#choose", "3. 판매 방법"],
          ["#listing", "4. 판매글"],
          ["#offers", "받은 제안"],
          ["#result", "5. 판매 결과"],
        ].map(([href, label]) => (
          <a key={href} href={href} className="rounded-full border border-stone-300 bg-white px-3 py-1 hover:bg-stone-100">
            {label}
          </a>
        ))}
      </nav>

      <Section id="info" title="물건 정보">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          {(
            [
              [item.category === "BOOK" ? "ISBN" : "모델명", item.identifier],
              ["상태", CONDITION_LABEL[item.condition]],
              ...(item.category === "BOOK"
                ? ([
                    ["저자", item.author],
                    ["출판사", item.publisher],
                    ["판본", item.edition],
                    [
                      "필기·밑줄·파손·부록",
                      [item.hasWriting, item.hasUnderline, item.hasDamage, item.hasSupplement].map((t) => TRI_TEXT[t]).join(" · "),
                    ],
                  ] as [string, string | null][])
                : []),
              ["하자", item.defects],
              ["구성품", item.components],
              ["메모", item.memo],
            ] as [string, string | null][]
          ).map(([k, val]) => (
            <div key={k} className="flex gap-2">
              <dt className="w-28 shrink-0 text-stone-600">{k}</dt>
              <dd className={val ? "whitespace-pre-wrap" : "text-stone-500"}>{val ?? "입력 안 함"}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section
        id="prices"
        step={1}
        title="가격 자료와 비교"
        aside={
          <div className="flex flex-wrap gap-2">
            <Link href={`/items/${item.id}/prices/new`} className="btn-primary">
              가격 자료 추가
            </Link>
            {prices.length > 0 ? (
              <a href={`/api/export/prices?itemId=${item.id}`} className="btn">
                CSV 내보내기
              </a>
            ) : null}
          </div>
        }
      >
        <p className="notice">{DISCLAIMER}</p>

        <details className="mt-3 text-sm">
          <summary className="cursor-pointer font-medium">가격 유형 설명 보기</summary>
          <dl className="mt-2 space-y-1.5">
            {PRICE_TYPES.map((t) => (
              <div key={t} className="flex flex-wrap items-baseline gap-2">
                <dt>
                  <PriceTypeBadge type={t} />
                </dt>
                <dd className="text-stone-700">{PRICE_TYPE_INFO[t].help}</dd>
              </div>
            ))}
          </dl>
        </details>

        {prices.length === 0 ? (
          <div className="mt-4 rounded-md border border-dashed border-stone-300 p-6 text-center">
            <p className="font-medium">가격 자료 없음</p>
            <p className="mt-1 text-sm text-stone-600">
              이 앱은 가격을 자동으로 찾아 주지 않습니다. 중고 장터의 판매글이나 매입업체 견적을 직접 확인해 추가하거나 CSV로 가져와 주세요.
            </p>
          </div>
        ) : (
          <>
            <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
              <span className="text-stone-700">기준 기간(확인일):</span>
              {WINDOWS.map((w) => (
                <Link
                  key={w.value}
                  href={`/items/${item.id}?days=${w.value}#prices`}
                  aria-current={w.value === windowParam ? "true" : undefined}
                  className={`rounded-full border px-2.5 py-0.5 ${
                    w.value === windowParam ? "border-teal-800 bg-teal-800 text-white" : "border-stone-300 bg-white hover:bg-stone-100"
                  }`}
                >
                  {w.label}
                </Link>
              ))}
            </div>
            <p className="mt-2 text-sm text-stone-700">
              전체 {prices.length}건 중 비교에 포함 {comparison.eligibleCount}건, 제외 {comparison.excludedCount}건. 유형이 다른 가격은 서로 합치지 않습니다.
            </p>

            <div className="mt-3 space-y-5">
              {comparison.groups.map((g) => (
                <div key={g.priceType} data-testid={`group-${g.priceType}`}>
                  <h3 className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                    <PriceTypeBadge type={g.priceType} />
                    <span className="font-normal text-stone-700">
                      포함 {g.eligible.length}건{g.excluded.length > 0 ? ` · 제외 ${g.excluded.length}건` : ""}
                    </span>
                  </h3>
                  {g.summary ? (
                    <p className="mt-1.5 text-sm" data-testid={`summary-${g.priceType}`}>
                      <strong>
                        {PRICE_TYPE_INFO[g.priceType].summaryLabel} {formatMoney(g.summary.median)}
                      </strong>{" "}
                      · 범위 {formatMoney(g.summary.min)} ~ {formatMoney(g.summary.max)} · {g.summary.count}건 기준
                    </p>
                  ) : (
                    <p className="mt-1.5 text-sm text-stone-700" data-testid={`nosummary-${g.priceType}`}>
                      {g.eligible.length === 0
                        ? "비교에 포함할 수 있는 자료가 없습니다."
                        : `포함된 자료가 ${g.eligible.length}건뿐이라 요약 가격을 내지 않습니다(${MIN_SAMPLES_FOR_SUMMARY}건 이상일 때 표시). 아래 개별 자료를 참고해 주세요.`}
                    </p>
                  )}
                  <div className="mt-2 overflow-x-auto">
                    <table className="w-full min-w-[640px] border-collapse text-sm">
                      <caption className="sr-only">{PRICE_TYPE_INFO[g.priceType].label} 자료 목록</caption>
                      <thead>
                        <tr className="border-b border-stone-300 text-left text-xs text-stone-600">
                          <th scope="col" className="px-2 py-1 font-medium">금액</th>
                          <th scope="col" className="px-2 py-1 font-medium">출처</th>
                          <th scope="col" className="px-2 py-1 font-medium">확인일</th>
                          <th scope="col" className="px-2 py-1 font-medium">조건</th>
                          <th scope="col" className="px-2 py-1 font-medium">비교 여부</th>
                          <th scope="col" className="px-2 py-1 font-medium">관리</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-stone-200">{[...g.eligible, ...g.excluded].map(priceRow)}</tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        <details className="mt-5 rounded-md border border-stone-200 p-3 text-sm">
          <summary className="cursor-pointer font-medium">CSV로 한꺼번에 가져오기</summary>
          <div className="mt-3 space-y-3">
            <p className="text-stone-700">
              첫 줄은 열 이름입니다. 필수 열: <code>price_type, amount, source_name, checked_date</code>. 사용할 수 있는 열:{" "}
              <code>{CSV_COLUMNS.map((c) => c.header).join(", ")}</code>
            </p>
            <pre className="overflow-x-auto rounded bg-stone-100 p-2 text-xs">
              {`price_type,amount,currency,source_name,source_url,checked_date,condition,memo
ASKING,15000,KRW,○○마켓,https://example.com/item/1,${today},GOOD,
BUYBACK_QUOTE,6000,KRW,○○서점,,${today},GOOD,매장 방문 견적`}
            </pre>
            <p className="text-stone-700">
              price_type은 ASKING, SOLD_LISTING, BUYBACK_QUOTE, USER_REPORTED 중 하나입니다(VERIFIED_SALE은 가져올 수 없음). 오류가 있는 행은 건너뛰고 행 번호와 이유를 알려 드립니다.
            </p>
            <CsvImportForm itemId={item.id} />
          </div>
        </details>
      </Section>

      <Section id="net" step={2} title="실수령액 계산">
        <p className="text-sm text-stone-700">
          실수령액 = 선택한 금액 − 수수료 − 내가 내는 배송비 − 포장비 − 교통비. 예상 금액으로 계산한 결과는 예상일 뿐 실제로 받을 금액이 아닙니다.
        </p>
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          {SALE_METHODS.map((m) => {
            const list = ofMethod(m);
            const only = list.length === 1 ? list[0] : undefined;
            const primary = byMethod(m);
            return (
              <div key={m} className="space-y-3 rounded-md border border-stone-200 p-3" data-testid={`scenario-${m}`}>
                <h3 className="font-semibold">{SALE_METHOD_LABEL[m]}</h3>
                {list.length === 0 ? (
                  <p className="text-sm text-stone-600">
                    {m === "BUYBACK" ? "받은 매입 견적이 있으면 금액과 비용을 입력해 보세요." : "받고 싶은 금액과 예상 비용을 입력해 보세요."}
                  </p>
                ) : null}
                {list.length <= 1 ? (
                  <>
                    {only ? (
                      <>
                        {only.channel !== "" ? <p className="text-sm font-medium">{only.channel}</p> : null}
                        <NetBox sc={only} net={netOf.get(only.id)!} issues={issuesOf.get(only.id)!} tid={m} />
                      </>
                    ) : null}
                    <ScenarioForm
                      itemId={item.id}
                      method={m}
                      scenarioId={only?.id}
                      initial={scenarioInitial(only)}
                      basisOptions={basisOptions[m]}
                      channelNames={channelNames}
                    />
                  </>
                ) : (
                  <>
                    {needsPrimary(scenarios, m) ? (
                      <p className="warn" data-testid={`needs-primary-${m}`}>
                        이 방식의 계산이 여러 개입니다. 두 방법의 차이와 손익분기에 쓸 계산 하나를 ‘기준으로 쓰기’로 정해 주세요. 앱이 대신 고르지 않습니다.
                      </p>
                    ) : null}
                    {list.map((sc) => {
                      const isPrimary = primary?.id === sc.id;
                      return (
                        <div key={sc.id} className="space-y-2 border-t border-stone-200 pt-3" data-testid={`scenario-${m}-${sc.id}`}>
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-medium">{sc.channel === "" ? "이름 없는 계산" : sc.channel}</p>
                            {isPrimary ? (
                              <Badge tone="teal">기준</Badge>
                            ) : (
                              <form action={setPrimaryScenarioAction}>
                                <input type="hidden" name="itemId" value={item.id} />
                                <input type="hidden" name="scenarioId" value={sc.id} />
                                <button type="submit" className="btn px-2 py-0.5 text-xs">
                                  기준으로 쓰기
                                </button>
                              </form>
                            )}
                          </div>
                          <NetBox sc={sc} net={netOf.get(sc.id)!} issues={issuesOf.get(sc.id)!} tid={isPrimary ? m : `${m}-${sc.id}`} />
                          <details className="text-sm">
                            <summary className="cursor-pointer text-stone-700">이 계산 고치기·지우기</summary>
                            <div className="mt-2 space-y-3">
                              <ScenarioForm
                                itemId={item.id}
                                method={m}
                                scenarioId={sc.id}
                                idSuffix={`-${sc.id}`}
                                initial={scenarioInitial(sc)}
                                basisOptions={basisOptions[m]}
                                channelNames={channelNames}
                              />
                              <form action={deleteScenarioAction}>
                                <input type="hidden" name="itemId" value={item.id} />
                                <input type="hidden" name="scenarioId" value={sc.id} />
                                <ConfirmSubmit message="이 계산을 지울까요? 되돌릴 수 없습니다.">이 계산 지우기</ConfirmSubmit>
                              </form>
                            </div>
                          </details>
                        </div>
                      );
                    })}
                  </>
                )}
                {list.length >= 1 ? (
                  <details className="text-sm" data-testid={`add-scenario-${m}`}>
                    <summary className="cursor-pointer text-stone-700">다른 판매처 계산 추가</summary>
                    <div className="mt-2">
                      <p className="mb-2 text-xs text-stone-600">
                        수수료와 비용은 판매처마다 직접 확인해 입력해 주세요. 앱에 내장된 판매처 목록이나 요율은 없습니다.
                      </p>
                      <ScenarioForm
                        key={`new-${list.length}-${list.at(-1)!.id}`}
                        itemId={item.id}
                        method={m}
                        idSuffix="-new"
                        submitLabel="새 계산 저장"
                        initial={scenarioInitial(undefined)}
                        basisOptions={basisOptions[m]}
                        channelNames={channelNames}
                        copyOptions={copyOptions}
                      />
                    </div>
                  </details>
                ) : null}
              </div>
            );
          })}
        </div>
      </Section>

      <Section id="choose" step={3} title="판매 방법 선택">
        {scenarios.length === 0 ? (
          <p className="text-sm text-stone-600">위 2단계에서 금액과 비용을 저장하면 여기에서 두 방법을 비교하고 선택할 수 있습니다.</p>
        ) : (
          <div className="space-y-3 text-sm">
            <p data-testid="net-diff" className={diff === null ? "warn" : "notice"}>
              {diff === null
                ? undecidedPrimary.length > 0
                  ? `${undecidedPrimary.map((m) => SALE_METHOD_LABEL[m]).join(", ")} 계산이 여러 개라 두 방법의 차이를 계산하지 않았습니다. 위 2단계에서 기준으로 쓸 계산을 정해 주세요.`
                  : SALE_METHODS.some((m) => ofMethod(m).length === 0)
                  ? "한 가지 방법만 입력했습니다. 두 방법을 모두 입력하면 남는 금액의 차이를 보여 드립니다."
                  : SALE_METHODS.some((m) => issuesByMethod[m].length > 0)
                    ? "기준 가격 자료가 바뀌었거나 만료된 계산이 있어 두 방법의 차이를 계산하지 않았습니다."
                    : "비용을 모르는 항목이 있어 두 방법의 차이를 계산하지 않았습니다. 비용이 없으면 0을 입력해 주세요."
                : diff === 0
                  ? "두 방법의 예상 실수령액이 같습니다."
                  : `개인에게 직접 팔면 업체 판매보다 예상 실수령액이 ${formatMoney(Math.abs(diff))} ${diff > 0 ? "더 많습니다" : "더 적습니다"}.`}
              {diff !== null && SALE_METHODS.some((m) => ofMethod(m).length > 1)
                ? ` (기준 계산끼리 비교: ${SALE_METHODS.map((m) => scenarioLabel(SALE_METHOD_LABEL[m], byMethod(m)!.channel)).join(" / ")})`
                : ""}
            </p>
            {SALE_METHODS.some((m) => ofMethod(m).length > 1) ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm" data-testid="scenario-table">
                  <caption className="mb-1 text-left text-xs text-stone-600">
                    저장한 계산을 입력한 순서대로 나란히 놓았습니다. 순위가 아니며, 어느 쪽이 나은지는 직접 판단해 주세요.
                  </caption>
                  <thead className="text-xs text-stone-600">
                    <tr>
                      <th scope="col" className="py-1 pr-3 font-medium">방식 · 판매처</th>
                      <th scope="col" className="py-1 pr-3 font-medium">금액</th>
                      <th scope="col" className="py-1 pr-3 font-medium">예상 실수령액</th>
                      <th scope="col" className="py-1 pr-3 font-medium">어림한 시간</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scenarios.map((sc) => {
                      const net = netOf.get(sc.id)!;
                      const bad = issuesOf.get(sc.id)!.length > 0;
                      return (
                        <tr key={sc.id} className="border-t border-stone-200">
                          <th scope="row" className="py-1 pr-3 font-normal">
                            {scenarioLabel(SALE_METHOD_LABEL[sc.method], sc.channel)}
                            {ofMethod(sc.method).length > 1 && byMethod(sc.method)?.id === sc.id ? <span className="ml-1 text-xs text-teal-900">(기준)</span> : null}
                          </th>
                          <td className="whitespace-nowrap py-1 pr-3">{formatMoney(sc.saleAmount)}</td>
                          <td className="whitespace-nowrap py-1 pr-3">
                            {bad ? (
                              <span className="text-red-900">기준 자료 다시 확인</span>
                            ) : net.complete ? (
                              formatMoney(net.net!)
                            ) : (
                              <span className="text-amber-900">계산 불완전</span>
                            )}
                          </td>
                          <td className="whitespace-nowrap py-1 pr-3">
                            {sc.expectedMinutes === null ? <span className="text-amber-900">모름</span> : `${sc.expectedMinutes}분`}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : null}
            {breakEven?.ok && directSc ? (
              <p data-testid="break-even" className="text-stone-700">
                지금 입력한 비용대로라면, 개인 판매금액이 <strong>{formatMoney(breakEven.saleAmount)}</strong> 이상일 때 업체 판매와 실수령액이 같거나
                많아집니다(입력한 개인 판매금액: {formatMoney(directSc.saleAmount)}). 그 금액에 팔린다는 뜻이 아니며, 들이는 시간은 반영하지 않았습니다.
              </p>
            ) : null}
            {diff !== null && byMethod("DIRECT")?.expectedMinutes != null && byMethod("BUYBACK")?.expectedMinutes != null ? (
              <p className="text-stone-700">
                내가 어림한 소요시간은 개인 판매 {byMethod("DIRECT")!.expectedMinutes}분, 업체 판매 {byMethod("BUYBACK")!.expectedMinutes}분입니다.
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {scenarios.map((sc) => {
                const picked = chosenSc?.id === sc.id;
                const bad = issuesOf.get(sc.id)!.length > 0;
                return (
                  <form key={sc.id} action={chooseMethodAction}>
                    <input type="hidden" name="itemId" value={item.id} />
                    <input type="hidden" name="scenarioId" value={sc.id} />
                    <button
                      type="submit"
                      className={picked ? "btn-primary" : "btn"}
                      aria-pressed={picked}
                      disabled={bad}
                      title={bad ? "기준 가격 자료를 다시 확인해 저장한 뒤 선택할 수 있습니다." : undefined}
                    >
                      {scenarioLabel(SALE_METHOD_LABEL[sc.method], sc.channel)}
                      {picked ? " ✓" : "로 정하기"}
                    </button>
                  </form>
                );
              })}
              {item.chosenMethod ? (
                <form action={chooseMethodAction}>
                  <input type="hidden" name="itemId" value={item.id} />
                  <input type="hidden" name="scenarioId" value="" />
                  <button type="submit" className="btn">선택 취소</button>
                </form>
              ) : null}
            </div>
            {item.chosenMethod && choiceOutdated ? (
              <p className="warn" data-testid="choice-outdated">
                선택한 뒤 이 방법의 금액이나 비용을 바꿨거나 그 계산을 지웠습니다. 아래 숫자는 선택 당시 값입니다. 지금 계산으로 바꾸려면 다시 선택해 주세요.
              </p>
            ) : null}
            {item.chosenMethod ? (
              <p data-testid="chosen" className="font-medium">
                선택한 방법: {scenarioLabel(SALE_METHOD_LABEL[item.chosenMethod], item.chosenChannel ?? "")} — 선택 당시 금액 {formatMoney(item.chosenSaleAmount ?? 0)}, 예상 실수령액{" "}
                {item.chosenNetAmount === null ? "계산 불완전(비용 미입력)" : formatMoney(item.chosenNetAmount)}
              </p>
            ) : (
              <p className="text-stone-600">아직 판매 방법을 정하지 않았습니다. 어느 쪽이 나은지는 금액과 내 시간을 보고 직접 판단해 주세요.</p>
            )}
          </div>
        )}
      </Section>

      <Section id="listing" step={4} title="판매글 초안">
        <p className="text-sm text-stone-700">
          입력한 사실만으로 만든 초안입니다. 입력하지 않은 내용은 쓰지 않았으니 복사한 뒤 직접 다듬어 주세요. 판매처에 자동으로 등록되지 않습니다.
        </p>
        {draft.missing.length > 0 ? (
          <p className="warn mt-2">
            초안에 빠진 내용: {draft.missing.join(", ")}.{" "}
            <Link href={`/items/${item.id}/edit`} className="underline">
              물건 정보에서 입력
            </Link>
            하면 반영됩니다.
          </p>
        ) : null}
        <div className="mt-3 space-y-3">
          <div>
            <p className="mb-1 text-sm font-medium">
              제목 <span className="font-normal text-stone-600">({charCount(draft.title)}자)</span>
            </p>
            <p data-testid="draft-title" className="rounded-md border border-stone-300 bg-stone-50 px-3 py-2 text-sm">
              {draft.title}
            </p>
          </div>
          <div>
            <p className="mb-1 text-sm font-medium">
              본문 — 항목별 <span className="font-normal text-stone-600">({charCount(draft.body)}자)</span>
            </p>
            <pre data-testid="draft-body" className="whitespace-pre-wrap rounded-md border border-stone-300 bg-stone-50 px-3 py-2 font-sans text-sm">
              {draft.body}
            </pre>
          </div>
          <div className="flex flex-wrap gap-2">
            <CopyButton text={draft.title} label="제목 복사" />
            <CopyButton text={`${draft.title}\n\n${draft.body}`} label="제목+본문 복사" />
          </div>
          <div>
            <p className="mb-1 text-sm font-medium">
              본문 — 한 줄 <span className="font-normal text-stone-600">({charCount(draft.compact)}자)</span>
            </p>
            <p data-testid="draft-compact" className="rounded-md border border-stone-300 bg-stone-50 px-3 py-2 text-sm">
              {draft.compact}
            </p>
            <p className="mt-1 text-xs text-stone-600">
              같은 내용을 한 줄로 이은 것입니다(채팅이나 짧은 글용). 판매처마다 글자 수 제한이 다르니 글자 수를 보고 직접 줄여 주세요.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <CopyButton text={draft.compact} label="한 줄 본문 복사" />
          </div>
          <div className="border-t border-stone-200 pt-3" data-testid="posted-prices">
            <p className="text-sm font-medium">내 판매글에 올린 가격</p>
            <p className="mt-1 text-xs text-stone-600">
              판매글을 올리거나 가격을 바꿀 때마다 적어 두면 가격을 어떻게 바꿔 왔는지 볼 수 있습니다. 가격 자료와는 따로 두며, 얼마에 올릴지는 앱이
              정하지 않습니다.
            </p>
            {posted.length > 0 ? (
              <>
                {postedSummary ? (
                  <p className="mt-2 text-sm" data-testid="posted-summary">
                    처음 {formatMoney(postedSummary.first)} → 지금 {formatMoney(postedSummary.latest)} · 내린 횟수 {postedSummary.lowered}번, 올린 횟수{" "}
                    {postedSummary.raised}번
                    {breakEven?.ok
                      ? ` · 지금 가격은 손익분기 개인 판매금액(${formatMoney(breakEven.saleAmount)})${
                          postedSummary.latest >= breakEven.saleAmount ? " 이상" : "보다 낮음"
                        }`
                      : ""}
                  </p>
                ) : null}
                <ul className="mt-2 divide-y divide-stone-200 text-sm">
                  {posted.map((pp) => {
                    const d = postedDelta.get(pp.id) ?? null;
                    return (
                      <li key={pp.id} className="flex flex-wrap items-center gap-2 py-1.5" data-testid={`posted-${pp.id}`}>
                        <span className="text-stone-600">{pp.postedDate}</span>
                        <strong>{formatMoney(pp.amount)}</strong>
                        {d !== null ? <span className="text-stone-700">({d === 0 ? "직전과 같음" : `직전보다 ${signed(d)}`})</span> : null}
                        {pp.channel ? <span className="text-stone-600">· {pp.channel}</span> : null}
                        {pp.memo ? <span className="text-stone-600">· {pp.memo}</span> : null}
                        <form action={deletePostedPriceAction} className="ml-auto">
                          <input type="hidden" name="itemId" value={item.id} />
                          <input type="hidden" name="postedPriceId" value={pp.id} />
                          <ConfirmSubmit message="이 기록을 지울까요?" className="btn-danger px-2 py-0.5 text-xs">
                            지우기
                          </ConfirmSubmit>
                        </form>
                      </li>
                    );
                  })}
                </ul>
              </>
            ) : null}
            <div className="mt-3">
              <PostedPriceForm itemId={item.id} today={today} channelNames={channelNames} />
            </div>
          </div>
          <div className="border-t border-stone-200 pt-3" data-testid="my-templates">
            <p className="text-sm font-medium">내 템플릿</p>
            {templates.length === 0 ? (
              <p className="mt-1 text-sm text-stone-600">
                자주 쓰는 판매글 틀을{" "}
                <Link href="/templates" className="underline">
                  템플릿
                </Link>
                으로 만들어 두면 여기에서 이 물건의 정보로 채워 보여 줍니다.
              </p>
            ) : (
              <div className="mt-2 space-y-4">
                {templates.map((t) => {
                  const r = renderTemplate(t.body, item, direct?.saleAmount ?? null);
                  return (
                    <div key={t.id} data-testid={`rendered-template-${t.id}`}>
                      <p className="mb-1 text-sm font-medium">
                        {t.name} <span className="font-normal text-stone-600">({charCount(r.text)}자)</span>
                      </p>
                      <pre className="whitespace-pre-wrap rounded-md border border-stone-300 bg-stone-50 px-3 py-2 font-sans text-sm">{r.text}</pre>
                      {r.dropped.length > 0 ? (
                        <p className="warn mt-1">
                          값을 입력하지 않아 뺀 줄 {r.dropped.length}개: {[...new Set(r.dropped.flatMap((d) => d.missing))].map((n) => `{${n}}`).join(", ")}
                        </p>
                      ) : null}
                      <div className="mt-2">
                        <CopyButton text={r.text} label={`‘${t.name}’ 복사`} />
                      </div>
                    </div>
                  );
                })}
                <p className="text-xs text-stone-600">
                  <Link href="/templates" className="underline">
                    템플릿 고치기
                  </Link>
                </p>
              </div>
            )}
          </div>
        </div>
      </Section>

      <Section id="offers" title="받은 제안">
        <p className="text-sm text-stone-700">
          구매 희망자가 부른 금액을 적어 두면, 그 금액을 내 개인 판매 계산의 비용에 넣어 따져 봅니다. 입력한 숫자로 한 산수이며, 받을지 말지는 직접
          판단해 주세요. 가격 자료와 따로 두고 비교·요약에는 넣지 않습니다.
        </p>
        {offers.length > 0 ? (
          <>
            <p className="mt-3 text-sm" data-testid="offer-counts">
              기록 {offers.length}건 — {OFFER_STATUSES.map((st) => `${OFFER_STATUS_LABEL[st]} ${offerCounts[st]}건`).join(", ")}
            </p>
            <ul className="mt-2 divide-y divide-stone-200 text-sm">
              {offers.map((o) => {
                const sc = pickOfferScenario(scenarios, item, o.channel);
                const ev = sc ? evaluateOffer(o.amount, sc, offerBuybackNet) : null;
                return (
                  <li key={o.id} className="space-y-1 py-3" data-testid={`offer-${o.id}`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <strong>{formatMoney(o.amount)}</strong>
                      <span className="text-stone-600">
                        {o.receivedDate}
                        {o.channel ? ` · ${o.channel}` : ""}
                      </span>
                      <Badge tone={o.status === "ACCEPTED" ? "teal" : o.status === "DECLINED" ? "neutral" : "amber"}>
                        {OFFER_STATUS_LABEL[o.status]}
                      </Badge>
                    </div>
                    {sc && ev ? (
                      <ul className="list-disc space-y-0.5 pl-5 text-stone-700">
                        <li>
                          {scenarioLabel(SALE_METHOD_LABEL.DIRECT, sc.channel)} 계산의 예상 판매금액 {formatMoney(sc.saleAmount)}보다{" "}
                          {ev.vsPlanned === 0 ? "같음" : signed(ev.vsPlanned)}
                        </li>
                        <li>
                          이 금액에 팔면 예상 실수령액{" "}
                          {ev.net.complete ? (
                            <strong>{formatMoney(ev.net.net!)}</strong>
                          ) : (
                            <span className="text-amber-900">
                              계산 불완전({ev.net.missing.map((k) => COST_LABEL[k]).join(", ")} 미입력)
                            </span>
                          )}
                          {ev.vsBuybackNet !== null
                            ? ` · 업체 판매 실수령액보다 ${ev.vsBuybackNet === 0 ? "같음" : signed(ev.vsBuybackNet)}`
                            : ev.net.complete
                              ? " · 업체 판매 계산이 없거나 불완전해 비교하지 않음"
                              : ""}
                        </li>
                      </ul>
                    ) : (
                      <p className="text-amber-900">
                        {needsPrimary(scenarios, "DIRECT")
                          ? "개인 판매 계산이 여러 개입니다. 제안에 판매처 이름을 적거나 2단계에서 기준 계산을 정하면 따져 볼 수 있습니다."
                          : "개인 판매 금액·비용을 2단계에서 저장하면 이 제안의 실수령액을 따져 볼 수 있습니다."}
                      </p>
                    )}
                    {o.memo ? <p className="whitespace-pre-wrap text-stone-700">메모: {o.memo}</p> : null}
                    <div className="flex flex-wrap gap-2">
                      {OFFER_STATUSES.filter((st) => st !== o.status).map((st) => (
                        <form key={st} action={setOfferStatusAction}>
                          <input type="hidden" name="itemId" value={item.id} />
                          <input type="hidden" name="offerId" value={o.id} />
                          <input type="hidden" name="status" value={st} />
                          <button type="submit" className="btn px-2 py-0.5 text-xs">
                            {st === "OPEN" ? "답하지 않음으로 되돌리기" : `${OFFER_STATUS_LABEL[st]}으로 표시`}
                          </button>
                        </form>
                      ))}
                      <form action={deleteOfferAction}>
                        <input type="hidden" name="itemId" value={item.id} />
                        <input type="hidden" name="offerId" value={o.id} />
                        <ConfirmSubmit message="이 제안 기록을 지울까요?" className="btn-danger px-2 py-0.5 text-xs">
                          지우기
                        </ConfirmSubmit>
                      </form>
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        ) : null}
        <div className="mt-3">
          <OfferForm itemId={item.id} today={today} channelNames={channelNames} />
        </div>
      </Section>

      <Section id="result" step={5} title="실제 판매 결과">
        {result ? (
          <div className="mb-4 space-y-2 text-sm" data-testid="result-summary">
            <div className="flex flex-wrap gap-1.5">
              <Badge tone="neutral" title="내가 직접 기록한 결과이며 외부에서 검증된 체결가가 아닙니다.">
                내가 기록한 결과 · 외부 검증 아님
              </Badge>
            </div>
            <p>
              {result.soldDate} · {result.channel} · 실제 판매금액 <strong>{formatMoney(result.amount)}</strong>
              {result.costTotal !== null ? ` · 실제 비용 ${formatMoney(result.costTotal)}` : " · 실제 비용 모름"}
              {result.minutesSpent !== null ? ` · 들인 시간 ${result.minutesSpent}분` : ""}
            </p>
            {item.chosenSaleAmount !== null ? (
              <ul className="list-disc space-y-1 pl-5" data-testid="result-diff">
                <li>
                  판매금액: 선택 당시 {formatMoney(item.chosenSaleAmount)} → 실제 {formatMoney(result.amount)} (
                  {signed(result.amount - item.chosenSaleAmount)})
                </li>
                <li>
                  실수령액:{" "}
                  {item.chosenNetAmount !== null && result.costTotal !== null
                    ? `선택 당시 예상 ${formatMoney(item.chosenNetAmount)} → 실제 ${formatMoney(result.amount - result.costTotal)} (${signed(
                        result.amount - result.costTotal - item.chosenNetAmount,
                      )})`
                    : "예상 또는 실제 비용을 모르는 항목이 있어 비교하지 않았습니다."}
                </li>
              </ul>
            ) : (
              <p className="text-stone-600">판매 방법을 선택하지 않고 판매해서 예상 금액과 비교할 수 없습니다.</p>
            )}
            {resultCostDiffs ? (
              <div data-testid="result-cost-items">
                <p className="font-medium">비용 항목별 (어림 → 실제)</p>
                <ul className="list-disc space-y-0.5 pl-5">
                  {COST_KEYS.filter((k) => resultCostDiffs[k].actual !== null).map((k) => {
                    const d = resultCostDiffs[k];
                    return (
                      <li key={k}>
                        {COST_LABEL[k]}: {d.planned !== null ? formatMoney(d.planned) : "어림 없음"} → {formatMoney(d.actual!)}
                        {d.diff !== null ? ` (${d.diff === 0 ? "같음" : signed(d.diff)})` : ""}
                      </li>
                    );
                  })}
                </ul>
                {choiceOutdated || !chosenSc ? (
                  <p className="text-stone-600">고른 계산이 없거나 선택 뒤에 바뀌어 어림값과는 비교하지 않았습니다.</p>
                ) : null}
              </div>
            ) : null}
            <form action={deleteSaleResultAction}>
              <input type="hidden" name="itemId" value={item.id} />
              <ConfirmSubmit message="판매 결과 기록을 삭제할까요?" className="btn-danger px-2 py-1 text-xs">
                결과 기록 삭제
              </ConfirmSubmit>
            </form>
          </div>
        ) : (
          <p className="mb-3 text-sm text-stone-600">
            팔고 난 뒤 실제 금액을 기록해 두면 예상과 얼마나 달랐는지 확인할 수 있습니다. 저장하면 물건 상태가 ‘판매 완료’로 바뀝니다.
          </p>
        )}
        <SaleResultForm
          itemId={item.id}
          initial={
            result
              ? {
                  channel: result.channel,
                  soldDate: result.soldDate,
                  amount: String(result.amount),
                  costTotal: result.costTotal === null ? "" : String(result.costTotal),
                  feeActual: result.feeActual === null ? "" : String(result.feeActual),
                  shippingActual: result.shippingActual === null ? "" : String(result.shippingActual),
                  packingActual: result.packingActual === null ? "" : String(result.packingActual),
                  transportActual: result.transportActual === null ? "" : String(result.transportActual),
                  minutesSpent: result.minutesSpent === null ? "" : String(result.minutesSpent),
                  memo: result.memo ?? "",
                }
              : {
                  soldDate: today,
                  // 받기로 한 제안이 있으면 그 금액과 판매처를 미리 채운다(고칠 수 있다).
                  channel: acceptedOffer?.channel || (item.chosenChannel ?? ""),
                  ...(acceptedOffer ? { amount: String(acceptedOffer.amount) } : {}),
                }
          }
        />
      </Section>
    </div>
  );
}
