import { expect, test, type Page } from "@playwright/test";
import { parseCsv } from "../../src/lib/domain/csv";

// 핵심 흐름: 물건 등록 → 가격 자료 추가 → 비교·비용 입력 → 판매 방법 저장 → 판매글 복사 → 판매 결과 기록
test.describe.configure({ mode: "serial" });

let itemUrl = "";

async function addPrice(page: Page, f: { type: string; amount: string; source: string; externalId?: string; memo?: string }) {
  await page.getByRole("link", { name: "가격 자료 추가" }).click();
  await expect(page.getByRole("heading", { name: "가격 자료 추가" })).toBeVisible();
  await page.locator("#priceType").selectOption(f.type);
  await page.locator("#amount").fill(f.amount);
  await page.locator("#sourceName").fill(f.source);
  if (f.externalId) {
    await page.getByText("추가 정보 (선택)").click();
    await page.locator("#externalId").fill(f.externalId);
  }
  if (f.memo) await page.locator("#memo").fill(f.memo);
  await page.getByRole("button", { name: "가격 자료 저장" }).click();
}

test("물건 등록: 잘못된 ISBN은 필드 옆에 오류를 보여주고, 올바른 ISBN은 정규화해 저장한다", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("아직 등록한 물건이 없습니다.")).toBeVisible();
  await page.getByRole("link", { name: "첫 물건 등록하기" }).click();

  await page.locator("#identifier").fill("9780306406150");
  await page.locator("#name").fill("선형대수학 입문");
  await page.locator("#condition").selectOption("GOOD");
  await page.getByRole("button", { name: "저장" }).click();
  await expect(page.locator("#identifier-error")).toContainText("체크섬");
  await expect(page.locator("#name")).toHaveValue("선형대수학 입문"); // 입력값 유지

  await page.locator("#identifier").fill("0-306-40615-2");
  await page.locator("#edition").fill("2판");
  await page.locator("#hasWriting").selectOption("YES");
  await page.locator("#defects").fill("표지 구김");
  await page.getByRole("button", { name: "저장" }).click();

  await expect(page).toHaveURL(/\/items\/\d+$/);
  itemUrl = page.url();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("선형대수학 입문");
  await expect(page.locator("#info")).toContainText("9780306406157");
  await expect(page.locator("#prices")).toContainText("가격 자료 없음");
});

test("서지정보 응답을 기다리며 직접 고친 제목을 보존한다", async ({ page }) => {
  const lookupStarted = Promise.withResolvers<void>();
  const reply = Promise.withResolvers<void>();
  await page.route("**/api/books/lookup?*", async (route) => {
    lookupStarted.resolve();
    await reply.promise;
    await route.fulfill({ json: {
      status: "found", isbn13: "9780306406157", providerLabel: "테스트 서지정보",
      data: { title: "조회된 제목", author: "조회된 저자", publisher: null, edition: null },
    } });
  });
  await page.goto("/items/new");
  await page.getByLabel("ISBN", { exact: true }).fill("0-306-40615-2");
  await page.getByRole("button", { name: "서지정보 조회" }).click();
  await lookupStarted.promise;
  await page.locator("#name").fill("내가 확인한 제목");
  reply.resolve();
  await expect(page.locator("#author")).toHaveValue("조회된 저자");
  await expect(page.locator("#name")).toHaveValue("내가 확인한 제목");
});

test("가격 자료: 유형별로 나뉘고, 중복·검증된 체결가 직접 입력을 막는다", async ({ page }) => {
  await page.goto(itemUrl);

  // 직접 입력 폼에는 '검증된 체결가' 선택지가 없다
  await page.getByRole("link", { name: "가격 자료 추가" }).click();
  await expect(page.locator("#priceType option")).toHaveText([
    "판매 중 희망가",
    "판매완료 게시가",
    "매입 견적",
    "직접 입력한 거래가",
  ]);
  await page.goto(itemUrl);

  await addPrice(page, { type: "ASKING", amount: "18000", source: "테스트마켓", externalId: "T-1" });
  await addPrice(page, { type: "ASKING", amount: "20000", source: "테스트마켓", externalId: "T-2" });
  // 2건뿐일 때는 요약 가격을 내지 않는다
  await expect(page.getByTestId("nosummary-ASKING")).toContainText("2건뿐");

  // 같은 매물(출처 ID 동일)은 거부
  await addPrice(page, { type: "ASKING", amount: "19000", source: "테스트마켓", externalId: "T-2" });
  await expect(page.getByRole("alert").first()).toContainText("이미 등록된 매물");
  await page.goto(itemUrl);

  // 금액이 같아도 다른 매물이면 저장
  await addPrice(page, { type: "ASKING", amount: "20000", source: "테스트마켓", externalId: "T-3" });
  await expect(page.getByTestId("summary-ASKING")).toContainText("판매 중 희망가 중앙값 20,000원");
  await expect(page.getByTestId("summary-ASKING")).toContainText("18,000원 ~ 20,000원");
  await expect(page.getByTestId("summary-ASKING")).toContainText("3건 기준");

  // URL 없는 매입 견적은 메모가 필요
  await addPrice(page, { type: "BUYBACK_QUOTE", amount: "7000", source: "테스트서점" });
  await expect(page.locator("#memo-error")).toContainText("메모");
  await page.locator("#memo").fill("매장 방문 견적");
  await page.getByRole("button", { name: "가격 자료 저장" }).click();
  await expect(page).toHaveURL(/\/items\/\d+#prices$/);

  // 매입 견적은 희망가 요약에 섞이지 않는다
  await expect(page.getByTestId("summary-ASKING")).toContainText("3건 기준");
  await expect(page.getByTestId("nosummary-BUYBACK_QUOTE")).toContainText("1건뿐");
  await expect(page.locator("#prices")).toContainText("실제 판매·매입 금액을 보장하지 않으며");
  await expect(page.locator("body")).not.toContainText("실거래 평균");
});

test("실수령액: 미입력 비용은 계산 불완전, 0원은 계산 완료로 구분하고 차액을 비교한다", async ({ page }) => {
  await page.goto(itemUrl);
  const buyback = page.getByTestId("scenario-BUYBACK");
  const direct = page.getByTestId("scenario-DIRECT");

  await buyback.locator("#buyback-basis").selectOption({ index: 1 });
  await expect(buyback.locator("#buyback-saleAmount")).toHaveValue("7000");
  for (const f of ["feeAmount", "shipping", "packing", "transport"]) await buyback.locator(`#buyback-${f}`).fill("0");
  await buyback.getByRole("button", { name: "금액·비용 저장" }).click();
  await expect(page.getByTestId("net-BUYBACK")).toHaveText("7,000원");
  await expect(buyback).toContainText("매입 견적 기준");

  await direct.locator("#direct-saleAmount").fill("19000");
  await direct.getByLabel("비율(%)").check();
  await direct.locator("#direct-feeRate").fill("3.5");
  await direct.locator("#direct-packing").fill("500");
  await direct.locator("#direct-transport").fill("0");
  await direct.getByRole("button", { name: "금액·비용 저장" }).click();
  await expect(direct.getByText("저장했습니다.")).toBeVisible(); // 저장이 끝난 뒤 다음 입력
  await expect(page.getByTestId("net-DIRECT")).toHaveText("계산 불완전");
  await expect(direct).toContainText("판매자 부담 배송비");
  await expect(page.getByTestId("net-diff")).toContainText("계산하지 않았습니다");

  await direct.locator("#direct-shipping").fill("3500");
  await direct.getByRole("button", { name: "금액·비용 저장" }).click();
  // 19,000 − 665(3.5%) − 3,500 − 500 − 0 = 14,335
  await expect(page.getByTestId("net-DIRECT")).toHaveText("14,335원");
  await expect(page.getByTestId("net-diff")).toContainText("7,335원 더 많습니다");
});

test("판매 방법 저장 → 판매글 복사 → 판매 결과 기록", async ({ page }) => {
  await page.goto(itemUrl);
  await page.getByRole("button", { name: "개인에게 직접 판매로 정하기" }).click();
  await expect(page.getByTestId("chosen")).toContainText("개인에게 직접 판매");
  await expect(page.getByTestId("chosen")).toContainText("14,335원");

  // 판매글: 입력한 사실만 들어가고, 입력하지 않은 내용은 없다
  const body = page.getByTestId("draft-body");
  await expect(body).toContainText("판본: 2판");
  await expect(body).toContainText("필기: 있음");
  await expect(body).toContainText("하자: 표지 구김");
  await expect(body).toContainText("희망 가격: 19,000원");
  await expect(body).not.toContainText("밑줄");
  await expect(page.getByTestId("draft-compact")).toContainText("판본: 2판 / ");
  await expect(page.getByTestId("draft-compact")).not.toContainText("밑줄");
  await page.getByRole("button", { name: "제목+본문 복사" }).click();
  await expect(page.getByText("복사했습니다")).toBeVisible();
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toContain("선형대수학 입문 2판");
  expect(clip).toContain("ISBN: 9780306406157");

  // 판매 결과
  await page.locator("#result-channel").fill("직거래");
  await page.locator("#result-amount").fill("18000");
  await page.locator("#result-costTotal").fill("4000");
  await page.locator("#result-minutesSpent").fill("50");
  await page.getByRole("button", { name: "판매 결과 저장" }).click();
  const summary = page.getByTestId("result-summary");
  await expect(summary).toContainText("내가 기록한 결과 · 외부 검증 아님");
  await expect(page.getByTestId("result-diff")).toContainText("19,000원 → 실제 18,000원 (-1,000원)");
  await expect(page.getByTestId("result-diff")).toContainText("14,335원 → 실제 14,000원 (-335원)");

  // 새로 고침해도 유지되고, 목록에서 판매 완료로 보인다
  await page.reload();
  await expect(page.getByTestId("result-summary")).toContainText("18,000원");
  await page.goto("/");
  await expect(page.getByRole("link", { name: /선형대수학 입문/ })).toContainText("판매 완료");
  await expect(page.getByRole("link", { name: /선형대수학 입문/ })).toContainText("가격 자료 4건");
});

test("CSV: 오류 행은 행 번호와 함께 건너뛰고, 내보내기에는 실제 자료만 담긴다", async ({ page }) => {
  await page.goto(itemUrl);
  await page.getByText("CSV로 한꺼번에 가져오기").click();
  const csv = [
    "price_type,amount,source_name,external_id,checked_date,is_demo,item_name",
    "SOLD_LISTING,16000,테스트마켓,S-1,2026-01-05,false,",
    "VERIFIED_SALE,16000,테스트마켓,S-2,2026-01-05,false,",
    "ASKING,1.5만,테스트마켓,S-3,2026-01-05,false,",
    "ASKING,12000,테스트마켓,S-4,2026-01-05,false,다른 책",
    "ASKING,13000,테스트마켓,S-5,2026-01-05,true,",
  ].join("\n");
  await page.locator("#csv-file").setInputFiles({ name: "prices.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.getByRole("button", { name: "가져오기" }).click();
  await expect(page.getByText("1건을 가져왔고, 4건은 오류로 건너뛰었습니다.")).toBeVisible();
  await expect(page.locator("#prices")).toContainText("3행");
  await expect(page.locator("#prices")).toContainText("4행");
  await expect(page.locator("#prices")).toContainText("다른 책");
  await expect(page.locator("#prices")).toContainText("데모 자료");
  await expect(page.getByTestId("group-SOLD_LISTING")).toContainText("CSV 가져오기");

  const res = await page.request.get(`/api/export/prices`);
  expect(res.headers()["content-disposition"]).toContain("prices-all-");
  const text = await res.text();
  expect(text).toContain("price_type,amount,currency");
  expect(text.trim().split("\r\n")).toHaveLength(6); // 머리글 + 5건
  const [columns = [], ...records] = parseCsv(text);
  expect(records.map((row) => row[columns.indexOf("is_demo")])).toEqual(Array(5).fill("false"));
});

test("데모는 명시적으로 들어가야 하고, 가상 데이터 표시가 붙으며 실제 자료와 섞이지 않는다", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("데모 모드")).toHaveCount(0);
  await page.getByRole("button", { name: /데모 보기/ }).click();

  await expect(page.getByRole("status").filter({ hasText: "데모 모드" })).toContainText("가상 데이터");
  await expect(page.getByRole("link", { name: /선형대수학 입문/ })).toHaveCount(0);
  // 데모 자료에는 만료된 견적이 있어 목록에서 점검으로 가는 안내가 보인다
  // (만료된 견적이 있는 물건 1개 + 답하지 않은 제안이 있는 물건 1개)
  await expect(page.getByTestId("checkup-link")).toHaveText("다시 확인할 물건 2개");
  const demoLink = page.getByRole("link", { name: /\(데모\) 가상 전공서/ });
  await expect(demoLink).toContainText("가상 데이터");
  await demoLink.click();
  await expect(page.getByRole("status").filter({ hasText: "데모 모드" })).toBeVisible();
  await expect(page.getByTestId("group-BUYBACK_QUOTE")).toContainText("견적 유효기간 만료");
  await expect(page.getByTestId("net-DIRECT")).toHaveText("계산 불완전");

  // 데모 모드에서는 실제 물건 주소로 들어갈 수 없고, 내보내기는 데모 자료만 담는다
  const real = await page.request.get(itemUrl);
  expect(real.status()).toBe(404);
  const demoCsv = await (await page.request.get("/api/export/prices")).text();
  expect(demoCsv).not.toContain("테스트마켓");
  expect(demoCsv).toContain("가상마켓");

  await page.getByRole("button", { name: "실제 사용으로 돌아가기" }).click();
  await expect(page.getByText("데모 모드")).toHaveCount(0);
  await expect(page.getByRole("link", { name: /선형대수학 입문/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /\(데모\)/ })).toHaveCount(0);
  const realCsv = await (await page.request.get("/api/export/prices")).text();
  expect(realCsv).not.toContain("가상마켓");
});

test("기준 가격 자료가 바뀌면 저장된 계산을 경고하고, 그 방법은 다시 저장하기 전까지 선택할 수 없다", async ({ page }) => {
  await page.goto(itemUrl);
  await page.getByRole("row", { name: /테스트서점/ }).getByRole("link", { name: "수정" }).click();
  await page.locator("#amount").fill("6500");
  await page.getByRole("button", { name: "가격 자료 저장" }).click();
  await expect(page).toHaveURL(/#prices$/);

  await expect(page.getByTestId("basis-issues-BUYBACK")).toContainText("금액이 저장 후 바뀌었습니다");
  await expect(page.getByRole("button", { name: /업체에 판매\(매입\)/ })).toBeDisabled();
  await expect(page.getByTestId("net-diff")).toContainText("기준 가격 자료가 바뀌었거나");

  // 기준 금액을 다시 고르고 저장하면 경고가 사라진다
  const buyback = page.getByTestId("scenario-BUYBACK");
  await buyback.locator("#buyback-basis").selectOption({ index: 1 });
  await expect(buyback.locator("#buyback-saleAmount")).toHaveValue("6500");
  await buyback.getByRole("button", { name: "금액·비용 저장" }).click();
  await expect(buyback.getByText("저장했습니다.")).toBeVisible();
  await expect(page.getByTestId("basis-issues-BUYBACK")).toHaveCount(0);
  await expect(page.getByTestId("net-diff")).toContainText("7,835원 더 많습니다");
  // 손익분기: 업체 실수령액과 같아지는 개인 판매금액(입력한 비용으로 한 산수)
  await expect(page.getByTestId("break-even")).toContainText("이상일 때 업체 판매와 실수령액이 같거나");

  // 이미 고른 방법(개인 판매)의 비용을 바꾸면 선택 당시 숫자와 다르다고 알린다
  await expect(page.getByTestId("choice-outdated")).toHaveCount(0);
  const direct = page.getByTestId("scenario-DIRECT");
  await direct.locator("#direct-shipping").fill("4000");
  await direct.getByRole("button", { name: "금액·비용 저장" }).click();
  await expect(direct.getByText("저장했습니다.")).toBeVisible();
  await expect(page.getByTestId("choice-outdated")).toBeVisible();
  await page.getByRole("button", { name: /개인에게 직접 판매/ }).click();
  await expect(page.getByTestId("choice-outdated")).toHaveCount(0);
  await expect(page.getByTestId("chosen")).toContainText("13,835원");
});

test("localhost가 아닌 Host로 들어온 요청은 거부한다(DNS 리바인딩 방어)", async ({ request }) => {
  const evil = await request.get("/api/export/prices", { headers: { Host: "evil.example:3217" } });
  expect(evil.status()).toBe(403);
  expect(await evil.text()).not.toContain("price_type");
  const ok = await request.get("/api/export/prices", { headers: { Host: "localhost:3217" } });
  expect(ok.status()).toBe(200);
});

test("보안 헤더: CSP는 nonce로만 스크립트를 허용하고, 화면들이 CSP 위반 없이 동작한다", async ({ page, request }) => {
  const res = await request.get("/");
  const h = res.headers();
  const csp = h["content-security-policy"] ?? "";
  expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
  expect(csp).not.toContain("'unsafe-eval'");
  expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("object-src 'none'");
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["x-frame-options"]).toBe("DENY");
  expect(h["referrer-policy"]).toBe("no-referrer");
  // nonce는 요청마다 다르다
  const csp2 = (await request.get("/")).headers()["content-security-policy"] ?? "";
  expect(csp2.match(/nonce-[^']+/)?.[0]).not.toBe(csp.match(/nonce-[^']+/)?.[0]);
  // API 응답과 거부 응답에도 붙는다
  expect((await request.get("/api/export/prices")).headers()["x-content-type-options"]).toBe("nosniff");
  const evil = await request.get("/", { headers: { Host: "evil.example:3217" } });
  expect(evil.status()).toBe(403);
  expect(evil.headers()["x-frame-options"]).toBe("DENY");

  const violations: string[] = [];
  page.on("console", (m) => {
    if (/Content Security Policy|CSP/i.test(m.text())) violations.push(m.text());
  });
  page.on("pageerror", (e) => violations.push(String(e)));
  for (const path of ["/", "/triage", "/checkup", "/results", "/settings", "/items/new", itemUrl]) {
    await page.goto(path);
    await expect(page.getByRole("link", { name: "얼마에 팔까" })).toBeVisible();
  }
  expect(violations).toEqual([]);
});

test("판매 결과 돌아보기: 선택 당시 예상과 실제를 물건별로 비교한다", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "판매 결과", exact: true }).click();
  await expect(page.getByRole("heading", { name: "판매 결과 돌아보기" })).toBeVisible();
  await expect(page.getByTestId("review-counts")).toContainText("기록 1건");
  await expect(page.getByTestId("review-counts")).toContainText("많음 1건");
  const row = page.locator('[data-testid^="review-"]').filter({ hasText: "선형대수학 입문" });
  // 판매금액 19,000 → 18,000, 실수령액 예상 13,835(재선택 후) → 실제 18,000 − 4,000 = 14,000
  await expect(row).toContainText("19,000원 → 18,000원");
  await expect(row).toContainText("-1,000원");
  await expect(row).toContainText("13,835원 → 14,000원");
  await expect(row).toContainText("+165원");
  await expect(row).toContainText("모름 → 50분");
  // 요약은 건수만 보여 주고 금액을 합치지 않는다
  await expect(page.getByTestId("review-counts")).not.toContainText("원");
  await expect(page.getByTestId("time-counts")).toContainText("비교 불가 1건"); // 어림 시간을 적지 않았다
  // 묶어 보기도 건수만
  const groups = page.getByTestId("review-groups");
  await expect(groups.getByRole("heading", { name: "카테고리별" })).toBeVisible();
  await expect(groups.getByRole("row", { name: /도서/ })).toContainText("1");
  await expect(groups).not.toContainText("원");
});

