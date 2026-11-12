// ISBN-10 / ISBN-13 형식·체크섬 검증과 ISBN-13 정규화.

export type IsbnResult =
  | { ok: true; isbn13: string; inputKind: "ISBN10" | "ISBN13" }
  | { ok: false; error: string };

function stripSeparators(raw: string): string {
  return raw.trim().replace(/[\s-]/g, "").toUpperCase();
}

export function isbn13CheckDigit(first12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  }
  return (10 - (sum % 10)) % 10;
}

function isValidIsbn10(s: string): boolean {
  if (!/^\d{9}[\dX]$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const ch = s[i]!;
    const v = ch === "X" ? 10 : Number(ch);
    sum += v * (10 - i);
  }
  return sum % 11 === 0;
}

function isValidIsbn13(s: string): boolean {
  if (!/^\d{13}$/.test(s)) return false;
  return isbn13CheckDigit(s.slice(0, 12)) === Number(s[12]);
}

/** 입력을 검증하고 하이픈 없는 ISBN-13으로 정규화한다. */
export function normalizeIsbn(raw: string): IsbnResult {
  const s = stripSeparators(raw);
  if (s.length === 0) return { ok: false, error: "ISBN을 입력해 주세요." };
  if (s.length === 10) {
    if (!isValidIsbn10(s)) {
      return { ok: false, error: "ISBN-10 체크섬이 맞지 않습니다. 숫자를 다시 확인해 주세요." };
    }
    const first12 = "978" + s.slice(0, 9);
    return { ok: true, isbn13: first12 + String(isbn13CheckDigit(first12)), inputKind: "ISBN10" };
  }
  if (s.length === 13) {
    if (!/^\d{13}$/.test(s)) return { ok: false, error: "ISBN-13은 숫자 13자리여야 합니다." };
    if (!s.startsWith("978") && !s.startsWith("979")) {
      return { ok: false, error: "ISBN-13은 978 또는 979로 시작해야 합니다." };
    }
    if (!isValidIsbn13(s)) {
      return { ok: false, error: "ISBN-13 체크섬이 맞지 않습니다. 숫자를 다시 확인해 주세요." };
    }
    return { ok: true, isbn13: s, inputKind: "ISBN13" };
  }
  return { ok: false, error: "ISBN은 10자리 또는 13자리여야 합니다(하이픈·공백 제외)." };
}

/** 상품 식별정보 비교용 정규화. ISBN으로 해석되면 ISBN-13, 아니면 공백·하이픈·대소문자를 무시한 문자열. */
export function normalizeIdentifier(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const isbn = normalizeIsbn(raw);
  if (isbn.ok) return isbn.isbn13;
  const s = raw.trim().replace(/[\s\-_]/g, "").toUpperCase();
  return s.length > 0 ? s : null;
}
