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

test("AI assistant accepts one instruction and keeps autopilot gated", async ({ page }) => {
  await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
  await page.getByRole("form", { name: "AI customer command" }).getByLabel("AI command").fill("https://outreachaiaiai.com");
  await page.getByRole("button", { name: "Запустить AI" }).click();
  await expect(page.getByText("Я понял ваш бизнес так")).toBeVisible();
  await expect(page.getByText("Что AI делает сейчас")).toBeVisible();
  await page.locator("summary").filter({ hasText: "Подробнее по найденным компаниям" }).evaluate((node) => {
    if (node.parentElement instanceof HTMLDetailsElement) node.parentElement.open = true;
  });
  await expect(page.getByRole("heading", { name: "EuroScale CRM Co" })).toBeVisible();
  await expect(page.getByText("Verified public website content")).toBeVisible();
  await expect(page.getByRole("button", { name: "Разрешить эту кампанию" })).toBeDisabled();
  await expect(page.getByText("Autopilot включится только после")).toBeVisible();
});
