// 물건 배분 판단: 물건마다 "직접 팔면 더 받는 돈을 그걸 위해 쓰는 시간으로 나눈 값"을
// 사용자가 정한 시간당 가치와 비교한다. 순수 함수이며 DB에 의존하지 않는다.
// 원칙: 모르는 값은 메우지 않고 판단을 보류한다. 시간당 가치·소요시간·수수료에 기본값을 두지 않는다.

import { divRoundHalfUp } from "./money";
import { computeNet, netDifference, type CostInputs, type CostKey, type NetResult } from "./net";
import { basisIssues, type BasisIssue, type BasisRecord } from "./scenario";
import { PRICE_TYPE_INFO, type PriceType, type SaleMethod } from "./types";

export type TriageVerdict = "DIRECT" | "BUYBACK" | "UNDECIDED";

export const VERDICT_LABEL: Record<TriageVerdict, string> = {
  DIRECT: "직접 판매",
  BUYBACK: "업체에 넘기기",
  UNDECIDED: "판단 보류",
};

export type TriageScenario = CostInputs & {
  method: SaleMethod;
  expectedMinutes: number | null;
  /** 저장 당시 기준 자료의 유형. null이면 기준 자료 없이 직접 입력한 예상 금액. */
  basisPriceType: PriceType | null;
};

export type TriageInput = {
  buyback: TriageScenario | null;
  direct: TriageScenario | null;
  /** 각 시나리오의 basisIssues 결과. 시나리오가 없으면 빈 배열. */
  buybackIssues: BasisIssue[];
  directIssues: BasisIssue[];
  /** 사용자가 정한 시간당 가치(원/시간). null = 아직 정하지 않음(모름). 0은 "시간을 공짜로 본다". */
  timeValuePerHour: number | null;
  /** 사용자가 이미 고른 판매 방법(items.chosenMethod). */
  chosenMethod: SaleMethod | null;
};

export type TriageReason =
  | { code: "NO_BUYBACK" }
  | { code: "NO_DIRECT" }
  | { code: "INCOMPLETE_COST"; method: SaleMethod; missing: CostKey[] }
  | { code: "BASIS_ISSUE"; method: SaleMethod; issues: BasisIssue[] }
  | { code: "DIRECT_NOT_HIGHER" }
  | { code: "NO_MINUTES"; methods: SaleMethod[] }
  | { code: "NO_EXTRA_TIME" }
  | { code: "NO_TIME_VALUE" }
  | { code: "PER_HOUR_AT_LEAST_TIME_VALUE" }
  | { code: "PER_HOUR_BELOW_TIME_VALUE" };

export type TriageWarning =
  | { code: "ASKING_BASIS" }
  | { code: "SELF_ESTIMATE"; method: SaleMethod }
  | { code: "CHOSEN_DIFFERS"; chosen: SaleMethod };

export type TriageResult = {
  verdict: TriageVerdict;
  /** 판단 근거. UNDECIDED면 판단에 필요한데 빠진 것들(채우면 판단할 수 있는 항목). */
  reasons: TriageReason[];
  warnings: TriageWarning[];
  buybackNet: NetResult | null;
  directNet: NetResult | null;
  /** 직접 판매 실수령액 − 업체 실수령액. 양쪽이 완전하고 기준 자료 문제가 없을 때만 값이 있다. */
  extra: number | null;
  /** 직접 판매 시나리오의 예상 소요시간(분). */
  minutes: number | null;
  /** 업체 판매 시나리오의 예상 소요시간(분). */
  buybackMinutes: number | null;
  /** 직접 판매에 추가로 드는 시간 = 직접 − 업체(분). 둘 다 알 때만 값이 있다. 0 이하일 수 있다. */
  extraMinutes: number | null;
  /** extra ÷ (extraMinutes/60), 원 미만 half-up 반올림. extra > 0 이고 extraMinutes > 0 일 때만 값이 있다. */
  extraPerHour: number | null;
};

/** 시간당 추가 수익. 원 미만은 money.ts 관례대로 정수 연산 half-up 반올림. extra > 0, minutes > 0 전용. */
export function perHour(extra: number, minutes: number): number {
  if (extra <= 0 || minutes <= 0) throw new Error("perHour는 양수 차액과 양수 시간에만 쓴다.");
  return Number(divRoundHalfUp(BigInt(extra) * 60n, BigInt(minutes)));
}

