import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "@/lib/db/client";
import { seedDemo } from "@/lib/db/demo-seed";
import { clearDemo, deleteTemplate, listTemplates, saveTemplate } from "@/lib/db/repo";
import { buildFullExport } from "@/lib/domain/full-export";
import type { ListingItem } from "@/lib/domain/listing";
import { renderTemplate, TEMPLATE_TOKENS, validateTemplateInput } from "@/lib/domain/listing-template";

const consoleItem: ListingItem = {
  category: "CONSOLE",
  name: "가상 게임기",
  identifier: "ABC-1",
  condition: "GOOD",
  defects: "스틱 쏠림",
  components: null,
  author: null,
  publisher: null,
  edition: null,
  hasWriting: "UNKNOWN",
  hasUnderline: "UNKNOWN",
  hasDamage: "NO",
  hasSupplement: "UNKNOWN",
};

describe("템플릿 입력 검증", () => {
  it("이름과 본문은 필수이고 길이를 제한한다", () => {
    expect(validateTemplateInput({ name: " 채팅용 ", body: "{이름} 팝니다.\r\n상태: {상태}" })).toEqual({
      ok: true,
      value: { name: "채팅용", body: "{이름} 팝니다.\n상태: {상태}" },
    });
    const bad = validateTemplateInput({ name: "", body: "" });
    expect(bad.ok ? [] : Object.keys(bad.errors).sort()).toEqual(["body", "name"]);
    expect(validateTemplateInput({ name: "가".repeat(51), body: "x" }).ok).toBe(false);
    expect(validateTemplateInput({ name: "가", body: "x".repeat(2001) }).ok).toBe(false);
  });

  it("모르는 자리표시는 저장하지 않고 무엇이 틀렸는지 알려 준다", () => {
    const r = validateTemplateInput({ name: "가", body: "{이름} {시세} { 가격 } {판매자}" });
    expect(r.ok).toBe(false);
    const msg = r.ok ? "" : r.errors.body!;
    expect(msg).toContain("{시세}");
    expect(msg).toContain("{판매자}");
    expect(msg).not.toContain("{가격},");
  });

  it("시세·예상 판매가 같은 값을 만들어내는 자리표시는 없다", () => {
    expect(TEMPLATE_TOKENS.map((t) => t.name).sort()).toEqual(
      ["가격", "구성품", "밑줄", "부록", "상태", "식별", "이름", "저자", "출판사", "파손", "판본", "품목", "필기", "하자"].sort(),
    );
  });
});

describe("템플릿 채우기", () => {
  it("입력한 값으로 바꾸고, 값이 없는 자리표시가 든 줄은 통째로 뺀다", () => {
    const r = renderTemplate("{이름} ({식별}) 팝니다.\n상태: {상태}\n구성품: {구성품}\n필기 {필기}, 파손 {파손}\n\n\n희망 가격 {가격}\n직거래만 합니다.", consoleItem, 90000);
    expect(r.text).toBe("가상 게임기 (ABC-1) 팝니다.\n상태: 사용감 적음\n\n희망 가격 90,000원\n직거래만 합니다.");
    expect(r.dropped).toEqual([
      { line: "구성품: {구성품}", missing: ["구성품"] },
      { line: "필기 {필기}, 파손 {파손}", missing: ["필기"] },
    ]);
  });

  it("가격을 모르면 가격 줄을 빼고 0원으로 쓰지 않는다", () => {
    const r = renderTemplate("{이름}\n가격: {가격}", consoleItem, null);
    expect(r.text).toBe("가상 게임기");
    expect(r.text).not.toContain("0원");
    expect(r.dropped[0]!.missing).toEqual(["가격"]);
  });

  it("자리표시가 없는 줄은 내가 쓴 그대로 둔다", () => {
    expect(renderTemplate("택배 거래 환영\n{ 이름 }", consoleItem, null).text).toBe("택배 거래 환영\n가상 게임기");
  });
});

describe("템플릿 저장", () => {
  let tmpDir: string;
  let db: Db;
  let close: () => void;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "resale-tpl-"));
    ({ db, close } = openDb(path.join(tmpDir, "t.db")));
  });
  afterEach(() => {
    try {
      close();
    } catch {}
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("같은 모드에서 이름이 겹치면 저장하지 않고, 데모와 실제는 섞이지 않는다", () => {
    const a = saveTemplate(db, false, null, { name: "채팅용", body: "{이름}" });
    expect(a.ok).toBe(true);
    expect(saveTemplate(db, false, null, { name: "채팅용", body: "x" })).toEqual({ ok: false, reason: "DUPLICATE_NAME" });
    expect(saveTemplate(db, true, null, { name: "채팅용", body: "데모" }).ok).toBe(true);
    const id = a.ok ? a.id : -1;
    expect(saveTemplate(db, false, id, { name: "채팅용", body: "{이름} 팝니다" }).ok).toBe(true); // 자기 자신은 겹침이 아니다
    expect(saveTemplate(db, true, id, { name: "다른 이름", body: "x" })).toEqual({ ok: false, reason: "NOT_FOUND" }); // 다른 모드의 것은 못 고친다
    expect(listTemplates(db, false).map((t) => t.body)).toEqual(["{이름} 팝니다"]);
    deleteTemplate(db, true, id);
    expect(listTemplates(db, false)).toHaveLength(1);
  });

  it("데모 템플릿은 데모를 지우면 사라지고, 내보내기에는 현재 모드 것만 실린다", () => {
    saveTemplate(db, false, null, { name: "내 것", body: "{이름}" });
    seedDemo(db, "2026-11-17");
    expect(listTemplates(db, true)).toHaveLength(1);
    const out = buildFullExport({ demo: false, exportedDate: "2026-11-17", sources: [], templates: listTemplates(db, false) });
    expect(out.listingTemplates).toEqual([{ name: "내 것", body: "{이름}" }]);
    clearDemo(db);
    expect(listTemplates(db, true)).toHaveLength(0);
    expect(listTemplates(db, false)).toHaveLength(1);
  });
});
