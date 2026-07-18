import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { mockWorkspaceApi, qaCompany } from "../mocks/workspace-api";
import { expectNoBrokenImages, expectNoHorizontalOverflow } from "../tests/helpers/qa-guards";

type RuntimeFailure = {
  type: string;
  message: string;
};

function installStrictRuntimeGuards(page: Page, testInfo: TestInfo) {
  const failures: RuntimeFailure[] = [];
  const apiCalls: string[] = [];
  const allowedConsolePatterns = [
    /NO_COLOR env is ignored/i,
    /preloaded (with|using) link preload but not used/i,
    /Layout was forced before the page was fully loaded/i,
    /LogRocket: script could not load/i
  ];

  page.on("console", (message) => {
    const text = message.text();
    if (["error", "warning"].includes(message.type()) && !allowedConsolePatterns.some((pattern) => pattern.test(text))) {
      failures.push({ type: `console:${message.type()}`, message: text });
    }
  });

  page.on("pageerror", (error) => {
    const message = error.stack || error.message;
    if (/[?&]_rsc=.*due to access control checks/i.test(message)) return;
    if (/^blob:.*cancelled/i.test(message)) return;
    if (/Cannot load blob:.*due to access control checks.*cdn\.logr-in\.com\/logger/i.test(message)) return;
    failures.push({ type: "pageerror", message });
  });

  page.on("requestfailed", (request) => {
    if (/cdn\.logr-in\.com\/logger-1\.min\.js/.test(request.url())) return;
    const failure = request.failure()?.errorText || "";
    if (/[?&]_rsc=/.test(request.url()) && /abort|cancelled/i.test(failure)) return;
    if (/^blob:/.test(request.url()) && /abort|cancelled/i.test(failure)) return;
    failures.push({ type: "requestfailed", message: `${request.url()} ${failure}`.trim() });
  });

  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.pathname.startsWith("/api/")) {
      apiCalls.push(`${response.status()} ${url.pathname}`);
      if (response.status() >= 400) {
        failures.push({ type: "api-response", message: `${response.status()} ${url.pathname}` });
      }
    }
  });

  return {
    apiCalls,
    async assertClean() {
      if (failures.length) {
        await testInfo.attach("manual-runtime-failures.json", {
          body: JSON.stringify(failures, null, 2),
          contentType: "application/json"
        });
      }
      expect(failures).toEqual([]);
    }
  };
}

async function expectHealthyPage(page: Page, heading: string | RegExp) {
  await expect(page.getByRole("heading", { name: heading })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("main")).not.toContainText("Something went wrong");
  await expect(page.getByRole("main")).not.toContainText("Load failed");
  await expect(page.getByRole("main")).not.toContainText("Failed to fetch");
  await expect(page.getByRole("main")).not.toContainText("HTTP 4");
  await expect(page.getByRole("main")).not.toContainText("HTTP 5");
  await expectNoBrokenImages(page);
  await expectNoHorizontalOverflow(page);
}

