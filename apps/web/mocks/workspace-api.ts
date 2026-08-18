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
  overall_lead_score: 84,
  website_quality_score: 71,
  contact_confidence_score: 78,
  outreach_readiness_score: 66,
  lead_score_explanation: "Lead score uses confirmed public evidence, website quality, contact confidence and outreach readiness components.",
  lead_intelligence: {
    overall_lead_score: 84,
    score_model: "outreach_success_probability",
    components: {
      website_quality: 71,
      contact_confidence: 78,
      outreach_readiness: 66
    },
    insufficient_data: [],
    evidence: {
      buying_intent_terms: ["hiring"],
      technology_terms: ["CRM"]
    }
  },
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
    { id: "33333333-3333-3333-3333-333333333333", campaign_id: null, lead_id: qaLead.id, recipient_email: qaLead.email, subject: "Quick idea for Hill Country Build Co", preview: "A reviewed draft is ready.", body: "Hi Jane, I noticed a website conversion opportunity.", cta: "Book a growth audit", follow_up_1: "Worth a quick look?", follow_up_2: "Should I send the audit outline?", delivery_status: "draft" }
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
  result_tier: "Strong match",
  website_verification_status: "verified",
  website_verification_warning: "",
  missing_buying_signal: false,
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
  overall_lead_score: 84,
  website_quality_score: 71,
  contact_confidence_score: 78,
  outreach_readiness_score: 66,
  lead_intelligence: {
    overall_lead_score: 84,
    score_model: "outreach_success_probability",
    components: {
      website_quality: 71,
      contact_confidence: 78,
      outreach_readiness: 66
    },
    insufficient_data: [],
    evidence: {
      buying_intent_terms: ["hiring"],
      technology_terms: ["CRM"]
    }
  },
  first_line_opener: "I noticed EuroScale CRM Co's public site shows hiring-related workflow evidence tied to SDR growth.",
  email_id: "33333333-3333-3333-3333-333333333333",
  email_subject: "Quick idea for EuroScale CRM Co",
  email_body: "Hi Sarah,\n\nI noticed EuroScale CRM Co is hiring SDRs while replacing manual spreadsheet CRM workflows.\n\nOutreachAI helps sales teams find verified companies, save them to CRM, and prepare short personalized first emails.\n\nWorth a quick fit review?",
  email_delivery_status: "draft",
  can_send: false,
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

async function fulfillJson(route: Route, body: unknown, status = 200, headers: Record<string, string> = {}) {
  await route.fulfill({ status, contentType: "application/json", headers, body: JSON.stringify(body) });
}

function inboxPage(items: unknown[], searchParams: URLSearchParams) {
  const pageSize = Math.max(1, Math.min(200, Number(searchParams.get("page_size") || "100") || 100));
  const cursor = searchParams.get("cursor") || "";
  let start = 0;
  if (cursor) {
    try {
      const decoded = JSON.parse(Buffer.from(cursor.padEnd(Math.ceil(cursor.length / 4) * 4, "="), "base64url").toString("utf8"));
      const cursorCreatedAt = String(decoded.created_at || "");
      const cursorId = String(decoded.id || "");
      const index = items.findIndex((item) => {
        const message = item as { id?: unknown; created_at?: unknown };
        return String(message.created_at || "") === cursorCreatedAt && String(message.id || "") === cursorId;
      });
      start = index >= 0 ? index + 1 : 0;
    } catch {
      start = 0;
    }
  }
  const page = items.slice(start, start + pageSize);
  const hasMore = start + pageSize < items.length;
  const last = page[page.length - 1] as { id?: unknown; created_at?: unknown } | undefined;
  const nextCursor = hasMore && last
    ? Buffer.from(JSON.stringify({ created_at: String(last.created_at || ""), id: String(last.id || "") }), "utf8").toString("base64url")
    : "";
  return {
    body: page,
    headers: {
      "X-Has-More": hasMore ? "true" : "false",
      "X-Next-Cursor": nextCursor,
      "X-Pagination-Mode": "cursor"
    }
  };
}

type MockOverride = {
  status?: number;
  body: unknown;
};

