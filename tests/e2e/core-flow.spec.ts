import { expect, test, type Page } from "@playwright/test";

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
    "price_type,amount,source_name,external_id,checked_date",
    "SOLD_LISTING,16000,테스트마켓,S-1,2026-01-05",
    "VERIFIED_SALE,16000,테스트마켓,S-2,2026-01-05",
    "ASKING,1.5만,테스트마켓,S-3,2026-01-05",
  ].join("\n");
  await page.locator("#csv-file").setInputFiles({ name: "prices.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.getByRole("button", { name: "가져오기" }).click();
  await expect(page.getByText("1건을 가져왔고, 2건은 오류로 건너뛰었습니다.")).toBeVisible();
  await expect(page.locator("#prices")).toContainText("3행");
  await expect(page.locator("#prices")).toContainText("4행");
  await expect(page.getByTestId("group-SOLD_LISTING")).toContainText("CSV 가져오기");

  const res = await page.request.get(`/api/export/prices`);
  expect(res.headers()["content-disposition"]).toContain("prices-all-");
  const text = await res.text();
  expect(text).toContain("price_type,amount,currency");
  expect(text.trim().split("\r\n")).toHaveLength(6); // 머리글 + 5건
  expect(text).not.toContain("true"); // is_demo=true 행 없음
});

test("데모는 명시적으로 들어가야 하고, 가상 데이터 표시가 붙으며 실제 자료와 섞이지 않는다", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("데모 모드")).toHaveCount(0);
  await page.getByRole("button", { name: /데모 보기/ }).click();

  await expect(page.getByRole("status").filter({ hasText: "데모 모드" })).toContainText("가상 데이터");
  await expect(page.getByRole("link", { name: /선형대수학 입문/ })).toHaveCount(0);
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
