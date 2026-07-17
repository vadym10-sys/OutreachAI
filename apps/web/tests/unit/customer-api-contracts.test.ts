import { describe, expect, it } from "vitest";
import {
  aiWebsiteAnalysisSchema,
  billingInvoicesResponseSchema,
  billingPlansResponseSchema,
  billingStatusSchema,
  billingUsageResponseSchema,
  campaignsResponseSchema,
  companiesResponseSchema,
  companyWorkspaceResponseSchema,
  inboxResponseSchema,
  parseCustomerApiResponse,
  profileResponseSchema,
  workspaceAiSalesAnalysisResponseSchema,
  workspaceAppBootstrapResponseSchema,
  workspaceAppLeadSearchResponseSchema,
  workspaceIntegrationStatusResponseSchema
} from "@/lib/customer-api-contracts";

const company = {
  id: "company_1",
  name: "Acme AI",
  contacts: [],
  generated_emails: [],
  unexpected_backend_field: "kept"
};

const campaign = {
  id: "campaign_1",
  name: "Founder outreach",
  status: "draft"
};

const email = {
  id: "email_1",
  subject: "Intro",
  body: "Hello"
};

describe("customer API contracts", () => {
  it("accepts backward-compatible bootstrap responses with unknown fields", () => {
    const parsed = parseCustomerApiResponse(workspaceAppBootstrapResponseSchema, {
      workspace: { id: "workspace_1", name: "Workspace", company: null, future: true },
      counts: { leads: 1, companies: 1, campaigns: 0, emails: 0, deals: 0 },
      metrics: { leads: 1, future_metric: 42 },
      next_action: "Review priority account",
      recent_companies: [company],
      recent_activity: [{ action: "created", created_at: "2026-07-17T10:00:00Z", message: "Created" }],
      future_field: "ignored by UI"
    }, "bootstrap");

    expect(parsed.workspace.company).toBeNull();
    expect(parsed.recent_companies[0].id).toBe("company_1");
  });

  it("rejects incompatible bootstrap responses with a readable error", () => {
    expect(() => parseCustomerApiResponse(workspaceAppBootstrapResponseSchema, {
      workspace: { id: "workspace_1", name: "Workspace" },
      counts: { leads: 1 },
      next_action: "Review",
      recent_companies: [],
      recent_activity: []
    }, "bootstrap")).toThrow(/Incompatible bootstrap response/);
  });

  it("validates companies and company workspace objects while allowing additive fields", () => {
    expect(parseCustomerApiResponse(companiesResponseSchema, [company], "companies")[0].id).toBe("company_1");
    expect(parseCustomerApiResponse(companyWorkspaceResponseSchema, company, "company workspace").id).toBe("company_1");
  });

  it("validates AI analysis enums, nullable fields, and version history", () => {
    const parsed = parseCustomerApiResponse(workspaceAiSalesAnalysisResponseSchema, {
      status: "success",
      message: "Ready",
      company_id: "company_1",
      analysis: { summary: "Good account" },
      generated_at: null,
      cached: false,
      requested_version: null,
      latest_version: 2,
      available_versions: [{ version: 1, generated_at: null, status: "ready" }]
    }, "AI analysis");

    expect(parsed.available_versions?.[0].generated_at).toBeNull();
    expect(() => parseCustomerApiResponse(workspaceAiSalesAnalysisResponseSchema, {
      status: "done",
      message: "Ready",
      company_id: "company_1",
      analysis: {},
      cached: false
    }, "AI analysis")).toThrow(/status/);
  });

  it("validates lead search status enums and nested integration status", () => {
    expect(parseCustomerApiResponse(workspaceAppLeadSearchResponseSchema, {
      status: "partial_success",
      request_id: "req_1",
      message: "Saved",
      companies_saved: 1,
      duplicates_skipped: 0,
      companies: [company],
      warnings: ["One source timed out"]
    }, "lead search").status).toBe("partial_success");

    expect(parseCustomerApiResponse(workspaceIntegrationStatusResponseSchema, {
      integrations: [{ key: "lead_search", label: "Lead search", status: "needs_setup", message: "Add key" }]
    }, "integrations").integrations[0].status).toBe("needs_setup");
  });

  it("validates campaigns and inbox arrays", () => {
    expect(parseCustomerApiResponse(campaignsResponseSchema, [campaign], "campaigns")[0].id).toBe("campaign_1");
    expect(parseCustomerApiResponse(inboxResponseSchema, [email], "inbox")[0].subject).toBe("Intro");
  });

  it("validates billing plans, usage, invoices, and status nullable fields", () => {
    expect(parseCustomerApiResponse(billingPlansResponseSchema, [{ name: "Pro", price: 149, limits: { leads: 100 }, current: true }], "billing plans")[0].name).toBe("Pro");
    expect(parseCustomerApiResponse(billingUsageResponseSchema, { plan: "Pro", period: "2026-07", limits: { leads: 100 }, usage: { leads: 3 } }, "billing usage").usage.leads).toBe(3);
    expect(parseCustomerApiResponse(billingInvoicesResponseSchema, [{ id: "invoice_1", status: "paid", future: true }], "billing invoices")[0].id).toBe("invoice_1");
    expect(parseCustomerApiResponse(billingStatusSchema, {
      plan: "Pro",
      price: 149,
      status: "active",
      trial_end: null,
      current_period_end: null,
      trial_days_remaining: 0,
      stripe_customer_id: "cus_1",
      stripe_subscription_id: "sub_1",
      limits: { leads: 100, ai: true },
      usage: { leads: 3 },
      sales_employees_used: 1,
      workspaces_used: 1
    }, "billing status").trial_end).toBeNull();
  });

  it("validates profile nullable avatar and rejects missing required fields", () => {
    expect(parseCustomerApiResponse(profileResponseSchema, {
      workspace: "Sales",
      company: "Acme",
      avatar_url: null,
      timezone: "Europe/Warsaw",
      language: "en",
      future: true
    }, "profile").avatar_url).toBeNull();

    expect(() => parseCustomerApiResponse(profileResponseSchema, {
      workspace: "Sales",
      company: "Acme",
      language: "en"
    }, "profile")).toThrow(/timezone/);
  });

  it("validates legacy AI website analysis shape", () => {
    expect(parseCustomerApiResponse(aiWebsiteAnalysisSchema, {
      company: "Acme",
      website: "https://example.com",
      description: "B2B SaaS",
      industry: null,
      niche: "Sales",
      products_services: [],
      services: [],
      technologies: [],
      strengths: [],
      weaknesses: [],
      icp_score: 80,
      summary: "Good fit",
      company_summary: "Good fit",
      suggested_offer: "Pilot",
      outreach_strategy: "Email",
      sales_angle: "Growth",
      expected_reply_rate: "12%",
      recommended_cta: "Book a call"
    }, "AI website analysis").industry).toBeNull();
  });
});
