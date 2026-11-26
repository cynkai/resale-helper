"use client";

// 바탕 레이아웃까지 그리지 못한 오류일 때. 이때는 앱의 스타일시트도 없을 수 있어 최소한의 글과 링크만 둔다.

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="ko">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: "2rem", lineHeight: 1.6 }}>
        <h1 style={{ fontSize: "1.25rem" }}>얼마에 팔까 — 화면을 열지 못했습니다</h1>
        <p>앱을 실행한 터미널의 오류 내용을 확인해 주세요. DB 파일 경로(DATABASE_PATH)나 마이그레이션 문제일 수 있습니다.</p>
        {error.digest ? <p style={{ fontSize: "0.8rem", color: "#57534e" }}>오류 번호: {error.digest}</p> : null}
        <p>
          <button type="button" onClick={reset}>
            다시 시도
          </button>{" "}
          {/* 레이아웃까지 깨진 상태라 클라이언트 이동 대신 페이지를 새로 불러온다. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/">처음 화면으로</a>
        </p>
      </body>
    </html>
  );
}
