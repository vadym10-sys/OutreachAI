import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { installQaGuards } from "../tests/helpers/qa-guards";

const ruHero = "Находите подходящие компании. Понимайте, почему они купят. Готовьте письма с ИИ.";
const autonomyRu = "Автономность может охватывать поиск, анализ и подготовку, но каждая реальная отправка письма всё равно требует отдельного подтверждения пользователя.";
const forbiddenRussianPhrases = [
  "Find the right companies",
  "Understand why they will buy",
  "Reach out with AI",
  "Draft-only",
  "Demonstration fixture",
  "Quality Gate",
  "Autonomous mode included",
  "workspace limit",
  "day trial",
  "Last updated",
  "Information we collect",
  "Terms of Service",
  "Security approach",
  "Start with Google, Apple, or your work email."
];

async function setRussianCookie(page: Page) {
  await page.context().addCookies([{ name: "outreachai_locale", value: "ru", domain: "127.0.0.1", path: "/" }]);
}

async function expectNoForbiddenEnglish(page: Page) {
  const bodyText = await page.locator("body").innerText();
  for (const phrase of forbiddenRussianPhrases) {
    expect(bodyText).not.toContain(phrase);
  }
}

async function openRussianPage(page: Page, path: string, testInfo: TestInfo) {
  const guards = installQaGuards(page, testInfo);
  await setRussianCookie(page);
  await page.goto(path);
  return guards;
}

for (const viewport of [
  { name: "desktop", width: 1366, height: 768 },
  { name: "mobile", width: 390, height: 844 }
] as const) {
  test(`Russian public localization is complete on ${viewport.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const guards = await openRussianPage(page, "/", testInfo);

    await expect(page.getByRole("heading", { name: ruHero })).toBeVisible();
    await expect(page.getByRole("main")).toContainText("Автономный поиск, анализ и подготовка включены; отправка писем только после отдельного подтверждения пользователя");
    await expect(page.getByRole("main")).toContainText(autonomyRu);
    await expect(page.getByRole("main")).toContainText("3 рабочих пространства");
    await expectNoForbiddenEnglish(page);
    await guards.assertClean();
  });
}

test("legacy localStorage locale is migrated before hydration without console errors", async ({ page }, testInfo) => {
  const guards = installQaGuards(page, testInfo);
  await page.addInitScript(() => {
    window.localStorage.setItem("outreachai.locale", "ru");
  });

  await page.goto("/");

  await expect(page.getByRole("heading", { name: ruHero })).toBeVisible();
  const cookie = await page.evaluate(() => document.cookie);
  expect(cookie).toContain("outreachai_locale=ru");
  await expectNoForbiddenEnglish(page);
  await guards.assertClean();
});

for (const plan of ["Starter", "Pro", "Agency"] as const) {
  test(`Russian sign-up keeps selected ${plan} plan localized`, async ({ page }, testInfo) => {
    const guards = await openRussianPage(page, `/sign-up?plan=${plan}`, testInfo);

    await expect(page.getByRole("heading", { name: "Регистрация временно недоступна" }).or(page.getByRole("heading", { name: "Создайте аккаунт" }))).toBeVisible();
    await expect(page.getByTestId("selected-plan-summary")).toContainText(`Выбранный тариф: ${plan}`);
    await expect(page.getByTestId("selected-plan-summary")).toContainText("14 дней пробного периода");
    await expect(page.getByTestId("selected-plan-summary")).toContainText("лидов в месяц");
    await expect(page.getByTestId("selected-plan-summary")).toContainText("генераций ИИ в месяц");
    await expectNoForbiddenEnglish(page);
    await guards.assertClean();
  });
}

for (const legalPage of [
  { path: "/privacy", heading: "Политика конфиденциальности" },
  { path: "/terms", heading: "Условия обслуживания" },
  { path: "/security", heading: "Безопасность" }
] as const) {
  test(`${legalPage.path} uses Russian legal copy and manual-send boundary`, async ({ page }, testInfo) => {
    const guards = await openRussianPage(page, legalPage.path, testInfo);

    await expect(page.getByRole("heading", { name: legalPage.heading, level: 1 })).toBeVisible();
    await expect(page.getByRole("main")).toContainText("31 июля 2026 г.");
    await expect(page.getByRole("main")).toContainText("каждая реальная отправка письма всё равно требует отдельного подтверждения пользователя");
    await expect(page.getByRole("link", { name: "Поддержка" })).toHaveAttribute("href", "mailto:outreachaiaiai@gmail.com");
    await expectNoForbiddenEnglish(page);
    await guards.assertClean();
  });
}
