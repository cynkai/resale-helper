import Link from "next/link";

export default function NotFound() {
  return (
    <div className="card py-10 text-center">
      <p className="font-medium">찾을 수 없는 화면입니다.</p>
      <p className="mt-1 text-sm text-stone-600">삭제된 물건이거나, 실제 사용/데모 모드가 달라 보이지 않는 물건일 수 있습니다.</p>
      <Link href="/" className="btn mt-4">내 물건으로 돌아가기</Link>
    </div>
  );
}
