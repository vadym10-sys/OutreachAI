import { expect, test } from "@playwright/test";
import { mockWorkspaceApi } from "../../mocks/workspace-api";
import { installQaGuards } from "../helpers/qa-guards";

test.beforeEach(async ({ page }) => {
  await mockWorkspaceApi(page);
});

test("settings keeps one primary next action and advanced controls collapsed", async ({ page }, testInfo) => {
  const guards = installQaGuards(page, testInfo);
  await page.goto("/dashboard/settings");
  await expect(page.getByRole("heading", { name: "Make the workspace ready for your first campaign." })).toBeVisible();
  await expect(page.getByRole("link", { name: "Find leads" })).toBeVisible();
  const advancedCopy = "Use this area only when a workspace owner needs to adjust";
  await expect(page.locator("details[open]").getByText(advancedCopy)).toHaveCount(0);
  await page.getByText("Advanced settings").first().click();
  await expect(page.locator("details[open]").getByText(advancedCopy).first()).toBeVisible();
  await guards.assertClean();
});
