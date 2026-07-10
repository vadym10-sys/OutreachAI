import type { Page, Route } from "@playwright/test";

const now = new Date().toISOString();

export const qaLead = {
  id: "22222222-2222-2222-2222-222222222222",
  company: "Hill Country Build Co",
  website: "https://example.com",
  industry: "Construction",
  country: "United States",
  city: "Austin",
  contact: "Jane Doe",
  email: "jane@example.com",
  phone: "+1 512 555 0101",
  linkedin: "https://linkedin.com/company/hill-country-build",
  domain: "example.com",
  employee_count: 42,
  revenue_range: "1M-10M",
  title: "Owner",
  confidence: "high",
  source: "hunter",
  hunter_verified: true,
  hunter_status: "verified",
  ai_summary: "Commercial renovation company with clear service pages.",
  suggested_offer: "Offer a booked-meeting system for commercial renovation leads.",
  outreach_strategy: "Lead with one website-specific growth idea, then ask for a short growth audit.",
  sales_angle: "Help the owner turn website visitors into qualified renovation calls.",
  expected_reply_rate: "8-12%",
  status: "New",
  created_at: now,
  found_at: now,
  saved_to_crm_at: now,
  website_analyzed_at: now,
  contact_found_at: now,
  email_generated_at: now,
  last_activity_at: now,
  stage_changed_at: now
};

const qaCampaign = {
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
  created_at: now
};

export const qaCompany = {
  id: "44444444-4444-4444-4444-444444444444",
  lead_id: qaLead.id,
  name: qaLead.company,
  website: qaLead.website,
  domain: qaLead.domain,
  phone: qaLead.phone,
  email: qaLead.email,
  address: "1 Congress Ave, Austin, TX",
  city: qaLead.city,
  country: qaLead.country,
  industry: qaLead.industry,
  google_rating: 4.7,
  place_id: "google_place_1",
  source: "google_maps_hunter",
  ai_summary: qaLead.ai_summary,
  suggested_offer: qaLead.suggested_offer,
  outreach_strategy: qaLead.outreach_strategy,
  sales_angle: qaLead.sales_angle,
  expected_reply_rate: qaLead.expected_reply_rate,
  email_status: "Verified",
  crm_stage: "Contact Found",
  contacts: [
    {
      id: "55555555-5555-5555-5555-555555555555",
      company_id: "44444444-4444-4444-4444-444444444444",
      lead_id: qaLead.id,
      company: qaLead.company,
      name: qaLead.contact,
      title: qaLead.title,
      email: qaLead.email,
      phone: qaLead.phone,
      linkedin: qaLead.linkedin,
      confidence: "97",
      source: "hunter",
      email_status: "Verified",
      created_at: now
    }
  ],
  deals: [
    {
      id: "66666666-6666-6666-6666-666666666666",
      company_id: "44444444-4444-4444-4444-444444444444",
      lead_id: qaLead.id,
      company: qaLead.company,
      name: "Hill Country Build Co opportunity",
      stage: "Contact Found",
      value: 12000,
      probability: 35,
      source: "google_maps_hunter",
      next_step: "Review AI email and approve campaign.",
      created_at: now
    }
  ],
  notes: [
    { id: "77777777-7777-7777-7777-777777777777", company_id: "44444444-4444-4444-4444-444444444444", lead_id: qaLead.id, body: qaLead.ai_summary, kind: "ai_summary", created_at: now }
  ],
  activity: [
    { id: "88888888-8888-8888-8888-888888888888", action: "lead.found", metadata_json: {}, created_at: now }
  ],
  generated_emails: [
    { id: "33333333-3333-3333-3333-333333333333", campaign_id: null, lead_id: qaLead.id, subject: "Quick idea for Hill Country Build Co", preview: "A reviewed draft is ready.", body: "Hi Jane, I noticed a website conversion opportunity.", cta: "Book a growth audit", follow_up_1: "Worth a quick look?", follow_up_2: "Should I send the audit outline?", delivery_status: "draft" }
  ],
  created_at: now,
  updated_at: now,
  found_at: now,
  saved_to_crm_at: now,
  website_analyzed_at: now,
  contact_found_at: now,
  email_generated_at: now,
  email_approved_at: null,
  email_sent_at: null,
  delivered_at: null,
  opened_at: null,
  replied_at: null,
  last_activity_at: now,
  stage_changed_at: now
};

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

type MockOverride = {
  status?: number;
  body: unknown;
};

