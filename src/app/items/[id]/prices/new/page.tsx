import Link from "next/link";
import { notFound } from "next/navigation";
import { PriceForm } from "@/components/PriceForm";
import { getDb } from "@/lib/db/client";
import { getItem } from "@/lib/db/repo";
import { CURRENCIES } from "@/lib/domain/types";
import { isDemoMode } from "@/lib/mode";
import { todayYmd } from "@/lib/today";
import { itemTitle } from "../../meta";

const MANUAL_TYPES = ["ASKING", "SOLD_LISTING", "BUYBACK_QUOTE", "USER_REPORTED"];

export function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  return itemTitle(params, "가격 자료 추가");
}

export default async function NewPricePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  // "저장하고 하나 더"로 넘어온 경우: 방금 쓴 유형·출처·통화만 이어 준다. 허용된 값이 아니면 기본값을 쓴다.
  const carriedType = MANUAL_TYPES.includes(sp.type ?? "") ? sp.type! : "ASKING";
  const carriedCurrency = (CURRENCIES as readonly string[]).includes(sp.currency ?? "") ? sp.currency! : "KRW";
  const carriedSource = (sp.source ?? "").slice(0, 100);
  const item = /^\d+$/.test(id) ? getItem(getDb(), await isDemoMode(), Number(id)) : undefined;
  if (!item) notFound();
  return (
    <div className="space-y-4">
      <p className="text-sm">
        <Link href={`/items/${item.id}#prices`} className="underline">← {item.name}</Link>
      </p>
      <h1 className="text-xl font-bold">가격 자료 추가</h1>
      {sp.saved === "1" ? (
        <p className="notice" role="status" data-testid="saved-again">
          저장했습니다. 이어서 다음 자료를 넣어 주세요. 유형·출처·통화만 이어 두었고, 금액은 자료마다 직접 확인해 넣어야 합니다.
        </p>
      ) : null}
      <p className="notice">
        직접 확인한 가격을 기록합니다. 내 물건과 같은 상품·비슷한 상태의 자료일수록 비교에 도움이 됩니다.
      </p>
      <div className="card">
        <PriceForm
          itemId={item.id}
          initial={{
            priceType: carriedType,
            currency: carriedCurrency,
            sourceName: carriedSource,
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
