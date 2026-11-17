"use client";

import { useActionState, useState } from "react";
import {
  generateImportTokenAction,
  importCsvAction,
  importItemsCsvAction,
  saveExtensionIdAction,
  createSnapshotAction,
  checkDbHealthAction,
  type DbHealthState,
  saveCostPresetAction,
  saveOfferAction,
  savePostedPriceAction,
  saveTemplateAction,
  saveSaleResultAction,
  saveTimeValueAction,
  type CsvImportState,
  type FormState,
  type ImportTokenState,
} from "@/app/actions";
import { Field } from "./ui";

/** 텍스트를 클립보드에 복사한다. 실패하면 직접 선택해 복사하라고 안내한다. */
export function CopyButton({ text, label }: { text: string; label: string }) {
  const [status, setStatus] = useState<"idle" | "done" | "fail">("idle");
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        className="btn"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setStatus("done");
          } catch {
            setStatus("fail");
          }
        }}
      >
        {label}
      </button>
      <span role="status" className="text-sm text-teal-900">
        {status === "done" ? "복사했습니다" : status === "fail" ? "복사하지 못했습니다. 글을 직접 선택해 복사해 주세요." : ""}
      </span>
    </span>
  );
}

/** 브라우저 인쇄 창을 연다(저장은 PDF로 인쇄를 고르면 된다). */
export function PrintButton() {
  return (
    <button type="button" className="btn-primary no-print" onClick={() => window.print()}>
      인쇄하기
    </button>
  );
}

/** 삭제처럼 되돌릴 수 없는 동작 전에 한 번 확인한다. */
export function ConfirmSubmit({
  message,
  className,
  children,
  name,
  value,
}: {
  message: string;
  className?: string;
  children: React.ReactNode;
  /** 한 폼에 제출 버튼이 여러 개일 때 어느 버튼인지 서버에 알린다. */
  name?: string;
  value?: string;
}) {
  return (
    <button
      type="submit"
      name={name}
      value={value}
      className={className ?? "btn-danger"}
      onClick={(ev) => {
        if (!window.confirm(message)) ev.preventDefault();
      }}
    >
      {children}
    </button>
  );
}

