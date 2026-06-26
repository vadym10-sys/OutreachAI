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
  niche: "Construction",
  status: "Qualified",
  campaign_id: campaign.id,
  campaign: campaign.name,
  created_at: new Date().toISOString()
};

test.beforeEach(async ({ page }) => {
  await page.route("http://127.0.0.1:8000/api/**", async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    let body: unknown = {};

    if (url.pathname === "/api/dashboard") {
      body = { leads: 1, campaigns: 1, emails_sent: 0, open_rate: 0, reply_rate: 0, meetings: 0, revenue: 0, mrr: 0 };
    } else if (url.pathname === "/api/activity") {
      body = [{ id: "33333333-3333-3333-3333-333333333333", action: "campaign.created", metadata_json: {}, created_at: new Date().toISOString() }];
    } else if (url.pathname === "/api/notifications") {
      body = [{ id: "44444444-4444-4444-4444-444444444444", kind: "success", title: "Campaign created", message: "Ready", read_at: null, created_at: new Date().toISOString() }];
    } else if (url.pathname === "/api/campaigns" && method === "GET") {
      body = [campaign];
    } else if (url.pathname === "/api/campaigns" && method === "POST") {
      body = campaign;
    } else if (url.pathname === "/api/leads" && method === "GET") {
      body = { items: [lead], total: 1, page: 1, page_size: 50 };
    } else if (url.pathname === "/api/leads" && method === "POST") {
      body = lead;
    } else if (url.pathname === "/api/leads/bulk") {
      body = { updated: 1 };
    } else if (url.pathname === "/api/emails/generate") {
      body = { id: "55555555-5555-5555-5555-555555555555", campaign_id: campaign.id, lead_id: lead.id, subject: "Quick idea for Hill Country Build Co", preview: "A short growth idea", body: "Hi Jane, I found a clear outbound opportunity.", cta: "Book a growth audit", created_at: new Date().toISOString() };
    } else if (url.pathname.startsWith("/api/emails/")) {
      body = { id: "55555555-5555-5555-5555-555555555555", campaign_id: campaign.id, lead_id: lead.id, subject: "Quick idea for Hill Country Build Co", preview: "A short growth idea", body: "Hi Jane, I found a clear outbound opportunity.", cta: "Book a growth audit", created_at: new Date().toISOString() };
    } else if (url.pathname === "/api/profile" && method === "GET") {
      body = { workspace: "Revenue workspace", company: "OutreachAI", avatar_url: null, timezone: "UTC", language: "English" };
    } else if (url.pathname === "/api/profile" && method === "PUT") {
      body = { workspace: "Revenue workspace", company: "OutreachAI", avatar_url: null, timezone: "UTC", language: "English" };
    } else if (url.pathname === "/api/profile" && method === "DELETE") {
      body = { status: "queued" };
    } else if (url.pathname === "/api/settings") {
      body = { general: {}, ai: {}, email: {}, billing: {}, security: {}, api: {} };
    }

    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
});

for (const width of [320, 390, 480]) {
  test(`product workspace works at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await expect(page.getByRole("main").getByText("Leads", { exact: true }).first()).toBeVisible();

    await page.getByRole("link", { name: /Campaigns/ }).click();
    await expect(page.getByRole("heading", { name: "Campaign Builder" })).toBeVisible();
    await page.getByPlaceholder("Campaign name").fill("Austin Builders Outreach");
    await page.getByPlaceholder("Industry").fill("Construction");
    await page.getByPlaceholder("Countries, comma separated").fill("United States");
    await page.getByPlaceholder("Cities, comma separated").fill("Austin");
    await page.getByPlaceholder("Offer").fill("qualified renovation leads");
    await page.getByRole("button", { name: "Save campaign" }).click();
    await expect(page.getByText("Campaign saved")).toBeVisible();
    await page.getByRole("button", { name: "Generate Email" }).click();
    await expect(page.locator('input[value="Quick idea for Hill Country Build Co"]')).toBeVisible();

    await page.getByRole("link", { name: /Leads/ }).first().click();
    await expect(page.getByRole("heading", { name: "Lead Management" })).toBeVisible();
    await page.getByPlaceholder("Company").fill("Hill Country Build Co");
    await page.getByPlaceholder("Email").fill("jane@example.com");
    await page.getByRole("button", { name: "Add lead" }).click();
    await expect(page.getByText("Hill Country Build Co").first()).toBeVisible();

    await page.getByLabel("Open navigation").click();
    await page.getByRole("link", { name: /Settings/ }).click();
    await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Save profile" }).click();
    await expect(page.getByText("Profile saved.")).toBeVisible();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
  });
}
