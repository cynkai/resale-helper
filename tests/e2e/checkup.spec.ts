import { expect, test } from "@playwright/test";

test("점검을 항목별로 좁혀 보고 해당 견적과 제안으로 이동한다", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /데모 보기/ }).click();
  await page.getByRole("link", { name: "점검", exact: true }).click();

  const filters = page.getByRole("navigation", { name: "점검 항목 거르기" });
  const expired = filters.getByRole("link", { name: "만료된 견적 1건" });
  const valid = filters.getByRole("link", { name: "유효기간이 남은 견적 1건" });
  const offers = filters.getByRole("link", { name: "답하지 않은 제안 1건" });
  const expiredQuote = page.getByRole("link", { name: "가상매입 센터 9,000원" });
  const validQuote = page.getByRole("link", { name: "가상매입 서점 7,500원" });
  const receivedOffer = page.getByRole("link", { name: "받은 제안 보기" });

  await expect(validQuote).toBeVisible();
  await expect(receivedOffer).toBeVisible();
  await expired.click();
  await expect(page).toHaveURL(/\?kind=QUOTE_EXPIRED$/);
  await expect(expired).toHaveAttribute("aria-current", "true");
  await expect(valid).toBeVisible();
  await expect(validQuote).toHaveCount(0);
  await expect(receivedOffer).toHaveCount(0);

  await expiredQuote.click();
  await expect(page).toHaveURL(/#price-\d+$/);
  await expect(page.locator("tr:target")).toContainText("가상매입 센터");

  await page.goBack();
  await expect(expired).toHaveAttribute("aria-current", "true");
  await offers.click();
  await expect(expiredQuote).toHaveCount(0);
  await receivedOffer.click();
  await expect(page).toHaveURL(/#offers$/);
  await expect(page.locator("#offers:target")).toContainText("답하지 않음 1건");

  await page.goto("/checkup?kind=OLD_DATA");
  await expect(page.getByText("이 조건에 해당하는 점검 항목이 없습니다.")).toBeVisible();
  await filters.getByRole("link", { name: "모든 항목" }).click();
  await expect(expiredQuote).toBeVisible();
  await expect(validQuote).toBeVisible();

  await page.goto("/checkup?kind=unknown");
  await expect(filters.getByRole("link", { name: "모든 항목" })).toHaveAttribute("aria-current", "true");
});
