import { expect, test } from "@playwright/test";
import { mockWorkspaceApi } from "../../mocks/workspace-api";
import { installQaGuards } from "../helpers/qa-guards";

test.beforeEach(async ({ page }) => {
  await mockWorkspaceApi(page);
});

test("dashboard shell has accessible landmarks and keyboard focus", async ({ page }, testInfo) => {
  const guards = installQaGuards(page, testInfo);
  await page.goto("/dashboard");
  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.getByRole("navigation").first()).toBeVisible();
  await page.keyboard.press("Tab");
  const focusedTag = await page.evaluate(() => document.activeElement?.tagName);
  expect(focusedTag).toMatch(/A|BUTTON|SELECT|INPUT/);
  await guards.assertClean();
});

test("mobile navigation exposes touch-friendly primary routes", async ({ page }, testInfo) => {
  const guards = installQaGuards(page, testInfo);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard");
  for (const label of ["Dashboard", "Leads", "Companies", "Campaigns"]) {
    await expect(page.getByRole("link", { name: label }).last()).toBeVisible();
  }
  await guards.assertClean();
});
