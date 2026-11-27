import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui";
import { getDb } from "@/lib/db/client";
import { listCheckupSources } from "@/lib/db/repo";
import { checkupItem, countFindings, needsAttention, type CheckupFinding } from "@/lib/domain/checkup";
import { OLD_DATA_DAYS } from "@/lib/domain/compare";
import { formatMoney } from "@/lib/domain/money";
import { BASIS_ISSUE_LABEL, scenarioLabel } from "@/lib/domain/scenario";
import { CATEGORY_LABEL, DISCLAIMER, SALE_METHOD_LABEL } from "@/lib/domain/types";
import { isDemoMode } from "@/lib/mode";
import { todayYmd } from "@/lib/today";

export const metadata: Metadata = { title: "자료 점검" };

const FINDING_FILTERS = [
  { kind: "QUOTE_EXPIRED", label: "만료된 견적" },
  { kind: "OLD_DATA", label: "오래된 자료" },
  { kind: "BASIS_ISSUE", label: "다시 확인할 계산" },
  { kind: "OPEN_OFFERS", label: "답하지 않은 제안" },
  { kind: "POSTED_BELOW_BREAK_EVEN", label: "손익분기보다 낮게 올린 가격" },
  { kind: "QUOTE_VALID", label: "유효기간이 남은 견적" },
] as const satisfies readonly { kind: CheckupFinding["kind"]; label: string }[];

// 브라우저의 앵커 이동으로 대상 견적 행을 :target 스타일로 강조한다.
function findingLine(f: CheckupFinding, itemId: number) {
  const itemHref = `/items/${itemId}`;
  switch (f.kind) {
    case "QUOTE_EXPIRED":
      return (
        <>
          <strong>견적 만료</strong> —{" "}
          <a href={`${itemHref}#price-${f.priceId}`} className="underline">
            {f.sourceName} {formatMoney(f.amountMinor, f.currency)}
          </a>{" "}
          견적의 유효기간({f.validUntil})이 {f.daysAgo}일 전에 지났습니다. 지금 받을 수 있는 금액이 아닐 수 있습니다.
        </>
      );
    case "QUOTE_VALID":
      return (
        <>
          <a href={`${itemHref}#price-${f.priceId}`} className="underline">
            {f.sourceName} {formatMoney(f.amountMinor, f.currency)}
          </a>{" "}
          견적은 {f.validUntil}까지 유효합니다 ({f.daysLeft === 0 ? "오늘까지" : `${f.daysLeft}일 남음`}).
        </>
      );
    case "OLD_DATA":
      return (
        <>
          <strong>오래된 자료</strong> — 비교에 포함된 자료 {f.count}건이 확인한 지 {OLD_DATA_DAYS}일을 넘었습니다(가장 오래된 것: {f.oldestCheckedDate},{" "}
          {f.oldestDays}일 전). <a href={`${itemHref}#prices`} className="underline">가격 자료 보기</a>
        </>
      );
    case "OPEN_OFFERS":
      return (
        <>
          <strong>답하지 않은 제안 {f.count}건</strong> — 가장 오래된 것: {f.oldestReceivedDate}
          {f.oldestDays === 0 ? " (오늘)" : ` (${f.oldestDays}일 전)`}.{" "}
          <a href={`${itemHref}#offers`} className="underline">받은 제안 보기</a>
        </>
      );
    case "POSTED_BELOW_BREAK_EVEN":
      return (
        <>
          <strong>올린 가격이 손익분기보다 낮음</strong> — 지금 올린 가격 {formatMoney(f.posted)}이 손익분기 개인 판매금액 {formatMoney(f.breakEven)}보다
          낮습니다. 내가 입력한 비용대로라면 이 가격에 팔 때 업체에 넘기는 것보다 덜 남습니다.{" "}
          <a href={`${itemHref}#listing`} className="underline">판매글·올린 가격 보기</a>
        </>
      );
    case "BASIS_ISSUE":
      return (
        <>
          <a href={`${itemHref}#net`} className="font-semibold underline">
            {scenarioLabel(SALE_METHOD_LABEL[f.method], f.channel)} 계산 다시 확인
          </a>{" "}
          — {f.issues.map((i) => BASIS_ISSUE_LABEL[i]).join(" ")}
        </>
      );
  }
}

