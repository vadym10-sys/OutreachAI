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

const qaCustomerFinderResult = {
  id: "finder-result-1",
  company_name: "EuroScale CRM Co",
  official_website: "https://euroscale-crm.co",
  industry: "B2B SaaS",
  country: "Germany",
  company_size: "20-200",
  contact_name: "Sarah Meyer",
  contact_title: "Head of Sales",
  public_work_contact: "sarah.meyer@euroscale-crm.co",
  signal_type: "hiring_related_workflow",
  signal_description: "EuroScale CRM Co is hiring SDRs while replacing manual spreadsheet CRM workflows.",
  signal_date: "Unknown",
  source_url: "https://euroscale-crm.co/careers",
  source_title: "EuroScale CRM careers",
  source_type: "official_website",
  evidence_excerpt: "We are hiring SDRs to scale outbound sales and replace manual spreadsheet CRM workflows.",
  evidence_summary: "Verified public website content contains a hiring-related workflow signal relevant to B2B SaaS.",
  observed_fact: "Public source shows hiring-related workflow evidence: hiring SDRs to scale outbound sales and replace manual spreadsheet CRM workflows.",
  model_inference: "This signal may indicate timing for AI sales research and outreach in the B2B SaaS segment.",
  fit_explanation: "Scores are deterministic and require real public timing or pain evidence.",
  ai_relevance_score: 84,
  confidence_score: 78,
  verified_status: "verified",
  checked_at: now,
  source_provider: "hidden",
  canonical_source_url: "https://euroscale.example/careers",
  publication_date: "Unknown",
  retrieved_at: now,
  source_confidence: 34,
  source_verification_status: "verified",
  scoring_version: "intent-signals-quality-v2",
  score_factors: { industry_fit: 25, country_fit: 15, signal_strength: 30, source_quality: 34 },
  score_weights: { signal_strength: 30, source_quality: 30 },
  score_penalties: { stale_or_unknown_publication_date: 12, weak_or_missing_buying_signal: 0 },
  score_explanation: "Industry match alone cannot create high buying intent.",
  icp_fit_score: 76,
  buying_intent_score: 84,
  revenue_opportunity_score: 79,
  first_line_opener: "I noticed EuroScale CRM Co's public site shows hiring-related workflow evidence tied to SDR growth.",
  email_id: "33333333-3333-3333-3333-333333333333",
  email_subject: "Quick idea for EuroScale CRM Co",
  email_body: "Hi Sarah,\n\nI noticed EuroScale CRM Co is hiring SDRs while replacing manual spreadsheet CRM workflows.\n\nOutreachAI helps sales teams find verified companies, save them to CRM, and prepare short personalized first emails.\n\nWorth a quick fit review?",
  email_delivery_status: "draft",
  can_send: true,
  lead_status: "Письмо подготовлено",
  simple_status: "Письмо подготовлено",
  draft_email: "Hi Head of Sales,\n\nI noticed EuroScale CRM Co's public site shows hiring-related workflow evidence tied to SDR growth.\n\nWe help B2B SaaS teams with AI sales research and outreach. This signal may indicate timing for reviewed outbound.\n\nWould it be worth a quick fit review?\n\nDraft only — review before sending.",
  lead_id: "22222222-2222-2222-2222-222222222224",
  company_id: "44444444-4444-4444-4444-444444444446",
  score_delta: 22,
  intent_alert: true,
  intent_timeline: [
    { change_type: "new_hiring", detected_at: now, signal: "Hiring SDRs", previous_score: 62, current_score: 84, score_delta: 22, source_url: "https://euroscale-crm.co/careers" }
  ]
};

