import { expect, test } from "@playwright/test";
import { mockWorkspaceApi } from "../../mocks/workspace-api";
import { expectNoHorizontalOverflow, expectNoSensitiveCustomerText, installQaGuards } from "../helpers/qa-guards";

const sections = [
  ["/dashboard", "AI-помощник"],
  ["/dashboard/clients", "Клиенты"],
  ["/dashboard/emails", "Письма"],
  ["/dashboard/settings", "Настройки"]
] as const;

const legacyRoutes = [
  ["/dashboard/leads", "AI-помощник"],
  ["/dashboard/ai-customer-finder", "AI-помощник"],
  ["/dashboard/companies", "Клиенты"],
  ["/dashboard/contacts", "Клиенты"],
  ["/dashboard/deals", "Клиенты"],
  ["/dashboard/crm", "Клиенты"],
  ["/dashboard/campaigns", "Письма"],
  ["/dashboard/inbox", "Письма"],
  ["/dashboard/billing", "Настройки"],
  ["/dashboard/profile", "Настройки"]
] as const;

test.describe("AI-first workspace routes", () => {
  test.beforeEach(async ({ page }) => {
    await mockWorkspaceApi(page);
  });

  test("renders only the four main customer sections", async ({ page }) => {
    for (const [route, heading] of sections) {
      await page.goto(route, { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
      await expectNoSensitiveCustomerText(page);
      await expectNoHorizontalOverflow(page);
    }
  });

  test("legacy dashboard routes redirect into the simplified structure", async ({ page }) => {
    for (const [route, heading] of legacyRoutes) {
      await page.goto(route, { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    }
  });

  test("mobile navigation exposes the four primary sections", async ({ page }, testInfo) => {
    const guards = installQaGuards(page, testInfo);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    for (const [, label] of sections) {
      await expect(page.getByRole("link", { name: label }).last()).toBeVisible();
    }
    await expectNoHorizontalOverflow(page);
    await guards.assertClean();
  });
});
