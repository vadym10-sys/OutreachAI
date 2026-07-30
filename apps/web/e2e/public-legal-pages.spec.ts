import { expect, test } from "@playwright/test";

const pages = [
  { path: "/privacy", heading: "Privacy Policy" },
  { path: "/terms", heading: "Terms of Service" },
  { path: "/security", heading: "Security" },
] as const;

for (const legalPage of pages) {
  test(`${legalPage.path} opens directly and keeps public navigation`, async ({ page }) => {
    const response = await page.goto(legalPage.path);

    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: legalPage.heading, level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: "OutreachAI" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Login" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Legal pages" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Privacy Policy" })).toHaveAttribute("href", "/privacy");
    await expect(page.getByRole("link", { name: "Terms of Service" })).toHaveAttribute("href", "/terms");
    await expect(page.getByRole("link", { name: "Security" })).toHaveAttribute("href", "/security");
    await expect(page.locator("body")).not.toContainText("404");
  });
}

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
