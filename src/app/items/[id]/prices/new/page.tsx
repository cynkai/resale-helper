import Link from "next/link";
import { notFound } from "next/navigation";
import { PriceForm } from "@/components/PriceForm";
import { getDb } from "@/lib/db/client";
import { getItem } from "@/lib/db/repo";
import { isDemoMode } from "@/lib/mode";
import { todayYmd } from "@/lib/today";

export default async function NewPricePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const item = /^\d+$/.test(id) ? getItem(getDb(), await isDemoMode(), Number(id)) : undefined;
  if (!item) notFound();
  return (
    <div className="space-y-4">
      <p className="text-sm">
        <Link href={`/items/${item.id}#prices`} className="underline">← {item.name}</Link>
      </p>
      <h1 className="text-xl font-bold">가격 자료 추가</h1>
      <p className="notice">
        직접 확인한 가격을 기록합니다. 내 물건과 같은 상품·비슷한 상태의 자료일수록 비교에 도움이 됩니다.
      </p>
      <div className="card">
        <PriceForm
          itemId={item.id}
          initial={{
            priceType: "ASKING",
            currency: "KRW",
            checkedDate: todayYmd(),
            productIdentifier: item.identifier ?? "",
            condition: item.condition,
            bundleType: "SINGLE",
            shippingIncluded: "UNKNOWN",
          }}
        />
      </div>
    </div>
  );
}
