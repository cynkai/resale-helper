import { cookies } from "next/headers";

export const MODE_COOKIE = "resale_mode";

/** 기본은 실제 사용 모드. 사용자가 명시적으로 데모를 선택했을 때만 true. */
export async function isDemoMode(): Promise<boolean> {
  return (await cookies()).get(MODE_COOKIE)?.value === "demo";
}
