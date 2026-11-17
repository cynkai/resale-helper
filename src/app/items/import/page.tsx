import Link from "next/link";
import { CsvImportForm } from "@/components/client-bits";
import { Section } from "@/components/ui";
import { ITEM_CSV_COLUMNS, ITEM_CSV_REQUIRED_HEADERS, MAX_ITEM_CSV_ROWS } from "@/lib/domain/items-csv";
import { CATEGORIES, CATEGORY_LABEL, CONDITIONS, CONDITION_LABEL, ITEM_STATUSES, ITEM_STATUS_LABEL } from "@/lib/domain/types";
import { isDemoMode } from "@/lib/mode";

export default async function ImportItemsPage() {
  const demo = await isDemoMode();
  const codes = <T extends string>(list: readonly T[], label: Record<T, string>) => list.map((c) => `${c}(${label[c]})`).join(", ");
  return (
    <div className="space-y-4">
      <p className="text-sm">
        <Link href="/" className="underline">← 내 물건</Link>
      </p>
      <h1 className="text-xl font-bold">물건 한꺼번에 등록 (CSV)</h1>
      <p className="notice">
        팔 물건이 많을 때 표로 정리해 둔 목록을 한 번에 등록합니다. 물건 정보만 들어가며 가격은 들어가지 않습니다. 가격 자료는 물건마다 직접 확인해
        넣어 주세요.
      </p>
      {demo ? <p className="warn">지금은 데모 모드입니다. 물건 가져오기는 실제 사용 모드에서만 됩니다.</p> : null}

      <Section id="format" title="파일 형식">
        <div className="space-y-2 text-sm">
          <p>
            첫 줄은 열 이름입니다. 필수 열: <code>{ITEM_CSV_REQUIRED_HEADERS.join(", ")}</code>. 한 번에 {MAX_ITEM_CSV_ROWS}행까지.
          </p>
          <p>
            쓸 수 있는 열: <code>{ITEM_CSV_COLUMNS.map((c) => c.header).join(", ")}</code>
          </p>
          <ul className="list-disc space-y-1 pl-5 text-stone-700">
            <li>category: {codes(CATEGORIES, CATEGORY_LABEL)}</li>
            <li>condition: {codes(CONDITIONS, CONDITION_LABEL)}. 물건 상태는 직접 보고 적어 주세요. 앱이 추정하지 않습니다.</li>
            <li>status(선택, 기본 OWNED): {codes(ITEM_STATUSES, ITEM_STATUS_LABEL)}</li>
            <li>identifier: 도서는 ISBN(검증 후 ISBN-13으로 저장), 그 외는 모델명</li>
            <li>has_writing 등 네 열(도서 전용): YES, NO, UNKNOWN. 비워 두면 모름</li>
            <li>카테고리·이름·식별자가 모두 같은 물건이 이미 있으면 그 행은 건너뜁니다(같은 파일을 다시 올려도 두 번 등록되지 않음).</li>
          </ul>
          <pre className="overflow-x-auto rounded bg-stone-100 p-2 text-xs">
            {`category,name,identifier,condition,edition,defects
BOOK,예시 도서 제목,9780306406157,GOOD,2판,
CONSOLE,예시 게임기,ABC-100,FAIR,,스틱 쏠림`}
          </pre>
          <p className="text-stone-700">오류가 있는 행은 건너뛰고 행 번호와 이유를 알려 드립니다.</p>
        </div>
      </Section>

      <Section id="upload" title="가져오기">
        <CsvImportForm />
      </Section>

      <p className="text-sm">
        <a href="/api/export/items" className="underline" download>
          지금 등록된 물건 목록을 CSV로 받기
        </a>{" "}
        — 같은 형식이라 다른 컴퓨터의 앱으로 옮길 때 쓸 수 있습니다(물건 정보만).
      </p>
    </div>
  );
}
