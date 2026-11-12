import type { ReactNode } from "react";
import { PRICE_TYPE_INFO, type PriceType } from "@/lib/domain/types";

const BADGE_TONE = {
  neutral: "border-stone-300 bg-stone-100 text-stone-800",
  teal: "border-teal-300 bg-teal-50 text-teal-900",
  amber: "border-amber-300 bg-amber-50 text-amber-950",
  red: "border-red-300 bg-red-50 text-red-900",
  blue: "border-sky-300 bg-sky-50 text-sky-950",
  violet: "border-violet-300 bg-violet-50 text-violet-950",
} as const;

export function Badge({
  children,
  tone = "neutral",
  title,
}: {
  children: ReactNode;
  tone?: keyof typeof BADGE_TONE;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={`inline-flex items-center whitespace-nowrap rounded border px-1.5 py-0.5 text-xs font-medium ${BADGE_TONE[tone]}`}
    >
      {children}
    </span>
  );
}

const TYPE_TONE: Record<PriceType, keyof typeof BADGE_TONE> = {
  ASKING: "blue",
  SOLD_LISTING: "violet",
  VERIFIED_SALE: "teal",
  BUYBACK_QUOTE: "amber",
  USER_REPORTED: "neutral",
};

/** 가격 유형 배지. 마우스를 올리거나 보조기기로 읽으면 유형 설명이 나온다. */
export function PriceTypeBadge({ type }: { type: PriceType }) {
  const info = PRICE_TYPE_INFO[type];
  return (
    <Badge tone={TYPE_TONE[type]} title={info.help}>
      {info.label}
    </Badge>
  );
}

export function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="mt-1 text-sm text-red-800">
      {message}
    </p>
  );
}

/** 라벨 + 입력 + 도움말 + 오류를 한 묶음으로. 오류는 해당 필드 바로 아래에 나온다. */
export function Field({
  label,
  name,
  error,
  hint,
  required,
  children,
}: {
  label: string;
  name: string;
  error?: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={name} className="mb-1 block text-sm font-medium text-stone-800">
        {label}
        {required ? <span className="text-red-800"> *</span> : null}
      </label>
      {children}
      {hint ? (
        <p id={`${name}-hint`} className="mt-1 text-xs text-stone-600">
          {hint}
        </p>
      ) : null}
      <FieldError id={`${name}-error`} message={error} />
    </div>
  );
}

export function Section({
  id,
  step,
  title,
  children,
  aside,
}: {
  id: string;
  step?: number;
  title: string;
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="card scroll-mt-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id={`${id}-title`} className="text-base font-semibold">
          {step ? <span className="mr-1.5 text-teal-800">{step}.</span> : null}
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}
