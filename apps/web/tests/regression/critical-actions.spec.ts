import { expect, test } from "@playwright/test";
import { mockWorkspaceApi } from "../../mocks/workspace-api";
import { installQaGuards } from "../helpers/qa-guards";

test.beforeEach(async ({ page }) => {
  await mockWorkspaceApi(page);
});

test("AI assistant runs First Customer Finder and shows source-backed companies", async ({ page }, testInfo) => {
  const guards = installQaGuards(page, testInfo);
  await page.goto("/dashboard");

  const command = page.getByRole("form", { name: "AI customer command" });
  await command.getByLabel("AI command").fill("Find first customers in Germany with public SDR hiring signals.");
  await command.getByLabel("Business description").fill("OutreachAI helps B2B sales teams find verified first customers.");
  await command.getByLabel("Product or service").fill("AI sales research and reviewed outreach drafts.");
  await command.getByLabel("Country").fill("Germany");
  await command.getByLabel("Industry").fill("B2B SaaS");
  await command.getByRole("button", { name: "Run First Customer Finder" }).click();

  await expect(page.getByRole("heading", { name: "EuroScale CRM Co" })).toBeVisible();
  await expect(page.getByText("Verified public website content")).toBeVisible();
  await page.getByText("Подробнее").first().click();
  await expect(page.getByRole("link", { name: /EuroScale CRM careers/ })).toBeVisible();
  await guards.assertClean();
});

test("saving and sending remain explicit human actions", async ({ page }, testInfo) => {
  const guards = installQaGuards(page, testInfo);
  page.on("dialog", async (dialog) => {
    expect(dialog.message()).toContain("Send this approved email now?");
    await dialog.accept();
  });

  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Save to CRM" }).first().click();
  await expect(page.getByText("Lead saved to CRM")).toBeVisible();
  await page.getByRole("button", { name: "Approve draft" }).first().click();
  await expect(page.getByText("Email approved")).toBeVisible();
  await page.getByRole("button", { name: "Send approved" }).first().click();
  await expect(page.getByText("Approved email was sent")).toBeVisible();
  await guards.assertClean();
});
