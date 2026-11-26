"use client";

// 화면을 그리다 예기치 않은 오류가 났을 때(없는 물건은 not-found.tsx가 따로 맡는다).
// 오류의 자세한 내용은 화면에 보이지 않고, 앱을 실행한 터미널에 남는다.

import Link from "next/link";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="card py-10 text-center" role="alert" data-testid="error-page">
      <p className="font-medium">화면을 그리는 중에 문제가 생겼습니다.</p>
      <p className="mt-1 text-sm text-stone-600">
        다시 시도해도 같으면 앱을 실행한 터미널의 오류 내용을 확인하고, 설정 화면의 DB 점검으로 자료 상태를 확인해 보세요.
      </p>
      {error.digest ? <p className="mt-1 text-xs text-stone-500">오류 번호: {error.digest}</p> : null}
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <button type="button" className="btn-primary" onClick={reset}>
          다시 시도
        </button>
        <Link href="/" className="btn">
          내 물건으로
        </Link>
        <Link href="/settings#db-health" className="btn">
          DB 점검
        </Link>
      </div>
    </div>
  );
}