export function triage(input: TriageInput): TriageResult {
  const { buyback, direct } = input;
  const buybackNet = buyback ? computeNet(buyback) : null;
  const directNet = direct ? computeNet(direct) : null;
  const minutes = direct?.expectedMinutes ?? null;
  const buybackMinutes = buyback?.expectedMinutes ?? null;
  // 업체에 넘기는 데도 시간이 든다. 비교할 시간은 직접 판매에 "추가로" 드는 시간이다.
  const extraMinutes = minutes !== null && buybackMinutes !== null ? minutes - buybackMinutes : null;

  const warnings: TriageWarning[] = [];
  if (direct?.basisPriceType === "ASKING") warnings.push({ code: "ASKING_BASIS" });
  if (direct && direct.basisPriceType === null) warnings.push({ code: "SELF_ESTIMATE", method: "DIRECT" });
  if (buyback && buyback.basisPriceType === null) warnings.push({ code: "SELF_ESTIMATE", method: "BUYBACK" });

  const base = { buybackNet, directNet, minutes, buybackMinutes, extraMinutes };
  const done = (verdict: TriageVerdict, reasons: TriageReason[], extra: number | null, extraPerHour: number | null): TriageResult => {
    if (verdict !== "UNDECIDED" && input.chosenMethod && input.chosenMethod !== verdict) {
      warnings.push({ code: "CHOSEN_DIFFERS", chosen: input.chosenMethod });
    }
    return { verdict, reasons, warnings, ...base, extra, extraPerHour };
  };

  // 1단계: 두 방법의 실수령액을 믿을 수 있는가. 빠진 것을 모두 모아 한꺼번에 알려 준다.
  const blockers: TriageReason[] = [];
  if (!buyback) blockers.push({ code: "NO_BUYBACK" });
  if (!direct) blockers.push({ code: "NO_DIRECT" });
  if (buybackNet && !buybackNet.complete) blockers.push({ code: "INCOMPLETE_COST", method: "BUYBACK", missing: buybackNet.missing });
  if (directNet && !directNet.complete) blockers.push({ code: "INCOMPLETE_COST", method: "DIRECT", missing: directNet.missing });
  if (buyback && input.buybackIssues.length > 0) blockers.push({ code: "BASIS_ISSUE", method: "BUYBACK", issues: input.buybackIssues });
  if (direct && input.directIssues.length > 0) blockers.push({ code: "BASIS_ISSUE", method: "DIRECT", issues: input.directIssues });
  if (blockers.length > 0) return done("UNDECIDED", blockers, null, null);

  const extra = netDifference(directNet, buybackNet)!;

  // 2단계: 직접 팔아도 더 받지 못하면 시간과 무관하게 업체.
  if (extra <= 0) return done("BUYBACK", [{ code: "DIRECT_NOT_HIGHER" }], extra, null);

  // 3단계: 시간 대비 가치. 어느 쪽 소요시간이든 모르면 추가 시간을 알 수 없다(모름을 0분으로 치지 않는다).
  if (extraMinutes === null) {
    const methods: SaleMethod[] = [];
    if (buybackMinutes === null) methods.push("BUYBACK");
    if (minutes === null) methods.push("DIRECT");
    // 시간당 가치도 모르면 함께 알려 준다(보류 사유는 한꺼번에).
    const reasons: TriageReason[] = [{ code: "NO_MINUTES", methods }];
    if (input.timeValuePerHour === null) reasons.push({ code: "NO_TIME_VALUE" });
    return done("UNDECIDED", reasons, extra, null);
  }
  // 더 받는데 시간이 더 들지 않으면(같거나 오히려 적으면) 나눌 것 없이 직접 판매.
  if (extraMinutes <= 0) return done("DIRECT", [{ code: "NO_EXTRA_TIME" }], extra, null);
  const extraPerHour = perHour(extra, extraMinutes);
  if (input.timeValuePerHour === null) return done("UNDECIDED", [{ code: "NO_TIME_VALUE" }], extra, extraPerHour);
  // 비교는 화면에 보이는 반올림 값으로 한다(표시된 숫자와 판단이 어긋나지 않게). 같으면 DIRECT.
  return extraPerHour >= input.timeValuePerHour
    ? done("DIRECT", [{ code: "PER_HOUR_AT_LEAST_TIME_VALUE" }], extra, extraPerHour)
    : done("BUYBACK", [{ code: "PER_HOUR_BELOW_TIME_VALUE" }], extra, extraPerHour);
}

/** 저장된 시나리오와 기준 자료에서 판단 입력을 만든다(기준 자료 확인은 기존 basisIssues를 그대로 쓴다). */
export function triageItem(
  c: {
    item: { chosenMethod: SaleMethod | null };
    scenarios: (TriageScenario & { basisPriceRecordId: number | null })[];
    basisRecords: (BasisRecord & { id: number })[];
  },
  timeValuePerHour: number | null,
  today: string,
): TriageResult {
  const pick = (m: SaleMethod) => c.scenarios.find((s) => s.method === m) ?? null;
  const issues = (sc: ReturnType<typeof pick>): BasisIssue[] => {
    if (!sc) return [];
    const basis = sc.basisPriceRecordId !== null ? c.basisRecords.find((r) => r.id === sc.basisPriceRecordId) : undefined;
    return basisIssues(sc, basis, today);
  };
  const buyback = pick("BUYBACK");
  const direct = pick("DIRECT");
  return triage({
    buyback,
    direct,
    buybackIssues: issues(buyback),
    directIssues: issues(direct),
    timeValuePerHour,
    chosenMethod: c.item.chosenMethod,
  });
}

