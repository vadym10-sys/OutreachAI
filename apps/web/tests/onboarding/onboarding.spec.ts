import { expect, test } from "@playwright/test";
import { mockWorkspaceApi } from "../../mocks/workspace-api";
import { expectNoHorizontalOverflow } from "../helpers/qa-guards";

test.describe("onboarding workspace setup", () => {
  test.beforeEach(async ({ page }) => {
    await mockWorkspaceApi(page);
  });

  test("keeps ready customers on the supported lead-finding path", async ({ page }) => {
    await page.goto("/onboarding", { waitUntil: "domcontentloaded" });

    const startFinding = page.getByRole("link", { name: "Start finding customers" });
    await expect(startFinding).toBeVisible();
    await expect(startFinding).toHaveAttribute("href", "/dashboard/leads");
    await expect(page.getByText("You can now search companies, save CRM records, and review outreach from one private workspace.")).toBeVisible();
  });

  test("renders onboarding cleanly on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/onboarding", { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("heading", { name: "What does your business sell?" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Start finding customers" })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});
