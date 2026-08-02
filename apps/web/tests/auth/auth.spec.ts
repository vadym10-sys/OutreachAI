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
    await expect(page.getByRole("heading", { name: "AI-помощник" })).toBeVisible();
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
    await page.goto("/sign-up?plan=Pro", { waitUntil: "domcontentloaded" });
    await expect(page.locator("main")).toContainText(/Регистрация временно недоступна|Создайте аккаунт/);
    await expect(page.getByTestId("selected-plan-summary")).toContainText("Выбранный тариф");
    await expect(page.getByTestId("selected-plan-summary")).toContainText("149");
    await expect(page.locator("main")).not.toContainText("Sign up is temporarily unavailable");
    await expect(page.getByRole("link", { name: "Поддержка" })).toHaveAttribute("href", /^mailto:/);

    await page.goto("/sign-in", { waitUntil: "domcontentloaded" });
    await expect(page.locator("main")).toContainText(/Вход временно недоступен|С возвращением/);
    await expect(page.locator("main")).not.toContainText("Welcome back");
    await expect(page.locator("main")).not.toContainText("Sign in is temporarily unavailable");
    await guards.assertClean();
  });

  test("sign-up validates unknown plan query safely", async ({ page }, testInfo) => {
    const guards = installQaGuards(page, testInfo);
    await page.goto("/sign-up?plan=Enterprise<script>", { waitUntil: "domcontentloaded" });

    await expect(page.getByTestId("selected-plan-summary")).toContainText("Unknown plan selected");
    await expect(page.getByTestId("selected-plan-summary")).toContainText("registration will continue with Starter");
    await expect(page.getByTestId("selected-plan-summary")).toContainText("€49.00/month");
    await expect(page.locator("main")).not.toContainText("<script>");
    await expect(page.getByRole("link", { name: "Support" })).toHaveAttribute("href", /^mailto:/);
    await guards.assertClean();
  });
});
