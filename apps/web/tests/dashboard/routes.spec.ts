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

const setupRoutes = [
  ["/onboarding", "Set up OutreachAI"]
] as const;

test.describe("customer workspace routes", () => {
  test.beforeEach(async ({ page }) => {
    await mockWorkspaceApi(page);
  });

  test("Telegram-sized mobile dashboard route never shows the route error page", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const guards = installQaGuards(page, testInfo);

    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "What should I do now?" })).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Something went wrong");
    await expect(page.locator("body")).not.toContainText("The page failed to render");
    await expectNoHorizontalOverflow(page);
    await guards.assertClean();
  });

  test("mobile landing survives missing client config and blocked browser storage", async ({ browser }, testInfo) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"
    });
    await context.addInitScript(() => {
      Object.defineProperty(window, "localStorage", {
        configurable: true,
        get() {
          throw new Error("Storage unavailable");
        }
      });
    });
    const page = await context.newPage();
    const guards = installQaGuards(page, testInfo);
    await page.route("**/api/client-config", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({}) });
    });

    await page.goto("/");
    await expect(page.getByRole("heading", { name: "AI Sales Employee for B2B Lead Generation" })).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Something went wrong");
    await expect(page.locator("body")).not.toContainText("The page failed to render");
    await expectNoHorizontalOverflow(page);
    await guards.assertClean();
    await context.close();
  });

  test("Russian mobile dashboard does not mix in English dashboard copy", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const guards = installQaGuards(page, testInfo);
    await page.goto("/dashboard");
    await page.evaluate(() => {
      window.localStorage.setItem("outreachai.locale", "ru");
      document.cookie = "outreachai_locale=ru; path=/; max-age=31536000; SameSite=Lax";
    });
    await page.reload({ waitUntil: "networkidle" });

    await expect(page.getByRole("heading", { name: "Что мне делать сейчас?" })).toBeVisible();
    await expect(page.locator("body")).not.toContainText("What should I do now?");
    await expect(page.locator("body")).not.toContainText("Dashboard details are temporarily unavailable");
    await expect(page.locator("body")).not.toContainText("Find your first qualified companies");
    await expect(page.locator("body")).not.toContainText("Sales workflow");
    await expect(page.locator("body")).not.toContainText("Current step");
    await expect(page.locator("body")).not.toContainText("OutreachAI keeps one obvious next action");
    await expectNoHorizontalOverflow(page);
    await guards.assertClean();
  });

  test("Russian mobile workspace pages do not show the English lead/settings copy", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const guards = installQaGuards(page, testInfo);
    await page.goto("/dashboard");
    await page.evaluate(() => {
      window.localStorage.setItem("outreachai.locale", "ru");
      document.cookie = "outreachai_locale=ru; path=/; max-age=31536000; SameSite=Lax";
    });

    const russianRoutes = ["/dashboard/leads", "/dashboard/companies", "/dashboard/crm", "/dashboard/billing", "/dashboard/settings"];

    for (const route of russianRoutes) {
      await page.goto(route, { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("main")).toBeVisible();
      const body = page.locator("body");
      await expect(body).not.toContainText("Lead Finder");
      await expect(body).not.toContainText("Save company to CRM");
      await expect(body).not.toContainText("Fast fallback");
      await expect(body).not.toContainText("Every company is saved in your CRM.");
      await expect(body).not.toContainText("Move real leads from research to revenue.");
      await expect(body).not.toContainText("Subscription and usage.");
      await expect(body).not.toContainText("Make the workspace ready for your first campaign.");
      await expect(body).not.toContainText("Your session has expired. Please sign in again.");
      await expect(page.getByRole("main")).not.toContainText("Something went wrong");
      await expectNoHorizontalOverflow(page);
    }

    await guards.assertClean();
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

  for (const [route, heading] of setupRoutes) {
    test(`${route} loads without the global error page`, async ({ page }, testInfo) => {
      const guards = installQaGuards(page, testInfo);
      await page.goto(route);
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
      await expect(page.locator("body")).not.toContainText("Something went wrong");
      await expect(page.locator("body")).not.toContainText("The page failed to render");
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
