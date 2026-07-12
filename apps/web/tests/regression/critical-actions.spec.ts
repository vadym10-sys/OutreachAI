import { expect, test } from "@playwright/test";
import { mockWorkspaceApi, qaCompany } from "../../mocks/workspace-api";
import { installQaGuards } from "../helpers/qa-guards";

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ page }) => {
  await mockWorkspaceApi(page);
});

test("lead search has loading, success, saved CRM result, and no global crash", async ({ page }, testInfo) => {
  const guards = installQaGuards(page, testInfo);
  let leadFindRequests = 0;
  await page.route("**/api/workspace-app/leads/search", async (route) => {
    leadFindRequests += 1;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ request_id: "qa-search", status: "success", provider_status: { google_maps: "success", hunter: "success", openai: "success", database: "success" }, companies: [qaCompany], saved_count: 1, duplicates_skipped: 0, warnings: [], message: "Found 1 company. Saved to CRM." }) });
  });
  await page.goto("/dashboard/leads");
  const leadSearch = page.getByRole("form", { name: "Lead search" });
  await leadSearch.getByLabel("Country").fill("Germany");
  await leadSearch.getByLabel("City").fill("Berlin");
  await leadSearch.getByLabel("Industry").fill("Construction");
  await leadSearch.getByRole("button", { name: "Find leads" }).click();
  await expect(page.getByLabel("Lead search progress").getByText("Saved to CRM")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Hill Country Build Co" }).first()).toBeVisible();
  expect(leadFindRequests).toBe(1);
  await guards.assertClean();
});

test("lead search empty result finishes with guidance and retry", async ({ page }, testInfo) => {
  const guards = installQaGuards(page, testInfo);
  await page.route("**/api/workspace-app/leads/search", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ request_id: "qa-empty", status: "empty", provider_status: { google_maps: "empty", hunter: "skipped", openai: "skipped", database: "skipped" }, companies: [], saved_count: 0, duplicates_skipped: 0, warnings: [], message: "No companies were found." }) });
  });
  await page.goto("/dashboard/leads");
  const leadSearch = page.getByRole("form", { name: "Lead search" });
  await leadSearch.getByLabel("Country").fill("Germany");
  await leadSearch.getByLabel("City").fill("Berlin");
  await leadSearch.getByLabel("Industry").fill("Construction");
  await leadSearch.getByRole("button", { name: "Find leads" }).click();
  await expect(page.getByText("No results. Try a broader city, industry, radius, or fewer filters.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry search" })).toBeVisible();
  await expect(page.getByText("Searching companies...")).not.toBeVisible();
  await guards.assertClean();
});

test("lead search timeout ends loading and offers retry", async ({ page }, testInfo) => {
  installQaGuards(page, testInfo);
  await page.route("**/api/workspace-app/leads/search", async (route) => {
    await route.fulfill({
      status: 504,
      contentType: "application/json",
      body: JSON.stringify({ detail: "This request took too long. Please try again with a smaller search." })
    });
  });
  await page.goto("/dashboard/leads");
  const leadSearch = page.getByRole("form", { name: "Lead search" });
  await leadSearch.getByLabel("Country").fill("Germany");
  await leadSearch.getByLabel("City").fill("Berlin");
  await leadSearch.getByLabel("Industry").fill("Construction");
  await leadSearch.getByRole("button", { name: "Find leads" }).click();
  await expect(page.getByText("This request took too long. Please try again with a smaller search.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry search" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Find leads" })).toBeEnabled();
  await expect(page.getByText("Something went wrong. Please refresh or sign in again.")).not.toBeVisible();
});

test("lead search provider error does not leave an infinite spinner", async ({ page }, testInfo) => {
  installQaGuards(page, testInfo);
  await page.route("**/api/workspace-app/leads/search", async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ detail: "Lead search is temporarily unavailable. Please try again later." })
    });
  });
  await page.goto("/dashboard/leads");
  const leadSearch = page.getByRole("form", { name: "Lead search" });
  await leadSearch.getByLabel("Country").fill("Germany");
  await leadSearch.getByLabel("City").fill("Berlin");
  await leadSearch.getByLabel("Industry").fill("Construction");
  await leadSearch.getByRole("button", { name: "Find leads" }).click();
  await expect(page.getByText("Lead search is temporarily unavailable. Please try again later.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry search" })).toBeVisible();
  await expect(page.getByText("Something went wrong. Please refresh or sign in again.")).not.toBeVisible();
});

