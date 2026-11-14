import Link from "next/link";
import { Badge } from "@/components/ui";
import { getDb } from "@/lib/db/client";
import { listCheckupSources } from "@/lib/db/repo";
import { checkupItem, countFindings, needsAttention, type CheckupFinding } from "@/lib/domain/checkup";
import { OLD_DATA_DAYS } from "@/lib/domain/compare";
import { formatMoney } from "@/lib/domain/money";
import { BASIS_ISSUE_LABEL } from "@/lib/domain/scenario";
import { CATEGORY_LABEL, DISCLAIMER, SALE_METHOD_LABEL } from "@/lib/domain/types";
import { isDemoMode } from "@/lib/mode";
import { todayYmd } from "@/lib/today";

function findingLine(f: CheckupFinding) {
  switch (f.kind) {
    case "QUOTE_EXPIRED":
      return (
        <>
          <strong>견적 만료</strong> — {f.sourceName} {formatMoney(f.amountMinor)} 견적의 유효기간({f.validUntil})이 {f.daysAgo}일 전에 지났습니다. 지금 받을 수 있는
          금액이 아닐 수 있습니다.
        </>
      );
    case "QUOTE_VALID":
      return (
        <>
          견적 유효기간 — {f.sourceName} {formatMoney(f.amountMinor)}: {f.validUntil}까지 ({f.daysLeft === 0 ? "오늘까지" : `${f.daysLeft}일 남음`})
        </>
      );
    case "OLD_DATA":
      return (
        <>
          <strong>오래된 자료</strong> — 비교에 포함된 자료 {f.count}건이 확인한 지 {OLD_DATA_DAYS}일을 넘었습니다(가장 오래된 것: {f.oldestCheckedDate},{" "}
          {f.oldestDays}일 전).
        </>
      );
    case "BASIS_ISSUE":
      return (
        <>
          <strong>{SALE_METHOD_LABEL[f.method]} 계산 다시 확인</strong> — {f.issues.map((i) => BASIS_ISSUE_LABEL[i]).join(" ")}
        </>
      );
  }
}

export default async function CheckupPage() {
  const demo = await isDemoMode();
  const today = todayYmd();
  const rows = listCheckupSources(getDb(), demo)
    .map((s) => ({ item: s.item, findings: checkupItem(s, today) }))
    .filter((r) => r.findings.length > 0)
    .sort((a, b) => Number(needsAttention(b.findings)) - Number(needsAttention(a.findings)) || a.item.id - b.item.id);
  const counts = countFindings(rows.map((r) => r.findings));
  const attention = rows.filter((r) => needsAttention(r.findings)).length;

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
            유효기간이 있는 매입 견적, 확인한 지 {OLD_DATA_DAYS}일이 넘은 자료, 기준 자료가 바뀐 계산이 생기면 여기에 나옵니다.
          </p>
        </div>
      ) : (
        <>
          <section aria-label="요약" className="card text-sm" data-testid="checkup-counts">
            <p>
              손볼 물건 <strong>{attention}개</strong> — 만료된 견적 {counts.QUOTE_EXPIRED}건, 오래된 자료 {counts.OLD_DATA}건, 다시 확인할 계산{" "}
              {counts.BASIS_ISSUE}건 · 유효기간이 남은 견적 {counts.QUOTE_VALID}건
            </p>
          </section>
          <ul className="space-y-2">
            {rows.map(({ item, findings }) => (
              <li key={item.id} className="card" data-testid={`checkup-${item.id}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <Link href={`/items/${item.id}#prices`} className="font-semibold underline">
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
                      {findingLine(f)}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="text-xs text-stone-600">{DISCLAIMER}</p>
    </div>
  );
}