const qaCustomerFinderJob = {
  id: "finder-job-1",
  status: "partially_completed",
  progress: { stage: "partially_completed", message: "AI Customer Finder saved partial verified results.", percent: 100, verified: 1, partially_verified: 0, unknown: 1, rejected: 1, saved: 1, candidates: 3 },
  summary: { verified: 1, partially_verified: 0, unknown: 1, rejected: 1, saved: 1, candidates: 3, warnings: ["Unknown Source Co: Website could not be reached.", "Weak Fit Co: no meaningful buying or timing signal."] },
  criteria: {
    company_website: "https://outreachaiaiai.com",
    desired_customers: "B2B SaaS companies in Europe with sales teams that need better outbound research.",
    company_description: "https://outreachaiaiai.com",
    product_or_service: "B2B SaaS companies in Europe with sales teams that need better outbound research.",
    target_country: "Germany",
    target_industry: "B2B SaaS",
    company_size: "20-200",
    contact_titles: ["Head of Sales"],
    max_results: 10,
    additional_criteria: "expanding sales team in Europe",
    keywords: ["SDR hiring", "CRM"],
    exclusions: []
  },
  error_message: "",
  results: [qaCustomerFinderResult],
  created_at: now,
  completed_at: now
};

const qaSalesAnalysisV2 = {
  generated_at: now,
  provider: "openai",
  model: "gpt-4.1-mini",
  summary: "Outbound-ready with strong proof signals and a clear owner contact.",
  company_summary: "Hill Country Build Co is a commercial renovation company with visible service pages and a clear conversion gap.",
  business_model: "Commercial renovation provider serving property owners and facilities teams.",
  what_company_sells: "Commercial renovation and build services.",
  target_customers: "Property owners and facilities teams",
  company_stage: "Active outreach",
  pain_points: ["Website has a weak consultation CTA", "The business needs more qualified renovation leads"],
  likely_business_pains: ["Website has a weak consultation CTA", "The business needs more qualified renovation leads"],
  buying_signals: ["Recent service-page activity", "Verified owner contact", "Clear website conversion gap"],
  relevant_technologies: ["WordPress"],
  company_growth_indicators: ["Recent service-page updates", "Visible trust signals"],
  why_fits_icp: ["Matches a B2B local-services outreach motion", "Strong owner-level contact fit"],
  why_may_not_fit: ["Lead volume may already be adequate"],
  icp_fit_score: 82,
  ai_lead_score: 79,
  lead_priority_score: 86,
  lead_priority_tier: "Hot",
  buying_probability: 73,
  score_explanation: "Strong ICP fit, verified contact, and a simple conversion opportunity make this a high-priority account.",
  estimated_reply_probability: 64,
  estimated_company_size: "11-50 employees",
  estimated_revenue: "$1M-$10M ARR",
  recommended_decision_maker_role: "Owner",
  decision_makers: [{ name: "Jane Doe", title: "Owner", email: "jane@example.com" }],
  best_outreach_angle: "Lead with a specific website conversion idea tied to renovation demand.",
  value_proposition: "Help the owner turn website visitors into qualified renovation calls.",
  best_communication_channel: "Email",
  personalization_variables: ["Austin market context", "Commercial renovation niche", "Owner decision-maker"],
  predicted_objections: ["They may already have enough local demand", "Timing could be the main blocker"],
  personalized_opening_line: "Hi Jane, I noticed Hill Country Build Co has strong service pages but could convert more visitors into consults.",
  strongest_sales_arguments: ["Clear website conversion opportunity", "Verified owner-level contact", "Strong local service fit"],
  suggested_cta: "Open to a quick call to review the site conversion path?",
  recommended_next_action: "Send the personalized first email and track the reply window.",
  recommended_first_message: "Hi Jane, I noticed Hill Country Build Co has strong service pages but could convert more visitors into consults. We help renovation teams turn local website traffic into qualified calls without adding headcount. Open to a quick call to review the site conversion path?",
  personalized_follow_up_sequence: ["Day 3: share one website-specific improvement", "Day 7: offer a short teardown with 2 quick fixes"],
  best_timing_to_contact: "Tuesday to Thursday between 09:00-11:00 local time.",
  decision_maker: { name: "Jane Doe", title: "Owner", email: "jane@example.com" },
  reasoning: ["Verified owner contact", "Strong website conversion gap", "Clear local-service ICP fit"],
  missing_data: [],
  evidence: [{ source_field: "company.website", value: "https://example.com", confidence: 95 }],
  recommendation_actions: {
    decision_maker: { label: "Best decision maker", value: { name: "Jane Doe", title: "Owner", email: "jane@example.com", recommended_role: "Owner" }, approved: false, edited: false, regenerated: false, confidence: 84, reasoning: "Owner contact is verified and aligned with purchase authority.", evidence: [{ source_field: "company.contacts", value: "Verified owner contact", confidence: 92 }], updated_at: now },
    first_message: { label: "Personalized first message", value: "Hi Jane, I noticed Hill Country Build Co has strong service pages but could convert more visitors into consults.", approved: false, edited: false, regenerated: false, confidence: 84, reasoning: "Message references visible website conversion gap.", evidence: [{ source_field: "website.summary", value: "Conversion gap identified", confidence: 86 }], updated_at: now },
    follow_up_sequence: { label: "Follow-up sequence", value: ["Day 3: share one website-specific improvement", "Day 7: offer a short teardown with 2 quick fixes"], approved: false, edited: false, regenerated: false, confidence: 82, reasoning: "Sequence is short and CTA-focused.", evidence: [{ source_field: "outreach.follow_up", value: "Two-step cadence", confidence: 80 }], updated_at: now },
    best_channel: { label: "Best outreach channel", value: "Email", approved: false, edited: false, regenerated: false, confidence: 83, reasoning: "Verified owner email is available.", evidence: [{ source_field: "contact.email", value: "jane@example.com", confidence: 95 }], updated_at: now },
    reply_probability: { label: "Reply probability", value: 64, approved: false, edited: false, regenerated: false, confidence: 80, reasoning: "Based on contact quality and offer relevance.", evidence: [{ source_field: "analysis.reply_probability", value: "64", confidence: 78 }], updated_at: now },
    deal_success_probability: { label: "Deal success probability", value: 73, approved: false, edited: false, regenerated: false, confidence: 79, reasoning: "Buying probability reflects fit and intent.", evidence: [{ source_field: "analysis.buying_probability", value: "73", confidence: 77 }], updated_at: now },
    priority_score: { label: "Priority score", value: 86, approved: false, edited: false, regenerated: false, confidence: 84, reasoning: "High fit with a clear next step.", evidence: [{ source_field: "analysis.lead_priority", value: "Hot", confidence: 82 }], updated_at: now },
    next_best_action: { label: "Next best action", value: "Send the personalized first email and track the reply window.", approved: false, edited: false, regenerated: false, confidence: 84, reasoning: "First message is ready and recipient is verified.", evidence: [{ source_field: "analysis.recommended_next_action", value: "Send the personalized first email", confidence: 84 }], updated_at: now }
  },
  ai_copilot_panel: {
    generated_at: now,
    summary: "Copilot explains each recommendation with confidence and evidence.",
    confidence: 84,
    reasoning: ["Recommendations are generated from verified CRM and analysis data."],
    evidence: [{ source_field: "company.website", value: "https://example.com", confidence: 95 }],
    policy: "Every recommendation is evidence-backed, confidence-scored, editable, and auditable."
  },
  recommendation_audit_log: [{ event: "generated", key: "all", actor: "ai-system", at: now, reason: "initial generation", value_preview: "phase4 baseline" }],
  opportunity_score: 81,
  buying_intent_score: 73,
  confidence_score: 84,
  outreach_angle: "Lead with a specific website conversion idea tied to renovation demand.",
  best_subject_line: "Quick idea for Hill Country Build Co",
  best_cta: "Open to a quick call to review the site conversion path?",
  risk_to_check: "Verify whether the owner is already happy with current lead volume.",
  next_action: "Send the personalized first email and track the reply window.",
  version: 2
};

