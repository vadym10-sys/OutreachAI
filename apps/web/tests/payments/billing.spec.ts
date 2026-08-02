import { expect, test } from "@playwright/test";
import { mockWorkspaceApi } from "../../mocks/workspace-api";
import { installQaGuards } from "../helpers/qa-guards";

test.beforeEach(async ({ page }) => {
  await mockWorkspaceApi(page);
});

test("billing route redirects to settings without exposing payment internals", async ({ page }, testInfo) => {
  const guards = installQaGuards(page, testInfo);
  await page.goto("/dashboard/billing");
  await expect(page.getByRole("heading", { name: "Настройки" })).toBeVisible();
  await expect(page.getByText("Billing", { exact: true })).toBeVisible();
  await expect(page.getByRole("main")).not.toContainText(/Stripe|webhook|secret|price id/i);
  await guards.assertClean();
});

test("pricing page exposes plan CTAs", async ({ page }, testInfo) => {
  const guards = installQaGuards(page, testInfo);
  await page.goto("/pricing");
  const main = page.getByRole("main");
  await expect(page.getByRole("heading", { name: "Starter", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Pro", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Agency", exact: true })).toBeVisible();
  await expect(main).toContainText("49 EUR/month");
  await expect(main).toContainText("149 EUR/month");
  await expect(main).toContainText("499 EUR/month");
  await expect(main).toContainText("500 leads per month");
  await expect(main).toContainText("50,000 leads per month");
  await expect(page.getByRole("link", { name: "Choose Starter" })).toHaveAttribute("href", "/sign-up?plan=Starter");
  await expect(page.getByRole("link", { name: "Choose Pro" })).toHaveAttribute("href", "/sign-up?plan=Pro");
  await expect(page.getByRole("link", { name: "Choose Agency" })).toHaveAttribute("href", "/sign-up?plan=Agency");
  await guards.assertClean();
});
