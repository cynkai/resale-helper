import type { Metadata } from "next";
import Link from "next/link";
import { Fragment } from "react";
import { TimeValueForm } from "@/components/client-bits";
import { Badge } from "@/components/ui";
import { getDb } from "@/lib/db/client";
import { breakEvenDirectSale, directThresholdWithTime } from "@/lib/domain/break-even";
import { getTimeValuePerHour, listTriageCandidates } from "@/lib/db/repo";
import { primaryScenario, scenarioLabel } from "@/lib/domain/scenario";
import { formatMoney } from "@/lib/domain/money";
import type { NetResult } from "@/lib/domain/net";
import {
  basisTypeLabel,
  compareTriage,
  countVerdicts,
  reasonText,
  triageAlternatives,
  triageItem,
  VERDICT_LABEL,
  warningText,
  type TriageVerdict,
} from "@/lib/domain/triage";
import { CATEGORIES, CATEGORY_LABEL, DISCLAIMER, ITEM_STATUS_LABEL, SALE_METHOD_LABEL, type Category, type SaleMethod } from "@/lib/domain/types";
import { isDemoMode } from "@/lib/mode";
import { todayYmd } from "@/lib/today";

export const metadata: Metadata = { title: "물건 배분" };

const VERDICT_TONE: Record<TriageVerdict, "teal" | "blue" | "amber"> = {
  DIRECT: "teal",
  BUYBACK: "blue",
  UNDECIDED: "amber",
};

function netCell(net: NetResult | null) {
  if (!net) return <span className="text-stone-600">없음</span>;
  if (!net.complete) return <span className="text-amber-900">계산 불완전</span>;
  return formatMoney(net.net!);
}

function signed(n: number): string {
  return `${n > 0 ? "+" : ""}${formatMoney(n)}`;
}

const VERDICTS: TriageVerdict[] = ["DIRECT", "BUYBACK", "UNDECIDED"];