const qaSalesAnalysisV1 = {
  ...qaSalesAnalysisV2,
  generated_at: "2026-07-15T15:30:00.000Z",
  summary: "Earlier analysis with a narrower view of the opportunity.",
  company_summary: "Earlier snapshot of Hill Country Build Co.",
  score_explanation: "This earlier version focused on the owner contact and the website conversion gap.",
  lead_priority_score: 74,
  lead_priority_tier: "Warm",
  buying_probability: 60,
  estimated_reply_probability: 52,
  personalized_follow_up_sequence: ["Day 3: send one more website idea", "Day 7: follow up with a short CTA"],
  recommended_first_message: "Hi Jane, I noticed Hill Country Build Co has a solid website and thought one quick conversion idea could be useful.",
  best_subject_line: "One quick idea for Hill Country Build Co",
  best_timing_to_contact: "Weekdays between 09:00-11:00 local time.",
  next_action: "Review the website and send the first outreach draft.",
  recommendation_audit_log: [{ event: "generated", key: "all", actor: "ai-system", at: "2026-07-15T15:30:00.000Z", reason: "initial generation", value_preview: "version1" }],
  version: 1
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
  let currentAnalysis: any = { ...qaSalesAnalysisV2 };
  let analysisHistory: any[] = [{ ...qaSalesAnalysisV2 }, { ...qaSalesAnalysisV1 }];
  let currentProfile = { workspace: "QA Private Workspace", company: "QA Private Workspace", avatar_url: null, timezone: "UTC", language: "en" };
  let currentFinderJob: any = {
    ...qaCustomerFinderJob,
    status: "completed",
    progress: { ...qaCustomerFinderJob.progress, stage: "completed", message: "AI Customer Finder completed." },
    results: [{ ...qaCustomerFinderResult, lead_id: "", company_id: "", email_id: "", email_delivery_status: "", simple_status: "" }]
  };
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
    if (apiPath === "/api/workspace-app/leads/first-customers/search" && route.request().method() === "POST") {
      currentFinderJob = {
        ...qaCustomerFinderJob,
        status: "completed",
        progress: { stage: "completed", message: "First-customer candidates are ready for review.", percent: 100, verified: 1, partially_verified: 0, unknown: 0, rejected: 0, saved: 0, candidates: 1 },
        summary: { verified: 1, partially_verified: 0, unknown: 0, rejected: 0, saved_to_crm: 0, candidates: 1 },
        results: [{ ...qaCustomerFinderResult, lead_id: "", company_id: "", email_id: "", email_delivery_status: "", simple_status: "" }]
      };
      return fulfillJson(route, currentFinderJob);
    }
    if (apiPath === `/api/workspace-app/leads/first-customers/results/${qaCustomerFinderResult.id}/save`) {
      const updated = { ...qaCustomerFinderResult, simple_status: "Письмо подготовлено", email_delivery_status: "draft" };
      currentFinderJob = { ...currentFinderJob, results: [updated] };
      return fulfillJson(route, { status: "success", message: "Lead saved to CRM. Outreach draft is ready for manual review.", result: updated });
    }
    if (apiPath === "/api/workspace-app/ai-customer-finder/searches" && route.request().method() === "POST") {
      currentFinderJob = {
        ...qaCustomerFinderJob,
        status: "searching",
        progress: { stage: "verifying", message: "First verified result is ready while the search continues.", percent: 55, verified: 1, partially_verified: 0, unknown: 1, rejected: 1, saved: 0, candidates: 3 },
        results: [{ ...qaCustomerFinderResult, lead_id: "", company_id: "", email_id: "", email_delivery_status: "", simple_status: "" }]
      };
      return fulfillJson(route, currentFinderJob, 202);
    }
    if (apiPath === "/api/workspace-app/ai-customer-finder/searches") return fulfillJson(route, [currentFinderJob]);
    if (apiPath === `/api/workspace-app/ai-customer-finder/searches/${currentFinderJob.id}`) {
      return fulfillJson(route, currentFinderJob);
    }
    if (apiPath === `/api/workspace-app/ai-customer-finder/searches/${currentFinderJob.id}/cancel`) {
      currentFinderJob = { ...currentFinderJob, status: "failed", progress: { ...currentFinderJob.progress, stage: "failed", message: "Cancellation requested.", percent: 100 } };
      return fulfillJson(route, currentFinderJob);
    }
    if (apiPath === `/api/workspace-app/ai-customer-finder/results/${qaCustomerFinderResult.id}/draft`) {
      const updated = { ...qaCustomerFinderResult, email_delivery_status: "draft", simple_status: "Письмо подготовлено", can_send: true };
      currentFinderJob = { ...currentFinderJob, results: [updated] };
      return fulfillJson(route, { status: "success", message: "Draft saved in CRM.", result: updated });
    }
    if (apiPath === `/api/workspace-app/ai-customer-finder/results/${qaCustomerFinderResult.id}/send`) {
      const updated = { ...qaCustomerFinderResult, email_delivery_status: "sent", simple_status: "Отправлено", can_send: false };
      currentFinderJob = { ...currentFinderJob, results: [updated] };
      return fulfillJson(route, { status: "success", message: "Email sent. CRM stage updated.", result: updated });
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
    if (apiPath === `/api/workspace-app/companies/${qaCompany.id}/ai-sales-analysis`) {
      if (route.request().method() === "POST") {
        const body = route.request().postDataJSON() as { force?: boolean };
        if (body?.force) {
          const nextVersion = Number(currentAnalysis.version || 2) + 1;
          currentAnalysis = { ...currentAnalysis, version: nextVersion, generated_at: new Date().toISOString() };
          analysisHistory = [currentAnalysis, ...analysisHistory.filter((item) => item.version !== nextVersion)].slice(0, 10);
        }
        return fulfillJson(route, {
          status: "success",
          message: "AI sales analysis generated.",
          company_id: qaCompany.id,
          analysis: currentAnalysis,
          generated_at: currentAnalysis.generated_at,
          cached: false,
          requested_version: currentAnalysis.version,
          latest_version: currentAnalysis.version,
          available_versions: analysisHistory.map((item) => ({ version: item.version, generated_at: item.generated_at, provider: item.provider, model: item.model, status: "success" }))
        });
      }
      const requestedVersion = Number(url.searchParams.get("version") || 0);
      const analysis = requestedVersion ? (analysisHistory.find((item) => item.version === requestedVersion) || currentAnalysis) : currentAnalysis;
      return fulfillJson(route, {
        status: "success",
        message: requestedVersion ? "Loaded historical AI sales analysis." : "AI sales analysis generated.",
        company_id: qaCompany.id,
        analysis,
        generated_at: analysis.generated_at,
        cached: false,
        requested_version: requestedVersion || analysis.version || null,
        latest_version: currentAnalysis.version,
        available_versions: analysisHistory.map((item) => ({ version: item.version, generated_at: item.generated_at, provider: item.provider, model: item.model, status: "success" }))
      });
    }
    if (apiPath === `/api/workspace-app/companies/${qaCompany.id}/ai-sales-analysis/recommendations` && route.request().method() === "POST") {
      const body = route.request().postDataJSON() as { key: string; action: "approve" | "edit" | "regenerate"; value?: unknown; reason?: string };
      const nowIso = new Date().toISOString();
      const key = body.key;
      const previous = currentAnalysis.recommendation_actions?.[key] || { label: key, value: null, confidence: currentAnalysis.confidence_score || 80 };
      let nextValue = previous.value;
      if (body.action === "edit") nextValue = body.value;
      if (body.action === "regenerate") nextValue = previous.value;
      const nextActionState = {
        ...previous,
        value: nextValue,
        approved: body.action === "approve" ? true : Boolean(previous.approved),
        edited: body.action === "edit" ? true : Boolean(previous.edited),
        regenerated: body.action === "regenerate" ? true : Boolean(previous.regenerated),
        reasoning: body.reason || previous.reasoning,
        updated_at: nowIso,
      };
      const recommendationActions = { ...(currentAnalysis.recommendation_actions || {}), [key]: nextActionState };
      const updated: any = {
        ...currentAnalysis,
        recommendation_actions: recommendationActions,
        ai_copilot_panel: {
          ...(currentAnalysis.ai_copilot_panel || {}),
          generated_at: nowIso,
          last_action: { key, action: body.action, at: nowIso, actor: "qa-user" }
        },
        recommendation_audit_log: [
          ...((currentAnalysis.recommendation_audit_log || []) as any[]),
          { event: `recommendation_${body.action}`, key, actor: "qa-user", at: nowIso, reason: body.reason || "", value_preview: String(nextValue || "").slice(0, 180) }
        ].slice(-50),
      };
      if (key === "first_message") updated.recommended_first_message = String(nextValue || "");
      if (key === "follow_up_sequence") updated.personalized_follow_up_sequence = Array.isArray(nextValue) ? nextValue : [String(nextValue || "")].filter(Boolean);
      if (key === "best_channel") updated.best_communication_channel = String(nextValue || "");
      if (key === "reply_probability") updated.estimated_reply_probability = Number(nextValue || 0);
      if (key === "deal_success_probability") updated.buying_probability = Number(nextValue || 0);
      if (key === "priority_score") updated.lead_priority_score = Number(nextValue || 0);
      if (key === "next_best_action") {
        updated.recommended_next_action = String(nextValue || "");
        updated.next_action = String(nextValue || "");
      }

      const nextVersion = Number(currentAnalysis.version || 2) + 1;
      currentAnalysis = { ...updated, version: nextVersion, generated_at: nowIso };
      analysisHistory = [currentAnalysis, ...analysisHistory.filter((item) => item.version !== nextVersion)].slice(0, 10);

      return fulfillJson(route, {
        status: "success",
        message: "AI recommendation updated.",
        company_id: qaCompany.id,
        analysis: currentAnalysis,
        generated_at: currentAnalysis.generated_at,
        cached: false,
        requested_version: currentAnalysis.version,
        latest_version: currentAnalysis.version,
        available_versions: analysisHistory.map((item) => ({ version: item.version, generated_at: item.generated_at, provider: item.provider, model: item.model, status: "success" }))
      });
    }
    const workspaceCompanyAction = apiPath.match(/^\/api\/workspace-app\/companies\/([^/]+)\/(analyze|contacts|email-draft|complete-opportunity|enrichment\/restart)$/);
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
      if (action === "complete-opportunity" || action === "enrichment/restart") {
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
          message: action === "enrichment/restart" ? "AI enrichment restarted. This card will update as data arrives." : "Sales opportunity prepared. Review the AI research and approve only when ready.",
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
    if (apiPath === "/api/inbox") return fulfillJson(route, []);
    if (apiPath === "/api/profile") {
      if (route.request().method() === "PUT") {
        const body = route.request().postDataJSON();
        currentProfile = { ...currentProfile, ...body };
        return fulfillJson(route, currentProfile);
      }
      return fulfillJson(route, currentProfile);
    }
    if (apiPath === "/api/billing/plans") return fulfillJson(route, []);
    if (apiPath === "/api/billing/status") return fulfillJson(route, { plan: "Starter", price: 0, status: "active", trial_days_remaining: 14, limits: { leads: 100, email_sends: 250, ai_generations: 100 }, usage: { leads: 1, email_sends: 0, ai_generations: 3 }, sales_employees_used: 0, workspaces_used: 1 });
    if (apiPath === "/api/billing/usage") return fulfillJson(route, { plan: "Starter", period: "2026-07", limits: { leads: 100, email_sends: 250, ai_generations: 100 }, usage: { leads: 1, email_sends: 0, ai_generations: 3 } });
    if (apiPath === "/api/billing/invoices") return fulfillJson(route, []);
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