test("lead search retry reuses the last filters and can recover", async ({ page }, testInfo) => {
  installQaGuards(page, testInfo);
  let attempts = 0;
  await page.route("**/api/workspace-app/leads/search", async (route) => {
    attempts += 1;
    if (attempts === 1) {
      await route.fulfill({
        status: 504,
        contentType: "application/json",
        body: JSON.stringify({ detail: "This request took too long. Please try again with a smaller search." })
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ request_id: "qa-retry", status: "success", provider_status: { google_maps: "success", hunter: "success", openai: "success", database: "success" }, companies: [{ ...qaCompany, name: "Retry Build GmbH" }], saved_count: 1, duplicates_skipped: 0, warnings: [], message: "Found 1 company. Saved to CRM." }) });
  });
  await page.goto("/dashboard/leads");
  const leadSearch = page.getByRole("form", { name: "Lead search" });
  await leadSearch.getByLabel("Country").fill("Germany");
  await leadSearch.getByLabel("City").fill("Berlin");
  await leadSearch.getByLabel("Industry").fill("Construction");
  await leadSearch.getByRole("button", { name: "Find leads" }).click();
  await expect(page.getByRole("button", { name: "Retry search" })).toBeVisible();
  await page.getByRole("button", { name: "Retry search" }).click();
  await expect(page.getByRole("heading", { name: "Retry Build GmbH" })).toBeVisible();
  expect(attempts).toBe(2);
  await expect(page.getByText("Something went wrong. Please refresh or sign in again.")).not.toBeVisible();
});

test("manual company entry saves to CRM and becomes a research opportunity", async ({ page }, testInfo) => {
  const guards = installQaGuards(page, testInfo);
  await page.goto("/dashboard/leads");
  await page.getByText("Backup path").click();
  const manualEntry = page.getByRole("form", { name: "Manual company entry" });
  await manualEntry.getByLabel("Company name").fill("Berlin Roof Systems");
  await manualEntry.getByLabel("Website").fill("https://berlin-roof.example");
  await manualEntry.getByText("Optional details").click();
  await manualEntry.getByLabel("Country").fill("Germany");
  await manualEntry.getByLabel("City").fill("Berlin");
  await manualEntry.getByLabel("Industry").fill("Construction");
  await manualEntry.getByRole("button", { name: /Save and prepare opportunity/ }).click();
  await expect(page.getByRole("heading", { name: "Berlin Roof Systems", exact: true })).toBeVisible();
  await expect(page.getByText("AI autopilot")).toBeVisible();
  await expect(page.getByText("One click fills the missing sales research.")).toBeVisible();
  await expect(page.getByText("Email drafts")).toBeVisible();
  await expect(page.getByText("Email draft ready")).toBeVisible();
  await expect(page.getByRole("button", { name: /Refresh AI research|Run all missing steps/ })).toBeVisible();
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
  await page.getByRole("link", { name: /Open company/ }).first().click();
  await expect(page.getByRole("heading", { name: "Hill Country Build Co" }).first()).toBeVisible();
  const stageSection = page.locator("section").filter({ hasText: "Update the pipeline when the sales situation changes." }).first();
  await stageSection.getByLabel("CRM stage").selectOption("Meeting Scheduled");
  await expect(stageSection.getByLabel("CRM stage")).toHaveValue("Meeting Scheduled");
  const moveStageButton = stageSection.getByRole("button", { name: /^Move stage$/ });
  await expect(moveStageButton).toBeEnabled();
  await moveStageButton.click();
  await expect(page.getByText("CRM stage moved to Meeting Scheduled.")).toBeVisible();
  await page.getByLabel("Add note").fill("Follow up next week.");
  await page.getByRole("button", { name: /Add note/ }).click();
  await expect(page.getByText("Note saved to the activity history.")).toBeVisible();
  await guards.assertClean();
});
