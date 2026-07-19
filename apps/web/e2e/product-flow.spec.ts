import { expect, test } from "@playwright/test";
import { mockWorkspaceApi } from "../mocks/workspace-api";

const pages = [
  ["/dashboard", "AI-помощник"],
  ["/dashboard/clients", "Клиенты"],
  ["/dashboard/emails", "Письма"],
  ["/dashboard/settings", "Настройки"]
] as const;

test.beforeEach(async ({ page }) => {
  await mockWorkspaceApi(page);
});

test("AI-first workspace exposes four sections only", async ({ page }) => {
  for (const [route, heading] of pages) {
    await page.goto(route, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  }
});

test("AI assistant finds real-source candidates and requires manual send confirmation", async ({ page }) => {
  page.on("dialog", async (dialog) => {
    expect(dialog.message()).toContain("Send this approved email now?");
    await dialog.accept();
  });
  await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "EuroScale CRM Co" })).toBeVisible();
  await page.getByText("Подробнее").first().click();
  await expect(page.getByRole("link", { name: /EuroScale CRM careers/ })).toBeVisible();
  await page.getByRole("button", { name: "Save to CRM" }).first().click();
  await expect(page.getByText("Lead saved to CRM")).toBeVisible();
  await page.getByRole("button", { name: "Approve draft" }).first().click();
  await expect(page.getByText("Email approved")).toBeVisible();
  await page.getByRole("button", { name: "Send approved" }).first().click();
  await expect(page.getByText("Approved email was sent")).toBeVisible();
});
