import { expect, test } from "@playwright/test";
import { installQaGuards } from "../tests/helpers/qa-guards";

const supportHref = "mailto:outreachaiaiai@gmail.com";

const visibleLanguageSelect = (page: import("@playwright/test").Page) =>
  page.locator('select[aria-label="Language"]:visible').first();

test("landing explains the B2B outbound product and pricing", async ({ page }, testInfo) => {
  const guards = installQaGuards(page, testInfo);
  await page.goto("/");
  const main = page.getByRole("main");
  await expect(page.getByRole("heading", { name: "Find the right companies. Understand why they will buy. Reach out with AI." })).toBeVisible();
  await expect(main.getByText("OutreachAI understands your business, finds relevant companies").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Start finding customers" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Login" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "View demo dashboard" })).toHaveCount(0);
  await expect(main.getByText("Business description", { exact: true })).toBeVisible();
  await expect(main.getByText("Company with evidence", { exact: true })).toBeVisible();
  await expect(main.getByText("Manual confirmation", { exact: true })).toBeVisible();
  await expect(main.getByText("Demo evidence uses safe fixture data, not customer production records.", { exact: true })).toBeVisible();
  await expect(main).toContainText("49 EUR/month");
  await expect(main).toContainText("149 EUR/month");
  await expect(main).toContainText("499 EUR/month");
  await expect(main).toContainText("500 leads per month");
  await expect(main).toContainText("50,000 leads per month");
  await expect(main).toContainText("14 day trial");
  await expect(main.getByRole("link", { name: "Choose Starter" })).toHaveAttribute("href", "/sign-up?plan=Starter");
  await expect(main.getByRole("link", { name: "Choose Pro" })).toHaveAttribute("href", "/sign-up?plan=Pro");
  await expect(main.getByRole("link", { name: "Choose Agency" })).toHaveAttribute("href", "/sign-up?plan=Agency");
  await expect(page.locator("#contact").getByRole("link", { name: "outreachaiaiai@gmail.com" })).toHaveAttribute("href", supportHref);
  await expect(main).not.toContainText("Clerk");
  await expect(main).not.toContainText("Stripe");
  await expect(page.getByRole("heading", { name: "AI Lead Intelligence" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Explainable AI" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Starter" }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Pro" }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Agency" }).first()).toBeVisible();
  await guards.assertClean();
});

test("landing follows the selected language without mixed English hero copy", async ({ page }, testInfo) => {
  const guards = installQaGuards(page, testInfo);
  await page.goto("/");
  const main = page.getByRole("main");
  await visibleLanguageSelect(page).selectOption("ru");

  await expect(page.getByRole("heading", { name: "Находите подходящие компании. Понимайте, почему они купят. Готовьте письма с ИИ." })).toBeVisible();
  await expect(page.getByText("OutreachAI понимает ваш бизнес")).toBeVisible();
  await expect(page.getByRole("link", { name: "Начать поиск клиентов" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Войти" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Посмотреть демо-панель" })).toHaveCount(0);
  await expect(main.getByText("Описание бизнеса", { exact: true })).toBeVisible();
  await expect(main.getByText("Компания с доказательствами", { exact: true })).toBeVisible();
  await expect(main.locator("p", { hasText: "Ручное подтверждение" }).first()).toBeVisible();
  await expect(main).toContainText("49 EUR/месяц");
  await expect(main).toContainText("14 дней пробного периода");
  await expect(main.getByRole("link", { name: /Выбрать Starter/ })).toBeVisible();
  await expect(page.locator("#contact").getByRole("link", { name: "outreachaiaiai@gmail.com" })).toHaveAttribute("href", supportHref);
  await expect(main).not.toContainText("AI Sales Employee for B2B Lead Generation");
  await expect(main).not.toContainText("Find qualified companies, analyze their websites");
  await expect(main).not.toContainText("Start free trial");
  await expect(main).not.toContainText("Questions before signing up?");
  await guards.assertClean();
});

for (const width of [360, 390, 430]) {
  test(`Russian mobile landing has no horizontal overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/");
    await visibleLanguageSelect(page).selectOption("ru");

    await expect(page.getByRole("heading", { name: "Находите подходящие компании. Понимайте, почему они купят. Готовьте письма с ИИ." })).toBeVisible();
    await expect(page.getByRole("main").getByTestId("hero-start-free-trial")).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Something went wrong");

    const metrics = await page.evaluate(() => {
      const ctaRect = document.querySelector('[data-testid="hero-start-free-trial"]')?.getBoundingClientRect();
      const headingRect = Array.from(document.querySelectorAll("h1"))
        .find((heading) => heading.textContent?.includes("Находите подходящие компании"))
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
  await visibleLanguageSelect(page).selectOption("ru");

  await expect(page.getByRole("heading", { name: "Находите подходящие компании. Понимайте, почему они купят. Готовьте письма с ИИ." })).toBeVisible();
  await expect(page.getByRole("main").getByTestId("hero-start-free-trial")).toBeVisible();
  const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1 || document.body.scrollWidth > window.innerWidth + 1);
  expect(hasOverflow).toBe(false);
  await context.close();
});

test("start free trial opens the real sign-up flow instead of a demo dashboard", async ({ page }) => {
  await page.goto("/");
  const primaryCta = page.getByRole("main").getByTestId("hero-start-free-trial");
  await Promise.all([
    page.waitForURL("**/sign-up?plan=Starter", { timeout: 15000 }),
    primaryCta.click()
  ]);
  await expect(page.locator("main")).toBeVisible();
  await expect(page.locator("main")).not.toContainText("Loading OutreachAI");
  await expect(page.getByRole("heading", { name: /Create your account|Sign up is temporarily unavailable/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "View demo dashboard" })).toHaveCount(0);
});
