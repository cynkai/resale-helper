import { notFound } from "next/navigation";
import { ItemForm } from "@/components/ItemForm";
import { getDb } from "@/lib/db/client";
import { getItem } from "@/lib/db/repo";
import { isDemoMode } from "@/lib/mode";

export default async function EditItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const item = /^\d+$/.test(id) ? getItem(getDb(), await isDemoMode(), Number(id)) : undefined;
  if (!item) notFound();
  const initial: Record<string, string> = {};
  for (const [k, v] of Object.entries(item)) if (typeof v === "string") initial[k] = v;
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">물건 수정</h1>
      <div className="card">
        <ItemForm initial={initial} itemId={item.id} />
      </div>
    </div>
  );
}
