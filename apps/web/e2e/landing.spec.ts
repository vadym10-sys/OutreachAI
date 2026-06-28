import { expect, test } from "@playwright/test";

test("landing explains the B2B outbound product and pricing", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "AI Sales Employee for B2B Lead Generation" })).toBeVisible();
  await expect(page.getByText("Find qualified companies, analyze their websites, generate personalized outreach")).toBeVisible();
  await expect(page.getByRole("link", { name: "View demo dashboard" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Lead Finder" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Decision Maker Finder" })).toBeVisible();
  await expect(page.getByText("Starter")).toBeVisible();
  await expect(page.getByText("€149")).toBeVisible();
  await expect(page.getByText("€499")).toBeVisible();
});
