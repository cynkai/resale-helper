import Link from "next/link";
import { notFound } from "next/navigation";
import { PriceForm } from "@/components/PriceForm";
import { getDb } from "@/lib/db/client";
import { getItem, getPrice, listSourceNames } from "@/lib/db/repo";
import { fxRateToPlain } from "@/lib/domain/fx";
import { minorToPlain } from "@/lib/domain/money";
import { isDemoMode } from "@/lib/mode";
import { itemTitle } from "../../../meta";

export function generateMetadata({ params }: { params: Promise<{ id: string; priceId: string }> }) {
  return itemTitle(params, "가격 자료 수정");
}

export default async function EditPricePage({ params }: { params: Promise<{ id: string; priceId: string }> }) {
  const { id, priceId } = await params;
  const db = getDb();
  const demo = await isDemoMode();
  const item = /^\d+$/.test(id) ? getItem(db, demo, Number(id)) : undefined;
  const price = item && /^\d+$/.test(priceId) ? getPrice(db, item.id, Number(priceId)) : undefined;
  if (!item || !price) notFound();
  const initial: Record<string, string> = { amount: minorToPlain(price.amountMinor, price.currency) };
  for (const [k, v] of Object.entries(price)) if (typeof v === "string") initial[k] = v;
  if (price.fxRateE4 !== null) initial.fxRate = fxRateToPlain(price.fxRateE4);
  return (
    <div className="space-y-4">
      <p className="text-sm">
        <Link href={`/items/${item.id}#prices`} className="underline">← {item.name}</Link>
      </p>
      <h1 className="text-xl font-bold">가격 자료 수정</h1>
      {price.priceType === "VERIFIED_SALE" ? (
        <p className="warn">검증된 체결가는 직접 수정할 수 없습니다. 저장하려면 다른 유형을 골라야 합니다.</p>
      ) : null}
      <div className="card">
        <PriceForm itemId={item.id} priceId={price.id} initial={initial} sourceNames={listSourceNames(db, demo)} />
      </div>
    </div>
  );
}
