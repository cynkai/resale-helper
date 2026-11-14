import { describe, expect, it } from "vitest";
import {
  compareTriage,
  countVerdicts,
  perHour,
  reasonText,
  triage,
  type TriageInput,
  type TriageScenario,
} from "@/lib/domain/triage";

// 업체: 7,000원, 비용 모두 0원 → 실수령 7,000원
const BUYBACK: TriageScenario = {
  method: "BUYBACK",
  saleAmount: 7000,
  feeMode: "AMOUNT",
  feeAmount: 0,
  feeRateBp: null,
  shipping: 0,
  packing: 0,
  transport: 0,
  expectedMinutes: 0, // 기본 픽스처는 업체에 시간이 안 든다고 본다 → 추가 시간 = 직접 판매 시간
  basisPriceType: "BUYBACK_QUOTE",
};
// 직접: 19,000 − 0 − 3,500 − 500 − 0 = 15,000원 → 차액 8,000원
const DIRECT: TriageScenario = {
  method: "DIRECT",
  saleAmount: 19000,
  feeMode: "AMOUNT",
  feeAmount: 0,
  feeRateBp: null,
  shipping: 3500,
  packing: 500,
  transport: 0,
  expectedMinutes: 60,
  basisPriceType: "SOLD_LISTING",
};

function input(over: Partial<TriageInput> = {}): TriageInput {
  return {
    buyback: BUYBACK,
    direct: DIRECT,
    buybackIssues: [],
    directIssues: [],
    timeValuePerHour: 5000,
    chosenMethod: null,
    ...over,
  };
}
const codes = (r: ReturnType<typeof triage>) => r.reasons.map((x) => x.code);

describe("배분 판단: 실수령액을 믿을 수 없으면 보류", () => {
  it("시나리오가 없으면 어느 쪽이 없는지 모두 알려 준다", () => {
    const r = triage(input({ buyback: null, direct: null }));
    expect(r.verdict).toBe("UNDECIDED");
    expect(codes(r)).toEqual(["NO_BUYBACK", "NO_DIRECT"]);
    expect(r.extra).toBeNull();
    expect(triage(input({ direct: null })).reasons).toEqual([{ code: "NO_DIRECT" }]);
  });

  it("모르는 비용(null)이 있으면 보류하고 빠진 항목을 알려 준다. 0원은 모름이 아니다", () => {
    const r = triage(input({ direct: { ...DIRECT, shipping: null } }));
    expect(r.verdict).toBe("UNDECIDED");
    expect(r.reasons).toEqual([{ code: "INCOMPLETE_COST", method: "DIRECT", missing: ["shipping"] }]);
    expect(r.extra).toBeNull();
    expect(reasonText(r.reasons[0]!)).toContain("판매자 부담 배송비");

    const zero = triage(input({ direct: { ...DIRECT, shipping: 0 } }));
    expect(zero.verdict).not.toBe("UNDECIDED");
    expect(zero.extra).toBe(11500);
  });

  it("비율 수수료의 요율을 모르면 수수료가 빠진 것으로 본다", () => {
    const r = triage(input({ buyback: { ...BUYBACK, feeMode: "RATE", feeRateBp: null } }));
    expect(r.reasons).toEqual([{ code: "INCOMPLETE_COST", method: "BUYBACK", missing: ["fee"] }]);
  });

  it("기준 자료가 삭제·변경·만료되면 보류한다", () => {
    const r = triage(input({ buybackIssues: ["BASIS_EXPIRED"], directIssues: ["BASIS_AMOUNT_CHANGED"] }));
    expect(r.verdict).toBe("UNDECIDED");
    expect(r.reasons).toEqual([
      { code: "BASIS_ISSUE", method: "BUYBACK", issues: ["BASIS_EXPIRED"] },
      { code: "BASIS_ISSUE", method: "DIRECT", issues: ["BASIS_AMOUNT_CHANGED"] },
    ]);
    expect(r.extra).toBeNull();
  });

  it("보류 사유는 한꺼번에 모은다(하나 고치고 다음 사유를 새로 발견하지 않도록)", () => {
    const r = triage(input({ buyback: null, direct: { ...DIRECT, packing: null }, directIssues: ["BASIS_DELETED"] }));
    expect(codes(r)).toEqual(["NO_BUYBACK", "INCOMPLETE_COST", "BASIS_ISSUE"]);
  });
});

