import { expect, test } from "@playwright/test";

const campaign = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "Austin Builders Outreach",
  industry: "Construction",
  countries: ["United States"],
  cities: ["Austin"],
  company_size: "11-50",
  keywords: ["renovation"],
  website_filters: ["contact page"],
  language: "English",
  offer: "qualified renovation leads",
  cta: "Book a growth audit",
  email_tone: "Consultative",
  signature: "OutreachAI",
  status: "Draft",
  schedule_at: null,
  follow_up_days: 3,
  leads: 1,
  sent: 0,
  replies: 0,
  created_at: new Date().toISOString()
};

const lead = {
  id: "22222222-2222-2222-2222-222222222222",
  company: "Hill Country Build Co",
  website: "https://example.com",
  industry: "Construction",
  country: "United States",
  city: "Austin",
  contact: "Jane Doe",
  email: "jane@example.com",
  phone: null,
  linkedin: null,
  domain: "example.com",
  employee_count: 42,
  revenue_range: "1M-10M",
  title: "Owner",
  confidence: "high",
  apollo_company_id: "apollo_org_1",
  apollo_contact_id: null,
  hunter_contact_id: "jane@example.com",
  hunter_verified: true,
  hunter_status: "verified",
  source: "hunter",
  niche: "Construction",
  status: "Qualified",
  campaign_id: campaign.id,
  campaign: campaign.name,
  created_at: new Date().toISOString()
};

const teamRouterDashboard = {
  employees: ["Sales", "Marketing", "Support", "Operations"].map((employee) => ({
    employee,
    role: `${employee} Employee handles reviewed AI work.`,
    active_tasks: employee === "Sales" ? 1 : 0,
    completed_tasks: employee === "Marketing" ? 1 : 0,
    last_activity: employee === "Support" ? "Summarize customer replies" : "No activity yet",
    performance: employee === "Marketing" ? 100 : 0,
    status: employee === "Sales" ? "working" : "ready",
    tasks: [],
    activity: [],
    results: [],
    memory: { tools: [] }
  })),
  current_plan: null,
  history: []
};

