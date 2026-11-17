import path from "node:path";
import { deleteSnapshotAction, revokeImportTokenAction } from "@/app/actions";
import { ConfirmSubmit, ExtensionIdForm, ImportTokenForm, SnapshotButton } from "@/components/client-bits";
import { Badge, Section } from "@/components/ui";
import { getDb, resolveDbPath } from "@/lib/db/client";
import { listSnapshots, snapshotDir } from "@/lib/db/snapshots";
import { getImportSettings } from "@/lib/db/repo";
import { MAX_IMPORT_BODY_BYTES, MAX_IMPORT_RECORDS } from "@/lib/import/records";
import { isDemoMode } from "@/lib/mode";

export default async function SettingsPage() {
  const demo = await isDemoMode();
  const s = getImportSettings(getDb());
  const hasToken = s.tokenHash !== null;
  const dbPath = resolveDbPath();
  const snapshots = listSnapshots(dbPath);
  const snapshotFolder = path.relative(process.cwd(), snapshotDir(dbPath)) || snapshotDir(dbPath);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">설정</h1>
      {demo ? (
        <p className="warn">
          지금은 데모 모드지만, 아래 설정은 <strong>실제 사용 모드</strong>에 적용됩니다. 가져오기 API는 항상 실제 물건에만 저장합니다.
        </p>
      ) : null}

      <Section
        id="import-token"
        title="가져오기 토큰"
        aside={hasToken ? <Badge tone="teal">가져오기 API 켜짐</Badge> : <Badge>가져오기 API 꺼짐</Badge>}
      >
        <div className="space-y-3 text-sm">
          <p>
            브라우저 확장 “직접 담기”나 내가 만든 로컬 도구가 가격 자료를 넣을 때 쓰는 <code>POST /api/import/prices</code>의 열쇠입니다.
            토큰이 없으면 이 API는 꺼져 있습니다. 토큰은 만든 직후 한 번만 보이고, 앱에는 해시만 저장됩니다.
          </p>
          <p data-testid="token-status" className="text-stone-700">
            {hasToken ? `토큰 있음 (만든 시각: ${s.tokenCreatedAt ?? "기록 없음"} UTC)` : "토큰 없음"}
          </p>
          <div className="flex flex-wrap items-start gap-3">
            <ImportTokenForm hasToken={hasToken} />
            {hasToken ? (
              <form action={revokeImportTokenAction}>
                <ConfirmSubmit message="토큰을 폐기하면 가져오기 API가 꺼집니다. 계속할까요?">토큰 폐기</ConfirmSubmit>
              </form>
            ) : null}
          </div>
          <ul className="list-disc space-y-1 pl-5 text-stone-700">
            <li>토큰을 아는 로컬 프로그램은 내 물건 목록을 읽고 가격 자료를 추가할 수 있습니다. 필요 없으면 폐기해 두세요.</li>
            <li>
              이 API로는 <strong>검증된 체결가</strong>를 만들 수 없고, 판매자 정보 같은 가격 자료 외 필드는 받지 않습니다.
            </li>
            <li>
              한 번에 최대 {MAX_IMPORT_RECORDS}건, 본문 {Math.round(MAX_IMPORT_BODY_BYTES / 1000)}KB까지 받습니다.
            </li>
          </ul>
        </div>
      </Section>

      <Section id="import-extension" title="브라우저 확장 허용">
        <div className="space-y-3 text-sm">
          <p>
            일반 웹사이트에서 보낸 요청은 토큰이 맞아도 거부합니다. 브라우저에서 오는 요청은 여기에 등록한 확장 한 개만 허용합니다.
          </p>
          <ExtensionIdForm initial={s.extensionId} />
        </div>
      </Section>

      <Section id="snapshots" title="백업 사본">
        <div className="space-y-3 text-sm">
          <p>
            지금 DB 전체(실제 자료와 데모 자료, 휴지통 포함)의 사본을 이 컴퓨터의 <code>{snapshotFolder}</code> 폴더에 만듭니다. 버튼을 누를 때만
            만들고, 자동으로 만들거나 지우지 않습니다. 휴지통을 비우거나 자료를 많이 지우기 전에 만들어 두면 되돌릴 수 있습니다.
          </p>
          <SnapshotButton />
          {snapshots.length === 0 ? (
            <p className="text-stone-600" data-testid="snapshots-empty">아직 만든 사본이 없습니다.</p>
          ) : (
            <ul className="divide-y divide-stone-200" data-testid="snapshot-list">
              {snapshots.map((sn) => (
                <li key={sn.name} className="flex flex-wrap items-center gap-3 py-2">
                  <span>{sn.createdLabel}</span>
                  <code className="text-xs">{sn.name}</code>
                  <span className="text-stone-600">{Math.max(1, Math.round(sn.bytes / 1024))}KB</span>
                  <a href={`/api/backup/snapshots/${sn.name}`} className="underline" download>
                    내려받기
                  </a>
                  <form action={deleteSnapshotAction} className="ml-auto">
                    <input type="hidden" name="name" value={sn.name} />
                    <ConfirmSubmit message={`사본 ${sn.name}을(를) 지울까요? 되돌릴 수 없습니다.`} className="btn-danger px-2 py-1 text-xs">
                      사본 지우기
                    </ConfirmSubmit>
                  </form>
                </li>
              ))}
            </ul>
          )}
          <p className="text-stone-700">
            사본으로 되돌리려면 앱을 끈 뒤 터미널에서 <code>pnpm db:restore &lt;사본 파일 경로&gt;</code>를 실행합니다. 되돌리기 전의 DB는 따로 남겨 둡니다.
          </p>
        </div>
      </Section>
    </div>
  );
}
