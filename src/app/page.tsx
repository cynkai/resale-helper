import type { Metadata } from "next";
import { scenarioLabel } from "@/lib/domain/scenario";
import Link from "next/link";
import { bulkItemsAction } from "@/app/actions";
import { ConfirmSubmit, SelectAllToggle } from "@/components/client-bits";
import { Badge } from "@/components/ui";
import { getDb } from "@/lib/db/client";
import { listCheckupSources, listItems, countTrashedItems, countTrashedPrices, ITEM_SORT_LABEL, ITEM_SORTS } from "@/lib/db/repo";
import { checkupItem, needsAttention } from "@/lib/domain/checkup";
import { countNextSteps, NEXT_STEP_CODES, NEXT_STEP_LABEL, nextStep, nextStepHref, type NextStepCode } from "@/lib/domain/next-step";
import {
  CATEGORIES,
  CATEGORY_LABEL,
  CONDITION_LABEL,
  ITEM_STATUSES,
  ITEM_STATUS_LABEL,
  SALE_METHOD_LABEL,
} from "@/lib/domain/types";
import { isDemoMode } from "@/lib/mode";
import { todayYmd } from "@/lib/today";

// 루트 레이아웃과 같은 구간이라 제목 틀(template)이 적용되지 않는다.
export const metadata: Metadata = { title: { absolute: "내 물건 · 얼마에 팔까" } };

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = Object.fromEntries(Object.entries(await searchParams).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value] as const));
  const q = sp.q?.trim() ?? "";
  const category = CATEGORIES.find((c) => c === sp.category);
  const status = ITEM_STATUSES.find((s) => s === sp.status);
  const demo = await isDemoMode();
  const step = NEXT_STEP_CODES.find((code) => code === sp.step);
  const db = getDb();
  const sort = ITEM_SORTS.find((key) => key === sp.sort) ?? "updated";
  const all = listItems(db, demo, { q, category, status, sort }).map((r) => ({
    ...r,
    step: nextStep({ status: r.item.status, priceCount: r.priceCount, scenarioCount: r.scenarioCount, chosenMethod: r.item.chosenMethod, hasResult: r.resultCount > 0 }),
  }));
  // 할 일별 건수는 할 일 필터를 걸기 전(다른 조건만 적용한) 목록으로 센다.
  const stepCounts = countNextSteps(all.map((r) => r.step));
  const rows = step ? all.filter((r) => r.step === step) : all;
  const filtered = Boolean(q || category || status || step || sort !== "updated");
  // 자료 점검에서 "확인 필요"로 나오는 물건 수(검색 조건과 무관, 현재 모드 전체).
  const today = todayYmd();
  const attention = listCheckupSources(db, demo).filter((s) => needsAttention(checkupItem(s, today))).length;
  const trashCount = countTrashedItems(db, demo);
  const trashPriceCount = countTrashedPrices(db, demo);
  // 한꺼번에 바꾼 뒤 같은 목록으로 돌아오기 위한 지금의 검색 조건.
  const listQuery = (() => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (category) p.set("category", category);
    if (status) p.set("status", status);
    if (sort !== "updated") p.set("sort", sort);
    if (step) p.set("step", step);
    return p.toString();
  })();
  const BULK_DONE_LABEL: Record<string, string> = { LISTED: "판매 중으로 표시했습니다", OWNED: "보유 중으로 되돌렸습니다", TRASH: "휴지통으로 옮겼습니다" };
  const bulkDone = sp.bulk && Object.hasOwn(BULK_DONE_LABEL, sp.bulk) && /^\d+$/.test(sp.done ?? "") ? { op: sp.bulk, done: Number(sp.done), skipped: Number(sp.skipped ?? 0) } : null;
  const stepHref = (code?: NextStepCode) => {
    const p = new URLSearchParams(listQuery);
    p.delete("step");
    if (code) p.set("step", code);
    const qs = p.toString();
    return qs ? `/?${qs}` : "/";
  };

  return (
    <div className="inventory space-y-4">
      {bulkDone ? (
        <p className="notice" role="status" data-testid="bulk-items-notice">
          물건 {bulkDone.done}개를 {BULK_DONE_LABEL[bulkDone.op]}.
          {bulkDone.skipped > 0 ? ` ${bulkDone.skipped}개는 판매 완료(판매 결과 있음)이거나 이미 없는 물건이라 건너뛰었습니다.` : ""}
          {bulkDone.op === "TRASH" && bulkDone.done > 0 ? (
            <>
              {" "}
              <Link href="/trash" className="underline">
                휴지통에서 되살리기
              </Link>
            </>
          ) : null}
        </p>
      ) : null}
      {sp.trashed === "1" ? (
        <p className="notice" role="status" data-testid="trashed-notice">
          물건을 휴지통으로 옮겼습니다.{" "}
          <Link href="/trash" className="underline">
            휴지통에서 되살리기
          </Link>
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <h1 className="text-2xl font-bold">내 물건{demo ? " (데모)" : ""}</h1>
          <span className="text-sm text-stone-600">{rows.length}개</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {attention > 0 ? (
            <Link href="/checkup" className="btn" data-testid="checkup-link">
              다시 확인할 물건 {attention}개
            </Link>
          ) : null}
          <Link href="/triage" className="btn">어디로 넘길까 (배분)</Link>
          <Link href="/items/import" className="btn">CSV로 한꺼번에 등록</Link>
          {trashCount + trashPriceCount > 0 ? (
            <Link href="/trash" className="btn" data-testid="trash-link">
              휴지통{" "}
              {[trashCount > 0 ? `물건 ${trashCount}개` : null, trashPriceCount > 0 ? `가격 자료 ${trashPriceCount}건` : null].filter(Boolean).join(" · ")}
            </Link>
          ) : null}
        </div>
      </div>

      <form method="get" className="card grid grid-cols-2 gap-2 lg:grid-cols-[minmax(0,1fr)_auto_auto_auto_auto]" role="search">
        {step ? <input type="hidden" name="step" value={step} /> : null}
        <div className="col-span-2 lg:col-span-1">
          <label htmlFor="q" className="sr-only">검색</label>
          <input id="q" name="q" defaultValue={q} className="input" placeholder="이름·ISBN·모델명·저자·구성품·메모 검색" />
        </div>
        <div>
          <label htmlFor="category" className="sr-only">카테고리</label>
          <select id="category" name="category" defaultValue={category ?? ""} className="input">
            <option value="">모든 카테고리</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="status" className="sr-only">판매 상태</label>
          <select id="status" name="status" defaultValue={status ?? ""} className="input">
            <option value="">모든 상태</option>
            {ITEM_STATUSES.map((c) => (
              <option key={c} value={c}>{ITEM_STATUS_LABEL[c]}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="sort" className="sr-only">정렬</label>
          <select id="sort" name="sort" defaultValue={sort} className="input">
            {ITEM_SORTS.map((c) => (
              <option key={c} value={c}>{ITEM_SORT_LABEL[c]}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="submit" className="btn">찾기</button>
          {filtered ? <Link href="/" className="btn">초기화</Link> : null}
        </div>
      </form>

      {all.length > 0 ? (
        <nav aria-label="다음에 할 일로 보기" className="flex flex-wrap gap-2 text-sm" data-testid="step-filter">
          <Link href={stepHref()} aria-current={step ? undefined : "true"} className={`rounded-full border px-3 py-1 ${step ? "border-stone-300 bg-white hover:bg-stone-100" : "border-teal-800 bg-teal-50 font-medium"}`}>
            전체 {all.length}
          </Link>
          {NEXT_STEP_CODES.filter((c) => stepCounts[c] > 0).map((c) => (
            <Link
              key={c}
              href={stepHref(c)}
              aria-current={step === c ? "true" : undefined}
              className={`rounded-full border px-3 py-1 ${step === c ? "border-teal-800 bg-teal-50 font-medium" : "border-stone-300 bg-white hover:bg-stone-100"}`}
            >
              {NEXT_STEP_LABEL[c]} {stepCounts[c]}
            </Link>
          ))}
        </nav>
      ) : null}

      {rows.length === 0 ? (
        <div className="card py-10 text-center">
          {filtered ? (
            <>
              <p className="font-medium">조건에 맞는 물건이 없습니다.</p>
              <Link href="/" className="btn mt-3">전체 물건 보기</Link>
            </>
          ) : (
            <>
              <p className="font-medium">아직 등록한 물건이 없습니다.</p>
              <p className="mt-1 text-sm text-stone-600">팔고 싶은 책이나 기기를 등록하면 가격 자료를 모으고 실수령액을 비교할 수 있습니다.</p>
              <Link href="/items/new" className="btn-primary mt-4">첫 물건 등록하기</Link>
            </>
          )}
        </div>
      ) : (
        <>
        <form id="bulk-items" action={bulkItemsAction} className="flex flex-wrap items-center gap-2 text-sm" data-testid="bulk-items">
          <input type="hidden" name="back" value={listQuery} />
          <span className="text-stone-700">일괄 작업</span>
          <SelectAllToggle formId="bulk-items" name="itemIds" />
          <button type="submit" name="op" value="LISTED" className="btn px-2 py-1 text-xs">
            판매 중으로 표시
          </button>
          <button type="submit" name="op" value="OWNED" className="btn px-2 py-1 text-xs">
            보유 중으로 되돌리기
          </button>
          <ConfirmSubmit
            name="op"
            value="TRASH"
            message="고른 물건을 휴지통으로 옮깁니다. 딸린 자료는 그대로 두며 휴지통에서 되살릴 수 있습니다. 계속할까요?"
            className="btn-danger px-2 py-1 text-xs"
          >
            휴지통으로
          </ConfirmSubmit>
        </form>
        <ul className="space-y-2">
          {rows.map(({ item, priceCount, step, openOfferCount }) => {
            return (
            <li key={item.id} className="card min-w-0 p-0">
              <Link href={`/items/${item.id}`} className="block rounded-t-lg p-4 hover:bg-stone-50">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="wrap-anywhere font-semibold">{item.name}</p>
                    <p className="mt-0.5 wrap-anywhere text-sm text-stone-600">
                      {[item.identifier, item.edition, CONDITION_LABEL[item.condition]].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {item.isDemo ? <Badge tone="amber">가상 데이터</Badge> : null}
                    {openOfferCount > 0 && item.status !== "SOLD" ? <Badge tone="amber">답하지 않은 제안 {openOfferCount}건</Badge> : null}
                    <Badge>{CATEGORY_LABEL[item.category]}</Badge>
                    <Badge tone={item.status === "SOLD" ? "teal" : item.status === "LISTED" ? "blue" : "neutral"}>
                      {ITEM_STATUS_LABEL[item.status]}
                    </Badge>
                  </div>
                </div>
                <p className="mt-2 text-sm text-stone-700">
                  {priceCount > 0 ? `가격 자료 ${priceCount}건` : "가격 자료 없음"}
                  {item.chosenMethod ? ` · 선택: ${scenarioLabel(SALE_METHOD_LABEL[item.chosenMethod], item.chosenChannel ?? "")}` : ""}
                </p>
              </Link>
              <div className="flex flex-wrap items-center justify-between gap-x-2 border-t border-stone-200 px-4">
                <Link href={nextStepHref(item.id, step)} className="inline-flex min-h-11 items-center gap-1 text-sm text-teal-900 underline-offset-4 hover:underline" data-testid={`next-step-${item.id}`}>
                  <span className="text-stone-600">{step === "DONE" ? "완료: " : "다음: "}</span>
                  <span className="font-medium">{NEXT_STEP_LABEL[step]}</span>
                </Link>
                <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-stone-700">
                  <input type="checkbox" name="itemIds" value={item.id} form="bulk-items" aria-label={`${item.name} 선택`} />
                  선택
                </label>
              </div>
            </li>
            );
          })}
        </ul>
        </>
      )}
    </div>
  );
}
