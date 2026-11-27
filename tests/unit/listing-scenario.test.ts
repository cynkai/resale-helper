import { describe, expect, it } from "vitest";
import { listingScenario } from "@/lib/domain/scenario";

const sc = (id: number, method: "DIRECT" | "BUYBACK", channel = "", isPrimary = false) => ({ id, method, channel, isPrimary });

describe("판매글에 쓸 개인 판매 계산", () => {
  it("개인 판매 계산을 골랐으면 그것, 아니면 개인 판매의 기준 계산", () => {
    const list = [sc(1, "DIRECT", "택배"), sc(2, "DIRECT", "직거래", true), sc(3, "BUYBACK")];
    expect(listingScenario({ chosenMethod: "DIRECT", chosenChannel: "택배" }, list)?.id).toBe(1);
    // 업체 판매를 골랐거나 고르지 않았으면 개인 판매의 기준 계산
    expect(listingScenario({ chosenMethod: "BUYBACK", chosenChannel: "" }, list)?.id).toBe(2);
    expect(listingScenario({ chosenMethod: null }, list)?.id).toBe(2);
  });

  it("개인 판매 계산이 여러 개인데 기준이 없으면 고르지 않는다(앱이 대신 고르지 않음)", () => {
    const list = [sc(1, "DIRECT", "택배"), sc(2, "DIRECT", "직거래")];
    expect(listingScenario({ chosenMethod: null }, list)).toBeUndefined();
    expect(listingScenario({ chosenMethod: null }, [sc(5, "DIRECT")])?.id).toBe(5);
    expect(listingScenario({ chosenMethod: null }, [sc(3, "BUYBACK")])).toBeUndefined();
  });
});