describe("배분 판단: 차액과 시간", () => {
  it("직접 팔아도 더 받지 못하면(차액 ≤ 0) 시간·시간당 가치를 몰라도 업체", () => {
    const same = triage(input({ direct: { ...DIRECT, saleAmount: 11000, expectedMinutes: null }, timeValuePerHour: null }));
    expect(same.verdict).toBe("BUYBACK");
    expect(codes(same)).toEqual(["DIRECT_NOT_HIGHER"]);
    expect(same.extra).toBe(0);
    expect(same.extraPerHour).toBeNull();

    const less = triage(input({ direct: { ...DIRECT, saleAmount: 5000 } }));
    expect(less.verdict).toBe("BUYBACK");
    expect(less.extra).toBe(-6000); // 5,000 − 4,000 − 7,000
  });

  it("소요시간을 모르면 보류하되 차액은 보여 준다", () => {
    const r = triage(input({ direct: { ...DIRECT, expectedMinutes: null } }));
    expect(r.verdict).toBe("UNDECIDED");
    expect(r.reasons).toEqual([{ code: "NO_MINUTES", methods: ["DIRECT"] }]);
    expect(r.extra).toBe(8000);
    expect(r.extraPerHour).toBeNull();
    // 시간당 가치도 모르면 둘 다 알려 준다
    expect(codes(triage(input({ direct: { ...DIRECT, expectedMinutes: null }, timeValuePerHour: null })))).toEqual([
      "NO_MINUTES",
      "NO_TIME_VALUE",
    ]);
  });

  it("소요시간 0분이고 더 받으면 0으로 나누지 않고 직접 판매(시간당 가치를 몰라도)", () => {
    const r = triage(input({ direct: { ...DIRECT, expectedMinutes: 0 }, timeValuePerHour: null }));
    expect(r.verdict).toBe("DIRECT");
    expect(codes(r)).toEqual(["NO_EXTRA_TIME"]);
    expect(r.extraPerHour).toBeNull();
  });

  it("시간당 가치를 모르면(null) 보류하되 시간당 추가 수익은 계산해 보여 준다", () => {
    const r = triage(input({ timeValuePerHour: null }));
    expect(r.verdict).toBe("UNDECIDED");
    expect(codes(r)).toEqual(["NO_TIME_VALUE"]);
    expect(r.extraPerHour).toBe(8000);
  });

  it("시간당 가치 0원은 모름이 아니라 유효한 값이다(시간을 공짜로 봄 → 더 받으면 직접)", () => {
    const r = triage(input({ timeValuePerHour: 0 }));
    expect(r.verdict).toBe("DIRECT");
    expect(codes(r)).toEqual(["PER_HOUR_AT_LEAST_TIME_VALUE"]);
  });

  it("경계값: 시간당 추가 수익이 시간당 가치와 같으면 직접, 1원이라도 적으면 업체", () => {
    expect(triage(input({ timeValuePerHour: 8000 })).verdict).toBe("DIRECT");
    const below = triage(input({ timeValuePerHour: 8001 }));
    expect(below.verdict).toBe("BUYBACK");
    expect(codes(below)).toEqual(["PER_HOUR_BELOW_TIME_VALUE"]);
  });

  it("시간은 직접 판매에 추가로 드는 시간(직접 − 업체)을 쓴다", () => {
    const r = triage(input({ buyback: { ...BUYBACK, expectedMinutes: 20 } }));
    expect(r.minutes).toBe(60);
    expect(r.buybackMinutes).toBe(20);
    expect(r.extraMinutes).toBe(40);
    expect(r.extraPerHour).toBe(12000); // 8,000원 ÷ 40분
  });

  it("업체 소요시간을 모르면(null) 0분으로 치지 않고 보류한다", () => {
    const r = triage(input({ buyback: { ...BUYBACK, expectedMinutes: null } }));
    expect(r.verdict).toBe("UNDECIDED");
    expect(r.reasons).toEqual([{ code: "NO_MINUTES", methods: ["BUYBACK"] }]);
    expect(r.extraMinutes).toBeNull();
    expect(r.extraPerHour).toBeNull();
    const both = triage(input({ buyback: { ...BUYBACK, expectedMinutes: null }, direct: { ...DIRECT, expectedMinutes: null } }));
    expect(both.reasons).toEqual([{ code: "NO_MINUTES", methods: ["BUYBACK", "DIRECT"] }]);
  });

  it("더 받는데 업체보다 시간이 더 들지 않으면(같거나 적으면) 직접 판매", () => {
    const same = triage(input({ buyback: { ...BUYBACK, expectedMinutes: 60 }, timeValuePerHour: 999999 }));
    expect(same.verdict).toBe("DIRECT");
    expect(codes(same)).toEqual(["NO_EXTRA_TIME"]);
    expect(same.extraMinutes).toBe(0);
    const less = triage(input({ buyback: { ...BUYBACK, expectedMinutes: 90 }, timeValuePerHour: null }));
    expect(less.verdict).toBe("DIRECT");
    expect(less.extraMinutes).toBe(-30);
    expect(less.extraPerHour).toBeNull();
  });
});