test("자료 점검: 만료된 견적과 다시 확인할 계산을 물건별로 모아 보여 준다", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "점검", exact: true }).click();
  await expect(page.getByRole("heading", { name: "자료 점검" })).toBeVisible();
  // 금액 합계는 없다. 건수만 요약한다.
  const counts = page.getByTestId("checkup-counts");
  if (await counts.count()) await expect(counts).toContainText("손볼 물건");
  else await expect(page.getByTestId("checkup-empty")).toBeVisible();
});

test("전체 백업 파일을 SQLite 형식으로 내려받는다", async ({ page }) => {
  await page.goto("/");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "전체 자료 백업 파일(.db) 받기" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^resale-backup-\d{4}-\d{2}-\d{2}\.db$/);
  const res = await page.request.get("/api/backup");
  expect(res.headers()["cache-control"]).toBe("no-store");
  const body = await res.body();
  expect(body.subarray(0, 16).toString("latin1")).toBe("SQLite format 3\u0000");
});

test("읽을 수 있는 전체 내보내기(JSON)를 현재 모드 자료로만 내려받는다", async ({ page }) => {
  await page.goto("/");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "읽을 수 있는 전체 내보내기(.json) 받기" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^resale-export-\d{4}-\d{2}-\d{2}\.json$/);
  const res = await page.request.get("/api/export/all");
  expect(res.headers()["cache-control"]).toBe("no-store");
  const body = (await res.json()) as { format: string; mode: string; itemCount: number; items: { id: number }[] };
  expect(body.format).toBe("resale-helper-export");
  expect(body.mode).toBe("REAL");
  expect(body.items).toHaveLength(body.itemCount);
  expect(JSON.stringify(body)).not.toMatch(/token/i);
});

test("물건 배분: 물건마다 직접 판매·업체·판단 보류를 나누고, 건수만 요약한다", async ({ page }) => {
  // 물건 2개 등록 + 각각 업체·직접 판매 금액과 비용 입력
  async function addItem(name: string, direct: { amount: string; minutes: string; buybackMinutes: string }) {
    await page.goto("/items/new");
    await page.locator("#category").selectOption("CONSOLE");
    await page.locator("#name").fill(name);
    await page.locator("#condition").selectOption("GOOD");
    await page.getByRole("button", { name: "저장" }).click();
    await expect(page).toHaveURL(/\/items\/\d+$/);
    const id = page.url().split("/").pop()!;

    const buyback = page.getByTestId("scenario-BUYBACK");
    await buyback.locator("#buyback-saleAmount").fill("5000");
    for (const f of ["feeAmount", "shipping", "packing", "transport"]) await buyback.locator(`#buyback-${f}`).fill("0");
    await buyback.locator("#buyback-expectedMinutes").fill(direct.buybackMinutes);
    await buyback.getByRole("button", { name: "금액·비용 저장" }).click();
    await expect(buyback.getByText("저장했습니다.")).toBeVisible();

    const d = page.getByTestId("scenario-DIRECT");
    await d.locator("#direct-saleAmount").fill(direct.amount);
    for (const f of ["feeAmount", "shipping", "packing", "transport"]) await d.locator(`#direct-${f}`).fill("0");
    await d.locator("#direct-expectedMinutes").fill(direct.minutes);
    await d.getByRole("button", { name: "금액·비용 저장" }).click();
    await expect(d.getByText("저장했습니다.")).toBeVisible();
    return id;
  }
  const fast = await addItem("배분 테스트 게임기", { amount: "20000", minutes: "80", buybackMinutes: "20" }); // +15,000원 / (80−20)분
  const slow = await addItem("배분 테스트 공유기", { amount: "8000", minutes: "120", buybackMinutes: "0" }); // +3,000원 / 2시간

  await page.goto("/");
  await page.getByRole("link", { name: "어디로 넘길까 (배분)" }).click();
  await expect(page.getByRole("heading", { name: "물건 배분" })).toBeVisible();

  // 판매 완료한 물건은 빠진다
  await expect(page.locator("main")).not.toContainText("선형대수학 입문");
  // 시간당 가치를 정하기 전에는 판단을 보류하되 시간당 추가 수익은 보여 준다
  await expect(page.getByTestId(`verdict-${fast}`)).toHaveText("판단 보류");
  await expect(page.getByTestId(`per-hour-${fast}`)).toHaveText("15,000원/시간");
  await expect(page.getByTestId(`per-hour-${slow}`)).toHaveText("1,500원/시간");
  await expect(page.getByTestId(`reasons-${fast}`)).toContainText("시간당 가치를 입력하면");
  await expect(page.getByTestId(`reasons-${fast}`)).toContainText("직접 어림한 금액 기준");

  await page.locator("#timeValuePerHour").fill("-1");
  await page.getByRole("button", { name: "시간당 가치 저장" }).click();
  await expect(page.locator("#timeValuePerHour-error")).toContainText("0 이상의 정수");

  await page.locator("#timeValuePerHour").fill("10000");
  await page.getByRole("button", { name: "시간당 가치 저장" }).click();
  await expect(page.getByTestId(`verdict-${fast}`)).toHaveText("직접 판매");
  await expect(page.getByTestId(`verdict-${slow}`)).toHaveText("업체에 넘기기");
  await expect(page.locator('[data-testid^="lines-"]').first()).toContainText("이상이면 업체와 실수령액이 같거나 많음");
  const counts = page.getByTestId("triage-counts");
  await expect(counts).toContainText("직접 판매 1개");
  await expect(counts).toContainText("업체 1개");
  // 금액 합계를 만들지 않는다(기준 시간당 가치 문구 외에는 금액 없음)
  await expect(counts.locator("p").first()).not.toContainText("원");

  // 0원은 "모름"이 아니라 시간을 공짜로 본다는 뜻: 더 받는 물건은 모두 직접 판매
  await page.locator("#timeValuePerHour").fill("0");
  await page.getByRole("button", { name: "시간당 가치 저장" }).click();
  await expect(page.getByTestId(`verdict-${slow}`)).toHaveText("직접 판매");

  // 비우면 다시 모름 → 보류. 새로 고쳐도 유지된다
  await page.locator("#timeValuePerHour").fill("");
  await page.getByRole("button", { name: "시간당 가치 저장" }).click();
  await expect(page.getByText("비워 두었습니다(모름)")).toBeVisible();
  await page.reload();
  await expect(page.locator("#timeValuePerHour")).toHaveValue("");
  await expect(page.getByTestId(`verdict-${slow}`)).toHaveText("판단 보류");
  await expect(page.locator("main")).toContainText("실제 판매·매입 금액을 보장하지 않으며");
});

