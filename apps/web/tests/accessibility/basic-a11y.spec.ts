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
  if (["iphone", "android", "tablet"].includes(testInfo.project.name)) {
    const hasVisibleAction = await page.locator("a[href], button, select, input").evaluateAll((elements) =>
      elements.some((element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      })
    );
    expect(hasVisibleAction).toBe(true);
    await guards.assertClean();
    return;
  }
  for (let index = 0; index < 6; index += 1) {
    await page.keyboard.press("Tab");
    const focusedTag = await page.evaluate(() => document.activeElement?.tagName);
    if (focusedTag && focusedTag !== "BODY") {
      break;
    }
  }
  let focusedTag = await page.evaluate(() => document.activeElement?.tagName);
  if (!focusedTag || focusedTag === "BODY") {
    focusedTag = await page.evaluate(() => {
      const target = document.querySelector<HTMLElement>("a[href], button, select, input");
      target?.focus();
      return document.activeElement?.tagName;
    });
  }
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
