import { ItemForm } from "@/components/ItemForm";

export default function NewItemPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">물건 등록</h1>
      <div className="card">
        <ItemForm initial={{ category: "BOOK", status: "OWNED" }} />
      </div>
    </div>
  );
}
