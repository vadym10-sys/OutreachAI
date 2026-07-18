import { expect, test, type Route } from "@playwright/test";

const pages = [
  ["/dashboard", "Find customers, save CRM leads, write emails."],
  ["/dashboard/leads", "Find customers, then decide what to save."],
  ["/dashboard/companies", "Saved leads, stages, notes and history."],
  ["/dashboard/website-analyzer", "Find customers, then decide what to save."],
  ["/dashboard/contacts", "Saved leads, stages, notes and history."],
  ["/dashboard/campaigns", "Review drafts, send manually, track replies."],
  ["/dashboard/inbox", "Review drafts, send manually, track replies."],
  ["/dashboard/crm", "Saved leads, stages, notes and history."],
  ["/dashboard/deals", "Saved leads, stages, notes and history."],
  ["/dashboard/analytics", "Find customers, save CRM leads, write emails."],
  ["/dashboard/settings", "Make the workspace ready for your first campaign."],
  ["/dashboard/billing", "Subscription and usage."],
  ["/dashboard/sales-employees", "Find customers, save CRM leads, write emails."],
  ["/dashboard/admin/quality", "AI Quality & Self-Healing"]
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

const crmCompany = {
  id: "44444444-4444-4444-4444-444444444444",
  lead_id: lead.id,
  name: lead.company,
  website: lead.website,
  domain: lead.domain,
  phone: "+1 512 555 0101",
  email: lead.email,
  address: "1 Congress Ave, Austin, TX",
  city: lead.city,
  country: lead.country,
  industry: lead.industry,
  google_rating: 4.7,
  place_id: "google_place_1",
  source: "google_maps_hunter",
  ai_summary: lead.ai_summary,
  suggested_offer: lead.suggested_offer,
  outreach_strategy: lead.outreach_strategy,
  sales_angle: lead.sales_angle,
  expected_reply_rate: lead.expected_reply_rate,
  email_status: "Verified",
  crm_stage: "Contact Found",
  contacts: [{ id: "55555555-5555-5555-5555-555555555555", company_id: "44444444-4444-4444-4444-444444444444", lead_id: lead.id, company: lead.company, name: "Jane Doe", title: "Owner", email: lead.email, phone: null, linkedin: lead.linkedin, confidence: "97", source: "hunter", email_status: "Verified", created_at: new Date().toISOString() }],
  deals: [{ id: "66666666-6666-6666-6666-666666666666", company_id: "44444444-4444-4444-4444-444444444444", lead_id: lead.id, company: lead.company, name: "Hill Country Build Co opportunity", stage: "Contact Found", value: 0, probability: 35, source: "google_maps_hunter", next_step: "Review AI email and approve campaign.", created_at: new Date().toISOString() }],
  notes: [{ id: "77777777-7777-7777-7777-777777777777", company_id: "44444444-4444-4444-4444-444444444444", lead_id: lead.id, body: lead.ai_summary, kind: "ai_summary", created_at: new Date().toISOString() }],
  activity: [{ id: "88888888-8888-8888-8888-888888888888", action: "google_maps.company_search", metadata_json: {}, created_at: new Date().toISOString() }],
  generated_emails: [{ id: "33333333-3333-3333-3333-333333333333", campaign_id: null, lead_id: lead.id, subject: "Quick idea for Hill Country Build Co", preview: "A reviewed draft is ready.", body: "Hi Jane, I noticed a website conversion opportunity.", cta: "Book a growth audit", follow_up_1: "Worth a quick look?", follow_up_2: "Should I send the audit outline?", delivery_status: "draft" }],
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  found_at: new Date().toISOString(),
  saved_to_crm_at: new Date().toISOString(),
  website_analyzed_at: new Date().toISOString(),
  contact_found_at: new Date().toISOString(),
  email_generated_at: new Date().toISOString(),
  email_approved_at: null,
  email_sent_at: null,
  delivered_at: null,
  opened_at: null,
  replied_at: null,
  last_activity_at: new Date().toISOString(),
  stage_changed_at: new Date().toISOString()
};

const qualityDashboard = {
  health_score: 92,
  status: "healthy",
  summary: "Quality system is healthy.",
  deployment_gate: {
    backend_lint: "required",
    backend_tests: "required",
    frontend_lint: "required",
    frontend_tests: "required",
    production_build: "required",
    playwright_e2e: "required"
  },
  checks: [
    { name: "Production readiness monitor", module: "AI Integration Monitor", status: "healthy", severity: "medium", summary: "All critical customer flows are ready.", evidence: { lead_search: true }, suggested_fix: "Keep readiness checks running before every deploy." },
    { name: "CRM data consistency", module: "AI Data Consistency Checker", status: "healthy", severity: "medium", summary: "CRM records are linked.", evidence: {}, suggested_fix: "Keep duplicate prevention covered." }
  ],
  open_bugs: [],
  repair_tasks: [],
  sentry_issues: [],
  failed_integrations: [],
  failed_tests: [],
  broken_flows: [],
  suggested_fixes: [],
  last_run_at: new Date().toISOString()
};

const workspace = {
  id: "99999999-9999-9999-9999-999999999999",
  name: "QA Private Workspace",
  company: "QA Private Workspace",
  industry: "Construction",
  target_country: "United States",
  target_customer: "Commercial builders",
  timezone: "UTC",
  language: "en",
  onboarding_step: 1,
  onboarding_completed: false,
  members: [
    {
      id: "99999999-9999-9999-9999-999999999998",
      user_id: "e2e-user",
      email: "qa@example.com",
      role: "owner",
      status: "active",
      created_at: new Date().toISOString()
    }
  ]
};

test.beforeEach(async ({ page }) => {
  let currentEmailDeliveryStatus: "draft" | "approved" | "sent" = "draft";
  const companyForMail = () => ({
    ...crmCompany,
    crm_stage: currentEmailDeliveryStatus === "sent" ? "Sent" : currentEmailDeliveryStatus === "approved" ? "Approved" : crmCompany.crm_stage,
    email_approved_at: currentEmailDeliveryStatus === "approved" || currentEmailDeliveryStatus === "sent" ? new Date().toISOString() : null,
    email_sent_at: currentEmailDeliveryStatus === "sent" ? new Date().toISOString() : null,
    generated_emails: [{ ...crmCompany.generated_emails[0], delivery_status: currentEmailDeliveryStatus }]
  });

  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const apiPath = url.pathname.replace(/^\/api\/backend/, "");
    let body: unknown = {};
    if (apiPath === "/api/workspace" || apiPath === "/api/workspace/me") {
      body = workspace;
    } else if (apiPath === "/api/leads") {
      body = { items: [lead], total: 1, page: 1, page_size: 100 };
    } else if (apiPath === "/api/crm/companies") {
      body = [crmCompany];
    } else if (apiPath === `/api/crm/companies/${crmCompany.id}/stage`) {
      body = { ...crmCompany, crm_stage: "Not Interested", stage_changed_at: new Date().toISOString(), activity: [{ id: "99999999-9999-9999-9999-999999999990", action: "crm.stage_changed", metadata_json: {}, created_at: new Date().toISOString() }, ...crmCompany.activity] };
    } else if (apiPath === `/api/crm/companies/${crmCompany.id}/notes`) {
      body = { id: "99999999-9999-9999-9999-999999999991", company_id: crmCompany.id, lead_id: lead.id, body: "Customer asked to review next week.", kind: "note", created_at: new Date().toISOString() };
    } else if (apiPath === "/api/crm/contacts") {
      body = crmCompany.contacts;
    } else if (apiPath === "/api/crm/deals") {
      body = crmCompany.deals;
    } else if (apiPath === "/api/crm/pipeline") {
      body = { stages: ["New Lead", "Qualified", "Website Analyzed", "Contact Found", "Email Draft Ready", "Approved", "Sent", "Replied", "Meeting Scheduled", "Won", "Lost"], companies: [crmCompany], deals: crmCompany.deals };
    } else if (apiPath === "/api/admin/quality") {
      body = qualityDashboard;
    } else if (apiPath === "/api/admin/quality/run") {
      body = qualityDashboard;
    } else if (apiPath === "/api/admin/quality/tasks") {
      body = { id: "99999999-9999-9999-9999-999999999999", issue_id: null, title: "Repair: test issue", priority: "medium", status: "needs_approval", diagnosis: "Regression task", suggested_fix: "Add tests", required_tests: ["Playwright E2E test"], approval_required: true, created_at: new Date().toISOString() };
    } else if (apiPath === "/api/workspace-app/bootstrap") {
      body = {
        workspace,
        counts: { leads: 1, companies: 1, campaigns: 1, emails: 0, deals: 1 },
        metrics: { leads: 1, companies: 1, contacts: 1, campaigns: 1, emails: 0, deals: 1 },
        next_action: "Review the first prepared outreach email.",
        recent_companies: [companyForMail()],
        recent_activity: [{ action: "lead.found", created_at: new Date().toISOString(), company: lead.company, message: "Lead found" }]
      };
    } else if (apiPath === "/api/workspace-app/integrations/status") {
      body = {
        integrations: [
          { key: "lead_search", label: "Lead search", status: "connected", message: "Connected. Lead Finder can search real companies." },
          { key: "contact_discovery", label: "Contact discovery", status: "connected", message: "Connected. Contact discovery can verify business emails." },
          { key: "ai_research", label: "AI research and email", status: "connected", message: "Connected. AI can analyze websites and draft outreach." },
          { key: "email_sending", label: "Email sending", status: "connected", message: "Connected. Approved emails can be sent." },
          { key: "billing", label: "Billing", status: "connected", message: "Connected. Plans and billing status can be managed." }
        ]
      };
    } else if (apiPath === "/api/workspace-app/companies") {
      body = route.request().method() === "POST" ? { status: "created", message: "Company saved to CRM.", company: companyForMail() } : [companyForMail()];
    } else if (apiPath === "/api/workspace-app/leads/search") {
      body = { status: "success", request_id: "e2e-lead-search", message: "Found 1 companies and saved them to CRM.", companies_saved: 1, duplicates_skipped: 0, companies: [crmCompany], warnings: [] };
    } else if (apiPath === "/api/workspace-app/leads/first-customers/search") {
      body = {
        id: "finder-job-1",
        status: "completed",
        progress: { stage: "completed", percent: 100 },
        criteria: {},
        summary: { results: 1, saved_to_crm: 0, rejected: 0 },
        error_message: "",
        created_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        results: [{
          id: "finder-result-1",
          company_name: crmCompany.name,
          official_website: crmCompany.website,
          industry: crmCompany.industry,
          country: crmCompany.country,
          company_size: "20-200",
          contact_name: "Jane Doe",
          contact_title: "Owner",
          public_work_contact: lead.email,
          signal_type: "Hiring",
          signal_description: "Hiring and conversion improvement signal.",
          signal_date: "Unknown",
          source_url: crmCompany.website,
          source_title: "Company website",
          source_type: "website",
          evidence_summary: "The company publicly describes commercial renovation services.",
          fit_explanation: "Matches the selected construction target market.",
          ai_relevance_score: 87,
          confidence_score: 76,
          verified_status: "verified",
          checked_at: new Date().toISOString(),
          publication_date: "Unknown",
          first_line_opener: "Noticed your commercial renovation focus.",
          draft_email: "Hi Jane, noticed your commercial renovation focus. Worth a quick look at a simple way to turn more site visitors into qualified calls?",
          lead_id: "",
          company_id: "",
          email_id: "",
          email_subject: "",
          email_body: ""
        }]
      };
    } else if (apiPath === "/api/workspace-app/leads/first-customers/results/finder-result-1/save") {
      body = {
        status: "success",
        message: "Lead saved to CRM. Outreach draft is ready for manual review.",
        result: {
          id: "finder-result-1",
          company_name: crmCompany.name,
          official_website: crmCompany.website,
          industry: crmCompany.industry,
          country: crmCompany.country,
          company_size: "20-200",
          contact_name: "Jane Doe",
          contact_title: "Owner",
          public_work_contact: lead.email,
          signal_type: "Hiring",
          signal_description: "Hiring and conversion improvement signal.",
          signal_date: "Unknown",
          source_url: crmCompany.website,
          source_title: "Company website",
          source_type: "website",
          evidence_summary: "The company publicly describes commercial renovation services.",
          fit_explanation: "Matches the selected construction target market.",
          ai_relevance_score: 87,
          confidence_score: 76,
          verified_status: "verified",
          checked_at: new Date().toISOString(),
          publication_date: "Unknown",
          first_line_opener: "Noticed your commercial renovation focus.",
          draft_email: "Hi Jane, noticed your commercial renovation focus. Worth a quick look?",
          lead_id: lead.id,
          company_id: crmCompany.id,
          email_id: crmCompany.generated_emails[0].id,
          email_subject: crmCompany.generated_emails[0].subject,
          email_body: crmCompany.generated_emails[0].body
        }
      };
    } else if (apiPath === `/api/workspace-app/companies/${crmCompany.id}/analyze`) {
      body = { status: "success", message: "Website analysis saved.", company: { ...crmCompany, crm_stage: "Website Analyzed", website_analyzed_at: new Date().toISOString() } };
    } else if (apiPath === `/api/workspace-app/companies/${crmCompany.id}/contacts`) {
      body = { status: "success", message: "Verified contact saved to CRM.", company: { ...crmCompany, crm_stage: "Contact Found", contact_found_at: new Date().toISOString() } };
    } else if (apiPath === `/api/workspace-app/companies/${crmCompany.id}/email-draft`) {
      currentEmailDeliveryStatus = "draft";
      body = { status: "success", message: "Email draft created for review. Nothing was sent.", company: { ...companyForMail(), crm_stage: "Email Draft Ready", email_generated_at: new Date().toISOString() }, email: companyForMail().generated_emails[0] };
    } else if (apiPath === `/api/workspace-app/companies/${crmCompany.id}/complete-opportunity` || apiPath === `/api/workspace-app/companies/${crmCompany.id}/enrichment/restart`) {
      body = {
        status: "success",
        message: apiPath.endsWith("/enrichment/restart") ? "AI enrichment restarted. This card will update as data arrives." : "Sales opportunity prepared. Review the AI research and approve only when ready.",
        completed_steps: ["Company profile checked", "Website analysis checked", "Contact search checked", "Email draft checked"],
        workflow_stages: {
          company_profile: "completed",
          website_analysis: "completed",
          decision_maker: "completed",
          verified_email: "completed",
          ai_email: "completed",
          approval: "waiting"
        },
        company: { ...crmCompany, crm_stage: "Email Draft Ready", email_generated_at: new Date().toISOString() },
        email: crmCompany.generated_emails[0]
      };
    } else if (apiPath === "/api/workspace-app/emails/33333333-3333-3333-3333-333333333333/approve") {
      currentEmailDeliveryStatus = "approved";
      body = { status: "success", message: "Email approved. It is ready to send, but nothing was sent automatically.", company: companyForMail(), email: companyForMail().generated_emails[0] };
    } else if (apiPath === "/api/workspace-app/emails/33333333-3333-3333-3333-333333333333/send") {
      currentEmailDeliveryStatus = "sent";
      body = { status: "success", message: "Approved email was sent. CRM stage updated.", company: companyForMail(), email: { ...companyForMail().generated_emails[0], sent_at: new Date().toISOString() } };
    } else if (apiPath === "/api/outreach/sender/status") {
      body = { connected: true, status: "connected", next_action: "Ready for manual sends." };
    } else if (apiPath === "/api/emails/33333333-3333-3333-3333-333333333333") {
      body = { ...companyForMail().generated_emails[0], subject: "Quick idea for Hill Country Build Co" };
    } else if (apiPath === "/api/leads/find") {
      body = [lead];
    } else if (apiPath === "/api/campaigns") {
      body = route.request().method() === "POST" ? campaign : [campaign];
    } else if (apiPath === `/api/campaigns/${campaign.id}/launch`) {
      body = { ...campaign, status: "Running" };
    } else if (apiPath === `/api/campaigns/${campaign.id}/pause`) {
      body = { ...campaign, status: "Paused" };
    } else if (apiPath === `/api/leads/${lead.id}`) {
      body = { ...lead, campaign_id: campaign.id, status: "Qualified" };
    } else if (apiPath === "/api/dashboard") {
      body = { leads: 1, campaigns: 1, emails_sent: 0, delivered: 0, opened: 0, replies: 0, bounces: 0, open_rate: 0, reply_rate: 0, ctr: 0, conversion_rate: 0, meetings: 0, revenue: 0, revenue_forecast: 0, mrr: 0, arr: 0, revenue_series: [], funnel: [], pipeline: [], plan: "Starter", usage: { leads: 1, email_sends: 0 } };
    } else if (apiPath.endsWith("/copilot")) {
      body = { probability_to_reply: 82, probability_to_buy: 64, best_first_contact: "Jane Doe", best_subject_line: "Quick idea for Hill Country Build Co", best_cta: "Book a growth audit", estimated_revenue: 12000, reasoning: ["Verified owner contact", "Relevant renovation services", "Clear website conversion gap"] };
    } else if (apiPath.endsWith("/website-audit")) {
      body = { missing_cta: true, missing_contact_form: false, poor_seo: false, weak_trust_signals: true, missing_reviews: false, slow_website: false, outdated_design: false, improvement_report: "The website has service pages but a weak project consultation CTA.", priority_actions: ["Add a consultation CTA", "Improve trust signals"] };
    } else if (apiPath.endsWith("/follow-ups")) {
      body = { no_open: ["Worth a quick look?"], opened: ["I noticed you opened the idea."], clicked: ["Happy to send the audit outline."], replied: ["Thanks for replying."] };
    } else if (apiPath.endsWith("/draft-email")) {
      body = { id: "33333333-3333-3333-3333-333333333333", campaign_id: null, lead_id: lead.id, subject: "Quick idea for Hill Country Build Co", preview: "A reviewed draft is ready.", body: "Hi Jane, I noticed a website conversion opportunity.", cta: "Book a growth audit", follow_up_1: "Worth a quick look?", follow_up_2: "Should I send the audit outline?", delivery_status: "draft" };
    } else if (apiPath === "/api/emails/33333333-3333-3333-3333-333333333333/approve") {
      body = { id: "33333333-3333-3333-3333-333333333333", campaign_id: null, lead_id: lead.id, subject: "Quick idea for Hill Country Build Co", preview: "A reviewed draft is ready.", body: "Hi Jane, I noticed a website conversion opportunity.", cta: "Book a growth audit", follow_up_1: "Worth a quick look?", follow_up_2: "Should I send the audit outline?", delivery_status: "approved" };
    } else if (apiPath === "/api/emails/33333333-3333-3333-3333-333333333333/send") {
      body = { id: "33333333-3333-3333-3333-333333333333", campaign_id: null, lead_id: lead.id, subject: "Quick idea for Hill Country Build Co", preview: "A reviewed draft is ready.", body: "Hi Jane, I noticed a website conversion opportunity.", cta: "Book a growth audit", follow_up_1: "Worth a quick look?", follow_up_2: "Should I send the audit outline?", delivery_status: "sent" };
    } else if (apiPath === "/api/ai/analyze") {
      body = { company: "Hill Country Build Co", website: "https://example.com", description: "Commercial renovation company.", industry: "Construction", location: "Austin", niche: "Construction", products_services: ["Renovation"], services: ["Commercial renovation"], technologies: [], strengths: ["Clear service pages"], weaknesses: ["Weak CTA"], icp_score: 87, summary: "Strong fit for outbound.", company_summary: "Commercial renovation company.", suggested_offer: "Booked-meeting system", outreach_strategy: "Lead with website-specific conversion idea.", sales_angle: "Turn visitors into booked calls.", expected_reply_rate: "8-12%", recommended_cta: "Book a growth audit" };
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
});

test.describe("redesigned B2B outbound workspace", () => {
  test.describe.configure({ mode: "serial" });

  for (const [route, heading] of pages) {
    test(`${route} renders on mobile without dead screens`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 900 });
      await page.goto(route, { waitUntil: "commit" });
      await expect(page.getByRole("heading", { name: heading })).toBeVisible({ timeout: 15000 });
      await expect(page.getByRole("main")).not.toContainText("Load failed");
      await expect(page.getByRole("main")).not.toContainText("Failed to fetch");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      expect(overflow).toBe(false);
    });
  }

  test("lead finder supports the primary outbound actions", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto("/dashboard/leads");
    await page.getByLabel("Product website").fill("https://outreachaiaiai.com");
    await page.getByLabel("Target customer").fill("Commercial builders that need more qualified sales calls.");
    await page.getByRole("button", { name: /Find customers/ }).click();
    await expect(page.getByRole("heading", { name: "Hill Country Build Co" }).first()).toBeVisible();
    await expect(page.getByText("jane@example.com").first()).toBeVisible();
    await page.getByRole("button", { name: /Save to CRM/ }).click();
    await expect(page.getByText("Lead saved to CRM. Outreach draft is ready for manual review.")).toBeVisible();
  });

  test("mail review never sends without approval", async ({ page }) => {
    await page.goto("/dashboard/campaigns");
    await expect(page.getByRole("heading", { name: "Review drafts, send manually, track replies." })).toBeVisible();
    await expect(page.getByText("No automatic email sending.")).toBeVisible();
    await expect(page.getByLabel("Subject")).toHaveValue("Quick idea for Hill Country Build Co");
    await expect(page.getByRole("button", { name: "Send manually" }).first()).toBeDisabled();
  });

  test("mail approval requires a second explicit send confirmation", async ({ page }) => {
    await page.goto("/dashboard/campaigns");
    await page.getByRole("button", { name: "Approve" }).first().click();
    await expect(page.getByText("Email approved. It is ready to send, but nothing was sent automatically.")).toBeVisible();
    await page.getByRole("button", { name: "Send manually" }).first().click();
    await expect(page.getByText("Confirm the recipient and click Confirm send. Nothing has been sent yet.")).toBeVisible();
    await page.getByRole("button", { name: "Confirm send" }).first().click();
    await expect(page.getByText("Approved email was sent. CRM stage updated.")).toBeVisible();
  });

  test("crm company stage move and note actions show reliable feedback", async ({ page }) => {
    await page.goto("/dashboard/companies");
    await page.getByRole("main").getByRole("combobox").selectOption("Not Interested");
    await page.getByRole("button", { name: /Update stage/ }).click();
    await expect(page.getByText("CRM stage updated.")).toBeVisible();
    await page.getByLabel("Notes and history").fill("Customer asked to review next week.");
    await page.getByRole("button", { name: /Add note/ }).click();
    await expect(page.getByText("Note saved.")).toBeVisible();
    await expect(page.getByText("Customer asked to review next week.").first()).toBeVisible();
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
    await expect(page.getByRole("heading", { name: "Find customers, save CRM leads, write emails." })).toBeVisible();
    await expect(main).toContainText("Start search");
    await expect(main).toContainText("Open CRM");
    await expect(main).not.toContainText("Dashboard data is temporarily unavailable");
    await expect(main).not.toContainText("Dashboard details are temporarily unavailable");
  });

  test("dashboard does not crash when locale is Russian and widgets refresh", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    const fulfillRussianWorkspace = async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ...workspace, language: "ru" })
      });
    };
    await page.route("**/api/backend/api/workspace", fulfillRussianWorkspace);
    await page.route("**/api/backend/api/workspace/me", fulfillRussianWorkspace);
    await page.addInitScript(() => {
      window.localStorage.setItem("outreachai.locale", "ru");
    });
    await page.context().addCookies([{ name: "outreachai_locale", value: "ru", url: "http://127.0.0.1:3000" }]);
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("main")).not.toContainText("Что-то пошло не так");
    await expect(page.getByRole("main")).not.toContainText("Something went wrong");
    await expect(page.getByRole("main")).toContainText(/Найти клиентов, сохранить CRM-лиды, написать письма\.|Загружаем пространство/);
    expect(pageErrors).toEqual([]);
  });

  test("lead finder still shows saved leads when secondary workspace data fails", async ({ page }) => {
    await page.route("**/api/backend/api/campaigns", async (route) => {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ detail: "Campaigns unavailable" }) });
    });
    await page.route("**/api/backend/api/dashboard", async (route) => {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ detail: "Dashboard unavailable" }) });
    });
    await page.goto("/dashboard/leads");
    await expect(page.getByRole("heading", { name: "Find customers, then decide what to save." })).toBeVisible();
    await expect(page.getByRole("main")).toContainText("Search criteria");
    await expect(page.getByRole("main")).not.toContainText("Something went wrong");
    await expect(page.getByRole("main")).not.toContainText("Lead data unavailable");
  });

  test("companies workspace still loads companies when pipeline details fail", async ({ page }) => {
    await page.route("**/api/backend/api/crm/pipeline", async (route) => {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ detail: "Pipeline unavailable" }) });
    });
    await page.goto("/dashboard/companies");
    await expect(page.getByRole("heading", { name: "Saved leads, stages, notes and history." })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Hill Country Build Co" }).first()).toBeVisible();
    await expect(page.getByRole("main")).not.toContainText("Something went wrong");
    await expect(page.getByRole("main")).not.toContainText("CRM data could not be loaded");
  });
});