export default async function CheckupPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string | string[] }>;
}) {
  const { kind } = await searchParams;
  const selected = FINDING_FILTERS.find((f) => f.kind === kind)?.kind;
  const demo = await isDemoMode();
  const today = todayYmd();
  const rows = listCheckupSources(getDb(), demo)
    .map((s) => ({ item: s.item, findings: checkupItem(s, today) }))
    .filter((r) => r.findings.length > 0)
    .sort((a, b) => Number(needsAttention(b.findings)) - Number(needsAttention(a.findings)) || a.item.id - b.item.id);
  const counts = countFindings(rows.map((r) => r.findings));
  const attention = rows.filter((r) => needsAttention(r.findings)).length;
  const shown = selected
    ? rows.map(({ item, findings }) => ({ item, findings: findings.filter((f) => f.kind === selected) })).filter((r) => r.findings.length > 0)
    : rows;
  const filterClass = (active: boolean) =>
    `rounded-full border px-3 py-1 ${active ? "border-teal-800 bg-teal-50 font-medium" : "border-stone-300 bg-white hover:bg-stone-100"}`;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">자료 점검{demo ? " (데모)" : ""}</h1>
      <p className="notice">
        아직 팔지 않은 물건의 가격 자료와 저장한 계산 가운데 다시 확인할 것을 모았습니다. 날짜와 저장된 내용만 보고 알려 주며, 가격이 올랐는지
        내렸는지는 앱이 알지 못합니다. 출처에서 직접 다시 확인해 주세요.
      </p>

      {rows.length === 0 ? (
        <div className="card py-10 text-center" data-testid="checkup-empty">
          <p className="font-medium">다시 확인할 자료가 없습니다.</p>
          <p className="mt-1 text-sm text-stone-600">
            유효기간이 있는 매입 견적, 확인한 지 {OLD_DATA_DAYS}일이 넘은 자료, 기준 자료가 바뀐 계산, 답하지 않은 제안, 손익분기보다 낮게 올린 가격이 생기면
            여기에 나옵니다.
          </p>
        </div>
      ) : (
        <>
          <section aria-label="요약" className="card text-sm" data-testid="checkup-counts">
            <p>
              손볼 물건 <strong>{attention}개</strong>
            </p>
            <nav aria-label="점검 항목 거르기" className="mt-2 flex flex-wrap gap-2">
              <Link href="/checkup" aria-current={!selected ? "true" : undefined} className={filterClass(!selected)}>
                모든 항목
              </Link>
              {FINDING_FILTERS.map(({ kind, label }) => (
                <Link
                  key={kind}
                  href={`/checkup?kind=${kind}`}
                  aria-current={selected === kind ? "true" : undefined}
                  className={filterClass(selected === kind)}
                >
                  {label} {counts[kind]}건
                </Link>
              ))}
            </nav>
            {selected && shown.length > 0 ? <p className="mt-2 text-stone-700">{shown.length}개 물건에 해당합니다.</p> : null}
          </section>
          {shown.length === 0 ? (
            <p className="card text-sm text-stone-700">이 조건에 해당하는 점검 항목이 없습니다.</p>
          ) : (
            <ul className="space-y-2">
              {shown.map(({ item, findings }) => (
                <li key={item.id} className="card" data-testid={`checkup-${item.id}`}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <Link href={`/items/${item.id}`} className="font-semibold underline">
                      {item.name}
                    </Link>
                    <div className="flex flex-wrap gap-1.5">
                      {item.isDemo ? <Badge tone="amber">가상</Badge> : null}
                      <Badge>{CATEGORY_LABEL[item.category]}</Badge>
                      {needsAttention(findings) ? <Badge tone="amber">확인 필요</Badge> : <Badge>참고</Badge>}
                    </div>
                  </div>
                  <ul className="mt-2 space-y-1 text-sm">
                    {findings.map((f, i) => (
                      <li key={i} className={f.kind === "QUOTE_VALID" ? "text-stone-700" : "text-amber-950"}>
                        {findingLine(f, item.id)}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <p className="text-xs text-stone-600">{DISCLAIMER}</p>
    </div>
  );
}
