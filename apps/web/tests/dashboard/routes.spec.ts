import { expect, test } from "@playwright/test";
import { mockWorkspaceApi } from "../../mocks/workspace-api";
import { expectNoBrokenImages, expectNoHorizontalOverflow, expectNoSensitiveCustomerText, installQaGuards } from "../helpers/qa-guards";

const customerRoutes = [
  ["/dashboard", "What should I do now?"],
  ["/dashboard/leads", "Find real companies and turn each into a sales opportunity."],
  ["/dashboard/companies", "Every company is saved in your CRM."],
  ["/dashboard/campaigns", "Review real outreach before anything is sent."],
  ["/dashboard/crm", "Move real leads from research to revenue."],
  ["/dashboard/billing", "Subscription and usage."],
  ["/dashboard/settings", "Make the workspace ready for your first campaign."]
] as const;

test.describe("customer workspace routes", () => {
  test.beforeEach(async ({ page }) => {
    await mockWorkspaceApi(page);
  });

  for (const [route, heading] of customerRoutes) {
    test(`${route} loads as a stable customer page`, async ({ page }, testInfo) => {
      const guards = installQaGuards(page, testInfo);
      await page.goto(route);
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
      await expect(page.getByRole("main")).not.toContainText("Something went wrong");
      await expect(page.getByRole("main")).not.toContainText("Что-то пошло не так");
      await expectNoHorizontalOverflow(page);
      await expectNoBrokenImages(page);
      await expectNoSensitiveCustomerText(page);
      await guards.assertClean();
    });
  }

  test("dashboard metrics failure stays inside the dashboard and never shows the global error page", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.route("**/api/backend/api/dashboard", async (route) => {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ detail: "Dashboard unavailable" }) });
    });

    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "What should I do now?" })).toBeVisible();
    await expect(page.getByRole("main")).toContainText("Dashboard details are temporarily unavailable");
    await expect(page.getByRole("main")).not.toContainText("Something went wrong");
    await expect(page.getByRole("main")).not.toContainText("The page failed to render");
    expect(pageErrors).toEqual([]);
  });

  test("malformed company data is normalized and cannot crash the companies page", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.route("**/api/backend/api/crm/companies", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([{
          id: "broken-company",
          name: "Partial Company",
          source: "workspace",
          crm_stage: "New Lead",
          contacts: null,
          deals: null,
          notes: null,
          activity: null,
          generated_emails: null
        }])
      });
    });

    await page.goto("/dashboard/companies");
    await expect(page.getByRole("heading", { name: "Every company is saved in your CRM." })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Partial Company" })).toBeVisible();
    await expect(page.getByRole("main")).toContainText("Not available");
    await expect(page.getByRole("main")).not.toContainText("Something went wrong");
    await expect(page.getByRole("main")).not.toContainText("The page failed to render");
    expect(pageErrors).toEqual([]);
  });
});
