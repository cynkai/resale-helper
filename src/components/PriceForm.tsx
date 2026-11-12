"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { savePriceAction, type FormState } from "@/app/actions";
import { Field } from "./ui";
import {
  BUNDLE_LABEL,
  BUNDLE_TYPES,
  CONDITIONS,
  CONDITION_LABEL,
  CURRENCIES,
  PRICE_TYPE_INFO,
  type PriceType,
} from "@/lib/domain/types";

// 직접 입력에서 고를 수 있는 유형. VERIFIED_SALE(검증된 체결가)은 일부러 제외한다.
const MANUAL_TYPES: PriceType[] = ["ASKING", "SOLD_LISTING", "BUYBACK_QUOTE", "USER_REPORTED"];

export function PriceForm({
  itemId,
  priceId,
  initial,
}: {
  itemId: number;
  priceId?: number;
  initial: Record<string, string>;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(savePriceAction, {});
  const v = state.values ?? initial;
  const e = state.errors ?? {};
  const [type, setType] = useState(v.priceType ?? "ASKING");
  const isQuote = type === "BUYBACK_QUOTE";
  const key = JSON.stringify(state.values ?? {}); // 오류로 돌아오면 입력값을 유지한 채 다시 그린다

  const input = (name: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <input
      id={name}
      name={name}
      className="input"
      defaultValue={v[name] ?? ""}
      aria-invalid={e[name] ? true : undefined}
      aria-describedby={e[name] ? `${name}-error` : undefined}
      {...props}
    />
  );

  return (
    <form action={action} className="space-y-4" noValidate key={key}>
      <input type="hidden" name="itemId" value={itemId} />
      {priceId !== undefined ? <input type="hidden" name="priceId" value={priceId} /> : null}
      {state.message ? (
        <p role="alert" className="warn">
          {state.message}
        </p>
      ) : null}

      <Field label="가격 유형" name="priceType" error={e.priceType} required>
        <select
          id="priceType"
          name="priceType"
          className="input"
          value={type}
          onChange={(ev) => setType(ev.target.value)}
          aria-describedby="priceType-help"
        >
          {MANUAL_TYPES.map((t) => (
            <option key={t} value={t}>
              {PRICE_TYPE_INFO[t].label}
            </option>
          ))}
        </select>
        <p id="priceType-help" className="mt-1 text-xs text-stone-700">
          {PRICE_TYPE_INFO[type as PriceType]?.help} 직접 입력한 자료는 ‘검증된 체결가’로 저장할 수 없습니다.
        </p>
      </Field>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <Field label="금액" name="amount" error={e.amount} required>
            {input("amount", { inputMode: "decimal", placeholder: "예: 15000" })}
          </Field>
        </div>
        <Field label="통화" name="currency" error={e.currency} hint="원화가 아니면 비교·계산에서 제외됩니다.">
          <select id="currency" name="currency" className="input" defaultValue={v.currency ?? "KRW"}>
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="출처 이름" name="sourceName" error={e.sourceName} required hint="플랫폼명 또는 업체명">
          {input("sourceName", { placeholder: isQuote ? "예: ○○ 중고서점" : "예: ○○마켓" })}
        </Field>
        <Field label="확인일" name="checkedDate" error={e.checkedDate} required hint="이 가격을 직접 확인한 날짜">
          {input("checkedDate", { type: "date" })}
        </Field>
      </div>

      <Field
        label="원문 URL"
        name="sourceUrl"
        error={e.sourceUrl}
        hint="나중에 다시 확인하기 위한 기록입니다. 앱이 이 주소에 접속하지 않으며, URL이 있다고 검증된 가격이 되지도 않습니다."
      >
        {input("sourceUrl", { type: "url", placeholder: "https://" })}
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="상품 식별정보 (ISBN·모델명)" name="productIdentifier" error={e.productIdentifier} hint="내 물건과 다르면 비교에서 제외됩니다.">
          {input("productIdentifier")}
        </Field>
        <Field label="상태" name="condition" error={e.condition} hint="내 물건과 상태가 다르면 비교에서 제외됩니다.">
          <select id="condition" name="condition" className="input" defaultValue={v.condition ?? ""}>
            <option value="">모름</option>
            {CONDITIONS.map((c) => (
              <option key={c} value={c}>
                {CONDITION_LABEL[c]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="단품/묶음" name="bundleType" error={e.bundleType}>
          <select id="bundleType" name="bundleType" className="input" defaultValue={v.bundleType ?? "SINGLE"}>
            {BUNDLE_TYPES.map((b) => (
              <option key={b} value={b}>
                {BUNDLE_LABEL[b]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="배송비 포함 여부" name="shippingIncluded" error={e.shippingIncluded}>
          <select
            id="shippingIncluded"
            name="shippingIncluded"
            className="input"
            defaultValue={v.shippingIncluded ?? "UNKNOWN"}
          >
            <option value="UNKNOWN">모름</option>
            <option value="YES">포함</option>
            <option value="NO">미포함</option>
          </select>
        </Field>
      </div>

      {isQuote ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="견적 유효기간" name="quoteValidUntil" error={e.quoteValidUntil} hint="지나면 ‘만료’로 표시되고 비교에서 제외됩니다.">
            {input("quoteValidUntil", { type: "date" })}
          </Field>
          <Field label="검수·감액 조건" name="deductionTerms" error={e.deductionTerms}>
            {input("deductionTerms", { placeholder: "예: 필기 발견 시 감액" })}
          </Field>
        </div>
      ) : null}

      <details className="rounded-md border border-stone-200 p-3">
        <summary className="cursor-pointer text-sm font-medium">추가 정보 (선택)</summary>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <Field label="출처의 매물 번호" name="externalId" error={e.externalId} hint="같은 매물을 두 번 넣는 것을 막아 줍니다.">
            {input("externalId")}
          </Field>
          <Field label="거래일" name="tradeDate" error={e.tradeDate} hint="알고 있는 경우에만">
            {input("tradeDate", { type: "date" })}
          </Field>
          <Field label="구성품" name="components" error={e.components}>
            {input("components")}
          </Field>
          <Field label="확인 방법" name="verificationMethod" error={e.verificationMethod} hint="예: 판매글 화면에서 직접 확인">
            {input("verificationMethod")}
          </Field>
        </div>
      </details>

      <Field
        label="메모"
        name="memo"
        error={e.memo}
        hint={isQuote ? "원문 URL이 없으면 견적을 어떻게 받았는지 적어 주세요(전화·방문·앱 화면 등)." : undefined}
      >
        <textarea
          id="memo"
          name="memo"
          rows={2}
          className="input"
          defaultValue={v.memo ?? ""}
          aria-invalid={e.memo ? true : undefined}
          aria-describedby={e.memo ? "memo-error" : undefined}
        />
      </Field>

      <div className="flex gap-2">
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? "저장 중…" : "가격 자료 저장"}
        </button>
        <Link href={`/items/${itemId}#prices`} className="btn">
          취소
        </Link>
      </div>
    </form>
  );
}
