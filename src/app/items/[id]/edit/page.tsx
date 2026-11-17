import { notFound } from "next/navigation";
import { ItemForm } from "@/components/ItemForm";
import { getDb } from "@/lib/db/client";
import { getItem } from "@/lib/db/repo";
import { isDemoMode } from "@/lib/mode";

export default async function EditItemPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const copied = (await searchParams).copied === "1";
  const item = /^\d+$/.test(id) ? getItem(getDb(), await isDemoMode(), Number(id)) : undefined;
  if (!item) notFound();
  const initial: Record<string, string> = {};
  for (const [k, v] of Object.entries(item)) if (typeof v === "string") initial[k] = v;
  if (item.purchaseAmount !== null) initial.purchaseAmount = String(item.purchaseAmount);
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">물건 수정</h1>
      {copied ? (
        <p className="notice" data-testid="copied-notice">
          물건 정보만 베껴 새 물건으로 등록했습니다. 상태·하자·구성품이 이 물건과 다르면 고쳐 주세요. 가격 자료와 계산은 베끼지 않았으니 이 물건에
          맞게 따로 넣어 주세요.
        </p>
      ) : null}
      <div className="card">
        <ItemForm initial={initial} itemId={item.id} />
      </div>
    </div>
  );
}
