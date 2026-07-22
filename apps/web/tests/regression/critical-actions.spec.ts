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
  await page.getByRole("form", { name: "AI customer command" }).getByLabel("AI command").fill("https://outreachaiaiai.com");
  const searchResponse = page.waitForResponse((response) =>
    response.request().method() === "POST" && response.url().includes("/api/workspace-app/ai-customer-finder/searches")
  );
  await page.getByRole("button", { name: "Запустить AI" }).click();
  await expect((await searchResponse).status()).toBe(202);
  await expect(page.getByRole("heading", { name: "AI Autopilot" })).toBeVisible();
  await expect(page.getByText("qa.sender@example.com через Gmail OAuth")).toBeVisible();
  await expect(page.locator('[data-autopilot-state="ready_to_approve"]')).toBeVisible();
  const allowButton = page.getByRole("button", { name: "Разрешить эту кампанию" });
  await expect(allowButton).toBeEnabled();
  const [createCampaignResponse, approveCampaignResponse] = await Promise.all([
    page.waitForResponse((response) => {
      const path = new URL(response.url()).pathname;
      return response.request().method() === "POST" && path.endsWith("/api/campaigns");
    }),
    page.waitForResponse((response) =>
      response.request().method() === "POST" && response.url().includes("/api/campaigns/") && response.url().includes("/autopilot/approve")
    ),
    allowButton.click()
  ]);
  await expect(createCampaignResponse.ok()).toBe(true);
  await expect(approveCampaignResponse.ok()).toBe(true);
  await expect(page.getByText("AI Autopilot approved")).toBeVisible();
  await expect(page.locator('[data-autopilot-state="ready_to_control"]')).toBeVisible();
  await expect(allowButton).toBeDisabled();
  const pauseButton = page.getByRole("button", { name: "Пауза" });
  await expect(pauseButton).toBeEnabled();
  const [pauseResponse] = await Promise.all([
    page.waitForResponse((response) =>
      response.request().method() === "POST" && response.url().includes("/api/campaigns/") && response.url().includes("/pause")
    ),
    pauseButton.click()
  ]);
  await expect(pauseResponse.ok()).toBe(true);
  await expect(page.getByText("Campaign paused in backend.")).toBeVisible();
  await guards.assertClean();
});

test("email action HTTP errors are shown as failures, not success notices", async ({ page }) => {
  await page.unroute("**/api/**");
  await mockWorkspaceApi(page, {
    "POST /api/workspace-app/emails/33333333-3333-3333-3333-333333333333/approve": {
      status: 409,
      body: { detail: "This email has already been sent." }
    }
  });
  await page.goto("/dashboard/emails");
  await expect(page.getByRole("heading", { name: "Письма" })).toBeVisible();
  const approveResponse = page.waitForResponse((response) =>
    response.request().method() === "POST" && response.url().includes("/api/workspace-app/emails/33333333-3333-3333-3333-333333333333/approve")
  );
  await page.getByRole("button", { name: "Approve" }).click();
  await expect((await approveResponse).status()).toBe(409);
  await expect(page.getByText(/already been sent|could not approve this draft|something went wrong|email sending is temporarily unavailable/i)).toBeVisible();
  await expect(page.getByText("Email approved. It is ready to send")).toHaveCount(0);
});
