import { expect, test } from "@playwright/test";
import { mockWorkspaceApi, qaCompany } from "../../mocks/workspace-api";
import { installQaGuards } from "../helpers/qa-guards";

test.beforeEach(async ({ page }) => {
  await mockWorkspaceApi(page);
});

test("AI assistant runs First Customer Finder and shows source-backed companies", async ({ page }) => {
  test.setTimeout(75_000);
  await page.goto("/dashboard");

  const command = page.getByRole("form", { name: "AI customer command" });
  await expect(command.getByLabel("Опишите, что вы продаёте и кому хотите продавать")).toBeVisible();
  await expect(command.getByText("Company website")).toHaveCount(0);

  await expect(page.getByText("Что AI делает сейчас")).toBeVisible();
  await expect(page.getByText("Найдено")).toBeVisible();
  await expect(page.getByText("Draft", { exact: true })).toBeVisible();
  await expect(page.getByText("qa.sender@example.com через Gmail OAuth")).toBeVisible();
  await expect(page.getByRole("heading", { name: "EuroScale CRM Co" })).toBeVisible();
  await expect(page.getByText("Strong match")).toBeVisible();
  await expect(page.getByText("Confirmed buying signals")).toBeVisible();
  await expect(page.getByRole("button", { name: "Сохранить в CRM EuroScale CRM Co" })).toBeVisible();
});

