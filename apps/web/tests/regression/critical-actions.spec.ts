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
  await command.getByLabel("AI command").fill("Мы продаём AI-систему для B2B. Найди подходящих клиентов в Германии.");
  await expect(command.getByPlaceholder("Вставьте сайт или опишите свой бизнес и кого хотите найти")).toBeVisible();
  await expect(command.getByText("Company website")).toHaveCount(0);
  await command.getByRole("button", { name: "Запустить AI" }).click();

  await expect(page.getByText("Я понял ваш бизнес так")).toBeVisible();
  await expect(page.getByText("Что AI делает сейчас")).toBeVisible();
  await expect(page.getByText("Найдено")).toBeVisible();
  await expect(page.getByText("Подготовлено")).toBeVisible();
  await expect(page.getByText("Autopilot включится только после")).toBeVisible();
});

test("autopilot stays gated behind sender and campaign approval", async ({ page }, testInfo) => {
  const guards = installQaGuards(page, testInfo);
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "AI Autopilot" })).toBeVisible();
  await expect(page.getByText(/подключите и подтвердите рабочую почту|подтверждён/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Разрешить эту кампанию" })).toBeDisabled();
  await page.getByRole("button", { name: "Пауза" }).click();
  await expect(page.getByText("AI Autopilot paused locally")).toBeVisible();
  await guards.assertClean();
});
