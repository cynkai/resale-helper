import { deleteTemplateAction } from "@/app/actions";
import { ConfirmSubmit, TemplateForm } from "@/components/client-bits";
import { Section } from "@/components/ui";
import { getDb } from "@/lib/db/client";
import { listTemplates } from "@/lib/db/repo";
import { TEMPLATE_TOKENS } from "@/lib/domain/listing-template";
import { isDemoMode } from "@/lib/mode";

export default async function TemplatesPage() {
  const demo = await isDemoMode();
  const templates = listTemplates(getDb(), demo);
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
        {templates.length === 0 ? (
          <p className="text-sm text-stone-600">아직 만든 템플릿이 없습니다.</p>
        ) : (
          <ul className="divide-y divide-stone-200">
            {templates.map((t) => (
              <li key={t.id} className="space-y-3 py-4" data-testid={`template-${t.id}`}>
                <TemplateForm templateId={t.id} initial={{ name: t.name, body: t.body }} />
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
