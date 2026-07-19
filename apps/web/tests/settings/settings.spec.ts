import { expect, test } from "@playwright/test";
import { mockWorkspaceApi } from "../../mocks/workspace-api";
import { installQaGuards } from "../helpers/qa-guards";

test.beforeEach(async ({ page }) => {
  await mockWorkspaceApi(page);
});

test("settings keeps one primary next action and advanced controls collapsed", async ({ page }, testInfo) => {
  const guards = installQaGuards(page, testInfo);
  await page.goto("/dashboard/settings");
  await expect(page.getByRole("heading", { name: "Prepare the workspace for the first customer workflow." })).toBeVisible();
  await expect(page.getByRole("link", { name: "Find leads" })).toBeVisible();
  const advancedCopy = "Use this area only when a workspace owner needs to adjust";
  await expect(page.locator("details[open]").getByText(advancedCopy)).toHaveCount(0);
  await page.getByText("Advanced settings").first().click();
  await expect(page.locator("details[open]").getByText(advancedCopy).first()).toBeVisible();
  await guards.assertClean();
});

test("sender setup validates required fields and blocks false success", async ({ page }, testInfo) => {
  const guards = installQaGuards(page, testInfo);

  await page.route("**/api/outreach/sender/status", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        provider: "resend",
        connected: false,
        status: "needs_setup",
        sender_name: "",
        sender_email: null,
        reply_to: null,
        daily_send_limit: 25,
        sent_today: 0,
        remaining_today: 25,
        spf_status: "not_checked",
        dkim_status: "not_checked",
        dmarc_status: "not_checked",
        next_action: "Add sender details to continue.",
        smtp_host: "",
        smtp_port: 587,
        smtp_username: "",
        smtp_configured: false
      })
    });
  });

  await page.route("**/api/outreach/sender", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        provider: "resend",
        connected: false,
        status: "needs_setup",
        sender_name: "QA Sender",
        sender_email: "qa@example.com",
        reply_to: "qa@example.com",
        daily_send_limit: 25,
        sent_today: 0,
        remaining_today: 25,
        spf_status: "not_checked",
        dkim_status: "not_checked",
        dmarc_status: "not_checked",
        next_action: "Verify sender domain before sending.",
        smtp_host: "",
        smtp_port: 587,
        smtp_username: "",
        smtp_configured: false
      })
    });
  });

  await page.goto("/dashboard/settings");
  await expect(page.getByRole("heading", { name: "Send from your workspace" })).toBeVisible();
  const providerSelect = page.getByLabel("Provider").first();
  await expect(providerSelect).toContainText("Connected API sender");
  await expect(providerSelect).toContainText("SMTP mailbox");
  await expect(page.getByRole("option", { name: "Gmail (needs OAuth)" })).toHaveCount(0);
  await expect(page.getByRole("option", { name: "Outlook (needs OAuth)" })).toHaveCount(0);
  await expect(page.getByText("Gmail and Outlook mailboxes can connect through SMTP with an app password.")).toBeVisible();

  await page.getByRole("button", { name: "Save sending setup" }).click();
  await expect(page.getByText("Enter sender name and sender email before saving.")).toBeVisible();

  await page.getByLabel("Sender name").fill("QA Sender");
  await page.getByLabel("Sender email").fill("qa@example.com");
  await page.getByRole("button", { name: "Save sending setup" }).click();

  await expect(page.locator("form").getByText("Verify sender domain before sending.")).toBeVisible();
  await expect(page.getByText("Sending setup saved")).toHaveCount(0);
  await guards.assertClean();
});