test("AI-first flow saves a company to CRM and leaves draft approval manual", async ({ page }, testInfo) => {
  const guards = installQaGuards(page, testInfo);
  await page.goto("/dashboard");
  await page.getByRole("form", { name: "AI customer command" }).getByLabel("Опишите, что вы продаёте и кому хотите продавать").fill("Продаём AI-продавца B2B SaaS командам");
  await page.getByLabel("URL сайта, если есть").fill("https://outreachaiaiai.com");
  const searchResponse = page.waitForResponse((response) =>
    response.request().method() === "POST" && response.url().includes("/api/workspace-app/ai-customer-finder/searches")
  );
  await page.getByRole("button", { name: "Запустить AI" }).click();
  await expect((await searchResponse).status()).toBe(202);
  const saveResponse = page.waitForResponse((response) =>
    response.request().method() === "POST" && response.url().includes("/api/workspace-app/leads/first-customers/results/finder-result-1/save")
  );
  await page.getByRole("button", { name: "Сохранить в CRM EuroScale CRM Co" }).click();
  await expect((await saveResponse).ok()).toBe(true);
  await expect(page).toHaveURL(/\/dashboard\/clients/);

  await expect(page.getByRole("heading", { name: "CRM", exact: true })).toBeVisible();
  await expect(page.getByRole("article").filter({ hasText: "EuroScale CRM Co" }).getByRole("heading", { name: "EuroScale CRM Co" })).toBeVisible();
  await expect(page.getByText("draft", { exact: true })).toBeVisible();

  await page.goto("/dashboard/emails");
  await expect(page.getByRole("heading", { name: "Письма" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Send" })).toBeDisabled();
  await expect(page.getByText("Manual approval required.")).toBeVisible();
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

test("email approval send and reply tracking stay connected end to end", async ({ page }) => {
  await page.goto("/dashboard/emails");
  await expect(page.getByRole("heading", { name: "Письма" })).toBeVisible();

  const approveResponse = page.waitForResponse((response) =>
    response.request().method() === "POST" && response.url().includes("/api/workspace-app/emails/33333333-3333-3333-3333-333333333333/approve")
  );
  await page.getByRole("button", { name: "Approve" }).click();
  await expect((await approveResponse).ok()).toBe(true);
  await expect(page.getByText(/ready to send/i)).toBeVisible();

  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("Send this approved email now");
    await dialog.accept();
  });
  const sendResponse = page.waitForResponse((response) =>
    response.request().method() === "POST" && response.url().includes("/api/workspace-app/emails/33333333-3333-3333-3333-333333333333/send")
  );
  await page.getByRole("button", { name: "Send" }).click();
  await expect((await sendResponse).ok()).toBe(true);
  await expect(page.getByText("Approved email was sent. CRM stage updated.")).toBeVisible();

  const syncResponse = page.waitForResponse((response) =>
    response.request().method() === "POST" && response.url().includes("/api/outreach/oauth/gmail/sync")
  );
  await page.getByRole("button", { name: "Track replies" }).click();
  await expect((await syncResponse).ok()).toBe(true);
  await expect(page.getByText("Replies synced: 1. Reply tracking refreshed without sending automatic responses.")).toBeVisible();
  await expect(page.getByText("Re: Quick idea for Hill Country Build Co")).toBeVisible();
  await expect(page.getByText(/Classification: Interested/)).toBeVisible();
  await expect(page.getByRole("article").filter({ hasText: "Re: Quick idea for Hill Country Build Co" }).getByText("Hill Country Build Co", { exact: true })).toBeVisible();
});

test("email recovery requires mailbox confirmation and does not resend automatically", async ({ page }) => {
  let currentEmail = {
    ...qaCompany.generated_emails[0],
    delivery_status: "send_confirmation_pending",
    sent_at: null,
    tags: { sender_provider: "gmail", provider_idempotency_supported: false }
  };
  let recoverPayload: unknown = null;
  let sendRequests = 0;
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const apiPath = url.pathname.replace(/^\/api\/backend/, "");
    if (apiPath === "/api/inbox" && route.request().method() === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", headers: { "X-Has-More": "false", "X-Next-Cursor": "" }, body: JSON.stringify([currentEmail]) });
    }
    if (apiPath === "/api/workspace-app/emails/33333333-3333-3333-3333-333333333333/recover" && route.request().method() === "POST") {
      recoverPayload = route.request().postDataJSON();
      currentEmail = { ...currentEmail, delivery_status: "approved" };
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ status: "success", message: "Interrupted send recovered for retry. Nothing was sent automatically.", company: { ...qaCompany, generated_emails: [currentEmail] }, email: currentEmail })
      });
    }
    if (apiPath === "/api/workspace-app/emails/33333333-3333-3333-3333-333333333333/send" && route.request().method() === "POST") {
      sendRequests += 1;
      return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ detail: "Send should not be called during recovery." }) });
    }
    return route.fallback();
  });

  await page.goto("/dashboard/emails");
  await expect(page.getByRole("heading", { name: "Письма" })).toBeVisible();
  await expect(page.getByText("Delivery confirmation required")).toBeVisible();
  await expect(page.getByText("Check Gmail or SMTP Sent for this mailbox.")).toBeVisible();
  await expect(page.getByRole("button", { name: /Recover for retry/ })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Send" })).toBeDisabled();

  await page.getByLabel("I checked Gmail/SMTP Sent and this email was not sent.").check();
  const recoverResponse = page.waitForResponse((response) =>
    response.request().method() === "POST" && response.url().includes("/api/workspace-app/emails/33333333-3333-3333-3333-333333333333/recover")
  );
  await page.getByRole("button", { name: /Recover for retry/ }).click();
  await expect((await recoverResponse).ok()).toBe(true);
  expect(recoverPayload).toEqual({ confirmed_not_delivered: true });
  expect(sendRequests).toBe(0);
  await expect(page.getByText("Interrupted send recovered for retry. Nothing was sent automatically.")).toBeVisible();
  await expect(page.getByText("Approved", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Send" })).toBeEnabled();
});

test("owner production email smoke-test UI stops before final send", async ({ page }) => {
  let smokeSendRequests = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/api/workspace-app/emails/aaaaaaaa-1111-4111-8111-aaaaaaaa1111/send")) {
      smokeSendRequests += 1;
    }
  });

  await page.goto("/dashboard/settings");
  await expect(page.getByRole("heading", { name: "Production email smoke test" })).toBeVisible();
  await page.getByRole("textbox", { name: "Recipient email" }).fill("owner@smoke-safety-mail.com");
  await page.getByLabel("I control this recipient email and want to create isolated production smoke-test records.").check();
  const createResponse = page.waitForResponse((response) =>
    response.request().method() === "POST" && response.url().includes("/api/workspace-app/production-email-smoke-test")
  );
  await page.getByRole("button", { name: "Production email smoke test" }).click();
  await expect((await createResponse).ok()).toBe(true);
  await expect(page.getByRole("main").getByText("QA Private Workspace", { exact: true }).last()).toBeVisible();
  await expect(page.getByRole("main").getByText("qa.sender@example.com", { exact: true }).last()).toBeVisible();
  await expect(page.getByRole("main").getByText("owner@smoke-safety-mail.com", { exact: true }).last()).toBeVisible();

  await page.getByRole("link", { name: "Open draft" }).click();
  await expect(page).toHaveURL(/\/dashboard\/emails/);
  await expect(page.getByText("Production smoke-test draft")).toBeVisible();
  await expect(page.getByLabel("Body")).toHaveValue(/Internal OutreachAI production email smoke test/);
  await expect(page.getByText("Provider")).toBeVisible();
  await expect(page.getByText("Smoke test ID", { exact: true })).toBeVisible();

  await page.getByLabel("Subject").fill("[OutreachAI Production Smoke Test] reviewed");
  const editResponse = page.waitForResponse((response) =>
    response.request().method() === "PATCH" && response.url().includes("/api/workspace-app/emails/aaaaaaaa-1111-4111-8111-aaaaaaaa1111")
  );
  await page.getByRole("button", { name: /Save email edits/ }).click();
  await expect((await editResponse).ok()).toBe(true);

  const approveResponse = page.waitForResponse((response) =>
    response.request().method() === "POST" && response.url().includes("/api/workspace-app/emails/aaaaaaaa-1111-4111-8111-aaaaaaaa1111/approve")
  );
  await page.getByRole("button", { name: /Approve email/ }).click();
  await expect((await approveResponse).ok()).toBe(true);
  await expect(page.getByText("Email approved. It is ready to send, but nothing was sent automatically.")).toBeVisible();

  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("Final confirmation");
    expect(dialog.message()).toContain("owner@smoke-safety-mail.com");
    await dialog.dismiss();
  });
  await page.getByRole("button", { name: /Send email/ }).click();
  expect(smokeSendRequests).toBe(0);
});