describe("시간당 추가 수익 반올림", () => {
  it("원 미만은 half-up 반올림(정수 연산)", () => {
    expect(perHour(1000, 7)).toBe(8571); // 8571.43
    expect(perHour(1, 120)).toBe(1); // 0.5 → 1
    expect(perHour(5, 600)).toBe(1); // 0.5 → 1
    expect(perHour(4, 600)).toBe(0); // 0.4 → 0
    expect(perHour(8000, 90)).toBe(5333); // 5333.33
  });
  it("반올림된 값으로 비교한다: 5,333.33원/시간은 5,333원과 같다고 본다", () => {
    const r = triage(input({ direct: { ...DIRECT, expectedMinutes: 90 }, timeValuePerHour: 5333 }));
    expect(r.extraPerHour).toBe(5333);
    expect(r.verdict).toBe("DIRECT");
  });
  it("0 이하 입력은 거부한다(0으로 나누지 않음)", () => {
    expect(() => perHour(100, 0)).toThrow();
    expect(() => perHour(0, 10)).toThrow();
  });
});

describe("배분 판단 경고(판단은 바꾸지 않음)", () => {
  it("직접 판매 기준이 판매 중 희망가면 더 적게 받을 수 있다고 경고한다", () => {
    const r = triage(input({ direct: { ...DIRECT, basisPriceType: "ASKING" } }));
    expect(r.verdict).toBe("DIRECT");
    expect(r.warnings).toEqual([{ code: "ASKING_BASIS" }]);
  });
  it("기준 자료 없이 직접 입력한 금액이면 쪽마다 어림 경고를 붙인다", () => {
    const r = triage(input({ direct: { ...DIRECT, basisPriceType: null }, buyback: { ...BUYBACK, basisPriceType: null } }));
    expect(r.warnings).toEqual([
      { code: "SELF_ESTIMATE", method: "DIRECT" },
      { code: "SELF_ESTIMATE", method: "BUYBACK" },
    ]);
  });
  it("이미 고른 방법이 판단과 다르면 표시하고, 같거나 보류면 표시하지 않는다", () => {
    expect(triage(input({ chosenMethod: "BUYBACK" })).warnings).toEqual([{ code: "CHOSEN_DIFFERS", chosen: "BUYBACK" }]);
    expect(triage(input({ chosenMethod: "DIRECT" })).warnings).toEqual([]);
    expect(triage(input({ chosenMethod: "BUYBACK", timeValuePerHour: null })).warnings).toEqual([]);
  });
});

