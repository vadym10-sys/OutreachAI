import { expect, test, type Page, type TestInfo } from "@playwright/test";

const mutationSmokeEnabled = process.env.PRODUCTION_SMOKE_MUTATION_ENABLED === "true";
const requireGmailConnected = process.env.PRODUCTION_REQUIRE_GMAIL_CONNECTED === "true";
const runId = process.env.E2E_TEST_RUN_ID || `E2E_TEST_${Date.now()}`;
const e2eEmail = process.env.PRODUCTION_E2E_EMAIL || "";
const e2ePassword = process.env.PRODUCTION_E2E_PASSWORD || "";
const hasStorageState = Boolean(process.env.PRODUCTION_AUTH_STORAGE_STATE);
const hasCredentialLogin = Boolean(e2eEmail && e2ePassword);

const forbiddenText = /sk_live_|sk_test_|DATABASE_URL|OPENAI_API_KEY|RESEND_API_KEY|HUNTER_API_KEY|CLERK_SECRET|STRIPE_SECRET|Bearer\s+[a-z0-9._-]+/i;

function installProductionGuards(page: Page, testInfo: TestInfo) {
  const failures: Array<{ type: string; message: string }> = [];
  page.on("console", (message) => {
    const text = message.text();
    if (forbiddenText.test(text)) failures.push({ type: `console:${message.type()}`, message: "sensitive_console_output" });
    if (message.type() === "error" && !/ResizeObserver|hydration/i.test(text)) failures.push({ type: "console:error", message: text.slice(0, 240) });
  });
  page.on("pageerror", (error) => {
    failures.push({ type: "pageerror", message: error.message.slice(0, 240) });
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
      expect(failures).toEqual([]);
    }
  };
}

function installNoEmailSendGuard(page: Page, testInfo: TestInfo) {
  const sendAttempts: Array<{ method: string; path: string }> = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    const path = url.pathname;
    if (request.method() === "POST" && /\/api\/(?:backend\/api\/)?workspace-app\/emails\/[^/]+\/send$/.test(path)) {
      sendAttempts.push({ method: request.method(), path });
    }
  });
  return {
    async assertNoSendAttempt() {
      if (sendAttempts.length) {
        await testInfo.attach("production-send-attempts.json", {
          body: JSON.stringify(sendAttempts, null, 2),
          contentType: "application/json"
        });
      }
      expect(sendAttempts).toEqual([]);
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

test.describe("production public smoke", () => {
  for (const route of ["/", "/sign-in", "/sign-up", "/pricing"]) {
    test(`${route} renders on desktop and mobile without leaking secrets`, async ({ page }, testInfo) => {
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

test.describe("production authenticated customer workflow", () => {
  test.beforeEach(async ({ page }) => {
    await loginIfNeeded(page);
  });

  test("dashboard, settings, Gmail status, CRM and inbox are readable", async ({ page }, testInfo) => {
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

  test("Customer Finder can prepare an E2E_TEST lead and draft without sending email", async ({ page }, testInfo) => {
    test.skip(!mutationSmokeEnabled, "Set PRODUCTION_SMOKE_MUTATION_ENABLED=true to run mutation smoke with E2E_TEST data.");
    const guards = installProductionGuards(page, testInfo);
    const noSend = installNoEmailSendGuard(page, testInfo);

    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    const command = `${runId} Find one B2B SaaS customer in Germany. Create draft only. Do not send email.`;
    await page.getByRole("form", { name: /AI customer command/i }).getByLabel(/AI command/i).fill(command);
    await page.getByRole("button", { name: /Запустить AI|Run AI|Start AI/i }).click();

    await expect(page.locator("main")).toContainText(/draft|письм|CRM|found|найден/i, { timeout: 60_000 });
    await expect(page.getByRole("button", { name: /Send|Confirm and send|Отправить/i })).toHaveCount(0);
    await expectNoSensitiveContent(page);
    await noSend.assertNoSendAttempt();
    await guards.assertClean();
  });

  test("manual approval gate remains separate from send", async ({ page }, testInfo) => {
    test.skip(!mutationSmokeEnabled, "Set PRODUCTION_SMOKE_MUTATION_ENABLED=true to run mutation smoke with E2E_TEST data.");
    const guards = installProductionGuards(page, testInfo);
    const noSend = installNoEmailSendGuard(page, testInfo);
    await page.goto("/dashboard/emails", { waitUntil: "domcontentloaded" });
    await expect(page.locator("main")).toBeVisible();
    await expect(page.locator("main")).toContainText(/approve|review|draft|провер/i);
    const sendButtons = page.getByRole("button", { name: /Confirm and send|Send approved email/i });
    const sendButtonCount = await sendButtons.count();
    for (let index = 0; index < sendButtonCount; index += 1) {
      await expect(sendButtons.nth(index)).toBeDisabled();
    }
    await expectNoSensitiveContent(page);
    await noSend.assertNoSendAttempt();
    await guards.assertClean();
  });
});
