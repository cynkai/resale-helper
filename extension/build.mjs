// 확장 빌드: popup.ts와 extract.ts를 각각 한 파일로 묶고, 정적 파일을 dist/로 복사한다.
import { build } from "esbuild";
import { cpSync, mkdirSync, rmSync } from "node:fs";

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist", { recursive: true });
await build({
  entryPoints: { popup: "src/popup.ts", extract: "src/extract.ts" },
  outdir: "dist",
  bundle: true,
  format: "iife",
  target: "chrome120",
  logLevel: "info",
});
cpSync("static", "dist", { recursive: true });
