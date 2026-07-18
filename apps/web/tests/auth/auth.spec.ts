import { expect, test } from "@playwright/test";
import { mockWorkspaceApi } from "../../mocks/workspace-api";
import { expectNoBrokenImages, installQaGuards } from "../helpers/qa-guards";

test.describe("authentication UX", () => {
  for (const route of ["/sign-in", "/sign-up", "/forgot-password"]) {
    test(`${route} renders without duplicate or broken auth UI`, async ({ page }, testInfo) => {
      const guards = installQaGuards(page, testInfo);
      await page.goto(route, { waitUntil: "domcontentloaded" });
      await expect(page.locator("main")).toBeVisible();
      await expectNoBrokenImages(page);
      await guards.assertClean();
    });
  }

  test("dashboard is available in QA bypass mode for authenticated-flow tests", async ({ page }) => {
    await mockWorkspaceApi(page);
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Find customers → CRM → first email." })).toBeVisible();
  });

  test("selected Russian language also localizes auth fallbacks", async ({ page }, testInfo) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("outreachai.locale", "ru");
    });
    await page.context().addCookies([{
      name: "outreachai_locale",
      value: "ru",
      domain: "127.0.0.1",
      path: "/",
      sameSite: "Lax"
    }]);

    const guards = installQaGuards(page, testInfo);
    await page.goto("/sign-up", { waitUntil: "domcontentloaded" });
    await expect(page.locator("main")).toContainText(/Регистрация временно недоступна|Создайте аккаунт/);
    await expect(page.locator("main")).not.toContainText("Sign up is temporarily unavailable");

    await page.goto("/sign-in", { waitUntil: "domcontentloaded" });
    await expect(page.locator("main")).toContainText(/Вход временно недоступен|С возвращением/);
    await expect(page.locator("main")).not.toContainText("Welcome back");
    await expect(page.locator("main")).not.toContainText("Sign in is temporarily unavailable");
    await guards.assertClean();
  });
});
