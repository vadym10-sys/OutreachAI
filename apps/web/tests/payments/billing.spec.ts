import { expect, test } from "@playwright/test";
import { mockWorkspaceApi } from "../../mocks/workspace-api";
import { installQaGuards } from "../helpers/qa-guards";

test.beforeEach(async ({ page }) => {
  await mockWorkspaceApi(page);
});

test("billing route shows billing controls without exposing payment internals", async ({ page }, testInfo) => {
  const guards = installQaGuards(page, testInfo);
  await page.goto("/dashboard/billing");
  await expect(page.getByRole("heading", { name: "Keep OutreachAI working for your sales team" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Manage Billing" })).toBeVisible();
  await expect(page.getByRole("main")).not.toContainText(/webhook|secret|price id/i);
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

test("billing page uses app-controlled plan changes for active subscriptions", async ({ page }, testInfo) => {
  const guards = installQaGuards(page, testInfo);
  await page.goto("/dashboard/billing");
  await page.getByRole("button", { name: "Change to Pro" }).click();
  await expect(page.getByRole("heading", { name: "Plan change pending" })).toBeVisible();
  await expect(page.getByText("Starter stays active until billing confirms Pro.")).toBeVisible();
  await guards.assertClean();
});

test("billing usage card shows normal, warning, and reached states from API limits", async ({ page }, testInfo) => {
  await mockWorkspaceApi(page, {
    "/api/billing/status": {
      body: {
        plan: "Starter",
        price: 49,
        status: "trialing",
        entitlement_source: "stripe",
        trial_end: "2026-08-20T00:00:00Z",
        current_period_end: "2026-09-01T00:00:00Z",
        trial_days_remaining: 7,
        stripe_customer_id: "cus_mock",
        stripe_subscription_id: "sub_mock",
        transition: { pending: false },
        cancel_at_period_end: false,
        limits: { leads: 500, email_sends: 1000, ai_generations: 1000, sales_employees: 1, workspaces: 1, team_members: 1, advanced_analytics: false },
        usage: { leads: 50, email_sends: 1000, ai_generations: 800 },
        sales_employees_used: 0,
        workspaces_used: 1
      }
    }
  });
  const guards = installQaGuards(page, testInfo);
  await page.goto("/dashboard/billing");
  await expect(page.getByRole("heading", { name: "Starter · €49.00/month" })).toBeVisible();
  await expect(page.getByText("Monthly reset:")).toBeVisible();
  await expect(page.getByText("leads").first()).toBeVisible();
  await expect(page.getByText("50").first()).toBeVisible();
  await expect(page.getByText("80%")).toBeVisible();
  await expect(page.getByText("100%").first()).toBeVisible();
  await expect(page.getByText("Limit reached: reviewed email sends. Upgrade to continue sending reviewed emails.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Upgrade to Pro" })).toBeVisible();
  await expect(page.getByRole("main")).not.toContainText(/reservation|row lock|idempotency|usage counter|migration/i);
  await guards.assertClean();
});

test("billing usage card remains readable on mobile", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const guards = installQaGuards(page, testInfo);
  await page.goto("/dashboard/billing");
  await expect(page.getByRole("heading", { name: "Starter · €49.00/month" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "leads" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Upgrade to Pro" })).toBeVisible();
  await guards.assertClean();
});