test("가격 자료를 고치면 바뀌기 전 값이 '이전 값'으로 남는다", async ({ page }) => {
  await page.goto("/items/new");
  await page.locator("#category").selectOption("ELECTRONICS");
  await page.locator("#name").fill("가격 변동 확인용 기기");
  await page.locator("#condition").selectOption("GOOD");
  await page.getByRole("button", { name: "저장" }).click();
  await page.waitForURL(/\/items\/\d+$/);
  await addPrice(page, { type: "ASKING", amount: "20000", source: "가상장터", externalId: "hist-1" });
  await expect(page.locator('[data-testid^="price-history-"]')).toHaveCount(0);
  // 오늘 확인한 자료에는 "오늘 다시 확인함" 단추가 없다
  const priceRow = page.getByRole("row").filter({ hasText: "가상장터" });
  await expect(priceRow.getByText("오늘 확인", { exact: true })).toBeVisible();
  await expect(priceRow.getByRole("button", { name: "오늘 다시 확인함" })).toHaveCount(0);

  await page.getByRole("link", { name: "수정", exact: true }).click();
  await page.locator("#amount").fill("17000");
  await page.getByRole("button", { name: "가격 자료 저장" }).click();
  await page.waitForURL(/\/items\/\d+(#prices)?$/);
  const hist = page.locator('[data-testid^="price-history-"]');
  await expect(hist).toHaveCount(1);
  await hist.locator("summary").click();
  await expect(hist).toContainText("20,000원");
  await expect(page.getByText("17,000원").first()).toBeVisible();
});

test("가져오기 API: 토큰이 없으면 꺼져 있고, 토큰·Origin 검사를 통과한 요청만 저장한다", async ({ page }) => {
  await page.goto("/items/new");
  await page.locator("#category").selectOption("ELECTRONICS");
  await page.locator("#name").fill("가져오기 테스트 키보드");
  await page.locator("#condition").selectOption("GOOD");
  await page.getByRole("button", { name: "저장" }).click();
  await expect(page).toHaveURL(/\/items\/\d+$/);
  const itemId = Number(page.url().split("/").pop());

  const body = {
    itemId,
    records: [
      { price_type: "ASKING", amount: 30000, source_name: "테스트마켓", external_id: "IMP-1", checked_date: "2026-01-05" },
      { price_type: "VERIFIED_SALE", amount: 30000, source_name: "테스트마켓", external_id: "IMP-2", checked_date: "2026-01-05" },
    ],
  };
  const post = (headers: Record<string, string>) => page.request.post("/api/import/prices", { data: body, headers });

  // 기본 상태: 토큰이 없어 API가 꺼져 있다
  await page.goto("/settings");
  await expect(page.getByTestId("token-status")).toHaveText("토큰 없음");
  expect((await post({ Authorization: "Bearer rh_guess" })).status()).toBe(403);

  await page.getByRole("button", { name: "토큰 만들기" }).click();
  const token = (await page.getByTestId("token-value").textContent())!.trim();
  expect(token).toMatch(/^rh_[A-Za-z0-9_-]{43}$/);
  await expect(page.getByTestId("token-status")).toContainText("토큰 있음");
  // 새로 고치면 토큰 원문은 다시 볼 수 없다
  await page.reload();
  await expect(page.getByTestId("token-value")).toHaveCount(0);
  expect(await page.content()).not.toContain(token);

  expect((await post({})).status()).toBe(401);
  expect((await post({ Authorization: "Bearer rh_wrong" })).status()).toBe(401);
  // 일반 웹사이트에서 온 요청은 토큰이 맞아도 거부하고 CORS 헤더를 주지 않는다
  const web = await post({ Authorization: `Bearer ${token}`, Origin: "https://evil.example" });
  expect(web.status()).toBe(403);
  expect(web.headers()["access-control-allow-origin"]).toBeUndefined();
  const pre = await page.request.fetch("/api/import/prices", { method: "OPTIONS", headers: { Origin: "https://evil.example" } });
  expect(pre.status()).toBe(403);

  const ok = await post({ Authorization: `Bearer ${token}` });
  expect(ok.status()).toBe(200);
  const json = await ok.json();
  expect(json.imported).toBe(1);
  expect(json.results[1]).toMatchObject({ index: 1, ok: false });
  expect(JSON.stringify(json)).not.toContain(token);

  const list = await page.request.get("/api/import/items?q=키보드", { headers: { Authorization: `Bearer ${token}` } });
  expect((await list.json()).items).toEqual([expect.objectContaining({ id: itemId, name: "가져오기 테스트 키보드" })]);
  expect((await page.request.get("/api/import/items")).status()).toBe(401);

  await page.goto(`/items/${itemId}`);
  await expect(page.locator("#prices")).toContainText("외부 도구 가져오기");
  await expect(page.locator("#prices")).toContainText("30,000원");
  await expect(page.locator("#prices")).not.toContainText("검증된 체결가 중앙값");

  // 등록한 확장 origin은 허용하고 입력 경로를 '확장으로 직접 담기'로 남긴다
  const ext = "abcdefghijklmnopabcdefghijklmnop";
  await page.goto("/settings");
  await page.locator("#extensionId").fill("not-an-id");
  await page.getByRole("button", { name: "확장 ID 저장" }).click();
  await expect(page.locator("#extensionId-error")).toContainText("32자");
  await page.locator("#extensionId").fill(ext);
  await page.getByRole("button", { name: "확장 ID 저장" }).click();
  await expect(page.getByText("저장했습니다.")).toBeVisible();
  const clip = await page.request.post("/api/import/prices", {
    data: { itemId, records: [{ price_type: "SOLD_LISTING", amount: 28000, source_name: "테스트마켓", external_id: "IMP-3", checked_date: "2026-01-05" }] },
    headers: { Authorization: `Bearer ${token}`, Origin: `chrome-extension://${ext}` },
  });
  expect(clip.status()).toBe(200);
  expect(clip.headers()["access-control-allow-origin"]).toBe(`chrome-extension://${ext}`);
  await page.goto(`/items/${itemId}`);
  await expect(page.locator("#prices")).toContainText("확장으로 직접 담기");

  // 폐기하면 다시 꺼진다
  await page.goto("/settings");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "토큰 폐기" }).click();
  await expect(page.getByTestId("token-status")).toHaveText("토큰 없음");
  expect((await post({ Authorization: `Bearer ${token}` })).status()).toBe(403);

  // 사용 기록: 통과한 요청과 거부한 요청이 모두 남고, 토큰은 어디에도 보이지 않는다
  await page.goto("/settings");
  const log = page.getByTestId("import-log");
  await expect(log).toContainText("거부: 허용되지 않은 Origin");
  await expect(log).toContainText("거부: 토큰 틀림");
  await expect(log).toContainText("거부: 토큰 없음(API 꺼짐)");
  await expect(log).toContainText(`chrome-extension://${ext}`);
  await expect(log).toContainText("등록한 확장");
  await expect(log).toContainText(`물건 ${itemId}번`);
  await expect(page.locator("#import-log")).toContainText("거부된 수상한 요청");
  expect(await page.locator("main").innerText()).not.toContain(token);
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "기록 비우기" }).click();
  await expect(page.getByTestId("import-log-empty")).toBeVisible();
});

test("물건 목록은 물건마다 다음에 할 일 한 가지를 보여 준다", async ({ page }) => {
  await page.goto("/items/new");
  await page.locator("#category").selectOption("ELECTRONICS");
  await page.locator("#name").fill("다음 단계 확인용 기기");
  await page.locator("#condition").selectOption("GOOD");
  await page.getByRole("button", { name: "저장" }).click();
  await page.waitForURL(/\/items\/\d+$/);
  const id = page.url().split("/").pop();
  await page.goto("/");
  await expect(page.getByTestId(`next-step-${id}`)).toHaveText("다음: 가격 자료 넣기");
  await page.getByTestId(`next-step-${id}`).click();
  await expect(page).toHaveURL(new RegExp(`/items/${id}/prices/new$`));
  await page.goBack();
  // 할 일로 걸러 보기
  const filter = page.getByTestId("step-filter");
  await filter.getByRole("link", { name: /^가격 자료 넣기 \d+$/ }).click();
  await expect(page).toHaveURL(/step=ADD_PRICES/);
  await expect(page.getByTestId(`next-step-${id}`)).toBeVisible();
  await expect(page.locator('[data-testid^="next-step-"]').filter({ hasText: "완료:" })).toHaveCount(0);
  await filter.getByRole("link", { name: /^전체 \d+$/ }).click();
  // 판매 결과까지 기록한 물건은 완료로 표시
  await expect(page.locator('[data-testid^="next-step-"]').filter({ hasText: "완료: 판매 결과까지 기록함" }).first()).toBeVisible();
});

