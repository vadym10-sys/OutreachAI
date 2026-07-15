import { expect, test } from "@playwright/test";
import { mockWorkspaceApi } from "../../mocks/workspace-api";
import { expectNoBrokenImages, expectNoHorizontalOverflow, expectNoSensitiveCustomerText, installQaGuards } from "../helpers/qa-guards";

const appHeader = "body > div > div > header";

const customerRoutes = [
  ["/dashboard", "What should I do now?"],
  ["/dashboard/leads", "Find real companies and turn each into a sales opportunity."],
  ["/dashboard/companies", "Open the next company to finish the opportunity."],
  ["/dashboard/campaigns", "Review real outreach before anything is sent."],
  ["/dashboard/inbox", "Turn replies into meetings."],
  ["/dashboard/analytics", "Measure what creates meetings."],
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
    await expect(page.locator(appHeader)).toContainText("QA Private Workspace");
    await expect(page.locator("body")).not.toContainText("Something went wrong");
    await expect(page.locator("body")).not.toContainText("The page failed to render");
    await expectNoHorizontalOverflow(page);
    const mobileHeader = await page.evaluate(() => {
      const header = document.querySelector("header");
      const avatar = document.querySelector(".dashboard-user-button");
      return {
        viewportWidth: window.innerWidth,
        pageWidth: document.documentElement.scrollWidth,
        headerWidth: header?.getBoundingClientRect().width || 0,
        visibleHeaderSelects: Array.from(header?.querySelectorAll("select") || []).filter((item) => {
          const rect = item.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        }).length,
        avatarWidth: avatar?.getBoundingClientRect().width || 0,
        avatarHeight: avatar?.getBoundingClientRect().height || 0
      };
    });
    expect(mobileHeader.pageWidth).toBeLessThanOrEqual(mobileHeader.viewportWidth + 1);
    expect(mobileHeader.headerWidth).toBeLessThanOrEqual(mobileHeader.viewportWidth + 1);
    expect(mobileHeader.visibleHeaderSelects).toBe(0);
    expect(mobileHeader.avatarWidth).toBeLessThanOrEqual(44);
    expect(mobileHeader.avatarHeight).toBeLessThanOrEqual(44);
    await guards.assertClean();
  });

  test("new private workspace dashboard shows account-specific onboarding instead of shared demo data", async ({ page }, testInfo) => {
    await page.unroute("**/api/**");
    await page.route("**/api/**", async (route) => {
      const url = new URL(route.request().url());
      const apiPath = url.pathname.replace(/^\/api\/backend/, "");
      const json = (body: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
      if (apiPath === "/api/workspace" || apiPath === "/api/workspace/me") {
        return json({
          id: "workspace-private-test",
          name: "Private Test Workspace",
          company: "Private Test Workspace",
          industry: "",
          target_country: "",
          target_customer: "",
          timezone: "UTC",
          language: "en",
          onboarding_step: 1,
          onboarding_completed: false,
          members: []
        });
      }
      if (apiPath === "/api/dashboard") return json({ leads: 0, campaigns: 0, emails_sent: 0, delivered: 0, opened: 0, replies: 0, bounces: 0, open_rate: 0, reply_rate: 0, ctr: 0, conversion_rate: 0, meetings: 0, revenue: 0, revenue_forecast: 0, mrr: 0, arr: 0, revenue_series: [], funnel: [], pipeline: [], plan: "Starter", usage: { leads: 0, email_sends: 0 } });
      if (apiPath === "/api/leads") return json({ items: [], total: 0, page: 1, page_size: 100 });
      if (apiPath === "/api/campaigns") return json([]);
      if (apiPath === "/api/sales-employees") return json([]);
      if (apiPath === "/api/activity") return json([]);
      return json({});
    });
    await page.setViewportSize({ width: 390, height: 844 });
    const guards = installQaGuards(page, testInfo);

    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Your private workspace is ready" })).toBeVisible();
    await expect(page.locator(appHeader)).toContainText("Private Test Workspace");
    await expect(page.getByRole("link", { name: "Add your first company" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Find leads" }).first()).toBeVisible();
    await expect(page.getByRole("main")).not.toContainText("demo account");
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
    await page.addInitScript(() => {
      window.localStorage.setItem("outreachai.locale", "ru");
    });
    await page.context().addCookies([{ name: "outreachai_locale", value: "ru", url: "http://127.0.0.1:3000" }]);
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("heading", { name: "Что мне делать сейчас?" })).toBeVisible();
    await expect(page.locator(appHeader)).toContainText("QA Private Workspace");
    await expect(page.locator(appHeader)).toContainText("Аккаунт: qa@example.com");
    await expect(page.locator("body")).not.toContainText("What should I do now?");
    await expect(page.locator("body")).not.toContainText("Dashboard details are temporarily unavailable");
    await expect(page.locator("body")).not.toContainText("Find your first qualified companies");
    await expect(page.locator("body")).not.toContainText("Sales workflow");
    await expect(page.locator("body")).not.toContainText("Current step");
    await expect(page.locator("body")).not.toContainText("OutreachAI keeps one obvious next action");
    await expectNoHorizontalOverflow(page);
    await guards.assertClean();
  });

  test("mobile drawer opens, shows the private account, navigates, and closes without overflow", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const guards = installQaGuards(page, testInfo);

    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    await expect(page.locator(appHeader)).toContainText("QA Private Workspace");
    await expect(page.locator(appHeader)).toContainText("Account: qa@example.com");
    await expectNoHorizontalOverflow(page);

    const openNavigation = page.getByRole("button", { name: "Open navigation" });
    await expect(openNavigation).toBeVisible();
    await openNavigation.click();

    const drawer = page.getByRole("dialog", { name: "Open navigation" });
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText("QA Private Workspace");
    await expect(drawer).toContainText("Account: qa@example.com");
    await expect(drawer.getByRole("link", { name: "Companies" })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await drawer.getByRole("link", { name: "Companies" }).click();
    await expect(page).toHaveURL(/\/dashboard\/companies$/);
    await expect(page.getByRole("heading", { name: "Open the next company to finish the opportunity." })).toBeVisible();
    await expect(drawer).not.toBeVisible();
    await expectNoHorizontalOverflow(page);
    await guards.assertClean();
  });

  test("lead search shows saved CRM summary and keeps the result actionable", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const guards = installQaGuards(page, testInfo);

    await page.goto("/dashboard/leads", { waitUntil: "domcontentloaded" });
    const leadSearch = page.getByRole("form", { name: "Lead search" });
    await leadSearch.getByLabel("Country").fill("Germany");
    await leadSearch.getByLabel("City").fill("Berlin");
    await leadSearch.getByLabel("Industry").fill("Construction");
    await leadSearch.getByLabel("Company size").fill("11-50");
    await leadSearch.getByLabel("Number of leads").fill("10");
    await leadSearch.getByRole("button", { name: "Find leads" }).click();

    await expect(page.getByText("Found 1 companies. Saved to CRM.")).toBeVisible();
    await expect(page.getByText("Companies found").first()).toBeVisible();
    await expect(page.getByText("Saved to CRM").first()).toBeVisible();
    await expect(page.getByText("Duplicates skipped").first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Hill Country Build Co", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Open company workspace" }).first()).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await guards.assertClean();
  });

  test("missing lead search key points users to the exact setup section", async ({ page }, testInfo) => {
    await mockWorkspaceApi(page, {
      "/api/workspace-app/integrations/status": {
        body: {
          integrations: [
            { key: "lead_search", label: "Lead search", status: "missing_key", message: "Company search needs setup. Add companies manually until it is connected." },
            { key: "contact_discovery", label: "Contact discovery", status: "connected", message: "Connected. Contact discovery can verify business emails." },
            { key: "ai_research", label: "AI research and email", status: "connected", message: "Connected. AI can analyze websites and draft outreach." },
            { key: "email_sending", label: "Email sending", status: "connected", message: "Connected. Approved emails can be sent." },
            { key: "billing", label: "Billing", status: "connected", message: "Connected. Plans and billing status can be managed." }
          ]
        }
      }
    });
    await page.setViewportSize({ width: 390, height: 844 });
    const guards = installQaGuards(page, testInfo);

    await page.goto("/dashboard/leads", { waitUntil: "domcontentloaded" });
    const addKey = page.getByRole("link", { name: "Add key" });
    await expect(addKey).toBeVisible();
    await expect(addKey).toHaveAttribute("href", "/dashboard/settings#lead-search-key");
    await addKey.click();
    await expect(page).toHaveURL(/\/dashboard\/settings#lead-search-key$/);
    await expect(page.getByRole("heading", { name: "Automatic company search needs one setup step" })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await guards.assertClean();
  });

  test("manual company entry keeps the first action simple on mobile", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const guards = installQaGuards(page, testInfo);

    await page.goto("/dashboard/leads", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Add one real company first." })).toBeVisible();
    await page.getByText("Backup path").click();
    const manualForm = page.getByRole("form", { name: "Manual company entry" });
    await expect(manualForm.getByLabel("Company name")).toBeVisible();
    await expect(manualForm.getByLabel("Website")).toBeVisible();
    await expect(manualForm.getByText("Optional details")).toBeVisible();
    await expect(manualForm.getByLabel("Country")).toBeHidden();
    await expect(manualForm.getByLabel("Email")).toBeHidden();
    await expectNoHorizontalOverflow(page);
    await guards.assertClean();
  });

  test("CRM pipeline opens the selected company workspace", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const guards = installQaGuards(page, testInfo);

    await page.goto("/dashboard/crm", { waitUntil: "domcontentloaded" });
    await expect(page.getByText("Next sales action")).toBeVisible();
    await expect(page.getByText("Need action")).toBeVisible();
    const openCompany = page.getByRole("link", { name: "Open company workspace" });
    await expect(openCompany).toBeVisible();
    await openCompany.click();

    await expect(page).toHaveURL(/\/dashboard\/companies\?company=44444444-4444-4444-4444-444444444444$/);
    await expect(page.getByText("Opened from CRM pipeline")).toBeVisible();
    const highlightedCompany = page.locator('[id="company-44444444-4444-4444-4444-444444444444"]');
    await expect(highlightedCompany).toContainText("Hill Country Build Co");
    await expect(page.getByText("Continue with the highlighted company")).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await guards.assertClean();
  });

  test("company workspace shows AI recommendations and version history", async ({ page }, testInfo) => {
    const guards = installQaGuards(page, testInfo);
    await mockWorkspaceApi(page);

    await page.goto("/dashboard/companies?company=44444444-4444-4444-4444-444444444444", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "What to do next with this company" })).toBeVisible();
    await expect(page.getByText("AI Recommendations").first()).toBeVisible();
    await expect(page.getByText("Top buying signals").first()).toBeVisible();
    await expect(page.getByText("Top risks or objections").first()).toBeVisible();
    await expect(page.getByText("Personalized follow-up sequence").first()).toBeVisible();
    await expect(page.getByText("Quick idea for Hill Country Build Co").first()).toBeVisible();
    await expect(page.getByText("Hot").first()).toBeVisible();
    await expect(page.getByLabel("Analysis version")).toHaveValue("2");

    await page.getByLabel("Analysis version").selectOption("1");
    await expect(page.getByText("Warm · 74%").first()).toBeVisible();
    await expect(page.getByText("This earlier version focused on the owner contact and the website conversion gap.").first()).toBeVisible();

    await expectNoHorizontalOverflow(page);
    await guards.assertClean();
  });

  test("Russian mobile workspace pages do not show the English lead/settings copy", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => {
      window.localStorage.setItem("outreachai.locale", "ru");
    });
    await page.context().addCookies([{ name: "outreachai_locale", value: "ru", url: "http://127.0.0.1:3000" }]);

    const russianRoutes = ["/dashboard/leads", "/dashboard/companies", "/dashboard/campaigns", "/dashboard/crm", "/dashboard/billing", "/dashboard/settings"];

    for (const route of russianRoutes) {
      const routePage = await page.context().newPage();
      await routePage.setViewportSize({ width: 390, height: 844 });
      await routePage.addInitScript(() => {
        window.localStorage.setItem("outreachai.locale", "ru");
      });
      await mockWorkspaceApi(routePage);
      const routeGuards = installQaGuards(routePage, testInfo);
      await routePage.goto(route, { waitUntil: "domcontentloaded" });
      await expect(routePage.getByRole("main")).toBeVisible();
      const body = routePage.locator("body");
      await expect(body).not.toContainText("Lead Finder");
      await expect(body).not.toContainText("Save company to CRM");
      await expect(body).not.toContainText("Fast fallback");
      await expect(body).not.toContainText("Every company is saved in your CRM.");
      await expect(body).not.toContainText("Move real leads from research to revenue.");
      await expect(body).not.toContainText("Subscription and usage.");
      await expect(body).not.toContainText("Make the workspace ready for your first campaign.");
      await expect(body).not.toContainText("Your session has expired. Please sign in again.");
      await expect(body).not.toContainText("employees");
      await expect(body).not.toContainText("verified email");
      await expect(body).not.toContainText("Next step");
      await expect(body).not.toContainText("Create a campaign from saved leads");
      await expect(body).not.toContainText("Review before send");
      await expect(body).not.toContainText("Create campaign");
      await expect(body).not.toContainText("LOADING SAVED COMPANIES");
      await expect(body).not.toContainText("Loading saved companies");
      await expect(body.locator('[aria-label="Open user menu"]')).toHaveCount(0);
      await expect(routePage.getByRole("main")).not.toContainText("Something went wrong");
      await expectNoHorizontalOverflow(routePage);
      await routeGuards.assertClean();
      await routePage.close();
    }
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
    await page.unroute("**/api/**");
    await mockWorkspaceApi(page, {
      "/api/dashboard": { status: 503, body: { detail: "Dashboard unavailable" } }
    });

    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "What should I do now?" })).toBeVisible();
    await expect(page.getByRole("main")).toContainText("Find leads");
    await expect(page.getByRole("main")).toContainText("Open company");
    await expect(page.getByRole("main")).not.toContainText("Dashboard details are temporarily unavailable");
    await expect(page.getByRole("main")).not.toContainText("Something went wrong");
    await expect(page.getByRole("main")).not.toContainText("The page failed to render");
    expect(pageErrors).toEqual([]);
  });

  test("malformed company data is normalized and cannot crash the companies page", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.unroute("**/api/**");
    await mockWorkspaceApi(page, {
      "/api/workspace-app/companies": {
        body: [{
          id: "broken-company",
          name: "Partial Company",
          source: "workspace",
          crm_stage: "New Lead",
          contacts: null,
          deals: null,
          notes: null,
          activity: null,
          generated_emails: null
        }]
      }
    });

    await page.goto("/dashboard/companies");
    await expect(page.getByRole("heading", { name: "Open the next company to finish the opportunity." })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Partial Company" })).toBeVisible();
    await expect(page.getByRole("main")).toContainText("Not available");
    await expect(page.getByRole("main")).not.toContainText("Something went wrong");
    await expect(page.getByRole("main")).not.toContainText("The page failed to render");
    expect(pageErrors).toEqual([]);
  });
});