test.beforeEach(async ({ page }) => {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    let body: unknown = {};

    if (url.pathname === "/api/dashboard") {
      body = { leads: 1, campaigns: 1, emails_sent: 0, delivered: 0, opened: 0, replies: 0, bounces: 0, open_rate: 0, reply_rate: 0, conversion_rate: 0, meetings: 0, revenue: 0, mrr: 0 };
    } else if (url.pathname === "/api/activity") {
      body = [{ id: "33333333-3333-3333-3333-333333333333", action: "campaign.created", metadata_json: {}, created_at: new Date().toISOString() }];
    } else if (url.pathname === "/api/notifications") {
      body = [{ id: "44444444-4444-4444-4444-444444444444", kind: "success", title: "Campaign created", message: "Ready", read_at: null, created_at: new Date().toISOString() }];
    } else if (url.pathname === "/api/ai-ceo/briefings" && method === "GET") {
      body = [];
    } else if (url.pathname === "/api/ai-ceo/briefings" && method === "POST") {
      body = {
        id: "66666666-6666-6666-6666-666666666666",
        title: "AI CEO 1 min report",
        length: "1 min",
        language: "English",
        transcript: "Good morning. This is your AI CEO report. Revenue is stable. Top priority today is approving reviewed outreach. I will not launch campaigns or send emails.",
        summary_json: { safety: "report_only", top_priorities: ["Approve reviewed outreach", "Review replies", "Check pipeline"] },
        created_at: new Date().toISOString()
      };
    } else if (url.pathname === "/api/ai-ceo/question") {
      body = { answer: "Revenue is stable and the next best action is approving reviewed outreach.", related_metrics: {}, safety_notice: "AI CEO only reports and recommends." };
    } else if (url.pathname === "/api/campaigns" && method === "GET") {
      body = [campaign];
    } else if (url.pathname === "/api/campaigns" && method === "POST") {
      body = campaign;
    } else if (url.pathname === "/api/leads" && method === "GET") {
      body = { items: [lead], total: 1, page: 1, page_size: 50 };
    } else if (url.pathname === "/api/leads" && method === "POST") {
      body = lead;
    } else if (url.pathname === "/api/leads/find") {
      body = [lead];
    } else if (url.pathname === "/api/leads/bulk") {
      body = { updated: 1 };
    } else if (url.pathname === "/api/emails/generate") {
      body = { id: "55555555-5555-5555-5555-555555555555", campaign_id: campaign.id, lead_id: lead.id, subject: "Quick idea for Hill Country Build Co", preview: "A short growth idea", body: "Hi Jane, I found a clear outbound opportunity.", cta: "Book a growth audit", follow_up_1: "Following up with one idea.", follow_up_2: "Worth a quick look?", delivery_status: "draft", created_at: new Date().toISOString() };
    } else if (url.pathname.startsWith("/api/emails/")) {
      body = { id: "55555555-5555-5555-5555-555555555555", campaign_id: campaign.id, lead_id: lead.id, subject: "Quick idea for Hill Country Build Co", preview: "A short growth idea", body: "Hi Jane, I found a clear outbound opportunity.", cta: "Book a growth audit", follow_up_1: "Following up with one idea.", follow_up_2: "Worth a quick look?", delivery_status: url.pathname.endsWith("/send") ? "sent" : "draft", created_at: new Date().toISOString() };
    } else if (url.pathname === "/api/profile" && method === "GET") {
      body = { workspace: "Revenue workspace", company: "OutreachAI", avatar_url: null, timezone: "UTC", language: "English" };
    } else if (url.pathname === "/api/profile" && method === "PUT") {
      body = { workspace: "Revenue workspace", company: "OutreachAI", avatar_url: null, timezone: "UTC", language: "English" };
    } else if (url.pathname === "/api/profile" && method === "DELETE") {
      body = { status: "queued" };
    } else if (url.pathname === "/api/settings") {
      body = { general: {}, ai: {}, email: {}, billing: {}, security: {}, api: {} };
    } else if (url.pathname === "/api/integrations/apollo/status") {
      body = { configured: true, connected: true, last_success_at: new Date().toISOString(), last_error: "" };
    } else if (url.pathname === "/api/integrations/apollo/test") {
      body = { configured: true, connected: true, duration_ms: 12, last_success_at: new Date().toISOString(), last_error: "" };
    } else if (url.pathname === "/api/integrations/hunter/status") {
      body = { configured: true, connected: true, last_success_at: new Date().toISOString(), last_error: "" };
    } else if (url.pathname === "/api/integrations/hunter/test") {
      body = { configured: true, connected: true, duration_ms: 15, last_success_at: new Date().toISOString(), last_error: "" };
    } else if (url.pathname === "/api/owner/console") {
      const email = route.request().headers()["x-test-user-email"] || "";
      if (email.toLowerCase() !== "romaniukvadym10@gmail.com") {
        await route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ detail: "Access denied." }) });
        return;
      }
      body = {
        executive_overview: { status: "operational", owner: "romaniukvadym10@gmail.com", active_subscriptions: 1, recent_audit_events: 1 },
        revenue: { mrr: 149, arr: 1788, revenue_influenced: 497 },
        customers: { users: 3, workspaces: 2, leads: 11 },
        subscriptions: { active: 1, total: 1 },
        ai_usage: { leads: 44, ai_generations: 22, email_sends: 7 },
        product_analytics: { campaigns: 2, emails: 7, ai_employees: 1 },
        error_monitoring: { open_errors: 0, last_status: "No blocking errors recorded" },
        system_health: { api: "ok", database: "ok", webhooks: "ok", email: "configured" },
        feature_flags: { ai_ceo_voice: false, experimental_features: false, admin_nav: false, analytics_nav: false, ai_marketplace: false },
        audit_logs: [{ id: "77777777-7777-7777-7777-777777777777", action: "owner.console_viewed", metadata_json: {}, created_at: new Date().toISOString() }]
      };
    } else if (url.pathname === "/api/owner/feature-flags") {
      const email = route.request().headers()["x-test-user-email"] || "";
      if (email.toLowerCase() !== "romaniukvadym10@gmail.com") {
        await route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ detail: "Access denied." }) });
        return;
      }
      const updates = route.request().postDataJSON() as Record<string, boolean>;
      body = { ai_ceo_voice: false, experimental_features: false, admin_nav: false, analytics_nav: false, ai_marketplace: false, ...updates };
    } else if (url.pathname === "/api/team-router") {
      body = teamRouterDashboard;
    } else if (url.pathname === "/api/team-router/route") {
      body = {
        id: "team-plan-1",
        command: "Find clients and create posts",
        detected_intent: "lead_discovery_and_marketing_content",
        assigned_employees: ["Sales", "Marketing"],
        primary_employee: "Sales",
        priority: "High",
        risk_level: "Medium",
        estimated_execution_time: "6 minutes",
        required_approval: true,
        subtasks: [
          { id: "1", employee: "Sales", title: "Find clients", objective: "Find qualified clients", required_tools: ["Lead Finder"], expected_result: "Prospects ready for review", risk_level: "Medium", required_approval: true, status: "waiting_approval", result: "" },
          { id: "2", employee: "Marketing", title: "Create posts", objective: "Create marketing posts", required_tools: ["Content Planner"], expected_result: "Posts ready for review", risk_level: "Low", required_approval: true, status: "waiting_approval", result: "" }
        ],
        safety_notes: ["No external action without approval."],
        status: "waiting_approval",
        progress: ["Command classified", "Subtasks assigned", "Waiting for approval"],
        created_at: new Date().toISOString(),
        approved_at: null,
        finished_at: null
      };
    } else if (url.pathname === "/api/sales-employees") {
      body = [];
    }

    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
});

