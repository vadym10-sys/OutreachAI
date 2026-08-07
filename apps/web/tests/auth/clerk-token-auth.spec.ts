import { setupClerkTestingToken } from "@clerk/testing/playwright";
import { expect, test } from "@playwright/test";

const clerkE2E = process.env.CLERK_E2E_ENABLED === "true";
const existingEmail = process.env.CLERK_E2E_EXISTING_EMAIL || "";
const existingPassword = process.env.CLERK_E2E_EXISTING_PASSWORD || "";
const newEmail = process.env.CLERK_E2E_NEW_EMAIL || "";
const newPassword = process.env.CLERK_E2E_NEW_PASSWORD || "";

test.describe("Clerk production-style auth with testing tokens", () => {
  test.skip(!clerkE2E, "Set CLERK_E2E_ENABLED=true with Clerk test keys to run official Testing Token auth coverage.");

  test("existing user signs in through Clerk and reaches dashboard", async ({ page }) => {
    test.skip(!existingEmail || !existingPassword, "Existing Clerk test user env vars are required.");
    await setupClerkTestingToken({ page });
    await page.goto("/sign-in?redirect_url=/dashboard", { waitUntil: "domcontentloaded" });
    await page.locator("input[name=identifier]").fill(existingEmail);
    await page.getByRole("button", { name: /continue/i }).click();
    await page.locator("input[name=password]").fill(existingPassword);
    await page.getByRole("button", { name: /continue/i }).click();
    await page.waitForURL("**/dashboard", { timeout: 30_000 });
  });

  test("new email user signs up through Clerk and reaches dashboard", async ({ page }) => {
    test.skip(!newEmail || !newPassword, "New Clerk test user env vars are required.");
    await setupClerkTestingToken({ page });
    await page.goto("/sign-up?redirect_url=/dashboard", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#clerk-captcha")).toBeAttached();

    const firstNameInput = page.locator("input[name=firstName]");
    if (await firstNameInput.isVisible()) await firstNameInput.fill("Test");
    const lastNameInput = page.locator("input[name=lastName]");
    if (await lastNameInput.isVisible()) await lastNameInput.fill("User");
    const usernameInput = page.locator("input[name=username]");
    if (await usernameInput.isVisible()) await usernameInput.fill(`test_${Date.now()}`);

    await page.locator("input[name=emailAddress], input[name=identifier]").first().fill(newEmail);
    const passwordInput = page.locator("input[name=password]").first();
    if (await passwordInput.isVisible()) await passwordInput.fill(newPassword);
    const legalAccepted = page.locator("input[name=legalAccepted]");
    if (await legalAccepted.isVisible()) await legalAccepted.check();
    await page.getByRole("button", { name: /continue|sign up|create/i }).click();
    await page.waitForURL("**/dashboard", { timeout: 45_000 });
  });

  test("interrupted OAuth callback has a dashboard fallback instead of a blank screen", async ({ page }) => {
    await setupClerkTestingToken({ page });
    await page.goto("/sso-callback", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Completing sign in" })).toBeVisible();
    await expect(page.locator("main")).not.toBeEmpty();
  });
});
