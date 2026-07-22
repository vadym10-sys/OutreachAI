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

test("AI assistant accepts one instruction and prepares Autopilot approval surface", async ({ page }) => {
  await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
  await page.getByRole("form", { name: "AI customer command" }).getByLabel("AI command").fill("https://outreachaiaiai.com");
  await expect(page.getByRole("button", { name: "Запустить AI" })).toBeEnabled({ timeout: 20_000 });
  const searchResponse = page.waitForResponse((response) =>
    response.request().method() === "POST" && response.url().includes("/api/workspace-app/ai-customer-finder/searches")
  );
  await page.getByRole("button", { name: "Запустить AI" }).click();
  await expect((await searchResponse).status()).toBe(202);
  await expect(page.getByText("Я понял ваш бизнес так")).toBeVisible();
  await expect(page.getByText("Что AI делает сейчас")).toBeVisible();
  const companyDetails = page.locator("summary").filter({ hasText: "Подробнее по найденным компаниям" });
  await expect(companyDetails).toBeVisible();
  await companyDetails.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "EuroScale CRM Co" })).toBeVisible();
  await expect(page.getByText("Verified public website content")).toBeVisible();
  await expect(page.getByText("qa.sender@example.com через Gmail OAuth")).toBeVisible();
  await expect(page.getByRole("button", { name: "Разрешить эту кампанию" })).toBeVisible();
});