test("판매처별 계산: 여러 개면 기준을 직접 정해야 차이를 계산하고, 고른 판매처가 선택에 남는다", async ({ page }) => {
  await page.goto("/items/new");
  await page.locator("#category").selectOption("CONSOLE");
  await page.locator("#name").fill("판매처 비교 게임기");
  await page.locator("#condition").selectOption("GOOD");
  await page.getByRole("button", { name: "저장" }).click();
  await expect(page).toHaveURL(/\/items\/\d+$/);

  const buyback = page.getByTestId("scenario-BUYBACK");
  await buyback.locator("#buyback-saleAmount").fill("5000");
  for (const f of ["feeAmount", "shipping", "packing", "transport"]) await buyback.locator(`#buyback-${f}`).fill("0");
  await buyback.getByRole("button", { name: "금액·비용 저장" }).click();
  await expect(page.getByTestId("net-BUYBACK")).toHaveText("5,000원");

  const direct = page.getByTestId("scenario-DIRECT");
  await direct.locator("#direct-channel").fill("가 장터");
  await direct.locator("#direct-saleAmount").fill("9000");
  for (const f of ["feeAmount", "packing", "transport"]) await direct.locator(`#direct-${f}`).fill("0");
  await direct.locator("#direct-shipping").fill("3000");
  await direct.getByRole("button", { name: "금액·비용 저장" }).click();
  await expect(page.getByTestId("net-DIRECT")).toHaveText("6,000원");
  await expect(page.getByTestId("net-diff")).toContainText("1,000원 더 많습니다");

  // 두 번째 판매처: 같은 이름은 거절, 비용은 베껴 오고 금액은 베끼지 않는다
  await page.getByTestId("add-scenario-DIRECT").locator("summary").click();
  const add = page.getByTestId("add-scenario-DIRECT");
  await add.locator("#direct-new-channel").fill("가 장터");
  await add.locator("#direct-new-saleAmount").fill("12000");
  await add.getByRole("button", { name: "새 계산 저장" }).click();
  await expect(add.locator("#direct-new-channel-error")).toContainText("같은 이름의 계산이 이미 있습니다");
  await add.locator("#direct-new-channel").fill("나 직거래");
  await add.locator("#direct-new-copy").selectOption({ label: "개인에게 직접 판매 · 가 장터" });
  await expect(add.locator("#direct-new-shipping")).toHaveValue("3000");
  await expect(add.locator("#direct-new-saleAmount")).toHaveValue("12000");
  await add.locator("#direct-new-shipping").fill("0");
  await add.getByRole("button", { name: "새 계산 저장" }).click();

  // 기준을 정하기 전에는 차이를 계산하지 않는다(앱이 고르지 않는다)
  await expect(page.getByTestId("needs-primary-DIRECT")).toBeVisible();
  await expect(page.getByTestId("net-diff")).toContainText("계산이 여러 개라");
  await expect(page.getByTestId("scenario-table")).toContainText("개인에게 직접 판매 · 나 직거래");
  await expect(page.getByTestId("break-even")).toHaveCount(0);

  const second = direct.locator('[data-testid^="scenario-DIRECT-"]').filter({ hasText: "나 직거래" });
  await second.getByRole("button", { name: "기준으로 쓰기" }).click();
  await expect(page.getByTestId("needs-primary-DIRECT")).toHaveCount(0);
  await expect(page.getByTestId("net-DIRECT")).toHaveText("12,000원");
  await expect(page.getByTestId("net-diff")).toContainText("7,000원 더 많습니다");
  await expect(page.getByTestId("net-diff")).toContainText("나 직거래");

  // 선택은 계산 단위: 판매처 이름이 선택과 판매 결과 칸에 남는다
  await page.getByRole("button", { name: "개인에게 직접 판매 · 가 장터로 정하기" }).click();
  await expect(page.getByTestId("chosen")).toContainText("개인에게 직접 판매 · 가 장터");
  await expect(page.getByTestId("chosen")).toContainText("6,000원");
  await expect(page.locator("#result-channel")).toHaveValue("가 장터");

  // 고른 계산의 이름과 메모를 고쳐도 선택은 그 계산을 계속 가리킨다
  const chosenCard = direct.locator('[data-testid^="scenario-DIRECT-"]').filter({ hasText: "가 장터" });
  await chosenCard.locator("summary").click();
  await chosenCard.locator('input[name="channel"]').fill("가 마켓");
  await chosenCard.locator('input[name="memo"]').fill("수수료 안내 확인함");
  await chosenCard.getByRole("button", { name: "금액·비용 저장" }).click();
  await expect(page.getByTestId("chosen")).toContainText("개인에게 직접 판매 · 가 마켓");
  await expect(page.getByTestId("choice-outdated")).toHaveCount(0);
  await expect(direct).toContainText("메모: 수수료 안내 확인함");

  // 고른 계산을 지우면 선택이 낡았다고 알린다
  const first = direct.locator('[data-testid^="scenario-DIRECT-"]').filter({ hasText: "가 마켓" });
  // 위에서 연 펼침 영역이 그대로 열려 있다(닫혀 있으면 연다)
  if (!(await first.getByRole("button", { name: "이 계산 지우기" }).isVisible())) await first.locator("summary").click();
  page.once("dialog", (d) => void d.accept());
  await first.getByRole("button", { name: "이 계산 지우기" }).click();
  await expect(page.getByTestId("choice-outdated")).toBeVisible();
  await expect(page.getByTestId("net-DIRECT")).toHaveText("12,000원");

  // 배분 화면: 계산이 다시 하나가 되면 판매처별 따져 보기는 없다
  const id = page.url().match(/items\/(\d+)/)![1];
  await page.goto("/triage");
  await expect(page.locator("main")).toContainText("판매처 비교 게임기");
  await expect(page.getByTestId(`alts-${id}`)).toHaveCount(0);

  // 판매처를 하나 더 넣으면 기준이 아닌 계산을 따로 따져 보여 준다(건수 요약과는 별개)
  await page.goto(`/items/${id}`);
  const addAgain = page.getByTestId("add-scenario-DIRECT");
  await addAgain.locator("summary").click();
  await addAgain.locator("#direct-new-channel").fill("다 장터");
  await addAgain.locator("#direct-new-saleAmount").fill("4000");
  for (const f of ["feeAmount", "shipping", "packing", "transport"]) await addAgain.locator(`#direct-new-${f}`).fill("0");
  await addAgain.getByRole("button", { name: "새 계산 저장" }).click();
  await expect(page.getByTestId("scenario-table")).toContainText("다 장터");
  await page.goto("/triage");
  const alts = page.getByTestId(`alts-${id}`);
  await alts.locator("summary").click();
  await expect(alts).toContainText("개인에게 직접 판매 · 다 장터");
  await expect(alts).toContainText("업체에 넘기기");
  await expect(alts).toContainText("순위가 아니고");
});

