import type { Metadata } from "next";
import { getDb } from "@/lib/db/client";
import { getItem } from "@/lib/db/repo";
import { isDemoMode } from "@/lib/mode";

/** 물건 화면들의 탭 제목: "<물건 이름> <화면>". 없는 물건이면 화면 이름만. */
export async function itemTitle(params: Promise<{ id: string }>, screen?: string): Promise<Metadata> {
  const { id } = await params;
  const item = /^\d+$/.test(id) ? getItem(getDb(), await isDemoMode(), Number(id)) : undefined;
  const name = item?.name ?? "물건";
  return { title: screen ? `${name} ${screen}` : name };
}
