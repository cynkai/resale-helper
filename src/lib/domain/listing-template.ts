// 내가 만드는 판매글 템플릿. 사용자가 쓴 글에 {자리표시}를 넣어 두면 물건에 입력한 사실로 바꿔 준다.
// 원칙: 입력하지 않은 내용은 만들어내지 않는다. 값이 없는 자리표시가 들어 있는 줄은 통째로 빼고, 무엇이 빠졌는지 알려 준다.
// 판매처별 양식이나 글자 수 제한은 앱이 알지 못한다. 템플릿의 글은 모두 사용자가 직접 쓴 것이다.

import { formatMoney } from "./money";
import type { ListingItem } from "./listing";
import { CATEGORY_LABEL, CONDITION_LABEL, type TriState } from "./types";

export const TEMPLATE_NAME_MAX = 50;
export const TEMPLATE_BODY_MAX = 2000;

const tri = (v: TriState): string | null => (v === "YES" ? "있음" : v === "NO" ? "없음" : null);

/** 자리표시 이름 → 값(없으면 null). 설명은 템플릿 화면에 보여 준다. */
export const TEMPLATE_TOKENS: { name: string; help: string; value: (item: ListingItem, price: number | null) => string | null }[] = [
  { name: "이름", help: "물건 이름(도서는 제목)", value: (i) => i.name },
  { name: "품목", help: "도서·게임기·전자기기", value: (i) => CATEGORY_LABEL[i.category] },
  { name: "식별", help: "도서는 ISBN, 그 외는 모델명", value: (i) => i.identifier },
  { name: "상태", help: "상태 등급", value: (i) => CONDITION_LABEL[i.condition] },
  { name: "하자", help: "물건 정보에 적은 하자", value: (i) => i.defects },
  { name: "구성품", help: "물건 정보에 적은 구성품", value: (i) => i.components },
  { name: "저자", help: "도서 저자", value: (i) => i.author },
  { name: "출판사", help: "도서 출판사", value: (i) => i.publisher },
  { name: "판본", help: "도서 판본", value: (i) => i.edition },
  { name: "필기", help: "필기 있음/없음(모름이면 값 없음)", value: (i) => tri(i.hasWriting) },
  { name: "밑줄", help: "밑줄 있음/없음", value: (i) => tri(i.hasUnderline) },
  { name: "파손", help: "파손 있음/없음", value: (i) => tri(i.hasDamage) },
  { name: "부록", help: "부록 있음/없음", value: (i) => tri(i.hasSupplement) },
  { name: "가격", help: "개인 판매 계산의 예상 판매금액", value: (_i, price) => (price === null ? null : formatMoney(price)) },
];

const TOKEN_BY_NAME = new Map(TEMPLATE_TOKENS.map((t) => [t.name, t]));
const TOKEN_RE = /\{([^{}\n]*)\}/g;

export type TemplateValidation = { ok: true; value: { name: string; body: string } } | { ok: false; errors: Record<string, string> };

export function validateTemplateInput(raw: { name?: string; body?: string }): TemplateValidation {
  const errors: Record<string, string> = {};
  const name = (raw.name ?? "").trim();
  if (name === "") errors.name = "템플릿 이름을 입력해 주세요.";
  else if (name.length > TEMPLATE_NAME_MAX) errors.name = `${TEMPLATE_NAME_MAX}자 이내로 입력해 주세요.`;
  const body = (raw.body ?? "").replace(/\r\n?/g, "\n").trim();
  if (body === "") errors.body = "본문을 입력해 주세요.";
  else if (body.length > TEMPLATE_BODY_MAX) errors.body = `${TEMPLATE_BODY_MAX}자 이내로 입력해 주세요.`;
  else {
    const unknown = [...new Set([...body.matchAll(TOKEN_RE)].map((m) => m[1]!.trim()).filter((n) => !TOKEN_BY_NAME.has(n)))];
    if (unknown.length > 0) {
      errors.body = `알 수 없는 자리표시: ${unknown.map((n) => `{${n}}`).join(", ")}. 쓸 수 있는 것: ${TEMPLATE_TOKENS.map((t) => `{${t.name}}`).join(" ")}`;
    }
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { name, body } };
}

export type RenderedTemplate = {
  text: string;
  /** 값이 없어 통째로 뺀 줄과 그 줄에서 값이 없던 자리표시. */
  dropped: { line: string; missing: string[] }[];
};

export function renderTemplate(body: string, item: ListingItem, price: number | null): RenderedTemplate {
  const out: string[] = [];
  const dropped: RenderedTemplate["dropped"] = [];
  for (const line of body.split("\n")) {
    const missing: string[] = [];
    const rendered = line.replace(TOKEN_RE, (whole, raw: string) => {
      const token = TOKEN_BY_NAME.get(raw.trim());
      if (!token) return whole; // 저장할 때 걸러지지만, 남아 있으면 그대로 둔다
      const v = token.value(item, price);
      if (v === null || v.trim() === "") {
        missing.push(token.name);
        return "";
      }
      return v;
    });
    if (missing.length > 0) dropped.push({ line, missing: [...new Set(missing)] });
    else out.push(rendered);
  }
  // 줄을 빼서 생긴 연속 빈 줄과 앞뒤 빈 줄을 정리한다.
  const text = out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text, dropped };
}