export async function mockWorkspaceApi(page: Page, overrides: Record<string, MockOverride> = {}) {
  let manualCompany: any = null;
  let currentCompany: any = qaCompany;
  let currentCampaign: any = qaCampaign;
  let currentInbox: any[] = [];
  let currentAnalysis: any = { ...qaSalesAnalysisV2 };
  let smokeProviderCalls = 0;
  let ordinarySendConfirmed = false;
  const memoryEntry = {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    memory_type: "verified_fact",
    content: "Business profile: OutreachAI sells AI-powered outbound workflow software.",
    source: "workspace_profile",
    verified: true,
    approved_by_user: false,
    confidence: 95,
    created_at: now
  };
  currentAnalysis = {
    ...currentAnalysis,
    memory_context: {
      enabled: true,
      retrieval_mode: "keyword",
      memory_ids: [memoryEntry.id],
      items: [{ id: memoryEntry.id, type: "verified_fact", source: "workspace_profile", content: memoryEntry.content, relevance_score: 0.91, verified: true, influence: "Used as verified factual context." }],
      truncated: false,
      reason: ""
    }
  };
  let analysisHistory: any[] = [{ ...qaSalesAnalysisV2 }, { ...qaSalesAnalysisV1 }];
  let currentProfile = { workspace: "QA Private Workspace", company: "QA Private Workspace", avatar_url: null, timezone: "UTC", language: "en" };
  let currentWorkspace: any = {
    id: "99999999-9999-9999-9999-999999999999",
    name: "QA Private Workspace",
    company: "QA Private Workspace",
    industry: "Construction",
    target_country: "United States",
    target_customer: "Commercial builders",
    offer: "Booked-meeting system for commercial renovation teams",
    cta: "Book a growth audit",
    tone: "Consultative",
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
  };
  let currentFinderJob: any = {
    ...qaCustomerFinderJob,
    status: "completed",
    progress: { ...qaCustomerFinderJob.progress, stage: "completed", message: "AI Customer Finder completed." },
    results: [{ ...qaCustomerFinderResult, lead_id: "", company_id: "", email_id: "", email_delivery_status: "", simple_status: "", can_send: false }]
  };
  let currentAgentRun: any = {
    id: "aaaaaaaa-2222-4222-8222-aaaaaaaa2222",
    workspace_id: currentWorkspace.id,
    user_id: "e2e-user",
    status: "waiting_approval",
    objective: "Find qualified companies and prepare one reviewed email draft.",
    dry_run: true,
    plan: {},
    current_step_index: 1,
    current_step_name: "Send email",
    model: "test-agent-model",
    prompt_version: "test-agent-plan-v1",
    token_usage: { prompt_tokens: 120, completion_tokens: 80, total_tokens: 200 },
    estimated_cost: 0.0123,
    latency_ms: 2400,
    error_category: "",
    idempotency_key: "agent-run-ui",
    created_at: now,
    updated_at: now,
    completed_at: null
  };
  let currentAgentSteps: any[] = [
    {
      id: "bbbbbbbb-2222-4222-8222-bbbbbbbb2222",
      run_id: currentAgentRun.id,
      workspace_id: currentWorkspace.id,
      step_index: 0,
      status: "completed",
      title: "Find companies",
      tool_name: "search_companies",
      input: { query: "qualified companies", dry_run: true },
      output: { status: "dry_run", dry_run: true, results: [{ company: "QA Builder Co" }] },
      approval_state: "none",
      error_category: "",
      latency_ms: 900,
      created_at: now,
      updated_at: now,
      completed_at: now
    },
    {
      id: "cccccccc-2222-4222-8222-cccccccc2222",
      run_id: currentAgentRun.id,
      workspace_id: currentWorkspace.id,
      step_index: 1,
      status: "waiting_approval",
      title: "Send email",
      tool_name: "send_email",
      input: { email_id: "33333333-3333-3333-3333-333333333333" },
      output: {},
      approval_state: "pending",
      error_category: "",
      latency_ms: 0,
      created_at: now,
      updated_at: now,
      completed_at: null
    }
  ];
  let currentAgentApproval: any = {
    id: "dddddddd-2222-4222-8222-dddddddd2222",
    run_id: currentAgentRun.id,
    step_id: currentAgentSteps[1].id,
    tool_call_id: "eeeeeeee-2222-4222-8222-eeeeeeee2222",
    workspace_id: currentWorkspace.id,
    user_id: "e2e-user",
    tool_name: "send_email",
    action_type: "external_side_effect",
    approval_state: "pending",
    tool_arguments: { email_id: "33333333-3333-3333-3333-333333333333" },
    decision: { required_confirmations: ["manual_draft_approval", "separate_final_send_confirmation"] },
    idempotency_key: "agent-tool-ui",
    requested_at: now,
    decided_at: null,
    decided_by_user_id: ""
  };
  let currentAgentTrace: any[] = [
    {
      id: "ffffffff-2222-4222-8222-ffffffff2222",
      run_id: currentAgentRun.id,
      step_id: currentAgentSteps[0].id,
      tool_call_id: null,
      workspace_id: currentWorkspace.id,
      user_id: "e2e-user",
      event_type: "tool.succeeded",
      status: "succeeded",
      model: "",
      tool_name: "search_companies",
      latency_ms: 900,
      token_usage: {},
      estimated_cost: null,
      approval_decision: "",
      error_category: "",
      message: "",
      data: { tool_result: { status: "dry_run", body: "[redacted]" } },
      untrusted_input: true,
      created_at: now
    }
  ];
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const apiPath = url.pathname.replace(/^\/api\/backend/, "");
    const override = overrides[`${route.request().method()} ${apiPath}${url.search}`] || overrides[`${route.request().method()} ${apiPath}`] || overrides[`${apiPath}${url.search}`] || overrides[apiPath];
    if (override) {
      if (apiPath === "/api/inbox" && Array.isArray(override.body)) {
        const page = inboxPage(override.body, url.searchParams);
        return fulfillJson(route, page.body, override.status || 200, page.headers);
      }
      return fulfillJson(route, override.body, override.status || 200);
    }
    if (apiPath === "/api/workspace" && route.request().method() === "PUT") {
      currentWorkspace = { ...currentWorkspace, ...route.request().postDataJSON() };
      const profileComplete = Boolean(
        currentWorkspace.name
        && currentWorkspace.company
        && currentWorkspace.industry
        && currentWorkspace.target_country
        && currentWorkspace.target_customer
      );
      if (profileComplete) {
        currentWorkspace.onboarding_step = Math.max(Number(currentWorkspace.onboarding_step || 1), 6);
        currentWorkspace.onboarding_completed = true;
      }
      return fulfillJson(route, currentWorkspace);
    }
    if (apiPath === "/api/workspace" || apiPath === "/api/workspace/me") return fulfillJson(route, currentWorkspace);
    if (apiPath === "/api/workspace-app/agent-runs/status") {
      return fulfillJson(route, { enabled: true, can_create_runs: true, registered_tools_count: 9 });
    }
    if (apiPath === "/api/workspace-app/agent-runs" && route.request().method() === "GET") {
      const statusFilter = url.searchParams.get("status") || "";
      const runs = statusFilter ? [currentAgentRun].filter((run) => run.status === statusFilter) : [currentAgentRun];
      return fulfillJson(route, { runs, next_cursor: "", has_more: false, limit: Number(url.searchParams.get("limit") || 20) });
    }
    if (apiPath === "/api/workspace-app/agent-runs" && route.request().method() === "POST") {
      const body = route.request().postDataJSON() as { objective?: string; dry_run?: boolean };
      currentAgentRun = {
        ...currentAgentRun,
        id: "aaaaaaaa-3333-4333-8333-aaaaaaaa3333",
        status: "completed",
        objective: body.objective || "New AI task",
        dry_run: body.dry_run !== false,
        current_step_index: 0,
        current_step_name: "Find companies",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        completed_at: new Date().toISOString()
      };
      currentAgentSteps = [{
        ...currentAgentSteps[0],
        id: "bbbbbbbb-3333-4333-8333-bbbbbbbb3333",
        run_id: currentAgentRun.id,
        status: "completed",
        output: { status: "dry_run", dry_run: true, results: [{ company: "New QA Company" }] }
      }];
      currentAgentApproval = { ...currentAgentApproval, run_id: currentAgentRun.id, approval_state: "approved", decided_at: now, decided_by_user_id: "e2e-user" };
      currentAgentTrace = [{ ...currentAgentTrace[0], run_id: currentAgentRun.id, step_id: currentAgentSteps[0].id }];
      return fulfillJson(route, { run: currentAgentRun, steps: currentAgentSteps, approvals: [] }, 202);
    }
    if (apiPath === "/api/workspace-app/agent-runs/approvals") {
      const approvalStatus = url.searchParams.get("status") || "pending";
      const approvals = currentAgentApproval.approval_state === approvalStatus ? [currentAgentApproval] : [];
      return fulfillJson(route, { approvals, next_cursor: "", has_more: false, limit: Number(url.searchParams.get("limit") || 20) });
    }
    const agentRunMatch = apiPath.match(/^\/api\/workspace-app\/agent-runs\/([^/]+)(?:\/([^/]+))?$/);
    if (agentRunMatch) {
      const runId = agentRunMatch[1];
      const action = agentRunMatch[2] || "";
      if (runId !== currentAgentRun.id) return fulfillJson(route, { detail: "Not found" }, 404);
      if (!action && route.request().method() === "GET") return fulfillJson(route, { run: currentAgentRun, steps: currentAgentSteps, approvals: [currentAgentApproval] });
      if (action === "trace" && route.request().method() === "GET") return fulfillJson(route, { run: currentAgentRun, trace: currentAgentTrace });
      if (action === "approve" && route.request().method() === "POST") {
        currentAgentApproval = { ...currentAgentApproval, approval_state: "approved", decided_at: new Date().toISOString(), decided_by_user_id: "e2e-user" };
        currentAgentSteps = currentAgentSteps.map((step) => step.id === currentAgentApproval.step_id ? { ...step, approval_state: "approved" } : step);
        currentAgentRun = { ...currentAgentRun, status: "waiting_approval", updated_at: new Date().toISOString() };
        return fulfillJson(route, currentAgentRun);
      }
      if (action === "reject" && route.request().method() === "POST") {
        currentAgentApproval = { ...currentAgentApproval, approval_state: "rejected", decided_at: new Date().toISOString(), decided_by_user_id: "e2e-user" };
        currentAgentRun = { ...currentAgentRun, status: "cancelled", updated_at: new Date().toISOString(), completed_at: new Date().toISOString() };
        return fulfillJson(route, currentAgentRun);
      }
      if (action === "resume" && route.request().method() === "POST") {
        currentAgentRun = { ...currentAgentRun, status: "completed", updated_at: new Date().toISOString(), completed_at: new Date().toISOString() };
        currentAgentSteps = currentAgentSteps.map((step) => step.id === currentAgentApproval.step_id ? { ...step, status: "completed", output: { status: "dry_run", dry_run: true }, completed_at: new Date().toISOString() } : step);
        return fulfillJson(route, { run: currentAgentRun, steps: currentAgentSteps, approvals: [currentAgentApproval] });
      }
      if (action === "cancel" && route.request().method() === "POST") {
        currentAgentRun = { ...currentAgentRun, status: "cancelled", updated_at: new Date().toISOString(), completed_at: new Date().toISOString() };
        return fulfillJson(route, currentAgentRun);
      }
    }
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
    if (apiPath === "/api/workspace-app/ai-memory/settings") {
      return fulfillJson(route, {
        enabled: true,
        workspace_id: "99999999-9999-9999-9999-999999999999",
        max_items: 12,
        max_characters: 6000,
        relevance_threshold: 0.18,
        retention_days: 365,
        embeddings_enabled: true,
        pgvector_available: false,
        embedding_provider: "",
        embedding_model: "",
        last_retrieval_mode: "keyword",
        active_count: 1,
        counts_by_type: { verified_fact: 1, approved_preference: 0, outcome: 0 }
      });
    }
    if (apiPath === "/api/workspace-app/ai-memory/entries") {
      if (route.request().method() === "DELETE") return fulfillJson(route, { cleared: 1 });
      return fulfillJson(route, { entries: [memoryEntry] });
    }
    if (apiPath === "/api/workspace-app/ai-memory/preferences") return fulfillJson(route, { entry: { ...memoryEntry, memory_type: "approved_preference", content: "Use a concise direct tone." } });
    if (apiPath.startsWith("/api/workspace-app/ai-memory/entries/")) {
      if (route.request().method() === "DELETE") return fulfillJson(route, { deleted: true, id: memoryEntry.id });
      return fulfillJson(route, { entry: memoryEntry });
    }
    if (apiPath === `/api/workspace-app/ai-memory/decisions/${qaCompany.id}/explain`) {
      return fulfillJson(route, {
        memory_context: currentAnalysis.memory_context,
        verified_facts: currentAnalysis.memory_context.items,
        ai_assumptions: [],
        sources: ["workspace_profile"],
        confidence_basis: currentAnalysis.confidence_basis || "Uses verified workspace profile and CRM evidence.",
        used_memories: currentAnalysis.memory_context.items,
        insufficient_data: false
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
      currentCompany = {
        ...qaCompany,
        id: qaCustomerFinderResult.company_id,
        lead_id: qaCustomerFinderResult.lead_id,
        name: qaCustomerFinderResult.company_name,
        website: qaCustomerFinderResult.official_website,
        domain: "euroscale-crm.co",
        country: qaCustomerFinderResult.country,
        city: "",
        industry: qaCustomerFinderResult.industry,
        contact: qaCustomerFinderResult.contact_name,
        email: qaCustomerFinderResult.public_work_contact,
        source: qaCustomerFinderResult.source_type,
        ai_summary: qaCustomerFinderResult.fit_explanation,
        sales_angle: qaCustomerFinderResult.model_inference,
        email_status: "Verified",
        crm_stage: "Email Draft Ready",
        contacts: [{
          ...qaCompany.contacts[0],
          id: "55555555-5555-5555-5555-555555555556",
          company_id: qaCustomerFinderResult.company_id,
          lead_id: qaCustomerFinderResult.lead_id,
          company: qaCustomerFinderResult.company_name,
          name: qaCustomerFinderResult.contact_name,
          title: qaCustomerFinderResult.contact_title,
          email: qaCustomerFinderResult.public_work_contact,
          source: qaCustomerFinderResult.source_type,
          email_status: "Verified"
        }],
        generated_emails: [{
          ...qaCompany.generated_emails[0],
          id: qaCustomerFinderResult.email_id,
          lead_id: qaCustomerFinderResult.lead_id,
          subject: qaCustomerFinderResult.email_subject,
          body: qaCustomerFinderResult.email_body,
          preview: "A personalized draft is ready for manual approval.",
          delivery_status: "draft"
        }]
      };
      currentFinderJob = { ...currentFinderJob, results: [{ ...updated, can_send: false }] };
      return fulfillJson(route, { status: "success", message: "Lead saved to CRM. Outreach draft is ready for manual review.", result: { ...updated, can_send: false } });
    }
    if (apiPath === "/api/workspace-app/ai-customer-finder/searches" && route.request().method() === "POST") {
      currentFinderJob = {
        ...qaCustomerFinderJob,
        status: "searching",
        progress: { stage: "verifying", message: "First verified result is ready while the search continues.", percent: 55, verified: 1, partially_verified: 0, unknown: 1, rejected: 1, saved: 0, candidates: 3 },
        results: [{ ...qaCustomerFinderResult, lead_id: "", company_id: "", email_id: "", email_delivery_status: "", simple_status: "", can_send: false }]
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
      const updated = { ...qaCustomerFinderResult, email_delivery_status: "draft", simple_status: "Письмо подготовлено", can_send: false };
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
    if (apiPath === "/api/workspace-app/companies") return fulfillJson(route, [currentCompany]);
    if (apiPath === `/api/workspace-app/companies/${qaCompany.id}`) return fulfillJson(route, currentCompany);
    if (apiPath === "/api/workspace-app/production-email-smoke-test/active" && route.request().method() === "GET") {
      const email = currentCompany.generated_emails?.[0];
      const tags = email?.tags || {};
      const isSmoke = currentCompany.source === "production_smoke_test" && tags.source === "production_smoke_test" && tags.is_test === true && Boolean(tags.smoke_test_id);
      return fulfillJson(route, {
        status: "success",
        message: isSmoke ? "Active production smoke-test state loaded." : "No active production smoke-test records for this workspace.",
        smoke_test: isSmoke ? {
          smoke_test_id: tags.smoke_test_id,
          workspace_id: "99999999-9999-9999-9999-999999999999",
          workspace_name: String(tags.workspace_name || "QA Private Workspace"),
          sender_email: String(tags.sender_email || "qa.sender@example.com"),
          sender_provider: String(tags.sender_provider || "gmail"),
          recipient_email: String(tags.recipient_email || currentCompany.email || "")
        } : null
      });
    }
    if (apiPath === "/api/workspace-app/internal-email-smoke-draft/config" && route.request().method() === "GET") {
      return fulfillJson(route, { recipient_email: "romaniukvadym10+client-smoke-20260812-1@gmail.com" });
    }
    if (apiPath === "/api/workspace-app/production-email-smoke-test" && route.request().method() === "POST") {
      const body = route.request().postDataJSON() as { recipient_email?: string; confirmed_recipient_control?: boolean };
      if (!body.confirmed_recipient_control) return fulfillJson(route, { detail: "Confirm that you control this recipient email before creating test records." }, 409);
      const recipient = String(body.recipient_email || "").trim().toLowerCase();
      if (!recipient || recipient.endsWith("@example.com")) return fulfillJson(route, { detail: "Use a real recipient email that you control, not a placeholder address." }, 400);
      const smokeTestId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
      const email = {
        ...qaCompany.generated_emails[0],
        id: "aaaaaaaa-1111-4111-8111-aaaaaaaa1111",
        lead_id: "aaaaaaaa-2222-4222-8222-aaaaaaaa2222",
        recipient_email: recipient,
        subject: `[OutreachAI Production Smoke Test] ${smokeTestId}`,
        preview: "Internal owner-only production email smoke test. This is not customer outreach.",
        body: `Internal OutreachAI production email smoke test.\n\nSmoke test ID: ${smokeTestId}\nWorkspace: QA Private Workspace\nSender: qa.sender@example.com via gmail\nRecipient: ${recipient}`,
        delivery_status: "draft",
        tags: {
          source: "production_smoke_test",
          is_test: true,
          automation_disabled: true,
          smoke_test_id: smokeTestId,
          recipient_email: recipient,
          sender_email: "qa.sender@example.com",
          sender_provider: "gmail",
          workspace_name: "QA Private Workspace"
        }
      };
      currentCompany = {
        ...qaCompany,
        id: "aaaaaaaa-3333-4333-8333-aaaaaaaa3333",
        lead_id: email.lead_id,
        name: `Production smoke test ${smokeTestId}`,
        email: recipient,
        source: "production_smoke_test",
        crm_stage: "Internal Test",
        email_status: "Draft Ready",
        generated_emails: [email]
      };
      return fulfillJson(route, {
        status: "success",
        message: "Production email smoke-test draft created. Review, edit, approve, then use a separate final Send confirmation.",
        company: currentCompany,
        email,
        smoke_test: {
          smoke_test_id: smokeTestId,
          workspace_id: "99999999-9999-9999-9999-999999999999",
          workspace_name: "QA Private Workspace",
          sender_email: "qa.sender@example.com",
          sender_provider: "gmail",
          recipient_email: recipient
        }
      });
    }
    if (apiPath === "/api/workspace-app/internal-email-smoke-draft" && route.request().method() === "POST") {
      const body = route.request().postDataJSON() as { recipient_email?: string; confirmed_recipient_control?: boolean };
      if (!body.confirmed_recipient_control) return fulfillJson(route, { detail: "Confirm that you control this recipient email before creating internal test records." }, 409);
      const recipient = String(body.recipient_email || "");
      if (recipient !== "romaniukvadym10+client-smoke-20260812-1@gmail.com") return fulfillJson(route, { detail: "Use the approved controlled internal smoke alias for this smoke test." }, 400);
      const smokeTestId = "bbbbbbbb-1111-4222-8333-bbbbbbbbbbbb";
      const email = {
        ...qaCompany.generated_emails[0],
        id: "bbbbbbbb-1111-4111-8111-bbbbbbbb1111",
        lead_id: "bbbbbbbb-2222-4222-8222-bbbbbbbb2222",
        recipient_email: recipient,
        subject: `[OutreachAI Internal Smoke Draft] ${smokeTestId}`,
        preview: "Internal non-owner smoke-test draft. This is not customer outreach.",
        body: `Internal OutreachAI non-owner smoke-test draft.\n\nSmoke test ID: ${smokeTestId}\nWorkspace: QA Private Workspace\nSender: qa.sender@example.com via gmail\nRecipient: ${recipient}`,
        delivery_status: "draft",
        tags: {
          source: "internal_email_smoke_draft",
          is_test: true,
          automation_disabled: true,
          smoke_test_id: smokeTestId,
          recipient_email: recipient,
          sender_email: "qa.sender@example.com",
          sender_provider: "gmail",
          workspace_name: "QA Private Workspace"
        }
      };
      currentCompany = {
        ...qaCompany,
        id: "bbbbbbbb-3333-4333-8333-bbbbbbbb3333",
        lead_id: email.lead_id,
        name: `Internal email smoke draft ${smokeTestId}`,
        email: recipient,
        source: "internal_email_smoke_draft",
        crm_stage: "Internal Test",
        email_status: "Draft Ready",
        generated_emails: [email]
      };
      return fulfillJson(route, {
        status: "success",
        message: "Internal email smoke draft created. Nothing was sent. Review, edit if needed, approve manually, then use a separate final Send confirmation.",
        company: currentCompany,
        email,
        smoke_test: {
          smoke_test_id: smokeTestId,
          workspace_id: "99999999-9999-9999-9999-999999999999",
          workspace_name: "QA Private Workspace",
          sender_email: "qa.sender@example.com",
          sender_provider: "gmail",
          recipient_email: recipient
        }
      });
    }
    if (apiPath === "/api/workspace-app/production-email-smoke-test/cleanup" && route.request().method() === "POST") {
      const wasSmoke = currentCompany.source === "production_smoke_test";
      currentCompany = qaCompany;
      return fulfillJson(route, {
        status: "success",
        message: wasSmoke ? "Production smoke-test cleanup finished. Only matching test records were affected; send audit history was preserved." : "Production smoke-test cleanup already clean. No matching active test records remain for this workspace.",
        smoke_test: { smoke_test_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", workspace_id: "99999999-9999-9999-9999-999999999999", workspace_name: "QA Private Workspace", sender_email: "", sender_provider: "", recipient_email: "cleanup@invalid.test", cleanup_deleted: wasSmoke ? { leads: 1, companies: 1, drafts: 1, activities: 1 } : { leads: 0, companies: 0, drafts: 0, activities: 0 }, cleanup_already_clean: !wasSmoke }
      });
    }
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
    if (apiPath === "/api/workspace-app/emails/33333333-3333-3333-3333-333333333333/approve") {
      const body = route.request().postData() ? route.request().postDataJSON() as { confirmed_exact_draft?: boolean; sender_email?: string; recipient_email?: string; subject?: string; body?: string } : {};
      if (body.confirmed_exact_draft) {
        const currentEmail = currentCompany.generated_emails?.[0] || qaCompany.generated_emails[0];
        if (body.sender_email !== "qa.sender@example.com" || body.recipient_email !== currentEmail.recipient_email || body.subject !== currentEmail.subject || body.body !== currentEmail.body) {
          return fulfillJson(route, { detail: "The displayed sender, recipient, subject, or body no longer matches this draft. Refresh and confirm again." }, 409);
        }
        ordinarySendConfirmed = true;
      }
      const email = { ...(currentCompany.generated_emails?.[0] || qaCompany.generated_emails[0]), delivery_status: "approved" };
      currentCompany = { ...currentCompany, crm_stage: "Approved", email_approved_at: now, generated_emails: [email] };
      currentFinderJob = {
        ...currentFinderJob,
        results: currentFinderJob.results.map((result: any) =>
          result.email_id === email.id ? { ...result, email_delivery_status: "approved", simple_status: "Письмо подтверждено", can_send: true } : result
        )
      };
      return fulfillJson(route, { status: "success", message: "Email approved. It is ready to send, but nothing was sent automatically.", company: currentCompany, email });
    }
    if (apiPath === "/api/workspace-app/emails/33333333-3333-3333-3333-333333333333" && route.request().method() === "PATCH") {
      const body = route.request().postDataJSON() as Partial<typeof qaCompany.generated_emails[0]>;
      const currentEmail = currentCompany.generated_emails[0];
      const email = { ...currentEmail, ...body, delivery_status: currentEmail.delivery_status === "approved" ? "draft" : currentEmail.delivery_status };
      currentCompany = { ...currentCompany, generated_emails: [email] };
      ordinarySendConfirmed = false;
      return fulfillJson(route, { status: "success", message: currentEmail.delivery_status === "approved" ? "Changes saved. This email is back in draft and must be approved again before sending." : "Email draft saved. Review and approve before sending.", company: currentCompany, email });
    }
    if (apiPath === "/api/workspace-app/emails/33333333-3333-3333-3333-333333333333/send") {
      if (!ordinarySendConfirmed) return fulfillJson(route, { detail: "Confirm the exact sender, recipient, subject, and body before sending." }, 409);
      const email = { ...(currentCompany.generated_emails?.[0] || qaCompany.generated_emails[0]), delivery_status: "sent", sent_at: now, provider_message_id: "mock-provider-1" };
      currentCompany = { ...currentCompany, crm_stage: "Sent", email_sent_at: now, generated_emails: [email] };
      ordinarySendConfirmed = false;
      return fulfillJson(route, { status: "success", message: "Approved email was sent. CRM stage updated.", company: currentCompany, email });
    }
    if (apiPath === "/api/workspace-app/emails/aaaaaaaa-1111-4111-8111-aaaaaaaa1111/approve") {
      const email = { ...currentCompany.generated_emails[0], delivery_status: "approved" };
      currentCompany = { ...currentCompany, generated_emails: [email] };
      return fulfillJson(route, { status: "success", message: "Email approved. It is ready to send, but nothing was sent automatically.", company: currentCompany, email });
    }
    if (apiPath === "/api/workspace-app/emails/aaaaaaaa-1111-4111-8111-aaaaaaaa1111" && route.request().method() === "PATCH") {
      const body = route.request().postDataJSON() as Partial<typeof qaCompany.generated_emails[0]>;
      const currentEmail = currentCompany.generated_emails[0];
      const email = { ...currentEmail, ...body, delivery_status: currentEmail.delivery_status === "approved" ? "draft" : currentEmail.delivery_status };
      currentCompany = { ...currentCompany, generated_emails: [email] };
      return fulfillJson(route, { status: "success", message: "Email draft saved. Review and approve before sending.", company: currentCompany, email });
    }
    if (apiPath === "/api/workspace-app/emails/aaaaaaaa-1111-4111-8111-aaaaaaaa1111/send") {
      const body = route.request().postDataJSON() as { confirmed_send?: boolean; smoke_test_id?: string; recipient_email?: string };
      if (body.confirmed_send !== true || body.smoke_test_id !== "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee") {
        return fulfillJson(route, { detail: "Final send confirmation is required for production smoke-test email." }, 409);
      }
      smokeProviderCalls += 1;
      if (smokeProviderCalls > 1) return fulfillJson(route, { detail: "Provider called more than once." }, 409);
      const email = { ...currentCompany.generated_emails[0], delivery_status: "sent", sent_at: now, provider_message_id: "mock-smoke-provider-1" };
      currentCompany = { ...currentCompany, generated_emails: [email] };
      return fulfillJson(route, { status: "success", message: "Approved email was sent. CRM stage updated.", company: currentCompany, email });
    }
    if (apiPath === "/api/workspace-app/emails/bbbbbbbb-1111-4111-8111-bbbbbbbb1111/approve") {
      const email = { ...currentCompany.generated_emails[0], delivery_status: "approved" };
      currentCompany = { ...currentCompany, crm_stage: "Approved", email_approved_at: now, generated_emails: [email] };
      return fulfillJson(route, { status: "success", message: "Email approved. It is ready to send, but nothing was sent automatically.", company: currentCompany, email });
    }
    if (apiPath === "/api/workspace-app/emails/bbbbbbbb-1111-4111-8111-bbbbbbbb1111" && route.request().method() === "PATCH") {
      const body = route.request().postDataJSON() as Partial<typeof qaCompany.generated_emails[0]>;
      const currentEmail = currentCompany.generated_emails[0];
      const email = { ...currentEmail, ...body, delivery_status: currentEmail.delivery_status === "approved" ? "draft" : currentEmail.delivery_status };
      currentCompany = { ...currentCompany, generated_emails: [email] };
      return fulfillJson(route, { status: "success", message: "Email draft saved. Review and approve before sending.", company: currentCompany, email });
    }
    if (apiPath === "/api/workspace-app/emails/bbbbbbbb-1111-4111-8111-bbbbbbbb1111/send") {
      const body = route.request().postDataJSON() as { confirmed_send?: boolean; smoke_test_id?: string; recipient_email?: string };
      if (body.confirmed_send !== true || body.smoke_test_id !== "bbbbbbbb-1111-4222-8333-bbbbbbbbbbbb") {
        return fulfillJson(route, { detail: "Final send confirmation is required for internal smoke-test email." }, 409);
      }
      const email = { ...currentCompany.generated_emails[0], delivery_status: "sent", sent_at: now, provider_message_id: "mock-internal-smoke-provider-1" };
      currentCompany = { ...currentCompany, crm_stage: "Sent", email_sent_at: now, generated_emails: [email] };
      return fulfillJson(route, { status: "success", message: "Approved email was sent. CRM stage updated.", company: currentCompany, email });
    }
    if (apiPath === "/api/workspace-app/emails/33333333-3333-3333-3333-333333333333/recover") {
      const body = route.request().postDataJSON() as { confirmed_not_delivered?: boolean };
      if (body.confirmed_not_delivered !== true) {
        return fulfillJson(route, { detail: "Confirm that the email is not in Gmail or SMTP Sent before recovering it for retry." }, 409);
      }
      const email = { ...(currentCompany.generated_emails?.[0] || qaCompany.generated_emails[0]), delivery_status: "approved", sent_at: null };
      currentCompany = { ...currentCompany, crm_stage: "Approved", email_approved_at: now, email_sent_at: null, generated_emails: [email] };
      return fulfillJson(route, { status: "success", message: "Interrupted send recovered for retry. Nothing was sent automatically.", company: currentCompany, email });
    }
    if (apiPath === "/api/outreach/sender/status") return fulfillJson(route, {
      provider: "gmail",
      connected: true,
      status: "connected",
      sender_name: "QA Sender",
      sender_email: "qa.sender@example.com",
      mailbox: "qa.sender@example.com",
      reply_to: "qa.sender@example.com",
      daily_send_limit: 10,
      sent_today: 0,
      remaining_today: 10,
      oauth_provider: "gmail",
      oauth_connected: true,
      oauth_status: "connected",
      oauth_mailbox: "qa.sender@example.com",
      oauth_connected_at: now,
      oauth_scopes: ["https://www.googleapis.com/auth/gmail.send", "https://www.googleapis.com/auth/gmail.readonly"],
      oauth_start_ready: true,
      oauth_start_status: "ready",
      oauth_start_reason: "",
      spf_status: "not_checked",
      dkim_status: "not_checked",
      dmarc_status: "not_checked",
      next_action: "Ready to send through the connected Gmail mailbox.",
      reason: "",
      smtp_host: "",
      smtp_port: 587,
      smtp_username: "",
      smtp_configured: false,
      smtp_verified_at: ""
    });
    if (apiPath === "/api/outreach/oauth/gmail/start") return fulfillJson(route, { auth_url: "/dashboard/settings?mail=mock_connected" });
    if (apiPath === "/api/outreach/oauth/gmail/sync") {
      currentInbox = [{
        ...qaCompany.generated_emails[0],
        id: "99999999-9999-9999-9999-999999999999",
        subject: "Re: Quick idea for Hill Country Build Co",
        preview: "Interested. Can you send details?",
        body: "Interested. Can you send details?",
        delivery_status: "replied",
        replied_at: now,
        reply_assistant: {
          classification: "Interested",
          suggested_response: "Reply with the website-specific growth audit outline and propose two times.",
          next_step: "Review and respond manually."
        }
      }];
      currentCompany = { ...currentCompany, crm_stage: "Replied", replied_at: now };
      return fulfillJson(route, { synced: 1, classified: { Interested: 1 } });
    }
    if (apiPath === "/api/outreach/oauth/gmail") return fulfillJson(route, {
      provider: "gmail",
      connected: false,
      status: "needs_setup",
      sender_name: "",
      sender_email: null,
      mailbox: null,
      reply_to: null,
      daily_send_limit: 10,
      sent_today: 0,
      remaining_today: 0,
      oauth_provider: "",
      oauth_connected: false,
      oauth_status: "not_connected",
      oauth_mailbox: null,
      oauth_connected_at: "",
      oauth_scopes: [],
      oauth_start_ready: true,
      oauth_start_status: "ready",
      oauth_start_reason: "",
      spf_status: "not_checked",
      dkim_status: "not_checked",
      dmarc_status: "not_checked",
      next_action: "Click Connect email and approve Gmail access.",
      reason: "Gmail needs secure OAuth setup before sending.",
      smtp_host: "",
      smtp_port: 587,
      smtp_username: "",
      smtp_configured: false,
      smtp_verified_at: ""
    });
    if (apiPath === "/api/dashboard") return fulfillJson(route, { leads: 1, campaigns: 1, emails_sent: 0, delivered: 0, opened: 0, replies: 0, bounces: 0, open_rate: 0, reply_rate: 0, ctr: 0, conversion_rate: 0, meetings: 0, revenue: 0, revenue_forecast: 0, mrr: 0, arr: 0, revenue_series: [], funnel: [], pipeline: [], plan: "Starter", usage: { leads: 1, email_sends: 0 } });
    if (apiPath === "/api/campaigns") {
      if (route.request().method() === "POST") {
        const body = route.request().postDataJSON() as Partial<typeof qaCampaign>;
        currentCampaign = { ...qaCampaign, name: body.name || qaCampaign.name };
        return fulfillJson(route, currentCampaign);
      }
      return fulfillJson(route, [currentCampaign]);
    }
    if (apiPath === `/api/campaigns/${currentCampaign.id}/autopilot/approve`) {
      currentCampaign = { ...currentCampaign, status: "Running", sent: 0, replies: 0 };
      return fulfillJson(route, currentCampaign);
    }
    if (apiPath === `/api/campaigns/${qaCampaign.id}/launch`) {
      currentCampaign = { ...currentCampaign, status: "Running" };
      return fulfillJson(route, currentCampaign);
    }
    if (apiPath === `/api/campaigns/${currentCampaign.id}/pause`) {
      currentCampaign = { ...currentCampaign, status: "Paused" };
      return fulfillJson(route, currentCampaign);
    }
    if (apiPath === `/api/campaigns/${currentCampaign.id}/stop`) {
      currentCampaign = { ...currentCampaign, status: "Stopped" };
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
    if (apiPath === "/api/inbox") {
      const page = inboxPage(currentInbox, url.searchParams);
      return fulfillJson(route, page.body, 200, page.headers);
    }
    if (apiPath === "/api/profile") {
      if (route.request().method() === "PUT") {
        const body = route.request().postDataJSON();
        currentProfile = { ...currentProfile, ...body };
        return fulfillJson(route, currentProfile);
      }
      return fulfillJson(route, currentProfile);
    }
    if (apiPath === "/api/billing/plans" || apiPath === "/api/billing/plan-catalog") return fulfillJson(route, [
      { name: "Starter", price: 49, monthly_price: 49, currency: "EUR", billing_period: "monthly", trial_days: 14, limits: { mrr: 49, leads: 500, ai_generations: 1000, email_sends: 1000, sales_employees: 1, workspaces: 1, team_members: 1, campaigns: 3, review_mode: true, semi_auto_mode: false, autonomous_mode: false, basic_analytics: true, advanced_analytics: false, reply_ai: false, api_access: false, webhooks: false, white_label: false }, features: { manual_approval: true, basic_analytics: true }, reserved_features: { team_members: "unavailable", api_access: "reserved", webhooks: "reserved", white_label: "reserved" }, roadmap_limits: { workspaces: 1, team_members: 1 }, upgrade_to: ["Pro", "Agency"], downgrade_to: [], current: true, active_subscription: true },
      { name: "Pro", price: 149, monthly_price: 149, currency: "EUR", billing_period: "monthly", trial_days: 14, limits: { mrr: 149, leads: 5000, ai_generations: 10000, email_sends: 10000, sales_employees: 3, workspaces: 1, team_members: 1, campaigns: 25, review_mode: true, semi_auto_mode: true, autonomous_mode: false, basic_analytics: true, advanced_analytics: true, reply_ai: true, api_access: false, webhooks: false, white_label: false }, features: { manual_approval: true, semi_auto_mode: true, advanced_analytics: true, reply_ai: true }, reserved_features: { workspaces: "reserved", team_members: "reserved", api_access: "reserved", webhooks: "reserved", white_label: "reserved" }, roadmap_limits: { workspaces: 3, team_members: 10 }, upgrade_to: ["Agency"], downgrade_to: ["Starter"], current: false, active_subscription: true },
      { name: "Agency", price: 499, monthly_price: 499, currency: "EUR", billing_period: "monthly", trial_days: 14, limits: { mrr: 499, leads: 50000, ai_generations: 100000, email_sends: 100000, sales_employees: 10, workspaces: 1, team_members: 1, campaigns: 0, review_mode: true, semi_auto_mode: true, autonomous_mode: true, basic_analytics: true, advanced_analytics: true, reply_ai: true, api_access: false, webhooks: false, white_label: false }, features: { manual_approval: true, semi_auto_mode: true, autonomous_mode: true, advanced_analytics: true, reply_ai: true }, reserved_features: { workspaces: "reserved", team_members: "reserved", campaigns: "reserved", api_access: "reserved", webhooks: "reserved", white_label: "reserved" }, roadmap_limits: { workspaces: 0, team_members: 0, campaigns: 0 }, upgrade_to: [], downgrade_to: ["Starter", "Pro"], current: false, active_subscription: true }
    ]);
    if (apiPath === "/api/billing/status") return fulfillJson(route, { plan: "Starter", price: 49, status: "active", entitlement_source: "stripe", trial_days_remaining: 14, stripe_customer_id: "cus_mock", stripe_subscription_id: "sub_mock", transition: { pending: false }, cancel_at_period_end: false, limits: { leads: 500, email_sends: 1000, ai_generations: 1000, sales_employees: 1, workspaces: 1, team_members: 1, campaigns: 3 }, usage: { leads: 1, email_sends: 0, ai_generations: 3 }, sales_employees_used: 0, workspaces_used: 1 });
    if (apiPath === "/api/billing/subscription/change") {
      if (route.request().method() === "DELETE") return fulfillJson(route, { pending: false, status: "canceled" });
      return fulfillJson(route, { pending: true, from_plan: "Starter", to_plan: "Pro", billing_period: "monthly", direction: "upgrade", status: "pending", effective_at: null });
    }
    if (apiPath === "/api/billing/subscription/cancel") return fulfillJson(route, { cancel_at_period_end: true });
    if (apiPath === "/api/billing/subscription/cancel/undo") return fulfillJson(route, { cancel_at_period_end: false });
    if (apiPath === "/api/billing/usage") return fulfillJson(route, { plan: "Starter", period: "2026-07", limits: { leads: 500, email_sends: 1000, ai_generations: 1000 }, usage: { leads: 1, email_sends: 0, ai_generations: 3 } });
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
