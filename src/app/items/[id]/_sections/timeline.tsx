import { Section } from "@/components/ui";
import { TIMELINE_KIND_LABEL } from "@/lib/domain/timeline";
import type { ItemView } from "../view";

export function TimelineSection({ v }: { v: ItemView }) {
  const { timeline } = v;

  return (
    <Section id="timeline" title="기록 한눈에 보기">
      <p className="text-sm text-stone-700">
        이 물건에 적어 둔 기록을 날짜순(최신이 위)으로 늘어놓은 것입니다. 줄마다 무엇의 금액인지 적었고, 서로 다른 종류의 금액을 비교하거나 합치지
        않습니다.
      </p>
      <ol className="mt-3 space-y-1 text-sm" data-testid="timeline">
        {timeline.map((e) => (
          <li key={e.key} className="flex flex-wrap gap-x-3">
            <span className="w-24 shrink-0 text-stone-600">{e.date}</span>
            <span className="w-32 shrink-0 text-stone-600">{TIMELINE_KIND_LABEL[e.kind]}</span>
            <span>{e.text}</span>
          </li>
        ))}
      </ol>
    </Section>
  );
}
