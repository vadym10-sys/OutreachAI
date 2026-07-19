import { expect, test } from "@playwright/test";
import { mockWorkspaceApi } from "../../mocks/workspace-api";
import { installQaGuards } from "../helpers/qa-guards";

test.beforeEach(async ({ page }) => {
  await mockWorkspaceApi(page);
});

test("AI assistant runs First Customer Finder and shows source-backed companies", async ({ page }) => {
  test.setTimeout(75_000);
  await page.goto("/dashboard");

  const command = page.getByRole("form", { name: "AI customer command" });
  await expect(command.getByPlaceholder("Вставьте сайт или опишите свой бизнес и кого хотите найти")).toBeVisible();
  await expect(command.getByText("Company website")).toHaveCount(0);

  await expect(page.getByText("Что AI делает сейчас")).toBeVisible();
  await expect(page.getByText("Найдено")).toBeVisible();
  await expect(page.getByText("Подготовлено")).toBeVisible();
  await expect(page.getByText("qa.sender@example.com через Gmail OAuth")).toBeVisible();
  await expect(page.getByRole("button", { name: "Разрешить эту кампанию" })).toBeVisible();
});

test("autopilot approval queues backend campaign and supports pause", async ({ page }, testInfo) => {
  const guards = installQaGuards(page, testInfo);
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "AI Autopilot" })).toBeVisible();
  await expect(page.getByText("qa.sender@example.com через Gmail OAuth")).toBeVisible();
  await expect(page.getByRole("button", { name: "Разрешить эту кампанию" })).toBeEnabled();
  await page.getByRole("button", { name: "Разрешить эту кампанию" }).click();
  await expect(page.getByText("AI Autopilot approved")).toBeVisible();
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll("button"));
    buttons.find((button) => button.textContent?.includes("Пауза"))?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await expect(page.getByText("Campaign paused in backend.")).toBeVisible();
  await guards.assertClean();
});
