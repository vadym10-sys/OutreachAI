import { expect, test, type Locator, type Page } from "@playwright/test";
import { mockWorkspaceApi } from "../../mocks/workspace-api";
import { expectNoHorizontalOverflow, expectNoSensitiveCustomerText, installQaGuards } from "../helpers/qa-guards";

const sections = [
  ["/dashboard", "AI Поиск"],
  ["/dashboard/clients", "CRM"],
  ["/dashboard/emails", "Emails"],
  ["/dashboard/settings", "Настройки"]
] as const;

const primaryNavLabels = ["AI Поиск", "CRM", "Письма", "Настройки"] as const;

const legacyRoutes = [
  ["/dashboard/leads", "AI Поиск"],
  ["/dashboard/ai-customer-finder", "AI Поиск"],
  ["/dashboard/companies", "CRM"],
  ["/dashboard/contacts", "CRM"],
  ["/dashboard/deals", "CRM"],
  ["/dashboard/crm", "CRM"],
  ["/dashboard/campaigns", "Emails"],
  ["/dashboard/inbox", "Emails"]
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

async function mockForcedDryRunAgentFlow(page: Page) {
  const createBodies: Array<{ objective?: string; dry_run?: boolean }> = [];
  const sendEndpointCalls: string[] = [];
  let approveCalls = 0;
  let resumeCalls = 0;
  const now = new Date().toISOString();
  const workspaceId = "99999999-9999-9999-9999-999999999999";
  let run: any = null;
  let steps: any[] = [];
  let approval: any = null;
  const trace = [{
    id: "trace-forced-dry-run",
    run_id: "run-forced-dry-run",
    step_id: "step-search",
    tool_call_id: null,
    workspace_id: workspaceId,
    user_id: "e2e-user",
    event_type: "tool.succeeded",
    status: "succeeded",
    model: "",
    tool_name: "search_companies",
    latency_ms: 12,
    token_usage: {},
    estimated_cost: null,
    approval_decision: "",
    error_category: "",
    message: "",
    data: { tool_result: { status: "dry_run" } },
    untrusted_input: true,
    created_at: now
  }];

  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const apiPath = url.pathname.replace(/^\/api\/backend/, "");
    const method = route.request().method();
    if (apiPath.includes("/send") || apiPath.includes("/provider")) {
      sendEndpointCalls.push(`${method} ${apiPath}`);
    }
    if (apiPath === "/api/workspace-app/agent-runs/status") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ enabled: true, can_create_runs: true, force_dry_run: true, registered_tools_count: 9 }) });
    }
    if (apiPath === "/api/workspace-app/agent-runs" && method === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ runs: run ? [run] : [], next_cursor: "", has_more: false, limit: Number(url.searchParams.get("limit") || 20) }) });
    }
    if (apiPath === "/api/workspace-app/agent-runs/approvals") {
      const approvals = approval?.approval_state === (url.searchParams.get("status") || "pending") ? [approval] : [];
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ approvals, next_cursor: "", has_more: false, limit: 20 }) });
    }
    if (apiPath === "/api/workspace-app/agent-runs" && method === "POST") {
      const body = route.request().postDataJSON() as { objective?: string; dry_run?: boolean };
      createBodies.push(body);
      run = {
        id: "run-forced-dry-run",
        workspace_id: workspaceId,
        user_id: "e2e-user",
        status: "waiting_approval",
        objective: body.objective || "Find a potential company and prepare safe outreach.",
        dry_run: true,
        plan: {},
        current_step_index: 1,
        current_step_name: "Prepare CRM action",
        model: "mock-planner",
        prompt_version: "mock-plan-v1",
        token_usage: { total_tokens: 42 },
        estimated_cost: 0,
        latency_ms: 42,
        error_category: "",
        idempotency_key: "forced-dry-run-ui",
        created_at: now,
        updated_at: now,
        completed_at: null
      };
      steps = [
        {
          id: "step-search",
          run_id: run.id,
          workspace_id: workspaceId,
          step_index: 0,
          status: "completed",
          title: "Find potential companies",
          tool_name: "search_companies",
          input: { query: "local service company", dry_run: true },
          output: { status: "dry_run", dry_run: true, results: [{ company: "Safe Dry Run Co" }] },
          approval_state: "none",
          error_category: "",
          latency_ms: 12,
          created_at: now,
          updated_at: now,
          completed_at: now
        },
        {
          id: "step-crm",
          run_id: run.id,
          workspace_id: workspaceId,
          step_index: 1,
          status: "waiting_approval",
          title: "Prepare CRM action",
          tool_name: "save_to_crm",
          input: { company_name: "Safe Dry Run Co", dry_run: true },
          output: {},
          approval_state: "pending",
          error_category: "",
          latency_ms: 0,
          created_at: now,
          updated_at: now,
          completed_at: null
        },
        {
          id: "step-draft",
          run_id: run.id,
          workspace_id: workspaceId,
          step_index: 2,
          status: "queued",
          title: "Prepare email draft",
          tool_name: "generate_email_draft",
          input: { subject: "Safe intro", dry_run: true },
          output: {},
          approval_state: "none",
          error_category: "",
          latency_ms: 0,
          created_at: now,
          updated_at: now,
          completed_at: null
        }
      ];
      approval = {
        id: "approval-crm",
        run_id: run.id,
        step_id: "step-crm",
        tool_call_id: "tool-call-crm",
        workspace_id: workspaceId,
        user_id: "e2e-user",
        tool_name: "save_to_crm",
        action_type: "crm_action",
        approval_state: "pending",
        tool_arguments: { company_name: "Safe Dry Run Co", dry_run: true },
        decision: {},
        idempotency_key: "approval-crm",
        requested_at: now,
        decided_at: null,
        decided_by_user_id: ""
      };
      return route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ run, steps, approvals: [approval] }) });
    }
    const match = apiPath.match(/^\/api\/workspace-app\/agent-runs\/([^/]+)(?:\/([^/]+))?$/);
    if (!match) return route.fallback();
    const action = match[2] || "";
    if (!run || match[1] !== run.id) return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ detail: "Not found" }) });
    if (!action && method === "GET") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ run, steps, approvals: approval ? [approval] : [] }) });
    if (action === "trace" && method === "GET") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ run, trace }) });
    if (action === "approve" && method === "POST") {
      approveCalls += 1;
      approval = { ...approval, approval_state: "approved", decided_at: new Date().toISOString(), decided_by_user_id: "e2e-user" };
      steps = steps.map((step) => step.id === "step-crm" ? { ...step, approval_state: "approved" } : step);
      run = { ...run, status: "waiting_approval", updated_at: new Date().toISOString() };
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "waiting_approval" }) });
    }
    if (action === "resume" && method === "POST") {
      resumeCalls += 1;
      const completedAt = new Date().toISOString();
      run = { ...run, status: "completed", current_step_index: 2, current_step_name: "Prepare email draft", updated_at: completedAt, completed_at: completedAt };
      steps = steps.map((step) => ({
        ...step,
        status: "completed",
        approval_state: step.id === "step-crm" ? "approved" : step.approval_state,
        output: { status: "dry_run", dry_run: true },
        updated_at: completedAt,
        completed_at: completedAt
      }));
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ run, steps, approvals: approval ? [approval] : [] }) });
    }
    return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ detail: "Not found" }) });
  });

  return {
    createBodies,
    sendEndpointCalls,
    get approveCalls() {
      return approveCalls;
    },
    get resumeCalls() {
      return resumeCalls;
    }
  };
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
    for (const label of primaryNavLabels) {
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
        body: { enabled: false, can_create_runs: false, force_dry_run: true, registered_tools_count: 9 }
      }
    });
    await page.goto("/dashboard/ai-tasks", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "AI Tasks" })).toBeVisible();
    await expect(page.getByText("AI Tasks are preparing for a safe launch. Search, CRM, and emails keep working as before.")).toBeVisible();
    await expect(page.getByRole("textbox", { name: "What should AI do?" })).toBeDisabled();
    const startButton = page.getByRole("button", { name: "Start task" });
    const continueButton = page.getByRole("button", { name: "Continue" });
    const cancelButton = page.getByRole("button", { name: "Cancel" });
    await expect(startButton).toBeDisabled();
    await expect(continueButton).toBeDisabled();
    await expect(cancelButton).toBeDisabled();
    await expect(startButton).toHaveCSS("cursor", "not-allowed");
    await expect(startButton).toHaveCSS("background-color", "rgb(226, 232, 240)");
    await expect(cancelButton).toHaveCSS("background-color", "rgb(226, 232, 240)");
    await expectNoHorizontalOverflow(page);
    await guards.assertClean();
  });

  test("AI Tasks status loading fails closed without posting mutations", async ({ page }) => {
    await mockWorkspaceApi(page, {
      "GET /api/workspace-app/agent-runs/status": {
        body: { enabled: true, can_create_runs: true, force_dry_run: true, registered_tools_count: 9 },
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

  test("AI Tasks forced dry-run requires separate approval and continue without send calls", async ({ page }, testInfo) => {
    const flow = await mockForcedDryRunAgentFlow(page);
    const guards = installQaGuards(page, testInfo);
    await page.goto("/dashboard/ai-tasks", { waitUntil: "domcontentloaded" });
    const dryRunCheckbox = page.getByRole("checkbox", { name: /Safe dry-run mode/ });
    await expect(dryRunCheckbox).toBeChecked();
    await expect(dryRunCheckbox).toBeDisabled();
    await expect(page.getByText("Safe test mode is required.")).toBeVisible();

    await dryRunCheckbox.evaluate((element) => {
      const checkbox = element as HTMLInputElement;
      checkbox.checked = false;
      checkbox.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.getByRole("textbox", { name: "What should AI do?" }).fill("Find a local service company, prepare CRM action and an email draft.");
    await page.getByRole("button", { name: "Start task" }).click();
    await expect(page.getByText("Find potential companies")).toBeVisible();
    await expect(page.getByText("Prepare CRM action", { exact: true })).toBeVisible();
    expect(flow.createBodies).toHaveLength(1);
    expect(flow.createBodies[0].dry_run).toBe(true);

    await page.getByLabel("I reviewed this action.").check();
    await page.getByRole("button", { name: "Approve" }).click();
    await expect.poll(() => flow.approveCalls).toBe(1);
    expect(flow.resumeCalls).toBe(0);
    await expect(page.getByText("Approved. Press Continue when you want the task to move on.")).toBeVisible();

    await page.getByRole("button", { name: "Continue" }).click();
    await expect.poll(() => flow.resumeCalls).toBe(1);
    await expect(page.getByText("Dry-run completed. No external action was taken.")).toBeVisible();
    expect(flow.sendEndpointCalls).toEqual([]);
    await guards.assertClean();
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
    await expect(page.getByRole("checkbox", { name: /Safe dry-run mode/ })).toBeDisabled();
    await expect(page.getByText("Pending approvals")).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await guards.assertClean();
  });
});
