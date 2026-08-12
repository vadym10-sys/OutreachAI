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
  await expect(page.getByText("Provider: Gmail OAuth")).toBeVisible();
  await expect(page.getByText("Mailbox: qa.sender@example.com")).toBeVisible();
  await expect(page.getByText("OAuth status: connected")).toBeVisible();
  await expect(page.getByText("AI Memory")).toBeVisible();
  await expect(page.getByText("Workspace memory is on")).toBeVisible();
  await expect(page.getByText("Business profile: OutreachAI sells AI-powered outbound workflow software.")).toBeVisible();
  await guards.assertClean();
});

test("workspace save validates required fields and shows the save result", async ({ page }) => {
  await page.goto("/dashboard/settings");
  await expect(page.getByRole("heading", { name: "Workspace" })).toBeVisible();

  await page.getByLabel("Company").fill("");
  await page.getByRole("button", { name: "Save workspace" }).click();
  await expect(page.getByText("Complete these workspace fields before saving: Company.")).toBeVisible();

  await page.getByLabel("Company").fill("Outreachaiaiai.com");
  const saveResponse = page.waitForResponse((response) =>
    response.request().method() === "PUT" && response.url().includes("/api/workspace")
  );
  await page.getByRole("button", { name: "Save workspace" }).click();
  const response = await saveResponse;
  expect(response.ok()).toBe(true);
  const body = await response.json();
  expect(body.onboarding_completed).toBe(true);
  expect(body.onboarding_step).toBe(6);
  await expect(page.getByText("Workspace settings saved.")).toBeVisible();
});
