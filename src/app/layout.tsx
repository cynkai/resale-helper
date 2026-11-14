import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { enterDemoAction, exitDemoAction, resetDemoAction } from "./actions";
import { isDemoMode } from "@/lib/mode";

export const metadata: Metadata = {
  title: "얼마에 팔까",
  description: "집에 있는 물건을 팔기 전에 가격 자료를 비교하고 실수령액을 계산하는 개인용 도구",
};

// 모든 화면이 로컬 DB와 모드 쿠키에 의존하므로 정적 생성하지 않는다.
export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const demo = await isDemoMode();
  return (
    <html lang="ko">
      <body>
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:bg-white focus:p-2">
          본문으로 건너뛰기
        </a>
        {demo ? (
          <div role="status" className="border-b border-amber-400 bg-amber-100 text-amber-950">
            <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
              <p>
                <strong>데모 모드</strong> — 지금 보이는 물건과 가격은 모두 <strong>가상 데이터</strong>입니다. 실제 시세가 아니며 내 자료와 섞이지 않습니다.
              </p>
              <div className="flex gap-2">
                <form action={resetDemoAction}>
                  <button type="submit" className="btn">데모 초기화</button>
                </form>
                <form action={exitDemoAction}>
                  <button type="submit" className="btn-primary">실제 사용으로 돌아가기</button>
                </form>
              </div>
            </div>
          </div>
        ) : null}
        <header className="border-b border-stone-200 bg-white">
          <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-2 px-4 py-3">
            <Link href="/" className="text-lg font-bold text-teal-900">
              얼마에 팔까
            </Link>
            <nav aria-label="주 메뉴" className="flex items-center gap-2">
              <Link href="/" className="btn">내 물건</Link>
              <Link href="/triage" className="btn">배분</Link>
              <Link href="/checkup" className="btn">점검</Link>
              <Link href="/results" className="btn">판매 결과</Link>
              <Link href="/items/new" className="btn-primary">물건 등록</Link>
            </nav>
          </div>
        </header>
        <main id="main" className="mx-auto max-w-4xl px-4 py-6">
          {children}
        </main>
        <footer className="mx-auto max-w-4xl px-4 pb-10 text-xs text-stone-600">
          <p>이 앱은 내 컴퓨터에서만 동작하는 개인용 도구입니다. 가격은 참고자료이며 실제 판매·매입 금액을 보장하지 않습니다.</p>
          <p className="mt-2">
            <a href="/api/backup" className="underline underline-offset-2 hover:text-stone-900" download>
              전체 자료 백업 파일(.db) 받기
            </a>{" "}
            — 복구는 앱을 끈 뒤 <code>pnpm db:restore &lt;파일&gt;</code>
          </p>
          <p className="mt-2">
            <a href="/api/export/all" className="underline underline-offset-2 hover:text-stone-900" download>
              읽을 수 있는 전체 내보내기(.json) 받기
            </a>{" "}
            — 지금 모드의 물건·가격 자료·계산·판매 결과(복구용 아님)
          </p>
          <p className="mt-2">
            <Link href="/settings" className="underline underline-offset-2 hover:text-stone-900">
              설정(가져오기 API·브라우저 확장)
            </Link>
          </p>
          {!demo ? (
            <form action={enterDemoAction} className="mt-2">
              <button type="submit" className="underline underline-offset-2 hover:text-stone-900">
                가상 데이터로 둘러보기(데모 보기)
              </button>
            </form>
          ) : null}
        </footer>
      </body>
    </html>
  );
}
