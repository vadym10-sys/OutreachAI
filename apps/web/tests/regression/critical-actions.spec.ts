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
  await expect(page.getByRole("button", { name: "Approve draft for EuroScale CRM Co" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Send email for EuroScale CRM Co" })).toBeDisabled();
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
  const savedCompany = page.getByRole("article").filter({ hasText: "EuroScale CRM Co" });
  await expect(savedCompany.getByRole("heading", { name: "EuroScale CRM Co" })).toBeVisible();
  await expect(savedCompany.getByLabel(/Overall Lead Score: 84 (out of 100|из 100)/)).toBeVisible();
  await expect(savedCompany.getByLabel(/Website Quality: 71 (out of 100|из 100)/)).toBeVisible();
  await expect(savedCompany.getByLabel(/Contact Confidence: 78 (out of 100|из 100)/)).toBeVisible();
  await expect(savedCompany.getByLabel(/Outreach Readiness: 66 (out of 100|из 100)/)).toBeVisible();
  await expect(savedCompany.getByLabel(/Outreach Readiness: 80 (out of 100|из 100)/)).toHaveCount(0);
  await expect(page.getByText("draft", { exact: true })).toBeVisible();

  await page.goto("/dashboard/emails");
  await expect(page.getByRole("heading", { name: "Письма" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Send" })).toBeDisabled();
  await expect(page.getByText("Manual approval required.")).toBeVisible();
  await guards.assertClean();
});

test("CRM cards do not invent Customer Finder scores when scoring evidence is absent", async ({ page }) => {
  await page.unroute("**/api/**");
  const noScoringCompany = {
    ...qaCompany,
    overall_score: 99,
    priority_score: 98,
    icp_score: 97,
    confidence_score: 96,
    ai_company_predictions: { sales_readiness: { score: 95 } },
    overall_lead_score: null,
    website_quality_score: null,
    contact_confidence_score: null,
    outreach_readiness_score: null,
    lead_score_explanation: "",
    lead_intelligence: {}
  };
  await mockWorkspaceApi(page, {
    "GET /api/workspace-app/companies": { body: [noScoringCompany] }
  });

  await page.goto("/dashboard/clients");
  const company = page.getByRole("article").filter({ hasText: "Hill Country Build Co" });
  await expect(company.getByLabel(/Overall Lead Score: (Insufficient data|Недостаточно данных)/)).toBeVisible();
  await expect(company.getByLabel(/Website Quality: (Insufficient data|Недостаточно данных)/)).toBeVisible();
  await expect(company.getByLabel(/Contact Confidence: (Insufficient data|Недостаточно данных)/)).toBeVisible();
  await expect(company.getByLabel(/Outreach Readiness: (Insufficient data|Недостаточно данных)/)).toBeVisible();
  await expect(company.getByLabel(/Outreach Readiness: 80 (out of 100|из 100)/)).toHaveCount(0);
});

test("CRM cards render partial Customer Finder scoring without falling back to generic scores", async ({ page }) => {
  await page.unroute("**/api/**");
  const partialScoringCompany = {
    ...qaCompany,
    overall_score: 99,
    priority_score: 98,
    icp_score: 97,
    confidence_score: 96,
    ai_company_predictions: { sales_readiness: { score: 95 } },
    overall_lead_score: 64,
    website_quality_score: null,
    contact_confidence_score: null,
    outreach_readiness_score: 55,
    lead_score_explanation: "Partial score from confirmed Customer Finder evidence.",
    lead_intelligence: {
      overall_lead_score: 64,
      components: { outreach_readiness: 55 },
      insufficient_data: ["website_quality", "contact_confidence"]
    }
  };
  await mockWorkspaceApi(page, {
    "GET /api/workspace-app/companies": { body: [partialScoringCompany] }
  });

  await page.goto("/dashboard/clients");
  const company = page.getByRole("article").filter({ hasText: "Hill Country Build Co" });
  await expect(company.getByLabel(/Overall Lead Score: 64 (out of 100|из 100)/)).toBeVisible();
  await expect(company.getByLabel(/Website Quality: (Insufficient data|Недостаточно данных)/)).toBeVisible();
  await expect(company.getByLabel(/Contact Confidence: (Insufficient data|Недостаточно данных)/)).toBeVisible();
  await expect(company.getByLabel(/Outreach Readiness: 55 (out of 100|из 100)/)).toBeVisible();
  await expect(company.getByLabel(/Outreach Readiness: 80 (out of 100|из 100)/)).toHaveCount(0);
  await expect(company.getByText("Partial score from confirmed Customer Finder evidence.")).toBeVisible();
});

test("mobile CRM card keeps full Customer Finder scoring visible", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard/clients");
  const company = page.getByRole("article").filter({ hasText: "Hill Country Build Co" });
  await expect(company.getByLabel(/Overall Lead Score: 84 (out of 100|из 100)/)).toBeVisible();
  await expect(company.getByLabel(/Website Quality: 71 (out of 100|из 100)/)).toBeVisible();
  await expect(company.getByLabel(/Contact Confidence: 78 (out of 100|из 100)/)).toBeVisible();
  await expect(company.getByLabel(/Outreach Readiness: 66 (out of 100|из 100)/)).toBeVisible();
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

test("non-owner can edit draft recipient before approve and send confirmation uses it", async ({ page }) => {
  let patchPayload: Record<string, unknown> | null = null;
  page.on("request", (request) => {
    if (request.method() === "PATCH" && request.url().includes("/api/workspace-app/emails/33333333-3333-3333-3333-333333333333")) {
      patchPayload = request.postDataJSON() as Record<string, unknown>;
    }
  });
  await page.goto("/dashboard/emails");
  await expect(page.getByRole("heading", { name: "Письма" })).toBeVisible();
  await page.getByLabel("Recipient email").fill("reviewed.recipient@recipient-safety-mail.com");
  const editResponse = page.waitForResponse((response) =>
    response.request().method() === "PATCH" && response.url().includes("/api/workspace-app/emails/33333333-3333-3333-3333-333333333333")
  );
  await page.getByRole("button", { name: /Save email edits/ }).click();
  await expect((await editResponse).ok()).toBe(true);
  expect(patchPayload).toMatchObject({
    recipient_email: "reviewed.recipient@recipient-safety-mail.com",
    subject: "Quick idea for Hill Country Build Co"
  });
  await expect(page.getByText("reviewed.recipient@recipient-safety-mail.com")).toBeVisible();

  const approveResponse = page.waitForResponse((response) =>
    response.request().method() === "POST" && response.url().includes("/api/workspace-app/emails/33333333-3333-3333-3333-333333333333/approve")
  );
  await page.getByRole("button", { name: "Approve" }).click();
  await expect((await approveResponse).ok()).toBe(true);
  await expect(page.getByLabel("Recipient email")).toBeDisabled();
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("dialog", { name: "Final Send confirmation" })).toBeVisible();
  await expect(page.getByRole("dialog").getByText("reviewed.recipient@recipient-safety-mail.com")).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
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

  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("dialog", { name: "Final Send confirmation" })).toBeVisible();
  await expect(page.getByRole("dialog").getByText("OutreachAI will send this approved email only after this confirmation.")).toBeVisible();
  const sendResponse = page.waitForResponse((response) =>
    response.request().method() === "POST" && response.url().includes("/api/workspace-app/emails/33333333-3333-3333-3333-333333333333/send")
  );
  await page.getByRole("button", { name: "Confirm Send" }).click();
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

test("ordinary workspace owner cannot see production email smoke-test UI", async ({ page }) => {
  let activeSmokeRequests = 0;
  page.on("request", (request) => {
    if (request.method() === "GET" && request.url().includes("/api/workspace-app/production-email-smoke-test/active")) {
      activeSmokeRequests += 1;
    }
  });

  await page.goto("/dashboard/settings");
  await expect(page.getByRole("heading", { name: "Production email smoke test" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Production email smoke test" })).toHaveCount(0);
  expect(activeSmokeRequests).toBe(0);
});

test("owner production email smoke-test UI stops before final send", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("outreachai.e2eUserEmail", "romaniukvadym10@gmail.com");
  });
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

  const activeResponse = page.waitForResponse((response) =>
    response.request().method() === "GET" && response.url().includes("/api/workspace-app/production-email-smoke-test/active")
  );
  await page.reload();
  await expect((await activeResponse).ok()).toBe(true);
  await expect(page.getByRole("link", { name: "Open draft" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Cleanup smoke test" })).toBeEnabled();
  await expect(page.getByRole("main").getByText("owner@smoke-safety-mail.com", { exact: true }).last()).toBeVisible();

  await page.getByRole("link", { name: "Open draft" }).click();
  await expect(page).toHaveURL(/\/dashboard\/emails/);
  await expect(page.getByText("Production smoke-test draft")).toBeVisible();
  await expect(page.getByLabel("Body")).toHaveValue(/Internal OutreachAI production email smoke test/);
  await expect(page.getByTestId("evidence-recipient").getByText("owner@smoke-safety-mail.com", { exact: true })).toBeVisible();
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

  await page.getByRole("button", { name: /Send email/ }).click();
  await expect(page.getByRole("dialog", { name: "Final Send confirmation" })).toBeVisible();
  await expect(page.getByRole("dialog").getByText("owner@smoke-safety-mail.com")).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("dialog", { name: "Final Send confirmation" })).toHaveCount(0);
  expect(smokeSendRequests).toBe(0);

  await page.goto("/dashboard/settings");
  const cleanupResponse = page.waitForResponse((response) =>
    response.request().method() === "POST" && response.url().includes("/api/workspace-app/production-email-smoke-test/cleanup")
  );
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Cleanup smoke test" }).click();
  await expect((await cleanupResponse).ok()).toBe(true);
  await page.reload();
  await expect(page.getByRole("button", { name: "Cleanup smoke test" })).toBeDisabled();
  await expect(page.getByRole("link", { name: "Open draft" })).toHaveCount(0);
});

test("owner production email smoke-test route-missing error is explicit", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("outreachai.e2eUserEmail", "romaniukvadym10@gmail.com");
  });
  await page.unroute("**/api/**");
  await mockWorkspaceApi(page, {
    "POST /api/workspace-app/production-email-smoke-test": {
      status: 404,
      body: { detail: "We couldn’t find what you were looking for." }
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
  await expect((await createResponse).status()).toBe(404);
  await expect(
    page.getByText(
      "Production email smoke-test endpoint is not available on the connected backend. Verify this preview is connected to a branch-matched API."
    )
  ).toBeVisible();
  await expect(page.getByText("We couldn’t find what you were looking for.")).toHaveCount(0);
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
