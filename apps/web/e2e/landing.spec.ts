import { expect, test } from "@playwright/test";

test("landing explains the B2B outbound product and pricing", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "AI Sales Employee for B2B Lead Generation" })).toBeVisible();
  await expect(page.getByText("Find qualified companies, analyze their websites, generate personalized outreach")).toBeVisible();
  await expect(page.getByRole("link", { name: "Start free trial" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Login" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "View demo dashboard" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Lead Finder" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Decision Maker Finder" })).toBeVisible();
  await expect(page.getByText("Starter")).toBeVisible();
  await expect(page.getByText("€149")).toBeVisible();
  await expect(page.getByText("€499")).toBeVisible();
});

test("landing follows the selected language without mixed English hero copy", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Language").selectOption("ru");

  await expect(page.getByRole("heading", { name: "AI сотрудник продаж для поиска B2B клиентов" })).toBeVisible();
  await expect(page.getByText("Находите подходящие компании, анализируйте их сайты")).toBeVisible();
  await expect(page.getByRole("link", { name: "Начать бесплатно" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Войти" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Посмотреть демо-панель" })).toHaveCount(0);
  await expect(page.locator("main")).not.toContainText("AI Sales Employee for B2B Lead Generation");
  await expect(page.locator("main")).not.toContainText("Find qualified companies, analyze their websites");
  await expect(page.locator("main")).not.toContainText("Start free trial");
});

for (const width of [360, 390, 430]) {
  test(`Russian mobile landing has no horizontal overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/");
    await page.evaluate(() => {
      window.localStorage.setItem("outreachai.locale", "ru");
      document.cookie = "outreachai_locale=ru; path=/; max-age=31536000; SameSite=Lax";
    });
    await page.reload({ waitUntil: "networkidle" });

    await expect(page.getByRole("heading", { name: "AI сотрудник продаж для поиска B2B клиентов" })).toBeVisible();
    await expect(page.getByTestId("hero-start-free-trial")).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Something went wrong");

    const metrics = await page.evaluate(() => {
      const ctaRect = document.querySelector('[data-testid="hero-start-free-trial"]')?.getBoundingClientRect();
      const headingRect = Array.from(document.querySelectorAll("h1"))
        .find((heading) => heading.textContent?.includes("AI сотрудник"))
        ?.getBoundingClientRect();
      return {
        innerWidth: window.innerWidth,
        documentScrollWidth: document.documentElement.scrollWidth,
        bodyScrollWidth: document.body.scrollWidth,
        cta: ctaRect ? { left: ctaRect.left, right: ctaRect.right, width: ctaRect.width } : null,
        heading: headingRect ? { left: headingRect.left, right: headingRect.right, width: headingRect.width } : null
      };
    });

    expect(metrics.documentScrollWidth).toBeLessThanOrEqual(metrics.innerWidth + 1);
    expect(metrics.bodyScrollWidth).toBeLessThanOrEqual(metrics.innerWidth + 1);
    expect(metrics.cta).not.toBeNull();
    expect(metrics.heading).not.toBeNull();
    expect(metrics.cta!.left).toBeGreaterThanOrEqual(0);
    expect(metrics.cta!.right).toBeLessThanOrEqual(metrics.innerWidth + 1);
    expect(metrics.heading!.left).toBeGreaterThanOrEqual(0);
    expect(metrics.heading!.right).toBeLessThanOrEqual(metrics.innerWidth + 1);
  });
}

test("Russian landing works in Telegram-like in-app mobile browser", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Telegram/10.14 Mobile/15E148 Safari/604.1"
  });
  const page = await context.newPage();
  await page.goto("/");
  await page.evaluate(() => {
    window.localStorage.setItem("outreachai.locale", "ru");
    document.cookie = "outreachai_locale=ru; path=/; max-age=31536000; SameSite=Lax";
  });
  await page.reload({ waitUntil: "networkidle" });

  await expect(page.getByRole("heading", { name: "AI сотрудник продаж для поиска B2B клиентов" })).toBeVisible();
  await expect(page.getByTestId("hero-start-free-trial")).toBeVisible();
  const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1 || document.body.scrollWidth > window.innerWidth + 1);
  expect(hasOverflow).toBe(false);
  await context.close();
});

test("start free trial opens the real sign-up flow instead of a demo dashboard", async ({ page }) => {
  await page.goto("/");
  await Promise.all([
    page.waitForURL("**/sign-up?plan=Starter", { timeout: 15000 }),
    page.getByTestId("hero-start-free-trial").click()
  ]);
  await expect(page.locator("main")).toBeVisible();
  await expect(page.locator("main")).not.toContainText("Loading OutreachAI");
  await expect(page.getByRole("heading", { name: /Create your account|Sign up is temporarily unavailable/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "View demo dashboard" })).toHaveCount(0);
});
