// 물건 화면. 조회·계산은 view.ts, 구역별 화면 조각은 _sections에 있다.

import Link from "next/link";
import { notFound } from "next/navigation";
import { deleteItemAction, duplicateItemAction } from "@/app/actions";
import { ConfirmSubmit } from "@/components/client-bits";
import { Badge } from "@/components/ui";
import { getDb } from "@/lib/db/client";
import { getItem } from "@/lib/db/repo";
import { CATEGORY_LABEL, ITEM_STATUS_LABEL } from "@/lib/domain/types";
import { isDemoMode } from "@/lib/mode";
import { todayYmd } from "@/lib/today";
import { InfoSection } from "./_sections/info";
import { PricesSection } from "./_sections/prices";
import { NetSection } from "./_sections/net";
import { ChooseSection } from "./_sections/choose";
import { ListingSection } from "./_sections/listing";
import { OffersSection } from "./_sections/offers";
import { ResultSection } from "./_sections/result";
import { TimelineSection } from "./_sections/timeline";
import { loadItemView } from "./view";

export default async function ItemPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const db = getDb();
  const demo = await isDemoMode();
  const item = /^\d+$/.test(id) ? getItem(db, demo, Number(id)) : undefined;
  if (!item) notFound();
  const v = loadItemView(db, demo, item, sp, todayYmd());

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">{item.name}</h1>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {item.isDemo ? <Badge tone="amber">가상 데이터</Badge> : null}
            <Badge>{CATEGORY_LABEL[item.category]}</Badge>
            <Badge tone={item.status === "SOLD" ? "teal" : "neutral"}>{ITEM_STATUS_LABEL[item.status]}</Badge>
          </div>
        </div>
        <div className="flex gap-2">
          <Link href={`/items/${item.id}/edit`} className="btn">
            물건 수정
          </Link>
          <form action={duplicateItemAction}>
            <input type="hidden" name="itemId" value={item.id} />
            <button type="submit" className="btn" title="물건 정보만 베껴 새 물건으로 등록합니다. 가격 자료와 계산은 베끼지 않습니다.">
              같은 물건 하나 더 등록
            </button>
          </form>
          <form action={deleteItemAction}>
            <input type="hidden" name="itemId" value={item.id} />
            <ConfirmSubmit message="이 물건을 휴지통으로 옮깁니다. 휴지통에서 되살리거나 완전히 지울 수 있습니다. 옮길까요?">물건 삭제</ConfirmSubmit>
          </form>
        </div>
      </div>

      <nav aria-label="진행 단계" className="flex flex-wrap gap-2 text-sm">
        {[
          ["#info", "물건 정보"],
          ["#prices", "1. 가격 자료·비교"],
          ["#net", "2. 실수령액"],
          ["#choose", "3. 판매 방법"],
          ["#listing", "4. 판매글"],
          ["#offers", "받은 제안"],
          ["#result", "5. 판매 결과"],
          ["#timeline", "기록"],
        ].map(([href, label]) => (
          <a key={href} href={href} className="rounded-full border border-stone-300 bg-white px-3 py-1 hover:bg-stone-100">
            {label}
          </a>
        ))}
      </nav>

      <InfoSection v={v} />
      <PricesSection v={v} />
      <NetSection v={v} />
      <ChooseSection v={v} />
      <ListingSection v={v} />
      <OffersSection v={v} />
      <ResultSection v={v} />
      <TimelineSection v={v} />
    </div>
  );
}
