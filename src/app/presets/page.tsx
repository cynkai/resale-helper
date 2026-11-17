import type { Metadata } from "next";
import { deleteCostPresetAction } from "@/app/actions";
import { ConfirmSubmit, CostPresetForm } from "@/components/client-bits";
import { Section } from "@/components/ui";
import { getDb } from "@/lib/db/client";
import { listCostPresets } from "@/lib/db/repo";
import { presetFormValues } from "@/lib/domain/cost-preset";
import { isDemoMode } from "@/lib/mode";

export const metadata: Metadata = { title: "내 비용 묶음" };

export default async function PresetsPage() {
  const demo = await isDemoMode();
  const presets = listCostPresets(getDb(), demo);
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">내 비용 묶음{demo ? " (데모)" : ""}</h1>
      <p className="notice">
        자주 쓰는 수수료·배송비·포장비·교통비·소요시간 조합을 내가 직접 저장해 두는 곳입니다. 물건 화면에서 계산을 만들 때 ‘비용 베껴 오기’로 불러올 수
        있고, 불러온 뒤에도 물건마다 고칠 수 있습니다. 앱에 내장된 판매처 요율이나 기본 비용은 없으며, 여기 값은 모두 내가 적은 것입니다. 요율과
        배송비는 바뀔 수 있으니 가끔 다시 확인해 주세요.
      </p>

      <Section id="new" title="새 묶음">
        <CostPresetForm initial={{ feeMode: "AMOUNT" }} />
      </Section>

      <Section id="list" title={`내 묶음 ${presets.length}개`}>
        {presets.length === 0 ? (
          <p className="text-sm text-stone-600">아직 만든 묶음이 없습니다.</p>
        ) : (
          <ul className="divide-y divide-stone-200">
            {presets.map((p) => (
              <li key={p.id} className="space-y-3 py-4" data-testid={`preset-${p.id}`}>
                <CostPresetForm presetId={p.id} initial={{ name: p.name, ...presetFormValues(p) }} />
                <form action={deleteCostPresetAction}>
                  <input type="hidden" name="presetId" value={p.id} />
                  <ConfirmSubmit message={`‘${p.name}’ 묶음을 지울까요? 이미 만든 계산은 바뀌지 않습니다.`} className="btn-danger px-2 py-1 text-xs">
                    묶음 지우기
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
