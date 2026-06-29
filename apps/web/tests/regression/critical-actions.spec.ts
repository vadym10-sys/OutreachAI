import { expect, test } from "@playwright/test";
import { mockWorkspaceApi } from "../../mocks/workspace-api";
import { installQaGuards } from "../helpers/qa-guards";

test.beforeEach(async ({ page }) => {
  await mockWorkspaceApi(page);
});

test("lead search has loading, success, saved CRM result, and no global crash", async ({ page }, testInfo) => {
  const guards = installQaGuards(page, testInfo);
  await page.goto("/dashboard/leads");
  const leadSearch = page.getByRole("form", { name: "Lead search" });
  await leadSearch.getByLabel("Country").fill("Germany");
  await leadSearch.getByLabel("City").fill("Berlin");
  await leadSearch.getByLabel("Industry").fill("Construction");
  await leadSearch.getByRole("button", { name: "Find leads" }).click();
  await expect(page.getByLabel("Lead search progress").getByText("Saved to CRM")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Hill Country Build Co" }).first()).toBeVisible();
  await guards.assertClean();
});

test("manual company entry saves to CRM and becomes a research opportunity", async ({ page }, testInfo) => {
  const guards = installQaGuards(page, testInfo);
  await page.goto("/dashboard/leads");
  const manualEntry = page.getByRole("form", { name: "Manual company entry" });
  await manualEntry.getByLabel("Company name").fill("Berlin Roof Systems");
  await manualEntry.getByLabel("Website").fill("https://berlin-roof.example");
  await manualEntry.getByLabel("Country").fill("Germany");
  await manualEntry.getByLabel("City").fill("Berlin");
  await manualEntry.getByLabel("Industry").fill("Construction");
  await manualEntry.getByRole("button", { name: /Save company to CRM/ }).click();
  await expect(page.getByText("Berlin Roof Systems was saved to CRM. Next: complete sales research.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Berlin Roof Systems" })).toBeVisible();
  await expect(page.getByText("Ready for company research")).toBeVisible();
  await guards.assertClean();
});

test("campaign actions stay review-first and provide clear status", async ({ page }, testInfo) => {
  const guards = installQaGuards(page, testInfo);
  await page.goto("/dashboard/campaigns");
  await expect(page.getByText("Review before send: enabled")).toBeVisible();
  await page.getByRole("button", { name: /Launch after approval/ }).click();
  await expect(page.getByText(/Emails still require approved drafts/)).toBeVisible();
  await page.getByRole("button", { name: /Pause/ }).click();
  await expect(page.getByText(/is now Paused/)).toBeVisible();
  await guards.assertClean();
});

test("CRM stage and note actions do not silently fail", async ({ page }, testInfo) => {
  const guards = installQaGuards(page, testInfo);
  await page.goto("/dashboard/companies");
  await page.getByRole("main").getByRole("combobox").selectOption("Meeting Scheduled");
  await page.getByRole("button", { name: /Move stage/ }).click();
  await expect(page.getByText("CRM stage moved to Meeting Scheduled.")).toBeVisible();
  await page.getByLabel("Add note").fill("Follow up next week.");
  await page.getByRole("button", { name: /Add note/ }).click();
  await expect(page.getByText("Note saved to the activity history.")).toBeVisible();
  await guards.assertClean();
});
