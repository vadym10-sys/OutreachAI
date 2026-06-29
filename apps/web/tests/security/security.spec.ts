import { expect, test } from "@playwright/test";
import { mockWorkspaceApi } from "../../mocks/workspace-api";
import { expectNoSensitiveCustomerText, installQaGuards } from "../helpers/qa-guards";

test.beforeEach(async ({ page }) => {
  await mockWorkspaceApi(page);
});

test("customer UI does not expose provider, server, or secret details", async ({ page }, testInfo) => {
  const guards = installQaGuards(page, testInfo);
  await page.goto("/dashboard/leads");
  await expectNoSensitiveCustomerText(page);
  const html = await page.content();
  expect(html).not.toMatch(/sk_live_|sk_test_|DATABASE_URL|RESEND_API_KEY|OPENAI_API_KEY|HUNTER_API_KEY|GOOGLE_MAPS_API_KEY/i);
  await guards.assertClean();
});

test("form input is rendered as text and not executed as markup", async ({ page }, testInfo) => {
  const guards = installQaGuards(page, testInfo);
  await page.goto("/dashboard/leads");
  const leadSearch = page.getByRole("form", { name: "Lead search" });
  await leadSearch.getByLabel("Country").fill("<img src=x onerror=alert(1)>");
  await expect(leadSearch.getByLabel("Country")).toHaveValue("<img src=x onerror=alert(1)>");
  const injectedImageCount = await page.locator("img[src='x']").count();
  expect(injectedImageCount).toBe(0);
  await guards.assertClean();
});
