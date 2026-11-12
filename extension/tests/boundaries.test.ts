// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

describe("확장의 경계", () => {
  const manifest = JSON.parse(read("static/manifest.json")) as Record<string, unknown>;

  it("권한은 activeTab·scripting·storage뿐이고, host 권한은 로컬 앱 주소 하나다", () => {
    expect(manifest.permissions).toEqual(["activeTab", "scripting", "storage"]);
    expect(manifest.host_permissions).toEqual(["http://127.0.0.1:3000/*"]);
    expect(manifest.optional_permissions).toBeUndefined();
    expect(manifest.optional_host_permissions).toBeUndefined();
  });

  it("백그라운드 스크립트·콘텐츠 스크립트가 없다(사용자 클릭 없이 실행되는 코드 없음)", () => {
    expect(manifest.background).toBeUndefined();
    expect(manifest.content_scripts).toBeUndefined();
    const src = fs.readdirSync(path.join(root, "src"), { recursive: true }).map(String).filter((f) => f.endsWith(".ts"));
    for (const f of src) {
      const code = read(path.join("src", f));
      expect(code, f).not.toMatch(/chrome\.(alarms|webRequest|tabs\.(create|update|reload)|windows\.create)/);
      expect(code, f).not.toMatch(/setInterval\(/);
    }
  });

  it("페이지에 주입되는 코드(파서·extract)는 네트워크 요청을 하지 않는다", () => {
    const files = ["src/extract.ts", ...fs.readdirSync(path.join(root, "src/parsers")).map((f) => `src/parsers/${f}`)];
    for (const f of files) {
      expect(read(f), f).not.toMatch(/\bfetch\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource|import\(/);
    }
  });

  it("네트워크 요청은 api.ts에서 로컬 앱으로만 보낸다", () => {
    const src = fs.readdirSync(path.join(root, "src")).filter((f) => f.endsWith(".ts"));
    const withFetch = src.filter((f) => /\bfetch\(/.test(read(`src/${f}`)));
    expect(withFetch).toEqual(["api.ts"]);
    expect(read("src/api.ts")).toContain('export const APP_ORIGIN = "http://127.0.0.1:3000";');
    expect(read("src/api.ts")).toMatch(/fetch\(`\$\{APP_ORIGIN\}/);
  });
});
