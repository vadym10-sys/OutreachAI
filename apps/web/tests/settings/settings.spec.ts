import { expect, test } from "@playwright/test";
import { mockWorkspaceApi } from "../../mocks/workspace-api";
import { installQaGuards } from "../helpers/qa-guards";

test.beforeEach(async ({ page }) => {
  await mockWorkspaceApi(page);
});

test("settings show real workspace, integration, and sender readiness", async ({ page }, testInfo) => {
  const guards = installQaGuards(page, testInfo);
  await page.goto("/dashboard/settings");
  await expect(page.getByRole("heading", { name: "Настройки" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Workspace" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Integrations" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Email sender" })).toBeVisible();
  await expect(page.getByText("Lead search")).toBeVisible();
  await expect(page.getByText(/connected: qa.sender@example.com|Ready to send through the connected Gmail mailbox/i)).toBeVisible();
  await guards.assertClean();
});
