import { expect, test } from "@playwright/test";

test("landing page renders pricing", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "OutreachAI" })).toBeVisible();
  await expect(page.getByText("$99")).toBeVisible();
});
