/** 한국 시간 기준 오늘 날짜(YYYY-MM-DD). 개인용 로컬 앱이므로 시간대는 Asia/Seoul로 고정한다. */
export function todayYmd(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
}