export default async function TriagePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  // 보기 거르기: 판단·카테고리. 건수 요약과 CSV는 거르기 전 전체 기준이다.
  const verdictFilter = VERDICTS.includes(sp.verdict as TriageVerdict) ? (sp.verdict as TriageVerdict) : undefined;
  const categoryFilter = CATEGORIES.includes(sp.category as Category) ? (sp.category as Category) : undefined;
  const demo = await isDemoMode();
  const db = getDb();
  const timeValue = getTimeValuePerHour(db, demo);
  const today = todayYmd();
  const rows = listTriageCandidates(db, demo)
    .map((c) => {
      const result = triageItem(c, timeValue, today);
      const direct = primaryScenario(c.scenarios, "DIRECT");
      // 기준선: 업체 계산이 믿을 만하고(완전·기준 자료 문제 없음) 개인 판매 비용을 모두 알 때만.
      const buybackOk = result.buybackNet?.net != null && !result.reasons.some((r) => r.code === "BASIS_ISSUE" && r.method === "BUYBACK");
      const buybackNet = buybackOk ? result.buybackNet!.net : null;
      const even = direct && buybackOk ? breakEvenDirectSale(direct, buybackNet) : null;
      const withTime = direct && buybackOk ? directThresholdWithTime(direct, buybackNet, result.extraMinutes, timeValue) : null;
      return {
        ...c,
        alternatives: triageAlternatives(c, timeValue, today),
        scenarioOf: (m: SaleMethod) => primaryScenario(c.scenarios, m),
        result,
        lines: {
          even: even?.ok ? even.saleAmount : null,
          withTime: withTime?.ok ? withTime.saleAmount : null,
        },
      };
    })
    .sort((a, b) => compareTriage(a.result, b.result) || a.item.id - b.item.id);
  const counts = countVerdicts(rows.map((r) => r.result));
  const shown = rows.filter((r) => (!verdictFilter || r.result.verdict === verdictFilter) && (!categoryFilter || r.item.category === categoryFilter));
  const categoriesPresent = CATEGORIES.filter((c) => rows.some((r) => r.item.category === c));
  const filterHref = (over: { verdict?: TriageVerdict | null; category?: Category | null }) => {
    const p = new URLSearchParams();
    const v = over.verdict === undefined ? verdictFilter : over.verdict;
    const c = over.category === undefined ? categoryFilter : over.category;
    if (v) p.set("verdict", v);
    if (c) p.set("category", c);
    const qs = p.toString();
    return qs ? `/triage?${qs}` : "/triage";
  };
  const pill = (active: boolean) =>
    `rounded-full border px-3 py-1 ${active ? "border-teal-800 bg-teal-50 font-medium" : "border-stone-300 bg-white hover:bg-stone-100"}`;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">물건 배분{demo ? " (데모)" : ""}</h1>
      <p className="notice">
        아직 팔지 않은 물건마다, 직접 팔면 업체보다 더 받는 돈을 업체에 넘길 때보다 더 드는 시간으로 나눠 내 시간당 가치와 비교합니다. 금액과 소요시간,
        시간당 가치는 모두 내가 입력하거나 어림한 값이며 앱이 예측하지 않습니다. 물건마다 기준이 달라 금액을 합친 총액은 보여 주지 않습니다.
      </p>

      <section aria-label="시간당 가치" className="card">
        <TimeValueForm initial={timeValue} />
      </section>

      {rows.length === 0 ? (
        <div className="card py-10 text-center">
          <p className="font-medium">배분할 물건이 없습니다.</p>
          <p className="mt-1 text-sm text-stone-600">보유 중이거나 판매 중인 물건이 여기에 나옵니다. 판매 완료된 물건은 빠집니다.</p>
          <Link href="/items/new" className="btn mt-4">
            물건 등록하기
          </Link>
        </div>
      ) : (
        <>
          <p className="text-sm">
            <a href="/api/export/triage" className="underline" download>
              이 표를 CSV로 받기
            </a>{" "}
            <span className="text-stone-600">— 물건별 값만 담고 합계는 없습니다.</span>
          </p>
          <section aria-label="판단별 건수" className="card text-sm" data-testid="triage-counts">
            <p>
              물건 {rows.length}개 — <strong>직접 판매 {counts.DIRECT}개</strong>, <strong>업체 {counts.BUYBACK}개</strong>,{" "}
              <strong>판단 보류 {counts.UNDECIDED}개</strong>
            </p>
            {timeValue === null ? (
              <p className="mt-1 text-stone-600">시간당 가치를 비워 두어, 더 받는 물건 중 시간 대비 판단이 필요한 것은 보류됩니다.</p>
            ) : (
              <p className="mt-1 text-stone-600">기준: 내 시간 시간당 {formatMoney(timeValue)}. 시간당 추가 수익이 이 값 이상이면 직접 판매입니다.</p>
            )}
          </section>

          <nav aria-label="배분 표 거르기" className="space-y-2 text-sm" data-testid="triage-filter">
            <div className="flex flex-wrap gap-2">
              <Link href={filterHref({ verdict: null })} aria-current={verdictFilter ? undefined : "true"} className={pill(!verdictFilter)}>
                모든 판단
              </Link>
              {VERDICTS.filter((v) => counts[v] > 0).map((v) => (
                <Link key={v} href={filterHref({ verdict: v })} aria-current={verdictFilter === v ? "true" : undefined} className={pill(verdictFilter === v)}>
                  {VERDICT_LABEL[v]} {counts[v]}
                </Link>
              ))}
            </div>
            {categoriesPresent.length > 1 ? (
              <div className="flex flex-wrap gap-2">
                <Link href={filterHref({ category: null })} aria-current={categoryFilter ? undefined : "true"} className={pill(!categoryFilter)}>
                  모든 카테고리
                </Link>
                {categoriesPresent.map((c) => (
                  <Link key={c} href={filterHref({ category: c })} aria-current={categoryFilter === c ? "true" : undefined} className={pill(categoryFilter === c)}>
                    {CATEGORY_LABEL[c]}
                  </Link>
                ))}
              </div>
            ) : null}
            {verdictFilter || categoryFilter ? (
              <p className="text-stone-700" data-testid="triage-shown">
                {rows.length}개 중 {shown.length}개를 보고 있습니다.{" "}
                <Link href="/triage" className="underline">
                  모두 보기
                </Link>
              </p>
            ) : null}
          </nav>

          {shown.length === 0 ? (
            <p className="card text-sm text-stone-700">이 조건에 맞는 물건이 없습니다.</p>
          ) : (
          <div className="card overflow-x-auto p-0">
            <table className="w-full min-w-[840px] border-collapse text-sm">
              <caption className="sr-only">물건별 배분 판단</caption>
              <thead>
                <tr className="border-b border-stone-300 text-left text-xs text-stone-600">
                  <th scope="col" className="px-3 py-2 font-medium">물건</th>
                  <th scope="col" className="px-3 py-2 font-medium">카테고리</th>
                  <th scope="col" className="px-3 py-2 font-medium">판단</th>
                  <th scope="col" className="px-3 py-2 font-medium">업체 실수령액</th>
                  <th scope="col" className="px-3 py-2 font-medium">직접 판매 실수령액</th>
                  <th scope="col" className="px-3 py-2 font-medium">차액</th>
                  <th scope="col" className="px-3 py-2 font-medium">추가 소요시간</th>
                  <th scope="col" className="px-3 py-2 font-medium">시간당 추가 수익</th>
                  <th scope="col" className="px-3 py-2 font-medium">기준 자료 유형</th>
                </tr>
              </thead>
              <tbody>
                {shown.map(({ item, result, scenarioOf, lines, alternatives }) => {
                  const buyback = scenarioOf("BUYBACK");
                  const direct = scenarioOf("DIRECT");
                  const bg = result.verdict === "UNDECIDED" ? "bg-amber-50/40" : "";
                  return (
                    <Fragment key={item.id}>
                    <tr data-testid={`triage-${item.id}`} className={`border-t border-stone-200 ${bg}`}>
                      <td className="px-3 py-2 align-top">
                        <Link href={`/items/${item.id}#net`} className="font-medium underline">
                          {item.name}
                        </Link>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {item.isDemo ? <Badge tone="amber">가상</Badge> : null}
                          <Badge>{ITEM_STATUS_LABEL[item.status]}</Badge>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 align-top">{CATEGORY_LABEL[item.category]}</td>
                      <td className="px-3 py-2 align-top" data-testid={`verdict-${item.id}`}>
                        <Badge tone={VERDICT_TONE[result.verdict]}>{VERDICT_LABEL[result.verdict]}</Badge>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 align-top">{netCell(result.buybackNet)}</td>
                      <td className="whitespace-nowrap px-3 py-2 align-top">{netCell(result.directNet)}</td>
                      <td className="whitespace-nowrap px-3 py-2 align-top">{result.extra === null ? "—" : signed(result.extra)}</td>
                      <td className="whitespace-nowrap px-3 py-2 align-top">
                        {result.extraMinutes !== null ? (
                          `${result.extraMinutes > 0 ? "+" : ""}${result.extraMinutes}분`
                        ) : buyback || direct ? (
                          <span className="text-amber-900">모름</span>
                        ) : (
                          "—"
                        )}
                        <div className="text-xs text-stone-600">
                          직접 {direct ? (result.minutes ?? "모름") : "—"}
                          {typeof result.minutes === "number" ? "분" : ""} − 업체 {buyback ? (result.buybackMinutes ?? "모름") : "—"}
                          {typeof result.buybackMinutes === "number" ? "분" : ""}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 align-top" data-testid={`per-hour-${item.id}`}>
                        {result.extraPerHour !== null ? `${formatMoney(result.extraPerHour)}/시간` : "—"}
                      </td>
                      <td className="px-3 py-2 align-top text-xs">
                        <div>
                          업체: {buyback ? basisTypeLabel(buyback.basisPriceType) : "—"}
                          {buyback?.channel ? ` (${buyback.channel})` : ""}
                        </div>
                        <div>
                          직접: {direct ? basisTypeLabel(direct.basisPriceType) : "—"}
                          {direct?.channel ? ` (${direct.channel})` : ""}
                        </div>
                      </td>
                    </tr>
                    {/* 이유·경고는 열이 좁아 잘리지 않도록 물건 행 아래 전체 폭으로 둔다. */}
                    <tr className={bg}>
                      <td colSpan={9} className="px-3 pb-3 pt-0 text-xs" data-testid={`reasons-${item.id}`}>
                        <span className="sr-only">경고 · 보류 이유: </span>
                        <ul className="space-y-0.5">
                          {result.reasons.map((r, i) => (
                            <li key={`r${i}`} className={result.verdict === "UNDECIDED" ? "text-amber-950" : "text-stone-700"}>
                              {reasonText(r)}
                            </li>
                          ))}
                          {result.warnings.map((w, i) => (
                            <li key={`w${i}`} className="text-amber-900">
                              ⚠ {warningText(w)}
                            </li>
                          ))}
                        </ul>
                        {lines.even !== null ? (
                          <p className="mt-1 text-stone-700" data-testid={`lines-${item.id}`}>
                            기준선(입력한 비용으로 한 산수, 예측 아님): 직접 판매금액이 {formatMoney(lines.even)} 이상이면 업체와 실수령액이 같거나 많음
                            {lines.withTime !== null ? ` · ${formatMoney(lines.withTime)} 이상이면 내 시간당 가치까지 넘김` : ""}
                          </p>
                        ) : null}
                        {alternatives.length > 0 ? (
                          <details className="mt-1" data-testid={`alts-${item.id}`}>
                            <summary className="cursor-pointer text-stone-700">판매처별로 따져 보기 ({alternatives.length}개)</summary>
                            <p className="mt-1 text-stone-600">
                              기준이 아닌 계산을 기준 자리에 넣어 같은 규칙으로 따져 본 것입니다. 입력한 순서이며 순위가 아니고, 위 건수 요약에는 넣지 않습니다.
                            </p>
                            <ul className="mt-1 space-y-1">
                              {alternatives.map(({ scenario: sc, result: r }) => (
                                <li key={sc.id} data-testid={`alt-${sc.id}`}>
                                  <span className="font-medium">{scenarioLabel(SALE_METHOD_LABEL[sc.method], sc.channel)}</span>
                                  {" → "}
                                  <Badge tone={VERDICT_TONE[r.verdict]}>{VERDICT_LABEL[r.verdict]}</Badge>
                                  {r.extra !== null ? ` · 차액 ${signed(r.extra)}` : ""}
                                  {r.extraMinutes !== null ? ` · 추가 ${r.extraMinutes > 0 ? "+" : ""}${r.extraMinutes}분` : ""}
                                  {r.extraPerHour !== null ? ` · ${formatMoney(r.extraPerHour)}/시간` : ""}
                                  <span className={r.verdict === "UNDECIDED" ? " text-amber-950" : " text-stone-700"}>
                                    {" — "}
                                    {r.reasons.map(reasonText).join(" ")}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </details>
                        ) : null}
                        {result.verdict === "UNDECIDED" && !result.reasons.some((r) => r.code === "NO_TIME_VALUE") ? (
                          <Link href={`/items/${item.id}#net`} className="mt-1 inline-block underline">
                            물건 상세에서 채우기
                          </Link>
                        ) : null}
                      </td>
                    </tr>
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          )}
        </>
      )}

      <p className="text-xs text-stone-600">{DISCLAIMER}</p>
    </div>
  );
}
