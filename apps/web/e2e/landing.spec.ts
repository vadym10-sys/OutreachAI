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
