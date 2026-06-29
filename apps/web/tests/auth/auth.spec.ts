import { expect, test } from "@playwright/test";
import { mockWorkspaceApi } from "../../mocks/workspace-api";
import { expectNoBrokenImages, installQaGuards } from "../helpers/qa-guards";

test.describe("authentication UX", () => {
  for (const route of ["/sign-in", "/sign-up", "/forgot-password"]) {
    test(`${route} renders without duplicate or broken auth UI`, async ({ page }, testInfo) => {
      const guards = installQaGuards(page, testInfo);
      await page.goto(route);
      await expect(page.locator("main")).toBeVisible();
      await expectNoBrokenImages(page);
      await guards.assertClean();
    });
  }

  test("dashboard is available in QA bypass mode for authenticated-flow tests", async ({ page }) => {
    await mockWorkspaceApi(page);
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "What should I do now?" })).toBeVisible();
  });
});