/** itemId가 있으면 그 물건의 가격 자료 CSV, 없으면 물건 목록 CSV를 가져온다. */
export function CsvImportForm({ itemId }: { itemId?: number }) {
  const [state, action, pending] = useActionState<CsvImportState, FormData>(itemId === undefined ? importItemsCsvAction : importCsvAction, {});
  return (
    <form action={action} className="space-y-2">
      {itemId !== undefined ? <input type="hidden" name="itemId" value={itemId} /> : null}
      <label htmlFor="csv-file" className="block text-sm font-medium">
        CSV 파일
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <input id="csv-file" type="file" name="file" accept=".csv,text/csv" className="text-sm" required />
        <button type="submit" className="btn" disabled={pending}>
          {pending ? "가져오는 중…" : "가져오기"}
        </button>
      </div>
      <div aria-live="polite" className="space-y-2">
        {state.headerError ? (
          <p role="alert" className="warn">
            {state.headerError}
          </p>
        ) : null}
        {state.message ? <p className="notice">{state.message}</p> : null}
        {state.rowErrors && state.rowErrors.length > 0 ? (
          <ul className="warn list-disc space-y-1 pl-6">
            {state.rowErrors.map((r) => (
              <li key={r.line}>
                <strong>{r.line}행</strong>: {r.messages.join(" / ")}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </form>
  );
}

export function SaleResultForm({ itemId, initial }: { itemId: number; initial: Record<string, string> }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveSaleResultAction, {});
  const v = state.values ?? initial;
  const e = state.errors ?? {};
  const key = JSON.stringify(state.values ?? {});
  const input = (name: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <input
      id={`result-${name}`}
      name={name}
      className="input"
      defaultValue={v[name] ?? ""}
      aria-invalid={e[name] ? true : undefined}
      aria-describedby={e[name] ? `result-${name}-error` : undefined}
      {...props}
    />
  );
  return (
    <form action={action} className="space-y-3" noValidate key={key}>
      <input type="hidden" name="itemId" value={itemId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="판매처" name="result-channel" error={e.channel} required>
          {input("channel", { placeholder: "예: 직거래, ○○마켓, ○○서점 매입" })}
        </Field>
        <Field label="판매일" name="result-soldDate" error={e.soldDate} required>
          {input("soldDate", { type: "date" })}
        </Field>
        <Field label="실제 판매금액 (원)" name="result-amount" error={e.amount} required>
          {input("amount", { inputMode: "numeric" })}
        </Field>
        <Field label="실제 든 비용 합계 (원)" name="result-costTotal" error={e.costTotal} hint="없으면 0, 모르면 비워 두세요.">
          {input("costTotal", { inputMode: "numeric", placeholder: "모르면 비워 두기" })}
        </Field>
        <Field label="실제로 들인 시간 (분)" name="result-minutesSpent" error={e.minutesSpent}>
          {input("minutesSpent", { inputMode: "numeric" })}
        </Field>
        <Field label="메모" name="result-memo" error={e.memo}>
          {input("memo")}
        </Field>
      </div>
      <details
        className="rounded-md border border-stone-200 p-3 text-sm"
        open={["feeActual", "shippingActual", "packingActual", "transportActual"].some((k) => v[k] || e[k])}
      >
        <summary className="cursor-pointer text-stone-700">실제 비용을 항목별로 적기 (선택)</summary>
        <p className="mt-2 text-xs text-stone-600">
          어느 비용을 잘못 어림했는지 보려면 항목별로 적어 주세요. 없으면 0, 모르면 비워 두세요. 네 항목을 모두 적으면 합계는 그 합으로 저장됩니다.
        </p>
        <div className="mt-2 grid gap-3 sm:grid-cols-4">
          <Field label="수수료" name="result-feeActual" error={e.feeActual}>
            {input("feeActual", { inputMode: "numeric" })}
          </Field>
          <Field label="내가 낸 배송비" name="result-shippingActual" error={e.shippingActual}>
            {input("shippingActual", { inputMode: "numeric" })}
          </Field>
          <Field label="포장비" name="result-packingActual" error={e.packingActual}>
            {input("packingActual", { inputMode: "numeric" })}
          </Field>
          <Field label="교통비" name="result-transportActual" error={e.transportActual}>
            {input("transportActual", { inputMode: "numeric" })}
          </Field>
        </div>
      </details>
      <div className="flex items-center gap-3">
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? "저장 중…" : "판매 결과 저장"}
        </button>
        <span role="status" className={state.ok ? "text-sm text-teal-900" : "text-sm text-red-800"}>
          {state.message}
        </span>
      </div>
    </form>
  );
}

/** 내 비용 묶음 만들기·고치기. 빈칸은 모름으로 저장한다. */
export function CostPresetForm({ presetId, initial }: { presetId?: number; initial: Record<string, string> }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveCostPresetAction, {});
  const v = state.values ?? initial;
  const e = state.errors ?? {};
  const p = presetId === undefined ? "preset-new" : `preset-${presetId}`;
  const [feeMode, setFeeMode] = useState(v.feeMode === "RATE" ? "RATE" : "AMOUNT");
  const [seq, setSeq] = useState(0);
  const [seen, setSeen] = useState<FormState>(state);
  if (seen !== state) {
    setSeen(state);
    if (state.ok && presetId === undefined) {
      setSeq(seq + 1);
      setFeeMode("AMOUNT");
    }
  }
  const input = (name: string, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}, hint?: string) => (
    <Field label={label} name={`${p}-${name}`} error={e[name]} hint={hint}>
      <input
        id={`${p}-${name}`}
        name={name}
        className="input"
        defaultValue={v[name] ?? ""}
        aria-invalid={e[name] ? true : undefined}
        aria-describedby={e[name] ? `${p}-${name}-error` : undefined}
        {...props}
      />
    </Field>
  );
  return (
    <form action={action} className="space-y-3" noValidate key={`${seq}-${JSON.stringify(state.values ?? {})}`}>
      {presetId !== undefined ? <input type="hidden" name="presetId" value={presetId} /> : null}
      {input("name", "묶음 이름", { maxLength: 50 }, "예: 택배 거래, 편의점 택배, 직거래")}
      <fieldset>
        <legend className="mb-1 text-sm font-medium text-stone-800">수수료</legend>
        <div className="mb-2 flex gap-4 text-sm">
          <label className="flex items-center gap-1.5">
            <input type="radio" name="feeMode" value="AMOUNT" checked={feeMode === "AMOUNT"} onChange={() => setFeeMode("AMOUNT")} />
            금액(원)
          </label>
          <label className="flex items-center gap-1.5">
            <input type="radio" name="feeMode" value="RATE" checked={feeMode === "RATE"} onChange={() => setFeeMode("RATE")} />
            비율(%)
          </label>
        </div>
        {feeMode === "AMOUNT"
          ? input("feeAmount", "수수료 금액 (원)", { inputMode: "numeric", placeholder: "모르면 비워 두기" })
          : input("feeRate", "수수료율 (%)", { inputMode: "decimal", placeholder: "예: 3.5" }, "판매처의 최신 공식 안내를 확인해 직접 입력하세요.")}
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-4">
        {input("shipping", "내가 내는 배송비", { inputMode: "numeric", placeholder: "모르면 비워 두기" })}
        {input("packing", "포장비", { inputMode: "numeric", placeholder: "모르면 비워 두기" })}
        {input("transport", "교통비", { inputMode: "numeric", placeholder: "모르면 비워 두기" })}
        {input("expectedMinutes", "예상 소요시간 (분)", { inputMode: "numeric" })}
      </div>
      <div className="flex items-center gap-3">
        <button type="submit" className={presetId === undefined ? "btn-primary" : "btn"} disabled={pending}>
          {pending ? "저장 중…" : presetId === undefined ? "묶음 만들기" : "묶음 저장"}
        </button>
        <span role="status" className={state.ok ? "text-sm text-teal-900" : "text-sm text-red-800"}>
          {state.message}
        </span>
      </div>
    </form>
  );
}

/** 백업 사본 만들기 버튼과 결과 안내. */
export function SnapshotButton() {
  const [state, action, pending] = useActionState<FormState, FormData>(createSnapshotAction, {});
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <button type="submit" className="btn-primary" disabled={pending}>
        {pending ? "만드는 중…" : "지금 백업 사본 만들기"}
      </button>
      <span role="status" className={state.ok ? "text-sm text-teal-900" : "text-sm text-red-800"} data-testid="snapshot-status">
        {state.message}
      </span>
    </form>
  );
}

/** 설정 화면의 DB 점검 버튼과 결과. */
export function DbHealthButton() {
  const [state, action, pending] = useActionState<DbHealthState, FormData>(checkDbHealthAction, {});
  const r = state.report;
  return (
    <div className="space-y-3">
      <form action={action}>
        <button type="submit" className="btn" disabled={pending}>
          {pending ? "점검하는 중…" : "지금 점검하기"}
        </button>
      </form>
      <div role="status" data-testid="db-health">
        {r ? (
          <>
            <p className={r.ok ? "font-medium text-teal-900" : "font-medium text-red-800"}>
              {r.ok ? "모든 점검을 통과했습니다." : "문제가 있는 항목이 있습니다. 고치기 전에 백업 사본을 먼저 만들어 두세요."}{" "}
              <span className="font-normal text-stone-600">({state.checkedAt})</span>
            </p>
            <ul className="mt-2 space-y-1">
              {r.checks.map((c) => (
                <li key={c.key} data-testid={`db-health-${c.key}`} className="flex flex-wrap gap-x-2">
                  <span aria-hidden className={c.ok ? "text-teal-800" : "text-red-800"}>
                    {c.ok ? "✓" : "✗"}
                  </span>
                  <span>{c.label}:</span>
                  <span className={c.ok ? "text-stone-700" : "font-medium text-red-800"}>{c.ok ? c.detail : `문제 있음 — ${c.detail}`}</span>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </div>
    </div>
  );
}

/** 판매글 템플릿 만들기·고치기. */
export function TemplateForm({ templateId, initial }: { templateId?: number; initial: Record<string, string> }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveTemplateAction, {});
  const v = state.values ?? initial;
  const e = state.errors ?? {};
  const p = templateId === undefined ? "tpl-new" : `tpl-${templateId}`;
  const [seq, setSeq] = useState(0);
  const [seen, setSeen] = useState<FormState>(state);
  if (seen !== state) {
    setSeen(state);
    if (state.ok && templateId === undefined) setSeq(seq + 1);
  }
  return (
    <form action={action} className="space-y-3" noValidate key={`${seq}-${JSON.stringify(state.values ?? {})}`}>
      {templateId !== undefined ? <input type="hidden" name="templateId" value={templateId} /> : null}
      <Field label="템플릿 이름" name={`${p}-name`} error={e.name} required hint="예: 짧은 채팅용, 택배 거래용">
        <input
          id={`${p}-name`}
          name="name"
          className="input"
          maxLength={50}
          defaultValue={v.name ?? ""}
          aria-invalid={e.name ? true : undefined}
          aria-describedby={e.name ? `${p}-name-error` : undefined}
        />
      </Field>
      <Field label="본문" name={`${p}-body`} error={e.body} required>
        <textarea
          id={`${p}-body`}
          name="body"
          className="input min-h-36 font-sans"
          maxLength={2000}
          defaultValue={v.body ?? ""}
          aria-invalid={e.body ? true : undefined}
          aria-describedby={e.body ? `${p}-body-error` : undefined}
        />
      </Field>
      <div className="flex items-center gap-3">
        <button type="submit" className={templateId === undefined ? "btn-primary" : "btn"} disabled={pending}>
          {pending ? "저장 중…" : templateId === undefined ? "템플릿 만들기" : "템플릿 저장"}
        </button>
        <span role="status" className={state.ok ? "text-sm text-teal-900" : "text-sm text-red-800"}>
          {state.message}
        </span>
      </div>
    </form>
  );
}

type DatedAmountFormProps = {
  itemId: number;
  today: string;
  channelNames: string[];
};

/** 날짜·금액·판매처·메모를 받는 작은 기록 폼(받은 제안, 올린 가격). 저장에 성공하면 비운다. */
function DatedAmountForm({
  itemId,
  today,
  channelNames,
  serverAction,
  prefix,
  dateField,
  labels,
}: DatedAmountFormProps & {
  serverAction: (prev: FormState, fd: FormData) => Promise<FormState>;
  prefix: string;
  dateField: string;
  labels: { date: string; amount: string; channel: string; channelHint: string; memoHint: string; submit: string };
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(serverAction, {});
  const v = state.values ?? { [dateField]: today };
  const e = state.errors ?? {};
  const [seq, setSeq] = useState(0);
  const [seen, setSeen] = useState<FormState>(state);
  if (seen !== state) {
    setSeen(state);
    if (state.ok) setSeq(seq + 1);
  }
  const input = (name: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <input
      id={`${prefix}-${name}`}
      name={name}
      className="input"
      defaultValue={v[name] ?? ""}
      aria-invalid={e[name] ? true : undefined}
      aria-describedby={e[name] ? `${prefix}-${name}-error` : undefined}
      {...props}
    />
  );
  return (
    <form action={action} className="space-y-3" noValidate key={`${seq}-${JSON.stringify(state.values ?? {})}`}>
      <input type="hidden" name="itemId" value={itemId} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={labels.date} name={`${prefix}-${dateField}`} error={e[dateField]} required>
          {input(dateField, { type: "date" })}
        </Field>
        <Field label={labels.amount} name={`${prefix}-amount`} error={e.amount} required>
          {input("amount", { inputMode: "numeric" })}
        </Field>
        <Field label={labels.channel} name={`${prefix}-channel`} error={e.channel} hint={labels.channelHint}>
          {input("channel", { maxLength: 100, list: channelNames.length > 0 ? `${prefix}-channel-names` : undefined })}
        </Field>
      </div>
      {channelNames.length > 0 ? (
        <datalist id={`${prefix}-channel-names`}>
          {channelNames.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
      ) : null}
      <Field label="메모 (선택)" name={`${prefix}-memo`} error={e.memo} hint={labels.memoHint}>
        {input("memo", { maxLength: 500 })}
      </Field>
      <div className="flex items-center gap-3">
        <button type="submit" className="btn" disabled={pending}>
          {pending ? "저장 중…" : labels.submit}
        </button>
        <span role="status" className={state.ok ? "text-sm text-teal-900" : "text-sm text-red-800"}>
          {state.message}
        </span>
      </div>
    </form>
  );
}

/** 받은 제안 기록. 상대방 닉네임·연락처를 적는 칸은 없다. */
export function OfferForm(props: DatedAmountFormProps) {
  return (
    <DatedAmountForm
      {...props}
      serverAction={saveOfferAction}
      prefix="offer"
      dateField="receivedDate"
      labels={{
        date: "제안받은 날짜",
        amount: "제안 금액 (원)",
        channel: "어디서 받았나 (선택)",
        channelHint: "판매처 이름. 같은 이름의 계산이 있으면 그 비용으로 따져 봅니다.",
        memoHint: "조건만 적어 주세요(예: 직거래 희망). 상대방 닉네임·연락처는 적지 마세요.",
        submit: "제안 기록",
      }}
    />
  );
}

/** 내 판매글에 올린 가격 기록. */
export function PostedPriceForm(props: DatedAmountFormProps) {
  return (
    <DatedAmountForm
      {...props}
      serverAction={savePostedPriceAction}
      prefix="posted"
      dateField="postedDate"
      labels={{
        date: "올린(바꾼) 날짜",
        amount: "올린 가격 (원)",
        channel: "어디에 올렸나 (선택)",
        channelHint: "판매처 이름",
        memoHint: "예: 가격 내림, 끌어올림",
        submit: "올린 가격 기록",
      }}
    />
  );
}

/** 배분 화면의 시간당 가치 입력. 비워 두면 모름(null), 0은 "시간을 공짜로 본다". */
export function TimeValueForm({ initial }: { initial: number | null }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveTimeValueAction, {});
  const value = state.values?.timeValuePerHour ?? (initial === null ? "" : String(initial));
  const error = state.errors?.timeValuePerHour;
  return (
    <form action={action} className="flex flex-wrap items-end gap-3" noValidate key={JSON.stringify(state.values ?? {})}>
      <div className="min-w-0 flex-1 sm:max-w-xs">
        <Field
          label="내 시간은 시간당 (원)"
          name="timeValuePerHour"
          error={error}
          hint="직접 판매에 쓰는 시간을 얼마로 볼지 내가 정합니다. 모르면 비워 두세요(앱이 정하지 않습니다)."
        >
          <input
            id="timeValuePerHour"
            name="timeValuePerHour"
            className="input"
            inputMode="numeric"
            placeholder="예: 10000"
            defaultValue={value}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "timeValuePerHour-error" : "timeValuePerHour-hint"}
          />
        </Field>
      </div>
      <div className="flex items-center gap-3 pb-6">
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? "저장 중…" : "시간당 가치 저장"}
        </button>
        <span role="status" className={state.ok ? "text-sm text-teal-900" : "text-sm text-red-800"}>
          {state.message}
        </span>
      </div>
    </form>
  );
}

/** 가져오기 토큰 만들기·재발급. 토큰 원문은 만든 직후 이 화면에서 한 번만 보인다. */
export function ImportTokenForm({ hasToken }: { hasToken: boolean }) {
  const [state, action, pending] = useActionState<ImportTokenState, FormData>(generateImportTokenAction, {});
  return (
    <div className="space-y-3">
      <form action={action}>
        <button
          type="submit"
          className={hasToken ? "btn" : "btn-primary"}
          disabled={pending}
          onClick={(ev) => {
            if (hasToken && !window.confirm("재발급하면 지금 쓰는 토큰은 바로 못 쓰게 됩니다. 계속할까요?")) ev.preventDefault();
          }}
        >
          {pending ? "만드는 중…" : hasToken ? "토큰 재발급" : "토큰 만들기"}
        </button>
      </form>
      {state.token ? (
        <div className="notice space-y-2" data-testid="new-token">
          <p>{state.message}</p>
          <code className="block break-all rounded border border-stone-300 bg-white px-2 py-1 text-sm" data-testid="token-value">
            {state.token}
          </code>
          <CopyButton text={state.token} label="토큰 복사" />
        </div>
      ) : null}
    </div>
  );
}

export function ExtensionIdForm({ initial }: { initial: string | null }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveExtensionIdAction, {});
  const value = state.values?.extensionId ?? initial ?? "";
  const error = state.errors?.extensionId;
  return (
    <form action={action} className="space-y-3" noValidate key={JSON.stringify(state.values ?? {})}>
      <Field
        label="허용할 확장 ID"
        name="extensionId"
        error={error}
        hint="확장 팝업 아래쪽이나 chrome://extensions 에 보이는 32자 ID. 비워 두면 확장에서 보내는 요청을 모두 거부합니다."
      >
        <input
          id="extensionId"
          name="extensionId"
          className="input font-mono"
          defaultValue={value}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "extensionId-error" : "extensionId-hint"}
        />
      </Field>
      <div className="flex items-center gap-3">
        <button type="submit" className="btn" disabled={pending}>
          {pending ? "저장 중…" : "확장 ID 저장"}
        </button>
        <span role="status" className={state.ok ? "text-sm text-teal-900" : "text-sm text-red-800"}>
          {state.message}
        </span>
      </div>
    </form>
  );
}

/**
 * 한꺼번에 다루기 폼의 "모두 선택 / 선택 해제". 화면에 보이는 선택 칸(form 속성이 formId인 것)만 바꾼다.
 * 자바스크립트가 없으면 보이지 않아도 된다(칸을 하나씩 고를 수 있다).
 */
export function SelectAllToggle({ formId, name }: { formId: string; name: string }) {
  const boxes = () => Array.from(document.querySelectorAll<HTMLInputElement>(`input[type="checkbox"][form="${formId}"][name="${name}"]`));
  return (
    <span className="inline-flex gap-1">
      <button type="button" className="btn px-2 py-1 text-xs" onClick={() => boxes().forEach((b) => (b.checked = true))}>
        모두 선택
      </button>
      <button type="button" className="btn px-2 py-1 text-xs" onClick={() => boxes().forEach((b) => (b.checked = false))}>
        선택 해제
      </button>
    </span>
  );
}
