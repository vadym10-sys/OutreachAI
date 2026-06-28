import { expect, test } from "@playwright/test";

const pages = [
  ["/dashboard", "What should I do now?"],
  ["/dashboard/leads", "Find real companies and turn each into a sales opportunity."],
  ["/dashboard/companies", "Every company should become a complete sales opportunity."],
  ["/dashboard/website-analyzer", "Analyze a real prospect website."],
  ["/dashboard/contacts", "Decision makers and verified emails."],
  ["/dashboard/campaigns", "Review real outreach before anything is sent."],
  ["/dashboard/inbox", "Replies will appear here when campaigns receive real responses."],
  ["/dashboard/crm", "Move real leads from research to revenue."],
  ["/dashboard/analytics", "Measure real outbound performance."],
  ["/dashboard/settings", "Configure real providers before relying on automation."],
  ["/dashboard/billing", "Subscription and usage."],
  ["/dashboard/sales-employees", "One click should replace hours of manual sales research."]
] as const;

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
  linkedin: "https://linkedin.com/company/hill-country-build",
  domain: "example.com",
  employee_count: 42,
  revenue_range: "1M-10M",
  title: "Owner",
  confidence: "high",
  apollo_company_id: "apollo_org_1",
  hunter_contact_id: "jane@example.com",
  hunter_verified: true,
  hunter_status: "verified",
  source: "hunter",
  ai_summary: "Commercial renovation company with clear service pages.",
  suggested_offer: "Offer a booked-meeting system for commercial renovation leads.",
  outreach_strategy: "Lead with one website-specific growth idea, then ask for a short growth audit.",
  sales_angle: "Help the owner turn website visitors into qualified renovation calls.",
  expected_reply_rate: "8-12%",
  status: "New"
};

const campaign = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "Austin Builders Outreach",
  industry: "Construction",
  countries: ["United States"],
  cities: ["Austin"],
  company_size: "11-50",
  keywords: ["renovation"],
  website_filters: [],
  language: "English",
  offer: "qualified renovation leads",
  cta: "Book a growth audit",
  email_tone: "Consultative",
  signature: "OutreachAI",
  status: "Draft",
  follow_up_days: 3,
  timezone: "UTC",
  working_hours: "09:00-17:00",
  daily_send_limit: 25,
  sequence: [
    { step_order: 1, name: "Email 1", subject: "Quick idea for Hill Country Build Co", body: "Draft", delay_days: 0 }
  ],
  leads: 1,
  sent: 0,
  replies: 0,
  created_at: new Date().toISOString()
};

test.beforeEach(async ({ page }) => {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    let body: unknown = {};
    if (url.pathname === "/api/leads") {
      body = { items: [lead], total: 1, page: 1, page_size: 100 };
    } else if (url.pathname === "/api/leads/find") {
      body = [lead];
    } else if (url.pathname === "/api/campaigns") {
      body = [campaign];
    } else if (url.pathname === "/api/dashboard") {
      body = { leads: 1, campaigns: 1, emails_sent: 0, delivered: 0, opened: 0, replies: 0, bounces: 0, open_rate: 0, reply_rate: 0, ctr: 0, conversion_rate: 0, meetings: 0, revenue: 0, revenue_forecast: 0, mrr: 0, arr: 0, revenue_series: [], funnel: [], pipeline: [], plan: "Starter", usage: { leads: 1, email_sends: 0 } };
    } else if (url.pathname.endsWith("/copilot")) {
      body = { probability_to_reply: 82, probability_to_buy: 64, best_first_contact: "Jane Doe", best_subject_line: "Quick idea for Hill Country Build Co", best_cta: "Book a growth audit", estimated_revenue: 12000, reasoning: ["Verified owner contact", "Relevant renovation services", "Clear website conversion gap"] };
    } else if (url.pathname.endsWith("/website-audit")) {
      body = { missing_cta: true, missing_contact_form: false, poor_seo: false, weak_trust_signals: true, missing_reviews: false, slow_website: false, outdated_design: false, improvement_report: "The website has service pages but a weak project consultation CTA.", priority_actions: ["Add a consultation CTA", "Improve trust signals"] };
    } else if (url.pathname.endsWith("/follow-ups")) {
      body = { no_open: ["Worth a quick look?"], opened: ["I noticed you opened the idea."], clicked: ["Happy to send the audit outline."], replied: ["Thanks for replying."] };
    } else if (url.pathname.endsWith("/draft-email")) {
      body = { id: "33333333-3333-3333-3333-333333333333", campaign_id: null, lead_id: lead.id, subject: "Quick idea for Hill Country Build Co", preview: "A reviewed draft is ready.", body: "Hi Jane, I noticed a website conversion opportunity.", cta: "Book a growth audit", follow_up_1: "Worth a quick look?", follow_up_2: "Should I send the audit outline?", delivery_status: "draft" };
    } else if (url.pathname === "/api/ai/analyze") {
      body = { company: "Hill Country Build Co", website: "https://example.com", description: "Commercial renovation company.", industry: "Construction", location: "Austin", niche: "Construction", products_services: ["Renovation"], services: ["Commercial renovation"], technologies: [], strengths: ["Clear service pages"], weaknesses: ["Weak CTA"], icp_score: 87, summary: "Strong fit for outbound.", company_summary: "Commercial renovation company.", suggested_offer: "Booked-meeting system", outreach_strategy: "Lead with website-specific conversion idea.", sales_angle: "Turn visitors into booked calls.", expected_reply_rate: "8-12%", recommended_cta: "Book a growth audit" };
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
});

test.describe("redesigned B2B outbound workspace", () => {
  for (const [route, heading] of pages) {
    test(`${route} renders on mobile without dead screens`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 900 });
      await page.goto(route);
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
      await expect(page.getByText("AI Sales Workspace")).toBeVisible();
      await expect(page.getByRole("main")).not.toContainText("Load failed");
      await expect(page.getByRole("main")).not.toContainText("Failed to fetch");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      expect(overflow).toBe(false);
    });
  }

  test("lead finder supports the primary outbound actions", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto("/dashboard/leads");
    await page.getByRole("button", { name: "Find leads" }).first().click();
    await expect(page.getByText("1 real companies saved from Google Maps.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Hill Country Build Co" })).toBeVisible();
    await expect(page.getByText("jane@example.com · verified by Hunter")).toBeVisible();
    await page.getByRole("button", { name: /Complete sales research/ }).click();
    await expect(page.getByText("Complete sales opportunity is ready for review. No email was sent.")).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("Quick idea for Hill Country Build Co")).toBeVisible();
  });

  test("campaign review never sends without approval", async ({ page }) => {
    await page.goto("/dashboard/campaigns");
    await expect(page.getByText("Review before send: enabled")).toBeVisible();
    await expect(page.getByText("Austin Builders Outreach")).toBeVisible();
  });

  test("dashboard keeps metrics when optional recommendations fail", async ({ page }) => {
    await page.route("**/api/growth-engine", async (route) => {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ detail: "Recommendations unavailable" }) });
    });
    await page.route("**/api/sales-employees", async (route) => {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ detail: "AI employees unavailable" }) });
    });
    await page.route("**/api/activity", async (route) => {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ detail: "Activity unavailable" }) });
    });

    await page.goto("/dashboard");
    const main = page.getByRole("main");
    await expect(page.getByRole("heading", { name: "What should I do now?" })).toBeVisible();
    await expect(main.getByText("Leads found")).toBeVisible();
    await expect(main.getByText("Campaigns", { exact: true })).toBeVisible();
    await expect(main).not.toContainText("Dashboard data is temporarily unavailable");
  });
});
