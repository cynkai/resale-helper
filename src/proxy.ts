import { NextResponse, type NextRequest } from "next/server";
import { isLoopbackHost } from "@/lib/host";

// 모든 요청에서 Host 헤더를 확인한다. 이 앱은 127.0.0.1에만 열리지만,
// 외부 도메인을 127.0.0.1로 다시 가리키는 DNS 리바인딩 공격은 Host 헤더로만 구별할 수 있다.
export function proxy(request: NextRequest) {
  if (!isLoopbackHost(request.headers.get("host"))) {
    return new NextResponse("이 앱은 localhost에서만 사용할 수 있습니다.", {
      status: 403,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  return NextResponse.next();
}