describe("정렬과 건수", () => {
  it("보류가 맨 위, 그다음 시간당 추가 수익 내림차순(0분은 맨 앞, 값 없음은 뒤)", () => {
    const rows = {
      low: triage(input({ timeValuePerHour: 9000 })), // 8,000/h BUYBACK
      high: triage(input({ direct: { ...DIRECT, expectedMinutes: 30 } })), // 16,000/h DIRECT
      zero: triage(input({ direct: { ...DIRECT, expectedMinutes: 0 } })),
      notHigher: triage(input({ direct: { ...DIRECT, saleAmount: 5000 } })),
      undecided: triage(input({ timeValuePerHour: null })),
    };
    const sorted = Object.entries(rows)
      .sort(([, a], [, b]) => compareTriage(a, b))
      .map(([k]) => k);
    expect(sorted).toEqual(["undecided", "zero", "high", "low", "notHigher"]);
  });
  it("판단별 건수만 센다", () => {
    const rs = [triage(input({ timeValuePerHour: 5000 })), triage(input({ timeValuePerHour: 9000 })), triage(input({ direct: null }))];
    expect(countVerdicts(rs)).toEqual({ DIRECT: 1, BUYBACK: 1, UNDECIDED: 1 });
  });
});

describe("시간까지 고려한 최저 직접 판매금액", () => {
  const costs = { feeMode: "RATE" as const, feeAmount: null, feeRateBp: 350, shipping: 4000, packing: 0, transport: 0 };
  const buyback = { method: "BUYBACK" as const, saleAmount: 60000, feeMode: "AMOUNT" as const, feeAmount: 0, feeRateBp: null, shipping: 0, packing: 0, transport: 2000, expectedMinutes: 40, basisPriceType: null };
  const verdictAt = (saleAmount: number, tv: number) =>
    triage({
      buyback,
      direct: { method: "DIRECT", saleAmount, ...costs, expectedMinutes: 180, basisPriceType: null },
      buybackIssues: [],
      directIssues: [],
      timeValuePerHour: tv,
      chosenMethod: null,
    }).verdict;

  it("그 금액에서 배분 판단이 처음으로 '직접 판매'가 된다(배분과 같은 반올림)", async () => {
    const { directThresholdWithTime } = await import("@/lib/domain/break-even");
    for (const tv of [0, 9000, 12000, 15001]) {
      const r = directThresholdWithTime(costs, 58000, 140, tv);
      if (!r || !r.ok) throw new Error("no threshold");
      expect(verdictAt(r.saleAmount, tv), `tv=${tv}`).toBe("DIRECT");
      expect(verdictAt(r.saleAmount - 1, tv), `tv=${tv}`).toBe("BUYBACK");
    }
  });
  it("추가 소요시간이나 시간당 가치를 모르면, 또는 추가 시간이 0 이하면 시간 기준선은 없다", async () => {
    const { directThresholdWithTime } = await import("@/lib/domain/break-even");
    expect(directThresholdWithTime(costs, 58000, null, 9000)).toBeNull();
    expect(directThresholdWithTime(costs, 58000, 140, null)).toBeNull();
    expect(directThresholdWithTime(costs, 58000, 0, 9000)).toBeNull();
    expect(directThresholdWithTime(costs, null, 140, 9000)).toEqual({ ok: false, reason: "BUYBACK_NET_UNKNOWN" });
    expect(directThresholdWithTime({ ...costs, feeRateBp: null }, 58000, 140, 9000)).toEqual({ ok: false, reason: "DIRECT_COST_UNKNOWN" });
  });
});