test("외화 자료: 직접 입력한 환율로 환산 참고만 보여 주고, 원화 비교에는 넣지 않는다", async ({ page }) => {
  await page.goto("/items/new");
  await page.locator("#category").selectOption("CONSOLE");
  await page.locator("#name").fill("외화 참고 게임기");
  await page.locator("#condition").selectOption("GOOD");
  await page.getByRole("button", { name: "저장" }).click();
  await expect(page).toHaveURL(/\/items\/\d+$/);

  await page.getByRole("link", { name: "가격 자료 추가" }).click();
  await page.locator("#priceType").selectOption("ASKING");
  await page.locator("#amount").fill("12.50");
  await page.locator("#currency").selectOption("USD");
  await page.locator("#sourceName").fill("해외 장터");
  await page.getByText("외화 자료의 원화 환산 참고 (선택)").click();
  // 환율만 넣고 기준일을 빼면 저장하지 않는다
  await page.locator("#fxRate").fill("1385.5");
  await page.getByRole("button", { name: "가격 자료 저장" }).click();
  await expect(page.locator("#fxDate-error")).toContainText("기준일도 입력");
  await page.locator("#fxDate").fill("2026-01-05");
  await page.getByRole("button", { name: "가격 자료 저장" }).click();
  await expect(page).toHaveURL(/\/items\/\d+(#prices)?$/);

  const fx = page.locator('[data-testid^="fx-"]');
  await expect(fx).toContainText("환산 참고 약 17,319원");
  await expect(fx).toContainText("1 USD = 1385.5원, 기준일 2026-01-05");
  await expect(page.locator("main")).toContainText("외화 자료(원화 비교에서 제외)");
});

test("받은 제안: 제안 금액을 내 계산의 비용에 넣어 따져 보고, 받기로 한 제안은 판매 결과 칸에 미리 채운다", async ({ page }) => {
  await page.goto("/items/new");
  await page.locator("#category").selectOption("CONSOLE");
  await page.locator("#name").fill("제안 테스트 게임기");
  await page.locator("#condition").selectOption("GOOD");
  await page.getByRole("button", { name: "저장" }).click();
  await expect(page).toHaveURL(/\/items\/\d+$/);

  // 계산이 없을 때: 기록은 되지만 따져 보지 않는다
  await page.locator("#offer-amount").fill("0");
  await page.getByRole("button", { name: "제안 기록" }).click();
  await expect(page.locator("#offer-amount-error")).toContainText("0보다 커야");
  await page.locator("#offer-amount").fill("18000");
  await page.getByRole("button", { name: "제안 기록" }).click();
  const offer = page.locator('[data-testid^="offer-"]').filter({ hasText: "18,000원" });
  await expect(offer).toContainText("개인 판매 금액·비용을 2단계에서 저장하면");
  await expect(page.locator("#offer-amount")).toHaveValue("");

  const buyback = page.getByTestId("scenario-BUYBACK");
  await buyback.locator("#buyback-saleAmount").fill("15000");
  for (const f of ["feeAmount", "shipping", "packing", "transport"]) await buyback.locator(`#buyback-${f}`).fill("0");
  await buyback.getByRole("button", { name: "금액·비용 저장" }).click();
  await expect(page.getByTestId("net-BUYBACK")).toHaveText("15,000원");
  const direct = page.getByTestId("scenario-DIRECT");
  await direct.locator("#direct-saleAmount").fill("20000");
  await direct.getByText("비율(%)").click();
  await direct.locator("#direct-feeRate").fill("10");
  await direct.locator("#direct-shipping").fill("3000");
  for (const f of ["packing", "transport"]) await direct.locator(`#direct-${f}`).fill("0");
  await direct.getByRole("button", { name: "금액·비용 저장" }).click();
  await expect(page.getByTestId("net-DIRECT")).toHaveText("15,000원");

  // 18,000 − 수수료 1,800 − 배송비 3,000 = 13,200 → 업체(15,000)보다 1,800 적음
  await expect(offer).toContainText("예상 판매금액 20,000원보다 -2,000원");
  await expect(offer).toContainText("이 금액에 팔면 예상 실수령액 13,200원");
  await expect(offer).toContainText("업체 판매 실수령액보다 -1,800원");
  await expect(page.getByTestId("offer-counts")).toContainText("답하지 않음 1건");

  await offer.getByRole("button", { name: "받기로 함으로 표시" }).click();
  await expect(offer).toContainText("받기로 함");
  await expect(page.locator("#result-amount")).toHaveValue("18000");

  // 제안은 가격 자료가 아니다
  await expect(page.getByText("가격 자료 없음")).toBeVisible();

  page.once("dialog", (d) => void d.accept());
  await offer.getByRole("button", { name: "지우기" }).click();
  await expect(page.locator('[data-testid^="offer-"]').filter({ hasText: "18,000원" })).toHaveCount(0);
});

test("판매 결과: 실제 비용을 항목별로 적으면 어림과 항목별로 견주고, 합계와 어긋나면 저장하지 않는다", async ({ page }) => {
  await page.goto("/items/new");
  await page.locator("#category").selectOption("CONSOLE");
  await page.locator("#name").fill("비용 항목 게임기");
  await page.locator("#condition").selectOption("GOOD");
  await page.getByRole("button", { name: "저장" }).click();
  await expect(page).toHaveURL(/\/items\/\d+$/);

  const direct = page.getByTestId("scenario-DIRECT");
  await direct.locator("#direct-saleAmount").fill("20000");
  await direct.locator("#direct-feeAmount").fill("0");
  await direct.locator("#direct-shipping").fill("3000");
  await direct.locator("#direct-expectedMinutes").fill("30");
  await direct.locator("#direct-packing").fill("500");
  await direct.locator("#direct-transport").fill("0");
  await direct.getByRole("button", { name: "금액·비용 저장" }).click();
  await expect(page.getByTestId("net-DIRECT")).toHaveText("16,500원");
  await page.getByRole("button", { name: "개인에게 직접 판매로 정하기" }).click();
  await expect(page.getByTestId("chosen")).toContainText("16,500원");

  await page.locator("#result-channel").fill("가 장터");
  await page.locator("#result-minutesSpent").fill("45");
  await page.locator("#result-amount").fill("19000");
  await page.getByText("실제 비용을 항목별로 적기 (선택)").click();
  await page.locator("#result-feeActual").fill("0");
  await page.locator("#result-shippingActual").fill("4000");
  await page.locator("#result-packingActual").fill("500");
  await page.locator("#result-transportActual").fill("0");
  // 합계를 따로 적었는데 항목의 합과 다르면 저장하지 않는다
  await page.locator("#result-costTotal").fill("4000");
  await page.getByRole("button", { name: "판매 결과 저장" }).click();
  await expect(page.locator("#result-costTotal-error")).toContainText("항목의 합(4,500원)과 다릅니다");
  await page.locator("#result-costTotal").fill("");
  await page.getByRole("button", { name: "판매 결과 저장" }).click();

  await expect(page.getByTestId("result-summary")).toContainText("실제 비용 4,500원");
  // 합계는 그대로 두고 시간과 비용 배분만 바꿔도 결과 비교는 선택 당시 값을 쓴다.
  await direct.locator("#direct-shipping").fill("500");
  await direct.locator("#direct-packing").fill("3000");
  await direct.locator("#direct-expectedMinutes").fill("60");
  await direct.getByRole("button", { name: "금액·비용 저장" }).click();
  await expect(page.getByTestId("choice-outdated")).toBeVisible();
  const items = page.getByTestId("result-cost-items");
  await expect(items).toContainText("판매자 부담 배송비: 3,000원 → 4,000원 (+1,000원)");
  await expect(items).toContainText("포장비: 500원 → 500원 (같음)");

  await page.goto("/results");
  await expect(page.getByRole("row").filter({ hasText: "비용 항목 게임기" })).toContainText("30분 → 45분");
  await expect(page.getByTestId("cost-item-shipping")).toContainText("판매자 부담 배송비");
  const cells = page.getByTestId("cost-item-shipping").locator("td");
  await expect(cells.nth(0)).toHaveText("1"); // 어림보다 더 듦
  await expect(page.getByTestId("cost-item-packing").locator("td").nth(1)).toHaveText("1"); // 같음
});

test("판매글 템플릿: 내가 쓴 틀을 물건 정보로 채우고, 값이 없는 줄은 빼고 알려 준다", async ({ page }) => {
  await page.goto("/templates");
  await expect(page.getByTestId("template-tokens")).toContainText("{가격}");
  await page.locator("#tpl-new-name").fill("채팅용");
  await page.locator("#tpl-new-body").fill("{이름} 팝니다.\n시세는 {시세}");
  await page.getByRole("button", { name: "템플릿 만들기" }).click();
  await expect(page.locator("#tpl-new-body-error")).toContainText("알 수 없는 자리표시: {시세}");
  await page.locator("#tpl-new-body").fill("{이름} 팝니다.\n상태: {상태}\n구성품: {구성품}\n희망 가격 {가격}\n직거래만 합니다.");
  await page.getByRole("button", { name: "템플릿 만들기" }).click();
  await expect(page.getByRole("heading", { name: "내 템플릿 1개" })).toBeVisible();

  await page.goto("/items/new");
  await page.locator("#category").selectOption("CONSOLE");
  await page.locator("#name").fill("템플릿 테스트 게임기");
  await page.locator("#condition").selectOption("GOOD");
  await page.getByRole("button", { name: "저장" }).click();
  await expect(page).toHaveURL(/\/items\/\d+$/);

  const rendered = page.locator('[data-testid^="rendered-template-"]').filter({ hasText: "채팅용" });
  await expect(rendered.locator("pre")).toHaveText("템플릿 테스트 게임기 팝니다.\n상태: 사용감 적음\n직거래만 합니다.");
  await expect(rendered).toContainText("값을 입력하지 않아 뺀 줄 2개: {구성품}, {가격}");

  // 데모 모드에는 실제 모드의 템플릿이 보이지 않는다
  await page.getByRole("button", { name: /가상 데이터로 둘러보기/ }).click();
  await expect(page.getByRole("status").filter({ hasText: "데모 모드" })).toContainText("가상 데이터");
  await page.goto("/templates");
  await expect(page.getByRole("heading", { name: "내 템플릿 1개" })).toBeVisible();
  await expect(page.locator('[data-testid^="template-"] input[name="name"]')).toHaveValue("(데모) 짧은 채팅용");
  await page.getByRole("button", { name: "실제 사용으로 돌아가기" }).click();
  await expect(page.getByText("데모 모드")).toHaveCount(0);
});

test("물건 CSV: 여러 물건을 한 번에 등록하고, 오류·중복 행은 건너뛰며, 가격은 만들지 않는다", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "CSV로 한꺼번에 등록" }).click();
  await expect(page.getByRole("heading", { name: "물건 한꺼번에 등록 (CSV)" })).toBeVisible();

  const csv = [
    "category,name,identifier,condition,defects",
    "CONSOLE,CSV 등록 게임기,CSV-100,GOOD,스틱 쏠림",
    "BOOK,CSV 등록 도서,9780306406157,LIKE_NEW,",
    "BOOK,ISBN 틀린 도서,123,GOOD,",
    "CONSOLE,CSV 등록 게임기,CSV-100,FAIR,",
  ].join("\n");
  await page.locator("#csv-file").setInputFiles({ name: "items.csv", mimeType: "text/csv", buffer: Buffer.from(csv, "utf8") });
  await page.getByRole("button", { name: "가져오기" }).click();
  await expect(page.locator("main")).toContainText("물건 2개를 등록했고, 2행은 건너뛰었습니다.");
  await expect(page.locator("main")).toContainText("4행");
  await expect(page.locator("main")).toContainText("5행");

  // 같은 파일을 다시 올려도 두 번 등록되지 않는다
  await page.locator("#csv-file").setInputFiles({ name: "items.csv", mimeType: "text/csv", buffer: Buffer.from(csv, "utf8") });
  await page.getByRole("button", { name: "가져오기" }).click();
  await expect(page.locator("main")).toContainText("물건 0개를 등록했고, 4행은 건너뛰었습니다.");

  await page.goto("/?q=CSV 등록");
  await expect(page.getByRole("link", { name: /CSV 등록 게임기/ })).toHaveCount(1);
  await page.getByRole("link", { name: /CSV 등록 게임기/ }).click();
  await expect(page).toHaveURL(/\/items\/\d+$/);
  await expect(page.getByRole("heading", { name: "CSV 등록 게임기" })).toBeVisible();
  await expect(page.locator("#prices").getByText("가격 자료 없음")).toBeVisible();

  const res = await page.request.get("/api/export/items");
  expect(res.headers()["content-disposition"]).toMatch(/items-\d{4}-\d{2}-\d{2}\.csv/);
  const text = await res.text();
  expect(text).toContain("CSV 등록 도서,9780306406157,LIKE_NEW");
  // 시세·판매 가격 열은 없다(내가 산 가격 purchase_amount만 예외로 있다)
  expect(text.split("\r\n")[0]).not.toMatch(/(^|,)(price|amount|asking|sale_amount|price_type)(,|$)/);
});

test("올린 가격 기록: 가격을 바꿔 온 과정과 손익분기 대비를 보여 주고, 결과 돌아보기에서 처음 올린 가격과 견준다", async ({ page }) => {
  await page.goto("/items/new");
  await page.locator("#category").selectOption("CONSOLE");
  await page.locator("#name").fill("올린 가격 게임기");
  await page.locator("#condition").selectOption("GOOD");
  await page.getByRole("button", { name: "저장" }).click();
  await expect(page).toHaveURL(/\/items\/\d+$/);
  const id = page.url().split("/").pop()!;

  const buyback = page.getByTestId("scenario-BUYBACK");
  await buyback.locator("#buyback-saleAmount").fill("15000");
  for (const f of ["feeAmount", "shipping", "packing", "transport"]) await buyback.locator(`#buyback-${f}`).fill("0");
  await buyback.getByRole("button", { name: "금액·비용 저장" }).click();
  await expect(page.getByTestId("net-BUYBACK")).toHaveText("15,000원");
  const direct = page.getByTestId("scenario-DIRECT");
  await direct.locator("#direct-saleAmount").fill("24000");
  await direct.locator("#direct-shipping").fill("3000");
  for (const f of ["feeAmount", "packing", "transport"]) await direct.locator(`#direct-${f}`).fill("0");
  await direct.getByRole("button", { name: "금액·비용 저장" }).click();
  await expect(page.getByTestId("net-DIRECT")).toHaveText("21,000원");

  const posted = page.getByTestId("posted-prices");
  await posted.locator("#posted-postedDate").fill("2026-01-05");
  await posted.locator("#posted-amount").fill("24000");
  await posted.getByRole("button", { name: "올린 가격 기록" }).click();
  await expect(page.getByTestId("posted-summary")).toContainText("처음 24,000원 → 지금 24,000원");
  await posted.locator("#posted-postedDate").fill("2026-01-12");
  await posted.locator("#posted-amount").fill("17000");
  await posted.getByRole("button", { name: "올린 가격 기록" }).click();
  // 손익분기: 15,000 + 배송비 3,000 = 18,000 → 17,000은 그보다 낮다
  await expect(page.getByTestId("posted-summary")).toContainText("처음 24,000원 → 지금 17,000원 · 내린 횟수 1번, 올린 횟수 0번");
  await expect(page.getByTestId("posted-summary")).toContainText("손익분기 개인 판매금액(18,000원)보다 낮음");
  // 판매 중 희망가가 3건 미만이면 내 가격과 견주지 않는다
  await expect(page.getByTestId("posted-vs-asking")).toContainText("0건이라 지금 가격과 견주지 않습니다");
  await expect(posted).toContainText("직전보다 -7,000원");
  await expect(page.locator("#prices").getByText("가격 자료 없음")).toBeVisible();

  await page.locator("#result-channel").fill("가 장터");
  await page.locator("#result-amount").fill("17000");
  await page.getByRole("button", { name: "판매 결과 저장" }).click();
  await expect(page.getByTestId("result-summary")).toBeVisible();
  // 기록 한눈에 보기: 올린 가격 두 번과 판매가 날짜순으로 나온다
  const timeline = page.getByTestId("timeline");
  await expect(timeline).toContainText("가 장터에서 17,000원에 판매(내가 기록한 값)");
  await expect(timeline.locator("li").filter({ hasText: "내 판매글 가격" })).toHaveCount(2);
  await expect(timeline.locator("li").filter({ hasText: "물건을 등록함" })).toHaveCount(1);
  // 날짜순(최신이 위): 테스트에서 적은 올린 가격은 과거 날짜라 맨 아래에 온다
  await expect(timeline.locator("li").last()).toContainText("2026-01-05");
  await page.goto("/results");
  await expect(page.getByTestId(`posted-first-${id}`)).toContainText("처음 올린 가격 24,000원 · 1번 내림");
  // 판 날(오늘)과 처음 올린 날의 차이. 날짜는 테스트를 돌리는 날에 따라 달라지므로 형식만 본다.
  await expect(page.getByTestId(`days-to-sell-${id}`)).toHaveText(/^처음 올린 날\(2026-01-05\)부터 \d+일 만에 판매$/);
  await expect(page.getByTestId("posted-counts")).toContainText("낮게 판 것 1건");
});

test("배분·판매 결과를 CSV로 내려받는다(물건별 값만, 합계 없음)", async ({ page }) => {
  await page.goto("/triage");
  const triage = await page.request.get("/api/export/triage");
  expect(triage.headers()["content-disposition"]).toMatch(/triage-\d{4}-\d{2}-\d{2}\.csv/);
  expect(triage.headers()["cache-control"]).toBe("no-store");
  const tText = await triage.text();
  expect(tText.split("\r\n")[0]).toContain("item_name,category,status,verdict");
  expect(tText).not.toMatch(/합계|total/i);
  await expect(page.getByRole("link", { name: "이 표를 CSV로 받기" })).toBeVisible();

  await page.goto("/results");
  await expect(page.getByRole("link", { name: "이 기록을 CSV로 받기" })).toBeVisible();
  const results = await page.request.get("/api/export/results");
  const rText = await results.text();
  expect(rText.split("\r\n")[0]).toContain("item_name,category,sold_date,channel");
  expect(rText).toContain("올린 가격 게임기");
  expect(rText).not.toContain("(데모)");
});

