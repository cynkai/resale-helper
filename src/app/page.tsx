import Link from "next/link";
import { Badge } from "@/components/ui";
import { getDb } from "@/lib/db/client";
import { listItems } from "@/lib/db/repo";
import { countNextSteps, NEXT_STEP_CODES, NEXT_STEP_LABEL, nextStep, type NextStepCode } from "@/lib/domain/next-step";
import {
  CATEGORIES,
  CATEGORY_LABEL,
  CONDITION_LABEL,
  ITEM_STATUSES,
  ITEM_STATUS_LABEL,
  SALE_METHOD_LABEL,
  type Category,
  type ItemStatus,
} from "@/lib/domain/types";
import { isDemoMode } from "@/lib/mode";

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const q = sp.q ?? "";
  const category = CATEGORIES.includes(sp.category as Category) ? (sp.category as Category) : undefined;
  const status = ITEM_STATUSES.includes(sp.status as ItemStatus) ? (sp.status as ItemStatus) : undefined;
  const demo = await isDemoMode();
  const step = NEXT_STEP_CODES.includes(sp.step as NextStepCode) ? (sp.step as NextStepCode) : undefined;
  const all = listItems(getDb(), demo, { q, category, status }).map((r) => ({
    ...r,
    step: nextStep({ status: r.item.status, priceCount: r.priceCount, scenarioCount: r.scenarioCount, chosenMethod: r.item.chosenMethod, hasResult: r.resultCount > 0 }),
  }));
  // 할 일별 건수는 할 일 필터를 걸기 전(다른 조건만 적용한) 목록으로 센다.
  const stepCounts = countNextSteps(all.map((r) => r.step));
  const rows = step ? all.filter((r) => r.step === step) : all;
  const filtered = Boolean(q || category || status || step);
  const stepHref = (code?: NextStepCode) => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (category) p.set("category", category);
    if (status) p.set("status", status);
    if (code) p.set("step", code);
    const qs = p.toString();
    return qs ? `/?${qs}` : "/";
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">내 물건{demo ? " (데모)" : ""}</h1>
        <div className="flex items-center gap-3">
          <p className="text-sm text-stone-600">{rows.length}개</p>
          <Link href="/triage" className="btn">어디로 넘길까 (배분)</Link>
        </div>
      </div>

      <form method="get" className="card grid gap-3 sm:grid-cols-[1fr_auto_auto_auto]" role="search">
        {step ? <input type="hidden" name="step" value={step} /> : null}
        <div>
          <label htmlFor="q" className="sr-only">검색</label>
          <input id="q" name="q" defaultValue={q} className="input" placeholder="이름·ISBN·모델명·저자 검색" />
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
        <div className="flex gap-2">
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
            <p className="text-stone-700">조건에 맞는 물건이 없습니다.</p>
          ) : (
            <>
              <p className="font-medium">아직 등록한 물건이 없습니다.</p>
              <p className="mt-1 text-sm text-stone-600">팔고 싶은 책이나 기기를 등록하면 가격 자료를 모으고 실수령액을 비교할 수 있습니다.</p>
              <Link href="/items/new" className="btn-primary mt-4">첫 물건 등록하기</Link>
            </>
          )}
        </div>
      ) : (
        <ul className="space-y-2">
          {rows.map(({ item, priceCount, step }) => {
            return (
            <li key={item.id}>
              <Link href={`/items/${item.id}`} className="card block hover:border-teal-700">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{item.name}</p>
                    <p className="mt-0.5 text-sm text-stone-600">
                      {[item.identifier, item.edition, CONDITION_LABEL[item.condition]].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {item.isDemo ? <Badge tone="amber">가상 데이터</Badge> : null}
                    <Badge>{CATEGORY_LABEL[item.category]}</Badge>
                    <Badge tone={item.status === "SOLD" ? "teal" : item.status === "LISTED" ? "blue" : "neutral"}>
                      {ITEM_STATUS_LABEL[item.status]}
                    </Badge>
                  </div>
                </div>
                <p className="mt-2 text-sm text-stone-700">
                  {priceCount > 0 ? `가격 자료 ${priceCount}건` : "가격 자료 없음"}
                  {item.chosenMethod ? ` · 선택: ${SALE_METHOD_LABEL[item.chosenMethod]}` : ""}
                </p>
                <p className="mt-1 text-sm" data-testid={`next-step-${item.id}`}>
                  <span className="text-stone-600">{step === "DONE" ? "완료: " : "다음: "}</span>
                  <span className={step === "DONE" ? "text-stone-700" : "font-medium text-teal-900"}>{NEXT_STEP_LABEL[step]}</span>
                </p>
              </Link>
            </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
