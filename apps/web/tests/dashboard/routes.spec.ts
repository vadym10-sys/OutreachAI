import { expect, test, type Locator, type Page } from "@playwright/test";
import { mockWorkspaceApi } from "../../mocks/workspace-api";
import { expectNoHorizontalOverflow, expectNoSensitiveCustomerText, installQaGuards } from "../helpers/qa-guards";

const sections = [
  ["/dashboard", "AI Поиск"],
  ["/dashboard/clients", "CRM"],
  ["/dashboard/emails", "Письма"],
  ["/dashboard/settings", "Настройки"]
] as const;

const legacyRoutes = [
  ["/dashboard/leads", "AI Поиск"],
  ["/dashboard/ai-customer-finder", "AI Поиск"],
  ["/dashboard/companies", "CRM"],
  ["/dashboard/contacts", "CRM"],
  ["/dashboard/deals", "CRM"],
  ["/dashboard/crm", "CRM"],
  ["/dashboard/campaigns", "Письма"],
  ["/dashboard/inbox", "Письма"]
] as const;

function collectAgentRuntimePosts(page: Page) {
  const posts: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/api/workspace-app/agent-runs")) {
      posts.push(request.url());
    }
  });
  return posts;
}

async function forceClickIfPresent(locator: Locator) {
  if (await locator.count()) {
    await locator.first().click({ force: true }).catch(() => undefined);
  }
}

test.describe("AI-first workspace routes", () => {
  test.beforeEach(async ({ page }) => {
    await mockWorkspaceApi(page);
  });

  test("renders only the four main customer sections", async ({ page }) => {
    for (const [route, heading] of sections) {
      await page.goto(route, { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
      await expectNoSensitiveCustomerText(page);
      await expectNoHorizontalOverflow(page);
    }
  });

  test("legacy dashboard routes redirect into the simplified structure", async ({ page }) => {
    for (const [route, heading] of legacyRoutes) {
      await page.goto(route, { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    }
  });

  test("mobile navigation exposes the four primary sections", async ({ page }, testInfo) => {
    const guards = installQaGuards(page, testInfo);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    for (const [, label] of sections) {
      await expect(page.getByRole("link", { name: label }).last()).toBeVisible();
    }
    await expect(page.locator("nav.sticky.top-16 a")).toHaveCount(4);
    await expect(page.getByRole("link", { name: "AI Tasks" })).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
    await guards.assertClean();
  });

  test("AI Tasks disabled state keeps mutating controls unavailable", async ({ page }, testInfo) => {
    const guards = installQaGuards(page, testInfo);
    await mockWorkspaceApi(page, {
      "GET /api/workspace-app/agent-runs/status": {
        body: { enabled: false, can_create_runs: false, registered_tools_count: 9 }
      }
    });
    await page.goto("/dashboard/ai-tasks", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "AI Tasks" })).toBeVisible();
    await expect(page.getByText("AI Tasks are preparing for a safe launch. Search, CRM, and emails keep working as before.")).toBeVisible();
    await expect(page.getByRole("textbox", { name: "What should AI do?" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Start task" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Continue" })).toBeDisabled();
    await expectNoHorizontalOverflow(page);
    await guards.assertClean();
  });

  test("AI Tasks status loading fails closed without posting mutations", async ({ page }) => {
    await mockWorkspaceApi(page, {
      "GET /api/workspace-app/agent-runs/status": {
        body: { enabled: true, can_create_runs: true, registered_tools_count: 9 },
        delayMs: 1200
      }
    });
    const posts = collectAgentRuntimePosts(page);
    await page.goto("/dashboard/ai-tasks", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("textbox", { name: "What should AI do?" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Start task" })).toBeDisabled();
    await forceClickIfPresent(page.getByRole("button", { name: "Start task" }));
    await forceClickIfPresent(page.getByRole("button", { name: "Approve" }));
    await forceClickIfPresent(page.getByRole("button", { name: "Reject" }));
    await forceClickIfPresent(page.getByRole("button", { name: "Continue" }));
    await forceClickIfPresent(page.getByRole("button", { name: "Cancel" }));
    await page.waitForTimeout(150);
    expect(posts).toEqual([]);
  });

  test("AI Tasks status failure keeps all visible mutations disabled", async ({ page }) => {
    await mockWorkspaceApi(page, {
      "GET /api/workspace-app/agent-runs/status": {
        status: 400,
        body: { detail: "Traceback: leaked token body should not be displayed." }
      }
    });
    const posts = collectAgentRuntimePosts(page);
    page.on("dialog", (dialog) => void dialog.dismiss());
    await page.goto("/dashboard/ai-tasks", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByText(/Traceback|leaked token/i)).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: "What should AI do?" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Start task" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Approve" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Reject" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Continue" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Cancel" })).toBeDisabled();
    await forceClickIfPresent(page.getByRole("button", { name: "Start task" }));
    await forceClickIfPresent(page.getByRole("button", { name: "Approve" }));
    await forceClickIfPresent(page.getByRole("button", { name: "Reject" }));
    await forceClickIfPresent(page.getByRole("button", { name: "Continue" }));
    await forceClickIfPresent(page.getByRole("button", { name: "Cancel" }));
    await page.waitForTimeout(150);
    expect(posts).toEqual([]);
  });

  test("AI Tasks approval requires draft review and separate continue", async ({ page }, testInfo) => {
    const guards = installQaGuards(page, testInfo);
    await page.goto("/dashboard/ai-tasks", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "AI Tasks" })).toBeVisible();
    await expect(page.getByText("Pending approvals")).toBeVisible();
    await expect(page.getByRole("link", { name: /Review email/ })).toBeVisible();
    await page.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByText("Review the draft and confirm final send separately before approving.")).toBeVisible();
    await page.getByLabel("I reviewed the draft in the email screen.").check();
    await page.getByLabel("I separately confirm the final send step.").check();
    const approved = page.waitForResponse((response) => response.request().method() === "POST" && response.url().includes("/api/workspace-app/agent-runs/") && response.url().includes("/approve"));
    await page.getByRole("button", { name: "Approve" }).click();
    await approved;
    await expect(page.getByText("Approved. Press Continue when you want the task to move on.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue" })).toBeEnabled();
    const resumed = page.waitForResponse((response) => response.request().method() === "POST" && response.url().includes("/api/workspace-app/agent-runs/") && response.url().includes("/resume"));
    await page.getByRole("button", { name: "Continue" }).click();
    await resumed;
    await expect(page.getByText("Technical details")).toBeVisible();
    await expect(page.getByText("body")).toHaveCount(0);
    await guards.assertClean();
  });

  test("AI Tasks remains usable on mobile without adding a fifth bottom item", async ({ page }, testInfo) => {
    const guards = installQaGuards(page, testInfo);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/dashboard/ai-tasks", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "AI Tasks" })).toBeVisible();
    await expect(page.locator("nav.sticky.top-16 a")).toHaveCount(4);
    await expect(page.getByRole("textbox", { name: "What should AI do?" })).toBeVisible();
    await expect(page.getByText("Pending approvals")).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await guards.assertClean();
  });
});