test("답하지 않은 제안은 목록·점검에 나타나고, 같은 물건을 하나 더 등록하면 물건 정보만 베낀다", async ({ page }) => {
  await page.goto("/items/new");
  await page.locator("#category").selectOption("CONSOLE");
  await page.locator("#name").fill("복제 테스트 게임기");
  await page.locator("#identifier").fill("DUP-1");
  await page.locator("#condition").selectOption("GOOD");
  await page.getByRole("button", { name: "저장" }).click();
  await expect(page).toHaveURL(/\/items\/\d+$/);
  const id = page.url().split("/").pop()!;

  await page.locator("#offer-amount").fill("12000");
  await page.getByRole("button", { name: "제안 기록" }).click();
  await expect(page.getByTestId("offer-counts")).toContainText("답하지 않음 1건");

  await page.goto("/?q=복제 테스트");
  await expect(page.locator("main")).toContainText("답하지 않은 제안 1건");
  await page.goto("/checkup");
  await expect(page.getByTestId(`checkup-${id}`)).toContainText("답하지 않은 제안 1건");

  await page.goto(`/items/${id}`);
  await page.getByRole("button", { name: "같은 물건 하나 더 등록" }).click();
  await expect(page).toHaveURL(/\/items\/\d+\/edit\?copied=1$/);
  await expect(page.getByTestId("copied-notice")).toContainText("물건 정보만 베껴");
  await expect(page.locator("#name")).toHaveValue("복제 테스트 게임기");
  await expect(page.locator("#identifier")).toHaveValue("DUP-1");
  const copyId = page.url().match(/items\/(\d+)/)![1];
  expect(copyId).not.toBe(id);
  await page.goto(`/items/${copyId}`);
  await expect(page.locator('[data-testid^="offer-"]').filter({ hasText: "12,000원" })).toHaveCount(0);
  // 같은 모델명으로 등록한 다른 물건을 알려 준다(막지는 않는다)
  await expect(page.getByTestId("same-identifier-items")).toContainText("같은 모델명으로 등록한 다른 물건이 1개");
  await expect(page.getByTestId("same-identifier-items").getByRole("link", { name: "복제 테스트 게임기" })).toHaveAttribute("href", `/items/${id}`);
  await page.goto("/?q=복제 테스트");
  await expect(page.getByRole("link", { name: /복제 테스트 게임기/ })).toHaveCount(2);
});

test("산 가격: 적어 두면 계산·판매 결과·돌아보기에서 실수령액과 견주고, 판매글에는 넣지 않는다", async ({ page }) => {
  await page.goto("/items/new");
  await page.locator("#category").selectOption("CONSOLE");
  await page.locator("#name").fill("산 가격 게임기");
  await page.locator("#condition").selectOption("GOOD");
  await page.locator("#purchaseAmount").fill("30000");
  await page.locator("#purchaseDate").fill("2026-01-05");
  await page.getByRole("button", { name: "저장" }).click();
  await expect(page).toHaveURL(/\/items\/\d+$/);
  const id = page.url().split("/").pop()!;
  await expect(page.locator("#info")).toContainText("30,000원 (2026-01-05)");

  const direct = page.getByTestId("scenario-DIRECT");
  await direct.locator("#direct-saleAmount").fill("20000");
  await direct.locator("#direct-shipping").fill("3000");
  for (const f of ["feeAmount", "packing", "transport"]) await direct.locator(`#direct-${f}`).fill("0");
  await direct.getByRole("button", { name: "금액·비용 저장" }).click();
  await expect(page.getByTestId("vs-purchase-DIRECT")).toHaveText("산 가격(30,000원)과 견주면 -13,000원");
  // 판매글 초안에는 산 가격이 들어가지 않는다
  await expect(page.getByTestId("draft-body")).not.toContainText("30,000");

  await page.locator("#result-channel").fill("가 장터");
  await page.locator("#result-soldDate").fill("2026-01-15");
  await page.locator("#result-amount").fill("19000");
  await page.locator("#result-costTotal").fill("3000");
  await page.getByRole("button", { name: "판매 결과 저장" }).click();
  await expect(page.getByTestId("result-vs-purchase")).toHaveText("산 가격 30,000원 → 실제 실수령액 16,000원 (-14,000원) · 산 날부터 판매까지 10일");
  await expect(page.getByTestId("timeline").locator("li").last()).toContainText("30,000원에 삼(내가 적은 값)");

  await page.goto("/results");
  await expect(page.getByTestId(`purchase-${id}`)).toHaveText("산 가격 30,000원 대비 -14,000원");
  await expect(page.getByTestId("purchase-counts")).toContainText("적음 1건");
});

