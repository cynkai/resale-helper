import Link from "next/link";
import { Fragment } from "react";
import { TimeValueForm } from "@/components/client-bits";
import { Badge } from "@/components/ui";
import { getDb } from "@/lib/db/client";
import { getTimeValuePerHour, listTriageCandidates } from "@/lib/db/repo";
import { formatMoney } from "@/lib/domain/money";
import type { NetResult } from "@/lib/domain/net";
import {
  basisTypeLabel,
  compareTriage,
  countVerdicts,
  reasonText,
  triageItem,
  VERDICT_LABEL,
  warningText,
  type TriageVerdict,
} from "@/lib/domain/triage";
import { CATEGORY_LABEL, DISCLAIMER, ITEM_STATUS_LABEL, type SaleMethod } from "@/lib/domain/types";
import { isDemoMode } from "@/lib/mode";
import { todayYmd } from "@/lib/today";

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

export default async function TriagePage() {
  const demo = await isDemoMode();
  const db = getDb();
  const timeValue = getTimeValuePerHour(db, demo);
  const today = todayYmd();
  const rows = listTriageCandidates(db, demo)
    .map((c) => ({
      ...c,
      scenarioOf: (m: SaleMethod) => c.scenarios.find((s) => s.method === m),
      result: triageItem(c, timeValue, today),
    }))
    .sort((a, b) => compareTriage(a.result, b.result) || a.item.id - b.item.id);
  const counts = countVerdicts(rows.map((r) => r.result));

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
                {rows.map(({ item, result, scenarioOf }) => {
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
                        <div>업체: {buyback ? basisTypeLabel(buyback.basisPriceType) : "—"}</div>
                        <div>직접: {direct ? basisTypeLabel(direct.basisPriceType) : "—"}</div>
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
        </>
      )}

      <p className="text-xs text-stone-600">{DISCLAIMER}</p>
    </div>
  );
}
