import Link from "next/link";
import { notFound } from "next/navigation";
import {
  chooseMethodAction,
  deleteItemAction,
  deletePriceAction,
  deleteSaleResultAction,
  togglePriceAction,
} from "@/app/actions";
import { ConfirmSubmit, CopyButton, CsvImportForm, SaleResultForm } from "@/components/client-bits";
import { ScenarioForm, type BasisOption } from "@/components/ScenarioForm";
import { Badge, PriceTypeBadge, Section } from "@/components/ui";
import { getDb } from "@/lib/db/client";
import { getItem, getSaleResult, listPriceHistory, listPrices, listScenarios } from "@/lib/db/repo";
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
import { buildListingDraft } from "@/lib/domain/listing";
import { bpToPercentString, formatMoney } from "@/lib/domain/money";
import { COST_LABEL, computeNet, netDifference, type NetResult } from "@/lib/domain/net";
import { BASIS_ISSUE_LABEL, basisIssues, isChoiceOutdated, type BasisIssue } from "@/lib/domain/scenario";
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
    basisPriceRecordId: str(sc.basisPriceRecordId),
    saleAmount: String(sc.saleAmount),
    feeMode: sc.feeMode,
    feeAmount: str(sc.feeAmount),
    feeRate: sc.feeRateBp === null ? "" : bpToPercentString(sc.feeRateBp),
    shipping: str(sc.shipping),
    packing: str(sc.packing),
    transport: str(sc.transport),
    expectedMinutes: str(sc.expectedMinutes),
  };
}