test("email workspace can load older inbox reply pages", async ({ page }) => {
  const replies = Array.from({ length: 26 }, (_, index) => ({
    id: `99999999-9999-9999-9999-${String(index).padStart(12, "0")}`,
    campaign_id: null,
    lead_id: null,
    subject: index === 25 ? "Older reply 25" : `Reply ${index}`,
    preview: index === 25 ? "This older reply is on page two." : `Reply preview ${index}`,
    body: index === 25 ? "This older reply is on page two." : `Reply body ${index}`,
    cta: "",
    follow_up_1: "",
    follow_up_2: "",
    delivery_status: "replied",
    sent_at: null,
    delivered_at: null,
    opened_at: null,
    bounced_at: null,
    replied_at: "2026-08-01T12:00:00.000Z",
    reply_assistant: { classification: "Interested" },
    tags: {},
    created_at: "2026-08-01T12:00:00.000Z"
  }));
  await page.unroute("**/api/**");
  await mockWorkspaceApi(page, { "GET /api/inbox": { body: replies } });

  await page.goto("/dashboard/emails");
  await expect(page.getByRole("heading", { name: "Письма" })).toBeVisible();
  await expect(page.getByText("Older reply 25")).toHaveCount(0);

  const olderPageResponse = page.waitForResponse((response) => response.url().includes("/api/inbox?page_size=25&cursor="));
  await page.getByRole("button", { name: "Load older replies" }).click();
  await expect((await olderPageResponse).ok()).toBe(true);
  await expect(page.getByText("Older reply 25")).toBeVisible();
});

test("company workspace explains AI decisions with memory context", async ({ page }, testInfo) => {
  const guards = installQaGuards(page, testInfo);
  await page.goto("/dashboard/companies");
  await expect(page.getByRole("heading", { name: "CRM", exact: true })).toBeVisible();
  const explainResponse = page.waitForResponse((response) =>
    response.request().method() === "GET" && response.url().includes("/api/workspace-app/ai-memory/decisions/44444444-4444-4444-4444-444444444444/explain")
  );
  await page.getByRole("button", { name: "Why AI decided this?" }).click();
  await expect((await explainResponse).ok()).toBe(true);
  await expect(page.getByText("Decision evidence")).toBeVisible();
  await expect(page.getByText("Verified facts")).toBeVisible();
  await expect(page.getByText("Business profile: OutreachAI sells AI-powered outbound workflow software.")).toBeVisible();
  await guards.assertClean();
});