export async function mockWorkspaceApi(page: Page, overrides: Record<string, MockOverride> = {}) {
  let manualCompany: any = null;
  let currentCampaign: any = qaCampaign;
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const apiPath = url.pathname.replace(/^\/api\/backend/, "");
    const override = overrides[`${route.request().method()} ${apiPath}`] || overrides[apiPath];
    if (override) return fulfillJson(route, override.body, override.status || 200);
    if (apiPath === "/api/workspace" || apiPath === "/api/workspace/me") return fulfillJson(route, {
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
          created_at: now
        }
      ]
    });
    if (apiPath === "/api/leads" && route.request().method() === "POST") {
      const body = route.request().postDataJSON() as Partial<typeof qaLead>;
      return fulfillJson(route, {
        ...qaLead,
        id: "22222222-2222-2222-2222-222222222223",
        company: body.company || "Manual Company",
        website: body.website || null,
        country: body.country || null,
        city: body.city || null,
        industry: body.industry || null,
        contact: body.contact || null,
        email: body.email || null,
        phone: body.phone || null,
        source: "manual",
        hunter_verified: false,
        hunter_status: body.email ? "manual_email" : "no_verified_email",
        ai_summary: null,
        suggested_offer: null,
        outreach_strategy: null,
        sales_angle: null,
        expected_reply_rate: null,
        status: "New",
        created_at: now,
        found_at: now,
        saved_to_crm_at: now,
        website_analyzed_at: null,
        contact_found_at: body.email ? now : null,
        email_generated_at: null,
        last_activity_at: now,
        stage_changed_at: now
      });
    }
    if (apiPath === "/api/leads") return fulfillJson(route, { items: [qaLead], total: 1, page: 1, page_size: 100 });
    if (apiPath === "/api/leads/find") return fulfillJson(route, [qaLead]);
    if (apiPath === "/api/workspace-app/bootstrap") {
      return fulfillJson(route, {
        workspace: {
          id: "99999999-9999-9999-9999-999999999999",
          name: "QA Private Workspace"
        },
        counts: { leads: 1, companies: 1, campaigns: 1, emails: 1, deals: 1 },
        metrics: { leads: 1, companies: 1, contacts: 1, campaigns: 1, emails: 1, deals: 1 },
        next_action: "Review saved companies",
        recent_companies: [qaCompany],
        recent_activity: qaCompany.activity
      });
    }
    if (apiPath === "/api/workspace-app/integrations/status") {
      return fulfillJson(route, {
        integrations: [
          { key: "lead_search", label: "Lead search", status: "connected", message: "Connected. Lead Finder can search real companies." },
          { key: "contact_discovery", label: "Contact discovery", status: "connected", message: "Connected. Contact discovery can verify business emails." },
          { key: "ai_research", label: "AI research and email", status: "connected", message: "Connected. AI can analyze websites and draft outreach." },
          { key: "email_sending", label: "Email sending", status: "connected", message: "Connected. Approved emails can be sent." },
          { key: "billing", label: "Billing", status: "connected", message: "Connected. Plans and billing status can be managed." }
        ]
      });
    }
    if (apiPath === "/api/workspace-app/leads/search") {
      return fulfillJson(route, {
        request_id: "qa-request",
        status: "success",
        provider_status: { google_maps: "success", hunter: "success", openai: "success", database: "success" },
        companies: [qaCompany],
        saved_count: 1,
        duplicates_skipped: 0,
        warnings: [],
        message: "Found 1 company. Saved to CRM."
      });
    }
    if (apiPath === "/api/workspace-app/companies" && route.request().method() === "POST") {
      const body = route.request().postDataJSON() as Partial<typeof qaCompany>;
      manualCompany = {
        ...qaCompany,
        id: "44444444-4444-4444-4444-444444444445",
        name: body.name || "Manual Company",
        website: body.website || null,
        domain: body.website ? String(body.website).replace(/^https?:\/\//, "").replace(/\/.*$/, "") : null,
        country: body.country || null,
        city: body.city || null,
        industry: body.industry || null,
        phone: body.phone || null,
        email: body.email || null,
        source: "manual",
        email_status: body.email ? "Manual" : "Not found",
        crm_stage: "New Lead",
        contacts: body.email ? qaCompany.contacts : [],
        deals: [],
        notes: [],
        activity: [{ id: "88888888-8888-8888-8888-888888888889", action: "company.manual_created", metadata_json: {}, created_at: now }],
        generated_emails: [],
        created_at: now,
        found_at: now,
        saved_to_crm_at: now,
        website_analyzed_at: null,
        contact_found_at: body.email ? now : null,
        email_generated_at: null,
        last_activity_at: now,
        stage_changed_at: now
      };
      return fulfillJson(route, {
        status: "created",
        company: manualCompany,
        warnings: [],
        message: "Company saved to CRM."
      });
    }
    if (apiPath === "/api/workspace-app/companies") return fulfillJson(route, [qaCompany]);
    if (apiPath === `/api/workspace-app/companies/${qaCompany.id}`) return fulfillJson(route, qaCompany);
    const workspaceCompanyAction = apiPath.match(/^\/api\/workspace-app\/companies\/([^/]+)\/(analyze|contacts|email-draft|complete-opportunity)$/);
    if (workspaceCompanyAction) {
      const [, companyId, action] = workspaceCompanyAction;
      const baseCompany = manualCompany?.id === companyId ? manualCompany : qaCompany;
      if (action === "analyze") {
        const company = { ...baseCompany, crm_stage: "Website Analyzed", website_analyzed_at: now, ai_summary: baseCompany.ai_summary || qaLead.ai_summary };
        if (manualCompany?.id === companyId) manualCompany = company;
        return fulfillJson(route, { status: "success", message: "Website analysis saved.", company });
      }
      if (action === "contacts") {
        const company = { ...baseCompany, crm_stage: "Contact Found", contact_found_at: now, contacts: baseCompany.contacts?.length ? baseCompany.contacts : qaCompany.contacts, email: baseCompany.email || qaLead.email, email_status: "Verified" };
        if (manualCompany?.id === companyId) manualCompany = company;
        return fulfillJson(route, { status: "success", message: "Verified contact saved to CRM.", company });
      }
      if (action === "complete-opportunity") {
        const email = { ...qaCompany.generated_emails[0], lead_id: baseCompany.lead_id || qaLead.id, subject: `Quick idea for ${baseCompany.name}` };
        const company = {
          ...baseCompany,
          crm_stage: "Email Draft Ready",
          website_analyzed_at: now,
          contact_found_at: now,
          email_generated_at: now,
          contacts: baseCompany.contacts?.length ? baseCompany.contacts : qaCompany.contacts,
          email: baseCompany.email || qaLead.email,
          email_status: "Verified",
          ai_summary: baseCompany.ai_summary || qaLead.ai_summary,
          suggested_offer: baseCompany.suggested_offer || qaLead.suggested_offer,
          outreach_strategy: baseCompany.outreach_strategy || qaLead.outreach_strategy,
          sales_angle: baseCompany.sales_angle || qaLead.sales_angle,
          expected_reply_rate: baseCompany.expected_reply_rate || qaLead.expected_reply_rate,
          generated_emails: [email]
        };
        if (manualCompany?.id === companyId) manualCompany = company;
        return fulfillJson(route, {
          status: "success",
          message: "Sales opportunity prepared. Review the AI research and approve only when ready.",
          completed_steps: ["Company profile checked", "Website analysis checked", "Contact search checked", "Email draft checked"],
          workflow_stages: {
            company_profile: "completed",
            website_analysis: "completed",
            decision_maker: "completed",
            verified_email: "completed",
            ai_email: "completed",
            approval: "waiting"
          },
          company,
          email
        });
      }
      const email = { ...qaCompany.generated_emails[0], lead_id: baseCompany.lead_id || qaLead.id, subject: `Quick idea for ${baseCompany.name}` };
      const company = { ...baseCompany, crm_stage: "Email Draft Ready", email_generated_at: now, generated_emails: [email] };
      if (manualCompany?.id === companyId) manualCompany = company;
      return fulfillJson(route, { status: "success", message: "Email draft created for review. Nothing was sent.", company, email });
    }
    if (apiPath === "/api/workspace-app/emails/33333333-3333-3333-3333-333333333333/approve") return fulfillJson(route, { status: "success", message: "Email approved. It is ready to send, but nothing was sent automatically.", company: { ...qaCompany, crm_stage: "Approved", email_approved_at: now }, email: { ...qaCompany.generated_emails[0], delivery_status: "approved" } });
    if (apiPath === "/api/workspace-app/emails/33333333-3333-3333-3333-333333333333/send") return fulfillJson(route, { status: "success", message: "Approved email was sent. CRM stage updated.", company: { ...qaCompany, crm_stage: "Sent", email_sent_at: now }, email: { ...qaCompany.generated_emails[0], delivery_status: "sent", sent_at: now } });
    if (apiPath === "/api/dashboard") return fulfillJson(route, { leads: 1, campaigns: 1, emails_sent: 0, delivered: 0, opened: 0, replies: 0, bounces: 0, open_rate: 0, reply_rate: 0, ctr: 0, conversion_rate: 0, meetings: 0, revenue: 0, revenue_forecast: 0, mrr: 0, arr: 0, revenue_series: [], funnel: [], pipeline: [], plan: "Starter", usage: { leads: 1, email_sends: 0 } });
    if (apiPath === "/api/campaigns") {
      if (route.request().method() === "POST") {
        const body = route.request().postDataJSON() as Partial<typeof qaCampaign>;
        currentCampaign = { ...qaCampaign, name: body.name || qaCampaign.name };
        return fulfillJson(route, currentCampaign);
      }
      return fulfillJson(route, [currentCampaign]);
    }
    if (apiPath === `/api/campaigns/${qaCampaign.id}/launch`) {
      currentCampaign = { ...currentCampaign, status: "Running" };
      return fulfillJson(route, currentCampaign);
    }
    if (apiPath === `/api/campaigns/${qaCampaign.id}/pause`) {
      currentCampaign = { ...currentCampaign, status: "Paused" };
      return fulfillJson(route, currentCampaign);
    }
    if (apiPath === "/api/crm/companies") return fulfillJson(route, [qaCompany]);
    if (apiPath === `/api/crm/companies/${qaCompany.id}/stage`) {
      return fulfillJson(route, {
        ...qaCompany,
        crm_stage: "Meeting Scheduled",
        stage_changed_at: now,
        activity: [{ id: "99999999-9999-9999-9999-999999999990", action: "crm.stage_changed", metadata_json: {}, created_at: now }, ...qaCompany.activity]
      });
    }
    if (apiPath === `/api/crm/companies/${qaCompany.id}/notes`) {
      return fulfillJson(route, { id: "99999999-9999-9999-9999-999999999991", company_id: qaCompany.id, lead_id: qaLead.id, body: "Follow up next week.", kind: "note", created_at: now });
    }
    if (apiPath === "/api/crm/contacts") return fulfillJson(route, qaCompany.contacts);
    if (apiPath === "/api/crm/deals") return fulfillJson(route, qaCompany.deals);
    if (apiPath === "/api/crm/pipeline") return fulfillJson(route, { stages: ["New Lead", "Qualified", "Website Analyzed", "Contact Found", "Email Draft Ready", "Approved", "Sent", "Replied", "Meeting Scheduled", "Won", "Lost"], companies: [qaCompany], deals: qaCompany.deals });
    if (apiPath === "/api/sales-employees") return fulfillJson(route, []);
    if (apiPath === "/api/activity") return fulfillJson(route, []);
    if (apiPath === "/api/notifications") return fulfillJson(route, []);
    if (apiPath === "/api/billing/plans") return fulfillJson(route, []);
    if (apiPath === "/api/billing/status") return fulfillJson(route, { plan: "Starter", status: "active", usage: { leads: 1, email_sends: 0 } });
    if (apiPath.includes("/copilot")) return fulfillJson(route, { probability_to_reply: 82, probability_to_buy: 64, best_first_contact: "Jane Doe", best_subject_line: "Quick idea for Hill Country Build Co", best_cta: "Book a growth audit", estimated_revenue: 12000, reasoning: ["Verified owner contact", "Relevant renovation services", "Clear website conversion gap"] });
    if (apiPath.includes("/website-audit")) return fulfillJson(route, { missing_cta: true, missing_contact_form: false, poor_seo: false, weak_trust_signals: true, missing_reviews: false, slow_website: false, outdated_design: false, improvement_report: "The website has service pages but a weak project consultation CTA.", priority_actions: ["Add a consultation CTA", "Improve trust signals"] });
    if (apiPath.includes("/follow-ups")) return fulfillJson(route, { no_open: ["Worth a quick look?"], opened: ["I noticed you opened the idea."], clicked: ["Happy to send the audit outline."], replied: ["Thanks for replying."] });
    if (apiPath.includes("/draft-email")) return fulfillJson(route, qaCompany.generated_emails[0]);
    if (apiPath.includes("/approve")) return fulfillJson(route, { ...qaCompany.generated_emails[0], delivery_status: "approved" });
    if (apiPath.includes("/send")) return fulfillJson(route, { ...qaCompany.generated_emails[0], delivery_status: "sent", sent_at: now });
    if (apiPath === "/api/ai/analyze") return fulfillJson(route, { company: qaLead.company, website: qaLead.website, description: "Commercial renovation company.", industry: "Construction", location: "Austin", niche: "Construction", products_services: ["Renovation"], services: ["Commercial renovation"], technologies: [], strengths: ["Clear service pages"], weaknesses: ["Weak CTA"], icp_score: 87, summary: "Strong fit for outbound.", company_summary: "Commercial renovation company.", suggested_offer: "Booked-meeting system", outreach_strategy: "Lead with website-specific conversion idea.", sales_angle: "Turn visitors into booked calls.", expected_reply_rate: "8-12%", recommended_cta: "Book a growth audit" });
    return fulfillJson(route, {});
  });
}