function NetBox({ sc, net, issues }: { sc: CostScenario; net: NetResult; issues: BasisIssue[] }) {
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
        <div className="warn mb-2" data-testid={`basis-issues-${sc.method}`}>
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
          <dd data-testid={`net-${sc.method}`}>{net.complete ? formatMoney(net.net!) : "계산 불완전"}</dd>
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

  const byMethod = (m: SaleMethod) => scenarios.find((s) => s.method === m);
  const nets = Object.fromEntries(
    SALE_METHODS.map((m) => {
      const sc = byMethod(m);
      return [m, sc ? computeNet(sc) : null];
    }),
  ) as Record<SaleMethod, NetResult | null>;
  const issuesByMethod = Object.fromEntries(
    SALE_METHODS.map((m) => {
      const sc = byMethod(m);
      if (!sc) return [m, []];
      const basis = sc.basisPriceRecordId !== null ? prices.find((p) => p.id === sc.basisPriceRecordId) : undefined;
      return [m, basisIssues(sc, basis, today)];
    }),
  ) as Record<SaleMethod, BasisIssue[]>;
  // 기준 자료에 문제가 있는 계산은 차액 비교에도 쓰지 않는다.
  const diff = netDifference(
    issuesByMethod.DIRECT.length === 0 ? nets.DIRECT : null,
    issuesByMethod.BUYBACK.length === 0 ? nets.BUYBACK : null,
  );
  const choiceOutdated = isChoiceOutdated(item, item.chosenMethod ? byMethod(item.chosenMethod) : undefined);

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

  const direct = byMethod("DIRECT");
  const draft = buildListingDraft(item, direct?.saleAmount ?? null);

  const priceRow = (c: Classified<PriceRecord>) => {
    const p = c.record;
    const age = daysBetween(p.checkedDate, today);
    const expired = isQuoteExpired(p, today);
    return (
      <tr key={p.id} className={c.eligible ? "" : "bg-stone-50 text-stone-600"}>
        <td className="whitespace-nowrap px-2 py-2 align-top font-medium">
          {formatMoney(p.amountMinor, p.currency)}
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
              <p className="mt-1">같은 매물을 고치기 전의 값입니다. 비교와 요약에는 지금 값만 씁니다.</p>
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
            const sc = byMethod(m);
            return (
              <div key={m} className="space-y-3 rounded-md border border-stone-200 p-3" data-testid={`scenario-${m}`}>
                <h3 className="font-semibold">{SALE_METHOD_LABEL[m]}</h3>
                {sc && nets[m] ? (
                  <NetBox sc={sc} net={nets[m]} issues={issuesByMethod[m]} />
                ) : (
                  <p className="text-sm text-stone-600">
                    {m === "BUYBACK" ? "받은 매입 견적이 있으면 금액과 비용을 입력해 보세요." : "받고 싶은 금액과 예상 비용을 입력해 보세요."}
                  </p>
                )}
                <ScenarioForm itemId={item.id} method={m} initial={scenarioInitial(sc)} basisOptions={basisOptions[m]} />
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
                ? scenarios.length < 2
                  ? "한 가지 방법만 입력했습니다. 두 방법을 모두 입력하면 남는 금액의 차이를 보여 드립니다."
                  : SALE_METHODS.some((m) => issuesByMethod[m].length > 0)
                    ? "기준 가격 자료가 바뀌었거나 만료된 계산이 있어 두 방법의 차이를 계산하지 않았습니다."
                    : "비용을 모르는 항목이 있어 두 방법의 차이를 계산하지 않았습니다. 비용이 없으면 0을 입력해 주세요."
                : diff === 0
                  ? "두 방법의 예상 실수령액이 같습니다."
                  : `개인에게 직접 팔면 업체 판매보다 예상 실수령액이 ${formatMoney(Math.abs(diff))} ${diff > 0 ? "더 많습니다" : "더 적습니다"}.`}
            </p>
            {diff !== null && byMethod("DIRECT")?.expectedMinutes != null && byMethod("BUYBACK")?.expectedMinutes != null ? (
              <p className="text-stone-700">
                내가 어림한 소요시간은 개인 판매 {byMethod("DIRECT")!.expectedMinutes}분, 업체 판매 {byMethod("BUYBACK")!.expectedMinutes}분입니다.
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {SALE_METHODS.filter((m) => byMethod(m)).map((m) => (
                <form key={m} action={chooseMethodAction}>
                  <input type="hidden" name="itemId" value={item.id} />
                  <input type="hidden" name="method" value={m} />
                  <button
                    type="submit"
                    className={item.chosenMethod === m ? "btn-primary" : "btn"}
                    aria-pressed={item.chosenMethod === m}
                    disabled={issuesByMethod[m].length > 0}
                    title={issuesByMethod[m].length > 0 ? "기준 가격 자료를 다시 확인해 저장한 뒤 선택할 수 있습니다." : undefined}
                  >
                    {SALE_METHOD_LABEL[m]}
                    {item.chosenMethod === m ? " ✓" : "로 정하기"}
                  </button>
                </form>
              ))}
              {item.chosenMethod ? (
                <form action={chooseMethodAction}>
                  <input type="hidden" name="itemId" value={item.id} />
                  <input type="hidden" name="method" value="" />
                  <button type="submit" className="btn">선택 취소</button>
                </form>
              ) : null}
            </div>
            {item.chosenMethod && choiceOutdated ? (
              <p className="warn" data-testid="choice-outdated">
                선택한 뒤 이 방법의 금액이나 비용을 바꿨습니다. 아래 숫자는 선택 당시 값입니다. 지금 계산으로 바꾸려면 다시 선택해 주세요.
              </p>
            ) : null}
            {item.chosenMethod ? (
              <p data-testid="chosen" className="font-medium">
                선택한 방법: {SALE_METHOD_LABEL[item.chosenMethod]} — 선택 당시 금액 {formatMoney(item.chosenSaleAmount ?? 0)}, 예상 실수령액{" "}
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
            <p className="mb-1 text-sm font-medium">제목</p>
            <p data-testid="draft-title" className="rounded-md border border-stone-300 bg-stone-50 px-3 py-2 text-sm">
              {draft.title}
            </p>
          </div>
          <div>
            <p className="mb-1 text-sm font-medium">본문</p>
            <pre data-testid="draft-body" className="whitespace-pre-wrap rounded-md border border-stone-300 bg-stone-50 px-3 py-2 font-sans text-sm">
              {draft.body}
            </pre>
          </div>
          <div className="flex flex-wrap gap-2">
            <CopyButton text={draft.title} label="제목 복사" />
            <CopyButton text={`${draft.title}\n\n${draft.body}`} label="제목+본문 복사" />
          </div>
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
                  minutesSpent: result.minutesSpent === null ? "" : String(result.minutesSpent),
                  memo: result.memo ?? "",
                }
              : { soldDate: today }
          }
        />
      </Section>
    </div>
  );
}
