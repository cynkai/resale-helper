import Link from "next/link";
import { deletePostedPriceAction, setItemStatusAction } from "@/app/actions";
import { ConfirmSubmit, CopyButton, PostedPriceForm } from "@/components/client-bits";
import { Section } from "@/components/ui";
import { renderTemplate } from "@/lib/domain/listing-template";
import { charCount } from "@/lib/domain/listing";
import { formatMoney } from "@/lib/domain/money";
import { signed } from "./shared";
import type { ItemView } from "../view";

export function ListingSection({ v }: { v: ItemView }) {
  const { item, today, channelNames, breakEven, templates, posted, postedSummary, postedDelta, direct, draft } = v;

  return (
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
          {posted.length > 0 && item.status === "OWNED" ? (
            <form action={setItemStatusAction} className="mt-2 flex flex-wrap items-center gap-2 text-sm" data-testid="posted-status-hint">
              <input type="hidden" name="itemId" value={item.id} />
              <input type="hidden" name="status" value="LISTED" />
              <span className="text-stone-700">올린 가격을 적어 두었는데 상태는 ‘보유 중’입니다.</span>
              <button type="submit" className="btn px-2 py-0.5 text-xs">
                판매 중으로 표시
              </button>
            </form>
          ) : null}
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
  );
}
