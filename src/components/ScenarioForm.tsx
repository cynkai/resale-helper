"use client";

import { useActionState, useState } from "react";
import { saveScenarioAction, type FormState } from "@/app/actions";
import { Field } from "./ui";
import type { SaleMethod } from "@/lib/domain/types";

export type BasisOption = { id: number; label: string; amount: number };
/** 비용 칸만 베껴 올 수 있는 다른 계산. 금액과 판매처 이름은 베끼지 않는다. */
export type CopyOption = { id: number; label: string; values: Record<string, string> };

const COPY_FIELDS = ["feeMode", "feeAmount", "feeRate", "shipping", "packing", "transport", "expectedMinutes"] as const;

export function ScenarioForm({
  itemId,
  method,
  initial,
  basisOptions,
  scenarioId,
  idSuffix = "",
  submitLabel = "금액·비용 저장",
  channelNames = [],
  copyOptions = [],
}: {
  itemId: number;
  method: SaleMethod;
  initial: Record<string, string>;
  basisOptions: BasisOption[];
  /** 저장된 계산을 고칠 때 그 계산의 id. 없으면 새 계산. */
  scenarioId?: number;
  /** 같은 방식의 폼이 여러 개일 때 id 충돌을 피하는 꼬리표. */
  idSuffix?: string;
  submitLabel?: string;
  /** 내가 전에 적은 판매처 이름(자동완성용). */
  channelNames?: string[];
  copyOptions?: CopyOption[];
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveScenarioAction, {});
  // 베껴 온 값은 그 뒤에 폼을 제출하면(state가 바뀌면) 더 쓰지 않는다.
  const [copied, setCopied] = useState<{ values: Record<string, string>; at: FormState; n: number } | null>(null);
  const base = state.values ?? initial;
  const v = copied && copied.at === state ? { ...base, ...copied.values } : base;
  const e = state.errors ?? {};
  const p = `${method.toLowerCase()}${idSuffix}`; // 한 화면에 폼이 여러 개라서 id 충돌을 피한다
  const [basis, setBasis] = useState(v.basisPriceRecordId ?? "");
  const [amount, setAmount] = useState(v.saleAmount ?? "");
  const [channel, setChannel] = useState(v.channel ?? "");
  const [feeMode, setFeeMode] = useState(v.feeMode ?? "AMOUNT");
  const chosen = basisOptions.find((o) => String(o.id) === basis);
  const key = JSON.stringify(state.values ?? {}) + (copied && copied.at === state ? `#${copied.n}` : "");

  const money = (name: string, label: string, hint?: string) => (
    <Field label={label} name={`${p}-${name}`} error={e[name]} hint={hint}>
      <input
        id={`${p}-${name}`}
        name={name}
        className="input"
        inputMode="numeric"
        defaultValue={v[name] ?? ""}
        placeholder="모르면 비워 두기"
        aria-invalid={e[name] ? true : undefined}
        aria-describedby={e[name] ? `${p}-${name}-error` : undefined}
      />
    </Field>
  );

  return (
    <form action={action} className="space-y-3" noValidate key={key}>
      <input type="hidden" name="itemId" value={itemId} />
      <input type="hidden" name="method" value={method} />
      {scenarioId !== undefined ? <input type="hidden" name="scenarioId" value={scenarioId} /> : null}

      <Field
        label="판매처 이름 (선택)"
        name={`${p}-channel`}
        error={e.channel}
        hint="여러 곳을 따로 계산할 때 구분하는 이름입니다. 한 곳만 계산하면 비워 두어도 됩니다."
      >
        <input
          id={`${p}-channel`}
          name="channel"
          className="input"
          maxLength={100}
          value={channel}
          onChange={(ev) => setChannel(ev.target.value)}
          list={channelNames.length > 0 ? `${p}-channel-names` : undefined}
          aria-invalid={e.channel ? true : undefined}
          aria-describedby={e.channel ? `${p}-channel-error` : undefined}
        />
        {channelNames.length > 0 ? (
          <datalist id={`${p}-channel-names`}>
            {channelNames.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
        ) : null}
      </Field>

      {copyOptions.length > 0 ? (
        <Field label="다른 계산의 비용 베껴 오기" name={`${p}-copy`} hint="수수료·배송비·포장비·교통비·소요시간만 가져옵니다. 금액은 가져오지 않습니다.">
          <select
            id={`${p}-copy`}
            className="input"
            value=""
            onChange={(ev) => {
              const o = copyOptions.find((x) => String(x.id) === ev.target.value);
              if (!o) return;
              const picked: Record<string, string> = {};
              for (const f of COPY_FIELDS) picked[f] = o.values[f] ?? "";
              setFeeMode(picked.feeMode === "RATE" ? "RATE" : "AMOUNT");
              setCopied({ values: picked, at: state, n: (copied?.n ?? 0) + 1 });
            }}
          >
            <option value="">고르기</option>
            {copyOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
      ) : null}

      <Field label="기준 금액 고르기" name={`${p}-basis`} error={e.basisPriceRecordId}>
        <select
          id={`${p}-basis`}
          name="basisPriceRecordId"
          className="input"
          value={basis}
          onChange={(ev) => {
            setBasis(ev.target.value);
            const o = basisOptions.find((x) => String(x.id) === ev.target.value);
            if (o) setAmount(String(o.amount));
          }}
        >
          <option value="">예상 금액을 직접 입력</option>
          {basisOptions.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </Field>

      <Field
        label={method === "BUYBACK" ? "매입 금액 (원)" : "예상 판매금액 (원)"}
        name={`${p}-saleAmount`}
        error={e.saleAmount}
        required
        hint={chosen ? "선택한 가격 자료의 금액을 사용합니다." : "내가 정한 예상 금액입니다. 이 금액에 팔린다는 보장은 없습니다."}
      >
        <input
          id={`${p}-saleAmount`}
          name="saleAmount"
          className="input read-only:bg-stone-100"
          inputMode="numeric"
          value={amount}
          readOnly={Boolean(chosen)}
          onChange={(ev) => setAmount(ev.target.value)}
          aria-invalid={e.saleAmount ? true : undefined}
          aria-describedby={e.saleAmount ? `${p}-saleAmount-error` : undefined}
        />
      </Field>

      <fieldset>
        <legend className="mb-1 text-sm font-medium text-stone-800">수수료</legend>
        <div className="mb-2 flex gap-4 text-sm">
          <label className="flex items-center gap-1.5">
            <input
              type="radio"
              name="feeMode"
              value="AMOUNT"
              checked={feeMode === "AMOUNT"}
              onChange={() => setFeeMode("AMOUNT")}
            />
            금액(원)
          </label>
          <label className="flex items-center gap-1.5">
            <input type="radio" name="feeMode" value="RATE" checked={feeMode === "RATE"} onChange={() => setFeeMode("RATE")} />
            비율(%)
          </label>
        </div>
        {feeMode === "AMOUNT" ? (
          <Field label="수수료 금액 (원)" name={`${p}-feeAmount`} error={e.feeAmount} hint="없으면 0, 모르면 비워 두세요.">
            <input
              id={`${p}-feeAmount`}
              name="feeAmount"
              className="input"
              inputMode="numeric"
              defaultValue={v.feeAmount ?? ""}
              placeholder="모르면 비워 두기"
            />
          </Field>
        ) : (
          <Field
            label="수수료율 (%)"
            name={`${p}-feeRate`}
            error={e.feeRate}
            hint="이용하려는 판매처의 최신 공식 안내를 확인해 직접 입력하세요. 앱에 내장된 요율은 없습니다."
          >
            <input
              id={`${p}-feeRate`}
              name="feeRate"
              className="input"
              inputMode="decimal"
              defaultValue={v.feeRate ?? ""}
              placeholder="예: 3.5"
            />
          </Field>
        )}
      </fieldset>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {money("shipping", "내가 내는 배송비")}
        {money("packing", "포장비")}
        {money("transport", "교통비")}
      </div>
      <p className="text-xs text-stone-600">비용이 없으면 0을 입력하세요. 비워 두면 ‘모름’으로 처리되어 계산이 불완전하다고 표시됩니다.</p>

      <Field
        label="예상 소요시간 (분)"
        name={`${p}-expectedMinutes`}
        error={e.expectedMinutes}
        hint="내가 어림한 시간입니다. 실제 판매 기간을 예측한 값이 아닙니다."
      >
        <input
          id={`${p}-expectedMinutes`}
          name="expectedMinutes"
          className="input"
          inputMode="numeric"
          defaultValue={v.expectedMinutes ?? ""}
        />
      </Field>

      <Field label="메모 (선택)" name={`${p}-memo`} error={e.memo} hint="이 계산의 근거나 조건을 적어 둡니다(예: 수수료 안내를 확인한 날짜).">
        <input id={`${p}-memo`} name="memo" className="input" maxLength={500} defaultValue={v.memo ?? ""} />
      </Field>

      <div className="flex items-center gap-3">
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? "저장 중…" : submitLabel}
        </button>
        <span role="status" className={state.ok ? "text-sm text-teal-900" : "text-sm text-red-800"}>
          {state.message}
        </span>
      </div>
    </form>
  );
}
