// 서지정보(제목·저자·출판사) 제공자 어댑터. 가격 정보와는 완전히 별개다.
// 여기서 가져온 값은 폼을 미리 채우는 용도이며, 사용자가 제목·판본을 직접 확인한 뒤 저장한다.

export type BookMetadata = {
  title: string;
  author: string | null;
  publisher: string | null;
  edition: string | null;
  publishedDate: string | null;
};

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface BibliographicProvider {
  id: string;
  label: string;
  /** 키가 필요한 제공자는 키가 설정된 경우에만 true */
  isConfigured(): boolean;
  /** 결과 없음은 null. 네트워크·형식 오류는 예외를 던진다. */
  lookupByIsbn(isbn13: string, fetchImpl: FetchLike): Promise<BookMetadata | null>;
}

const USER_AGENT = "resale-helper/0.1 (local personal tool)";
export const LOOKUP_TIMEOUT_MS = 5000;

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

/**
 * Open Library Books API (키 불필요).
 * 문서: https://openlibrary.org/dev/docs/api/books — jscmd=data 형식.
 * 한국어 도서는 등록되지 않은 경우가 많다.
 */
export const openLibraryProvider: BibliographicProvider = {
  id: "openlibrary",
  label: "Open Library",
  isConfigured: () => true,
  async lookupByIsbn(isbn13, fetchImpl) {
    const key = `ISBN:${isbn13}`;
    const url = `https://openlibrary.org/api/books?bibkeys=${encodeURIComponent(key)}&jscmd=data&format=json`;
    const res = await fetchImpl(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Open Library 응답 오류 (HTTP ${res.status})`);
    const json = (await res.json()) as Record<string, unknown>;
    const entry = json[key] as Record<string, unknown> | undefined;
    if (!entry || typeof entry !== "object") return null;
    const title = str(entry.title);
    if (!title) return null;
    const names = (list: unknown): string | null => {
      if (!Array.isArray(list)) return null;
      const n = list.map((x) => str((x as { name?: unknown })?.name)).filter(Boolean);
      return n.length > 0 ? n.join(", ") : null;
    };
    const subtitle = str(entry.subtitle);
    return {
      title: subtitle ? `${title}: ${subtitle}` : title,
      author: names(entry.authors),
      publisher: names(entry.publishers),
      edition: null, // jscmd=data 형식에는 판본 필드가 없다 → 사용자가 직접 입력
      publishedDate: str(entry.publish_date),
    };
  },
};

/**
 * 국립중앙도서관 ISBN 서지정보 API (인증키 필요: NLK_CERT_KEY).
 * 문서: https://www.nl.go.kr/NL/contents/N31101030500.do
 * 요청 URL·파라미터·필드명은 문서에서 확인했으나, 키가 없어 실제 호출은 검증하지 못했다.
 */
export const nlkProvider: BibliographicProvider = {
  id: "nlk",
  label: "국립중앙도서관",
  isConfigured: () => Boolean(process.env.NLK_CERT_KEY),
  async lookupByIsbn(isbn13, fetchImpl) {
    const params = new URLSearchParams({
      cert_key: process.env.NLK_CERT_KEY ?? "",
      result_style: "json",
      page_no: "1",
      page_size: "5",
      isbn: isbn13,
    });
    const res = await fetchImpl(`https://www.nl.go.kr/seoji/SearchApi.do?${params.toString()}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`국립중앙도서관 응답 오류 (HTTP ${res.status})`);
    const json = (await res.json()) as { docs?: unknown; ERR_CODE?: unknown; ERR_MESSAGE?: unknown };
    if (!Array.isArray(json.docs)) {
      // 오류 메시지에 키가 섞이지 않도록 고정 문구만 사용한다.
      throw new Error("국립중앙도서관 응답을 해석하지 못했습니다(인증키 또는 응답 형식 확인 필요).");
    }
    const doc = (json.docs as Record<string, unknown>[]).find((d) => str(d.EA_ISBN) === isbn13);
    if (!doc) return null;
    const title = str(doc.TITLE);
    if (!title) return null;
    const date = str(doc.PUBLISH_PREDATE);
    return {
      title,
      author: str(doc.AUTHOR),
      publisher: str(doc.PUBLISHER),
      edition: str(doc.EDITION_STMT),
      publishedDate: date && /^\d{8}$/.test(date) ? `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}` : date,
    };
  },
};

/** 조회 순서: 키가 설정된 국내 제공자 → Open Library */
export const bibliographicProviders: BibliographicProvider[] = [nlkProvider, openLibraryProvider];

export type LookupOutcome =
  | { status: "found"; providerLabel: string; data: BookMetadata; cached: boolean }
  | { status: "not_found"; tried: string[] }
  | { status: "error"; message: string; tried: string[] }
  | { status: "disabled" };

export type LookupCacheStore = {
  get(provider: string, key: string): { payload: string; fetchedAt: string } | undefined;
  set(provider: string, key: string, payload: string): void;
};

const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

async function withRetry<T>(fn: () => Promise<T>, retries: number): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

/**
 * ISBN으로 서지정보를 조회한다. 타임아웃 5초, 재시도 1회, 결과(없음 포함) 30일 캐시.
 * 실패해도 값을 지어내지 않고 실패 사실만 돌려준다.
 */
export async function lookupBook(
  isbn13: string,
  opts: {
    providers?: BibliographicProvider[];
    fetchImpl?: FetchLike;
    cache?: LookupCacheStore;
    disabled?: boolean;
    now?: number;
  } = {},
): Promise<LookupOutcome> {
  if (opts.disabled) return { status: "disabled" };
  const providers = (opts.providers ?? bibliographicProviders).filter((p) => p.isConfigured());
  const fetchImpl = opts.fetchImpl ?? fetch;
  const nowMs = opts.now ?? Date.now();
  const tried: string[] = [];
  const failures: string[] = [];

  for (const p of providers) {
    tried.push(p.label);
    const hit = opts.cache?.get(p.id, isbn13);
    if (hit && nowMs - Date.parse(hit.fetchedAt) < CACHE_TTL_MS) {
      const data = JSON.parse(hit.payload) as BookMetadata | null;
      if (data) return { status: "found", providerLabel: p.label, data, cached: true };
      continue;
    }
    try {
      const data = await withRetry(() => p.lookupByIsbn(isbn13, fetchImpl), 1);
      opts.cache?.set(p.id, isbn13, JSON.stringify(data));
      if (data) return { status: "found", providerLabel: p.label, data, cached: false };
    } catch (e) {
      const name = e instanceof Error ? e.name : "";
      failures.push(
        name === "TimeoutError" || name === "AbortError"
          ? `${p.label}: 응답 시간 초과`
          : `${p.label}: ${e instanceof Error && e.message.includes("응답") ? e.message : "연결하지 못했습니다"}`,
      );
    }
  }
  if (failures.length > 0 && failures.length === tried.length) {
    return { status: "error", message: failures.join(" / "), tried };
  }
  return { status: "not_found", tried };
}
