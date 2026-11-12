// 판매글 초안(템플릿 방식). 사용자가 입력한 사실만 문장으로 옮기고, 입력하지 않은 내용은 만들어내지 않는다.

import { formatMoney } from "./money";
import { CATEGORY_LABEL, CONDITION_LABEL, type Category, type Condition, type TriState } from "./types";

export type ListingItem = {
  category: Category;
  name: string;
  identifier: string | null;
  condition: Condition;
  defects: string | null;
  components: string | null;
  author: string | null;
  publisher: string | null;
  edition: string | null;
  hasWriting: TriState;
  hasUnderline: TriState;
  hasDamage: TriState;
  hasSupplement: TriState;
};

export type ListingDraft = { title: string; body: string; missing: string[] };

function tri(label: string, v: TriState): string | null {
  if (v === "YES") return `${label}: 있음`;
  if (v === "NO") return `${label}: 없음`;
  return null; // 모름 → 쓰지 않는다
}

export function buildListingDraft(item: ListingItem, askingPrice: number | null): ListingDraft {
  const missing: string[] = [];
  const lines: string[] = [];
  let title: string;

  if (item.category === "BOOK") {
    title = [item.name, item.edition, item.author ? `(${item.author})` : null].filter(Boolean).join(" ");
    lines.push(`제목: ${item.name}`);
    if (item.author) lines.push(`저자: ${item.author}`);
    if (item.publisher) lines.push(`출판사: ${item.publisher}`);
    if (item.edition) lines.push(`판본: ${item.edition}`);
    else missing.push("판본(몇 판·몇 쇄인지)");
    if (item.identifier) lines.push(`ISBN: ${item.identifier}`);
    lines.push(`상태: ${CONDITION_LABEL[item.condition]}`);
    const facts: [string, TriState, string][] = [
      ["필기", item.hasWriting, "필기 유무"],
      ["밑줄", item.hasUnderline, "밑줄 유무"],
      ["파손", item.hasDamage, "파손 유무"],
      ["부록", item.hasSupplement, "부록 유무"],
    ];
    for (const [label, v, missLabel] of facts) {
      const t = tri(label, v);
      if (t) lines.push(t);
      else missing.push(missLabel);
    }
  } else {
    title = [item.name, item.identifier].filter(Boolean).join(" ");
    lines.push(`품목: ${CATEGORY_LABEL[item.category]}`);
    lines.push(`제품명: ${item.name}`);
    if (item.identifier) lines.push(`모델명: ${item.identifier}`);
    else missing.push("모델명");
    lines.push(`상태: ${CONDITION_LABEL[item.condition]}`);
    if (item.components) lines.push(`구성품: ${item.components}`);
    else missing.push("구성품");
  }

  if (item.defects) lines.push(`하자: ${item.defects}`);
  else missing.push("하자 유무(없다면 '없음'이라고 직접 입력)");
  if (item.category === "BOOK" && item.components) lines.push(`구성품: ${item.components}`);

  if (askingPrice !== null) lines.push(`희망 가격: ${formatMoney(askingPrice)}`);
  else missing.push("희망 가격(개인 판매 예상 금액을 저장하면 들어갑니다)");

  return { title: title.trim(), body: lines.join("\n"), missing };
}
