import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { mockWorkspaceApi } from "../mocks/workspace-api";
import { expectNoBrokenImages, expectNoHorizontalOverflow } from "../tests/helpers/qa-guards";

function installStrictRuntimeGuards(page: Page, testInfo: TestInfo) {
  const failures: Array<{ type: string; message: string }> = [];
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type()) && !/LogRocket|preload/i.test(message.text())) {
      failures.push({ type: `console:${message.type()}`, message: message.text() });
    }
  });
  page.on("pageerror", (error) => {
    if (/due to access control checks/i.test(error.message)) return;
    failures.push({ type: "pageerror", message: error.message });
  });
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.pathname.startsWith("/api/") && response.status() >= 500) {
      failures.push({ type: "api-response", message: `${response.status()} ${url.pathname}` });
    }
  });
  return {
    async assertClean() {
      if (failures.length) {
        await testInfo.attach("manual-runtime-failures.json", {
          body: JSON.stringify(failures, null, 2),
          contentType: "application/json"
        });
      }
      expect(failures).toEqual([]);
    }
  };
}

async function expectHealthyPage(page: Page, heading: string) {
  await expect(page.getByRole("heading", { name: heading })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("main")).not.toContainText("Something went wrong");
  await expect(page.getByRole("main")).not.toContainText("Failed to fetch");
  await expectNoBrokenImages(page);
  await expectNoHorizontalOverflow(page);
}

test.describe("manual production-readiness journey", () => {
  test.beforeEach(async ({ page }) => {
    await mockWorkspaceApi(page);
  });

  test("desktop AI-first path has clean runtime and manual email gate", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "Desktop readiness runs once on Chromium.");
    test.setTimeout(75_000);
    const guards = installStrictRuntimeGuards(page, testInfo);

    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    await expectHealthyPage(page, "AI-помощник");
    await page.getByRole("form", { name: "AI customer command" }).getByLabel("AI command").fill("Мы продаём AI-систему для B2B. Найди подходящих клиентов в Германии.");
    await expect(page.getByRole("button", { name: "Запустить AI" })).toBeEnabled({ timeout: 20_000 });
    await page.getByRole("button", { name: "Запустить AI" }).click();
    await expect(page.getByText("Я понял ваш бизнес так")).toBeVisible();
    await expect(page.getByText("qa.sender@example.com через Gmail OAuth")).toBeVisible();
    await expect(page.getByRole("button", { name: "Разрешить эту кампанию" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Остановить" })).toBeVisible();
    await guards.assertClean();
  });

  test("mobile AI-first path keeps layout stable", async ({ page }, testInfo) => {
    test.skip(!["iphone", "android"].includes(testInfo.project.name), "Mobile journey runs on phone-sized projects.");
    const guards = installStrictRuntimeGuards(page, testInfo);
    for (const [route, heading] of [
      ["/dashboard", "AI-помощник"],
      ["/dashboard/clients", "Клиенты"],
      ["/dashboard/emails", "Письма"],
      ["/dashboard/settings", "Настройки"]
    ] as const) {
      await page.goto(route, { waitUntil: "domcontentloaded" });
      await expectHealthyPage(page, heading);
      await page.reload({ waitUntil: "domcontentloaded" });
      await expectHealthyPage(page, heading);
    }
    await guards.assertClean();
  });
});