// ---- 화면 문구 ----

const METHOD_SHORT: Record<SaleMethod, string> = { BUYBACK: "업체 판매", DIRECT: "직접 판매" };

const COST_SHORT: Record<CostKey, string> = {
  fee: "수수료",
  shipping: "판매자 부담 배송비",
  packing: "포장비",
  transport: "교통비",
};

const ISSUE_SHORT: Record<BasisIssue, string> = {
  BASIS_DELETED: "기준 자료 삭제됨",
  BASIS_AMOUNT_CHANGED: "기준 자료 금액 바뀜",
  BASIS_NOT_KRW: "기준 자료가 원화 아님",
  BASIS_EXPIRED: "기준 견적 만료",
};

/** 판단 근거 또는 보류 이유. 보류 이유는 "무엇을 채우면 판단할 수 있는지"로 적는다. */
export function reasonText(r: TriageReason): string {
  switch (r.code) {
    case "NO_BUYBACK":
      return "업체 판매 금액·비용을 저장하면 판단할 수 있습니다.";
    case "NO_DIRECT":
      return "직접 판매 금액·비용을 저장하면 판단할 수 있습니다.";
    case "INCOMPLETE_COST":
      return `${METHOD_SHORT[r.method]}의 ${r.missing.map((k) => COST_SHORT[k]).join(", ")}을(를) 입력하면 판단할 수 있습니다(0원이면 0으로 입력).`;
    case "BASIS_ISSUE":
      return `${METHOD_SHORT[r.method]}의 기준 금액을 다시 저장하면 판단할 수 있습니다(${r.issues.map((i) => ISSUE_SHORT[i]).join(", ")}).`;
    case "DIRECT_NOT_HIGHER":
      return "직접 팔아도 업체보다 더 받지 못합니다. 시간과 무관하게 업체가 낫습니다.";
    case "NO_MINUTES":
      return `${r.methods.map((m) => METHOD_SHORT[m]).join("와 ")}의 예상 소요시간을 입력하면 판단할 수 있습니다(시간이 안 들면 0으로 입력).`;
    case "NO_EXTRA_TIME":
      return "직접 팔면 더 받고, 업체에 넘길 때보다 시간이 더 들지 않으므로 직접 판매입니다.";
    case "NO_TIME_VALUE":
      return "위에서 내 시간의 시간당 가치를 입력하면 판단할 수 있습니다.";
    case "PER_HOUR_AT_LEAST_TIME_VALUE":
      return "시간당 추가 수익이 내 시간당 가치 이상입니다.";
    case "PER_HOUR_BELOW_TIME_VALUE":
      return "시간당 추가 수익이 내 시간당 가치보다 적습니다.";
  }
}

export function warningText(w: TriageWarning): string {
  switch (w.code) {
    case "ASKING_BASIS":
      return "판매 중 희망가 기준이라 실제로는 더 적게 받을 수 있음";
    case "SELF_ESTIMATE":
      return `${METHOD_SHORT[w.method]}: 직접 어림한 금액 기준`;
    case "CHOSEN_DIFFERS":
      return `고른 방법과 다름(고른 방법: ${METHOD_SHORT[w.chosen]})`;
  }
}

/** 기준 자료 유형 표시. 기준 자료 없이 입력한 금액은 "직접 입력 예상가". */
export function basisTypeLabel(t: PriceType | null): string {
  return t === null ? "직접 입력 예상가" : PRICE_TYPE_INFO[t].label;
}

// ---- 정렬과 집계 ----

/** 기본 정렬: 판단 보류가 맨 위, 그다음 시간당 추가 수익 내림차순. 추가 시간이 없는 행(무한대)은 앞, 값 없음은 뒤. */
export function compareTriage(a: TriageResult, b: TriageResult): number {
  const undecided = (r: TriageResult) => (r.verdict === "UNDECIDED" ? 0 : 1);
  if (undecided(a) !== undecided(b)) return undecided(a) - undecided(b);
  const key = (r: TriageResult) =>
    r.reasons.some((x) => x.code === "NO_EXTRA_TIME") ? Number.POSITIVE_INFINITY : (r.extraPerHour ?? Number.NEGATIVE_INFINITY);
  const desc = (x: number, y: number) => (x === y ? 0 : y > x ? 1 : -1);
  // 시간당 값이 같거나 둘 다 없으면 차액이 큰 쪽을 앞에
  return desc(key(a), key(b)) || desc(a.extra ?? Number.NEGATIVE_INFINITY, b.extra ?? Number.NEGATIVE_INFINITY);
}

/** 판단별 건수. 금액 합계는 만들지 않는다(출처·기준이 다른 금액의 합은 의미가 없다). */
export function countVerdicts(results: TriageResult[]): Record<TriageVerdict, number> {
  const out: Record<TriageVerdict, number> = { DIRECT: 0, BUYBACK: 0, UNDECIDED: 0 };
  for (const r of results) out[r.verdict] += 1;
  return out;
}