for (const width of [320, 390, 480]) {
  test(`product workspace works at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/dashboard");
    await page.evaluate(() => {
      window.localStorage.setItem("outreachai.locale", "en");
      document.cookie = "outreachai_locale=en; path=/; max-age=31536000; SameSite=Lax";
    });
    await page.reload();
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await expect(page.getByRole("main").getByText(/Today's priority|Prioridad de hoy|Dzisiejszy priorytet|Priorité du jour|Priorità di oggi/)).toBeVisible();
    await expect(page.getByRole("main").getByText(/Workspace Setup|Configuración del espacio|Konfiguracja workspace|Configuration workspace/)).toBeVisible();
    await expect(page.locator('main header a[href="/dashboard/campaigns"]')).toHaveCount(1);
    await expect(page.getByRole("main").getByText("Campaign health", { exact: true })).toBeVisible();
    const languageSelect = page.locator('select[aria-label]').first();
    await languageSelect.selectOption("es");
    await expect(page.locator('select').first()).toHaveValue("es");
    await expect.poll(() => page.evaluate(() => window.localStorage.getItem("outreachai.locale"))).toBe("es");
    await page.reload();
    await expect(page.getByRole("heading", { name: /Dashboard|Panel/ })).toBeVisible();
    await page.locator('select').first().selectOption("en");
    await page.evaluate(() => {
      window.localStorage.setItem("outreachai.locale", "en");
      document.cookie = "outreachai_locale=en; path=/; max-age=31536000; SameSite=Lax";
    });
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await expect(page.getByRole("button", { name: "AI CEO Report" })).toHaveCount(0);

    await page.goto("/dashboard/campaigns");
    await expect(page.getByRole("heading", { name: "Create a campaign" })).toBeVisible();
    await page.getByPlaceholder("Example: German builders outreach").fill("Austin Builders Outreach");
    await page.getByPlaceholder("Example: Construction").fill("Construction");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByPlaceholder("Germany").fill("United States");
    await page.getByPlaceholder("Berlin").fill("Austin");
    await page.getByPlaceholder("renovation, construction, property").fill("renovation");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByPlaceholder("We help construction companies book more qualified project calls.").fill("qualified renovation leads");
    await page.getByRole("button", { name: "Save campaign" }).click();
    await expect(page.getByText("Campaign saved")).toBeVisible();
    await page.getByRole("button", { name: "Generate email for review" }).click();
    await expect(page.locator('input[value="Quick idea for Hill Country Build Co"]')).toBeVisible();

    await page.getByRole("link", { name: /Leads/ }).first().click();
    await expect(page.getByRole("heading", { name: "Find leads" })).toBeVisible();
    await expect(page.getByText("Apollo").first()).toBeVisible();
    await expect(page.getByText("Hunter verified email").first()).toBeVisible();
    await expect(page.getByText("42").first()).toBeVisible();
    await page.getByPlaceholder("Company name").fill("Hill Country Build Co");
    await page.getByPlaceholder("Website").fill("https://example.com");
    await page.getByRole("button", { name: "Add company" }).click();
    await expect(page.getByText("Hill Country Build Co").first()).toBeVisible();

    await page.getByLabel("Open navigation").click();
    await page.getByRole("link", { name: /Settings/ }).click();
    await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
    await expect(page.getByText("Apollo powers production lead discovery.")).toBeVisible();
    await expect(page.getByText("Hunter email verification").first()).toBeVisible();
    await expect(page.getByText("Connected").first()).toBeVisible();
    await page.getByRole("button", { name: "Save workspace" }).first().click();
    await expect(page.getByText("Workspace saved.")).toBeVisible();

    await page.getByRole("link", { name: /AI Employees/ }).click();
    await expect(page.getByRole("heading", { name: "AI Employees" })).toBeVisible();
    await expect(page.getByText("What should your employee do?")).toBeVisible();
    await page.getByPlaceholder("Find 20 construction companies in Berlin and prepare outreach.").fill("Find clients and create posts");
    await expect(page.getByRole("button", { name: "Create plan" })).toBeVisible();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
  });
}

test("AI CEO voice controls stay hidden from the default dashboard", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto("/dashboard");
  await expect(page.getByRole("button", { name: "AI CEO Report" })).toHaveCount(0);
  await expect(page.getByText("Load failed")).toHaveCount(0);
});

test("Owner Console is hidden from non-owner users and direct access returns 403", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.removeItem("outreachai.e2eUserEmail");
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/dashboard");
  await expect(page.getByRole("link", { name: /Owner Console/ })).toHaveCount(0);

  await page.goto("/dashboard/owner");
  await expect(page.getByRole("heading", { name: "Access denied." })).toBeVisible();
});

test("Owner can open Owner Console and toggle feature flags", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("outreachai.e2eUserEmail", "romaniukvadym10@gmail.com");
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/dashboard");
  await expect(page.getByRole("link", { name: /Owner Console/ })).toBeVisible();
  await page.getByRole("link", { name: /Owner Console/ }).click();
  await expect(page.getByRole("heading", { name: "Owner Console" })).toBeVisible();
  await expect(page.getByText("Revenue / MRR / ARR")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Product controls" })).toBeVisible();
  const voiceToggle = page.getByRole("button", { name: /AI CEO Voice/ });
  await voiceToggle.click();
  await expect(voiceToggle).toHaveAttribute("aria-pressed", "true");
});
