"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { saveItemAction, type FormState } from "@/app/actions";
import { Field } from "./ui";
import {
  CATEGORIES,
  CATEGORY_LABEL,
  CONDITIONS,
  CONDITION_LABEL,
  ITEM_STATUSES,
  ITEM_STATUS_LABEL,
} from "@/lib/domain/types";

type LookupState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "info"; text: string }
  | { kind: "error"; text: string };

const TRI_OPTIONS = [
  { value: "UNKNOWN", label: "모름" },
  { value: "YES", label: "있음" },
  { value: "NO", label: "없음" },
];

export function ItemForm({ initial, itemId }: { initial: Record<string, string>; itemId?: number }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveItemAction, {});
  const base = state.values ?? initial;
  // 제어 입력: 카테고리에 따라 보이는 항목이 달라지고, 서지정보 조회 결과로 값을 채워야 한다.
  const [v, setV] = useState<Record<string, string>>(base);
  const [seen, setSeen] = useState(state);
  if (seen !== state) {
    setSeen(state);
    if (state.values) setV(state.values);
  }
  const [lookup, setLookup] = useState<LookupState>({ kind: "idle" });
  const e = state.errors ?? {};
  const isBook = v.category === "BOOK";
  const set = (k: string) => (ev: { target: { value: string } }) => setV((p) => ({ ...p, [k]: ev.target.value }));

  async function runLookup() {
    setLookup({ kind: "loading" });
    try {
      const res = await fetch(`/api/books/lookup?isbn=${encodeURIComponent(v.identifier ?? "")}`);
      const json = (await res.json()) as {
        status: string;
        message?: string;
        isbn13?: string;
        providerLabel?: string;
        data?: { title: string; author: string | null; publisher: string | null; edition: string | null };
      };
      if (json.status === "invalid") return setLookup({ kind: "error", text: json.message ?? "ISBN을 확인해 주세요." });
      if (json.isbn13) setV((p) => ({ ...p, identifier: json.isbn13! }));
      if (json.status === "found" && json.data) {
        const d = json.data;
        setV((p) => ({
          ...p,
          name: d.title,
          author: d.author ?? p.author ?? "",
          publisher: d.publisher ?? p.publisher ?? "",
          edition: d.edition ?? p.edition ?? "",
        }));
        return setLookup({
          kind: "info",
          text: `${json.providerLabel}에서 서지정보를 가져왔습니다. 내 책의 제목·판본과 같은지 꼭 확인해 주세요. (가격 정보는 조회하지 않습니다)`,
        });
      }
      if (json.status === "not_found")
        return setLookup({ kind: "info", text: "서지정보를 찾지 못했습니다. 제목·저자·판본을 직접 입력해 주세요." });
      if (json.status === "disabled")
        return setLookup({ kind: "info", text: "외부 조회가 꺼져 있습니다. 직접 입력해 주세요." });
      setLookup({
        kind: "error",
        text: `서지정보 조회에 실패했습니다(${json.message ?? "알 수 없는 오류"}). 직접 입력으로 계속할 수 있습니다.`,
      });
    } catch {
      setLookup({ kind: "error", text: "서지정보 조회에 실패했습니다. 직접 입력으로 계속할 수 있습니다." });
    }
  }

  const input = (name: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <input
      id={name}
      name={name}
      className="input"
      value={v[name] ?? ""}
      onChange={set(name)}
      aria-invalid={e[name] ? true : undefined}
      aria-describedby={e[name] ? `${name}-error` : undefined}
      {...props}
    />
  );

  return (
    <form action={action} className="space-y-4" noValidate>
      {itemId !== undefined ? <input type="hidden" name="id" value={itemId} /> : null}
      {state.message ? (
        <p role="alert" className="warn">
          {state.message}
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="카테고리" name="category" error={e.category} required>
          <select id="category" name="category" className="input" value={v.category ?? ""} onChange={set("category")}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="판매 진행 상태" name="status" error={e.status}>
          <select id="status" name="status" className="input" value={v.status ?? "OWNED"} onChange={set("status")}>
            {ITEM_STATUSES.map((c) => (
              <option key={c} value={c}>
                {ITEM_STATUS_LABEL[c]}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {isBook ? (
        <div>
          <Field
            label="ISBN"
            name="identifier"
            error={e.identifier}
            hint="책 뒤표지 바코드 아래 10자리 또는 13자리 숫자. 없으면 비워 두세요."
          >
            <div className="flex gap-2">
              {input("identifier", { inputMode: "numeric", placeholder: "예: 9780306406157" })}
              <button
                type="button"
                className="btn shrink-0"
                onClick={runLookup}
                disabled={lookup.kind === "loading" || !(v.identifier ?? "").trim()}
              >
                {lookup.kind === "loading" ? "조회 중…" : "서지정보 조회"}
              </button>
            </div>
          </Field>
          <div aria-live="polite">
            {lookup.kind === "info" ? <p className="notice mt-2">{lookup.text}</p> : null}
            {lookup.kind === "error" ? <p className="warn mt-2">{lookup.text}</p> : null}
          </div>
        </div>
      ) : (
        <Field label="모델명" name="identifier" error={e.identifier} hint="기기 뒷면이나 설정 화면에 적힌 모델명">
          {input("identifier", { placeholder: "예: HAC-001" })}
        </Field>
      )}

      <Field label={isBook ? "제목" : "이름"} name="name" error={e.name} required>
        {input("name")}
      </Field>

      {isBook ? (
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="저자" name="author" error={e.author}>
            {input("author")}
          </Field>
          <Field label="출판사" name="publisher" error={e.publisher}>
            {input("publisher")}
          </Field>
          <Field label="판본" name="edition" error={e.edition} hint="예: 3판, 개정 2판">
            {input("edition")}
          </Field>
        </div>
      ) : null}

      <Field label="상태" name="condition" error={e.condition} required>
        <select
          id="condition"
          name="condition"
          className="input"
          value={v.condition ?? ""}
          onChange={set("condition")}
        >
          <option value="">선택</option>
          {CONDITIONS.map((c) => (
            <option key={c} value={c}>
              {CONDITION_LABEL[c]}
            </option>
          ))}
        </select>
      </Field>

      {isBook ? (
        <fieldset className="rounded-md border border-stone-200 p-3">
          <legend className="px-1 text-sm font-medium">책 상태 세부</legend>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["hasWriting", "필기"],
              ["hasUnderline", "밑줄"],
              ["hasDamage", "파손"],
              ["hasSupplement", "부록"],
            ].map(([name, label]) => (
              <Field key={name} label={label!} name={name!} error={e[name!]}>
                <select
                  id={name}
                  name={name}
                  className="input"
                  value={v[name!] ?? "UNKNOWN"}
                  onChange={set(name!)}
                >
                  {TRI_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </Field>
            ))}
          </div>
          <p className="mt-2 text-xs text-stone-600">‘모름’으로 두면 판매글 초안에 해당 내용을 쓰지 않습니다.</p>
        </fieldset>
      ) : null}

      <Field label="하자" name="defects" error={e.defects} hint="없으면 ‘없음’이라고 적어 주세요. 비워 두면 판매글에 쓰지 않습니다.">
        <textarea id="defects" name="defects" rows={2} className="input" value={v.defects ?? ""} onChange={set("defects")} />
      </Field>
      <Field label="구성품" name="components" error={e.components} hint={isBook ? "예: CD, 해설집" : "예: 본체, 충전기, 박스"}>
        <textarea
          id="components"
          name="components"
          rows={2}
          className="input"
          value={v.components ?? ""}
          onChange={set("components")}
        />
      </Field>
      <Field label="메모" name="memo" error={e.memo} hint="나만 보는 메모. 판매글에는 들어가지 않습니다.">
        <textarea id="memo" name="memo" rows={2} className="input" value={v.memo ?? ""} onChange={set("memo")} />
      </Field>

      <div className="flex gap-2">
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? "저장 중…" : "저장"}
        </button>
        <Link href={itemId !== undefined ? `/items/${itemId}` : "/"} className="btn">
          취소
        </Link>
      </div>
    </form>
  );
}
