import { Section } from "@/components/ui";
import { formatMoney } from "@/lib/domain/money";
import { CONDITION_LABEL } from "@/lib/domain/types";
import { TRI_TEXT } from "./shared";
import type { ItemView } from "../view";

export function InfoSection({ v }: { v: ItemView }) {
  const { item } = v;

  return (
    <Section id="info" title="물건 정보">
      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        {(
          [
            [item.category === "BOOK" ? "ISBN" : "모델명", item.identifier],
            ["상태", CONDITION_LABEL[item.condition]],
            ...(item.category === "BOOK"
              ? ([
                  ["저자", item.author],
                  ["출판사", item.publisher],
                  ["판본", item.edition],
                  [
                    "필기·밑줄·파손·부록",
                    [item.hasWriting, item.hasUnderline, item.hasDamage, item.hasSupplement].map((t) => TRI_TEXT[t]).join(" · "),
                  ],
                ] as [string, string | null][])
              : []),
            ["하자", item.defects],
            ["구성품", item.components],
            [
              "산 가격",
              item.purchaseAmount !== null
                ? `${formatMoney(item.purchaseAmount)}${item.purchaseDate ? ` (${item.purchaseDate})` : ""}`
                : item.purchaseDate
                  ? `가격 모름 (${item.purchaseDate})`
                  : null,
            ],
            ["메모", item.memo],
          ] as [string, string | null][]
        ).map(([k, val]) => (
          <div key={k} className="flex gap-2">
            <dt className="w-28 shrink-0 text-stone-600">{k}</dt>
            <dd className={val ? "whitespace-pre-wrap" : "text-stone-500"}>{val ?? "입력 안 함"}</dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}
