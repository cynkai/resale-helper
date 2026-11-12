import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { lookupCache } from "@/lib/db/schema";
import { normalizeIsbn } from "@/lib/domain/isbn";
import { lookupBook, type LookupCacheStore } from "@/lib/providers/bibliographic";

// 서지정보(제목·저자·출판사) 조회 전용. 가격은 조회하지 않는다.
// 서버가 요청하는 주소는 코드에 고정된 제공자 API뿐이며, 사용자가 넣은 URL을 요청하지 않는다.
export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("isbn") ?? "";
  const isbn = normalizeIsbn(raw);
  if (!isbn.ok) return NextResponse.json({ status: "invalid", message: isbn.error }, { status: 400 });

  const db = getDb();
  const cache: LookupCacheStore = {
    get: (provider, key) =>
      db
        .select({ payload: lookupCache.payload, fetchedAt: lookupCache.fetchedAt })
        .from(lookupCache)
        .where(and(eq(lookupCache.provider, provider), eq(lookupCache.key, key)))
        .get(),
    set: (provider, key, payload) => {
      const fetchedAt = new Date().toISOString();
      db.insert(lookupCache)
        .values({ provider, key, payload, fetchedAt })
        .onConflictDoUpdate({ target: [lookupCache.provider, lookupCache.key], set: { payload, fetchedAt } })
        .run();
    },
  };
  const outcome = await lookupBook(isbn.isbn13, {
    cache,
    disabled: process.env.RESALE_DISABLE_EXTERNAL === "1",
  });
  return NextResponse.json({ ...outcome, isbn13: isbn.isbn13 });
}