test("가격 자료 목록: 보기 순서를 바꾸고 제외된 자료를 숨겨도 요약과 포함 건수는 그대로다", async ({ page }) => {
  await page.goto("/items/new");
  await page.locator("#category").selectOption("CONSOLE");
  await page.locator("#name").fill("정렬 테스트 게임기");
  await page.locator("#condition").selectOption("GOOD");
  await page.getByRole("button", { name: "저장" }).click();
  await expect(page).toHaveURL(/\/items\/\d+$/);
  for (const [amount, source] of [["15000", "가 장터"], ["9000", "나 장터"], ["12000", "다 장터"]] as const) {
    await addPrice(page, { type: "ASKING", amount, source });
    await expect(page).toHaveURL(/\/items\/\d+(#prices)?$/);
  }
  await page.getByRole("link", { name: "가격 자료 추가" }).click();
  await page.locator("#priceType").selectOption("ASKING");
  await page.locator("#amount").fill("10.00");
  await page.locator("#currency").selectOption("USD");
  await page.locator("#sourceName").fill("해외 장터");
  await page.getByRole("button", { name: "가격 자료 저장" }).click();
  await expect(page).toHaveURL(/\/items\/\d+(#prices)?$/);

  const group = page.getByTestId("group-ASKING");
  const firstCells = () => group.locator("tbody tr td:first-child");
  await expect(firstCells().first()).toContainText("9,000원"); // 기본: 금액 낮은 순
  await expect(group).toContainText("포함 3건 · 제외 1건");
  const summaryBefore = await group.locator("h3").innerText();

  await page.getByTestId("price-sort").getByRole("link", { name: "금액 높은 순" }).click();
  await expect(page).toHaveURL(/sort=amount_desc/);
  await expect(firstCells().nth(0)).toContainText("15,000원");
  await expect(firstCells().nth(1)).toContainText("12,000원");
  await expect(firstCells().nth(2)).toContainText("9,000원");
  await expect(firstCells().nth(3)).toContainText("USD 10.00");

  await page.getByTestId("toggle-excluded").click();
  await expect(page).toHaveURL(/hide=excluded/);
  await expect(firstCells()).toHaveCount(3);
  await expect(group).toContainText("포함 3건 · 제외 1건");
  expect(await group.locator("h3").innerText()).toBe(summaryBefore);
  await page.getByTestId("toggle-excluded").click();
  await expect(firstCells()).toHaveCount(4);
});

test("휴지통: 삭제한 물건은 목록에서 빠지고, 되살리면 자료가 그대로 돌아오며, 완전히 지우면 사라진다", async ({ page }) => {
  await page.goto("/items/new");
  await page.locator("#category").selectOption("CONSOLE");
  await page.locator("#name").fill("휴지통 테스트 게임기");
  await page.locator("#condition").selectOption("GOOD");
  await page.getByRole("button", { name: "저장" }).click();
  await expect(page).toHaveURL(/\/items\/\d+$/);
  const id = page.url().split("/").pop()!;
  await addPrice(page, { type: "ASKING", amount: "13000", source: "가 장터" });
  await expect(page).toHaveURL(/\/items\/\d+(#prices)?$/);

  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "물건 삭제" }).click();
  await expect(page.getByTestId("trashed-notice")).toBeVisible();
  await page.goto("/?q=휴지통 테스트");
  await expect(page.getByRole("link", { name: /휴지통 테스트 게임기/ })).toHaveCount(0);
  // 휴지통의 물건은 주소로 직접 가도 열리지 않는다
  expect((await page.request.get(`/items/${id}`)).status()).toBe(404);

  await page.getByTestId("trash-link").click();
  const row = page.getByTestId(`trashed-${id}`);
  await expect(row).toContainText("가격 자료 1건");
  await row.getByRole("button", { name: "되살리기" }).click();
  await expect(page.getByTestId(`trashed-${id}`)).toHaveCount(0);
  await page.goto(`/items/${id}`);
  await expect(page.getByTestId("group-ASKING")).toContainText("13,000원");

  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "물건 삭제" }).click();
  await page.goto("/trash");
  page.once("dialog", (d) => void d.accept());
  await page.getByTestId(`trashed-${id}`).getByRole("button", { name: "완전히 지우기" }).click();
  await expect(page.getByTestId(`trashed-${id}`)).toHaveCount(0);
  expect((await page.request.get(`/items/${id}`)).status()).toBe(404);
});

test("가격 자료 한꺼번에: 고른 자료를 비교에서 빼고 다시 넣고 지운다", async ({ page }) => {
  await page.goto("/items/new");
  await page.locator("#category").selectOption("CONSOLE");
  await page.locator("#name").fill("한꺼번에 테스트 게임기");
  await page.locator("#condition").selectOption("GOOD");
  await page.getByRole("button", { name: "저장" }).click();
  await expect(page).toHaveURL(/\/items\/\d+$/);
  for (const [amount, source] of [["15000", "가 장터"], ["9000", "나 장터"], ["12000", "다 장터"], ["11000", "라 장터"]] as const) {
    await addPrice(page, { type: "ASKING", amount, source });
    await expect(page).toHaveURL(/\/items\/\d+(#prices)?$/);
  }
  const group = page.getByTestId("group-ASKING");
  await expect(group).toContainText("포함 4건");
  // 가격 자료 분포 그림: 유형마다 한 줄, 자료 한 건이 점 하나
  await expect(page.getByTestId("price-strip")).toBeVisible();
  await expect(page.getByTestId("strip-ASKING").getByTestId("strip-point")).toHaveCount(4);

  // 아무것도 고르지 않으면 아무 일도 없다
  await page.getByTestId("bulk-prices").getByRole("button", { name: "비교에서 빼기" }).click();
  await expect(group).toContainText("포함 4건");

  await page.getByRole("checkbox", { name: "가 장터 15,000원 선택" }).check();
  await page.getByRole("checkbox", { name: "나 장터 9,000원 선택" }).check();
  await page.getByTestId("bulk-prices").getByRole("button", { name: "비교에서 빼기" }).click();
  await expect(group).toContainText("포함 2건 · 제외 2건");
  await expect(page.getByTestId("strip-ASKING").locator('[data-eligible="no"]')).toHaveCount(2);

  await page.getByRole("checkbox", { name: "가 장터 15,000원 선택" }).check();
  await page.getByTestId("bulk-prices").getByRole("button", { name: "다시 포함" }).click();
  await expect(group).toContainText("포함 3건 · 제외 1건");

  // 오늘 다시 확인함: 오늘 넣은 자료라 확인일은 그대로다(이미 오늘 확인함). 버튼이 동작하고 자료가 남는지만 본다
  await page.getByRole("checkbox", { name: "다 장터 12,000원 선택" }).check();
  page.once("dialog", (d) => void d.accept());
  await page.getByTestId("bulk-prices").getByRole("button", { name: "오늘 다시 확인함" }).click();
  await expect(group).toContainText("다 장터");

  await page.getByRole("checkbox", { name: "나 장터 9,000원 선택" }).check();
  await page.getByRole("checkbox", { name: "라 장터 11,000원 선택" }).check();
  page.once("dialog", (d) => void d.accept());
  await page.getByTestId("bulk-prices").getByRole("button", { name: "삭제" }).click();
  await expect(group).toContainText("포함 2건");
  await expect(group).not.toContainText("나 장터");
  await expect(group).not.toContainText("라 장터");
  await expect(group).toContainText("가 장터");

  // 가격 자료 추가 화면은 전에 쓴 출처 이름을 제안한다(고르지 않아도 된다)
  const itemPath = new URL(page.url()).pathname;
  await page.goto(`${itemPath}/prices/new`);
  await expect(page.locator("#sourceName")).toHaveAttribute("list", "sourceName-suggestions");
  await expect(page.locator('#sourceName-suggestions option[value="가 장터"]')).toHaveCount(1);
  await page.goto(itemPath);

  // 지운 자료는 휴지통으로 가고, 되살리면 비교에 다시 들어온다
  const itemUrl = page.url().replace(/#.*$/, "");
  await expect(page.getByTestId("trashed-prices-note")).toContainText("2건이 휴지통에");
  await page.getByTestId("trashed-prices-note").getByRole("link", { name: "휴지통에서 보기" }).click();
  const trashed = page.locator('[data-testid^="trashed-price-"]').filter({ hasText: "나 장터" });
  await expect(trashed).toContainText("9,000원");
  await expect(trashed).toContainText("한꺼번에 테스트 게임기");
  await trashed.getByRole("button", { name: "되살리기" }).click();
  await expect(page.locator('[data-testid^="trashed-price-"]').filter({ hasText: "나 장터" })).toHaveCount(0);
  await page.goto(itemUrl);
  await expect(group).toContainText("나 장터");
  await expect(page.getByTestId("trashed-prices-note")).toContainText("1건이 휴지통에");
});

test("백업 사본: 버튼으로 만들고, 내려받고, 지운다. 이상한 이름으로는 다른 파일을 읽을 수 없다", async ({ page }) => {
  await page.goto("/settings");
  await page.getByRole("button", { name: "지금 백업 사본 만들기" }).click();
  await expect(page.getByTestId("snapshot-status")).toContainText("사본을 만들었습니다: e2e-");
  const row = page.getByTestId("snapshot-list").locator("li").first();
  const name = (await row.locator("code").innerText()).trim();
  expect(name).toMatch(/^e2e-\d{8}-\d{6}\.db$/);

  const res = await page.request.get(`/api/backup/snapshots/${name}`);
  expect(res.status()).toBe(200);
  expect((await res.body()).subarray(0, 15).toString("latin1")).toBe("SQLite format 3");
  for (const bad of ["..%2Fe2e.db", "e2e.db", "resale-20260101-000000.db"]) {
    expect((await page.request.get(`/api/backup/snapshots/${bad}`)).status()).toBe(404);
  }

  page.once("dialog", (d) => void d.accept());
  await row.getByRole("button", { name: "사본 지우기" }).click();
  await expect(page.getByTestId("snapshots-empty").or(page.getByTestId("snapshot-list"))).toBeVisible();
  await expect(page.locator('[data-testid="snapshot-list"] code').filter({ hasText: name })).toHaveCount(0);
  // 사본을 지운 뒤 내려받기 주소도 더는 열리지 않는다
  expect((await page.request.get(`/api/backup/snapshots/${name}`)).status()).toBe(404);
});

test("물건 목록 정렬: 이름순으로 바꾸면 주소에 남고, 할 일 필터를 눌러도 유지된다", async ({ page }) => {
  await page.goto("/?q=테스트 게임기");
  await page.locator("#sort").selectOption("name");
  await page.getByRole("button", { name: "찾기" }).click();
  await expect(page).toHaveURL(/sort=name/);
  const names = await page.locator("main ul li p.font-semibold").allInnerTexts();
  expect(names.length).toBeGreaterThan(2);
  expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, "ko")));
  const chip = page.getByTestId("step-filter").locator("a").nth(1);
  await chip.click();
  await expect(page).toHaveURL(/sort=name/);
  await expect(page.locator("#sort")).toHaveValue("name");
});

test("내 비용 묶음: 저장해 둔 비용을 계산에 불러오고, 모름은 모름으로 온다", async ({ page }) => {
  await page.goto("/presets");
  await page.locator("#preset-new-name").fill("택배 거래");
  await page.locator("#preset-new-feeAmount").fill("0");
  await page.locator("#preset-new-shipping").fill("3500");
  await page.locator("#preset-new-packing").fill("500");
  // 교통비와 소요시간은 비워 둔다(모름)
  await page.getByRole("button", { name: "묶음 만들기" }).click();
  await expect(page.getByRole("heading", { name: "내 묶음 1개" })).toBeVisible();
  await page.locator("#preset-new-name").fill("택배 거래");
  await page.getByRole("button", { name: "묶음 만들기" }).click();
  await expect(page.locator("#preset-new-name-error")).toContainText("같은 이름의 묶음이 이미 있습니다");

  await page.goto("/items/new");
  await page.locator("#category").selectOption("CONSOLE");
  await page.locator("#name").fill("비용 묶음 게임기");
  await page.locator("#condition").selectOption("GOOD");
  await page.getByRole("button", { name: "저장" }).click();
  await expect(page).toHaveURL(/\/items\/\d+$/);

  const direct = page.getByTestId("scenario-DIRECT");
  await direct.locator("#direct-saleAmount").fill("20000");
  await direct.locator("#direct-copy").selectOption({ label: "내 비용 묶음: 택배 거래" });
  await expect(direct.locator("#direct-shipping")).toHaveValue("3500");
  await expect(direct.locator("#direct-packing")).toHaveValue("500");
  await expect(direct.locator("#direct-transport")).toHaveValue(""); // 모름은 0으로 바뀌지 않는다
  await expect(direct.locator("#direct-saleAmount")).toHaveValue("20000"); // 금액은 그대로
  await direct.getByRole("button", { name: "금액·비용 저장" }).click();
  await expect(page.getByTestId("net-DIRECT")).toHaveText("계산 불완전");
  await direct.locator("#direct-transport").fill("0");
  await direct.getByRole("button", { name: "금액·비용 저장" }).click();
  await expect(page.getByTestId("net-DIRECT")).toHaveText("16,000원");
});

test("물건 상태 빠른 변경: 판매 중으로 표시하고 되돌리며, 판매 결과를 기록한 뒤에는 버튼이 없다", async ({ page }) => {
  await page.goto("/items/new");
  await page.locator("#category").selectOption("CONSOLE");
  await page.locator("#name").fill("상태 변경 게임기");
  await page.locator("#condition").selectOption("GOOD");
  await page.getByRole("button", { name: "저장" }).click();
  await expect(page).toHaveURL(/\/items\/\d+$/);

  // 올린 가격을 적으면 상태를 바꾸라는 안내가 나온다
  await expect(page.getByTestId("posted-status-hint")).toHaveCount(0);
  await page.locator("#posted-amount").fill("20000");
  await page.getByRole("button", { name: "올린 가격 기록" }).click();
  await expect(page.getByTestId("posted-status-hint")).toBeVisible();
  await page.getByTestId("posted-status-hint").getByRole("button", { name: "판매 중으로 표시" }).click();
  await expect(page.getByTestId("posted-status-hint")).toHaveCount(0);
  await expect(page.getByTestId("set-status-OWNED")).toBeVisible();
  await expect(page.getByTestId("set-status-LISTED")).toHaveCount(0);

  await page.getByTestId("set-status-OWNED").click();
  await expect(page.getByTestId("set-status-LISTED")).toBeVisible();

  await page.locator("#result-channel").fill("가 장터");
  await page.locator("#result-amount").fill("19000");
  await page.getByRole("button", { name: "판매 결과 저장" }).click();
  await expect(page.getByTestId("result-summary")).toBeVisible();
  await expect(page.getByTestId("set-status-OWNED")).toHaveCount(0);
  await expect(page.getByTestId("set-status-LISTED")).toHaveCount(0);
  await page.goto(`${page.url().split("#")[0]}/edit`);
  await expect(page.locator("#status")).toBeDisabled();
  await expect(page.locator("#status")).toHaveValue("SOLD");
});

test("연달아 입력: 가격 자료를 저장하고 하나 더 넣을 때 유형·출처만 이어 주고, 이전·다음 물건으로 이동한다", async ({ page }) => {
  const ids: string[] = [];
  for (const name of ["연달아 테스트 가", "연달아 테스트 나"]) {
    await page.goto("/items/new");
    await page.locator("#category").selectOption("CONSOLE");
    await page.locator("#name").fill(name);
    await page.locator("#condition").selectOption("GOOD");
    await page.getByRole("button", { name: "저장" }).click();
    await expect(page).toHaveURL(/\/items\/\d+$/);
    ids.push(page.url().split("/").pop()!);
  }
  // 나중에 등록한 물건에서 이전 물건으로
  await expect(page.getByTestId("item-nav").getByText("다음 물건 ›")).not.toHaveAttribute("href", /.+/);
  await page.getByTestId("item-nav").getByRole("link", { name: "‹ 이전 물건" }).click();
  await expect(page).toHaveURL(new RegExp(`/items/${ids[0]}$`));
  await expect(page.getByRole("heading", { name: "연달아 테스트 가" })).toBeVisible();

  await page.getByRole("link", { name: "가격 자료 추가" }).click();
  await page.locator("#priceType").selectOption("SOLD_LISTING");
  await page.locator("#amount").fill("15000");
  await page.locator("#sourceName").fill("가 장터");
  await page.getByRole("button", { name: "저장하고 하나 더 추가" }).click();
  await expect(page.getByTestId("saved-again")).toBeVisible();
  await expect(page.locator("#priceType")).toHaveValue("SOLD_LISTING");
  await expect(page.locator("#sourceName")).toHaveValue("가 장터");
  await expect(page.locator("#amount")).toHaveValue(""); // 금액은 이어 주지 않는다
  await page.locator("#amount").fill("14000");
  await page.getByRole("button", { name: "가격 자료 저장", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/items/${ids[0]}(#prices)?$`));
  await expect(page.getByTestId("group-SOLD_LISTING")).toContainText("포함 2건");

  // 주소로 검증된 체결가를 끼워 넣어도 기본 유형으로 돌아간다
  await page.goto(`/items/${ids[0]}/prices/new?saved=1&type=VERIFIED_SALE&source=x`);
  await expect(page.locator("#priceType")).toHaveValue("ASKING");
});

test("판매 결과 돌아보기: 판매한 달로 걸러 보고, CSV도 그 달만 받는다", async ({ page }) => {
  // 서로 다른 달에 판 물건 두 개
  for (const [name, soldDate] of [["달별 테스트 가", "2026-01-15"], ["달별 테스트 나", "2026-02-03"]] as const) {
    await page.goto("/items/new");
    await page.locator("#category").selectOption("CONSOLE");
    await page.locator("#name").fill(name);
    await page.locator("#condition").selectOption("GOOD");
    await page.getByRole("button", { name: "저장" }).click();
    await expect(page).toHaveURL(/\/items\/\d+$/);
    await page.locator("#result-channel").fill("가 장터");
    await page.locator("#result-soldDate").fill(soldDate);
    await page.locator("#result-amount").fill("10000");
    await page.getByRole("button", { name: "판매 결과 저장" }).click();
    await expect(page.getByTestId("result-summary")).toBeVisible();
  }
  await page.goto("/results");
  const filter = page.getByTestId("month-filter");
  await expect(filter).toContainText("2026-01");
  await expect(filter).toContainText("2026-02");
  await filter.getByRole("link", { name: /^2026-01 / }).click();
  await expect(page).toHaveURL(/month=2026-01/);
  await expect(page.locator("main")).toContainText("달별 테스트 가");
  await expect(page.locator("main")).not.toContainText("달별 테스트 나");
  const csv = await (await page.request.get("/api/export/results?month=2026-01")).text();
  expect(csv).toContain("달별 테스트 가");
  expect(csv).not.toContain("달별 테스트 나");
  // 형식이 틀린 달은 무시하고 전체를 보여 준다
  await page.goto("/results?month=2026-13");
  await expect(page.locator("main")).toContainText("달별 테스트 나");
});

test("같은 모델을 전에 판 기록: 물건 화면에 보여 주되 가격 비교에는 넣지 않는다", async ({ page }) => {
  async function add(name: string) {
    await page.goto("/items/new");
    await page.locator("#category").selectOption("CONSOLE");
    await page.locator("#name").fill(name);
    await page.locator("#identifier").fill("PAST-7");
    await page.locator("#condition").selectOption("GOOD");
    await page.getByRole("button", { name: "저장" }).click();
    await expect(page).toHaveURL(/\/items\/\d+$/);
  }
  await add("전에 판 같은 모델");
  await page.locator("#result-channel").fill("가 장터");
  await page.locator("#result-soldDate").fill("2026-01-20");
  await page.locator("#result-amount").fill("23000");
  await page.locator("#result-costTotal").fill("3000");
  await page.getByRole("button", { name: "판매 결과 저장" }).click();
  await expect(page.getByTestId("result-summary")).toBeVisible();
  await expect(page.getByTestId("past-sales")).toHaveCount(0); // 자기 자신은 나오지 않는다

  await add("지금 팔 같은 모델");
  const past = page.getByTestId("past-sales");
  await expect(past).toContainText("내가 전에 같은 모델명의 물건을 판 기록 1건");
  await expect(past).toContainText("2026-01-20 · 가 장터 · 23,000원 (실수령 20,000원)");
  await expect(page.locator("#prices").getByText("가격 자료 없음")).toBeVisible();
});

test("한 장 요약: 물건 정보·매입 견적·내 계산만 담고 메모와 산 가격은 넣지 않는다", async ({ page }) => {
  await page.goto("/items/new");
  await page.locator("#category").selectOption("CONSOLE");
  await page.locator("#name").fill("요약 테스트 게임기");
  await page.locator("#identifier").fill("SUM-1");
  await page.locator("#condition").selectOption("GOOD");
  await page.locator("#purchaseAmount").fill("55555");
  await page.locator("#memo").fill("비밀 메모 문구");
  await page.getByRole("button", { name: "저장" }).click();
  await expect(page).toHaveURL(/\/items\/\d+$/);
  await page.getByRole("link", { name: "가격 자료 추가" }).click();
  await page.locator("#priceType").selectOption("BUYBACK_QUOTE");
  await page.locator("#amount").fill("30000");
  await page.locator("#sourceName").fill("가 매입점");
  await page.locator("#memo").fill("매장 방문 견적");
  await page.getByRole("button", { name: "가격 자료 저장", exact: true }).click();
  await expect(page).toHaveURL(/\/items\/\d+(#prices)?$/);

  await page.getByRole("link", { name: "한 장 요약" }).click();
  const summary = page.getByTestId("item-summary");
  await expect(summary).toContainText("요약 테스트 게임기");
  await expect(summary).toContainText("SUM-1");
  await expect(page.getByTestId("summary-quotes")).toContainText("가 매입점");
  await expect(page.getByTestId("summary-quotes")).toContainText("30,000원");
  await expect(summary).not.toContainText("비밀 메모 문구");
  await expect(summary).not.toContainText("55,555");
  await expect(page.getByRole("button", { name: "인쇄하기" })).toBeVisible();
});

test("어두운 화면: 운영체제가 어두운 모드면 바탕이 어둡고, 인쇄는 밝게 둔다", async ({ page }) => {
  const lightness = () =>
    page.evaluate(() => {
      // 계산된 배경색(lab·oklch·rgb)에서 밝기를 0~1로 대략 구한다.
      const c = getComputedStyle(document.body).backgroundColor;
      const n = (c.match(/-?[\d.]+/g) ?? []).map(Number);
      if (c.startsWith("lab(")) return n[0]! / 100;
      if (c.startsWith("oklch(")) return n[0]! > 1 ? n[0]! / 100 : n[0]!;
      return (n[0]! + n[1]! + n[2]!) / (3 * 255);
    });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  expect(await lightness()).toBeLessThan(0.3);
  await page.emulateMedia({ colorScheme: "dark", media: "print" });
  expect(await lightness()).toBeGreaterThan(0.9);
  await page.emulateMedia({ colorScheme: "light", media: "screen" });
  await page.reload();
  expect(await lightness()).toBeGreaterThan(0.9);
});

test("화면마다 브라우저 탭 제목이 다르다", async ({ page }) => {
  await page.goto("/triage");
  await expect(page).toHaveTitle("물건 배분 · 얼마에 팔까");
  await page.goto("/");
  await expect(page).toHaveTitle("내 물건 · 얼마에 팔까");
  const first = page.locator('a[href^="/items/"]').filter({ hasNotText: /등록/ }).first();
  if (await first.count()) {
    const href = (await first.getAttribute("href"))!;
    await page.goto(href);
    const name = (await page.locator("h1").textContent())!.trim();
    await expect(page).toHaveTitle(`${name} · 얼마에 팔까`);
    await page.goto(`${href}/summary`);
    await expect(page).toHaveTitle(`${name} 한 장 요약 · 얼마에 팔까`);
  }
  await page.goto("/items/999999");
  await expect(page).not.toHaveTitle(/undefined/);
});

test("인쇄: 데모 띠는 안내 문장만 남고, 머리말과 화면 조작 버튼은 빠진다", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /가상 데이터로 둘러보기/ }).click();
  await expect(page.getByText("데모 모드", { exact: true })).toBeVisible();
  const href = (await page.locator('a[href^="/items/"]').filter({ hasText: "(데모)" }).first().getAttribute("href"))!;
  await page.goto(`${href}/summary`);
  await page.emulateMedia({ media: "print" });
  await expect(page.getByText("데모 모드", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "데모 초기화" })).toBeHidden();
  await expect(page.getByRole("button", { name: "실제 사용으로 돌아가기" })).toBeHidden();
  await expect(page.getByRole("button", { name: /인쇄/ })).toBeHidden();
  await expect(page.locator("header")).toBeHidden();
  await page.emulateMedia({ media: "screen" });
  await page.getByRole("button", { name: "실제 사용으로 돌아가기" }).click();
  await expect(page.getByText("데모 모드", { exact: true })).toHaveCount(0);
});

test("DB 점검: 버튼을 누르면 모든 항목을 보여 주고, 정상 DB는 통과한다", async ({ page }) => {
  await page.goto("/settings#db-health");
  await page.getByRole("button", { name: "지금 점검하기" }).click();
  const box = page.getByTestId("db-health");
  await expect(box).toContainText("모든 점검을 통과했습니다.");
  await expect(page.getByTestId("db-health-integrity")).toContainText("이상 없음");
  await expect(page.getByTestId("db-health-demo_isolation")).toContainText("이상 없음");
  await expect(box.locator("li")).toHaveCount(7);
  await expect(page.getByTestId("data-stats-real")).toContainText("개");
  await expect(page.getByTestId("data-stats-demo")).toContainText("데모");
});

test("물건 한꺼번에: 고른 물건을 판매 중으로 표시하고 휴지통으로 옮기며, 검색 조건은 유지한다", async ({ page }) => {
  const ids: string[] = [];
  for (const name of ["한꺼번에 물건 가", "한꺼번에 물건 나"]) {
    await page.goto("/items/new");
    await page.locator("#category").selectOption("CONSOLE");
    await page.locator("#name").fill(name);
    await page.locator("#condition").selectOption("GOOD");
    await page.getByRole("button", { name: "저장" }).click();
    await expect(page).toHaveURL(/\/items\/\d+$/);
    ids.push(page.url().split("/").pop()!);
  }
  await page.goto("/?q=한꺼번에 물건");
  // 아무것도 고르지 않으면 아무 일도 없다
  await page.getByTestId("bulk-items").getByRole("button", { name: "판매 중으로 표시" }).click();
  await expect(page.getByTestId("bulk-items-notice")).toHaveCount(0);

  // 모두 선택 → 선택 해제 → 다시 모두 선택(검색 결과인 두 물건만 화면에 있다)
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId("bulk-items").locator('[value="TRASH"]')).toBeHidden();
  await page.getByTestId("bulk-items").getByRole("button", { name: "모두 선택" }).click();
  await expect(page.getByTestId("bulk-items").getByRole("button", { name: "휴지통으로" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "한꺼번에 물건 가 선택" })).toBeChecked();
  await page.getByTestId("bulk-items").getByRole("button", { name: "선택 해제" }).click();
  await expect(page.getByRole("checkbox", { name: "한꺼번에 물건 나 선택" })).not.toBeChecked();
  await page.getByTestId("bulk-items").getByRole("button", { name: "모두 선택" }).click();
  await page.getByTestId("bulk-items").getByRole("button", { name: "판매 중으로 표시" }).click();
  await expect(page.getByTestId("bulk-items-notice")).toContainText("물건 2개를 판매 중으로 표시했습니다");
  await expect(page).toHaveURL(/q=/);
  await expect(page.getByRole("link", { name: /한꺼번에 물건 가/ })).toContainText("판매 중");

  await page.getByRole("checkbox", { name: "한꺼번에 물건 나 선택" }).check();
  page.once("dialog", (d) => void d.accept());
  await page.getByTestId("bulk-items").getByRole("button", { name: "휴지통으로" }).click();
  await expect(page.getByTestId("bulk-items-notice")).toContainText("물건 1개를 휴지통으로 옮겼습니다");
  await expect(page.getByRole("link", { name: /한꺼번에 물건 나/ })).toHaveCount(0);
  await page.getByTestId("bulk-items-notice").getByRole("link", { name: "휴지통에서 되살리기" }).click();
  await page.getByTestId(`trashed-${ids[1]}`).getByRole("button", { name: "되살리기" }).click();
  await expect(page.getByTestId(`trashed-${ids[1]}`)).toHaveCount(0);
});

test("물건 배분 거르기: 판단별로 보면 그 판단의 물건만 나오고, 건수 요약은 전체 기준이다", async ({ page }) => {
  // 계산이 없는 물건은 판단 보류다(이 테스트만 따로 돌려도 표가 비지 않게)
  await page.goto("/items/new");
  await page.locator("#category").selectOption("BOOK");
  await page.locator("#name").fill("배분 거르기 책");
  await page.locator("#condition").selectOption("GOOD");
  await page.getByRole("button", { name: "저장" }).click();
  await expect(page).toHaveURL(/\/items\/\d+$/);
  await page.goto("/triage");
  const total = await page.locator("tbody tr[data-testid^='triage-']").count();
  const summary = (await page.getByTestId("triage-counts").locator("p").first().textContent())!;
  await page.getByTestId("triage-filter").getByRole("link", { name: /^판단 보류 \d+$/ }).click();
  await expect(page).toHaveURL(/verdict=UNDECIDED/);
  await expect(page.getByTestId("triage-counts").locator("p").first()).toHaveText(summary);
  const rows = page.locator("tbody tr[data-testid^='triage-']");
  const n = await rows.count();
  expect(n).toBeGreaterThan(0);
  expect(n).toBeLessThanOrEqual(total);
  for (let i = 0; i < n; i++) await expect(rows.nth(i)).toContainText("판단 보류");
  await expect(page.getByTestId("triage-shown")).toContainText(`중 ${n}개를 보고 있습니다`);
  // 알 수 없는 값은 무시하고 전체를 보여 준다
  await page.goto("/triage?verdict=BOGUS&category=NOPE");
  await expect(page.getByTestId("triage-shown")).toHaveCount(0);
});

test("가격 자료 폼: 원문 URL을 붙이면 비어 있는 출처 이름·매물 번호만 주소 모양으로 채운다", async ({ page }) => {
  await page.goto("/items/new");
  await page.locator("#category").selectOption("CONSOLE");
  await page.locator("#name").fill("주소 제안 게임기");
  await page.locator("#condition").selectOption("GOOD");
  await page.getByRole("button", { name: "저장" }).click();
  await expect(page).toHaveURL(/\/items\/\d+$/);
  const itemPath = new URL(page.url()).pathname;
  await page.goto(`${itemPath}/prices/new`);
  await page.locator("#sourceUrl").fill("https://m.bunjang.co.kr/products/987654");
  await page.locator("#sourceUrl").blur();
  await expect(page.locator("#sourceName")).toHaveValue("번개장터");
  await expect(page.locator("#externalId")).toHaveValue("987654");
  await expect(page.getByTestId("url-filled")).toContainText("확인해 주세요");
  // 이미 적은 값은 덮어쓰지 않는다
  await page.locator("#sourceName").fill("내가 적은 출처");
  await page.locator("#sourceUrl").fill("https://web.joongna.com/product/555");
  await page.locator("#sourceUrl").blur();
  await expect(page.locator("#sourceName")).toHaveValue("내가 적은 출처");
  await expect(page.locator("#externalId")).toHaveValue("987654");
});
