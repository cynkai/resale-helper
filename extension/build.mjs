// 확장 빌드: popup.ts와 extract.ts를 각각 한 파일로 묶고, 정적 파일을 dist/로 복사한다.
import { build } from "esbuild";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";

const outdir = process.argv[2] ?? "dist";
if (process.argv[2] === undefined) rmSync("dist", { recursive: true, force: true });
mkdirSync(outdir, { recursive: true });
await build({
  entryPoints: { popup: "src/popup.ts" },
  outdir,
  bundle: true,
  format: "iife",
  target: "chrome120",
  logLevel: "info",
});
// 반환값은 이 주입의 완료값으로 전달한다. 탭 전역에 중간 결과를 남기지 않는다.
await build({
  entryPoints: ["src/extract.ts"],
  outfile: path.join(outdir, "extract.js"),
  bundle: true,
  format: "iife",
  globalName: "clip",
  banner: { js: "(() => {" },
  footer: { js: "return clip.result; })();" },
  target: "chrome120",
  logLevel: "info",
});
cpSync("static", outdir, { recursive: true });
