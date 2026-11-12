// 물건 등록·수정 입력 검증.

import { z } from "zod";
import { normalizeIsbn } from "./isbn";
import {
  CATEGORIES,
  CONDITIONS,
  ITEM_STATUSES,
  TRI_STATES,
  type Category,
  type Condition,
  type ItemStatus,
  type TriState,
} from "./types";

export const ITEM_FIELDS = [
  "category",
  "status",
  "name",
  "identifier",
  "condition",
  "defects",
  "components",
  "memo",
  "author",
  "publisher",
  "edition",
  "hasWriting",
  "hasUnderline",
  "hasDamage",
  "hasSupplement",
] as const;
export type ItemField = (typeof ITEM_FIELDS)[number];
export type ItemInputRaw = Partial<Record<ItemField, string>>;

export type ValidItemInput = {
  category: Category;
  status: ItemStatus;
  name: string;
  identifier: string | null;
  condition: Condition;
  defects: string | null;
  components: string | null;
  memo: string | null;
  author: string | null;
  publisher: string | null;
  edition: string | null;
  hasWriting: TriState;
  hasUnderline: TriState;
  hasDamage: TriState;
  hasSupplement: TriState;
};

const opt = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `${max}자 이내로 입력해 주세요.`)
    .transform((v) => (v === "" ? null : v));
const tri = z.enum(TRI_STATES, "값이 올바르지 않습니다.");

const schema = z.object({
  category: z.enum(CATEGORIES, "카테고리를 선택해 주세요."),
  status: z.enum(ITEM_STATUSES, "상태 값이 올바르지 않습니다."),
  name: z.string().trim().min(1, "이름(도서는 제목)을 입력해 주세요.").max(200, "200자 이내로 입력해 주세요."),
  identifier: opt(100),
  condition: z.enum(CONDITIONS, "물건 상태를 선택해 주세요."),
  defects: opt(1000),
  components: opt(1000),
  memo: opt(2000),
  author: opt(200),
  publisher: opt(200),
  edition: opt(100),
  hasWriting: tri,
  hasUnderline: tri,
  hasDamage: tri,
  hasSupplement: tri,
});

export type ItemValidation =
  | { ok: true; value: ValidItemInput }
  | { ok: false; errors: Partial<Record<ItemField, string>> };

export function validateItemInput(raw: ItemInputRaw): ItemValidation {
  const input = {
    category: raw.category ?? "",
    status: raw.status || "OWNED",
    name: raw.name ?? "",
    identifier: raw.identifier ?? "",
    condition: raw.condition ?? "",
    defects: raw.defects ?? "",
    components: raw.components ?? "",
    memo: raw.memo ?? "",
    author: raw.author ?? "",
    publisher: raw.publisher ?? "",
    edition: raw.edition ?? "",
    hasWriting: raw.hasWriting || "UNKNOWN",
    hasUnderline: raw.hasUnderline || "UNKNOWN",
    hasDamage: raw.hasDamage || "UNKNOWN",
    hasSupplement: raw.hasSupplement || "UNKNOWN",
  };
  const errors: Partial<Record<ItemField, string>> = {};
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const f = issue.path[0] as ItemField | undefined;
      if (f && !errors[f]) errors[f] = issue.message;
    }
    return { ok: false, errors };
  }
  const v = { ...parsed.data };
  if (v.category === "BOOK") {
    // ISBN은 있으면 반드시 검증하고 ISBN-13으로 정규화해 저장한다.
    if (v.identifier) {
      const isbn = normalizeIsbn(v.identifier);
      if (!isbn.ok) return { ok: false, errors: { identifier: isbn.error } };
      v.identifier = isbn.isbn13;
    }
  } else {
    // 도서 전용 항목은 다른 카테고리에 저장하지 않는다.
    v.author = v.publisher = v.edition = null;
    v.hasWriting = v.hasUnderline = v.hasDamage = v.hasSupplement = "UNKNOWN";
  }
  return { ok: true, value: v };
}
