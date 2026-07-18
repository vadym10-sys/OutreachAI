import { expect, test } from "@playwright/test";
import { mockWorkspaceApi } from "../../mocks/workspace-api";
import { installQaGuards } from "../helpers/qa-guards";

test.beforeEach(async ({ page }) => {
  await mockWorkspaceApi(page);
});

test("dashboard has stable layout and no long first paint regression in test mode", async ({ page }, testInfo) => {
  const guards = installQaGuards(page, testInfo);
  await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "What should I do now?" })).toBeVisible();
  const metrics = await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    return {
      domContentLoaded: nav ? nav.domContentLoadedEventEnd - nav.startTime : 0,
      load: nav ? nav.loadEventEnd - nav.startTime : 0,
      clsEntries: performance.getEntriesByType("layout-shift").length
    };
  });
  expect(metrics.domContentLoaded).toBeLessThan(12000);
  expect(metrics.load).toBeLessThan(20000);
  expect(metrics.clsEntries).toBeLessThan(10);
  await guards.assertClean();
});
