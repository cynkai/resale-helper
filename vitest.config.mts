import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
    // DB 테스트는 매번 새 SQLite 파일에 마이그레이션을 모두 적용한다. 느린 CI 러너에서 디스크가 밀리면
    // 기본 5초를 넘긴 적이 있어(동기 DB 작업뿐인 테스트) 여유를 둔다. 로컬에서는 전체가 1초 안에 끝난다.
    testTimeout: 20_000,
  },
});