async function signInAsQaUser(page: Page) {
  await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/sign-in/);
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await page.getByRole("button", { name: "Continue to workspace" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expectHealthyPage(page, "Find customers, save CRM leads, write emails.");
}

test.describe("manual production-readiness journey", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      if (!window.localStorage.getItem("outreachai.e2eAuthInitialized")) {
        window.localStorage.setItem("outreachai.e2eSignedOut", "true");
        window.localStorage.setItem("outreachai.e2eAuthInitialized", "true");
      }
      window.localStorage.removeItem("outreachai.pendingPlan");
    });
    await mockWorkspaceApi(page);
  });

  test("authorized desktop path has clean network, console, refresh and relogin", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "Full desktop manual journey runs once on Chromium; mobile coverage is in the companion test.");
    const guards = installStrictRuntimeGuards(page, testInfo);

    await page.setViewportSize({ width: 1440, height: 960 });
    await signInAsQaUser(page);

    await page.getByRole("link", { name: "Search", exact: true }).click();
    await expectHealthyPage(page, "Find customers, then decide what to save.");
    const firstCustomerForm = page.getByRole("form", { name: "Customer search" });
    await firstCustomerForm.getByLabel("Product website").fill("https://outreachaiaiai.com");
    await firstCustomerForm.getByLabel("Target customer").fill("B2B SaaS companies in Europe with sales teams that need better outbound research.");
    await firstCustomerForm.getByLabel("Country").fill("Germany");
    await firstCustomerForm.getByLabel("Industry").fill("B2B SaaS");
    await firstCustomerForm.getByLabel("Results").fill("5");
    await firstCustomerForm.getByRole("button", { name: "Find customers" }).click();
    await expect(page.getByText("Verified results are ready. Save only the companies you want in CRM.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "EuroScale CRM Co" }).first()).toBeVisible();
    await expect(page.getByText("sarah.meyer@euroscale-crm.co")).toBeVisible();
    await expect(page.getByText("Draft preview", { exact: true })).toBeVisible();
    await expect(page.getByText("Worth a quick fit review?")).toBeVisible();
    await page.getByRole("button", { name: "Save to CRM" }).click();
    await expect(page.getByText("Lead saved to CRM. Outreach draft is ready for manual review.")).toBeVisible();

    await page.getByRole("link", { name: "CRM", exact: true }).click();
    await expectHealthyPage(page, "Saved leads, stages, notes and history.");
    await expect(page.getByRole("heading", { name: "Hill Country Build Co" }).first()).toBeVisible();
    await page.getByRole("main").getByRole("combobox").selectOption("Email Draft Ready");
    await page.getByRole("button", { name: "Update stage" }).click();
    await expect(page.getByText("CRM stage updated.")).toBeVisible();
    await page.getByLabel("Notes and history").fill("Customer asked to review next week.");
    await page.getByRole("button", { name: "Add note" }).click();
    await expect(page.getByText("Note saved.")).toBeVisible();
    await page.reload({ waitUntil: "domcontentloaded" });
    await expectHealthyPage(page, "Saved leads, stages, notes and history.");
    await expect(page.getByText("Hill Country Build Co").first()).toBeVisible();

    await page.getByRole("link", { name: "Mail", exact: true }).click();
    await expectHealthyPage(page, "Review drafts, send manually, track replies.");
    await expect(page.getByLabel("Subject")).toHaveValue("Quick idea for Hill Country Build Co");
    await expect(page.getByRole("button", { name: "Send manually" }).first()).toBeDisabled();
    await page.getByRole("button", { name: "Approve" }).first().click();
    await expect(page.getByText("Email approved. It is ready to send, but nothing was sent automatically.")).toBeVisible();
    await page.getByRole("button", { name: "Send manually" }).first().click();
    await expect(page.getByText("Confirm the recipient and click Confirm send. Nothing has been sent yet.")).toBeVisible();
    await page.getByRole("button", { name: "Confirm send" }).first().click();
    await expect(page.getByText("Approved email was sent. CRM stage updated.")).toBeVisible();
    await page.reload({ waitUntil: "domcontentloaded" });
    await expectHealthyPage(page, "Review drafts, send manually, track replies.");

    await page.getByRole("link", { name: "Billing" }).click();
    await expectHealthyPage(page, "Subscription and usage.");
    await expect(page.getByText("Keep using the current plan.")).toBeVisible();

    await page.getByRole("link", { name: "Settings" }).click();
    await expectHealthyPage(page, "Make the workspace ready for your first campaign.");
    await expect(page.getByText("Search one focused market.")).toBeVisible();

    await page.getByRole("link", { name: "Profile", exact: true }).click();
    await expectHealthyPage(page, "Set the workspace identity AI should use.");
    const profileForm = page.locator("form").filter({ has: page.getByRole("button", { name: "Save profile" }) });
    await profileForm.getByLabel("Workspace name").fill("QA Production Workspace");
    await profileForm.getByLabel("Company name").fill("QA Production Company");
    await profileForm.getByLabel("Timezone").fill("Europe/Warsaw");
    await profileForm.getByLabel("Language").selectOption("en-US");
    await profileForm.getByRole("button", { name: "Save profile" }).click();
    await expect(page.getByText("Profile saved. Future outreach uses this workspace identity.")).toBeVisible();
    await page.reload({ waitUntil: "domcontentloaded" });
    const refreshedProfileForm = page.locator("form").filter({ has: page.getByRole("button", { name: "Save profile" }) });
    await expect(refreshedProfileForm.getByLabel("Workspace name")).toHaveValue("QA Production Workspace");
    await expect(refreshedProfileForm.getByLabel("Company name")).toHaveValue("QA Production Company");

    await page.getByTestId("qa-sign-out").click();
    await expect(page).toHaveURL(/\/sign-in/);
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
    await page.getByRole("button", { name: "Continue to workspace" }).click();
    await expectHealthyPage(page, "Find customers, save CRM leads, write emails.");

    for (const endpoint of [
      "/api/workspace-app/bootstrap",
      "/api/workspace-app/leads/first-customers/search",
      "/api/workspace-app/leads/first-customers/results/finder-result-1/save",
      "/api/workspace-app/companies",
      `/api/crm/companies/${qaCompany.id}/stage`,
      `/api/crm/companies/${qaCompany.id}/notes`,
      "/api/workspace-app/emails/33333333-3333-3333-3333-333333333333/approve",
      "/api/workspace-app/emails/33333333-3333-3333-3333-333333333333/send",
      "/api/inbox",
      "/api/billing/status",
      "/api/billing/usage",
      "/api/billing/invoices",
      "/api/workspace-app/integrations/status",
      "/api/profile"
    ]) {
      expect(guards.apiCalls.some((call) => call.includes(endpoint)), `${endpoint} was called`).toBe(true);
    }

    await guards.assertClean();
  });

  test("authorized mobile path keeps layout stable across refresh and relogin", async ({ page }, testInfo) => {
    test.skip(!["iphone", "android"].includes(testInfo.project.name), "Mobile journey runs on phone-sized projects.");
    const guards = installStrictRuntimeGuards(page, testInfo);

    await signInAsQaUser(page);
    await expectNoHorizontalOverflow(page);

    for (const [route, heading] of [
      ["/dashboard/leads", "Find customers, then decide what to save."],
      ["/dashboard/companies", "Saved leads, stages, notes and history."],
      [`/dashboard/companies?company=${qaCompany.id}`, "Saved leads, stages, notes and history."],
      ["/dashboard/campaigns", "Review drafts, send manually, track replies."],
      ["/dashboard/inbox", "Review drafts, send manually, track replies."],
      ["/dashboard/billing", "Subscription and usage."],
      ["/dashboard/settings", "Make the workspace ready for your first campaign."],
      ["/dashboard/profile", "Set the workspace identity AI should use."]
    ] as const) {
      await page.goto(route, { waitUntil: "domcontentloaded" });
      await expectHealthyPage(page, heading);
      await page.reload({ waitUntil: "domcontentloaded" });
      await expectHealthyPage(page, heading);
    }

    await page.getByTestId("qa-sign-out").click();
    await expect(page).toHaveURL(/\/sign-in/);
    await page.getByRole("button", { name: "Continue to workspace" }).click();
    await expectHealthyPage(page, "Find customers, save CRM leads, write emails.");
    await guards.assertClean();
  });
});
