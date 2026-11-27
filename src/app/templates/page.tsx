import type { Metadata } from "next";
import { deleteTemplateAction } from "@/app/actions";
import { ConfirmSubmit, TemplateForm } from "@/components/client-bits";
import { Section } from "@/components/ui";
import { getDb } from "@/lib/db/client";
import { getItem, listItems, listScenarios, listTemplates } from "@/lib/db/repo";
import { charCount } from "@/lib/domain/listing";
import { renderTemplate, TEMPLATE_TOKENS } from "@/lib/domain/listing-template";
import { listingScenario } from "@/lib/domain/scenario";
import { isDemoMode } from "@/lib/mode";

export const metadata: Metadata = { title: "판매글 템플릿" };

export default async function TemplatesPage({ searchParams }: { searchParams: Promise<{ preview?: string | string[] }> }) {
  const demo = await isDemoMode();
  const db = getDb();
  const templates = listTemplates(db, demo);
  // 미리보기: 고른 물건(현재 모드, 휴지통 제외)의 정보와 판매글 금액으로 저장한 템플릿을 채워 본다.
  const { preview: previewParam } = await searchParams;
  const previewId = typeof previewParam === "string" && /^\d+$/.test(previewParam) ? Number(previewParam) : null;
  const previewItem = previewId !== null ? getItem(db, demo, previewId) : undefined;
  const preview = previewItem
    ? { item: previewItem, price: listingScenario(previewItem, listScenarios(db, previewItem.id))?.saleAmount ?? null }
    : null;
  const choices = templates.length > 0 ? listItems(db, demo, { sort: "name" }).map((r) => r.item) : [];
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">판매글 템플릿{demo ? " (데모)" : ""}</h1>
      <p className="notice">
        내가 자주 쓰는 판매글 틀을 직접 써 두면, 물건 화면의 ‘4. 판매글’에서 그 물건의 정보로 채워 보여 줍니다. 글은 모두 내가 쓴 것이고, 앱은
        판매처별 양식이나 글자 수 제한을 알지 못합니다. 판매처에 자동으로 등록되지 않습니다.
      </p>

      <Section id="tokens" title="쓸 수 있는 자리표시">
        <p className="text-sm text-stone-700">
          본문에 아래 이름을 중괄호로 넣으면 물건에 입력한 값으로 바뀝니다. <strong>값을 입력하지 않은 자리표시가 든 줄은 통째로 빠집니다</strong>
          (입력하지 않은 내용을 지어내지 않기 위해서입니다). 빠진 줄은 물건 화면에서 알려 드립니다.
        </p>
        <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2" data-testid="template-tokens">
          {TEMPLATE_TOKENS.map((t) => (
            <div key={t.name} className="flex gap-2">
              <dt>
                <code>{`{${t.name}}`}</code>
              </dt>
              <dd className="text-stone-600">{t.help}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section id="new" title="새 템플릿">
        <TemplateForm initial={{}} />
      </Section>

      <Section id="list" title={`내 템플릿 ${templates.length}개`}>
        {templates.length > 0 && choices.length > 0 ? (
          <form method="get" className="mb-2 flex flex-wrap items-end gap-2 text-sm" data-testid="preview-picker">
            <div>
              <label htmlFor="preview-item" className="block text-stone-700">
                미리보기할 물건
              </label>
              <select id="preview-item" name="preview" defaultValue={preview ? String(preview.item.id) : ""} className="input">
                <option value="">고르지 않음</option>
                {choices.map((it) => (
                  <option key={it.id} value={it.id}>
                    {it.name}
                  </option>
                ))}
              </select>
            </div>
            <button type="submit" className="btn">
              미리보기
            </button>
            <p className="w-full text-xs text-stone-600">
              저장한 템플릿을 그 물건의 정보와 판매글 금액(물건 화면의 ‘4. 판매글’과 같은 금액)으로 채워 보여 줍니다. 고치는 중인 내용은 저장한 뒤에 보입니다.
            </p>
          </form>
        ) : null}
        {templates.length === 0 ? (
          <p className="text-sm text-stone-600">아직 만든 템플릿이 없습니다.</p>
        ) : (
          <ul className="divide-y divide-stone-200">
            {templates.map((t) => (
              <li key={t.id} className="space-y-3 py-4" data-testid={`template-${t.id}`}>
                <TemplateForm templateId={t.id} initial={{ name: t.name, body: t.body }} />
                {preview
                  ? (() => {
                      const r = renderTemplate(t.body, preview.item, preview.price);
                      return (
                        <div className="rounded-md border border-dashed border-stone-300 p-3" data-testid={`template-preview-${t.id}`}>
                          <p className="mb-1 text-sm font-medium">
                            미리보기: {preview.item.name} <span className="font-normal text-stone-600">({charCount(r.text)}자)</span>
                          </p>
                          <pre className="whitespace-pre-wrap rounded-md border border-stone-300 bg-stone-50 px-3 py-2 font-sans text-sm">{r.text}</pre>
                          {r.dropped.length > 0 ? (
                            <p className="warn mt-1">
                              값을 입력하지 않아 뺀 줄 {r.dropped.length}개:{" "}
                              {[...new Set(r.dropped.flatMap((d) => d.missing))].map((n) => `{${n}}`).join(", ")}
                            </p>
                          ) : null}
                        </div>
                      );
                    })()
                  : null}
                <form action={deleteTemplateAction}>
                  <input type="hidden" name="templateId" value={t.id} />
                  <ConfirmSubmit message={`‘${t.name}’ 템플릿을 지울까요?`} className="btn-danger px-2 py-1 text-xs">
                    템플릿 지우기
                  </ConfirmSubmit>
                </form>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
