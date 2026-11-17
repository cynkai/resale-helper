import type { Metadata } from "next";
import Link from "next/link";
import { emptyTrashAction, purgeItemAction, restoreItemAction } from "@/app/actions";
import { ConfirmSubmit } from "@/components/client-bits";
import { Badge } from "@/components/ui";
import { getDb } from "@/lib/db/client";
import { listTrashedItems } from "@/lib/db/repo";
import { utcToSeoulYmd } from "@/lib/domain/timeline";
import { CATEGORY_LABEL } from "@/lib/domain/types";
import { isDemoMode } from "@/lib/mode";

export const metadata: Metadata = { title: "휴지통" };

export default async function TrashPage() {
  const demo = await isDemoMode();
  const rows = listTrashedItems(getDb(), demo);
  return (
    <div className="space-y-4">
      <p className="text-sm">
        <Link href="/" className="underline">← 내 물건</Link>
      </p>
      <h1 className="text-xl font-bold">휴지통{demo ? " (데모)" : ""}</h1>
      <p className="notice">
        삭제한 물건은 여기로 옵니다. 휴지통의 물건은 목록·배분·점검·판매 결과·내보내기 어디에도 나오지 않습니다. 되살리면 가격 자료와 계산, 기록이 모두
        그대로 돌아옵니다. 자동으로 비워지지 않으며, 완전히 지운 것은 되돌릴 수 없습니다.
      </p>
      {rows.length === 0 ? (
        <div className="card py-10 text-center" data-testid="trash-empty">
          <p className="font-medium">휴지통이 비어 있습니다.</p>
        </div>
      ) : (
        <>
          <form action={emptyTrashAction}>
            <ConfirmSubmit message={`휴지통의 물건 ${rows.length}개와 딸린 자료를 모두 완전히 지웁니다. 되돌릴 수 없습니다. 계속할까요?`}>
              휴지통 비우기 ({rows.length}개)
            </ConfirmSubmit>
          </form>
          <ul className="space-y-2">
            {rows.map(({ item, priceCount, scenarioCount, resultCount }) => (
              <li key={item.id} className="card" data-testid={`trashed-${item.id}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold">{item.name}</p>
                    <p className="mt-0.5 text-sm text-stone-600">
                      {[item.identifier, `삭제한 날 ${utcToSeoulYmd(item.deletedAt) ?? "기록 없음"}`].filter(Boolean).join(" · ")}
                    </p>
                    <p className="mt-1 text-sm text-stone-700">
                      딸린 자료: 가격 자료 {priceCount}건, 계산 {scenarioCount}개, 판매 결과 {resultCount}건
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {item.isDemo ? <Badge tone="amber">가상 데이터</Badge> : null}
                    <Badge>{CATEGORY_LABEL[item.category]}</Badge>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <form action={restoreItemAction}>
                    <input type="hidden" name="itemId" value={item.id} />
                    <button type="submit" className="btn">되살리기</button>
                  </form>
                  <form action={purgeItemAction}>
                    <input type="hidden" name="itemId" value={item.id} />
                    <ConfirmSubmit message="이 물건과 딸린 자료를 완전히 지웁니다. 되돌릴 수 없습니다. 계속할까요?">완전히 지우기</ConfirmSubmit>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
