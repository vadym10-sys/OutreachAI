import { expect, test, type Page, type TestInfo } from "@playwright/test";

const requireGmailConnected = process.env.PRODUCTION_REQUIRE_GMAIL_CONNECTED === "true";
const e2eEmail = process.env.PRODUCTION_E2E_EMAIL || "";
const e2ePassword = process.env.PRODUCTION_E2E_PASSWORD || "";
const hasStorageState = Boolean(process.env.PRODUCTION_AUTH_STORAGE_STATE);
const hasCredentialLogin = Boolean(e2eEmail && e2ePassword);

const forbiddenText = /sk_live_|sk_test_|DATABASE_URL|OPENAI_API_KEY|RESEND_API_KEY|HUNTER_API_KEY|CLERK_SECRET|STRIPE_SECRET|Bearer\s+[a-z0-9._-]+/i;
const mutatingAppApi = /\/api\/(?:backend\/api\/)?(?:workspace-app|crm|emails|campaigns|leads|companies|contacts|deals|settings|billing|webhooks|ai-customer-finder)/;

function installProductionGuards(page: Page, testInfo: TestInfo) {
  const failures: Array<{ type: string; message: string }> = [];
  const mutationAttempts: Array<{ method: string; path: string }> = [];

  page.on("console", (message) => {
    const text = message.text();
    if (forbiddenText.test(text)) failures.push({ type: `console:${message.type()}`, message: "sensitive_console_output" });
    if (message.type() === "error" && !/ResizeObserver|hydration/i.test(text)) failures.push({ type: "console:error", message: text.slice(0, 240) });
  });
  page.on("pageerror", (error) => {
    failures.push({ type: "pageerror", message: error.message.slice(0, 240) });
  });
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method()) && mutatingAppApi.test(url.pathname)) {
      mutationAttempts.push({ method: request.method(), path: url.pathname });
    }
  });
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.pathname.startsWith("/api/") && response.status() >= 500) {
      failures.push({ type: "api-response", message: `${response.status()} ${url.pathname}` });
    }
  });

  return {
    async assertClean() {
      if (failures.length) {
        await testInfo.attach("production-runtime-failures.json", {
          body: JSON.stringify(failures, null, 2),
          contentType: "application/json"
        });
      }
      if (mutationAttempts.length) {
        await testInfo.attach("production-mutation-attempts.json", {
          body: JSON.stringify(mutationAttempts, null, 2),
          contentType: "application/json"
        });
      }
      expect(failures).toEqual([]);
      expect(mutationAttempts).toEqual([]);
    }
  };
}

async function expectNoSensitiveContent(page: Page) {
  await expect(page.locator("body")).not.toContainText(forbiddenText);
  await expect(page.locator("body")).not.toContainText(/Something went wrong|Failed to fetch|Traceback|SQLAlchemy/i);
}

async function loginIfNeeded(page: Page) {
  if (hasStorageState) return;
  test.skip(!hasCredentialLogin, "Set PRODUCTION_AUTH_STORAGE_STATE or PRODUCTION_E2E_EMAIL/PRODUCTION_E2E_PASSWORD for authenticated production smoke.");

  await page.goto("/sign-in", { waitUntil: "domcontentloaded" });
  await page.getByLabel(/email address|email/i).fill(e2eEmail);
  await page.getByLabel(/^password$/i).fill(e2ePassword);
  await page.getByRole("button", { name: /continue|sign in/i }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 45_000 });
}

test.describe("production public read-only smoke", () => {
  for (const route of ["/", "/sign-in", "/sign-up", "/pricing"]) {
    test(`${route} renders without leaking secrets`, async ({ page }, testInfo) => {
      const guards = installProductionGuards(page, testInfo);
      const response = await page.goto(route, { waitUntil: "domcontentloaded" });
      expect(response?.status()).toBeLessThan(500);
      await expect(page.locator("body")).toBeVisible();
      await expectNoSensitiveContent(page);
      await guards.assertClean();
    });
  }

  test("dashboard protected route does not expose private data when signed out", async ({ page }, testInfo) => {
    const guards = installProductionGuards(page, testInfo);
    const response = await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    expect(response?.status()).toBeLessThan(500);
    await expect(page.locator("body")).not.toContainText(/Inbox|CRM stage|Gmail OAuth mailbox|Approved emails/i);
    await expectNoSensitiveContent(page);
    await guards.assertClean();
  });
});

test.describe("production authenticated read-only smoke", () => {
  test.beforeEach(async ({ page }) => {
    await loginIfNeeded(page);
  });

  test("customer workspace routes are readable without mutating data", async ({ page }, testInfo) => {
    const guards = installProductionGuards(page, testInfo);
    for (const route of ["/dashboard", "/dashboard/settings", "/dashboard/companies", "/dashboard/emails"]) {
      const response = await page.goto(route, { waitUntil: "domcontentloaded" });
      expect(response?.status()).toBeLessThan(500);
      await expect(page.locator("main")).toBeVisible();
      await expectNoSensitiveContent(page);
    }

    await page.goto("/dashboard/settings", { waitUntil: "domcontentloaded" });
    await expect(page.getByText(/Gmail|OAuth status|Email sender|Provider/i)).toBeVisible();
    if (requireGmailConnected) {
      await expect(page.getByText(/OAuth status:\s*connected|Connected/i).first()).toBeVisible();
    }
    await guards.assertClean();
  });
});
