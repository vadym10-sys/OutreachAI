import { expect, test } from "@playwright/test";
import { mockWorkspaceApi } from "../mocks/workspace-api";

const pages = [
  ["/dashboard", "AI Поиск"],
  ["/dashboard/clients", "CRM"],
  ["/dashboard/emails", "Emails"],
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

test("AI assistant accepts one instruction and saves a source-backed company to CRM", async ({ page }) => {
  await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
  await page.getByRole("form", { name: "AI customer command" }).getByLabel("Опишите, что вы продаёте и кому хотите продавать").fill("Продаём AI-продавца для B2B SaaS команд в Европе");
  await page.getByLabel("URL сайта, если есть").fill("https://outreachaiaiai.com");
  await expect(page.getByRole("button", { name: "Запустить AI" })).toBeEnabled({ timeout: 20_000 });
  const searchResponse = page.waitForResponse((response) =>
    response.request().method() === "POST" && response.url().includes("/api/workspace-app/ai-customer-finder/searches")
  );
  await page.getByRole("button", { name: "Запустить AI" }).click();
  await expect((await searchResponse).status()).toBe(202);
  await expect(page.getByText("Я понял ваш бизнес так")).toBeVisible();
  await expect(page.getByText("Что AI делает сейчас")).toBeVisible();
  await expect(page.getByRole("heading", { name: "EuroScale CRM Co" })).toBeVisible();
  await expect(page.getByText("Verified public website content")).toBeVisible();
  await expect(page.getByText("qa.sender@example.com через Gmail OAuth")).toBeVisible();
  const saveResponse = page.waitForResponse((response) =>
    response.request().method() === "POST" && response.url().includes("/api/workspace-app/leads/first-customers/results/finder-result-1/save")
  );
  await page.getByRole("button", { name: "Сохранить в CRM EuroScale CRM Co" }).click();
  await expect((await saveResponse).ok()).toBe(true);
  await expect(page).toHaveURL(/\/dashboard\/clients/);
  await expect(page.getByRole("heading", { name: "CRM", exact: true })).toBeVisible();
  await expect(page.getByRole("article").filter({ hasText: "EuroScale CRM Co" })).toBeVisible();
});
