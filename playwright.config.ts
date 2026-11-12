import { defineConfig, devices } from "@playwright/test";

// E2E는 개인 DB를 건드리지 않도록 별도 DB 파일(data/e2e.db)과 별도 포트를 사용한다.
const PORT = 3217;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  globalSetup: "./tests/e2e/global-setup.ts",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
    permissions: ["clipboard-read", "clipboard-write"],
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm exec next start -H 127.0.0.1 -p ${PORT}`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: { DATABASE_PATH: "./data/e2e.db", RESALE_DISABLE_EXTERNAL: "1" },
  },
});
