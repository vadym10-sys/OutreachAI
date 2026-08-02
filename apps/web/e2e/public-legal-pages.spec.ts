import { expect, test } from "@playwright/test";
import { installQaGuards } from "../tests/helpers/qa-guards";

const pages = [
  { path: "/privacy", heading: "Privacy Policy" },
  { path: "/terms", heading: "Terms of Service" },
  { path: "/security", heading: "Security" },
] as const;

const landingFooterLinks = [
  { name: "Privacy", href: "/privacy" },
  { name: "Terms", href: "/terms" },
  { name: "Security", href: "/security" },
] as const;

const supportHref = "mailto:outreachaiaiai@gmail.com";

for (const legalPage of pages) {
  test(`${legalPage.path} opens directly and keeps public navigation`, async ({ page }, testInfo) => {
    const guards = installQaGuards(page, testInfo);
    const response = await page.goto(legalPage.path);

    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: legalPage.heading, level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: "OutreachAI" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Login" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Legal pages" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Privacy Policy" })).toHaveAttribute("href", "/privacy");
    await expect(page.getByRole("link", { name: "Terms of Service" })).toHaveAttribute("href", "/terms");
    await expect(page.getByRole("link", { name: "Security" })).toHaveAttribute("href", "/security");
    await expect(page.getByRole("link", { name: "Support" })).toHaveAttribute("href", supportHref);
    await expect(page.locator("body")).not.toContainText("404");
    await guards.assertClean();
  });
}

test("privacy page localizes visible Russian legal copy", async ({ page }, testInfo) => {
  const guards = installQaGuards(page, testInfo);
  await page.goto("/privacy");
  await page.locator('select[aria-label="Language"]:visible').first().selectOption("ru");

  const main = page.getByRole("main");
  await expect(page.getByRole("heading", { name: "Политика конфиденциальности", level: 1 })).toBeVisible();
  await expect(main).toContainText("Какие данные мы собираем");
  await expect(main).toContainText("Запросы по вопросам конфиденциальности и безопасности");
  await expect(main).not.toContainText("Information we collect");
  await expect(main).not.toContainText("Last updated");
  await guards.assertClean();
});

test("public legal pages fit mobile viewport without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });

  for (const legalPage of pages) {
    const response = await page.goto(legalPage.path);

    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: legalPage.heading, level: 1 })).toBeVisible();

    const metrics = await page.evaluate(() => ({
      innerWidth: window.innerWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
    }));

    expect(metrics.documentScrollWidth).toBeLessThanOrEqual(metrics.innerWidth + 1);
    expect(metrics.bodyScrollWidth).toBeLessThanOrEqual(metrics.innerWidth + 1);
  }
});

test("landing footer links to public legal pages and support", async ({ page }) => {
  await page.goto("/");

  const footer = page.locator("footer");
  await expect(footer.getByRole("navigation", { name: "Legal" })).toBeVisible();

  for (const link of landingFooterLinks) {
    await expect(footer.getByRole("link", { name: link.name })).toHaveAttribute("href", link.href);
  }
  await expect(footer.getByRole("link", { name: "Support" })).toHaveAttribute("href", supportHref);
});
