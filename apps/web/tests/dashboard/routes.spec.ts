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
});
