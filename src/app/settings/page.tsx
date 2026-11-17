import type { Metadata } from "next";
import path from "node:path";
import { clearImportEventsAction, deleteSnapshotAction, revokeImportTokenAction } from "@/app/actions";
import { ConfirmSubmit, DbHealthButton, ExtensionIdForm, ImportTokenForm, SnapshotButton } from "@/components/client-bits";
import { Badge, Section } from "@/components/ui";
import { getDb, resolveDbPath } from "@/lib/db/client";
import { listSnapshots, snapshotDir } from "@/lib/db/snapshots";
import { getImportSettings } from "@/lib/db/repo";
import { countSuspiciousImportEvents, IMPORT_OUTCOME_LABEL, listImportEvents, MAX_IMPORT_EVENTS } from "@/lib/import/events";
import { MAX_IMPORT_BODY_BYTES, MAX_IMPORT_RECORDS } from "@/lib/import/records";
import { utcToSeoulDateTime } from "@/lib/domain/timeline";
import { isDemoMode } from "@/lib/mode";

export const metadata: Metadata = { title: "설정" };

export default async function SettingsPage() {
  const demo = await isDemoMode();
  const s = getImportSettings(getDb());
  const hasToken = s.tokenHash !== null;
  const events = listImportEvents(getDb(), 50);
  const suspicious = countSuspiciousImportEvents(getDb());
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

      <Section
        id="import-log"
        title="가져오기 API 사용 기록"
        aside={suspicious > 0 ? <Badge tone="red">거부된 수상한 요청 {suspicious}회</Badge> : undefined}
      >
        <div className="space-y-3 text-sm">
          <p>
            가져오기 API로 온 요청을 통과·거부 모두 남깁니다. 내가 쓰지 않은 시각에 요청이 있거나 모르는 Origin이 보이면 토큰을 폐기하고 새로 만들어
            주세요. 토큰과 요청 내용(가격·출처)은 기록하지 않고, 최근 {MAX_IMPORT_EVENTS}줄만 남깁니다.
          </p>
          {events.length === 0 ? (
            <p className="text-stone-600" data-testid="import-log-empty">아직 기록이 없습니다.</p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-sm" data-testid="import-log">
                  <thead className="text-xs text-stone-600">
                    <tr>
                      <th scope="col" className="py-1 pr-3 font-medium">시각(한국)</th>
                      <th scope="col" className="py-1 pr-3 font-medium">무엇을</th>
                      <th scope="col" className="py-1 pr-3 font-medium">결과</th>
                      <th scope="col" className="py-1 pr-3 font-medium">어디서</th>
                      <th scope="col" className="py-1 pr-3 font-medium">내용</th>
                    </tr>
                  </thead>
                  <tbody>
                    {events.map((ev) => (
                      <tr key={ev.id} className="border-t border-stone-200 align-top">
                        <td className="whitespace-nowrap py-1 pr-3">{utcToSeoulDateTime(ev.at)}</td>
                        <td className="whitespace-nowrap py-1 pr-3">{ev.endpoint === "prices" ? "가격 자료 넣기" : "물건 목록 읽기"}</td>
                        <td className={`py-1 pr-3 ${ev.outcome === "OK" ? "" : "text-red-900"}`}>
                          {IMPORT_OUTCOME_LABEL[ev.outcome]} ({ev.status}){ev.count > 1 ? ` × ${ev.count}회` : ""}
                        </td>
                        <td className="break-all py-1 pr-3">
                          {ev.origin ?? "로컬 도구(Origin 없음)"}
                          {ev.route ? ` · ${ev.route === "CLIP" ? "등록한 확장" : "외부 도구"}` : ""}
                        </td>
                        <td className="py-1 pr-3">
                          {ev.itemId !== null ? `물건 ${ev.itemId}번` : ""}
                          {ev.imported !== null ? ` · 저장 ${ev.imported}건, 거절 ${ev.rejected ?? 0}건` : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <form action={clearImportEventsAction}>
                <ConfirmSubmit message="가져오기 API 사용 기록을 모두 지울까요?" className="btn-danger px-2 py-1 text-xs">
                  기록 비우기
                </ConfirmSubmit>
              </form>
            </>
          )}
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

      <Section id="db-health" title="DB 점검">
        <div className="space-y-3 text-sm">
          <p>
            DB 파일이 손상되지 않았는지, 끊어진 참조가 없는지, 이 앱이 지키는 규칙(데모 자료 격리, 검증된 체결가는 직접 만들 수 없음, 방식마다 기준 계산
            하나 등)이 지켜지고 있는지 확인합니다. 읽기만 하고 아무것도 고치지 않습니다. 실제 자료와 데모 자료를 모두 봅니다.
          </p>
          <DbHealthButton />
        </div>
      </Section>
    </div>
  );
}
