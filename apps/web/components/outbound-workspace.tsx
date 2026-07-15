"use client";

import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Component, FormEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState, type ButtonHTMLAttributes, type ErrorInfo } from "react";
import * as Sentry from "@sentry/nextjs";
import { AlertTriangle, ArrowRight, BarChart3, Building2, CalendarDays, CheckCircle2, Clock3, Download, ExternalLink, FileText, Globe2, Inbox, Lightbulb, Loader2, Mail, MapPin, MessageSquare, Pause, Phone, Play, Plus, Rocket, Search, Send, ShieldCheck, Sparkles, Target, UserRound, UserRoundSearch } from "lucide-react";
import { useAuthRuntime } from "@/components/app-providers";
import { AppButton, CompanyCardShell, DecisionMakerCardShell, EmptyStateView, ErrorStateView, LoadingStateView, MetricSurface, OpportunityCardShell, PageHero, SectionPanel, TimelineRail } from "@/components/design-system";
import { clientApi, friendlyErrorMessage, splitList, type ClientApiInit } from "@/lib/client-api";
import { isClerkE2EBypass, isProductionRuntime } from "@/lib/env";
import { captureLogRocketException } from "@/lib/logrocket";
import { capturePostHogException, trackEvent } from "@/lib/posthog";
import { useI18n } from "@/lib/i18n/provider";
import type { Locale } from "@/lib/i18n/translations";
import type { Activity, AISalesEmployee, Campaign, CampaignSequence, CrmCompany, CrmContact, CrmDeal, CrmPipeline, DashboardMetrics, Email, FollowUpSequence, Lead, SalesCopilot, WebsiteAudit } from "@/lib/types";

type ApiFn = <T>(path: string, init?: ClientApiInit) => Promise<T>;

type PaginatedLeads = {
  items: Lead[];
  total: number;
  page: number;
  page_size: number;
};

type AnalysisResult = {
  company: string;
  website: string;
  description: string;
  industry?: string | null;
  location?: string | null;
  niche: string;
  products_services: string[];
  services: string[];
  technologies: string[];
  strengths: string[];
  weaknesses: string[];
  icp_score: number;
  summary: string;
  company_summary: string;
  suggested_offer: string;
  outreach_strategy: string;
  sales_angle: string;
  expected_reply_rate: string;
  recommended_cta: string;
};

type LeadSearchPayload = {
  country: string;
  city: string;
  industry: string;
  category: string;
  keyword: string;
  company_size: string;
  keywords: string[];
  technologies: string[];
  radius: number;
  limit: number;
};

type WorkspaceAppLeadSearchResponse = {
  status: "success" | "partial_success" | "empty" | "provider_unavailable" | "timeout" | "error";
  request_id: string;
  message: string;
  companies_saved: number;
  saved_count?: number;
  duplicates_skipped: number;
  companies: CrmCompany[];
  warnings: string[];
};

type WorkspaceAppLeadCommandResponse = WorkspaceAppLeadSearchResponse & {
  filters?: LeadSearchPayload | null;
  interpreted_query?: string;
};

type WorkspaceAppCompanyCreateResponse = {
  status: "created" | "reused";
  message: string;
  company: CrmCompany;
};

type WorkspaceAppActionResponse = {
  status: WorkspaceAppLeadSearchResponse["status"];
  message: string;
  company?: CrmCompany | null;
  email?: Email | null;
  warnings?: string[];
  completed_steps?: string[];
  workflow_stages?: Record<string, string>;
  missing_fields?: string[];
  recommended_actions?: string[];
  next_action?: string;
  job_id?: string;
  job_status?: string;
};

type WorkspaceDeepContactJobStatusResponse = {
  job_id: string;
  job_type: string;
  status: string;
  progress?: {
    stage?: string;
    message?: string;
    percent?: number;
  };
  company?: CrmCompany | null;
};

type WorkspaceAiSalesAnalysis = NonNullable<CrmCompany["ai_sales_workspace"]>;

type WorkspaceAiSalesAnalysisVersion = {
  version: number;
  generated_at?: string | null;
  provider?: string;
  model?: string;
  status?: string;
};

type WorkspaceAiSalesAnalysisResponse = {
  status: "success" | "partial_success" | "empty" | "provider_unavailable" | "timeout" | "error";
  message: string;
  company_id: string;
  analysis: WorkspaceAiSalesAnalysis | Record<string, never>;
  generated_at?: string | null;
  cached: boolean;
  requested_version?: number | null;
  latest_version?: number | null;
  available_versions?: WorkspaceAiSalesAnalysisVersion[];
};

type WorkspaceAiSalesRecommendationActionIn = {
  key: "decision_maker" | "first_message" | "follow_up_sequence" | "best_channel" | "reply_probability" | "deal_success_probability" | "priority_score" | "next_best_action";
  action: "approve" | "edit" | "regenerate";
  value?: unknown;
  reason?: string;
};

type WorkflowStageStatus = "waiting" | "running" | "completed" | "error";

type WorkspaceIntegrationStatus = {
  key: string;
  label: string;
  status: "connected" | "missing_key" | "needs_setup" | "error";
  message: string;
};

type WorkspaceIntegrationStatusResponse = {
  integrations: WorkspaceIntegrationStatus[];
};

type OutreachSenderStatus = {
  provider: string;
  connected: boolean;
  status: "connected" | "missing_key" | "needs_setup" | "error";
  sender_name: string;
  sender_email?: string | null;
  reply_to?: string | null;
  daily_send_limit: number;
  sent_today: number;
  remaining_today: number;
  spf_status: string;
  dkim_status: string;
  dmarc_status: string;
  next_action: string;
  reason?: string;
  smtp_host: string;
  smtp_port: number;
  smtp_username: string;
  smtp_configured: boolean;
  smtp_verified_at?: string;
};

type WorkspaceAppBootstrapResponse = {
  workspace: {
    id: string;
    name: string;
    company?: string | null;
    industry?: string | null;
    target_country?: string | null;
    target_customer?: string | null;
  };
  counts: {
    leads: number;
    companies: number;
    campaigns: number;
    emails: number;
    deals: number;
  };
  metrics?: Partial<DashboardMetrics> & {
    leads?: number;
    companies?: number;
    contacts?: number;
    campaigns?: number;
    emails?: number;
    deals?: number;
  };
  next_action: string;
  recent_companies: CrmCompany[];
  recent_activity: Array<{ action: string; created_at: string; company?: string; message?: string }>;
};

type OpportunityReadiness = {
  total: number;
  researched: number;
  verifiedEmails: number;
  drafts: number;
  ready: number;
};

type EditableDraftFields = Pick<Email, "subject" | "preview" | "body" | "cta" | "follow_up_1" | "follow_up_2">;

const emptyMetrics: DashboardMetrics = {
  leads: 0,
  campaigns: 0,
  emails_sent: 0,
  delivered: 0,
  opened: 0,
  replies: 0,
  bounces: 0,
  open_rate: 0,
  reply_rate: 0,
  ctr: 0,
  conversion_rate: 0,
  meetings: 0,
  revenue: 0,
  revenue_forecast: 0,
  mrr: 0,
  arr: 0,
  revenue_series: [],
  funnel: [],
  pipeline: [],
  plan: "Starter",
  usage: {}
};

const unavailable = "Not found yet. Add it manually or run research.";

const crmStages = [
  "New Lead",
  "Qualified",
  "Website Analyzed",
  "Contact Found",
  "Email Draft Ready",
  "Approved",
  "Sent",
  "Replied",
  "Meeting Scheduled",
  "Won",
  "Lost"
];

const emptyPipeline: CrmPipeline = { stages: crmStages, companies: [], deals: [] };
const dashboardCacheKey = "outreachai.dashboard.lastSuccessfulData";

const salesWorkflow = [
  "Lead Search",
  "CRM",
  "Company Research",
  "Contact Discovery",
  "AI Email",
  "Approval",
  "Send",
  "Reply Tracking",
  "Meeting",
  "Won/Lost"
];

function safeArray<T>(value: T[] | undefined | null): T[] {
  return Array.isArray(value) ? value : [];
}

function safeStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item || "").trim()).filter(Boolean) : [];
}

function uniqueStrings(values: Array<string | undefined | null>) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = String(value || "").trim();
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function leadKey(lead: Lead) {
  return String(lead.crm_company_id || lead.id || lead.place_id || lead.website || lead.domain || `${lead.company}:${lead.city || ""}`).toLowerCase();
}

function mergeLeads(newLeads: Lead[], existingLeads: Lead[]) {
  const seen = new Set<string>();
  const merged: Lead[] = [];
  for (const lead of [...newLeads, ...existingLeads]) {
    const key = leadKey(lead);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(lead);
  }
  return merged;
}

function latestCompanyEmail(company: CrmCompany): Email | undefined {
  return safeArray(company.generated_emails)[0];
}

function editableDraftFields(email?: Email | null): EditableDraftFields {
  return {
    subject: email?.subject || "",
    preview: email?.preview || "",
    body: email?.body || "",
    cta: email?.cta || "",
    follow_up_1: email?.follow_up_1 || "",
    follow_up_2: email?.follow_up_2 || ""
  };
}

function cleanGeneratedText(value?: string | null): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if ((raw.startsWith("{") && raw.endsWith("}")) || (raw.startsWith("[") && raw.endsWith("]"))) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return cleanGeneratedText(parsed[0]);
      if (parsed && typeof parsed === "object") {
        const record = parsed as Record<string, unknown>;
        return cleanGeneratedText(String(record.email || record.body || record.text || record.message || record.subject || ""));
      }
    } catch {
      const emailMatch = raw.match(/['"]email['"]\s*:\s*['"]([\s\S]*?)['"]\s*(?:,\s*['"]|})/);
      if (emailMatch?.[1]) return cleanGeneratedText(emailMatch[1].replace(/\\n/g, "\n").replace(/\\'/g, "'").replace(/\\"/g, '"'));
      const bodyMatch = raw.match(/['"](?:body|text|message)['"]\s*:\s*['"]([\s\S]*?)['"]\s*(?:,\s*['"]|})/);
      if (bodyMatch?.[1]) return cleanGeneratedText(bodyMatch[1].replace(/\\n/g, "\n").replace(/\\'/g, "'").replace(/\\"/g, '"'));
    }
  }
  return raw.replace(/\\n/g, "\n").trim();
}

function contactDisplayName(contact: CrmContact): string {
  return contact.name || contact.title || contact.email || contact.phone || "Decision maker";
}

function contactRoleLine(contact: CrmContact): string {
  if (contact.name && contact.title) return contact.title;
  if (!contact.name && contact.title) return "Name not provided";
  return contact.title || "Role not available";
}

function currentEmailSentAt(company: CrmCompany) {
  const latest = latestCompanyEmail(company);
  if (latest) return latest.delivery_status === "sent" ? (latest.sent_at || company.email_sent_at) : null;
  return company.email_sent_at;
}

function safeCampaign(value: Campaign): Campaign {
  return {
    ...value,
    countries: safeArray(value.countries),
    cities: safeArray(value.cities),
    keywords: safeArray(value.keywords),
    website_filters: safeArray(value.website_filters),
    sequence: safeArray(value.sequence)
  };
}

function safeDashboardMetrics(value: Partial<DashboardMetrics> | undefined | null): DashboardMetrics {
  return {
    ...emptyMetrics,
    ...value,
    revenue_series: safeArray(value?.revenue_series),
    funnel: safeArray(value?.funnel),
    pipeline: safeArray(value?.pipeline),
    usage: value?.usage && typeof value.usage === "object" ? value.usage : {}
  };
}

function normalizePipeline(value: Partial<CrmPipeline> | undefined | null): CrmPipeline {
  return {
    stages: safeArray(value?.stages).length ? safeArray(value?.stages) : crmStages,
    companies: safeArray(value?.companies).map(normalizeCrmCompany),
    deals: safeArray(value?.deals)
  };
}

function metricsFromWorkspaceBootstrap(bootstrap: WorkspaceAppBootstrapResponse, fallback: Partial<DashboardMetrics> | null = null): DashboardMetrics {
  const counts = workspaceBootstrapCounts(bootstrap);
  return safeDashboardMetrics({
    ...fallback,
    leads: counts.leads || counts.companies || fallback?.leads || 0,
    campaigns: counts.campaigns || fallback?.campaigns || 0,
    emails_sent: fallback?.emails_sent || 0,
    pipeline: crmStages.map((stage) => ({
      status: stage,
      count: safeArray(bootstrap.recent_companies).filter((company) => company.crm_stage === stage).length,
      revenue: 0
    })),
    funnel: [
      { status: "Companies", count: counts.companies },
      { status: "Emails", count: counts.emails },
      { status: "Deals", count: counts.deals }
    ]
  });
}

function pipelineFromCompanies(companies: CrmCompany[], deals: CrmDeal[] = []): CrmPipeline {
  return {
    stages: crmStages,
    companies,
    deals
  };
}

function workspaceBootstrapCounts(bootstrap: WorkspaceAppBootstrapResponse) {
  const counts = bootstrap.counts || {
    leads: bootstrap.metrics?.leads || bootstrap.metrics?.companies || 0,
    companies: bootstrap.metrics?.companies || bootstrap.metrics?.leads || 0,
    campaigns: bootstrap.metrics?.campaigns || 0,
    emails: bootstrap.metrics?.emails || bootstrap.metrics?.emails_sent || 0,
    deals: bootstrap.metrics?.deals || 0
  };
  return {
    leads: Number(counts.leads || 0),
    companies: Number(counts.companies || 0),
    campaigns: Number(counts.campaigns || 0),
    emails: Number(counts.emails || 0),
    deals: Number(counts.deals || 0)
  };
}

function normalizeCrmCompany(value: Partial<CrmCompany>): CrmCompany {
  return {
    id: value.id || `${value.name || "company"}-${value.place_id || value.website || "unknown"}`,
    lead_id: value.lead_id || null,
    name: value.name || "Company name unavailable",
    website: value.website || null,
    domain: value.domain || null,
    phone: value.phone || null,
    email: value.email || null,
    address: value.address || null,
    city: value.city || null,
    country: value.country || null,
    industry: value.industry || null,
    google_rating: value.google_rating ?? null,
    place_id: value.place_id || null,
    source: value.source || "workspace",
    ai_summary: value.ai_summary || "",
    pain_points: safeArray(value.pain_points),
    services: safeArray(value.services),
    weaknesses: safeArray(value.weaknesses),
    icp_score: value.icp_score ?? null,
    value_proposition: value.value_proposition || "",
    suggested_offer: value.suggested_offer || "",
    outreach_strategy: value.outreach_strategy || "",
    sales_angle: value.sales_angle || "",
    recommended_cta: value.recommended_cta || "",
    follow_up_strategy: value.follow_up_strategy || "",
    expected_reply_rate: value.expected_reply_rate || "",
    email_status: value.email_status || "Not available",
    crm_stage: value.crm_stage || "New Lead",
    contacts: safeArray(value.contacts),
    deals: safeArray(value.deals),
    notes: safeArray(value.notes),
    activity: safeArray(value.activity),
    generated_emails: safeArray(value.generated_emails),
    created_at: value.created_at || new Date().toISOString(),
    updated_at: value.updated_at || value.created_at || new Date().toISOString(),
    found_at: value.found_at || null,
    saved_to_crm_at: value.saved_to_crm_at || null,
    website_analyzed_at: value.website_analyzed_at || null,
    contact_found_at: value.contact_found_at || null,
    email_generated_at: value.email_generated_at || null,
    email_approved_at: value.email_approved_at || null,
    email_sent_at: value.email_sent_at || null,
    delivered_at: value.delivered_at || null,
    opened_at: value.opened_at || null,
    replied_at: value.replied_at || null,
    last_activity_at: value.last_activity_at || null,
    stage_changed_at: value.stage_changed_at || null,
    contact_search_checked_at: value.contact_search_checked_at || null,
    contact_search_status: value.contact_search_status || null,
    contact_search_message: value.contact_search_message || null,
    decision_maker_roles_searched: safeArray(value.decision_maker_roles_searched).map(String),
    workflow_stages: value.workflow_stages || {},
    workflow_stage_messages: value.workflow_stage_messages || {},
    ai_sales_workspace: value.ai_sales_workspace || null,
    ai_sales_workspace_updated_at: value.ai_sales_workspace_updated_at || null,
    deep_contact_search: value.deep_contact_search || null,
    intelligence_quality: value.intelligence_quality || null,
    company_intelligence: value.company_intelligence || null,
    technologies: safeArray(value.technologies).map(String),
    last_enriched_at: value.last_enriched_at || null
  };
}

function opportunityReadinessFromCompanies(companies: CrmCompany[]): OpportunityReadiness {
  const normalized = companies.map(normalizeCrmCompany);
  const hasVerifiedEmail = (company: CrmCompany) => Boolean(company.email || company.contacts.some((contact) => contact.email));
  return {
    total: normalized.length,
    researched: normalized.filter((company) => Boolean(company.website_analyzed_at || company.ai_summary || company.suggested_offer || company.sales_angle)).length,
    verifiedEmails: normalized.filter(hasVerifiedEmail).length,
    drafts: normalized.filter((company) => Boolean(company.email_generated_at || company.generated_emails.length)).length,
    ready: normalized.filter((company) => Boolean((company.website_analyzed_at || company.ai_summary) && hasVerifiedEmail(company) && (company.email_generated_at || company.generated_emails.length))).length
  };
}

function normalizeAnalysis(value: Partial<AnalysisResult> | undefined | null): AnalysisResult {
  const company = value?.company || "";
  const summary = value?.summary || value?.company_summary || unavailable;
  return {
    company,
    website: value?.website || "",
    description: value?.description || summary,
    industry: value?.industry || null,
    location: value?.location || null,
    niche: value?.niche || unavailable,
    products_services: safeArray(value?.products_services),
    services: safeArray(value?.services),
    technologies: safeArray(value?.technologies),
    strengths: safeArray(value?.strengths),
    weaknesses: safeArray(value?.weaknesses),
    icp_score: typeof value?.icp_score === "number" ? value.icp_score : 0,
    summary,
    company_summary: value?.company_summary || summary,
    suggested_offer: value?.suggested_offer || unavailable,
    outreach_strategy: value?.outreach_strategy || unavailable,
    sales_angle: value?.sales_angle || unavailable,
    expected_reply_rate: value?.expected_reply_rate || unavailable,
    recommended_cta: value?.recommended_cta || unavailable
  };
}

function reportWidgetFailure(error: unknown, area: string, extra: Record<string, unknown> = {}) {
  Sentry.captureException(error, {
    tags: { area },
    extra
  });
  captureLogRocketException(error, { area, ...extra });
  capturePostHogException(error, { area, ...extra });
  trackEvent("widget_failure", { area, ...extra });
}

type CachedDashboardData = {
  metrics: DashboardMetrics;
  leads: Lead[];
  recentCompanies?: CrmCompany[];
  campaigns: Campaign[];
  employees: AISalesEmployee[];
  activity: Activity[];
};

function cacheDashboardData(data: CachedDashboardData) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(dashboardCacheKey, JSON.stringify({ ...data, cached_at: new Date().toISOString() }));
  } catch {
    // Cache is best-effort only.
  }
}

function readCachedDashboardData() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(dashboardCacheKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      metrics?: Partial<DashboardMetrics>;
      leads?: Lead[];
      recentCompanies?: CrmCompany[];
      campaigns?: Campaign[];
      employees?: AISalesEmployee[];
      activity?: Activity[];
      cached_at?: string;
    };
    return {
      metrics: safeDashboardMetrics(parsed.metrics),
      leads: safeArray(parsed.leads),
      recentCompanies: safeArray(parsed.recentCompanies).map(normalizeCrmCompany),
      campaigns: safeArray(parsed.campaigns).map(safeCampaign),
      employees: safeArray(parsed.employees),
      activity: safeArray(parsed.activity),
      cachedAt: parsed.cached_at || null
    };
  } catch {
    return null;
  }
}

class WidgetBoundary extends Component<{ name: string; children: ReactNode; fallback?: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    reportWidgetFailure(error, "dashboard-widget-render", {
      widget: this.props.name,
      component_stack: info.componentStack
    });
  }

  render() {
    if (this.state.failed) {
      return this.props.fallback || <WidgetErrorCard title={`${this.props.name} is temporarily unavailable`} />;
    }
    return this.props.children;
  }
}

function formatDateTime(value?: string | null) {
  if (!value) return "Not recorded yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not recorded yet";
  return date.toLocaleString();
}

function isSessionExpiredError(error: unknown) {
  return error instanceof Error && /sign in again|session has expired/i.test(error.message);
}

function userMessage(error: unknown, fallback: string, t: (key: string) => string) {
  if (isSessionExpiredError(error)) return t("Your session has expired. Please sign in again.");
  return t(friendlyErrorMessage(error, fallback));
}

function leadFinderDebug(step: string, details?: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  const enabled = window.localStorage.getItem("outreachai.leadFinderDebug") === "true" || window.location.search.includes("leadDebug=1");
  if (!enabled) return;
  console.info(step, details || {});
}

function workspaceSearchMessage(result: WorkspaceAppLeadSearchResponse, count: number, t: (key: string) => string) {
  const saved = Number(result.companies_saved ?? 0);
  const duplicates = Number(result.duplicates_skipped ?? 0);
  if (count > 0 && saved === 0 && duplicates > 0) {
    return t("Found companies already in CRM").replace("{count}", String(count));
  }
  if (count > 0 && saved > 0 && duplicates > 0) {
    return t("Found companies added and reused").replace("{count}", String(count)).replace("{saved}", String(saved)).replace("{duplicates}", String(duplicates));
  }
  if (count > 0) return t("Found companies saved to CRM").replace("{count}", String(count));
  if (result.status === "empty") return t("No results. Try a broader city, industry, radius, or fewer filters.");
  if (result.status === "timeout") return t("Lead search timed out. Try a smaller radius or broader filters.");
  if (result.status === "provider_unavailable") return t("Lead search is temporarily unavailable. Please try again later.");
  if (result.status === "partial_success") return t("Partial results were saved. Some data can be completed later.");
  return t("Lead search could not be completed.");
}

function integrationStatusLabel(status: WorkspaceIntegrationStatus["status"]) {
  if (status === "connected") return "Connected";
  if (status === "missing_key") return "Missing key";
  if (status === "needs_setup") return "Needs setup";
  return "Error";
}

function integrationStatusClasses(status: WorkspaceIntegrationStatus["status"]) {
  if (status === "connected") return "border-teal-200 bg-teal-50 text-brand";
  if (status === "missing_key" || status === "needs_setup") return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-red-200 bg-red-50 text-red-700";
}

function integrationRecoveryAction(item: WorkspaceIntegrationStatus) {
  if (item.key === "lead_search" && item.status !== "connected") {
    return { href: "#manual-company", label: "Add company manually" };
  }
  if (item.key === "contact_discovery" && item.status !== "connected") {
    return { href: "/dashboard/companies", label: "Open company workspace" };
  }
  if (item.key === "ai_research" && item.status !== "connected") {
    return { href: "/dashboard/companies", label: "Review saved companies" };
  }
  if (item.key === "email_sending" && item.status !== "connected") {
    return { href: "/dashboard/campaigns", label: "Review campaigns" };
  }
  if (item.key === "billing" && item.status !== "connected") {
    return { href: "/dashboard/billing", label: "Open billing" };
  }
  return null;
}

function redirectToSignIn() {
  if (typeof window === "undefined" || isClerkE2EBypass) return;
  const redirectUrl = encodeURIComponent(`${window.location.pathname}${window.location.search}`);
  window.location.assign(`/sign-in?redirect_url=${redirectUrl}`);
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function devApi<T>(path: string, init: ClientApiInit = {}) {
  return clientApi<T>(path, "dev", init);
}

function useClerkTokenApi(clerkEnabled: boolean) {
  if (!clerkEnabled || isClerkE2EBypass) {
    return {
      getToken: async () => isClerkE2EBypass ? "dev" : null,
      isLoaded: !clerkEnabled || isClerkE2EBypass,
      isSignedIn: isClerkE2EBypass
    };
  }
  // The no-Clerk branch above is required for local/E2E builds where ClerkProvider is intentionally not mounted.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useAuth();
}

function useTokenApi(): { api: ApiFn; ready: boolean } {
  const { clerkEnabled } = useAuthRuntime();
  const { getToken, isLoaded, isSignedIn } = useClerkTokenApi(clerkEnabled);
  const disabledApi = useCallback(async () => {
    redirectToSignIn();
    throw new Error("Please sign in again before continuing.");
  }, []);
  const getFreshToken = useCallback(async () => {
    let token = await getToken({ skipCache: true });
    for (let attempt = 0; !token && attempt < 20; attempt += 1) {
      await delay(100);
      token = await getToken({ skipCache: true });
    }
    return token;
  }, [getToken]);
  const api = useCallback(async function api<T>(path: string, init: ClientApiInit = {}) {
    if (!isLoaded || !isSignedIn) throw new Error("Please sign in again before continuing.");
    const token = await getFreshToken();
    if (!token) throw new Error("Please sign in again before continuing.");
    return clientApi<T>(path, token, init);
  }, [getFreshToken, isLoaded, isSignedIn]);

  if ((!clerkEnabled && !isProductionRuntime) || isClerkE2EBypass) {
    return { api: devApi, ready: true };
  }
  if (!clerkEnabled) {
    return { api: disabledApi, ready: false };
  }
  return { api, ready: isLoaded && Boolean(isSignedIn) };
}

function parseNotes(notes?: string | null) {
  if (!notes) return {};
  const firstLine = notes.split("\n")[0]?.trim() || "";
  if (!firstLine.startsWith("{")) return {};
  try {
    const parsed = JSON.parse(firstLine) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function text(value: unknown, fallback = unavailable) {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        window.clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function leadWebsite(lead: Lead) {
  return lead.website || (lead.domain ? `https://${lead.domain}` : "");
}

function hasCompanyContext(lead: Lead) {
  return Boolean(lead.company || leadWebsite(lead) || lead.industry || lead.niche || lead.city || lead.country || lead.address);
}

function fallbackIcpScore(lead: Lead, metadata: Record<string, unknown>) {
  const rawScore = lead.icp_score ?? metadata.icp_score;
  if (typeof rawScore === "number" && Number.isFinite(rawScore)) return rawScore;
  if (!hasCompanyContext(lead)) return null;
  let score = 35;
  if (leadWebsite(lead)) score += 15;
  if (lead.industry || lead.niche || lead.business_category) score += 15;
  if (lead.city || lead.country || lead.address) score += 10;
  if (lead.email && lead.hunter_verified) score += 15;
  if (lead.ai_summary || safeArray(lead.pain_points).length || safeArray(lead.services).length) score += 10;
  return Math.min(score, 85);
}

function fallbackWebsiteAnalysis(lead: Lead) {
  if (!hasCompanyContext(lead)) return unavailable;
  if (leadWebsite(lead)) return "Website is saved. Run company research to extract services, weak points and personalization facts.";
  return "Basic company profile is saved. Add a website to unlock deeper AI research.";
}

function fallbackPainAnalysis(lead: Lead) {
  return hasCompanyContext(lead)
    ? "Likely pain points: manual prospecting, weak website conversion and missed follow-ups. Run AI research to verify this for the company."
    : unavailable;
}

function fallbackOpportunityAnalysis(lead: Lead) {
  return hasCompanyContext(lead)
    ? "Recommended angle: connect your offer to the company's market, website gaps and local growth goals before outreach."
    : unavailable;
}

function fallbackOffer(lead: Lead) {
  return hasCompanyContext(lead)
    ? "Offer a short audit and one practical improvement the company can review before booking a call."
    : unavailable;
}

function fallbackExpectedReplyRate(lead: Lead) {
  if (!hasCompanyContext(lead)) return unavailable;
  return lead.email && lead.hunter_verified
    ? "Estimated 6-12% after verified contact and personalized review."
    : "Estimated 4-8% until a verified decision maker is added.";
}

function leadProfile(lead: Lead) {
  const metadata = parseNotes(lead.notes);
  const painPoints = safeArray(lead.pain_points).length ? safeArray(lead.pain_points) : safeStringArray(metadata.pain_points);
  const weaknesses = safeArray(lead.weaknesses).length ? safeArray(lead.weaknesses) : safeStringArray(metadata.weaknesses);
  const services = safeArray(lead.services).length ? safeArray(lead.services) : safeStringArray(metadata.services);
  const valueProposition = lead.value_proposition || text(metadata.value_proposition, "");
  const recommendedCta = lead.recommended_cta || text(metadata.recommended_cta, "");
  return {
    company: lead.company,
    website: leadWebsite(lead) || unavailable,
    industry: lead.industry || lead.niche || unavailable,
    location: lead.address || [lead.city, lead.country].filter(Boolean).join(", ") || unavailable,
    size: lead.employee_count || lead.revenue_range || unavailable,
    sizeUnit: lead.employee_count ? "employees" : "",
    decisionMaker: [lead.contact, lead.title].filter(Boolean).join(", ") || "Decision maker not found yet",
    verifiedEmail: lead.email || (lead.hunter_status === "no_verified_email" ? "No verified email yet" : "Verified email not found yet"),
    phone: lead.phone || unavailable,
    linkedin: lead.linkedin || unavailable,
    websiteAnalysis: lead.ai_summary || text(metadata.ai_summary, "") || fallbackWebsiteAnalysis(lead),
    painAnalysis: painPoints.join(", ") || weaknesses.join(", ") || text(metadata.website_audit_actions, "") || fallbackPainAnalysis(lead),
    opportunityAnalysis: lead.sales_angle || lead.outreach_strategy || valueProposition || text(metadata.sales_angle || metadata.outreach_strategy, "") || fallbackOpportunityAnalysis(lead),
    offer: lead.suggested_offer || recommendedCta || text(metadata.suggested_offer, "") || fallbackOffer(lead),
    expectedReplyRate: lead.expected_reply_rate || text(metadata.expected_reply_rate, "") || fallbackExpectedReplyRate(lead),
    services: services.join(", "),
    icpScore: fallbackIcpScore(lead, metadata),
    source: lead.source || text(metadata.source)
  };
}

function contactSearchDetails(lead: Lead) {
  const metadata = parseNotes(lead.notes);
  const roles = Array.isArray(metadata.decision_maker_roles_searched) ? metadata.decision_maker_roles_searched.map((role) => text(role)).filter(Boolean) : [];
  const status = text(metadata.contact_search_status || lead.hunter_status);
  return {
    checked: Boolean(metadata.contact_search_checked_at || status),
    status,
    message: text(metadata.contact_search_message),
    roles
  };
}

function draftHasFollowUps(draft?: Email) {
  if (!draft) return false;
  const text = [draft.follow_up_1, draft.follow_up_2, draft.body].filter(Boolean).join(" ").toLowerCase();
  return /follow[- ]?up|повторн|касани|relance|seguimiento|follow-up/i.test(text);
}

function parseReplyRate(value: string) {
  const matches = value.match(/\d+(?:[.,]\d+)?/g);
  if (!matches?.length) return null;
  const values = matches.map((item) => Number(item.replace(",", "."))).filter((item) => Number.isFinite(item));
  if (!values.length) return null;
  return Math.round(values.reduce((sum, item) => sum + item, 0) / values.length);
}

type LeadAiFilterKey = "high_opportunity" | "buying_intent" | "ready_to_contact" | "needs_review" | "high_confidence" | "missing_data";

function leadOpportunityScoreForWorkspace(lead: Lead) {
  const direct = typeof lead.icp_score === "number" && Number.isFinite(lead.icp_score) ? lead.icp_score : null;
  const replyRate = parseReplyRate(String(lead.expected_reply_rate || ""));
  const emailReady = safeArray(lead.generated_emails).length ? 8 : 0;
  const researched = lead.ai_summary ? 10 : 0;
  const withFallback = direct ?? (replyRate ? Math.round(replyRate * 4.5) : 44);
  return Math.max(0, Math.min(100, Math.round(withFallback + emailReady + researched)));
}

function leadPriorityTierFromScore(score: number) {
  if (score >= 75) return "Hot";
  if (score >= 45) return "Warm";
  return "Cold";
}

function leadBuyingIntentForWorkspace(lead: Lead) {
  const replyRate = parseReplyRate(String(lead.expected_reply_rate || ""));
  const opportunity = leadOpportunityScoreForWorkspace(lead);
  const intentKeywords = [
    String(lead.outreach_strategy || ""),
    String(lead.sales_angle || ""),
    String(lead.ai_summary || ""),
    String(lead.notes || "")
  ].join(" ").toLowerCase();
  const keywordBoost = /(hiring|funding|expansion|urgent|active|priority|growth)/.test(intentKeywords) ? 10 : 0;
  const score = Math.round((replyRate ?? 38) * 0.55 + opportunity * 0.45 + keywordBoost);
  return Math.max(0, Math.min(100, score));
}

function leadConfidenceForWorkspace(lead: Lead) {
  const opportunity = leadOpportunityScoreForWorkspace(lead);
  const replyRate = parseReplyRate(String(lead.expected_reply_rate || "")) ?? 35;
  const verification = lead.email ? 12 : 0;
  const score = Math.round(opportunity * 0.5 + replyRate * 0.35 + verification);
  return Math.max(0, Math.min(100, score));
}

function leadReplyProbabilityForWorkspace(lead: Lead) {
  const parsed = parseReplyRate(String(lead.expected_reply_rate || ""));
  if (parsed !== null) return Math.max(1, Math.min(100, parsed));
  return Math.max(1, Math.min(100, Math.round(leadBuyingIntentForWorkspace(lead) * 0.45 + leadConfidenceForWorkspace(lead) * 0.35)));
}

function leadTopPainPointForWorkspace(lead: Lead) {
  return safeArray(lead.pain_points)[0] || safeArray(lead.weaknesses)[0] || String(lead.ai_summary || "").split(".")[0] || "Missing explicit pain point; review before sending.";
}

function leadTopOpportunityForWorkspace(lead: Lead) {
  return String(lead.sales_angle || lead.outreach_strategy || lead.suggested_offer || lead.value_proposition || "").trim() || "Opportunity angle is still being prepared from available company data.";
}

function leadSummaryForWorkspace(lead: Lead) {
  return String(lead.ai_summary || "").trim() || "AI summary is still loading from saved company signals.";
}

function leadDecisionMakerForWorkspace(lead: Lead) {
  const value = [lead.contact, lead.title].filter(Boolean).join(" - ").trim();
  return value || "Decision maker not verified yet";
}

function leadRecommendedActionForWorkspace(lead: Lead) {
  if (!lead.email) return "Review contact data before sending.";
  if (!safeArray(lead.generated_emails).length) return "Review AI strategy and prepare email.";
  const latest = safeArray(lead.generated_emails)[0];
  if (latest?.delivery_status === "approved") return "Contact now with approved email.";
  if (latest?.delivery_status === "sent") return "Open company and schedule follow-up.";
  return "Review email and approve next step.";
}

function leadMissingDataForWorkspace(lead: Lead) {
  return !lead.website || !lead.ai_summary || !lead.contact || !lead.email;
}

function leadReadyToContactForWorkspace(lead: Lead) {
  return Boolean(lead.email && safeArray(lead.generated_emails).length);
}

function leadMatchesAiFilter(lead: Lead, filter: LeadAiFilterKey) {
  const opportunity = leadOpportunityScoreForWorkspace(lead);
  const intent = leadBuyingIntentForWorkspace(lead);
  const confidence = leadConfidenceForWorkspace(lead);
  if (filter === "high_opportunity") return opportunity >= 75;
  if (filter === "buying_intent") return intent >= 60;
  if (filter === "ready_to_contact") return leadReadyToContactForWorkspace(lead);
  if (filter === "needs_review") return opportunity < 75 || leadMissingDataForWorkspace(lead);
  if (filter === "high_confidence") return confidence >= 70;
  return leadMissingDataForWorkspace(lead);
}

function opportunityCoverage(lead: Lead, copilot?: SalesCopilot, draft?: Email, followUps?: FollowUpSequence, audit?: WebsiteAudit) {
  const profile = leadProfile(lead);
  const noOpenFollowUps = safeArray(followUps?.no_open);
  const openedFollowUps = safeArray(followUps?.opened);
  const repliedFollowUps = safeArray(followUps?.replied);
  const clickedFollowUps = safeArray(followUps?.clicked);
  return [
    ["Company profile", Boolean(lead.company && (lead.website || lead.domain || lead.industry || lead.country))],
    ["Website analysis", profile.websiteAnalysis !== unavailable || Boolean(audit?.improvement_report)],
    ["Decision makers", Boolean(lead.contact || lead.title)],
    ["Verified emails", Boolean(lead.email && lead.hunter_verified)],
    ["AI pain analysis", Boolean(profile.painAnalysis && profile.painAnalysis !== unavailable) || Boolean(audit?.priority_actions?.length)],
    ["AI opportunity analysis", Boolean(profile.opportunityAnalysis && profile.opportunityAnalysis !== unavailable) || Boolean(copilot?.reasoning?.length)],
    ["Personalized offer", Boolean(profile.offer && profile.offer !== unavailable)],
    ["Personalized first email", Boolean(draft?.subject && draft.body)],
    ["Follow-up sequence", Boolean(followUps && (noOpenFollowUps.length || openedFollowUps.length || repliedFollowUps.length || clickedFollowUps.length)) || draftHasFollowUps(draft)],
    ["Confidence score", Boolean(copilot) || Boolean(typeof profile.icpScore === "number" && profile.icpScore > 0) || parseReplyRate(profile.expectedReplyRate) !== null],
    ["Expected reply rate", Boolean(profile.expectedReplyRate && profile.expectedReplyRate !== unavailable) || Boolean(copilot)],
    ["Priority score", Boolean(copilot) || Boolean(typeof profile.icpScore === "number" && profile.icpScore > 0) || Boolean(draft?.subject && profile.expectedReplyRate !== unavailable)]
  ] as const;
}

function opportunityCoverageHint(label: string) {
  const hints: Record<string, string> = {
    "Company profile": "Save the company with website, industry and location.",
    "Website analysis": "Run company research to analyze the website.",
    "Decision makers": "Find contacts or add a decision maker manually.",
    "Verified emails": "Run contact discovery or add a verified email before sending.",
    "AI pain analysis": "Run AI research to identify likely customer pains.",
    "AI opportunity analysis": "Run AI research to find the strongest sales angle.",
    "Personalized offer": "Run AI research to prepare a concrete offer.",
    "Personalized first email": "Complete sales research to generate the first email.",
    "Follow-up sequence": "Generate the email draft to prepare follow-ups.",
    "Confidence score": "Research the company to calculate confidence.",
    "Expected reply rate": "Generate outreach to estimate reply rate.",
    "Priority score": "Complete research and email draft to calculate priority."
  };
  return hints[label] || "Complete sales research to fill this step.";
}

function formatEstimatedRevenue(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? `€${value.toLocaleString()}` : "Not confirmed";
}

function opportunityDataFacts(lead: Lead, profile: ReturnType<typeof leadProfile>, t: (key: string) => string) {
  return [
    { label: "Website", value: profile.website, ready: profile.website !== unavailable },
    { label: "Industry", value: profile.industry, ready: profile.industry !== unavailable },
    { label: "Location", value: profile.location, ready: profile.location !== unavailable },
    { label: "Company size", value: String(profileSizeText(profile, t)), ready: profile.size !== unavailable },
    { label: "Phone", value: profile.phone, ready: profile.phone !== unavailable },
    { label: "Google rating", value: lead.google_rating ? `${lead.google_rating}/5` : unavailable, ready: Boolean(lead.google_rating) },
    { label: "Decision maker", value: profile.decisionMaker, ready: profile.decisionMaker !== unavailable },
    { label: "Verified email", value: profile.verifiedEmail, ready: Boolean(lead.email && lead.hunter_verified) },
    { label: "Source", value: sourceLabel(profile.source), ready: profile.source !== unavailable }
  ];
}

function dataCollectionSummaryFromFacts(facts: Array<{ label: string; value: string; ready: boolean }>, t: (key: string) => string) {
  const found = facts.filter((fact) => fact.ready).map((fact) => t(fact.label));
  const missing = facts.filter((fact) => !fact.ready).map((fact) => t(fact.label));
  return {
    found,
    missing,
    foundText: found.length ? found.slice(0, 4).join(", ") + (found.length > 4 ? ` +${found.length - 4}` : "") : t("Nothing verified yet"),
    missingText: missing.length ? missing.slice(0, 4).join(", ") + (missing.length > 4 ? ` +${missing.length - 4}` : "") : t("No critical gaps")
  };
}

function opportunityNextStep(lead: Lead, draft?: Email) {
  if (!lead.crm_company_id) {
    return {
      title: "Save this company to CRM",
      copy: "Save the company first so research, contacts and emails stay in your private workspace."
    };
  }
  if (!draft) {
    return {
      title: "Complete sales research",
      copy: "Analyze the website, find contacts and prepare the first email in one guided step."
    };
  }
  if (draft.delivery_status === "approved") {
    return {
      title: "Send the approved email when you are ready.",
      copy: "Review the recipient, confirm the send, and OutreachAI will update CRM automatically."
    };
  }
  if (draft.delivery_status === "sent") {
    return {
      title: "Watch for replies and follow up from the inbox.",
      copy: "Track delivery, replies and the next CRM stage from this company workspace."
    };
  }
  return {
    title: "Review and approve the prepared email.",
    copy: "Read the draft, adjust it if needed, then approve it before any sending can happen."
  };
}

function profileSizeText(profile: ReturnType<typeof leadProfile>, t: (key: string) => string) {
  if (profile.size === unavailable) return t("Company size not available");
  return profile.sizeUnit ? `${profile.size} ${t(profile.sizeUnit)}` : profile.size;
}

function PageHeader({ eyebrow, title, copy, action }: { eyebrow: string; title: string; copy: string; action?: React.ReactNode }) {
  const { t } = useI18n();
  const translatedTitle = t(title);
  return (
    <PageHero eyebrow={t(eyebrow)} title={translatedTitle} copy={t(copy)} action={action} />
  );
}

function PrimaryButton({ children, type = "button", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { children: React.ReactNode }) {
  return <AppButton type={type} {...props}>{children}</AppButton>;
}

function SecondaryButton({ children, type = "button", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { children: React.ReactNode }) {
  return <AppButton type={type} variant="secondary" {...props}>{children}</AppButton>;
}

function EmptyState({ title, copy, action }: { title: string; copy: string; action?: React.ReactNode }) {
  const { t } = useI18n();
  return <EmptyStateView title={t(title)} copy={t(copy)} action={action} />;
}

function WidgetErrorCard({ title, copy = "This section could not update. The rest of your workspace is still available.", onRetry }: { title: string; copy?: string; onRetry?: () => void }) {
  const { t } = useI18n();
  return <ErrorStateView title={t(title)} copy={t(copy)} onRetry={onRetry} />;
}

function MetricCard({ label, value, help }: { label: string; value: string; help: string }) {
  const { t } = useI18n();
  return <MetricSurface label={t(label)} value={value} detail={t(help)} />;
}

function ActionPanel({ eyebrow, title, copy, children }: { eyebrow: string; title: string; copy: string; children: ReactNode }) {
  const { t } = useI18n();
  return <SectionPanel eyebrow={t(eyebrow)} title={t(title)} copy={t(copy)}>{children}</SectionPanel>;
}

function LoadingSkeleton({ title = "Loading workspace" }: { title?: string }) {
  const { t } = useI18n();
  return <LoadingStateView title={t(title)} />;
}

function WorkflowTracker({ activeStep, completedSteps }: { activeStep: string; completedSteps: string[] }) {
  const { t } = useI18n();
  return <TimelineRail items={salesWorkflow.map((step) => t(step))} activeStep={t(activeStep)} completedSteps={completedSteps.map((step) => t(step))} eyebrow={t("Sales workflow")} title={t("One path from prospect to customer.")} />;
}

function dashboardNextStep(metrics: DashboardMetrics, leads: Lead[], campaigns: Campaign[]) {
  if (!leads.length && metrics.leads === 0) {
    return {
      step: "Lead Search",
      title: "Find your first qualified companies",
      copy: "Start with one narrow market. OutreachAI will save real companies to CRM and prepare the next sales step.",
      href: "/dashboard/leads",
      label: "Find leads"
    };
  }
  const leadNeedingResearch = leads.find((lead) => !lead.ai_summary || !lead.email_generated_at) || leads[0];
  if (leadNeedingResearch) {
    return {
      step: leadNeedingResearch.ai_summary ? "AI Email" : "Company Research",
      title: "Complete company research",
      copy: "Turn the saved company into a complete opportunity: research, contacts, AI email, follow-ups and approval.",
      href: "/dashboard/companies",
      label: "Review opportunity"
    };
  }
  if (!campaigns.length && metrics.campaigns === 0) {
    return {
      step: "Approval",
      title: "Create a campaign from approved opportunities",
      copy: "Build a short sequence, review each message, and keep sending blocked until you approve it.",
      href: "/dashboard/campaigns",
      label: "Create campaign"
    };
  }
  if (metrics.replies > 0 || metrics.meetings > 0) {
    return {
      step: metrics.meetings > 0 ? "Meeting" : "Reply Tracking",
      title: metrics.meetings > 0 ? "Work the meetings created by outreach" : "Review replies and move opportunities forward",
      copy: "Keep CRM stages current so the dashboard reflects what needs attention today.",
      href: "/dashboard/crm",
      label: "Open CRM"
    };
  }
  return {
    step: "Approval",
    title: "Review the next approved action",
    copy: "Check saved opportunities and approve only the outreach that is ready for a real prospect.",
    href: "/dashboard/companies",
    label: "Review opportunities"
  };
}

function completedWorkflowSteps(metrics: DashboardMetrics, leads: Lead[], campaigns: Campaign[]) {
  const steps = new Set<string>();
  if (metrics.leads > 0 || leads.length > 0) {
    steps.add("Lead Search");
    steps.add("CRM");
  }
  if (leads.some((lead) => lead.ai_summary || lead.website_analyzed_at)) steps.add("Company Research");
  if (leads.some((lead) => lead.email || lead.contact || lead.contact_found_at)) steps.add("Contact Discovery");
  if (leads.some((lead) => lead.email_generated_at) || campaigns.some((campaign) => campaign.sequence.length > 0)) steps.add("AI Email");
  if (leads.some((lead) => lead.email_approved_at)) steps.add("Approval");
  if (metrics.emails_sent > 0 || leads.some((lead) => lead.email_sent_at)) steps.add("Send");
  if (metrics.replies > 0 || leads.some((lead) => lead.replied_at)) steps.add("Reply Tracking");
  if (metrics.meetings > 0) steps.add("Meeting");
  if (metrics.conversion_rate > 0) steps.add("Won/Lost");
  return Array.from(steps);
}

const coreCustomerActions = [
  ["Find leads", "Search one focused market.", "/dashboard/leads"],
  ["Open company", "Review the best saved opportunity.", "/dashboard/companies"],
  ["Prepare email", "Turn company research into a reviewed email.", "/dashboard/companies"],
  ["Approve", "Send only after approval.", "/dashboard/campaigns"]
] as const;

function CoreActionGrid({ activeHref }: { activeHref?: string }) {
  const { t } = useI18n();
  return (
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {coreCustomerActions.map(([title, copy, href], index) => {
        const active = activeHref === href || (!activeHref && index === 0);
        return (
          <Link
            key={title}
            href={href}
            className={`min-w-0 rounded-2xl border p-4 shadow-sm transition hover:-translate-y-0.5 ${
              active ? "border-teal-300 bg-teal-50 text-brand" : "border-slate-200 bg-white text-slate-700 hover:border-teal-200"
            }`}
          >
            <span className="grid size-9 place-items-center rounded-xl bg-white text-sm font-black shadow-sm">{index + 1}</span>
            <h3 className="mt-3 text-base font-black text-ink">{t(title)}</h3>
            <p className="mt-1 text-sm leading-6 text-slate-600">{t(copy)}</p>
          </Link>
        );
      })}
    </section>
  );
}

function useSalesData() {
  const { api, ready } = useTokenApi();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [metrics, setMetrics] = useState<DashboardMetrics>(emptyMetrics);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    if (!ready) return;
    setLoading(true);
    setError("");
    try {
      const results = await Promise.allSettled([
        api<WorkspaceAppBootstrapResponse>("/api/workspace-app/bootstrap"),
        api<Campaign[]>("/api/campaigns"),
        api<DashboardMetrics>("/api/dashboard")
      ]);
      const [bootstrapResult, campaignResult, dashboardResult] = results;
      if (bootstrapResult.status === "fulfilled") {
        const companies = safeArray(bootstrapResult.value.recent_companies).map(normalizeCrmCompany);
        setLeads(companies.map(leadFromCrmCompany));
        setMetrics(metricsFromWorkspaceBootstrap(bootstrapResult.value, dashboardResult.status === "fulfilled" ? dashboardResult.value : null));
      } else if (dashboardResult.status === "fulfilled") {
        setMetrics(safeDashboardMetrics(dashboardResult.value));
      }
      if (campaignResult.status === "fulfilled") setCampaigns(safeArray(campaignResult.value).map(safeCampaign));

      const failed = results.filter((result) => result.status === "rejected") as PromiseRejectedResult[];
      if (failed.length) {
        if (failed.some((result) => isSessionExpiredError(result.reason))) {
          redirectToSignIn();
          return;
        }
        failed.forEach((result) => reportWidgetFailure(result.reason, "sales-workspace-loader", { endpoint_group: "leads-campaigns-dashboard" }));
        if (bootstrapResult.status === "rejected" && campaignResult.status === "rejected" && dashboardResult.status === "rejected") {
          setError(friendlyErrorMessage(bootstrapResult.reason, "Workspace data could not be loaded. Please try again."));
        }
      }
    } catch (err) {
        if (isSessionExpiredError(err)) {
          redirectToSignIn();
          return;
        }
        reportWidgetFailure(err, "sales-workspace-loader", { endpoint_group: "leads-campaigns-dashboard" });
        setError(friendlyErrorMessage(err, "Could not load sales workspace data. Please try again."));
    } finally {
      setLoading(false);
    }
  }, [api, ready]);

  useEffect(() => {
    // Initial synchronization with the backend; state updates happen asynchronously inside refresh.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  return { api, ready, leads, setLeads, campaigns, setCampaigns, metrics, loading, error, refresh };
}

function IntegrationStatusPanel({ api, ready }: { api: ApiFn; ready: boolean }) {
  const { t } = useI18n();
  const [integrations, setIntegrations] = useState<WorkspaceIntegrationStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function loadStatus() {
      if (!ready) return;
      setLoading(true);
      setError("");
      try {
        const response = await api<WorkspaceIntegrationStatusResponse>("/api/workspace-app/integrations/status");
        if (!cancelled) setIntegrations(safeArray(response.integrations));
      } catch (err) {
        if (!cancelled) setError(userMessage(err, "Integration status is temporarily unavailable. Core CRM data is still available.", t));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadStatus();
    return () => {
      cancelled = true;
    };
  }, [api, ready, t]);

  if (loading) {
    return (
      <WidgetBoundary name="Integration status">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="h-20 animate-pulse rounded-xl bg-slate-100" />
        </section>
      </WidgetBoundary>
    );
  }

  if (error) {
    return (
      <WidgetBoundary name="Integration status">
        <WidgetErrorCard title={t("Lead Finder setup is temporarily unavailable")} copy={error} />
      </WidgetBoundary>
    );
  }

  const leadSearch = integrations.find((item) => item.key === "lead_search");
  const leadSearchReady = leadSearch?.status === "connected";
  const connectedCount = integrations.filter((item) => item.status === "connected").length;

  return (
    <WidgetBoundary name="Integration status">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-bold uppercase text-brand">{t("Lead Finder setup")}</p>
            <h2 className="mt-1 text-xl font-bold text-ink">{t(leadSearchReady ? "Ready to find companies" : "Add the search key or add a company manually")}</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">{t(leadSearchReady ? "Your company search is connected. Start with one narrow market and save results to CRM." : "Company search needs a key before automatic search works. You can still add a company manually and continue with CRM, analysis and outreach.")}</p>
          </div>
          <span className={`w-fit shrink-0 rounded-full border px-3 py-1 text-xs font-bold ${integrationStatusClasses(leadSearch?.status || "missing_key")}`}>{t(leadSearchReady ? "Connected" : "Key needed")}</span>
        </div>
        <div className="mt-4 flex flex-col gap-3 min-[430px]:flex-row">
          <Link href={leadSearchReady ? "#lead-search-form" : "#manual-company"} className="inline-flex min-h-11 items-center justify-center rounded-xl bg-brand px-4 text-sm font-black text-white shadow-sm">{t(leadSearchReady ? "Start search" : "Add company manually")}</Link>
        </div>
        <details className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <summary className="cursor-pointer text-sm font-bold text-slate-700">{t("Show setup details")} · {connectedCount}/{integrations.length}</summary>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {integrations.map((item) => {
              const action = integrationRecoveryAction(item);
              return (
                <article key={item.key} className="rounded-xl border border-slate-200 bg-white p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-bold text-ink">{t(item.label)}</h3>
                    <span className={`rounded-full border px-2.5 py-1 text-xs font-bold ${integrationStatusClasses(item.status)}`}>{t(integrationStatusLabel(item.status))}</span>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{t(item.message)}</p>
                  {action && (
                    <Link href={action.href} className="mt-3 inline-flex min-h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-3 text-xs font-black text-ink shadow-sm">
                      {t(action.label)}
                    </Link>
                  )}
                </article>
              );
            })}
          </div>
        </details>
      </section>
    </WidgetBoundary>
  );
}

function useCrmData() {
  const { api, ready } = useTokenApi();
  const [companies, setCompanies] = useState<CrmCompany[]>([]);
  const [contacts, setContacts] = useState<CrmContact[]>([]);
  const [deals, setDeals] = useState<CrmDeal[]>([]);
  const [pipeline, setPipeline] = useState<CrmPipeline>(emptyPipeline);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState({ search: "", city: "", country: "", industry: "", stage: "", email_status: "", source: "" });

  const queryString = useMemo(() => {
    const query = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value.trim()) query.set(key, value.trim());
    });
    return query.toString();
  }, [filters]);

  const refresh = useCallback(async () => {
    if (!ready) return;
    setLoading(true);
    setError("");
    try {
      const suffix = queryString ? `?${queryString}` : "";
      const results = await Promise.allSettled([
        api<CrmCompany[]>(`/api/workspace-app/companies${suffix}`),
        api<CrmContact[]>(`/api/crm/contacts${suffix}`),
        api<CrmDeal[]>(`/api/crm/deals${suffix}`),
        api<CrmPipeline>("/api/crm/pipeline")
      ]);
      const [companyResult, contactResult, dealResult, pipelineResult] = results;
      const workspaceCompanies = companyResult.status === "fulfilled" ? safeArray(companyResult.value).map(normalizeCrmCompany) : null;
      if (workspaceCompanies) setCompanies(workspaceCompanies);
      if (contactResult.status === "fulfilled") setContacts(safeArray(contactResult.value));
      if (dealResult.status === "fulfilled") setDeals(safeArray(dealResult.value));
      if (pipelineResult.status === "fulfilled") setPipeline(normalizePipeline(pipelineResult.value));
      else if (workspaceCompanies) setPipeline(pipelineFromCompanies(workspaceCompanies, dealResult.status === "fulfilled" ? safeArray(dealResult.value) : []));

      const failed = results.filter((result) => result.status === "rejected") as PromiseRejectedResult[];
      if (failed.length) {
        if (failed.some((result) => isSessionExpiredError(result.reason))) {
          redirectToSignIn();
          return;
        }
        failed.forEach((result) => reportWidgetFailure(result.reason, "crm-workspace-loader", { endpoint_group: "companies-contacts-deals-pipeline" }));
        if (companyResult.status === "rejected" && contactResult.status === "rejected" && dealResult.status === "rejected" && pipelineResult.status === "rejected") {
          setError(friendlyErrorMessage(companyResult.reason, "CRM data could not be loaded. Please try again."));
        }
      }
    } catch (err) {
        if (isSessionExpiredError(err)) {
          redirectToSignIn();
          return;
        }
        reportWidgetFailure(err, "crm-workspace-loader", { endpoint_group: "companies-contacts-deals-pipeline" });
        setError(friendlyErrorMessage(err, "CRM data could not be loaded. Please try again."));
    } finally {
      setLoading(false);
    }
  }, [api, queryString, ready]);

  useEffect(() => {
    // Initial CRM synchronization with the backend; state updates happen asynchronously inside refresh.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!ready || !hasActiveEnrichment(companies)) return;
    const timer = window.setInterval(() => {
      void refresh();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [companies, ready, refresh]);

  return { api, companies, contacts, deals, pipeline, loading, error, filters, setFilters, refresh };
}

function useDashboardData() {
  const { api, ready } = useTokenApi();
  const [metrics, setMetrics] = useState<DashboardMetrics>(emptyMetrics);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [recentCompanies, setRecentCompanies] = useState<CrmCompany[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [employees, setEmployees] = useState<AISalesEmployee[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [supportingError, setSupportingError] = useState("");
  const [cachedAt, setCachedAt] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    async function loadDashboard() {
      setLoading(true);
      setError("");
      setSupportingError("");
      const slowDashboardTimer = window.setTimeout(() => {
        if (cancelled) return;
        setLoading(false);
        setSupportingError("Some dashboard details are temporarily unavailable. Your core workspace is still loaded.");
      }, 4500);
      const cached = readCachedDashboardData();
      if (cached && !cancelled) {
        setMetrics(cached.metrics);
        setLeads(cached.leads);
        setRecentCompanies(safeArray(cached.recentCompanies));
        setCampaigns(cached.campaigns);
        setEmployees(cached.employees);
        setActivity(cached.activity);
        setCachedAt(cached.cachedAt);
        setLoading(false);
        setSupportingError("Updating workspace data. Showing your last loaded dashboard while the latest data refreshes.");
      }
      try {
        const bootstrap = await api<WorkspaceAppBootstrapResponse>("/api/workspace-app/bootstrap");
        if (cancelled) return;
        const bootstrapCompanies = safeArray(bootstrap.recent_companies).map(normalizeCrmCompany);
        const bootstrapLeads = bootstrapCompanies.map(leadFromCrmCompany);
        const nextMetrics = metricsFromWorkspaceBootstrap(bootstrap);
        setMetrics(nextMetrics);
        setLeads(bootstrapLeads);
        setRecentCompanies(bootstrapCompanies);
        setCachedAt(null);
        setSupportingError("");

        const results = await Promise.allSettled([
          api<DashboardMetrics>("/api/dashboard"),
          api<Campaign[]>("/api/campaigns"),
          api<AISalesEmployee[]>("/api/sales-employees"),
          api<Activity[]>("/api/activity")
        ]);
        if (cancelled) return;
        const [dashboardResult, campaignResult, employeeResult, activityResult] = results;
        const refreshedMetrics = dashboardResult.status === "fulfilled" ? metricsFromWorkspaceBootstrap(bootstrap, dashboardResult.value) : nextMetrics;
        const nextCampaigns = campaignResult.status === "fulfilled" ? safeArray(campaignResult.value).map(safeCampaign) : null;
        const nextEmployees = employeeResult.status === "fulfilled" ? safeArray(employeeResult.value) : null;
        const nextActivity = activityResult.status === "fulfilled" ? safeArray(activityResult.value) : null;
        setMetrics(refreshedMetrics);
        if (nextCampaigns) setCampaigns(nextCampaigns);
        if (nextEmployees) setEmployees(nextEmployees);
        if (nextActivity) setActivity(nextActivity);
        if (nextCampaigns && nextEmployees && nextActivity) {
          cacheDashboardData({
            metrics: refreshedMetrics,
            leads: bootstrapLeads,
            recentCompanies: bootstrapCompanies,
            campaigns: nextCampaigns,
            employees: nextEmployees,
            activity: nextActivity
          });
        }

        const failed = results.filter((result) => result.status === "rejected") as PromiseRejectedResult[];
        if (failed.length) {
          failed.forEach((result) => reportWidgetFailure(result.reason, "dashboard-supporting-data", { endpoint_group: "dashboard-campaigns-employees-activity" }));
          const firstFailure = failed[0]?.reason;
          setSupportingError(friendlyErrorMessage(firstFailure, "Some dashboard details are temporarily unavailable. Your core workspace is still loaded."));
        } else {
          setSupportingError("");
        }
      } catch (err) {
        reportWidgetFailure(err, "dashboard-critical-data", { endpoint: "/api/workspace-app/bootstrap" });
        if (isSessionExpiredError(err)) {
          redirectToSignIn();
          return;
        }
        if (!cached && !cancelled) {
          setSupportingError(friendlyErrorMessage(err, "Dashboard is temporarily unavailable. You can still use Lead Finder, CRM, Campaigns, Billing and Settings."));
        }
      } finally {
        window.clearTimeout(slowDashboardTimer);
        if (!cancelled) setLoading(false);
      }
    }
    void loadDashboard();
    return () => {
      cancelled = true;
    };
  }, [api, ready]);

  return { metrics, leads, recentCompanies, campaigns, employees, activity, loading, error, supportingError, cachedAt };
}

function OpportunityCard({
  lead,
  api,
  onLeadUpdated,
  onCompanyUpdated,
  initialDraft,
  onOpenWorkflow
}: {
  lead: Lead;
  api: ApiFn;
  onLeadUpdated?: (lead: Lead) => void;
  onCompanyUpdated?: (company: CrmCompany) => void;
  initialDraft?: Email | null;
  onOpenWorkflow?: (companyId: string) => void;
}) {
  const { t } = useI18n();
  const savedDraft = initialDraft || lead.generated_emails?.[0] || null;
  const [copilot, setCopilot] = useState<SalesCopilot | undefined>();
  const [audit, setAudit] = useState<WebsiteAudit | undefined>();
  const [followUps, setFollowUps] = useState<FollowUpSequence | undefined>();
  const [draft, setDraft] = useState<Email | undefined>(() => savedDraft || undefined);
  const [editingDraft, setEditingDraft] = useState(false);
  const [draftFields, setDraftFields] = useState<EditableDraftFields>(() => editableDraftFields(savedDraft || undefined));
  const [savingDraft, setSavingDraft] = useState(false);
  const [readyToSend, setReadyToSend] = useState(() => Boolean(savedDraft && savedDraft.delivery_status !== "approved" && savedDraft.delivery_status !== "sent"));
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendConfirmOpen, setSendConfirmOpen] = useState(false);
  const [senderStatus, setSenderStatus] = useState<OutreachSenderStatus | null>(null);
  const [senderLoading, setSenderLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [aiNextAction, setAiNextAction] = useState("");
  const [aiRecommendedActions, setAiRecommendedActions] = useState<string[]>([]);
  const [aiMissingFields, setAiMissingFields] = useState<string[]>([]);
  const [salesAnalysis, setSalesAnalysis] = useState<WorkspaceAiSalesAnalysis | null>(null);
  const [salesAnalysisLoading, setSalesAnalysisLoading] = useState(false);
  const [salesAnalysisError, setSalesAnalysisError] = useState("");
  const [salesAnalysisVersions, setSalesAnalysisVersions] = useState<WorkspaceAiSalesAnalysisVersion[]>([]);
  const [salesAnalysisRequestedVersion, setSalesAnalysisRequestedVersion] = useState<number | null>(null);
  const [salesAnalysisLatestVersion, setSalesAnalysisLatestVersion] = useState<number | null>(null);
  const [salesRecommendationBusyKey, setSalesRecommendationBusyKey] = useState("");
  const [salesRecommendationEditKey, setSalesRecommendationEditKey] = useState("");
  const [salesRecommendationEditValue, setSalesRecommendationEditValue] = useState("");
  const [salesRecommendationEditReason, setSalesRecommendationEditReason] = useState("");
  const profile = leadProfile(lead);
  const coverage = opportunityCoverage(lead, copilot, draft, followUps, audit);
  const completed = coverage.filter(([, done]) => done).length;
  const missingCoverage = coverage.filter(([, done]) => !done).map(([label]) => label);
  const visibleStatus = status;
  const companyId = lead.crm_company_id || null;
  const nextStep = opportunityNextStep(lead, draft);
  const contactSearch = contactSearchDetails(lead);
  const contactNeedsManualStep = !lead.email && (contactSearch.checked || lead.hunter_status === "no_verified_email");
  const dataFacts = opportunityDataFacts(lead, profile, t);
  const dataSummary = dataCollectionSummaryFromFacts(dataFacts, t);
  const leadDecisionReason = copilot?.fit_reason || safeArray(copilot?.reasoning)[0] || profile.opportunityAnalysis || profile.painAnalysis || profile.websiteAnalysis || "Potential fit is not proven yet; verify the company website and decision maker before spending sales time.";
  const riskToCheck = copilot?.risk_to_check || dataSummary.missingText;
  const bestNextAction = copilot?.next_best_action || nextStep.title;
  const salesDecisionCards = [
    { label: "Why this lead matters", value: leadDecisionReason, tone: "teal" },
    { label: "Known now", value: dataSummary.foundText, tone: "slate" },
    { label: "Needs review", value: riskToCheck, tone: dataSummary.missing.length || copilot?.risk_to_check ? "amber" : "teal" },
    { label: "Best next action", value: bestNextAction, tone: "ink" }
  ];
  const summaryParts = [profile.industry, profile.location, profile.size !== unavailable ? profileSizeText(profile, t) : ""].filter((item) => item && item !== unavailable);
  const recipientEmail = String(lead.email || "").trim();
  const opportunityScore = leadOpportunityScoreForWorkspace(lead);
  const priorityTier = leadPriorityTierFromScore(opportunityScore);
  const buyingIntent = leadBuyingIntentForWorkspace(lead);
  const confidence = leadConfidenceForWorkspace(lead);
  const topPainPoint = leadTopPainPointForWorkspace(lead);
  const topOpportunity = leadTopOpportunityForWorkspace(lead);
  const aiSummary = leadSummaryForWorkspace(lead);
  const decisionMaker = leadDecisionMakerForWorkspace(lead);
  const recommendedAction = leadRecommendedActionForWorkspace(lead);
  const contactNowHref = recipientEmail ? `mailto:${recipientEmail}` : (companyId ? `#contacts-${companyId}` : "#manual-company");
  const reviewEmailHref = companyId ? `#outreach-${companyId}` : "#lead-search-form";
  const openCompanyHref = companyId ? `/dashboard/companies?company=${companyId}` : "/dashboard/companies";

  function applySalesAnalysisResult(result: WorkspaceAiSalesAnalysisResponse) {
    const next = result.analysis && Object.keys(result.analysis).length ? (result.analysis as WorkspaceAiSalesAnalysis) : null;
    setSalesAnalysis(next);
    setSalesAnalysisError("");
    setSalesAnalysisVersions(Array.isArray(result.available_versions) ? result.available_versions : []);
    setSalesAnalysisRequestedVersion(result.requested_version ?? next?.version ?? null);
    setSalesAnalysisLatestVersion(result.latest_version ?? next?.version ?? null);
  }

  function applySalesAnalysisFromCompany(company: CrmCompany | null | undefined) {
    const next = company?.ai_sales_workspace && Object.keys(company.ai_sales_workspace).length
      ? (company.ai_sales_workspace as WorkspaceAiSalesAnalysis)
      : null;
    if (!next) return;
    setSalesAnalysis(next);
    setSalesAnalysisError("");
    setSalesAnalysisRequestedVersion(next.version ?? null);
    setSalesAnalysisLatestVersion(next.version ?? null);
    setSalesAnalysisVersions((current) => {
      if (!next.version) return current;
      const existing = current.filter((item) => item.version !== next.version);
      return [{ version: next.version, generated_at: next.generated_at, provider: next.provider, model: next.model, status: "ready" }, ...existing];
    });
  }

  async function loadSalesAnalysis(version: number | null = null) {
    if (!companyId) return;
    setSalesAnalysisLoading(true);
    try {
      const suffix = version ? `?version=${version}` : "";
      const result = await withTimeout(
        api<WorkspaceAiSalesAnalysisResponse>(`/api/workspace-app/companies/${companyId}/ai-sales-analysis${suffix}`),
        12000,
        "AI sales analysis is temporarily unavailable."
      );
      applySalesAnalysisResult(result);
    } catch (err) {
      if (isSessionExpiredError(err)) {
        redirectToSignIn();
        return;
      }
      const reason = friendlyErrorMessage(err, "AI sales analysis could not be loaded.");
      setSalesAnalysisError(t(reason));
    } finally {
      setSalesAnalysisLoading(false);
    }
  }

  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    async function loadCachedAnalysis() {
      try {
        setSalesAnalysisLoading(true);
        const result = await withTimeout(api<WorkspaceAiSalesAnalysisResponse>(`/api/workspace-app/companies/${companyId}/ai-sales-analysis`), 12000, "AI sales analysis is temporarily unavailable.");
        if (cancelled) return;
        applySalesAnalysisResult(result);
      } catch (err) {
        if (cancelled) return;
        if (isSessionExpiredError(err)) {
          redirectToSignIn();
          return;
        }
        const reason = friendlyErrorMessage(err, "AI sales analysis could not be loaded.");
        setSalesAnalysisError(t(reason));
      } finally {
        if (!cancelled) setSalesAnalysisLoading(false);
      }
    }
    void loadCachedAnalysis();
    return () => {
      cancelled = true;
    };
  }, [api, companyId, t]);

  async function runSalesAnalysis(force = false) {
    if (!companyId) {
      setError(t("Save this company to CRM before running AI sales analysis."));
      return;
    }
    setSalesAnalysisLoading(true);
    setSalesAnalysisError("");
    setError("");
    setStatus(force ? t("Refreshing AI sales analysis...") : t("Generating AI sales analysis..."));
    try {
      const result = await withTimeout(
        api<WorkspaceAiSalesAnalysisResponse>(`/api/workspace-app/companies/${companyId}/ai-sales-analysis`, {
          method: "POST",
          body: JSON.stringify({ force })
        }),
        20000,
        "AI sales analysis could not be generated."
      );
      applySalesAnalysisResult(result);
      setStatus(t(result.message || "AI sales analysis generated."));
    } catch (err) {
      if (isSessionExpiredError(err)) {
        redirectToSignIn();
        return;
      }
      const reason = friendlyErrorMessage(err, "AI sales analysis could not be generated.");
      setError(t(reason));
      setSalesAnalysisError(t(reason));
      setStatus("");
    } finally {
      setSalesAnalysisLoading(false);
    }
  }

  async function updateSalesRecommendation(payload: WorkspaceAiSalesRecommendationActionIn) {
    if (!companyId) return;
    const busyKey = `${payload.key}:${payload.action}`;
    setSalesRecommendationBusyKey(busyKey);
    setSalesAnalysisError("");
    setError("");
    setStatus(t("Updating AI recommendation..."));
    try {
      const result = await withTimeout(
        api<WorkspaceAiSalesAnalysisResponse>(`/api/workspace-app/companies/${companyId}/ai-sales-analysis/recommendations`, {
          method: "POST",
          body: JSON.stringify(payload)
        }),
        20000,
        "AI recommendation could not be updated."
      );
      applySalesAnalysisResult(result);
      setStatus(t(result.message || "AI recommendation updated."));
      setSalesRecommendationEditKey("");
      setSalesRecommendationEditValue("");
      setSalesRecommendationEditReason("");
    } catch (err) {
      if (isSessionExpiredError(err)) {
        redirectToSignIn();
        return;
      }
      const reason = friendlyErrorMessage(err, "AI recommendation could not be updated.");
      setError(t(reason));
      setSalesAnalysisError(t(reason));
      setStatus("");
    } finally {
      setSalesRecommendationBusyKey("");
    }
  }

  function recommendationValueToText(value: unknown): string {
    if (Array.isArray(value)) return value.map((item) => String(item || "")).filter(Boolean).join("\n");
    if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      return [String(record.name || ""), String(record.title || record.recommended_role || ""), String(record.email || "")]
        .filter(Boolean)
        .join(" | ");
    }
    return String(value || "");
  }

  function recommendationTextToValue(key: WorkspaceAiSalesRecommendationActionIn["key"], value: string): unknown {
    const raw = value.trim();
    if (key === "follow_up_sequence") return raw ? raw.split("\n").map((item) => item.trim()).filter(Boolean) : [];
    if (key === "reply_probability" || key === "deal_success_probability" || key === "priority_score") {
      const parsed = Number(raw);
      return Number.isFinite(parsed) ? Math.max(0, Math.min(100, Math.round(parsed))) : 0;
    }
    return raw;
  }

  const salesAnalysisUiState = salesAnalysisLoading
    ? t("Generating")
    : salesAnalysis
      ? t("Completed")
      : salesAnalysisError
        ? t("Failed")
        : t("Not generated");

  const salesRecommendationPriorityScore = salesAnalysis?.lead_priority_score ?? salesAnalysis?.ai_lead_score ?? salesAnalysis?.opportunity_score ?? 0;
  const salesRecommendationPriorityTier = salesAnalysis?.lead_priority_tier || (salesRecommendationPriorityScore >= 75 ? "Hot" : salesRecommendationPriorityScore >= 45 ? "Warm" : "Cold");
  const salesRecommendationPriorityTone = salesRecommendationPriorityTier === "Hot"
    ? "bg-rose-500/15 text-rose-200 ring-1 ring-inset ring-rose-400/40"
    : salesRecommendationPriorityTier === "Warm"
      ? "bg-amber-500/15 text-amber-100 ring-1 ring-inset ring-amber-400/40"
      : "bg-sky-500/15 text-sky-100 ring-1 ring-inset ring-sky-400/40";
  const salesRecommendationBuyingIntent = salesAnalysis?.buying_probability ?? salesAnalysis?.buying_intent_score ?? 0;
  const salesRecommendationReplyProbability = salesAnalysis?.estimated_reply_probability ?? 0;
  const salesRecommendationConfidence = salesAnalysis?.confidence_score ?? 0;
  const salesRecommendationIcPFit = salesAnalysis?.icp_fit_score ?? salesAnalysis?.ai_lead_score ?? salesAnalysis?.opportunity_score ?? 0;
  const salesRecommendationDecisionMaker = salesAnalysis?.decision_maker?.title || salesAnalysis?.recommended_decision_maker_role || unavailable;
  const salesRecommendationDecisionMakerName = salesAnalysis?.decision_maker?.name || salesAnalysis?.recommended_decision_maker_role || unavailable;
  const salesRecommendationSignals = (salesAnalysis?.buying_signals || []).slice(0, 4);
  const salesRecommendationRisks = ((salesAnalysis?.predicted_objections && salesAnalysis.predicted_objections.length ? salesAnalysis.predicted_objections : salesAnalysis?.why_may_not_fit) || []).slice(0, 4);
  const salesRecommendationFollowUps = (salesAnalysis?.personalized_follow_up_sequence || []).slice(0, 4);
  const salesRecommendationConfidenceExplanation = salesAnalysis?.score_explanation || (salesAnalysis?.reasoning || [])[0] || salesAnalysis?.summary || unavailable;
  const salesRecommendationOpeningMessage = salesAnalysis?.recommended_first_message || salesAnalysis?.personalized_opening_line || salesAnalysis?.best_outreach_angle || unavailable;
  const salesRecommendationNextAction = salesAnalysis?.recommended_next_action || salesAnalysis?.next_action || unavailable;
  const salesRecommendationBestChannel = salesAnalysis?.best_communication_channel || unavailable;
  const salesRecommendationBestTiming = salesAnalysis?.best_timing_to_contact || unavailable;
  const salesRecommendationActions: Record<string, any> = salesAnalysis?.recommendation_actions && typeof salesAnalysis.recommendation_actions === "object"
    ? salesAnalysis.recommendation_actions
    : {};
  const salesCopilotPanel: Record<string, any> = salesAnalysis?.ai_copilot_panel && typeof salesAnalysis.ai_copilot_panel === "object"
    ? salesAnalysis.ai_copilot_panel
    : {};
  const salesRecommendationRows: Array<{ key: WorkspaceAiSalesRecommendationActionIn["key"]; label: string; value: unknown; helper: string }> = [
    { key: "decision_maker", label: "Best decision maker", value: salesRecommendationActions.decision_maker?.value ?? salesRecommendationDecisionMaker, helper: "Who should receive the first outreach" },
    { key: "first_message", label: "Personalized first message", value: salesRecommendationActions.first_message?.value ?? salesRecommendationOpeningMessage, helper: "Opening line adapted to this company" },
    { key: "follow_up_sequence", label: "Follow-up sequence", value: salesRecommendationActions.follow_up_sequence?.value ?? salesRecommendationFollowUps, helper: "Multi-step cadence after first touch" },
    { key: "best_channel", label: "Best outreach channel", value: salesRecommendationActions.best_channel?.value ?? salesRecommendationBestChannel, helper: "Channel with strongest expected response" },
    { key: "reply_probability", label: "Reply probability", value: salesRecommendationActions.reply_probability?.value ?? salesRecommendationReplyProbability, helper: "Estimated chance of getting a response" },
    { key: "deal_success_probability", label: "Deal success probability", value: salesRecommendationActions.deal_success_probability?.value ?? salesRecommendationBuyingIntent, helper: "Estimated chance to move to deal progress" },
    { key: "priority_score", label: "Priority score", value: salesRecommendationActions.priority_score?.value ?? salesRecommendationPriorityScore, helper: "Priority for execution order" },
    { key: "next_best_action", label: "Next best action", value: salesRecommendationActions.next_best_action?.value ?? salesRecommendationNextAction, helper: "Safest immediate step to take" },
  ];

  async function loadSenderStatusForSend(): Promise<OutreachSenderStatus | null> {
    setSenderLoading(true);
    try {
      const next = await withTimeout(
        api<OutreachSenderStatus>("/api/outreach/sender/status"),
        12000,
        "Email sending setup could not be checked. Please try again."
      );
      setSenderStatus(next);
      return next;
    } catch (err) {
      const reason = friendlyErrorMessage(err, "Email sending setup could not be checked. Please try again.");
      setError(t(reason));
      setStatus("");
      trackEvent("email_sender_status_failed", {
        lead_id: lead.id,
        company: lead.company,
        reason
      });
      return null;
    } finally {
      setSenderLoading(false);
    }
  }

  async function completeResearch() {
    if (!companyId) {
      setError(t("Save this company to CRM before running AI research."));
      return;
    }
    setBusy(true);
    setReadyToSend(false);
    setDraft(undefined);
    setSendConfirmOpen(false);
    setError("");
    setAiNextAction("");
    setAiRecommendedActions([]);
    setAiMissingFields([]);
    trackEvent("sales_research_started", {
      lead_id: lead.id,
      company: lead.company,
      has_website: Boolean(lead.website || lead.domain)
    });
    try {
      setStatus(t("AI enrichment is running automatically"));
      const result = await withTimeout(
        api<WorkspaceAppActionResponse>(`/api/workspace-app/companies/${companyId}/enrichment/restart`, { method: "POST", timeoutMs: 15000 }),
        16000,
        "AI enrichment could not be restarted. The company stays saved in CRM."
      );
      setAiNextAction(result.next_action || "");
      setAiRecommendedActions(safeArray(result.recommended_actions).filter((item): item is string => Boolean(item)));
      setAiMissingFields(safeArray(result.missing_fields).filter((item): item is string => Boolean(item)));
      if (result.company) {
        const updatedCompany = normalizeCrmCompany(result.company);
        applySalesAnalysisFromCompany(updatedCompany);
        onCompanyUpdated?.(updatedCompany);
        onLeadUpdated?.(leadFromCrmCompany(updatedCompany));
        void loadSalesAnalysis();
      }
      setStatus(t(result.message || "AI enrichment restarted. This card will update as data arrives."));
      trackEvent("sales_research_queued", {
        lead_id: lead.id,
        company: lead.company
      });
    } catch (err) {
      if (isSessionExpiredError(err)) {
        redirectToSignIn();
        return;
      }
      const reason = friendlyErrorMessage(err, "AI enrichment could not be restarted. The company stays saved in CRM.");
      setReadyToSend(false);
      setError(reason);
      setStatus("");
      trackEvent("sales_research_failed", {
        lead_id: lead.id,
        company: lead.company,
        reason
      });
    } finally {
      setBusy(false);
    }
  }

  async function approveDraft() {
    if (!draft?.id) {
      setError(t("Generate and review the email before approving a send."));
      return;
    }
    setSending(true);
    setError("");
    setStatus(t("Approving email..."));
    try {
      const approved = await withTimeout(
        api<WorkspaceAppActionResponse>(`/api/workspace-app/emails/${draft.id}/approve`, { method: "POST" }),
        15000,
        "Email approval timed out. Please try again before sending."
      );
      if (!approved.email) {
        throw new Error(approved.message || "Email approval could not be completed.");
      }
      setDraft(approved.email);
      setReadyToSend(false);
      setSendConfirmOpen(false);
      setStatus(t("Email approved. Nothing was sent yet."));
      if (approved.company) {
        const updatedCompany = normalizeCrmCompany(approved.company);
        onCompanyUpdated?.(updatedCompany);
        onLeadUpdated?.(leadFromCrmCompany(updatedCompany));
      } else {
        onLeadUpdated?.({ ...lead, email_approved_at: new Date().toISOString() });
      }
      trackEvent("email_draft_approved", {
        lead_id: lead.id,
        email_id: draft.id,
        company: lead.company
      });
    } catch (err) {
      const reason = friendlyErrorMessage(err, "Email approval could not be completed. Check the draft and try again.");
      setError(reason);
      setStatus("");
      trackEvent("email_draft_approval_failed", {
        lead_id: lead.id,
        email_id: draft.id,
        company: lead.company,
        reason
      });
    } finally {
      setSending(false);
    }
  }

  async function saveDraftEdits() {
    if (!draft?.id) {
      setError(t("Generate the email before editing it."));
      return;
    }
    if (draft.delivery_status === "approved" || draft.delivery_status === "sent") {
      setError(t("Edit the draft before approval. Approved or sent emails stay locked for safety."));
      return;
    }
    setSavingDraft(true);
    setError("");
    setStatus(t("Saving email edits..."));
    try {
      const updated = await withTimeout(
        api<Email>(`/api/emails/${draft.id}`, {
          method: "PATCH",
          body: JSON.stringify(draftFields)
        }),
        15000,
        "Email edits could not be saved. Please try again."
      );
      setDraft(updated);
      setDraftFields(editableDraftFields(updated));
      setEditingDraft(false);
      setReadyToSend(true);
      setStatus(t("Email edits saved. Review and approve when ready."));
      trackEvent("email_draft_edited", {
        lead_id: lead.id,
        email_id: draft.id,
        company: lead.company
      });
    } catch (err) {
      const reason = friendlyErrorMessage(err, "Email edits could not be saved. Please try again.");
      setError(t(reason));
      setStatus("");
      trackEvent("email_draft_edit_failed", {
        lead_id: lead.id,
        email_id: draft.id,
        company: lead.company,
        reason
      });
    } finally {
      setSavingDraft(false);
    }
  }

  async function sendApprovedEmail(confirmed = false) {
    if (!draft?.id || draft.delivery_status !== "approved") {
      setError(t("Approve the draft before sending."));
      return;
    }
    if (!recipientEmail) {
      setError(t("AI has not found a recipient email yet. Find a contact or add an email manually before sending."));
      setStatus(t("The email draft is still saved for review."));
      return;
    }
    if (!confirmed) {
      const sender = await loadSenderStatusForSend();
      if (!sender?.connected) {
        setSendConfirmOpen(false);
        setError(t(sender?.next_action || sender?.reason || "Connect your sending email in Settings before sending."));
        setStatus(t("The approved draft is saved. Connect your sender email, then send it from this card."));
        return;
      }
      setSendConfirmOpen(true);
      setError("");
      setStatus(t("Review recipient before sending. Nothing has been sent yet."));
      return;
    }
    setSending(true);
    setError("");
    setStatus(t("Sending approved email..."));
    try {
      const sender = senderStatus?.connected ? senderStatus : await loadSenderStatusForSend();
      if (!sender?.connected) {
        throw new Error(sender?.next_action || sender?.reason || "Connect your sending email in Settings before sending.");
      }
      const sentResult = await withTimeout(
        api<WorkspaceAppActionResponse>(`/api/workspace-app/emails/${draft.id}/send`, { method: "POST" }),
        30000,
        "Email sending timed out. Please try again before approving another send."
      );
      if (!sentResult.email || sentResult.status !== "success") {
        throw new Error(sentResult.message || "Email could not be sent.");
      }
      setDraft(sentResult.email);
      setDraftFields(editableDraftFields(sentResult.email));
      setReadyToSend(false);
      setSendConfirmOpen(false);
      setStatus(t("Approved email was sent. CRM stage updated to Sent."));
      if (sentResult.company) {
        const updatedCompany = normalizeCrmCompany(sentResult.company);
        onCompanyUpdated?.(updatedCompany);
        onLeadUpdated?.(leadFromCrmCompany(updatedCompany));
      } else {
        onLeadUpdated?.({ ...lead, status: "Contacted", email_approved_at: new Date().toISOString(), email_sent_at: sentResult.email.sent_at || new Date().toISOString() });
      }
      trackEvent("approved_email_sent", {
        lead_id: lead.id,
        email_id: draft.id,
        company: lead.company
      });
    } catch (err) {
      const reason = friendlyErrorMessage(err, "Email could not be sent. Check the recipient email, plan limits, and try again.");
      setError(t(reason));
      setStatus("");
      trackEvent("approved_email_send_failed", {
        lead_id: lead.id,
        email_id: draft.id,
        company: lead.company,
        reason
      });
    } finally {
      setSending(false);
    }
  }

  return (
    <OpportunityCardShell>
      <div className="flex flex-col gap-4 min-[520px]:flex-row min-[520px]:items-start min-[520px]:justify-between">
        <div>
          <h2 className="text-xl font-bold text-ink">{lead.company}</h2>
          <p className="mt-1 break-all text-sm text-slate-500">{profile.website}</p>
          <p className="mt-2 text-sm text-slate-600">{summaryParts.join(" · ")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="rounded-full bg-teal-50 px-3 py-1 text-xs font-bold text-brand">{t("Completion count").replace("{count}", String(completed))}</span>
          <span className={`rounded-full px-3 py-1 text-xs font-bold ${priorityTier === "Hot" ? "bg-red-50 text-red-700" : priorityTier === "Warm" ? "bg-amber-50 text-amber-700" : "bg-slate-200 text-slate-700"}`}>{t("Priority")}: {t(priorityTier)} · {opportunityScore}</span>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">{t("Data")}: {t(sourceLabel(profile.source))}</span>
        </div>
      </div>

      <div className="mt-5 grid gap-3 lg:grid-cols-4">
        {salesDecisionCards.map((item) => {
          const toneClass = item.tone === "teal"
            ? "border-teal-100 bg-teal-50 text-brand"
            : item.tone === "amber"
              ? "border-amber-200 bg-amber-50 text-amber-800"
              : item.tone === "ink"
                ? "border-slate-900 bg-ink text-white"
                : "border-slate-200 bg-slate-50 text-slate-700";
          const bodyClass = item.tone === "ink" ? "text-white" : "text-slate-800";
          return (
            <div key={item.label} className={`rounded-xl border p-3 ${toneClass}`}>
              <p className={`text-xs font-black uppercase ${item.tone === "ink" ? "text-white/75" : ""}`}>{t(item.label)}</p>
              <p className={`mt-2 line-clamp-4 text-sm font-semibold leading-6 ${bodyClass}`}>{t(item.value)}</p>
            </div>
          );
        })}
      </div>

      <section className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-black text-ink">{t("AI Lead Card")}</h3>
          <span className="rounded-full bg-white px-3 py-1 text-xs font-black text-slate-700">{t("Confidence")}: {confidence}%</span>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {[
            ["Company", lead.company],
            ["Opportunity Score", String(opportunityScore)],
            ["Priority", `${priorityTier} · ${opportunityScore}`],
            ["Buying Intent", String(buyingIntent)],
            ["Decision Maker", decisionMaker],
            ["AI Summary", aiSummary],
            ["Top Pain Point", topPainPoint],
            ["Top Opportunity", topOpportunity],
            ["Confidence", `${confidence}%`],
            ["Recommended Next Action", recommendedAction]
          ].map(([label, value]) => (
            <article key={String(label)} className="rounded-xl border border-slate-200 bg-white p-3">
              <p className="text-xs font-black uppercase tracking-wide text-slate-500">{t(String(label))}</p>
              <p className="mt-1 text-sm font-semibold leading-6 text-slate-800">{t(String(value))}</p>
            </article>
          ))}
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <a href={contactNowHref} className="inline-flex min-h-11 items-center justify-center rounded-md bg-brand px-4 text-sm font-bold text-white">{t("Contact Now")}</a>
          <a href={reviewEmailHref} className="inline-flex min-h-11 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-bold text-ink">{t("Review Email")}</a>
          {companyId && onOpenWorkflow ? (
            <button type="button" onClick={() => onOpenWorkflow(companyId)} className="inline-flex min-h-11 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-bold text-ink">{t("Open Company")}</button>
          ) : (
            <Link href={openCompanyHref} className="inline-flex min-h-11 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-bold text-ink">{t("Open Company")}</Link>
          )}
          <Link href="/dashboard/campaigns" className="inline-flex min-h-11 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-bold text-ink">{t("Add to Campaign")}</Link>
        </div>
      </section>

      <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-wide text-slate-500">{t("AI Sales Intelligence")}</p>
            <h3 className="mt-1 text-lg font-black text-ink">{t("Evidence-backed targeting intelligence")}</h3>
          </div>
          <div className="flex flex-wrap gap-2">
            <SecondaryButton type="button" onClick={() => runSalesAnalysis(false)} disabled={salesAnalysisLoading}>
              {salesAnalysisLoading ? <Loader2 className="animate-spin" size={17} /> : <Sparkles size={17} />} {t("Generate")}
            </SecondaryButton>
            <SecondaryButton type="button" onClick={() => runSalesAnalysis(true)} disabled={salesAnalysisLoading}>
              {salesAnalysisLoading ? <Loader2 className="animate-spin" size={17} /> : <Clock3 size={17} />} {t("Regenerate analysis")}
            </SecondaryButton>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs font-bold uppercase tracking-wide text-slate-500">
          <p>{t("Status")}: {salesAnalysisUiState}</p>
          {salesAnalysisRequestedVersion ? <p>{t("Version")}: {salesAnalysisRequestedVersion}{salesAnalysisLatestVersion && salesAnalysisLatestVersion !== salesAnalysisRequestedVersion ? ` / ${salesAnalysisLatestVersion}` : ""}</p> : null}
          {salesAnalysis?.generated_at ? <p>{t("Updated")}: {new Date(salesAnalysis.generated_at).toLocaleString()}</p> : null}
        </div>
        {salesAnalysisError ? <p className="mt-2 rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700">{salesAnalysisError}</p> : null}
        {salesAnalysis ? (
          <>
            {salesAnalysisVersions.length > 1 ? (
              <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <label className="text-xs font-black uppercase tracking-wide text-slate-500" htmlFor="sales-analysis-version-select">{t("Analysis version")}</label>
                <select
                  id="sales-analysis-version-select"
                  className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800"
                  value={String(salesAnalysisRequestedVersion || salesAnalysisLatestVersion || salesAnalysis.version || "")}
                  onChange={(event) => {
                    const nextVersion = Number(event.target.value || 0);
                    void loadSalesAnalysis(Number.isFinite(nextVersion) && nextVersion > 0 ? nextVersion : null);
                  }}
                >
                  {salesAnalysisVersions.map((item) => (
                    <option key={`analysis-version-${item.version}`} value={item.version}>
                      {`v${item.version}${item.generated_at ? ` · ${new Date(item.generated_at).toLocaleString()}` : ""}`}
                    </option>
                  ))}
                </select>
                {salesAnalysisLatestVersion && salesAnalysisRequestedVersion && salesAnalysisLatestVersion !== salesAnalysisRequestedVersion ? (
                  <button type="button" onClick={() => void loadSalesAnalysis(null)} className="text-sm font-bold text-brand underline-offset-2 hover:underline">
                    {t("View latest")}
                  </button>
                ) : null}
              </div>
            ) : null}
            <div className="mt-4 rounded-[1.5rem] border border-slate-900/10 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 p-4 text-white shadow-[0_24px_70px_rgba(15,23,42,0.28)]">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">{t("AI Recommendations")}</p>
                  <h4 className="mt-1 text-xl font-black text-white">{t("What to do next with this company")}</h4>
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">{t(String(salesRecommendationConfidenceExplanation))}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-black uppercase tracking-wide ${salesRecommendationPriorityTone}`}>{t(salesRecommendationPriorityTier)}</span>
                  <span className="inline-flex items-center rounded-full bg-white/10 px-3 py-1 text-xs font-black text-white">{t("Confidence")}: {salesRecommendationConfidence}%</span>
                  <span className="inline-flex items-center rounded-full bg-white/10 px-3 py-1 text-xs font-black text-white">{t("ICP fit")}: {salesRecommendationIcPFit}%</span>
                </div>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {[
                  { label: "Buying intent", value: `${String(salesRecommendationBuyingIntent)}%`, icon: Target, note: salesAnalysis?.company_stage || unavailable },
                  { label: "Reply probability", value: `${String(salesRecommendationReplyProbability)}%`, icon: MessageSquare, note: salesRecommendationBestChannel },
                  { label: "Lead priority", value: salesAnalysis?.lead_priority_tier ? `${String(salesAnalysis.lead_priority_tier)} · ${String(salesAnalysis.lead_priority_score ?? salesRecommendationPriorityScore)}%` : `${String(salesRecommendationPriorityScore)}%`, icon: Rocket, note: salesRecommendationNextAction },
                  { label: "Recommended buyer", value: salesRecommendationDecisionMaker, icon: UserRound, note: salesRecommendationDecisionMakerName }
                ].map((item) => {
                  const Icon = item.icon;
                  return (
                    <article key={item.label} className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur-sm">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-black uppercase tracking-wide text-slate-300">{t(item.label)}</p>
                          <p className="mt-2 text-2xl font-black text-white">{t(item.value)}</p>
                        </div>
                        <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white">
                          <Icon size={18} />
                        </span>
                      </div>
                      <p className="mt-3 text-sm leading-6 text-slate-300">{t(String(item.note || unavailable))}</p>
                    </article>
                  );
                })}
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {[
                  { label: "Best outreach channel", value: salesRecommendationBestChannel, icon: Send },
                  { label: "Best contact timing", value: salesRecommendationBestTiming, icon: Clock3 },
                  { label: "Recommended next action", value: salesRecommendationNextAction, icon: CheckCircle2 },
                  { label: "Confidence explanation", value: salesRecommendationConfidenceExplanation, icon: ShieldCheck }
                ].map((item) => {
                  const Icon = item.icon;
                  return (
                    <article key={item.label} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                      <div className="flex items-center gap-3">
                        <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white">
                          <Icon size={18} />
                        </span>
                        <p className="text-xs font-black uppercase tracking-wide text-slate-300">{t(item.label)}</p>
                      </div>
                      <p className="mt-3 text-sm font-semibold leading-6 text-white">{t(String(item.value || unavailable))}</p>
                    </article>
                  );
                })}
              </div>
              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                <article className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="flex items-center gap-2">
                    <Target className="text-emerald-300" size={18} />
                    <p className="text-xs font-black uppercase tracking-wide text-slate-300">{t("Top buying signals")}</p>
                  </div>
                  {salesRecommendationSignals.length ? (
                    <ul className="mt-3 space-y-2 text-sm text-slate-100">
                      {salesRecommendationSignals.map((item, index) => (
                        <li key={`recommendation-signal-${index}`} className="rounded-xl bg-white/5 px-3 py-2 ring-1 ring-white/10">{t(String(item))}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-3 rounded-xl bg-white/5 px-3 py-2 text-sm text-slate-300">{t(unavailable)}</p>
                  )}
                </article>
                <article className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="text-amber-300" size={18} />
                    <p className="text-xs font-black uppercase tracking-wide text-slate-300">{t("Top risks or objections")}</p>
                  </div>
                  {salesRecommendationRisks.length ? (
                    <ul className="mt-3 space-y-2 text-sm text-slate-100">
                      {salesRecommendationRisks.map((item, index) => (
                        <li key={`recommendation-risk-${index}`} className="rounded-xl bg-white/5 px-3 py-2 ring-1 ring-white/10">{t(String(item))}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-3 rounded-xl bg-white/5 px-3 py-2 text-sm text-slate-300">{t(unavailable)}</p>
                  )}
                </article>
              </div>
              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                <article className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="flex items-center gap-2">
                    <Lightbulb className="text-cyan-300" size={18} />
                    <p className="text-xs font-black uppercase tracking-wide text-slate-300">{t("Personalized opening message")}</p>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-slate-100">{t(String(salesRecommendationOpeningMessage))}</p>
                </article>
                <article className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="flex items-center gap-2">
                    <CalendarDays className="text-violet-300" size={18} />
                    <p className="text-xs font-black uppercase tracking-wide text-slate-300">{t("Personalized follow-up sequence")}</p>
                  </div>
                  {salesRecommendationFollowUps.length ? (
                    <ol className="mt-3 space-y-2 text-sm text-slate-100">
                      {salesRecommendationFollowUps.map((item, index) => (
                        <li key={`recommendation-follow-up-${index}`} className="rounded-xl bg-white/5 px-3 py-2 ring-1 ring-white/10">
                          <span className="font-black text-white">{index + 1}.</span> {t(String(item))}
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="mt-3 rounded-xl bg-white/5 px-3 py-2 text-sm text-slate-300">{t(unavailable)}</p>
                  )}
                </article>
              </div>
              <div className="mt-4 rounded-2xl border border-white/15 bg-slate-950/45 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-black uppercase tracking-wide text-cyan-200">{t("AI Copilot")}</p>
                    <p className="mt-1 text-sm text-slate-200">{t(String(salesCopilotPanel.summary || "Every recommendation below includes confidence, reasoning, and evidence."))}</p>
                  </div>
                  <span className="inline-flex items-center rounded-full bg-cyan-500/20 px-3 py-1 text-xs font-black text-cyan-100">{t("Confidence")}: {Number(salesCopilotPanel.confidence || salesRecommendationConfidence)}%</span>
                </div>
                <div className="mt-4 grid gap-3">
                  {salesRecommendationRows.map((item) => {
                    const rowState = salesRecommendationActions[item.key] && typeof salesRecommendationActions[item.key] === "object"
                      ? salesRecommendationActions[item.key]
                      : {};
                    const rowValue = rowState.value ?? item.value;
                    const rowReasoning = String(rowState.reasoning || salesRecommendationConfidenceExplanation || "");
                    const rowConfidence = Number(rowState.confidence || salesRecommendationConfidence || 0);
                    const isEditing = salesRecommendationEditKey === item.key;
                    return (
                      <article key={`recommendation-action-${item.key}`} className="rounded-xl border border-white/10 bg-white/5 p-3">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="text-xs font-black uppercase tracking-wide text-slate-300">{t(item.label)}</p>
                            <p className="mt-2 text-sm font-semibold text-white whitespace-pre-wrap">{t(recommendationValueToText(rowValue) || unavailable)}</p>
                            <p className="mt-2 text-xs text-slate-300">{t(item.helper)}</p>
                            <p className="mt-1 text-xs text-slate-300">{t("Reasoning")}: {t(rowReasoning || unavailable)}</p>
                            <p className="mt-1 text-xs font-bold text-cyan-100">{t("Confidence")}: {rowConfidence}%</p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => void updateSalesRecommendation({ key: item.key, action: "approve" })}
                              disabled={salesAnalysisLoading || salesRecommendationBusyKey !== ""}
                              className="inline-flex min-h-10 items-center justify-center rounded-md border border-emerald-300/40 bg-emerald-500/20 px-3 text-xs font-black text-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {salesRecommendationBusyKey === `${item.key}:approve` ? <Loader2 className="animate-spin" size={14} /> : null} {t("Approve")}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setSalesRecommendationEditKey(item.key);
                                setSalesRecommendationEditValue(recommendationValueToText(rowValue));
                                setSalesRecommendationEditReason("");
                              }}
                              disabled={salesAnalysisLoading || salesRecommendationBusyKey !== ""}
                              className="inline-flex min-h-10 items-center justify-center rounded-md border border-amber-300/40 bg-amber-500/20 px-3 text-xs font-black text-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {t("Edit")}
                            </button>
                            <button
                              type="button"
                              onClick={() => void updateSalesRecommendation({ key: item.key, action: "regenerate" })}
                              disabled={salesAnalysisLoading || salesRecommendationBusyKey !== ""}
                              className="inline-flex min-h-10 items-center justify-center rounded-md border border-sky-300/40 bg-sky-500/20 px-3 text-xs font-black text-sky-100 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {salesRecommendationBusyKey === `${item.key}:regenerate` ? <Loader2 className="animate-spin" size={14} /> : null} {t("Regenerate")}
                            </button>
                          </div>
                        </div>
                        {isEditing ? (
                          <div className="mt-3 grid gap-2">
                            <textarea
                              value={salesRecommendationEditValue}
                              onChange={(event) => setSalesRecommendationEditValue(event.target.value)}
                              className="min-h-24 w-full rounded-md border border-white/20 bg-slate-900/70 p-2 text-sm text-white"
                            />
                            <input
                              value={salesRecommendationEditReason}
                              onChange={(event) => setSalesRecommendationEditReason(event.target.value)}
                              placeholder={t("Why was this edit made?")}
                              className="min-h-10 w-full rounded-md border border-white/20 bg-slate-900/70 px-3 text-sm text-white placeholder:text-slate-400"
                            />
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => void updateSalesRecommendation({
                                  key: item.key,
                                  action: "edit",
                                  value: recommendationTextToValue(item.key, salesRecommendationEditValue),
                                  reason: salesRecommendationEditReason,
                                })}
                                disabled={salesAnalysisLoading || salesRecommendationBusyKey !== ""}
                                className="inline-flex min-h-10 items-center justify-center rounded-md bg-white px-3 text-xs font-black text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {salesRecommendationBusyKey === `${item.key}:edit` ? <Loader2 className="animate-spin" size={14} /> : null} {t("Save edit")}
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setSalesRecommendationEditKey("");
                                  setSalesRecommendationEditValue("");
                                  setSalesRecommendationEditReason("");
                                }}
                                className="inline-flex min-h-10 items-center justify-center rounded-md border border-white/20 px-3 text-xs font-black text-slate-200"
                              >
                                {t("Cancel")}
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              </div>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {[
                ["ICP fit", `${String(salesAnalysis.icp_fit_score ?? salesAnalysis.ai_lead_score ?? salesAnalysis.opportunity_score ?? 0)}%`],
                ["Buying probability", `${String(salesAnalysis.buying_probability ?? salesAnalysis.buying_intent_score ?? 0)}%`],
                ["Confidence", `${String(salesAnalysis.confidence_score ?? 0)}%`],
                ["Lead priority", salesAnalysis.lead_priority_tier ? `${String(salesAnalysis.lead_priority_tier)} · ${String(salesAnalysis.lead_priority_score ?? 0)}%` : `${String(salesAnalysis.lead_priority_score ?? 0)}%`],
                ["Company stage", String(salesAnalysis.company_stage || unavailable)],
                ["Best channel", String(salesAnalysis.best_communication_channel || unavailable)],
                ["Reply probability", `${String(salesAnalysis.estimated_reply_probability ?? 0)}%`],
                ["Recommended buyer", String(salesAnalysis.recommended_decision_maker_role || unavailable)]
              ].map(([label, value]) => (
                <article key={String(label)} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs font-black uppercase tracking-wide text-slate-500">{t(String(label))}</p>
                  <p className="mt-1 text-sm font-semibold leading-6 text-slate-800">{t(String(value))}</p>
                </article>
              ))}
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {[
                ["Estimated company size", String(salesAnalysis.estimated_company_size || unavailable)],
                ["Estimated revenue", String(salesAnalysis.estimated_revenue || unavailable)],
                ["Best subject line", String(salesAnalysis.best_subject_line || unavailable)],
                ["Primary decision maker", salesAnalysis.decision_maker?.title ? `${String(salesAnalysis.decision_maker.title)}${salesAnalysis.decision_maker.name ? ` · ${String(salesAnalysis.decision_maker.name)}` : ""}` : String(salesAnalysis.decision_maker?.name || unavailable)]
              ].map(([label, value]) => (
                <article key={String(label)} className="rounded-xl border border-slate-200 bg-white p-3">
                  <p className="text-xs font-black uppercase tracking-wide text-slate-500">{t(String(label))}</p>
                  <p className="mt-1 text-sm font-semibold leading-6 text-slate-800">{t(String(value))}</p>
                </article>
              ))}
            </div>
            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              <div className="rounded-xl bg-slate-50 p-3">
                <p className="text-xs font-black uppercase tracking-wide text-slate-500">{t("Company summary")}</p>
                <p className="mt-1 text-sm font-semibold leading-6 text-slate-800">{t(String(salesAnalysis.company_summary || salesAnalysis.summary || unavailable))}</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3">
                <p className="text-xs font-black uppercase tracking-wide text-slate-500">{t("Business model")}</p>
                <p className="mt-1 text-sm font-semibold leading-6 text-slate-800">{t(String(salesAnalysis.business_model || unavailable))}</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3">
                <p className="text-xs font-black uppercase tracking-wide text-slate-500">{t("What the company sells")}</p>
                <p className="mt-1 text-sm font-semibold leading-6 text-slate-800">{t(String(salesAnalysis.what_company_sells || unavailable))}</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3">
                <p className="text-xs font-black uppercase tracking-wide text-slate-500">{t("Target customers")}</p>
                <p className="mt-1 text-sm font-semibold leading-6 text-slate-800">{t(String(salesAnalysis.target_customers || unavailable))}</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3">
                <p className="text-xs font-black uppercase tracking-wide text-slate-500">{t("Best outreach angle")}</p>
                <p className="mt-1 text-sm font-semibold leading-6 text-slate-800">{t(String(salesAnalysis.best_outreach_angle || salesAnalysis.outreach_angle || unavailable))}</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3">
                <p className="text-xs font-black uppercase tracking-wide text-slate-500">{t("Best timing to contact")}</p>
                <p className="mt-1 text-sm font-semibold leading-6 text-slate-800">{t(String(salesAnalysis.best_timing_to_contact || unavailable))}</p>
              </div>
            </div>
            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              <div className="rounded-xl bg-slate-50 p-3">
                <p className="text-xs font-black uppercase tracking-wide text-slate-500">{t("Value proposition")}</p>
                <p className="mt-1 text-sm font-semibold leading-6 text-slate-800">{t(String(salesAnalysis.value_proposition || unavailable))}</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3">
                <p className="text-xs font-black uppercase tracking-wide text-slate-500">{t("Score explanation")}</p>
                <p className="mt-1 text-sm font-semibold leading-6 text-slate-800">{t(String(salesAnalysis.score_explanation || unavailable))}</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3">
                <p className="text-xs font-black uppercase tracking-wide text-slate-500">{t("Personalized opening line")}</p>
                <p className="mt-1 text-sm font-semibold leading-6 text-slate-800">{t(String(salesAnalysis.personalized_opening_line || unavailable))}</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3">
                <p className="text-xs font-black uppercase tracking-wide text-slate-500">{t("Recommended first message")}</p>
                <p className="mt-1 text-sm font-semibold leading-6 text-slate-800 whitespace-pre-wrap">{t(String(salesAnalysis.recommended_first_message || salesAnalysis.personalized_opening_line || unavailable))}</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3">
                <p className="text-xs font-black uppercase tracking-wide text-slate-500">{t("Suggested CTA")}</p>
                <p className="mt-1 text-sm font-semibold leading-6 text-slate-800">{t(String(salesAnalysis.suggested_cta || salesAnalysis.best_cta || unavailable))}</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3">
                <p className="text-xs font-black uppercase tracking-wide text-slate-500">{t("Recommended next action")}</p>
                <p className="mt-1 text-sm font-semibold leading-6 text-slate-800">{t(String(salesAnalysis.recommended_next_action || salesAnalysis.next_action || unavailable))}</p>
              </div>
            </div>
            {Array.isArray(salesAnalysis.decision_makers) && salesAnalysis.decision_makers.length ? (
              <div className="mt-4 rounded-xl border border-slate-200 bg-white p-3">
                <p className="text-xs font-black uppercase tracking-wide text-slate-500">{t("Decision makers")}</p>
                <ul className="mt-2 space-y-2 text-sm text-slate-700">
                  {salesAnalysis.decision_makers.slice(0, 3).map((item, index) => (
                    <li key={`decision-maker-${index}`} className="rounded-lg bg-slate-50 px-3 py-2">
                      {t(String(item.name || "Unknown"))}{item.title ? ` · ${t(String(item.title))}` : ""}{item.email ? ` · ${item.email}` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="mt-4 grid gap-3 lg:grid-cols-3">
              {[
                ["Buying signals", salesAnalysis.buying_signals],
                ["Pain points", Array.isArray(salesAnalysis.pain_points) ? salesAnalysis.pain_points : salesAnalysis.likely_business_pains],
                ["Growth indicators", salesAnalysis.company_growth_indicators],
                ["Why it fits ICP", salesAnalysis.why_fits_icp],
                ["Watchouts", salesAnalysis.why_may_not_fit],
                ["Personalization variables", salesAnalysis.personalization_variables],
                ["Predicted objections", salesAnalysis.predicted_objections]
              ].map(([label, items]) => (
                <div key={String(label)} className="rounded-xl border border-slate-200 bg-white p-3">
                  <p className="text-xs font-black uppercase tracking-wide text-slate-500">{t(String(label))}</p>
                  {Array.isArray(items) && items.length ? (
                    <ul className="mt-2 space-y-2 text-sm text-slate-700">
                      {items.slice(0, 4).map((item, index) => (
                        <li key={`${String(label)}-${index}`} className="rounded-lg bg-slate-50 px-3 py-2">{t(String(item || ""))}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">{t(unavailable)}</p>
                  )}
                </div>
              ))}
            </div>
            {Array.isArray(salesAnalysis.personalized_follow_up_sequence) && salesAnalysis.personalized_follow_up_sequence.length ? (
              <div className="mt-4 rounded-xl border border-slate-200 bg-white p-3">
                <p className="text-xs font-black uppercase tracking-wide text-slate-500">{t("Personalized follow-up sequence")}</p>
                <ol className="mt-2 space-y-2 text-sm text-slate-700">
                  {salesAnalysis.personalized_follow_up_sequence.slice(0, 4).map((item, index) => (
                    <li key={`follow-up-${index}`} className="rounded-lg bg-slate-50 px-3 py-2">
                      <span className="font-bold text-ink">{index + 1}.</span> {t(String(item || ""))}
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}
            {Array.isArray(salesAnalysis.reasoning) && salesAnalysis.reasoning.length ? (
              <div className="mt-4 rounded-xl border border-slate-200 bg-white p-3">
                <p className="text-xs font-black uppercase tracking-wide text-slate-500">{t("Reasoning")}</p>
                <ul className="mt-2 space-y-2 text-sm text-slate-700">
                  {salesAnalysis.reasoning.slice(0, 5).map((item, index) => (
                    <li key={`reasoning-${index}`} className="rounded-lg bg-slate-50 px-3 py-2">{t(String(item || ""))}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {Array.isArray(salesAnalysis.strongest_sales_arguments) && salesAnalysis.strongest_sales_arguments.length ? (
              <div className="mt-4 rounded-xl border border-slate-200 bg-white p-3">
                <p className="text-xs font-black uppercase tracking-wide text-slate-500">{t("3 strongest sales arguments")}</p>
                <ul className="mt-2 space-y-2 text-sm text-slate-700">
                  {salesAnalysis.strongest_sales_arguments.slice(0, 3).map((item, index) => (
                    <li key={`argument-${index}`} className="rounded-lg bg-slate-50 px-3 py-2">{t(String(item || ""))}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {Array.isArray(salesAnalysis.evidence) && salesAnalysis.evidence.length ? (
              <div className="mt-4 rounded-xl border border-slate-200 bg-white p-3">
                <p className="text-xs font-black uppercase tracking-wide text-slate-500">{t("Evidence")}</p>
                <ul className="mt-2 space-y-2 text-sm text-slate-700">
                  {salesAnalysis.evidence.slice(0, 5).map((item, index) => (
                    <li key={`${item.source_field || "e"}-${index}`} className="rounded-lg bg-slate-50 px-3 py-2">
                      <span className="font-bold text-ink">{t(String(item.source_field || "source"))}:</span> {t(String(item.value || ""))}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        ) : (
          <p className="mt-4 rounded-xl bg-slate-50 p-3 text-sm font-semibold text-slate-700">{t("No analysis yet. Generate AI Sales Analysis to create an evidence-backed outreach plan.")}</p>
        )}
      </section>

      <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-wide text-brand">{t("AI autopilot")}</p>
            <h3 className="mt-2 text-lg font-black text-ink">{t("One click fills the missing sales research.")}</h3>
            <p className="mt-2 text-sm leading-6 text-slate-700">
              {t("OutreachAI checks the website, contacts, AI scores, offer, first email and follow-ups. If a source cannot verify data, it shows exactly what is missing instead of inventing it.")}
            </p>
          </div>
          <span className="w-fit rounded-full bg-teal-50 px-3 py-1 text-xs font-black text-brand">
            {completed}/{coverage.length} {t("ready")}
          </span>
        </div>
        {missingCoverage.length ? (
          <div className="mt-4 rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
            <p className="font-bold text-ink">{t("Still missing")}</p>
            <p className="mt-1 leading-6">{missingCoverage.slice(0, 4).map((item) => t(item)).join(", ")}{missingCoverage.length > 4 ? ` +${missingCoverage.length - 4}` : ""}</p>
          </div>
        ) : (
          <p className="mt-4 rounded-xl bg-teal-50 p-3 text-sm font-bold text-brand">{t("This opportunity has all required sales research.")}</p>
        )}
        {(aiNextAction || aiRecommendedActions.length || aiMissingFields.length) ? (
          <div className="mt-4 rounded-xl border border-teal-100 bg-white p-3 text-sm">
            <p className="font-bold text-ink">{t("AI next action")}</p>
            {aiNextAction ? <p className="mt-1 leading-6 text-slate-700">{t(aiNextAction)}</p> : null}
            {aiMissingFields.length ? (
              <p className="mt-2 text-xs font-bold uppercase tracking-wide text-slate-500">
                {t("Missing data")}: <span className="normal-case tracking-normal text-slate-700">{aiMissingFields.map((item) => t(item)).join(", ")}</span>
              </p>
            ) : null}
            {aiRecommendedActions.length ? (
              <ul className="mt-3 space-y-2">
                {aiRecommendedActions.slice(0, 3).map((item) => (
                  <li key={item} className="rounded-lg bg-teal-50 px-3 py-2 font-semibold text-brand">{t(item)}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-wide text-slate-500">{t("Useful B2B data")}</p>
            <h3 className="mt-1 text-lg font-black text-ink">{t("Most important facts for qualification and outreach.")}</h3>
            <p className="mt-2 text-sm leading-6 text-slate-700">{t("Every field below is either verified, clearly missing, or ready to retry from this card.")}</p>
          </div>
          <span className="w-fit rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">
            {dataFacts.filter((fact) => fact.ready).length}/{dataFacts.length} {t("ready")}
          </span>
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-3">
          <div className="rounded-xl bg-teal-50 p-3">
            <p className="text-xs font-black uppercase text-brand">{t("Found")}</p>
            <p className="mt-1 text-sm font-semibold leading-6 text-slate-800">{dataSummary.foundText}</p>
          </div>
          <div className="rounded-xl bg-amber-50 p-3">
            <p className="text-xs font-black uppercase text-amber-700">{t("Still missing")}</p>
            <p className="mt-1 text-sm font-semibold leading-6 text-slate-800">{dataSummary.missingText}</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-3">
            <p className="text-xs font-black uppercase text-slate-500">{t("What to do next")}</p>
            <p className="mt-1 text-sm font-semibold leading-6 text-slate-800">{t(missingCoverage.length ? "Click Run all missing steps to retry website analysis, contacts and email draft." : "Review the prepared email and approve only when everything looks right.")}</p>
          </div>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {dataFacts.map((fact) => <div key={fact.label} className={`rounded-xl border p-3 ${fact.ready ? "border-teal-100 bg-teal-50" : "border-slate-200 bg-slate-50"}`}>
            <p className={`text-xs font-bold uppercase ${fact.ready ? "text-brand" : "text-slate-500"}`}>{t(fact.label)}</p>
            <p className="mt-1 break-words text-sm font-semibold text-slate-800">{t(fact.value)}</p>
          </div>)}
        </div>
      </section>

      <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Found", lead.found_at || lead.created_at],
          ["Saved to CRM", lead.saved_to_crm_at],
          ["Analyzed", lead.website_analyzed_at],
          ["Email generated", lead.email_generated_at],
          ["Email approved", lead.email_approved_at],
          ["Last activity", lead.last_activity_at || lead.stage_changed_at],
        ].map(([label, value]) => <div key={String(label)} className="rounded-xl border border-slate-200 bg-white p-3">
          <p className="font-semibold text-slate-700">{t(String(label || ""))}</p>
          <p className="mt-1 text-slate-500">{t(formatDateTime(value))}</p>
        </div>)}
      </div>

      <div className="mt-5 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {coverage.map(([label, done]) => <div key={label} className={`rounded-lg px-3 py-2 ${done ? "bg-teal-50 text-brand" : "bg-slate-100 text-slate-600"}`}>
          <span className="inline-flex items-center gap-2 text-xs font-bold"><CheckCircle2 size={15} />{t(label)}</span>
          {!done ? <p className="mt-1 text-xs leading-5 text-slate-500">{t(opportunityCoverageHint(label))}</p> : null}
        </div>)}
      </div>

      {contactNeedsManualStep && <section className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-wide text-amber-700">{t("Contact needed")}</p>
            <h3 className="mt-2 text-lg font-black text-ink">{t("No verified email was found yet")}</h3>
            <p className="mt-2 text-sm leading-6 text-slate-700">{t(contactSearch.message || "No verified business email was found. Add a decision maker manually or continue with research.")}</p>
            {contactSearch.roles.length ? <p className="mt-3 text-xs font-bold uppercase tracking-wide text-slate-500">{t("Roles searched")}: <span className="normal-case tracking-normal text-slate-700">{contactSearch.roles.map((role) => t(role)).join(", ")}</span></p> : null}
          </div>
          {companyId ? <a href={`#contacts-${companyId}`} className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-md bg-ink px-4 text-sm font-bold text-white"><Plus size={17} />{t("Add contact manually")}</a> : null}
        </div>
      </section>}

      {draft && (readyToSend || draft.delivery_status === "approved" || draft.delivery_status === "sent") && <section className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
        <p className="text-xs font-bold uppercase text-slate-500">{t("Personalized first email")}</p>
        <p className="mt-2 rounded-lg bg-teal-50 p-3 text-sm font-semibold text-brand">{draft.delivery_status === "sent" ? t("Approved email was sent. CRM stage updated to Sent.") : draft.delivery_status === "approved" ? t("Email approved. Nothing was sent yet.") : t("Review this draft before sending. No email has been sent yet.")}</p>
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          <div className="rounded-lg bg-white p-3 text-sm">
            <span className="font-bold text-slate-700">{t("Recipient")}:</span>{" "}
            <span className="font-semibold text-ink">{recipientEmail || t("Find a contact or add an email manually.")}</span>
          </div>
          <div className="rounded-lg bg-white p-3 text-sm">
            <span className="font-bold text-slate-700">{t("Sender")}:</span>{" "}
            <span className="font-semibold text-ink">{senderStatus?.sender_email || t("Checked before sending.")}</span>
          </div>
        </div>
        {editingDraft ? (
          <div className="mt-4 space-y-3">
            <label className="block text-sm font-semibold text-slate-700">
              {t("Subject")}
              <input
                value={draftFields.subject}
                onChange={(event) => setDraftFields((current) => ({ ...current, subject: event.target.value }))}
                className="mt-2 min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"
              />
            </label>
            <label className="block text-sm font-semibold text-slate-700">
              {t("Preview")}
              <input
                value={draftFields.preview}
                onChange={(event) => setDraftFields((current) => ({ ...current, preview: event.target.value }))}
                className="mt-2 min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"
              />
            </label>
            <label className="block text-sm font-semibold text-slate-700">
              {t("Email body")}
              <textarea
                value={draftFields.body}
                onChange={(event) => setDraftFields((current) => ({ ...current, body: event.target.value }))}
                className="mt-2 min-h-40 w-full rounded-md border border-slate-300 bg-white p-3 text-sm leading-6"
              />
            </label>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="block text-sm font-semibold text-slate-700">
                {t("CTA")}
                <input
                  value={draftFields.cta}
                  onChange={(event) => setDraftFields((current) => ({ ...current, cta: event.target.value }))}
                  className="mt-2 min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"
                />
              </label>
              <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-600">
                <p className="font-bold text-slate-800">{t("Approval safety")}</p>
                <p className="mt-1 leading-6">{t("Save edits first. Approval and sending stay blocked until the message looks right.")}</p>
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="block text-sm font-semibold text-slate-700">
                {t("Follow-up 1")}
                <textarea
                  value={draftFields.follow_up_1}
                  onChange={(event) => setDraftFields((current) => ({ ...current, follow_up_1: event.target.value }))}
                  className="mt-2 min-h-28 w-full rounded-md border border-slate-300 bg-white p-3 text-sm leading-6"
                />
              </label>
              <label className="block text-sm font-semibold text-slate-700">
                {t("Follow-up 2")}
                <textarea
                  value={draftFields.follow_up_2}
                  onChange={(event) => setDraftFields((current) => ({ ...current, follow_up_2: event.target.value }))}
                  className="mt-2 min-h-28 w-full rounded-md border border-slate-300 bg-white p-3 text-sm leading-6"
                />
              </label>
            </div>
            <div className="flex flex-col gap-2 min-[430px]:flex-row">
              <PrimaryButton onClick={saveDraftEdits} disabled={savingDraft || sending}>{savingDraft ? <Loader2 className="animate-spin" size={17} /> : <CheckCircle2 size={17} />} {t("Save email edits")}</PrimaryButton>
              <SecondaryButton onClick={() => {
                setDraftFields(editableDraftFields(draft));
                setEditingDraft(false);
                setError("");
                setStatus(t("Returned to the saved draft."));
              }} disabled={savingDraft || sending}>{t("Cancel editing")}</SecondaryButton>
            </div>
          </div>
        ) : (
          <>
            <h3 className="mt-2 font-bold text-ink">{draft.subject}</h3>
            {draft.preview ? <p className="mt-2 rounded-lg bg-white p-3 text-sm font-semibold text-slate-700">{draft.preview}</p> : null}
            <p className="mt-2 whitespace-pre-line text-sm leading-6 text-slate-700">{draft.body}</p>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <div className="whitespace-pre-line rounded-lg bg-white p-3 text-sm"><span className="font-bold">{t("Follow-up 1")}:</span> {cleanGeneratedText(draft.follow_up_1 || followUps?.no_open?.[0]) || t(unavailable)}</div>
              <div className="whitespace-pre-line rounded-lg bg-white p-3 text-sm"><span className="font-bold">{t("Follow-up 2")}:</span> {cleanGeneratedText(draft.follow_up_2 || followUps?.opened?.[0]) || t(unavailable)}</div>
            </div>
          </>
        )}
      </section>}

      {sendConfirmOpen && draft?.delivery_status === "approved" && <section className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4">
        <p className="text-sm font-bold text-ink">{t("Confirm before sending")}</p>
        <p className="mt-2 text-sm leading-6 text-slate-700">{t("This will send one email to the saved recipient. Nothing is sent until you confirm.")}</p>
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          <p className="rounded-lg bg-white p-3 text-sm font-semibold text-slate-800">{t("From")}: {senderStatus?.sender_email || t("Not connected")}</p>
          <p className="rounded-lg bg-white p-3 text-sm font-semibold text-slate-800">{t("To")}: {recipientEmail || t("Not available")}</p>
        </div>
        <div className="mt-4 grid gap-2 min-[430px]:grid-cols-2">
          <SecondaryButton type="button" onClick={() => setSendConfirmOpen(false)} disabled={sending}>{t("Cancel")}</SecondaryButton>
          <PrimaryButton type="button" onClick={() => sendApprovedEmail(true)} disabled={sending}>{sending ? <Loader2 className="animate-spin" size={17} /> : <Send size={17} />} {t("Confirm and send")}</PrimaryButton>
        </div>
      </section>}

      {visibleStatus && <p className="mt-4 rounded-xl bg-teal-50 p-3 text-sm font-semibold text-brand">{visibleStatus}</p>}
      {error && <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p>}
      {draft?.delivery_status === "approved" && senderStatus && !senderStatus.connected ? (
        <div className="mt-3 flex flex-col gap-2 min-[430px]:flex-row">
          <Link href="/dashboard/settings#email-sending" className="inline-flex min-h-11 items-center justify-center rounded-md bg-ink px-4 text-sm font-bold text-white">
            {t("Set up sender")}
          </Link>
          <Link href="/dashboard/settings#email-sending" className="inline-flex min-h-11 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-bold text-ink">
            {t("Open sender settings")}
          </Link>
        </div>
      ) : null}
      <div className="mt-5 flex flex-col gap-2 min-[430px]:flex-row">
        <PrimaryButton onClick={completeResearch} disabled={busy}>{busy ? <Loader2 className="animate-spin" size={17} /> : <Sparkles size={17} />} {t(missingCoverage.length ? "Run all missing steps" : "Refresh AI research")}</PrimaryButton>
        <SecondaryButton onClick={() => setEditingDraft(true)} disabled={busy || !draft || sending || savingDraft || draft.delivery_status === "approved" || draft.delivery_status === "sent"}>{savingDraft ? <Loader2 className="animate-spin" size={17} /> : <FileText size={17} />} {t("Edit email")}</SecondaryButton>
        <SecondaryButton onClick={approveDraft} disabled={busy || !draft || sending || savingDraft || editingDraft || draft.delivery_status === "approved" || draft.delivery_status === "sent"}>{sending ? <Loader2 className="animate-spin" size={17} /> : <CheckCircle2 size={17} />} {draft?.delivery_status === "sent" ? t("Sent") : draft?.delivery_status === "approved" ? t("Approved") : t("Approve email")}</SecondaryButton>
        <SecondaryButton onClick={() => sendApprovedEmail(false)} disabled={busy || !draft || sending || savingDraft || editingDraft || senderLoading || draft.delivery_status !== "approved"}>{sending || senderLoading ? <Loader2 className="animate-spin" size={17} /> : <Send size={17} />} {draft?.delivery_status === "sent" ? t("Sent") : t("Send approved email")}</SecondaryButton>
      </div>
    </OpportunityCardShell>
  );
}

export function DashboardHome() {
  const { metrics, leads, recentCompanies, campaigns, employees, activity, loading, error, supportingError, cachedAt } = useDashboardData();
  const { t } = useI18n();
  const hasAnyData = metrics.leads > 0 || metrics.campaigns > 0 || metrics.emails_sent > 0 || metrics.replies > 0 || metrics.meetings > 0 || leads.length > 0 || campaigns.length > 0 || employees.length > 0 || activity.length > 0;
  const nextStep = dashboardNextStep(metrics, leads, campaigns);
  const companies = recentCompanies.length ? recentCompanies : [];

  const opportunities = [...companies]
    .sort((left, right) => {
      const leftScore = Number(left.ai_crm?.priority?.score || left.overall_score || 0);
      const rightScore = Number(right.ai_crm?.priority?.score || right.overall_score || 0);
      return rightScore - leftScore;
    })
    .slice(0, 6);

  const readyToSendEmails = companies
    .map((company) => ({
      company,
      email: safeArray(company.generated_emails)[0]
    }))
    .filter((item) => {
      if (!item.email) return false;
      const status = String(item.email.delivery_status || "").toLowerCase();
      return status === "approved" || status === "draft";
    })
    .slice(0, 5);

  const needsReviewCount = companies.filter((company) => {
    const hasErrorStage = Object.values(company.workflow_stages || {}).some((stage) => String(stage).toLowerCase() === "error");
    const hasReviewMessage = Object.values(company.workflow_stage_messages || {}).some((message) => String(message || "").toLowerCase().includes("review"));
    const stage = String(company.crm_stage || "");
    return hasErrorStage || hasReviewMessage || stage === "Email Draft Ready" || stage === "Approved";
  }).length;

  const allBuyingChanges = companies.flatMap((company) => safeArray(company.ai_live_buying_signals?.latest_changes));
  const buyingSignalBuckets = {
    hiring: allBuyingChanges.filter((item) => item?.change_type === "new_hiring"),
    technology: allBuyingChanges.filter((item) => item?.change_type === "technology_changes"),
    expansion: allBuyingChanges.filter((item) => item?.change_type === "market_expansion"),
    funding: allBuyingChanges.filter((item) => item?.change_type === "new_funding"),
    product: allBuyingChanges.filter((item) => item?.change_type === "new_products")
  };

  const summaryCards = [
    {
      label: t("Hot Opportunities"),
      value: opportunities.filter((item) => Number(item.ai_crm?.priority?.score || item.overall_score || 0) >= 70).length,
      helper: t("High-priority accounts")
    },
    {
      label: t("New Buying Signals"),
      value: allBuyingChanges.length,
      helper: t("Recent signal changes")
    },
    {
      label: t("Emails Ready"),
      value: readyToSendEmails.length,
      helper: t("Draft or approved")
    },
    {
      label: t("Active Pipeline"),
      value: metrics.revenue_forecast.toLocaleString(),
      helper: t("Current pipeline value")
    },
    {
      label: t("Companies Needing Review"),
      value: needsReviewCount,
      helper: t("Awaiting manual review")
    }
  ];

  const primaryCompany = opportunities[0] || null;
  const primaryContact = primaryCompany?.contacts?.[0] || null;
  const who = primaryContact
    ? `${primaryContact.name || "Decision maker"}${primaryContact.title ? ` · ${primaryContact.title}` : ""}`
    : (primaryCompany?.name || t("No company selected yet"));
  const why = String(
    primaryCompany?.ai_crm?.buying_intent?.reasoning
    || primaryCompany?.ai_sales_os?.orchestrator?.coordination_summary
    || primaryCompany?.reasoning
    || t("AI ranked this account based on current buying intent, risk and verified signals.")
  );
  const whatNext = String(
    primaryCompany?.ai_crm?.next_action
    || primaryCompany?.ai_sales_os?.orchestrator?.output?.next_action
    || primaryCompany?.recommended_next_action
    || t(nextStep.title)
  );

  const aiRecommendation = {
    bestCompany: primaryCompany?.name || t("No best company yet"),
    whyNow: String(primaryCompany?.ai_crm?.buying_intent?.reasoning || primaryCompany?.ai_revenue_engine_report?.recommended_outreach_strategy?.why_contact_now || why),
    whoToContact: who,
    outreachAngle: String(primaryCompany?.ai_outreach_strategy?.strongest_value_proposition || primaryCompany?.ai_competitor_intelligence?.opportunity_to_sell || t("Use the strongest value proposition from the company card.")),
    href: primaryCompany ? `/dashboard/companies?company=${primaryCompany.id}` : "/dashboard/companies"
  };

  return (
    <div className="space-y-6" style={{ fontFamily: '"Space Grotesk", "IBM Plex Sans", "Avenir Next", sans-serif' }}>
      <section className="relative overflow-hidden rounded-3xl border border-slate-200 bg-gradient-to-br from-white via-[#f4f7ff] to-[#eef6ff] p-5 shadow-sm sm:p-7">
        <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-[#b7e3ff] opacity-40 blur-3xl" />
        <div className="pointer-events-none absolute -left-10 bottom-0 h-44 w-44 rounded-full bg-[#dff5eb] opacity-50 blur-3xl" />
        <div className="relative flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#0f4f77]">{t("Executive Dashboard")}</p>
            <h1 className="mt-2 text-3xl font-bold leading-tight text-slate-900 sm:text-4xl">{t("What should I do now?")}</h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-700">{t("AI-first control center. Every card explains who to target, why this matters now, and what next action creates the most momentum.")}</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <Link href={nextStep.href} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 text-sm font-bold text-white">{t(nextStep.label)} <ArrowRight size={16} /></Link>
            <Link href="/dashboard/companies" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold text-slate-800"><Building2 size={16} /> {t("Open Companies")}</Link>
            <Link href="/dashboard/inbox" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold text-slate-800"><Inbox size={16} /> {t("Open Inbox")}</Link>
          </div>
        </div>
      </section>

      {(loading || supportingError || error) && (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          {loading ? t("Loading executive context…") : null}
          {!loading && (supportingError || error) ? supportingError || error : null}
          {cachedAt ? ` ${t("Showing last successful refresh.")}` : ""}
        </section>
      )}

      {!hasAnyData && (
        <WidgetBoundary name="Private workspace onboarding">
          <section className="rounded-3xl border border-teal-100 bg-gradient-to-br from-white to-teal-50/70 p-5 shadow-sm sm:p-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-bold uppercase text-brand">{t("Private workspace")}</p>
                <h2 className="mt-2 text-2xl font-bold text-ink">{t("Your private workspace is ready")}</h2>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">{t("No shared demo CRM is loaded. Add your first company or run Lead Finder, and every saved lead will belong only to this account.")}</p>
              </div>
              <div className="grid min-w-0 gap-2 sm:grid-cols-3 lg:w-[34rem]">
                <Link href="/dashboard/leads#manual-company" className="inline-flex min-h-12 items-center justify-center rounded-md border border-teal-200 bg-white px-3 text-center text-sm font-bold text-brand shadow-sm">{t("Add your first company")}</Link>
                <Link href="/dashboard/leads" className="inline-flex min-h-12 items-center justify-center rounded-md bg-brand px-3 text-center text-sm font-bold text-white shadow-sm">{t("Find leads")}</Link>
                <Link href="/dashboard/campaigns" className="inline-flex min-h-12 items-center justify-center rounded-md border border-slate-200 bg-white px-3 text-center text-sm font-bold text-slate-800 shadow-sm">{t("Create your first campaign")}</Link>
              </div>
            </div>
          </section>
        </WidgetBoundary>
      )}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {summaryCards.map((card) => (
          <article key={card.label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">{card.label}</p>
            <p className="mt-2 text-2xl font-bold text-slate-900">{card.value}</p>
            <p className="mt-1 text-sm text-slate-600">{card.helper}</p>
          </article>
        ))}
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">{t("Who?")}</p>
          <p className="mt-3 text-lg font-bold text-slate-900">{who}</p>
          <p className="mt-2 text-sm text-slate-600">{primaryCompany?.name || t("No prioritized account yet. Run lead search to create opportunities.")}</p>
        </article>
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">{t("Why?")}</p>
          <p className="mt-3 text-sm leading-6 text-slate-800">{why}</p>
        </article>
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">{t("What next?")}</p>
          <p className="mt-3 text-sm leading-6 text-slate-800">{whatNext}</p>
          <Link href={nextStep.href} className="mt-4 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#0f4f77] px-4 text-sm font-bold text-white">{t("Do next action")} <ArrowRight size={16} /></Link>
        </article>
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm xl:col-span-2">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-bold text-slate-900">{t("Today's Best Opportunities")}</h2>
            <Link href="/dashboard/companies" className="text-sm font-bold text-[#0f4f77]">{t("View all")}</Link>
          </div>
          <div className="mt-4 grid gap-3">
            {opportunities.length ? opportunities.map((company) => {
              const score = Number(company.ai_crm?.priority?.score || company.overall_score || 0);
              const urgency = String(company.ai_crm?.buying_intent?.urgency || "");
              const buyingScore = Number(company.ai_crm?.buying_intent?.score || company.buying_signal_score || 0);
              const decisionMaker = company.decision_maker_intelligence?.profiles?.[0] || null;
              const whoLine = decisionMaker?.name
                ? `${decisionMaker.name}${decisionMaker.title ? ` · ${decisionMaker.title}` : ""}`
                : (company.contacts?.[0]?.name || company.email || t("Decision maker pending"));
              const whyLine = String(company.ai_crm?.buying_intent?.reasoning || company.ai_revenue_engine_report?.recommended_outreach_strategy?.why_contact_now || company.reasoning || t("Signals still loading."));
              const nextLine = String(company.ai_crm?.next_action || company.recommended_next_action || t("Open company card and continue workflow."));
              return (
                <article key={company.id} className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-base font-bold text-slate-900">{company.name}</p>
                    <span className="rounded-full bg-white px-2.5 py-1 text-xs font-bold text-slate-700">{t("Priority")} {score}</span>
                  </div>
                  <div className="mt-3 grid gap-2 text-sm">
                    <p><span className="font-bold text-slate-900">{t("Opportunity score")}</span> <span className="text-slate-700">{score}</span></p>
                    <p><span className="font-bold text-slate-900">{t("Buying intent")}</span> <span className="text-slate-700">{buyingScore}{urgency ? ` · ${urgency}` : ""}</span></p>
                    <p><span className="font-bold text-slate-900">{t("Decision maker")}</span> <span className="text-slate-700">{whoLine}</span></p>
                    <p><span className="font-bold text-slate-900">{t("Top reason to contact")}</span> <span className="text-slate-700">{whyLine}</span></p>
                    <p><span className="font-bold text-slate-900">{t("Recommended next action")}</span> <span className="text-slate-700">{nextLine}</span></p>
                  </div>
                </article>
              );
            }) : (
              <div className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-600">
                {t("No opportunity cards yet. Add a company or run lead search to let AI prioritize accounts.")}
              </div>
            )}
          </div>
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-bold text-slate-900">{t("AI Recommendation")}</h2>
          <div className="mt-4 space-y-3 text-sm">
            <div className="rounded-xl bg-slate-50 p-3">
              <p className="font-bold text-slate-900">{t("Best company to contact today")}</p>
              <p className="mt-1 text-slate-700">{aiRecommendation.bestCompany}</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-3">
              <p className="font-bold text-slate-900">{t("Why now")}</p>
              <p className="mt-1 text-slate-700">{aiRecommendation.whyNow}</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-3">
              <p className="font-bold text-slate-900">{t("Who to contact")}</p>
              <p className="mt-1 text-slate-700">{aiRecommendation.whoToContact}</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-3">
              <p className="font-bold text-slate-900">{t("Recommended outreach angle")}</p>
              <p className="mt-1 text-slate-700">{aiRecommendation.outreachAngle}</p>
            </div>
          </div>
          <Link href={aiRecommendation.href} className="mt-4 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#0f4f77] px-4 text-sm font-bold text-white">{t("Open company")} <ArrowRight size={16} /></Link>
        </article>
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-bold text-slate-900">{t("Recent Buying Signals")}</h2>
          <div className="mt-4 space-y-2">
            {[
              { key: "hiring", label: t("Hiring"), items: buyingSignalBuckets.hiring },
              { key: "technology", label: t("Technology changes"), items: buyingSignalBuckets.technology },
              { key: "expansion", label: t("Expansion"), items: buyingSignalBuckets.expansion },
              { key: "funding", label: t("Funding"), items: buyingSignalBuckets.funding },
              { key: "product", label: t("Product launches"), items: buyingSignalBuckets.product }
            ].map((bucket) => (
              <div key={bucket.key} className="rounded-xl bg-slate-50 p-3 text-sm">
                <p className="font-bold text-slate-900">{bucket.label}</p>
                <p className="mt-1 text-slate-700">{bucket.items.length ? safeArray(bucket.items[0]?.added).slice(0, 2).join(", ") || t("Updated") : t("No new signal")}</p>
                <p className="mt-1 text-xs text-slate-500">{t("Count")}: {bucket.items.length}</p>
              </div>
            ))}
          </div>
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-bold text-slate-900">{t("Ready-to-Send Emails")}</h2>
          <div className="mt-4 space-y-2">
            {readyToSendEmails.length ? readyToSendEmails.map(({ company, email }) => {
              const contact = company.contacts?.[0];
              const confidence = Number(company.ai_outreach_strategy?.estimated_reply_probability || company.ai_revenue_engine_report?.confidence || 0);
              return (
                <div key={company.id} className="rounded-xl border border-slate-200 p-3 text-sm">
                  <p className="font-bold text-slate-900">{company.name}</p>
                  <p className="mt-1 text-slate-700">{t("Contact")}: {contact?.name || contact?.email || company.email || t("Not available")}</p>
                  <p className="mt-1 text-slate-700">{t("Subject")}: {email?.subject || t("No subject yet")}</p>
                  <p className="mt-1 text-slate-700">{t("Confidence")}: {confidence}%</p>
                  <Link href={`/dashboard/companies?company=${company.id}`} className="mt-3 inline-flex min-h-10 items-center justify-center rounded-lg bg-slate-900 px-3 text-xs font-bold text-white">{t("Review")}</Link>
                </div>
              );
            }) : <p className="text-sm text-slate-600">{t("No emails ready yet.")}</p>}
          </div>
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-bold text-slate-900">{t("AI Timeline")}</h2>
          <div className="mt-4 space-y-2">
            {primaryCompany?.ai_live_buying_signals?.change_timeline?.length ? safeArray(primaryCompany.ai_live_buying_signals.change_timeline).slice(0, 5).map((item, index) => (
              <div key={`${item.change_type || "timeline"}-${index}`} className="rounded-xl border border-slate-200 p-3 text-sm">
                <p className="font-bold text-slate-900">{item.change_type || t("Timeline event")}</p>
                <p className="mt-1 text-slate-700">{Array.isArray(item.added) ? item.added.join(", ") : ""}</p>
              </div>
            )) : <p className="text-sm text-slate-600">{t("Timeline fills automatically after company monitoring runs.")}</p>}
          </div>
        </article>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-slate-900">{t("Daily Summary")}</h2>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700">{t("Auto-generated")}</span>
        </div>
        <p className="mt-3 text-sm leading-6 text-slate-700">{primaryCompany?.ai_ceo_dashboard?.daily_summary || t("AI summary appears once opportunities are enriched. Continue with lead search or company review.")}</p>
      </section>

      <WidgetBoundary name="Main customer actions">
        <CoreActionGrid activeHref={nextStep.href} />
      </WidgetBoundary>

      {!hasAnyData && <WidgetBoundary name="Dashboard onboarding"><EmptyState title={t("Start with one focused lead search.")} copy={t("Choose one country, one city and one industry. OutreachAI will save real companies, analyze websites and prepare outreach only after verified data exists.")} action={<Link href="/dashboard/leads" className="inline-flex min-h-11 items-center justify-center rounded-md bg-brand px-4 text-sm font-bold text-white">{t("Find companies")}</Link>} /></WidgetBoundary>}
    </div>
  );
}

export function LeadFinderPage() {
  const { api, ready, leads, setLeads, loading, error } = useSalesData();
  const leadSearchFormRef = useRef<HTMLFormElement>(null);
  const [searchResults, setSearchResults] = useState<Lead[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [message, setMessage] = useState("");
  const [searchSteps, setSearchSteps] = useState<string[]>([]);
  const [searchSummary, setSearchSummary] = useState<{ found: number; saved: number; duplicates: number } | null>(null);
  const [opportunityReadiness, setOpportunityReadiness] = useState<OpportunityReadiness | null>(null);
  const [searching, setSearching] = useState(false);
  const [commandBusy, setCommandBusy] = useState(false);
  const [leadCommand, setLeadCommand] = useState("");
  const [lastSearchPayload, setLastSearchPayload] = useState<LeadSearchPayload | null>(null);
  const [manualBusy, setManualBusy] = useState(false);
  const [leadSearchStatus, setLeadSearchStatus] = useState<WorkspaceIntegrationStatus["status"] | "unknown">("unknown");
  const [workflowCompanies, setWorkflowCompanies] = useState<CrmCompany[]>([]);
  const [activeWorkflowCompanyId, setActiveWorkflowCompanyId] = useState("");
  const [workflowLoading, setWorkflowLoading] = useState(false);
  const { t } = useI18n();
  const visibleMessage = message;
  const automaticSearchReady = leadSearchStatus === "connected";
  const firstSavedLead = searchResults.find((lead) => lead.crm_company_id || lead.id) || null;
  const nextCompanyHref = firstSavedLead?.crm_company_id ? `/dashboard/companies?company=${firstSavedLead.crm_company_id}` : "/dashboard/companies";
  const [aiFilters, setAiFilters] = useState<LeadAiFilterKey[]>([]);
  const baseLeads = hasSearched ? searchResults : leads;
  const visibleLeads = useMemo(
    () => aiFilters.length ? baseLeads.filter((lead) => aiFilters.every((filter) => leadMatchesAiFilter(lead, filter))) : baseLeads,
    [aiFilters, baseLeads]
  );
  const rankedLeads = useMemo(
    () => [...visibleLeads].sort((a, b) => leadOpportunityScoreForWorkspace(b) - leadOpportunityScoreForWorkspace(a)),
    [visibleLeads]
  );
  const todaysBestLead = rankedLeads[0] || null;
  const activeWorkflowCompany = workflowCompanies.find((company) => company.id === activeWorkflowCompanyId) || null;
  const nextWorkflowLead = activeWorkflowCompanyId
    ? rankedLeads.find((lead) => lead.crm_company_id && lead.crm_company_id !== activeWorkflowCompanyId) || null
    : rankedLeads[0] || null;
  const summaryMetrics = useMemo(() => {
    const list = visibleLeads;
    const hotLeads = list.filter((lead) => leadOpportunityScoreForWorkspace(lead) >= 75).length;
    const buyingSignals = list.filter((lead) => leadBuyingIntentForWorkspace(lead) >= 60).length;
    const readyEmails = list.filter((lead) => safeArray(lead.generated_emails).length > 0).length;
    const meetingsPotential = list.reduce((sum, lead) => sum + leadReplyProbabilityForWorkspace(lead), 0);
    return {
      totalLeads: list.length,
      hotLeads,
      buyingSignals,
      readyEmails,
      meetingsPotential: list.length ? Math.round(meetingsPotential / Math.max(1, list.length)) : 0
    };
  }, [visibleLeads]);

  const syncWorkflowCompanies = useCallback(async () => {
    if (!ready) return;
    setWorkflowLoading(true);
    try {
      const companies = await api<CrmCompany[]>("/api/workspace-app/companies");
      const normalized = safeArray(companies).map(normalizeCrmCompany);
      setWorkflowCompanies(normalized);
      setActiveWorkflowCompanyId((current) => {
        return current && normalized.some((company) => company.id === current) ? current : "";
      });
    } catch (err) {
      reportWidgetFailure(err, "lead-workflow-companies", { endpoint: "/api/workspace-app/companies" });
    } finally {
      setWorkflowLoading(false);
    }
  }, [api, ready]);

  useEffect(() => {
    let cancelled = false;
    async function loadLeadSearchStatus() {
      if (!ready) return;
      try {
        const response = await api<WorkspaceIntegrationStatusResponse>("/api/workspace-app/integrations/status");
        const status = safeArray(response.integrations).find((item) => item.key === "lead_search")?.status || "missing_key";
        if (!cancelled) setLeadSearchStatus(status);
      } catch {
        if (!cancelled) setLeadSearchStatus("error");
      }
    }
    void loadLeadSearchStatus();
    return () => {
      cancelled = true;
    };
  }, [api, ready]);

  useEffect(() => {
    // Initial workflow company sync; updates happen asynchronously inside the callback.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void syncWorkflowCompanies();
  }, [syncWorkflowCompanies]);

  useEffect(() => {
    if (!ready || !hasSearched || !searchResults.some(leadHasRunningWorkflow)) return;
    let cancelled = false;
    const refreshSearchCompanies = async () => {
      try {
        const companies = await api<CrmCompany[]>("/api/workspace-app/companies");
        if (cancelled) return;
        const normalized = safeArray(companies).map(normalizeCrmCompany);
        setWorkflowCompanies(normalized);
        setSearchResults((items) => {
          const visibleIds = new Set(items.map((lead) => lead.crm_company_id).filter(Boolean));
          const updates = normalized.filter((company) => visibleIds.has(company.id)).map(leadFromCrmCompany);
          return updates.length ? mergeLeads(updates, items) : items;
        });
        const visibleCompanies = normalized.filter((company) => searchResults.some((lead) => lead.crm_company_id === company.id));
        if (visibleCompanies.length) setOpportunityReadiness(opportunityReadinessFromCompanies(visibleCompanies));
      } catch (err) {
        reportWidgetFailure(err, "lead-search-enrichment-poll", { endpoint: "/workspace-app/companies" });
      }
    };
    const timer = window.setInterval(() => {
      void refreshSearchCompanies();
    }, 5000);
    void refreshSearchCompanies();
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [api, hasSearched, ready, searchResults]);

  function payloadFromForm(form: HTMLFormElement): LeadSearchPayload {
    const data = new FormData(form);
    return {
      country: String(data.get("country") || ""),
      city: String(data.get("city") || ""),
      industry: String(data.get("industry") || ""),
      category: String(data.get("category") || data.get("industry") || ""),
      keyword: String(data.get("keyword") || ""),
      company_size: String(data.get("company_size") || ""),
      keywords: splitList(String(data.get("keywords") || "")),
      technologies: splitList(String(data.get("technology") || "")),
      radius: Number(data.get("radius") || 10000),
      limit: Number(data.get("limit") || 10)
    };
  }

  function payloadFromCommandFilters(filters?: Partial<LeadSearchPayload> | null): LeadSearchPayload {
    return {
      country: String(filters?.country || ""),
      city: String(filters?.city || ""),
      industry: String(filters?.industry || ""),
      category: String(filters?.category || filters?.industry || ""),
      keyword: String(filters?.keyword || filters?.industry || ""),
      company_size: String(filters?.company_size || ""),
      keywords: safeArray(filters?.keywords).map(String),
      technologies: safeArray(filters?.technologies).map(String),
      radius: Number(filters?.radius || 10000),
      limit: Number(filters?.limit || 10)
    };
  }

  async function prepareManualOpportunity(company: CrmCompany, initialLead: Lead) {
    let currentCompany = normalizeCrmCompany(company);
    let currentLead = initialLead;
    const warnings: string[] = [];
    const applyCompany = (nextCompany?: CrmCompany | null) => {
      if (!nextCompany) return;
      currentCompany = normalizeCrmCompany(nextCompany);
      currentLead = leadFromCrmCompany(currentCompany);
      setLeads((items) => mergeLeads([currentLead], items));
      setSearchResults((items) => mergeLeads([currentLead], items));
      setOpportunityReadiness(opportunityReadinessFromCompanies([currentCompany]));
      setWorkflowCompanies((items) => {
        const next = items.filter((item) => item.id !== currentCompany.id);
        return [currentCompany, ...next];
      });
    };

    setSearchSteps([t("Saved to CRM"), t("Preparing full sales opportunity...")]);
    setMessage(t("OutreachAI is preparing this company automatically..."));
    try {
      const result = await withTimeout(
        api<WorkspaceAppActionResponse>(`/api/workspace-app/companies/${currentCompany.id}/enrichment/restart`, { method: "POST", timeoutMs: 15000 }),
        16000,
        "AI enrichment could not be restarted. The company is saved and you can retry later."
      );
      applyCompany(result.company);
      if (Array.isArray(result.warnings)) warnings.push(...result.warnings.map((item) => t(item)).filter(Boolean));
      if (result.status !== "success") warnings.push(t(result.message || "AI enrichment could not be restarted. The company stays saved in CRM."));
    } catch (err) {
      warnings.push(friendlyErrorMessage(err, "Sales opportunity preparation is temporarily unavailable. The company stays saved."));
    }

    setSearchSteps([
      t("Saved to CRM"),
      t("AI enrichment is running automatically"),
      currentCompany.generated_emails?.length ? t("Email draft ready") : t("Email draft can be generated later")
    ]);
    setMessage(
      warnings.length
        ? `${t("Company saved. OutreachAI prepared everything available and shows what still needs attention.")} ${warnings.slice(0, 2).join(" ")}`
        : t("AI enrichment restarted. This card will update as data arrives.")
    );
    return currentLead;
  }

  async function addManualLead(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const payload = {
      name: String(data.get("company") || "").trim(),
      website: String(data.get("website") || "").trim() || undefined,
      country: String(data.get("country") || "").trim() || undefined,
      city: String(data.get("city") || "").trim() || undefined,
      industry: String(data.get("industry") || "").trim() || undefined,
      contact: String(data.get("contact") || "").trim(),
      email: String(data.get("email") || "").trim() || undefined,
      phone: String(data.get("phone") || "").trim() || undefined,
      status: "New"
    };
    if (!payload.name) {
      setMessage(t("Add the company name before saving."));
      return;
    }
    setManualBusy(true);
    setHasSearched(true);
    setLastSearchPayload(null);
    setSearchSummary(null);
    setOpportunityReadiness(null);
    setSearchResults([]);
    setMessage(t("Saving company to CRM..."));
    setSearchSteps([t("Saving company to CRM...")]);
    try {
      const saved = await withTimeout(
        api<WorkspaceAppCompanyCreateResponse>("/api/workspace-app/companies", { method: "POST", body: JSON.stringify(payload) }),
        30000,
        "Company save timed out. Please try again."
      );
      const lead = leadFromCrmCompany(saved.company);
      setLeads((items) => mergeLeads([lead], items));
      setSearchResults((items) => mergeLeads([lead], items));
      setSearchSummary({ found: 1, saved: saved.status === "reused" ? 0 : 1, duplicates: saved.status === "reused" ? 1 : 0 });
      setOpportunityReadiness(opportunityReadinessFromCompanies([saved.company]));
      setWorkflowCompanies((items) => {
        const normalized = normalizeCrmCompany(saved.company);
        const next = items.filter((item) => item.id !== normalized.id);
        return [normalized, ...next];
      });
      setMessage(t("Company saved. OutreachAI is preparing research, contacts and the first email automatically."));
      setSearchSteps([t("Saved to CRM"), t("Preparing sales opportunity...")]);
      form.reset();
      await prepareManualOpportunity(saved.company, lead);
      trackEvent("manual_lead_created", {
        has_website: Boolean(lead.website || lead.domain),
        has_email: Boolean(lead.email),
        source: "manual"
      });
    } catch (err) {
      if (isSessionExpiredError(err)) {
        redirectToSignIn();
        return;
      }
      const reason = userMessage(err, "Company could not be saved. Check the details and try again.", t);
      setMessage(reason);
      setSearchSteps([t("Save stopped")]);
      trackEvent("manual_lead_create_failed", { reason });
    } finally {
      setManualBusy(false);
    }
  }

  function applyLeadSearchResult(result: WorkspaceAppLeadSearchResponse, payload: LeadSearchPayload, source: "lead_search" | "ai_command") {
    const companies = safeArray(result.companies).map(normalizeCrmCompany);
    const found = companies.map(leadFromCrmCompany);
    const readiness = opportunityReadinessFromCompanies(companies);
    leadFinderDebug("FETCH_FINISHED", { status: result.status, count: found.length, request_id: result.request_id, source });
    const warnings = safeArray(result.warnings);
    const savedCount = Number(result.companies_saved ?? 0);
    const duplicateCount = Number(result.duplicates_skipped ?? 0);
    const persistenceStep = found.length && savedCount === 0 && duplicateCount > 0 ? t("Already in CRM") : found.length ? t("Saved to CRM") : t("No companies found");
    setSearchSteps([
      source === "ai_command" ? t("AI command understood") : t("Lead search finished"),
      t("Found companies count").replace("{count}", String(found.length)),
      persistenceStep,
      found.length ? t("AI enrichment is running automatically") : "",
      ...(warnings.length ? [t("Partial data available")] : [])
    ].filter(Boolean));
    setSearchSummary({
      found: found.length,
      saved: savedCount,
      duplicates: duplicateCount
    });
    setOpportunityReadiness(readiness);
    setLeads((items) => mergeLeads(found, items));
    setSearchResults(found);
    setWorkflowCompanies(companies);
    setLastSearchPayload(payload);
    setMessage(workspaceSearchMessage(result, found.length, t));
    trackEvent(found.length ? "lead_finder_search_completed" : "lead_finder_search_empty", {
      country: payload.country,
      city: payload.city,
      industry: payload.industry,
      result_count: found.length,
      status: result.status,
      source
    });
  }

  async function runLeadSearch(payload: LeadSearchPayload) {
    if (!automaticSearchReady) {
      setHasSearched(true);
      setSearchResults([]);
      setSearchSummary({ found: 0, saved: 0, duplicates: 0 });
      setOpportunityReadiness(null);
      setSearchSteps([t("Automatic search is waiting for setup")]);
      setMessage(t("Automatic company search needs a key. Add one company manually and continue with CRM, research and outreach."));
      return;
    }
    leadFinderDebug("SUBMIT_STARTED", {
      country: payload.country,
      city: payload.city,
      industry: payload.industry,
      limit: payload.limit
    });
    setSearching(true);
    setHasSearched(true);
    setSearchResults([]);
    setSearchSummary(null);
    setOpportunityReadiness(null);
    setLastSearchPayload(payload);
    setSearchSteps([t("Connecting to lead sources...")]);
    setMessage(t("Searching companies..."));
    trackEvent("lead_finder_search_started", {
      country: payload.country,
      city: payload.city,
      industry: payload.industry,
      company_size: payload.company_size,
      radius: payload.radius,
      source: "lead_search"
    });
    try {
      leadFinderDebug("FETCH_STARTED", { endpoint: "/api/workspace-app/leads/search" });
      const result = await withTimeout(
        api<WorkspaceAppLeadSearchResponse>("/api/workspace-app/leads/search", {
          method: "POST",
          body: JSON.stringify(payload),
          timeoutMs: 35000
        }),
        36000,
        "Lead search timed out. Try a smaller radius or broader filters."
      );
      applyLeadSearchResult(result, payload, "lead_search");
    } catch (err) {
      leadFinderDebug("FETCH_FINISHED", { status: "error", reason: err instanceof Error ? err.message : "unknown" });
      if (isSessionExpiredError(err)) {
        redirectToSignIn();
        return;
      }
      const reason = userMessage(err, "Lead search could not be completed.", t);
      setSearchResults([]);
      setSearchSummary(null);
      setOpportunityReadiness(null);
      setSearchSteps([t("Search stopped")]);
      setMessage(reason);
      trackEvent("lead_finder_search_failed", {
        country: payload.country,
        city: payload.city,
        industry: payload.industry,
        source: "lead_search",
        reason
      });
    } finally {
      setSearching(false);
    }
  }

  async function runLeadCommand() {
    const command = leadCommand.trim();
    if (!command || commandBusy || searching) return;
    if (!automaticSearchReady) {
      setHasSearched(true);
      setSearchSteps([t("Automatic search is waiting for setup")]);
      setMessage(t("Automatic company search needs a key. Add one company manually and continue with CRM, research and outreach."));
      return;
    }
    setCommandBusy(true);
    setHasSearched(true);
    setSearchResults([]);
    setSearchSummary(null);
    setOpportunityReadiness(null);
    setLastSearchPayload(null);
    setSearchSteps([t("AI is turning your request into search filters")]);
    setMessage(t("Preparing AI search..."));
    trackEvent("lead_command_started", { source: "ai_command" });
    try {
      leadFinderDebug("FETCH_STARTED", { endpoint: "/api/workspace-app/leads/command" });
      const result = await withTimeout(
        api<WorkspaceAppLeadCommandResponse>("/api/workspace-app/leads/command", {
          method: "POST",
          body: JSON.stringify({ command }),
          timeoutMs: 45000
        }),
        46000,
        "AI search timed out. Try a shorter command or use the fields below."
      );
      const parsedPayload = payloadFromCommandFilters(result.filters);
      if (result.status === "error" && !result.companies?.length) {
        setSearchSteps([t("AI needs clearer search details")]);
        setMessage(t(result.message || "Add a city, country and industry, then try again."));
        setSearchSummary(null);
        setOpportunityReadiness(null);
        return;
      }
      applyLeadSearchResult(result, parsedPayload, "ai_command");
    } catch (err) {
      leadFinderDebug("FETCH_FINISHED", { status: "error", reason: err instanceof Error ? err.message : "unknown", source: "ai_command" });
      if (isSessionExpiredError(err)) {
        redirectToSignIn();
        return;
      }
      const reason = userMessage(err, "AI search could not be completed. Use the fields below or try again.", t);
      setSearchResults([]);
      setSearchSummary(null);
      setOpportunityReadiness(null);
      setSearchSteps([t("Search stopped")]);
      setMessage(reason);
      trackEvent("lead_command_failed", { source: "ai_command", reason });
    } finally {
      setCommandBusy(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    leadFinderDebug("FORM_VALID");
    await runLeadSearch(payloadFromForm(event.currentTarget));
  }

  async function clickLeadSearch() {
    leadFinderDebug("BUTTON_CLICKED");
    const form = leadSearchFormRef.current;
    if (!form || searching) return;
    if (!form.reportValidity()) return;
    leadFinderDebug("FORM_VALID");
    await runLeadSearch(payloadFromForm(form));
  }

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Lead Finder" title="Find real companies and turn each into a sales opportunity." copy="Search one focused market. OutreachAI saves real companies to CRM and prepares the best next action." />
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {[
          ["Total Leads", summaryMetrics.totalLeads],
          ["Hot Leads", summaryMetrics.hotLeads],
          ["Buying Signals", summaryMetrics.buyingSignals],
          ["Ready Emails", summaryMetrics.readyEmails],
          ["Meetings Potential", `${summaryMetrics.meetingsPotential}%`]
        ].map(([label, value]) => (
          <article key={String(label)} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-black uppercase tracking-wide text-slate-500">{t(String(label))}</p>
            <p className="mt-2 text-2xl font-black tracking-tight text-ink">{value}</p>
          </article>
        ))}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-black text-ink">{t("AI Filters")}</h2>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("Rank by what matters now")}</p>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {[
            ["high_opportunity", "🔥 High Opportunity"],
            ["buying_intent", "📈 Buying Intent"],
            ["ready_to_contact", "📬 Ready to Contact"],
            ["needs_review", "⚠ Needs Review"],
            ["high_confidence", "🟢 High Confidence"],
            ["missing_data", "⚪ Missing Data"]
          ].map(([key, label]) => {
            const active = aiFilters.includes(key as LeadAiFilterKey);
            return (
              <button
                key={String(key)}
                type="button"
                onClick={() => setAiFilters((current) => current.includes(key as LeadAiFilterKey) ? current.filter((item) => item !== key) : [...current, key as LeadAiFilterKey])}
                className={`inline-flex min-h-10 items-center justify-center rounded-full border px-4 text-sm font-bold transition ${active ? "border-brand bg-teal-50 text-brand" : "border-slate-300 bg-white text-slate-700 hover:border-slate-400"}`}
              >
                {t(String(label))}
              </button>
            );
          })}
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-6">
          {!automaticSearchReady && <IntegrationStatusPanel api={api} ready={ready} />}
          {automaticSearchReady && <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <p className="text-sm font-black uppercase text-brand">{t("Natural language search")}</p>
                <h2 className="mt-2 text-xl font-black tracking-tight text-ink">{t("Describe your ideal companies in one sentence.")}</h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-700">{t("OutreachAI parses your request with existing backend search, ranks the results, and saves valid companies to CRM.")}</p>
              </div>
              <span className="w-fit rounded-full bg-teal-50 px-3 py-1 text-xs font-black text-brand">{t("AI-first")}</span>
            </div>
            <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
              <textarea
                value={leadCommand}
                onChange={(event) => setLeadCommand(event.target.value)}
                disabled={!automaticSearchReady || commandBusy || searching}
                rows={2}
                placeholder={t("Find SaaS companies hiring SDRs in Germany.")}
                className="min-h-20 w-full resize-none rounded-xl border border-slate-300 px-4 py-3 text-sm leading-6 text-ink shadow-sm outline-none focus:border-brand disabled:bg-slate-100 disabled:text-slate-500"
              />
              <button
                type="button"
                onClick={runLeadCommand}
                disabled={!leadCommand.trim() || !automaticSearchReady || commandBusy || searching}
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-ink px-5 text-sm font-black text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
              >
                {commandBusy ? <Loader2 className="animate-spin" size={17} /> : <Sparkles size={17} />}
                {commandBusy ? t("Running AI search") : t("Run AI search")}
              </button>
            </div>
          </section>}

          <ActionPanel eyebrow="Lead search" title="Start with one narrow market." copy="Use the required fields first. Advanced filters stay hidden until a search is too broad or too narrow. Every valid result is saved to your private CRM.">
          {!automaticSearchReady && (
            <div id="lead-search-setup" className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4">
              <p className="text-sm font-black uppercase text-amber-800">{t("Automatic search setup")}</p>
              <h2 className="mt-2 text-lg font-black text-ink">{t("Automatic search is waiting for setup")}</h2>
              <p className="mt-2 text-sm leading-6 text-amber-900">{t("Automatic company search needs a key. Add one company manually and continue with CRM, research and outreach.")}</p>
              <div className="mt-4 flex flex-col gap-3 min-[430px]:flex-row">
                <Link href="#manual-company" className="inline-flex min-h-11 items-center justify-center rounded-xl bg-brand px-4 text-sm font-black text-white shadow-sm">{t("Add company manually")}</Link>
                <Link href="/dashboard/settings#lead-search-key" className="inline-flex min-h-11 items-center justify-center rounded-xl border border-amber-300 bg-white px-4 text-sm font-black text-amber-900 shadow-sm">{t("Add key")}</Link>
              </div>
            </div>
          )}
          <form id="lead-search-form" ref={leadSearchFormRef} aria-label="Lead search" onSubmit={submit} className="space-y-5">
            <div className="mb-5 rounded-xl bg-teal-50 p-4">
              <p className="text-sm font-bold text-brand">{t("Step 1 of 3 · Choose a focused market")}</p>
              <p className="mt-1 text-sm leading-6 text-slate-700">{t("Use one country, one city and one industry. A narrower search creates better opportunities faster.")}</p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="text-sm font-semibold text-slate-700">{t("Country")}<input name="country" required disabled={!automaticSearchReady} placeholder="Germany" className="mt-2 min-h-11 w-full rounded-md border border-slate-300 px-3 text-sm disabled:bg-slate-100 disabled:text-slate-500" /></label>
              <label className="text-sm font-semibold text-slate-700">{t("City")}<input name="city" required disabled={!automaticSearchReady} placeholder="Berlin" className="mt-2 min-h-11 w-full rounded-md border border-slate-300 px-3 text-sm disabled:bg-slate-100 disabled:text-slate-500" /></label>
              <label className="text-sm font-semibold text-slate-700">{t("Industry")}<input name="industry" required disabled={!automaticSearchReady} placeholder="Construction" className="mt-2 min-h-11 w-full rounded-md border border-slate-300 px-3 text-sm disabled:bg-slate-100 disabled:text-slate-500" /></label>
              <label className="text-sm font-semibold text-slate-700">{t("Company size")}<input name="company_size" disabled={!automaticSearchReady} placeholder="11-50" className="mt-2 min-h-11 w-full rounded-md border border-slate-300 px-3 text-sm disabled:bg-slate-100 disabled:text-slate-500" /></label>
              <label className="text-sm font-semibold text-slate-700">{t("Number of leads")}<input name="limit" type="number" min="1" max="25" defaultValue="10" disabled={!automaticSearchReady} className="mt-2 min-h-11 w-full rounded-md border border-slate-300 px-3 text-sm disabled:bg-slate-100 disabled:text-slate-500" /></label>
            </div>
            <details className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <summary className="cursor-pointer text-sm font-bold text-ink">{t("Advanced settings")}</summary>
              <p className="mt-2 text-sm text-slate-600">{t("Use these only when the first search is too broad or too narrow.")}</p>
              <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <label className="text-sm font-semibold text-slate-700">{t("Business category")}<input name="category" placeholder="Construction company" className="mt-2 min-h-11 w-full rounded-md border border-slate-300 px-3 text-sm" /></label>
                <label className="text-sm font-semibold text-slate-700">{t("Keyword")}<input name="keyword" placeholder="renovation, contractor" className="mt-2 min-h-11 w-full rounded-md border border-slate-300 px-3 text-sm" /></label>
                <label className="text-sm font-semibold text-slate-700">{t("Extra keywords")}<input name="keywords" placeholder="commercial, builders" className="mt-2 min-h-11 w-full rounded-md border border-slate-300 px-3 text-sm" /></label>
                <label className="text-sm font-semibold text-slate-700">{t("Technology")}<input name="technology" placeholder="WordPress, Shopify" className="mt-2 min-h-11 w-full rounded-md border border-slate-300 px-3 text-sm" /></label>
                <label className="text-sm font-semibold text-slate-700">{t("Contact role")}<input name="contact_role" placeholder="Owner, Founder, CEO" className="mt-2 min-h-11 w-full rounded-md border border-slate-300 px-3 text-sm" /></label>
                <label className="text-sm font-semibold text-slate-700">{t("Radius meters")}<input name="radius" type="number" defaultValue="10000" className="mt-2 min-h-11 w-full rounded-md border border-slate-300 px-3 text-sm" /></label>
              </div>
            </details>
            <div className="mt-5 flex flex-col gap-3 min-[430px]:flex-row min-[430px]:items-center">
              <PrimaryButton type="button" disabled={searching || !automaticSearchReady} onClick={clickLeadSearch}>{searching ? <Loader2 className="animate-spin" size={17} /> : <Search size={17} />} {searching ? t("Searching") : t("Find leads")}</PrimaryButton>
              <p className="text-sm text-slate-600">{t("Expected time: 20-30 seconds. Saved companies will stay after refresh.")}</p>
            </div>
            {visibleMessage && (!searchSummary || searching) && <div className="mt-4 flex flex-col gap-3 rounded-xl bg-slate-50 p-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm font-semibold text-slate-700">{visibleMessage}</p>
              {hasSearched && !searching && lastSearchPayload && searchResults.length === 0 && (
                <button type="button" onClick={() => {
                  leadFinderDebug("BUTTON_CLICKED", { action: "retry" });
                  runLeadSearch(lastSearchPayload);
                }} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-bold text-ink shadow-sm">
                  <Search size={16} /> {t("Retry search")}
                </button>
              )}
            </div>}
            {searchSummary && <div className="mt-4 space-y-3" aria-label={t("Lead search summary")}>
              <p className="rounded-xl border border-teal-200 bg-teal-50 p-3 text-sm font-bold text-brand" aria-live="polite">
                {searchSummary.found > 0 && searchSummary.saved === 0 && searchSummary.duplicates > 0
                  ? t("Found companies already in CRM").replace("{count}", String(searchSummary.found))
                  : searchSummary.found > 0 && searchSummary.saved > 0 && searchSummary.duplicates > 0
                    ? t("Found companies added and reused").replace("{count}", String(searchSummary.found)).replace("{saved}", String(searchSummary.saved)).replace("{duplicates}", String(searchSummary.duplicates))
                    : searchSummary.found > 0
                      ? t("Found companies saved to CRM").replace("{count}", String(searchSummary.found))
                      : t("No results. Try a broader city, industry, radius, or fewer filters.")}
              </p>
              {hasSearched && !searching && lastSearchPayload && searchSummary.found === 0 && (
                <button type="button" onClick={() => {
                  leadFinderDebug("BUTTON_CLICKED", { action: "retry" });
                  runLeadSearch(lastSearchPayload);
                }} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-bold text-ink shadow-sm sm:w-auto">
                  <Search size={16} /> {t("Retry search")}
                </button>
              )}
              <div className="grid gap-2 sm:grid-cols-3">
                {[
                  ["Companies found", searchSummary.found],
                  ["Saved to CRM", searchSummary.saved],
                  ["Duplicates skipped", searchSummary.duplicates]
                ].map(([label, value]) => (
                  <div key={String(label)} className="rounded-xl border border-slate-200 bg-white p-3 text-sm shadow-sm">
                    <p className="font-bold text-ink">{value}</p>
                    <p className="mt-1 text-slate-600">{t(String(label))}</p>
                  </div>
                ))}
              </div>
            </div>}
            {opportunityReadiness && opportunityReadiness.total > 0 && <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" aria-label={t("Opportunity readiness")}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-xs font-black uppercase tracking-wide text-brand">{t("Automatic preparation")}</p>
                  <h3 className="mt-2 text-lg font-black text-ink">
                    {t("OutreachAI prepared what it could from real data.")}
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    {t("Review one company, fill missing contact details if needed, then approve the email before anything is sent.")}
                  </p>
                </div>
                <span className="w-fit rounded-full bg-teal-50 px-3 py-1 text-xs font-black text-brand">
                  {opportunityReadiness.ready}/{opportunityReadiness.total} {t("ready for review")}
                </span>
              </div>
              <div className="mt-4 grid gap-2 sm:grid-cols-3">
                {[
                  ["Website research", opportunityReadiness.researched],
                  ["Verified emails", opportunityReadiness.verifiedEmails],
                  ["Email drafts", opportunityReadiness.drafts]
                ].map(([label, value]) => (
                  <div key={String(label)} className="rounded-xl bg-slate-50 p-3 text-sm">
                    <p className="font-black text-ink">{value}/{opportunityReadiness.total}</p>
                    <p className="mt-1 text-slate-600">{t(String(label))}</p>
                  </div>
                ))}
              </div>
            </section>}
            {hasSearched && !searching && searchResults.length > 0 && <section className="mt-4 rounded-2xl border border-teal-200 bg-teal-50 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-xs font-black uppercase tracking-wide text-brand">{t("Next step")}</p>
                  <h3 className="mt-2 text-lg font-black text-ink">{t("Continue with the first saved company")}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-700">{t("Open the company workspace to analyze the website, find contacts and prepare the first email for review.")}</p>
                </div>
                <Link href={nextCompanyHref} className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-md bg-brand px-4 text-sm font-bold text-white shadow-sm">
                  {t("Open company workspace")}
                  <ArrowRight size={16} />
                </Link>
              </div>
            </section>}
            {searchSteps.length > 0 && <ol className="mt-4 grid gap-2 text-sm sm:grid-cols-3" aria-label="Lead search progress">
              {searchSteps.map((step, index) => <li key={`${step}-${index}`} className="flex items-center gap-2 rounded-xl bg-teal-50 p-3 font-semibold text-brand"><CheckCircle2 size={16} />{step}</li>)}
            </ol>}
          </form>
          </ActionPanel>

          <details id="manual-company" open={!automaticSearchReady} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <summary className="cursor-pointer list-none">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-sm font-bold uppercase text-brand">{t("Backup path")}</p>
              <h2 className="mt-1 text-xl font-bold text-ink">{t("Add one real company first.")}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">{t("This is the fastest reliable path: save one real company, then run research and outreach from its opportunity card.")}</p>
            </div>
            <span className="w-fit rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">{t("Takes 20 seconds")}</span>
          </div>
        </summary>
        <div className="mt-5 border-t border-slate-100 pt-5">
          <div>
            <p className="text-sm font-semibold text-slate-600">{t("Use manual entry only when you already know the company. Lead search stays the main path.")}</p>
          </div>
        <form aria-label="Manual company entry" onSubmit={addManualLead} className="mt-4 space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="text-sm font-semibold text-slate-700">{t("Company name")}<input name="company" required placeholder="Acme Construction" className="mt-2 min-h-11 w-full rounded-md border border-slate-300 px-3 text-sm" /></label>
            <label className="text-sm font-semibold text-slate-700">{t("Website")}<input name="website" placeholder="https://company.com" className="mt-2 min-h-11 w-full rounded-md border border-slate-300 px-3 text-sm" /></label>
          </div>
          <details className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <summary className="cursor-pointer text-sm font-bold text-ink">{t("Optional details")}</summary>
            <p className="mt-2 text-sm text-slate-600">{t("Add contact details only if you already know them. You can fill missing data later from the company card.")}</p>
            <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <label className="text-sm font-semibold text-slate-700">{t("Country")}<input name="country" placeholder="Germany" className="mt-2 min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm" /></label>
              <label className="text-sm font-semibold text-slate-700">{t("City")}<input name="city" placeholder="Berlin" className="mt-2 min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm" /></label>
              <label className="text-sm font-semibold text-slate-700">{t("Industry")}<input name="industry" placeholder="Construction" className="mt-2 min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm" /></label>
              <label className="text-sm font-semibold text-slate-700">{t("Decision maker")}<input name="contact" placeholder="Owner or founder" className="mt-2 min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm" /></label>
              <label className="text-sm font-semibold text-slate-700">{t("Email")}<input name="email" type="email" placeholder="name@company.com" className="mt-2 min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm" /></label>
              <label className="text-sm font-semibold text-slate-700">{t("Phone")}<input name="phone" placeholder="+49..." className="mt-2 min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm" /></label>
            </div>
          </details>
          <div>
            <PrimaryButton type="submit" disabled={manualBusy}>{manualBusy ? <Loader2 className="animate-spin" size={17} /> : <Plus size={17} />} {t("Save and prepare opportunity")}</PrimaryButton>
          </div>
        </form>
        </div>
      </details>
          {searching ? <LoadingSkeleton title="Searching companies" /> : loading && !hasSearched ? <LoadingSkeleton title="Loading saved companies." /> : error && !hasSearched ? <EmptyState title="Lead data unavailable" copy={error} /> : visibleLeads.length ? <div className="grid gap-5">{rankedLeads.map((lead) => <OpportunityCard key={`${lead.id || lead.place_id || lead.company}:${lead.generated_emails?.[0]?.id || "no-draft"}:${lead.generated_emails?.[0]?.delivery_status || ""}`} lead={lead} api={api} onLeadUpdated={(updated) => {
            setLeads((items) => items.map((item) => item.id === updated.id ? updated : item));
            setSearchResults((items) => items.map((item) => item.id === updated.id ? updated : item));
          }} onOpenWorkflow={setActiveWorkflowCompanyId} />)}</div> : <EmptyState title={hasSearched || aiFilters.length ? "No matching companies found" : "No real leads yet"} copy={hasSearched || aiFilters.length ? "No companies matched those filters. Broaden the city, category, or radius and search again." : "Run a lead search or add a company manually. No demo companies are shown."} />}

          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-sm font-black uppercase tracking-wide text-brand">{t("Autonomous AI Sales Workspace")}</p>
                <h2 className="mt-1 text-2xl font-black tracking-tight text-ink">{t("Decide the next action in under 30 seconds.")}</h2>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{t("Open one lead, review AI summary, decision maker, buying intent, opportunity score, competitor snapshot, email draft, review, send, schedule follow-up, and continue to the next lead without leaving this screen.")}</p>
              </div>
              <div className="flex flex-col gap-2 sm:items-end">
                {nextWorkflowLead?.crm_company_id ? <button type="button" onClick={() => setActiveWorkflowCompanyId(nextWorkflowLead.crm_company_id || "")} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-brand px-4 text-sm font-bold text-white">{t("Return to Next Lead")} <ArrowRight size={16} /></button> : null}
                {activeWorkflowCompany ? <button type="button" onClick={() => setActiveWorkflowCompanyId("")} className="inline-flex min-h-11 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-bold text-ink">{t("Hide workflow")}</button> : null}
              </div>
            </div>
            <div className="mt-5">
              {workflowLoading && !activeWorkflowCompany ? <LoadingSkeleton title="Loading company workflow" /> : activeWorkflowCompany ? <CrmCompanyCard company={activeWorkflowCompany} api={api} highlighted onOpenNextLead={nextWorkflowLead?.crm_company_id ? () => setActiveWorkflowCompanyId(nextWorkflowLead.crm_company_id || "") : undefined} nextLeadName={nextWorkflowLead?.company || ""} /> : <EmptyState title="Select one lead to continue the workflow" copy="Open a company from the lead cards above. The full Autonomous AI Sales Workspace will load here without page switching." />}
            </div>
          </section>
        </div>

        <aside className="space-y-4 xl:sticky xl:top-24 xl:self-start">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-black uppercase tracking-wide text-brand">{t("Today's Best Lead")}</p>
            {todaysBestLead ? (
              <>
                <p className="mt-2 text-lg font-black text-ink">{todaysBestLead.company}</p>
                <div className="mt-4 space-y-3 text-sm">
                  <div className="rounded-xl bg-slate-50 p-3">
                    <p className="text-xs font-black uppercase text-slate-500">{t("Why now")}</p>
                    <p className="mt-1 font-semibold leading-6 text-slate-800">{leadTopOpportunityForWorkspace(todaysBestLead)}</p>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-3">
                    <p className="text-xs font-black uppercase text-slate-500">{t("Suggested first action")}</p>
                    <p className="mt-1 font-semibold leading-6 text-slate-800">{leadRecommendedActionForWorkspace(todaysBestLead)}</p>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-3">
                    <p className="text-xs font-black uppercase text-slate-500">{t("Expected reply probability")}</p>
                    <p className="mt-1 text-xl font-black text-ink">{leadReplyProbabilityForWorkspace(todaysBestLead)}%</p>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-3">
                    <p className="text-xs font-black uppercase text-slate-500">{t("AI recommendation")}</p>
                    <p className="mt-1 font-semibold leading-6 text-slate-800">{leadSummaryForWorkspace(todaysBestLead)}</p>
                  </div>
                </div>
                <Link href={todaysBestLead.crm_company_id ? `/dashboard/companies?company=${todaysBestLead.crm_company_id}` : "/dashboard/companies"} className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-md bg-brand px-4 text-sm font-bold text-white">
                  {t("Open Company")}
                </Link>
              </>
            ) : (
              <p className="mt-2 text-sm leading-6 text-slate-600">{t("Run lead search to surface the top-ranked opportunity for today.")}</p>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}

function leadFromCrmCompany(company: CrmCompany): Lead {
  const contactMetadata = {
    contact_search_checked_at: company.contact_search_checked_at || undefined,
    contact_search_status: company.contact_search_status || undefined,
    contact_search_message: company.contact_search_message || undefined,
    decision_maker_roles_searched: company.decision_maker_roles_searched?.length ? company.decision_maker_roles_searched : undefined,
    pain_points: company.pain_points?.length ? company.pain_points : undefined,
    services: company.services?.length ? company.services : undefined,
    weaknesses: company.weaknesses?.length ? company.weaknesses : undefined,
    icp_score: company.icp_score ?? undefined,
    value_proposition: company.value_proposition || undefined,
    recommended_cta: company.recommended_cta || undefined,
    follow_up_strategy: company.follow_up_strategy || undefined
  };
  const noteMetadata = Object.values(contactMetadata).some(Boolean) ? JSON.stringify(contactMetadata) : company.notes[0]?.body || null;
  return {
    id: company.lead_id || undefined,
    crm_company_id: company.id,
    company: company.name,
    website: company.website,
    domain: company.domain,
    industry: company.industry,
    country: company.country,
    city: company.city,
    contact: company.contacts[0]?.name || null,
    email: company.email || company.contacts[0]?.email || null,
    phone: company.phone || company.contacts[0]?.phone || null,
    linkedin: company.contacts[0]?.linkedin || null,
    status: company.crm_stage,
    notes: noteMetadata,
    google_rating: company.google_rating,
    place_id: company.place_id,
    hunter_verified: company.contacts.some((contact) => contact.source === "hunter" && contact.email_status === "Verified"),
    source: company.source,
    ai_summary: company.ai_summary,
    pain_points: company.pain_points,
    services: company.services,
    weaknesses: company.weaknesses,
    icp_score: company.icp_score,
    value_proposition: company.value_proposition,
    suggested_offer: company.suggested_offer,
    outreach_strategy: company.outreach_strategy,
    sales_angle: company.sales_angle,
    recommended_cta: company.recommended_cta,
    follow_up_strategy: company.follow_up_strategy,
    expected_reply_rate: company.expected_reply_rate,
    generated_emails: company.generated_emails,
    created_at: company.created_at,
    found_at: company.found_at,
    saved_to_crm_at: company.saved_to_crm_at,
    website_analyzed_at: company.website_analyzed_at,
    contact_found_at: company.contact_found_at,
    email_generated_at: company.email_generated_at,
    email_approved_at: company.email_approved_at,
    email_sent_at: company.email_sent_at,
    delivered_at: company.delivered_at,
    opened_at: company.opened_at,
    replied_at: company.replied_at,
    last_activity_at: company.last_activity_at || company.updated_at,
    stage_changed_at: company.stage_changed_at
  };
}

function CrmFilters({ filters, setFilters }: { filters: Record<string, string>; setFilters: (filters: { search: string; city: string; country: string; industry: string; stage: string; email_status: string; source: string }) => void }) {
  const { t } = useI18n();
  const update = (key: string, value: string) => setFilters({ search: "", city: "", country: "", industry: "", stage: "", email_status: "", source: "", ...filters, [key]: value });
  return <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
    <p className="text-sm font-bold text-ink">{t("Search and filter CRM")}</p>
    <div className="mt-3 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
      <input value={filters.search} onChange={(event) => update("search", event.target.value)} placeholder={t("Company or website")} className="min-h-11 rounded-md border border-slate-300 px-3 text-sm" />
      <input value={filters.city} onChange={(event) => update("city", event.target.value)} placeholder={t("City")} className="min-h-11 rounded-md border border-slate-300 px-3 text-sm" />
      <input value={filters.country} onChange={(event) => update("country", event.target.value)} placeholder={t("Country")} className="min-h-11 rounded-md border border-slate-300 px-3 text-sm" />
      <input value={filters.industry} onChange={(event) => update("industry", event.target.value)} placeholder={t("Industry")} className="min-h-11 rounded-md border border-slate-300 px-3 text-sm" />
      <input value={filters.stage} onChange={(event) => update("stage", event.target.value)} placeholder={t("Stage")} className="min-h-11 rounded-md border border-slate-300 px-3 text-sm" />
      <input value={filters.source} onChange={(event) => update("source", event.target.value)} placeholder={t("Data type")} className="min-h-11 rounded-md border border-slate-300 px-3 text-sm" />
    </div>
  </section>;
}

function companyHealthScore(company: CrmCompany) {
  const sentAt = currentEmailSentAt(company);
  const hasVerifiedEmail = Boolean(company.email || company.contacts.some((contact) => contact.email));
  const checks = [
    Boolean(company.website || company.domain),
    Boolean(company.address || company.city || company.country),
    Boolean(company.phone),
    hasVerifiedEmail,
    Boolean(company.contacts.length),
    Boolean(company.ai_summary),
    Boolean(company.suggested_offer || company.sales_angle),
    Boolean(company.generated_emails.length),
    Boolean(company.email_approved_at || company.generated_emails.some((email) => email.delivery_status === "approved" || email.delivery_status === "sent")),
    Boolean(sentAt),
    Boolean(company.replied_at || company.crm_stage === "Replied" || company.crm_stage === "Meeting Scheduled" || company.crm_stage === "Won"),
    Boolean(company.notes.length || company.activity.length),
  ];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}

function companyNextAction(company: CrmCompany) {
  const sentAt = currentEmailSentAt(company);
  const hasContact = Boolean(company.email || company.contacts.some((contact) => contact.email));
  const hasDraft = Boolean(company.generated_emails.length);
  const hasApproved = Boolean(company.email_approved_at || company.generated_emails.some((email) => email.delivery_status === "approved" || email.delivery_status === "sent"));
  const hasSent = Boolean(sentAt);
  if (!company.website && !company.domain) return "Add a website so OutreachAI can research this company.";
  if (!company.ai_summary) return "Run company research to create the sales angle.";
  if (!hasContact) return "Find or add a verified email before preparing outreach.";
  if (!hasDraft) return "Generate a personalized email for review.";
  if (!hasApproved) return "Review and approve the prepared email.";
  if (!hasSent) return "Send the approved email when you are ready.";
  if (!company.replied_at) return "Watch for replies and follow up from the inbox.";
  if (company.crm_stage !== "Meeting Scheduled" && company.crm_stage !== "Won") return "Move the opportunity to the next CRM stage.";
  return "Keep notes updated and close the outcome.";
}

function companySalesBrief(company: CrmCompany, healthScore: number) {
  const hasContact = Boolean(company.email || company.contacts.some((contact) => contact.email));
  const hasResearch = Boolean(company.ai_summary || company.sales_angle || company.opportunity_analysis || company.partnership_fit);
  const hasDraft = Boolean(company.generated_emails.length);
  const hasApproved = Boolean(company.email_approved_at || company.generated_emails.some((email) => email.delivery_status === "approved" || email.delivery_status === "sent"));
  const intelligence = company.intelligence_quality || {};
  const companyIntelligence = company.company_intelligence || {};
  const qualitySources = uniqueStrings([
    ...safeArray(intelligence.used_sources).map(String),
    ...safeArray(companyIntelligence.sources).map(String),
  ]);
  const qualityBasis = uniqueStrings(safeArray(intelligence.decision_basis).map(String));
  const qualityGaps = uniqueStrings(safeArray(intelligence.gaps).map(String));
  const providerImprovements = uniqueStrings(safeArray(intelligence.provider_improvements).map(String));
  const deepSearch = company.deep_contact_search || {};
  const deepSelected = deepSearch.selected_decision_maker || undefined;
  const technologies = safeArray(company.technologies).map(String).filter(Boolean);
  const score = Math.max(0, Math.min(100, Math.round(((company.priority_score || healthScore) + (company.confidence_score || intelligence.confidence_score || healthScore) + (company.icp_score || healthScore)) / 3)));
  const draft = latestCompanyEmail(company);
  const painPoints = safeArray(company.pain_points).filter(Boolean);
  const services = safeArray(company.services).filter(Boolean);
  const buyingSignals = safeArray(company.buying_signals).filter(Boolean);
  const risks = safeArray(company.risks).filter(Boolean);
  const fit =
    score >= 75
      ? "Strong opportunity"
      : score >= 55
        ? "Promising opportunity"
        : "Needs more data";
  const decision =
    score >= 70 && hasResearch && hasContact
      ? "Work this lead now"
      : hasResearch || score >= 55
        ? "Research before outreach"
        : "Do not spend time yet";
  const whatTheyDo =
    company.ai_summary ||
    (services.length ? services.slice(0, 3).join(", ") : "") ||
    [company.industry, company.city, company.country].filter(Boolean).join(" · ") ||
    "CRM profile is saved, but website research is still needed to explain the business precisely.";
  const whyFit =
    company.partnership_fit ||
    company.opportunity_analysis ||
    company.sales_angle ||
    company.ai_summary ||
    (company.industry ? "The company matches the selected target market; verify the website and contact before outreach." : "Potential fit is not proven yet; verify the company website and decision maker before spending sales time.");
  const likelyNeed =
    painPoints[0] ||
    company.value_proposition ||
    company.weaknesses?.[0] ||
    (hasResearch ? "Use the AI research above as the strongest current need signal." : "Likely need is still an inference until website research is complete.");
  const whyUs =
    company.suggested_offer ||
    company.outreach_strategy ||
    company.sales_angle ||
    "OutreachAI can turn the saved company profile into a researched, review-ready outreach path without manual tab switching.";
  const opener =
    company.recommended_cta ||
    company.sales_angle ||
    buyingSignals[0] ||
    "Open with a short, specific question about their current growth priorities.";
  const firstMessage =
    cleanGeneratedText(draft?.body || draft?.preview || "") ||
    "Generate the first email to see the recommended message.";
  const firstMessageSubject = draft?.subject || "First personalized message";
  const replyProbability = company.expected_reply_rate || `${Math.max(10, Math.min(80, Math.round(score * 0.65)))}%`;
  const replyReason =
    intelligence.confidence_reason ||
    (company.expected_reply_rate
      ? "AI estimated this from the company fit, available contact data and personalization strength."
      : hasResearch && hasContact
        ? "AI has enough company and contact context to estimate a practical reply chance."
        : "The estimate is conservative because company research or verified contact data is still missing.");
  const blocker = !hasResearch
    ? "Company research is missing."
    : !hasContact
      ? "Decision maker or verified email is missing."
      : !hasDraft
        ? "Personalized email is not prepared."
        : !hasApproved
          ? "Email is waiting for approval."
          : "No blocker for the current stage.";
  const meetingPrep = hasResearch
    ? (company.suggested_offer || company.outreach_strategy || company.next_recommended_action || "Use the AI research to open with a specific business improvement.")
    : "Run AI research first, then use the summary and offer to prepare a call.";
  const nextBestAction = companyNextAction(company);
  const decisionReason = intelligence.coverage_summary || (
    decision === "Work this lead now"
      ? "The company has enough research, a reachable contact path and a clear personalized angle."
      : decision === "Research before outreach"
        ? "The company looks relevant, but one missing field could reduce reply quality."
        : "The lead is saved, but there is not enough verified context to justify outreach yet."
  );
  const strongestSignals = uniqueStrings([
    ...buyingSignals,
    ...qualityBasis,
    ...qualitySources,
    deepSelected?.title ? "Selected decision maker role is available." : "",
    technologies.length ? "Technology data is available for personalization." : "",
    company.website || company.domain ? "Website available for personalization" : "",
    company.google_rating ? "Public reputation signal available" : "",
    hasContact ? "Contact path available" : "",
    company.generated_emails.length ? "Personalized draft prepared" : "",
  ]).slice(0, 3);
  const topRisks = uniqueStrings([
    ...risks,
    ...qualityGaps,
    !hasContact ? "No verified decision-maker email yet" : "",
    !hasResearch ? "Company research is incomplete" : "",
    !hasApproved ? "Message still needs human approval" : "",
  ]).slice(0, 3);
  const actionPlan = uniqueStrings([
    nextBestAction,
    hasContact ? "Review the first message against the sales angle." : "Find or add the decision maker before sending.",
    hasApproved ? "Send the approved email and track reply intent." : "Approve only after the message is specific and safe to send.",
  ]).slice(0, 3);
  return { score, fit, decision, decisionReason, strongestSignals, topRisks, actionPlan, whatTheyDo, whyFit, likelyNeed, whyUs, opener, firstMessageSubject, firstMessage, replyProbability, replyReason, blocker, meetingPrep, nextBestAction, qualitySources, qualityGaps, providerImprovements, technologies };
}

function companyPrimaryAction(company: CrmCompany) {
  const sentAt = currentEmailSentAt(company);
  const hasContact = Boolean(company.email || company.contacts.some((contact) => contact.email));
  const hasDraft = Boolean(company.generated_emails.length);
  const hasApproved = Boolean(company.email_approved_at || company.generated_emails.some((email) => email.delivery_status === "approved" || email.delivery_status === "sent"));
  if (!company.website && !company.domain) {
    return {
      label: "Add website details",
      copy: "Add a website or domain first so company research can stay accurate.",
      target: `#profile-${company.id}`,
      icon: Globe2
    };
  }
  if (!company.ai_summary) {
    return {
      label: "Complete sales research",
      copy: "Analyze the website, find contacts and prepare the first email in one guided step.",
      action: "prepare-company",
      target: `#outreach-${company.id}`,
      icon: Sparkles
    };
  }
  if (!hasDraft) {
    return {
      label: "Complete sales research",
      copy: "Analyze the website, find contacts and prepare the first email in one guided step.",
      action: "prepare-company",
      target: `#outreach-${company.id}`,
      icon: Sparkles
    };
  }
  if (!hasContact) {
    return {
      label: "Add email manually",
      copy: "AI prepared the sales brief and draft. Add a known business email to approve and send safely.",
      target: `#contacts-${company.id}`,
      icon: Plus
    };
  }
  if (!hasApproved) {
    return {
      label: "Review and approve",
      copy: "Check the recipient, offer and message before anything can be sent.",
      target: `#outreach-${company.id}`,
      icon: CheckCircle2
    };
  }
  if (!sentAt) {
    return {
      label: "Send approved email",
      copy: "Open the approval area and confirm the send only when you are ready.",
      target: `#outreach-${company.id}`,
      icon: Send
    };
  }
  if (!company.replied_at) {
    return {
      label: "Track reply status",
      copy: "Watch delivery and replies, then move the opportunity when the prospect responds.",
      target: `#timeline-${company.id}`,
      icon: Inbox
    };
  }
  if (company.crm_stage !== "Meeting Scheduled" && company.crm_stage !== "Won") {
    return {
      label: "Move CRM stage",
      copy: "Update the stage so the pipeline reflects the current sales situation.",
      action: "move-stage",
      target: `#timeline-${company.id}`,
      icon: Target
    };
  }
  return {
    label: "Add next note",
    copy: "Keep the workspace current with the latest outcome or next follow-up.",
    target: `#notes-${company.id}`,
    icon: FileText
  };
}

function companyAiWorkPlan(company: CrmCompany) {
  const hasVerifiedEmail = Boolean(company.email || company.contacts.some((contact) => contact.email));
  const hasDraft = Boolean(company.generated_emails.length);
  return [
    {
      label: "Company profile",
      copy: "Saved company, location, website, phone and business listing data.",
      action: "Add or verify the company website and business profile.",
      done: Boolean(company.name && (company.website || company.domain || company.address || company.phone))
    },
    {
      label: "Website analysis",
      copy: "AI summary, services, sales angle, offer and useful personalization facts.",
      action: "Run website analysis to fill summary, pain points and opportunity angle.",
      done: Boolean(company.website_analyzed_at || company.ai_summary || company.sales_angle || company.suggested_offer)
    },
    {
      label: "Decision maker",
      copy: "A real person or role to contact. If not verified, add it manually.",
      action: "Find a decision maker or add the right contact manually.",
      done: Boolean(company.contacts.length || company.contact_found_at)
    },
    {
      label: "Verified email",
      copy: "A usable business email. OutreachAI never invents missing email addresses.",
      action: "Find a verified email or add a known business email manually.",
      done: hasVerifiedEmail
    },
    {
      label: "AI email",
      copy: "A personalized first email generated from the company research.",
      action: "Generate a personalized email for review. Sending stays blocked until approval.",
      done: hasDraft
    },
    {
      label: "Approval",
      copy: "Human review before anything is sent to a real prospect.",
      action: "Review the draft, edit it if needed, then approve before sending.",
      done: Boolean(company.email_approved_at || company.generated_emails.some((email) => email.delivery_status === "approved" || email.delivery_status === "sent"))
    }
  ];
}

const WORKFLOW_STAGE_KEY_BY_LABEL: Record<string, string> = {
  "Company profile": "company_profile",
  "Website analysis": "website_analysis",
  "Decision maker": "decision_maker",
  "Verified email": "verified_email",
  "AI email": "ai_email",
  Approval: "approval"
};

function normalizeWorkflowStatus(value: unknown, fallbackDone: boolean): WorkflowStageStatus {
  const status = typeof value === "string" ? value : "";
  if (status === "running" || status === "completed" || status === "error" || status === "waiting") return status;
  return fallbackDone ? "completed" : "waiting";
}

function companyWorkflowStages(company: CrmCompany) {
  const plan = companyAiWorkPlan(company);
  const stages = company.workflow_stages || {};
  const messages = company.workflow_stage_messages || {};
  return plan.map((item) => {
    const key = WORKFLOW_STAGE_KEY_BY_LABEL[item.label] || item.label;
    const status = normalizeWorkflowStatus(stages[key], item.done);
    return {
      ...item,
      key,
      status,
      done: status === "completed",
      message: messages[key] || (status === "completed" ? item.copy : item.action)
    };
  });
}

function hasRunningWorkflow(company: CrmCompany) {
  return Object.values(company.workflow_stages || {}).some((status) => status === "running");
}

function hasActiveEnrichment(companies: CrmCompany[]) {
  return companies.some(hasRunningWorkflow);
}

function leadHasRunningWorkflow(lead: Lead) {
  return Object.values(lead.workflow_stages || {}).some((status) => status === "running");
}

function workflowStatusTone(status: WorkflowStageStatus) {
  if (status === "completed") return "bg-teal-50 text-brand border-teal-100";
  if (status === "running") return "bg-blue-50 text-blue-800 border-blue-100";
  if (status === "error") return "bg-amber-50 text-amber-900 border-amber-100";
  return "bg-slate-50 text-slate-500 border-slate-100";
}

function workflowStatusLabel(status: WorkflowStageStatus) {
  if (status === "completed") return "Completed";
  if (status === "running") return "Running";
  if (status === "error") return "Needs attention";
  return "Waiting";
}

function emailStatusLabel(status?: string | null) {
  if (!status) return "Not prepared";
  const normalized = status.toLowerCase().replace(/[_-]+/g, " ").trim();
  if (normalized === "not prepared") return "Not prepared";
  if (normalized === "draft ready") return "Draft ready";
  if (normalized === "no verified email") return "No verified email";
  if (normalized === "verified" || normalized === "verified email") return "Verified email";
  if (normalized === "found" || normalized === "contact found") return "Contact found";
  if (normalized === "not found" || normalized === "missing") return "No verified email";
  if (normalized === "approved") return "Email approved";
  if (normalized === "sent") return "Email sent";
  return status;
}

function pipelineReadiness(company: CrmCompany) {
  const ready = timelineProgress(company).filter(([, value]) => Boolean(value)).length;
  return `${ready}/8`;
}

function timelineProgress(company: CrmCompany) {
  const sentAt = currentEmailSentAt(company);
  const hasVerifiedEmail = Boolean(company.email || company.contacts.some((contact) => contact.email));
  const steps = [
    ["Saved", company.saved_to_crm_at || company.created_at],
    ["Researched", company.website_analyzed_at || company.ai_summary],
    ["Verified email", hasVerifiedEmail],
    ["Draft", company.email_generated_at || company.generated_emails.length],
    ["Approved", company.email_approved_at],
    ["Sent", sentAt],
    ["Reply", company.replied_at],
    ["Outcome", company.crm_stage === "Won" || company.crm_stage === "Lost"],
  ] as const;
  return steps;
}

function fieldValue(value?: string | number | null, missingLabel = "Not available") {
  if (value === undefined || value === null || value === "") return missingLabel;
  return String(value);
}

function sourceLabel(source?: string | null) {
  if (!source) return "Verified business data";
  const normalized = source.toLowerCase();
  if (normalized.includes("hunter")) return "Verified email";
  if (normalized.includes("google")) return "Local business listing";
  if (normalized.includes("manual")) return "Manual entry";
  return "Verified business data";
}

function localizedLegacySalesFallback(value: string | null | undefined, company: CrmCompany, locale: Locale) {
  if (!value) return value || "";
  const companyName = company.name || "Company";
  const industry = company.industry || "";
  const localeKey = locale === "en-US" ? "en" : locale;
  const text: Record<string, Record<string, string>> = {
    summary: {
      en: `${companyName} is a company in its market. Verified public signals: website available.`,
      ru: `${companyName} — компания на своём рынке. Проверенные публичные сигналы: сайт доступен.`,
      es: `${companyName} es una empresa en su mercado. Señales públicas verificadas: sitio web disponible.`,
      fr: `${companyName} est une entreprise sur son marché. Signaux publics vérifiés : site disponible.`,
      it: `${companyName} è un’azienda nel suo mercato. Segnali pubblici verificati: sito disponibile.`,
      pl: `${companyName} to firma na swoim rynku. Zweryfikowane sygnały publiczne: strona dostępna.`
    },
    reply: {
      en: "4-8% until contact is verified",
      ru: "4-8%, пока контакт не проверен",
      es: "4-8% hasta verificar el contacto",
      fr: "4-8% tant que le contact n’est pas vérifié",
      it: "4-8% finché il contatto non è verificato",
      pl: "4-8% do czasu weryfikacji kontaktu"
    },
    offer: {
      en: `Offer a relevant B2B partnership tailored to ${companyName}.`,
      ru: `Предложите релевантное B2B-партнёрство для ${companyName}.`,
      es: `Ofrece una alianza B2B relevante para ${companyName}.`,
      fr: `Proposez un partenariat B2B pertinent à ${companyName}.`,
      it: `Proponi una partnership B2B rilevante per ${companyName}.`,
      pl: `Zaproponuj odpowiednie partnerstwo B2B dla ${companyName}.`
    },
    angle: {
      en: `Start with a practical growth or partnership angle${industry ? ` for ${industry}` : ""}.`,
      ru: `Начните с практичного угла роста или партнёрства${industry ? ` для сферы ${industry}` : ""}.`,
      es: `Empieza con un ángulo práctico de crecimiento o alianza${industry ? ` para ${industry}` : ""}.`,
      fr: `Commencez par un angle concret de croissance ou partenariat${industry ? ` pour ${industry}` : ""}.`,
      it: `Apri con un angolo pratico di crescita o partnership${industry ? ` per ${industry}` : ""}.`,
      pl: `Zacznij od praktycznego kąta wzrostu lub partnerstwa${industry ? ` dla branży ${industry}` : ""}.`
    },
    next: {
      en: "Find or add a verified decision-maker email before sending.",
      ru: "Найдите или добавьте проверенный email лица, принимающего решение, перед отправкой.",
      es: "Busca o añade un email verificado del decisor antes de enviar.",
      fr: "Trouvez ou ajoutez l’email vérifié du décideur avant l’envoi.",
      it: "Trova o aggiungi l’email verificata del decision maker prima dell’invio.",
      pl: "Znajdź lub dodaj zweryfikowany email osoby decyzyjnej przed wysyłką."
    }
  };
  const pick = (key: keyof typeof text) => text[key][localeKey] || text[key].en;
  if (value.includes("Verified public signals:") || value.includes("Public profile is saved")) return pick("summary");
  if (value.includes("until contact is verified")) return pick("reply");
  if (value.includes("tailored to")) return pick("offer");
  if (value.includes("Lead with a practical") || value.includes("growth or partnership angle based on verified public data")) return pick("angle");
  if (value.includes("Find or add a verified decision-maker email before sending.")) return pick("next");
  return value;
}

function localizeLegacyCompanySalesFallbacks(company: CrmCompany, locale: Locale): CrmCompany {
  return {
    ...company,
    ai_summary: localizedLegacySalesFallback(company.ai_summary, company, locale),
    sales_angle: localizedLegacySalesFallback(company.sales_angle, company, locale),
    suggested_offer: localizedLegacySalesFallback(company.suggested_offer, company, locale),
    outreach_strategy: localizedLegacySalesFallback(company.outreach_strategy, company, locale),
    expected_reply_rate: localizedLegacySalesFallback(company.expected_reply_rate, company, locale),
    opportunity_analysis: localizedLegacySalesFallback(company.opportunity_analysis, company, locale),
    partnership_fit: localizedLegacySalesFallback(company.partnership_fit, company, locale),
    next_recommended_action: localizedLegacySalesFallback(company.next_recommended_action, company, locale),
    buying_signals: safeArray(company.buying_signals).map((item) => localizedLegacySalesFallback(item, company, locale)),
    risks: safeArray(company.risks).map((item) => localizedLegacySalesFallback(item, company, locale)),
    pain_points: safeArray(company.pain_points).map((item) => localizedLegacySalesFallback(item, company, locale)),
  };
}

function stageTone(stage?: string | null) {
  const normalized = (stage || "").toLowerCase();
  if (normalized.includes("won") || normalized.includes("meeting")) return "bg-teal-50 text-brand border-teal-200";
  if (normalized.includes("lost")) return "bg-red-50 text-red-700 border-red-200";
  if (normalized.includes("sent") || normalized.includes("replied") || normalized.includes("approved")) return "bg-blue-50 text-blue-700 border-blue-200";
  if (normalized.includes("draft") || normalized.includes("analyzed") || normalized.includes("contact")) return "bg-amber-50 text-amber-700 border-amber-200";
  return "bg-slate-100 text-slate-700 border-slate-200";
}

function outreachTone(done: boolean, label: string) {
  if (!done) return "border-slate-200 bg-white text-slate-500";
  if (["Meeting", "Won"].includes(label)) return "border-teal-200 bg-teal-50 text-brand";
  if (["Replied", "Opened", "Delivered"].includes(label)) return "border-blue-200 bg-blue-50 text-blue-700";
  return "border-amber-200 bg-amber-50 text-amber-700";
}

function activityLabel(action: string) {
  const normalized = String(action || "").trim().toLowerCase().replaceAll("_", ".");
  const labels: Record<string, string> = {
    "workspace.created": "Workspace created",
    "lead.created": "Lead found",
    "lead.saved.to.crm": "Lead saved to CRM",
    "company.created": "Company saved",
    "company.updated": "Company updated",
    "website.analyzed": "Website analyzed",
    "contact.found": "Contact found",
    "contacts.found": "Contact found",
    "email.generated": "Email generated",
    "email.approved": "Email approved",
    "email.sent": "Email sent",
    "email.delivered": "Email delivered",
    "email.opened": "Email opened",
    "email.bounced": "Email bounced",
    "email.failed": "Email failed",
    "reply.received": "Reply received",
    "email.replied": "Reply received",
    "meeting.booked": "Meeting booked",
    "stage.changed": "Stage changed",
    "note.added": "Note added",
    "campaign.created": "Campaign created",
    "campaign.paused": "Campaign paused",
    "campaign.resumed": "Campaign resumed"
  };
  return labels[normalized] || action.replaceAll(".", " ").replaceAll("_", " ");
}

function InfoCell({ label, value, help }: { label: string; value?: string | number | null; help: string }) {
  const { t } = useI18n();
  const missing = value === undefined || value === null || value === "";
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-xs font-bold uppercase text-slate-500">{t(label)}</p>
      <p className={`mt-2 text-sm font-semibold ${missing ? "text-slate-500" : "text-ink"}`}>{fieldValue(value, t("Not available"))}</p>
      {missing && <p className="mt-2 text-xs leading-5 text-slate-500">{t(help)}</p>}
    </div>
  );
}

function IntelligenceValue({ label, value, confidence }: { label: string; value: ReactNode; confidence?: number }) {
  const { t } = useI18n();
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-black uppercase tracking-wide text-slate-500">{t(label)}</p>
        {typeof confidence === "number" && confidence > 0 ? (
          <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-black text-slate-600">{confidence}%</span>
        ) : null}
      </div>
      <div className="mt-2 break-words text-sm font-semibold leading-6 text-ink">{value}</div>
    </div>
  );
}

function WorkspaceSection({ id, title, copy, children }: { id: string; title: string; copy: string; children: ReactNode }) {
  const { t } = useI18n();
  return (
    <section id={id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4">
        <h3 className="text-lg font-bold text-ink">{t(title)}</h3>
        <p className="mt-1 text-sm leading-6 text-slate-600">{t(copy)}</p>
      </div>
      {children}
    </section>
  );
}

function ActionProgress({ current, completed }: { current: string; completed: string[] }) {
  const { t } = useI18n();
  if (!current && completed.length === 0) return null;
  return (
    <div className="rounded-2xl border border-teal-100 bg-teal-50 p-4">
      <p className="text-xs font-black uppercase tracking-wide text-brand">{t("AI is working")}</p>
      {current && (
        <p className="mt-2 inline-flex items-center gap-2 text-sm font-bold text-ink">
          <Loader2 className="animate-spin text-brand" size={16} />
          {t(current)}
        </p>
      )}
      {completed.length ? (
        <div className="mt-3 grid gap-2">
          {completed.map((step) => (
            <p key={step} className="inline-flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-xs font-bold text-brand">
              <CheckCircle2 size={15} />
              {t(step)}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function contactConfidenceLabel(confidence: CrmContact["confidence"], t: (key: string) => string) {
  if (confidence === undefined || confidence === null || confidence === "") return t("Confidence not available");
  const value = typeof confidence === "number" ? `${confidence}%` : String(confidence).trim();
  return t("Confidence: {value}").replace("{value}", value);
}

function CrmCompanyCard({ company, api, highlighted = false, onOpenNextLead, nextLeadName = "" }: { company: CrmCompany; api: ApiFn; highlighted?: boolean; onOpenNextLead?: () => void; nextLeadName?: string }) {
  const { t, locale } = useI18n();
  const [current, setCurrent] = useState(company);
  const [stageValue, setStageValue] = useState(company.crm_stage);
  const [noteBody, setNoteBody] = useState("");
  const [actionBusy, setActionBusy] = useState("");
  const [actionNotice, setActionNotice] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionCurrentStep, setActionCurrentStep] = useState("");
  const [actionCompletedSteps, setActionCompletedSteps] = useState<string[]>([]);
  const noteTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const contactFormRef = useRef<HTMLFormElement | null>(null);
  const deepContactPollTimerRef = useRef<number | null>(null);
  const displayCurrent = useMemo(() => localizeLegacyCompanySalesFallbacks(current, locale), [current, locale]);
  const lead = leadFromCrmCompany(displayCurrent);
  const currentDraft = latestCompanyEmail(displayCurrent);
  const currentSentAt = currentEmailSentAt(displayCurrent);
  const healthScore = companyHealthScore(displayCurrent);
  const salesBrief = companySalesBrief(displayCurrent, healthScore);
  const intelligence = displayCurrent.company_intelligence || null;
  const intelligenceFields = intelligence?.fields || {};
  const intelligenceScore = intelligence?.lead_score?.value ?? salesBrief.score;
  const intelligenceReasons = safeArray(intelligence?.lead_score?.reasons).map(String);
  const intelligenceSources = safeArray(intelligence?.sources).map(String);
  const intelligenceMissing = safeArray(intelligence?.missing_fields).map(String);
  const intelligenceTechnologies = safeArray(intelligenceFields.technologies?.value).map(String);
  const intelligenceSignals = safeArray(intelligenceFields.buying_signals?.value).map(String);
  const intelligenceEmails = safeArray(intelligenceFields.verified_emails?.value).map(String);
  const intelligencePhones = safeArray(intelligenceFields.phones?.value).map(String);
  const intelligenceSocials = safeArray(intelligenceFields.social_profiles?.value).map(String);
  const intelligenceEmployeeLinks = safeArray(intelligenceFields.key_employee_linkedin?.value).map(String);
  const intelligenceCeo = intelligenceFields.ceo_founder?.value && typeof intelligenceFields.ceo_founder.value === "object" ? intelligenceFields.ceo_founder.value as Record<string, unknown> : null;
  const nextAction = companyNextAction(displayCurrent);
  const primaryAction = companyPrimaryAction(displayCurrent);
  const PrimaryActionIcon = primaryAction.icon;
  const primaryContact = displayCurrent.contacts[0];
  const firstDeal = displayCurrent.deals[0];
  const estimatedOpportunity = firstDeal?.value ? `€${Math.round(firstDeal.value).toLocaleString()}` : "Not available";
  const hasVerifiedEmail = Boolean(displayCurrent.email || displayCurrent.contacts.some((contact) => contact.email));
  const aiBuyingSignals = safeArray(displayCurrent.buying_signals).filter(Boolean);
  const aiRisks = safeArray(displayCurrent.risks).filter(Boolean);
  const buyingSignals = uniqueStrings([
    ...aiBuyingSignals,
    displayCurrent.website_analyzed_at ? "Website research completed" : "",
    hasVerifiedEmail ? "Verified email available" : "",
    !hasVerifiedEmail && displayCurrent.contact_search_checked_at ? "Contact search checked" : "",
    displayCurrent.generated_emails.length ? "Outreach draft prepared" : "",
    displayCurrent.replied_at ? "Reply received" : "",
    displayCurrent.google_rating ? "Public reputation signal available" : ""
  ]);
  const risks = uniqueStrings([
    ...aiRisks,
    !hasVerifiedEmail ? "No verified email yet" : "",
    !displayCurrent.ai_summary ? "Company research is incomplete" : "",
    !displayCurrent.generated_emails.length ? "No approved outreach draft yet" : ""
  ]);
  const contactSearchAttempted = Boolean(current.contact_search_checked_at || current.contact_search_status);
  const contactSearchEmpty = !current.email && !current.contacts.some((contact) => contact.email) && current.contact_search_status === "no_verified_email";
  const contactRolesSearched = safeArray(current.decision_maker_roles_searched).filter(Boolean);
  const deepSearch = current.deep_contact_search || null;
  const deepSelected = deepSearch?.selected_decision_maker || null;
  const deepCandidates = safeArray(deepSearch?.candidates);
  const deepSources = safeArray(deepSearch?.sources).map(String);
  const deepTechnologies = safeArray(current.technologies?.length ? current.technologies : deepSearch?.technologies).map(String);
  const deepErrors = safeArray(deepSearch?.errors).map((item) => typeof item === "object" && item !== null && "message" in item ? String((item as { message?: string }).message || "") : "").filter(Boolean);
  const deepStages = deepSearch?.stages || {};
  const outreachSteps = [
    ["Draft", Boolean(current.email_generated_at || current.generated_emails.length)],
    ["Approved", Boolean(current.email_approved_at || current.generated_emails.some((email) => email.delivery_status === "approved" || email.delivery_status === "sent"))],
    ["Sent", Boolean(currentSentAt)],
    ["Delivered", Boolean(current.delivered_at)],
    ["Opened", Boolean(current.opened_at)],
    ["Replied", Boolean(current.replied_at)],
    ["Meeting", current.crm_stage === "Meeting Scheduled" || current.crm_stage === "Won"],
    ["Won", current.crm_stage === "Won"]
  ] as const;
  const lifecycle: Array<[string, string | null | undefined, string]> = [
    ["Lead found", current.found_at, "Company was discovered and added to your workspace."],
    ["Saved to CRM", current.saved_to_crm_at || current.created_at, "The company is stored in your CRM."],
    ["Website analyzed", current.website_analyzed_at, "AI research created the company summary and sales angle."],
    ["Verified email found", hasVerifiedEmail ? current.contact_found_at || current.saved_to_crm_at || current.created_at : null, "A verified business email was saved."],
    ["Contact search checked", !hasVerifiedEmail ? current.contact_search_checked_at : null, "Contact discovery ran, but no verified email was available."],
    ["Email generated", current.email_generated_at, "A personalized draft was prepared for review."],
    ["Email approved", current.email_approved_at, "A user approved the draft before sending."],
    [currentSentAt ? "Email sent" : "Email not sent yet", currentSentAt, currentSentAt ? "Approved outreach was sent." : "Current approved email has not been sent yet."],
    ["Email opened", current.opened_at, "The prospect opened the message."],
    ["Reply received", current.replied_at, "A reply was captured in the workspace."],
    ["Stage changed", current.stage_changed_at, t("Current stage is {stage}.").replace("{stage}", t(current.crm_stage))],
  ];
  const opportunityScore = Math.max(0, Math.min(100, Math.round(
    Number(
      displayCurrent.ai_revenue_engine_report?.overall_opportunity_score?.score
      ?? displayCurrent.ai_crm?.priority?.score
      ?? displayCurrent.ai_lead_prioritization?.score
      ?? displayCurrent.overall_score
      ?? salesBrief.score
      ?? 0
    )
  )));
  const opportunityReason = String(
    displayCurrent.ai_revenue_engine_report?.overall_opportunity_score?.reasoning
    || displayCurrent.ai_crm?.priority?.reasoning
    || displayCurrent.reasoning
    || salesBrief.decisionReason
    || t("Not enough evidence yet.")
  );
  const buyingIntentScore = Math.max(0, Math.min(100, Math.round(
    Number(
      displayCurrent.ai_revenue_engine_report?.buying_intent?.score
      ?? displayCurrent.ai_crm?.buying_intent?.score
      ?? displayCurrent.buying_signal_score
      ?? 0
    )
  )));
  const buyingIntentUrgency = String(
    displayCurrent.ai_revenue_engine_report?.buying_intent?.urgency
    || displayCurrent.ai_crm?.buying_intent?.urgency
    || displayCurrent.buying_signal_urgency
    || t("Unknown")
  );
  const buyingIntentReason = String(
    displayCurrent.ai_revenue_engine_report?.buying_intent?.reasoning
    || displayCurrent.ai_crm?.buying_intent?.reasoning
    || displayCurrent.buying_signal_explanation
    || salesBrief.whyFit
    || t("No buying-intent reasoning available yet.")
  );
  const revenueDecisionMaker = displayCurrent.ai_revenue_engine_report?.decision_maker || null;
  const intelligenceDecisionMaker = displayCurrent.decision_maker_intelligence?.profiles?.[0] || null;
  const decisionMaker = {
    name: revenueDecisionMaker?.name || intelligenceDecisionMaker?.name || deepSelected?.name || primaryContact?.name || t("Decision maker not confirmed"),
    title: revenueDecisionMaker?.title || intelligenceDecisionMaker?.title || deepSelected?.title || primaryContact?.title || t("Role unavailable"),
    confidence: Number(
      intelligenceDecisionMaker?.confidence_score
      ?? deepSearch?.confidence_score
      ?? primaryContact?.confidence
      ?? displayCurrent.ai_revenue_engine_report?.confidence
      ?? displayCurrent.confidence_score
      ?? 0
    ),
    why: String(
      displayCurrent.ai_revenue_engine_report?.best_contact_reason
      || intelligenceDecisionMaker?.why_best_decision_maker
      || deepSelected?.reason
      || t("Selected from saved contact and enrichment signals.")
    ),
    linkedin: intelligenceDecisionMaker?.contact_id ? primaryContact?.linkedin : primaryContact?.linkedin,
    email: revenueDecisionMaker?.is_verified_contact ? (displayCurrent.email || primaryContact?.email || deepSearch?.verified_email) : (deepSearch?.verified_email || displayCurrent.email || primaryContact?.email)
  };
  const recommendedOutreach = String(
    displayCurrent.ai_revenue_engine_report?.recommended_outreach_strategy?.strongest_value_proposition
    || displayCurrent.ai_outreach_strategy?.strongest_value_proposition
    || displayCurrent.ai_outreach_strategy?.first_sentence
    || displayCurrent.sales_angle
    || displayCurrent.outreach_strategy
    || salesBrief.opener
    || t("No recommended outreach angle yet.")
  );
  const bestTiming = String(
    displayCurrent.ai_revenue_engine_report?.recommended_outreach_strategy?.best_timing
    || displayCurrent.ai_outreach_strategy?.best_timing
    || displayCurrent.recommended_outreach_timing
    || t("Timing not available yet")
  );
  const successProbability = (() => {
    const numeric = Number(
      displayCurrent.ai_outreach_strategy?.estimated_reply_probability
      ?? displayCurrent.ai_outreach_strategy?.probability_of_reply
      ?? displayCurrent.ai_revenue_engine_report?.confidence
      ?? parseInt(String(displayCurrent.expected_reply_rate || "").replace(/[^\d]/g, ""), 10)
    );
    return Number.isFinite(numeric) && numeric > 0 ? `${Math.max(0, Math.min(100, Math.round(numeric)))}%` : salesBrief.replyProbability;
  })();
  const executiveSummary = String(
    displayCurrent.ai_revenue_engine_report?.executive_summary
    || displayCurrent.ai_summary
    || displayCurrent.opportunity_analysis
    || displayCurrent.partnership_fit
    || salesBrief.whatTheyDo
  );
  const readyEmailSubject = currentDraft?.subject || displayCurrent.ai_revenue_engine_report?.recommended_first_email?.subject || salesBrief.firstMessageSubject;
  const readyEmailPreview = cleanGeneratedText(currentDraft?.preview || currentDraft?.body || displayCurrent.ai_revenue_engine_report?.recommended_first_email?.first_sentence || salesBrief.firstMessage);
  const competitorNames = uniqueStrings([
    ...safeArray(displayCurrent.ai_revenue_engine_report?.competitor_position?.competitors).map(String),
    ...safeArray(displayCurrent.ai_ceo_dashboard?.competitors?.companies).map(String),
    ...safeArray(displayCurrent.ai_competitor_intelligence?.competitors).map(String)
  ]).slice(0, 5);
  const competitorAdvantages = uniqueStrings([
    displayCurrent.ai_revenue_engine_report?.competitor_position?.opportunity_to_sell || "",
    displayCurrent.ai_ceo_dashboard?.competitors?.opportunity_to_sell || "",
    displayCurrent.ai_competitor_intelligence?.opportunity_to_sell || "",
    displayCurrent.ai_revenue_engine_report?.competitor_position?.positioning || ""
  ]).filter(Boolean).slice(0, 3);
  const competitorWeaknesses = uniqueStrings([
    ...safeArray(displayCurrent.ai_competitor_intelligence?.weaknesses).map(String),
    ...safeArray(displayCurrent.top_negative_signals).map(String),
    ...safeArray(displayCurrent.ai_revenue_engine_report?.top_risks).map(String)
  ]).slice(0, 4);
  const companyTimelineGroups = [
    { label: t("Hiring"), items: safeArray(displayCurrent.ai_live_buying_signals?.snapshot?.new_hiring).map(String) },
    { label: t("Funding"), items: safeArray(displayCurrent.ai_live_buying_signals?.snapshot?.new_funding).map(String) },
    { label: t("Technology"), items: uniqueStrings([...safeArray(displayCurrent.ai_live_buying_signals?.snapshot?.technology_changes).map(String), ...safeArray(displayCurrent.ai_company_timeline?.technology_changes).map((item) => String((item as { title?: string; details?: string }).title || (item as { details?: string }).details || ""))]).filter(Boolean) },
    { label: t("Website"), items: uniqueStrings([...safeArray(displayCurrent.ai_live_buying_signals?.snapshot?.website_changes).map(String), ...safeArray(displayCurrent.ai_company_timeline?.website_changes).map((item) => String((item as { title?: string; details?: string }).title || (item as { details?: string }).details || ""))]).filter(Boolean) },
    { label: t("Expansion"), items: uniqueStrings([...safeArray(displayCurrent.ai_live_buying_signals?.snapshot?.market_expansion).map(String), ...safeArray(displayCurrent.ai_company_timeline?.new_locations).map((item) => String((item as { title?: string; details?: string }).title || (item as { details?: string }).details || ""))]).filter(Boolean) }
  ];
  const aiRisksDetailed = uniqueStrings([
    ...safeArray(displayCurrent.ai_revenue_engine_report?.top_risks).map(String),
    ...safeArray(displayCurrent.ai_crm?.risk?.top_reasons).map(String),
    ...salesBrief.topRisks,
    ...safeArray(displayCurrent.risks).map(String)
  ]).slice(0, 6);
  const formatEvidence = (item?: { source_field?: string; value?: string; confidence?: number } | null) => {
    if (!item) return "";
    const field = item.source_field ? t(String(item.source_field).replaceAll("_", " ")) : t("Source");
    const value = item.value ? String(item.value) : t("Value not available");
    const confidence = item.confidence ? ` · ${Math.round(item.confidence)}%` : "";
    return `${field}: ${value}${confidence}`;
  };
  const evidenceSections = [
    {
      title: t("Executive Summary"),
      items: uniqueStrings([
        ...safeArray(displayCurrent.ai_revenue_engine_report?.evidence).map((item) => formatEvidence(item)),
        ...safeArray(displayCurrent.buying_signal_evidence).map((item) => formatEvidence(item as { source_field?: string; value?: string; confidence?: number })),
        ...salesBrief.qualitySources.map((item) => t(item))
      ]).filter(Boolean).slice(0, 5)
    },
    {
      title: t("Decision Maker"),
      items: uniqueStrings([
        ...safeArray(intelligenceDecisionMaker?.evidence_used).map((item) => formatEvidence(item)),
        deepSelected?.email ? `${t("verified email")}: ${deepSelected.email}` : "",
        decisionMaker.why
      ]).filter(Boolean).slice(0, 5)
    },
    {
      title: t("Recommended Outreach"),
      items: uniqueStrings([
        ...safeArray(displayCurrent.ai_outreach_strategy?.strongest_value_proposition_evidence).map((item) => formatEvidence(item)),
        ...safeArray(displayCurrent.ai_outreach_strategy?.first_sentence_evidence).map((item) => formatEvidence(item)),
        ...safeArray(displayCurrent.ai_outreach_strategy?.best_timing_evidence).map((item) => formatEvidence(item)),
        ...safeArray(displayCurrent.ai_outreach_strategy?.cta_evidence).map((item) => formatEvidence(item))
      ]).filter(Boolean).slice(0, 6)
    }
  ];
  const verdict = opportunityScore >= 70 && buyingIntentScore >= 50
    ? t("Yes, contact this company now")
    : opportunityScore >= 50
      ? t("Probably, after one quick review")
      : t("Not yet, collect more evidence first");
  const competitorSnapshot = competitorAdvantages[0] || competitorNames[0] || t("No competitor edge surfaced yet.");
  const autonomousDecisionCards = [
    {
      label: "AI Summary",
      value: executiveSummary,
      tone: "teal"
    },
    {
      label: "Decision Maker",
      value: `${decisionMaker.name} · ${decisionMaker.title}`,
      tone: "slate"
    },
    {
      label: "Buying Intent",
      value: `${buyingIntentScore} · ${buyingIntentUrgency}`,
      tone: "slate"
    },
    {
      label: "Opportunity Score",
      value: `${opportunityScore} · ${opportunityReason}`,
      tone: "slate"
    },
    {
      label: "Competitor Snapshot",
      value: competitorSnapshot,
      tone: "slate"
    },
    {
      label: "Email Draft",
      value: readyEmailSubject || t("No draft ready yet"),
      tone: "ink"
    }
  ] as const;
  const workspaceFlow = [
    { label: "Open Lead", status: "completed" as const },
    { label: "AI Summary", status: displayCurrent.ai_summary || displayCurrent.opportunity_analysis ? "completed" as const : "active" as const },
    { label: "Decision Maker", status: decisionMaker.name !== t("Decision maker not confirmed") ? "completed" as const : "pending" as const },
    { label: "Buying Intent", status: buyingIntentScore > 0 ? "completed" as const : "pending" as const },
    { label: "Opportunity Score", status: opportunityScore > 0 ? "completed" as const : "pending" as const },
    { label: "Competitor Snapshot", status: competitorNames.length || competitorAdvantages.length || competitorWeaknesses.length ? "completed" as const : "pending" as const },
    { label: "Email Draft", status: currentDraft ? "completed" as const : "pending" as const },
    { label: "Review", status: currentDraft ? (currentDraft.delivery_status === "approved" || currentDraft.delivery_status === "sent" ? "completed" as const : "active" as const) : "pending" as const },
    { label: "Send", status: currentSentAt ? "completed" as const : currentDraft?.delivery_status === "approved" ? "active" as const : "pending" as const },
    { label: "Schedule Follow-up", status: currentSentAt ? (current.notes.length || current.replied_at ? "completed" as const : "active" as const) : "pending" as const },
    { label: "Next Lead", status: onOpenNextLead ? ((currentSentAt || current.replied_at || current.crm_stage === "Meeting Scheduled" || current.crm_stage === "Won" || current.crm_stage === "Lost") ? "active" as const : "pending" as const) : "pending" as const }
  ];

  function applyCompanyUpdate(updatedCompany: CrmCompany) {
    setCurrent(updatedCompany);
    setStageValue(updatedCompany.crm_stage);
  }

  function stopDeepContactPolling() {
    if (deepContactPollTimerRef.current !== null) {
      window.clearInterval(deepContactPollTimerRef.current);
      deepContactPollTimerRef.current = null;
    }
  }

  useEffect(() => {
    return () => {
      stopDeepContactPolling();
    };
  }, []);

  function startDeepContactPolling(jobId: string, force: boolean) {
    stopDeepContactPolling();
    const poll = async () => {
      try {
        const snapshot = await api<WorkspaceDeepContactJobStatusResponse>(`/api/workspace-app/companies/${current.id}/deep-contact-search/jobs/${jobId}`, {
          timeoutMs: 15000
        });
        if (snapshot.company) {
          applyCompanyUpdate(normalizeCrmCompany(snapshot.company));
        }
        const status = String(snapshot.status || "").toLowerCase();
        if (status === "pending" || status === "running" || status === "retrying") {
          setActionNotice(t(snapshot.progress?.message || "Deep contact search is running in the background..."));
          return;
        }

        stopDeepContactPolling();
        if (status === "succeeded") {
          setActionNotice(t("Deep contact search finished."));
          setActionError("");
          trackEvent("deep_contact_search_completed", {
            company_id: current.id,
            company: current.name,
            force,
            job_id: jobId
          });
        } else {
          const reason = t("Deep contact search could not be completed. Try again or add the contact manually.");
          setActionError(reason);
          setActionNotice("");
          trackEvent("deep_contact_search_failed", {
            company_id: current.id,
            company: current.name,
            reason,
            job_id: jobId
          });
        }
        setActionBusy("");
      } catch (err) {
        stopDeepContactPolling();
        const reason = friendlyErrorMessage(err, t("Deep contact search status could not be refreshed."));
        setActionError(reason);
        setActionNotice("");
        setActionBusy("");
      }
    };

    deepContactPollTimerRef.current = window.setInterval(() => {
      void poll();
    }, 3000);
    void poll();
  }

  async function moveStage(nextStage = stageValue) {
    if (nextStage === current.crm_stage) {
      setActionError("");
      setActionNotice(t("This CRM stage is already selected."));
      return true;
    }
    setActionBusy("stage");
    setActionError("");
    setActionNotice("");
    try {
      const updated = await api<CrmCompany>(`/api/crm/companies/${current.id}/stage`, { method: "PATCH", body: JSON.stringify({ stage: nextStage }) });
      setCurrent(updated);
      setStageValue(updated.crm_stage);
      setActionNotice(t("CRM stage moved to {stage}.").replace("{stage}", t(updated.crm_stage)));
      return true;
    } catch (err) {
      setActionError(friendlyErrorMessage(err, t("CRM stage could not be updated. Check your session and try again.")));
      return false;
    } finally {
      setActionBusy("");
    }
  }

  function scheduleFollowUp() {
    const timelineSuggestions = safeArray(displayCurrent.ai_sales_timeline?.steps)
      .map((step) => String(step?.reminder || step?.action || "").trim())
      .filter(Boolean)
      .slice(0, 3);
    const strategySuggestions = safeArray(displayCurrent.ai_outreach_strategy?.follow_up_schedule)
      .map((step) => String(step || "").trim())
      .filter(Boolean)
      .slice(0, 3);
    const draftSuggestions = [cleanGeneratedText(currentDraft?.follow_up_1), cleanGeneratedText(currentDraft?.follow_up_2)].filter(Boolean);
    const suggestions = uniqueStrings([...timelineSuggestions, ...strategySuggestions, ...draftSuggestions]).slice(0, 3);
    if (!suggestions.length && !currentSentAt && !currentDraft) {
      setActionError(t("Generate or review the first email before scheduling follow-up."));
      return;
    }
    const template = [
      `${t("Follow-up plan for")} ${current.name}`,
      currentDraft?.subject ? `${t("Latest email")}: ${currentDraft.subject}` : "",
      currentSentAt ? `${t("Initial send")}: ${formatDateTime(currentSentAt)}` : "",
      "",
      t("Suggested follow-up steps"),
      ...(suggestions.length ? suggestions.map((step, index) => `${index + 1}. ${step}`) : [t("1. Add the owner, due date and next message before sending or following up.")]),
      "",
      `${t("Owner")}:`,
      `${t("Due date")}:`,
      `${t("Expected result")}:`
    ].filter(Boolean).join("\n");
    setNoteBody(template);
    setActionError("");
    setActionNotice(t("Follow-up template is ready. Review it, then click Add note to save it to activity history."));
    window.setTimeout(() => {
      noteTextareaRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      noteTextareaRef.current?.focus();
    }, 0);
  }

  async function addNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = noteBody.trim();
    if (!body) {
      setActionError(t("Write a note before saving."));
      return;
    }
    setActionBusy("note");
    setActionError("");
    setActionNotice("");
    try {
      const note = await api<CrmCompany["notes"][number]>(`/api/crm/companies/${current.id}/notes`, { method: "POST", body: JSON.stringify({ body }) });
      setCurrent((previous) => ({ ...previous, notes: [note, ...previous.notes] }));
      setNoteBody("");
      setActionNotice(t("Note saved to the activity history."));
    } catch (err) {
      setActionError(friendlyErrorMessage(err, t("Note could not be saved. Check your session and try again.")));
    } finally {
      setActionBusy("");
    }
  }

  async function addManualContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const payload = {
      name: String(data.get("name") || "").trim(),
      title: String(data.get("title") || "").trim(),
      email: String(data.get("email") || "").trim() || undefined,
      phone: String(data.get("phone") || "").trim(),
      linkedin: String(data.get("linkedin") || "").trim()
    };
    if (!payload.name && !payload.title && !payload.email && !payload.phone && !payload.linkedin) {
      setActionError(t("Add at least one contact detail before saving."));
      return;
    }
    setActionBusy("contact");
    setActionError("");
    setActionNotice("");
    try {
      const result = await api<WorkspaceAppActionResponse>(`/api/workspace-app/companies/${current.id}/contacts/manual`, { method: "POST", body: JSON.stringify(payload) });
      if (result.company) {
        applyCompanyUpdate(normalizeCrmCompany(result.company));
      }
      form.reset();
      setActionNotice(t(result.message || "Contact saved to CRM."));
    } catch (err) {
      setActionError(friendlyErrorMessage(err, t("Contact could not be saved. Check the details and try again.")));
    } finally {
      setActionBusy("");
    }
  }

  async function discoverContacts() {
    if (!current.lead_id) {
      setActionError(t("Reconnect this company to a lead before finding contacts."));
      return;
    }
    setActionBusy("discover-contact");
    setActionError("");
    setActionNotice("");
    try {
      const result = await withTimeout(
        api<WorkspaceAppActionResponse>(`/api/workspace-app/companies/${current.id}/contacts`, { method: "POST", timeoutMs: 20000 }),
        22000,
        "Contact search took too long. The company is still saved, and you can add a contact manually."
      );
      if (result.company) {
        applyCompanyUpdate(normalizeCrmCompany(result.company));
      }
      setActionNotice(t(result.message || "Contact search finished."));
    } catch (err) {
      setActionError(friendlyErrorMessage(err, t("Contact search could not be completed. Add a contact manually and continue.")));
    } finally {
      setActionBusy("");
    }
  }

  async function prepareCompanyOpportunity() {
    if (!current.lead_id) {
      setActionError(t("Reconnect this company to a lead before generating outreach."));
      return;
    }
    setActionBusy("prepare-company");
    setActionError("");
    setActionNotice(t("Preparing company research, contacts and first email..."));
    setActionCompletedSteps([]);
    setActionCurrentStep("Checking website analysis...");
    const markStepDone = (step: string) => setActionCompletedSteps((steps) => steps.includes(step) ? steps : [...steps, step]);
    try {
      setActionCurrentStep("AI enrichment is running automatically");
      const result = await withTimeout(
        api<WorkspaceAppActionResponse>(`/api/workspace-app/companies/${current.id}/enrichment/restart`, { method: "POST", timeoutMs: 15000 }),
        16000,
        "AI enrichment could not be restarted. The company stays saved in CRM."
      );
      if (result.company) {
        applyCompanyUpdate(normalizeCrmCompany(result.company));
      }
      const completedSteps = Array.isArray(result.completed_steps) && result.completed_steps.length
        ? result.completed_steps
        : ["AI enrichment is running automatically"];
      completedSteps.forEach(markStepDone);
      const warnings = Array.isArray(result.warnings) ? result.warnings.map((item) => t(item)).filter(Boolean) : [];

      setActionCurrentStep("");
      setActionNotice(
        warnings.length
          ? `${t("Company preparation finished with missing data.")} ${warnings.slice(0, 2).join(" ")}`
          : t(result.message || "AI enrichment restarted. This card will update as data arrives.")
      );
      trackEvent("company_preparation_queued", {
        company_id: current.id,
        company: current.name,
        warnings: warnings.length
      });
    } catch (err) {
      const reason = friendlyErrorMessage(err, t("Company preparation could not be completed. Try again or continue manually."));
      setActionError(reason);
      setActionNotice("");
      setActionCurrentStep("");
      trackEvent("company_preparation_failed", {
        company_id: current.id,
        company: current.name,
        reason
      });
    } finally {
      setActionBusy("");
    }
  }

  async function generateEmailDraftForReview() {
    if (!current.lead_id) {
      setActionError(t("Reconnect this company to a lead before generating outreach."));
      return;
    }
    setActionBusy("generate-email-draft");
    setActionError("");
    setActionNotice(t("Generating email draft for review..."));
    try {
      const result = await withTimeout(
        api<WorkspaceAppActionResponse>(`/api/workspace-app/companies/${current.id}/email-draft`, { method: "POST", timeoutMs: 20000 }),
        21000,
        "Email draft generation timed out. Try again."
      );
      if (result.company) {
        applyCompanyUpdate(normalizeCrmCompany(result.company));
      }
      setActionNotice(t(result.message || "Email draft created for review. Nothing was sent."));
      trackEvent("company_email_draft_generated", {
        company_id: current.id,
        company: current.name,
      });
    } catch (err) {
      setActionError(friendlyErrorMessage(err, t("Email draft could not be generated. Try again.")));
      setActionNotice("");
      trackEvent("company_email_draft_generation_failed", {
        company_id: current.id,
        company: current.name,
      });
    } finally {
      setActionBusy("");
    }
  }

  async function runDeepContactSearch(force = false) {
    if (!current.lead_id) {
      setActionError(t("Reconnect this company to a lead before finding contacts."));
      return;
    }
    setActionBusy(force ? "deep-contact-retry" : "deep-contact");
    setActionError("");
    setActionNotice(t("Queuing deep contact search..."));
    let keepBusy = false;
    try {
      const result = await withTimeout(
        api<WorkspaceAppActionResponse>(`/api/workspace-app/companies/${current.id}/deep-contact-search`, {
          method: "POST",
          body: JSON.stringify({ force }),
          timeoutMs: 15000
        }),
        16000,
        "Deep contact search could not be queued. Please retry."
      );
      if (result.company) {
        applyCompanyUpdate(normalizeCrmCompany(result.company));
      }
      const queuedJobId = String(result.job_id || "").trim();
      if (queuedJobId) {
        keepBusy = true;
        setActionNotice(t(result.message || "Deep contact search queued. Waiting for completion..."));
        startDeepContactPolling(queuedJobId, force);
      } else {
        setActionNotice(t(result.message || "Deep contact search finished."));
        trackEvent("deep_contact_search_completed", {
          company_id: current.id,
          company: current.name,
          force
        });
      }
    } catch (err) {
      stopDeepContactPolling();
      const reason = friendlyErrorMessage(err, t("Deep contact search could not be completed. Try again or add the contact manually."));
      setActionError(reason);
      setActionNotice("");
      trackEvent("deep_contact_search_failed", {
        company_id: current.id,
        company: current.name,
        reason
      });
    } finally {
      if (!keepBusy) {
        setActionBusy("");
      }
    }
  }

  function runPrimaryAction() {
    if (primaryAction.action === "prepare-company") {
      void prepareCompanyOpportunity();
      return;
    }
    if (primaryAction.action === "discover-contact") {
      void discoverContacts();
      return;
    }
    if (primaryAction.action === "move-stage") {
      void moveStage();
    }
  }

  return <CompanyCardShell id={`company-${current.id}`} className={`scroll-mt-24 overflow-hidden bg-slate-50 ${highlighted ? "border-teal-300 ring-4 ring-teal-100" : "border-slate-200"}`}>
    <div className="border-b border-slate-200 bg-white p-5 sm:p-6" style={{ fontFamily: '"Space Grotesk", "IBM Plex Sans", "Avenir Next", sans-serif' }}>
      <section className="relative overflow-hidden rounded-3xl border border-slate-200 bg-gradient-to-br from-white via-[#f7fbff] to-[#edf6ff] p-5 shadow-sm sm:p-6">
        <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-[#b7e3ff] opacity-40 blur-3xl" />
        <div className="relative flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div className="flex min-w-0 gap-4">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-slate-900 text-xl font-black text-white shadow-sm">
              {current.name.slice(0, 2).toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full border px-3 py-1 text-xs font-bold ${stageTone(current.crm_stage)}`}>{t(current.crm_stage)}</span>
                <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-bold text-slate-700">{t("AI confidence")} {Math.max(displayCurrent.ai_revenue_engine_report?.confidence || 0, decisionMaker.confidence || 0, healthScore)}%</span>
              </div>
              <h2 className="mt-3 text-2xl font-black tracking-tight text-slate-900 sm:text-3xl">{current.name}</h2>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm text-slate-600">
                <span className="inline-flex items-center gap-1.5"><Building2 size={16} />{fieldValue(current.industry, t("Not available"))}</span>
                <span className="inline-flex items-center gap-1.5"><MapPin size={16} />{[current.city, current.country].filter(Boolean).join(", ") || t("Not available")}</span>
                <span className="inline-flex items-center gap-1.5"><Globe2 size={16} />{current.website || current.domain ? <a className="break-all font-semibold text-brand hover:underline" href={current.website || `https://${current.domain}`} target="_blank" rel="noreferrer">{current.website || current.domain}</a> : t("Not available")}</span>
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row xl:flex-col xl:items-end">
            {primaryAction.action ? (
              <button
                type="button"
                onClick={runPrimaryAction}
                disabled={(primaryAction.action === "prepare-company" && (actionBusy === "prepare-company" || !current.lead_id)) || (primaryAction.action === "discover-contact" && (actionBusy === "discover-contact" || !current.lead_id)) || (primaryAction.action === "move-stage" && actionBusy === "stage")}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                {(primaryAction.action === "prepare-company" && actionBusy === "prepare-company") || (primaryAction.action === "discover-contact" && actionBusy === "discover-contact") || (primaryAction.action === "move-stage" && actionBusy === "stage") ? <Loader2 className="animate-spin" size={17} /> : <PrimaryActionIcon size={17} />}
                {t(primaryAction.label)}
              </button>
            ) : (
              <a href={primaryAction.target} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 text-sm font-bold text-white">
                <PrimaryActionIcon size={17} />
                {t(primaryAction.label)}
                <ArrowRight size={16} />
              </a>
            )}
            <a href={`#outreach-${current.id}`} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold text-slate-800"><Mail size={16} />{t("Review outreach")}</a>
          </div>
        </div>

        <div className="mt-5 grid gap-4 xl:grid-cols-[1.3fr_0.7fr]">
          <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex flex-wrap gap-2">
              {workspaceFlow.map((step) => (
                <span
                  key={step.label}
                  className={`inline-flex min-h-9 items-center justify-center rounded-full border px-3 text-xs font-black ${step.status === "completed" ? "border-teal-200 bg-teal-50 text-brand" : step.status === "active" ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-500"}`}
                >
                  {t(step.label)}
                </span>
              ))}
            </div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">{t("1. Executive Summary")}</p>
            <h3 className="mt-2 text-2xl font-black text-slate-900">{verdict}</h3>
            <p className="mt-3 text-sm leading-7 text-slate-700">{executiveSummary}</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <div className="rounded-xl bg-slate-50 p-3">
                <p className="text-xs font-bold uppercase text-slate-500">{t("Why")}</p>
                <p className="mt-1 text-sm font-semibold leading-6 text-slate-900">{opportunityReason}</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3">
                <p className="text-xs font-bold uppercase text-slate-500">{t("Who")}</p>
                <p className="mt-1 text-sm font-semibold leading-6 text-slate-900">{decisionMaker.name}</p>
                <p className="text-sm text-slate-600">{decisionMaker.title}</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3">
                <p className="text-xs font-bold uppercase text-slate-500">{t("When")}</p>
                <p className="mt-1 text-sm font-semibold leading-6 text-slate-900">{bestTiming}</p>
                <p className="text-sm text-slate-600">{t("Probability of success")}: {successProbability}</p>
              </div>
            </div>
          </article>

          <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">{t("2. Opportunity Score")}</p>
            <p className="mt-2 text-5xl font-black tracking-tight text-slate-900">{opportunityScore}</p>
            <p className="mt-2 text-sm font-semibold text-slate-700">{t(salesBrief.fit)}</p>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100">
              <div className={`h-full rounded-full ${opportunityScore >= 70 ? "bg-emerald-500" : opportunityScore >= 50 ? "bg-amber-500" : "bg-slate-400"}`} style={{ width: `${opportunityScore}%` }} />
            </div>
            <p className="mt-4 text-sm leading-6 text-slate-700">{opportunityReason}</p>
          </article>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {autonomousDecisionCards.map((card) => {
            const toneClass = card.tone === "teal"
              ? "border-teal-100 bg-teal-50 text-brand"
              : card.tone === "ink"
                ? "border-slate-900 bg-slate-900 text-white"
                : "border-slate-200 bg-white text-slate-700";
            const bodyClass = card.tone === "ink" ? "text-white" : "text-slate-800";
            return (
              <article key={card.label} className={`rounded-2xl border p-4 shadow-sm ${toneClass}`}>
                <p className={`text-xs font-black uppercase tracking-[0.16em] ${card.tone === "ink" ? "text-white/70" : ""}`}>{t(card.label)}</p>
                <p className={`mt-2 line-clamp-4 text-sm font-semibold leading-6 ${bodyClass}`}>{t(card.value)}</p>
              </article>
            );
          })}
        </div>

        <div className="mt-4 grid gap-4 xl:grid-cols-2">
          <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">{t("3. Buying Intent")}</p>
            <div className="mt-3 flex items-end gap-3">
              <p className="text-4xl font-black text-slate-900">{buyingIntentScore}</p>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700">{buyingIntentUrgency}</span>
            </div>
            <p className="mt-3 text-sm leading-6 text-slate-700">{buyingIntentReason}</p>
            <div className="mt-4 rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
              <p className="font-bold text-slate-900">{t("Evidence")}</p>
              <p className="mt-1">{safeArray(displayCurrent.top_positive_signals).slice(0, 3).join(", ") || safeArray(displayCurrent.buying_signals).slice(0, 3).join(", ") || t("No explicit buying-signal evidence yet.")}</p>
            </div>
          </article>

          <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">{t("4. Decision Maker")}</p>
            <div className="mt-3 flex items-start gap-4">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-slate-900 text-lg font-black text-white">
                {String(decisionMaker.name || "DM").split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="text-lg font-black text-slate-900">{decisionMaker.name}</p>
                <p className="text-sm text-slate-600">{decisionMaker.title}</p>
                <p className="mt-2 text-sm font-semibold text-slate-800">{t("Confidence")}: {Math.max(0, Math.min(100, Math.round(decisionMaker.confidence || 0)))}%</p>
                <p className="mt-2 text-sm leading-6 text-slate-700">{decisionMaker.why}</p>
                <p className="mt-2 text-sm text-slate-600">{decisionMaker.email || t("Verified email not available")}</p>
              </div>
            </div>
          </article>
        </div>

        <div className="mt-4 grid gap-4 xl:grid-cols-2">
          <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">{t("5. AI Recommendation")}</p>
            <p className="mt-3 text-lg font-semibold leading-7 text-slate-900">{recommendedOutreach}</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl bg-slate-50 p-3 text-sm">
                <p className="font-bold text-slate-900">{t("When")}</p>
                <p className="mt-1 text-slate-700">{bestTiming}</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3 text-sm">
                <p className="font-bold text-slate-900">{t("Probability of success")}</p>
                <p className="mt-1 text-slate-700">{successProbability}</p>
              </div>
            </div>
          </article>

          <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">{t("6. Ready Email")}</p>
            <h4 className="mt-2 text-base font-black text-slate-900">{readyEmailSubject || t("No email ready yet")}</h4>
            <p className="mt-3 line-clamp-5 whitespace-pre-line text-sm leading-6 text-slate-700">{readyEmailPreview || t("Generate or review the email to see the full preview.")}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <a href={`#outreach-${current.id}`} className="inline-flex min-h-11 items-center justify-center rounded-xl bg-slate-900 px-4 text-sm font-bold text-white">{t("Review")}</a>
              <a href={`#outreach-${current.id}`} className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold text-slate-800">{t("Send")}</a>
              {!current.generated_emails.length && <button type="button" onClick={generateEmailDraftForReview} disabled={actionBusy === "generate-email-draft" || !current.lead_id} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold text-slate-800 disabled:cursor-not-allowed disabled:opacity-60">{actionBusy === "generate-email-draft" ? <Loader2 className="animate-spin" size={16} /> : <Mail size={16} />}{t("Generate")}</button>}
            </div>
          </article>
        </div>

        <div className="mt-4 grid gap-4 xl:grid-cols-2">
          <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">{t("7. Company Timeline")}</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
              {companyTimelineGroups.map((group) => <div key={group.label} className="rounded-xl bg-slate-50 p-3 text-sm">
                <p className="font-bold text-slate-900">{group.label}</p>
                <p className="mt-1 text-slate-700">{group.items.slice(0, 2).join(", ") || t("No signal detected")}</p>
              </div>)}
            </div>
          </article>

          <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">{t("8. Competitor Snapshot")}</p>
            <div className="mt-3 space-y-3 text-sm">
              <div className="rounded-xl bg-slate-50 p-3">
                <p className="font-bold text-slate-900">{t("Top competitors")}</p>
                <p className="mt-1 text-slate-700">{competitorNames.join(", ") || t("No competitor data available")}</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3">
                <p className="font-bold text-slate-900">{t("Advantages")}</p>
                <p className="mt-1 text-slate-700">{competitorAdvantages.join(" ") || t("No clear competitive advantage extracted yet.")}</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3">
                <p className="font-bold text-slate-900">{t("Weaknesses")}</p>
                <p className="mt-1 text-slate-700">{competitorWeaknesses.join(", ") || t("No competitor weakness data available")}</p>
              </div>
            </div>
          </article>
        </div>

        <div className="mt-4 grid gap-4 xl:grid-cols-2">
          <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">{t("9. Risks")}</p>
            <div className="mt-3 space-y-2">
              {aiRisksDetailed.length ? aiRisksDetailed.map((risk) => <div key={risk} className="rounded-xl bg-amber-50 p-3 text-sm font-semibold text-amber-900">{t(risk)}</div>) : <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-700">{t("No major risk detected for the current stage.")}</div>}
            </div>
          </article>

          <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">{t("10. Evidence")}</p>
            <div className="mt-3 space-y-3">
              {evidenceSections.map((section) => <div key={section.title} className="rounded-xl bg-slate-50 p-3 text-sm">
                <p className="font-bold text-slate-900">{section.title}</p>
                <div className="mt-2 space-y-1 text-slate-700">
                  {section.items.length ? section.items.map((item) => <p key={item}>{item}</p>) : <p>{t("No explicit evidence recorded yet.")}</p>}
                </div>
              </div>)}
            </div>
          </article>
        </div>

        <div className="mt-4">
          <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">{t("11. AI Confidence")}</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl bg-slate-50 p-3">
                <p className="text-xs font-bold uppercase text-slate-500">{t("Overall")}</p>
                <p className="mt-1 text-2xl font-black text-slate-900">{Math.max(displayCurrent.ai_revenue_engine_report?.confidence || 0, decisionMaker.confidence || 0, healthScore)}%</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3">
                <p className="text-xs font-bold uppercase text-slate-500">{t("Decision maker")}</p>
                <p className="mt-1 text-2xl font-black text-slate-900">{Math.max(0, Math.min(100, Math.round(decisionMaker.confidence || 0)))}%</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3">
                <p className="text-xs font-bold uppercase text-slate-500">{t("Opportunity")}</p>
                <p className="mt-1 text-2xl font-black text-slate-900">{opportunityScore}%</p>
              </div>
            </div>
            <p className="mt-4 text-sm leading-6 text-slate-700">{t("Confidence is calculated from available evidence, verified contact data, and opportunity signals. Lower values indicate missing or weak evidence.")}</p>
          </article>
        </div>
      </section>
    </div>

    <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_18rem] xl:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="space-y-5">
        <WorkspaceSection id={`profile-${current.id}`} title="Company Profile" copy="The essential company information your sales team needs before outreach. Missing values stay explicit so nobody mistakes unknown data for verified data.">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <InfoCell label="Address" value={current.address} help="Search or add the company address." />
            <InfoCell label="Phone" value={current.phone} help="Find contacts or add a verified phone number." />
            <InfoCell label="Email" value={current.email || primaryContact?.email} help="Verify a business contact or add one manually." />
            <InfoCell label="Website" value={current.website || current.domain} help="Add a website to run company research." />
            <InfoCell label="LinkedIn" value={primaryContact?.linkedin} help="Add a public company or decision-maker profile." />
            <InfoCell label="Map listing" value={current.place_id ? t("Available") : null} help="Run lead discovery to connect the local business listing." />
            <InfoCell label="Technologies" value={salesBrief.technologies.length ? salesBrief.technologies.slice(0, 5).join(", ") : null} help="Technology data appears after website research detects it." />
            <InfoCell label="Rating" value={current.google_rating ? `${current.google_rating}/5` : null} help="Rating appears when available from the business listing." />
            <InfoCell label="Data source" value={t(sourceLabel(current.source))} help="The source is shown as business-friendly verified data." />
          </div>
          <div className="mt-4 rounded-2xl bg-slate-50 p-4">
            <p className="text-sm font-bold text-ink">{t("Company description")}</p>
            <p className="mt-2 text-sm leading-6 text-slate-700">{displayCurrent.ai_summary || t("Not available. Run company research to create a clear description before outreach.")}</p>
            {!displayCurrent.ai_summary && (
              <button
                type="button"
                onClick={prepareCompanyOpportunity}
                disabled={actionBusy === "prepare-company" || !current.lead_id}
                className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-brand px-4 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
              >
                {actionBusy === "prepare-company" ? <Loader2 className="animate-spin" size={17} /> : <Sparkles size={17} />}
                {t("Run website analysis")}
              </button>
            )}
          </div>
        </WorkspaceSection>

        <WorkspaceSection id={`insights-${current.id}`} title="AI Insights" copy="A sales-ready summary of why this company matters and what to do next.">
          <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
            <div className="rounded-2xl bg-teal-50 p-4">
              <p className="text-sm font-bold text-brand">{t("AI summary")}</p>
              <p className="mt-2 text-sm leading-6 text-slate-800">{t(displayCurrent.ai_summary || salesBrief.whatTheyDo)}</p>
              <p className="mt-4 text-sm font-bold text-ink">{t("Why this company is interesting")}</p>
              <p className="mt-2 text-sm leading-6 text-slate-700">{t(displayCurrent.opportunity_analysis || displayCurrent.partnership_fit || displayCurrent.sales_angle || displayCurrent.outreach_strategy || salesBrief.whyFit)}</p>
              {(!displayCurrent.ai_summary || (!displayCurrent.sales_angle && !displayCurrent.outreach_strategy)) && (
                <button
                  type="button"
                  onClick={prepareCompanyOpportunity}
                  disabled={actionBusy === "prepare-company" || !current.lead_id}
                  className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-brand px-4 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                >
                  {actionBusy === "prepare-company" ? <Loader2 className="animate-spin" size={17} /> : <Sparkles size={17} />}
                  {t("Run AI analysis")}
                </button>
              )}
            </div>
            <div className="grid gap-3">
              <InfoCell label="Estimated opportunity" value={estimatedOpportunity === "Not available" ? null : estimatedOpportunity} help="Deal value appears after qualification." />
              <InfoCell label="Confidence score" value={`${current.confidence_score || healthScore}%`} help="Based on profile completeness, contacts, AI research and outreach state." />
              <InfoCell label="Priority score" value={current.priority_score ? `${current.priority_score}%` : null} help="AI priority for B2B sales work." />
              <InfoCell label="Recommended action" value={t(nextAction)} help="The next safest step in the sales workflow." />
            </div>
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-sm font-bold text-ink">{t("Buying signals")}</p>
              <div className="mt-3 space-y-2">{buyingSignals.length ? buyingSignals.map((signal) => <p key={signal} className="flex items-center gap-2 rounded-lg bg-teal-50 p-3 text-sm font-semibold text-brand"><ShieldCheck size={16} />{t(signal)}</p>) : <>
                <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">{t("Not available. Analyze the website and find contacts to reveal buying signals.")}</p>
                <button
                  type="button"
                  onClick={prepareCompanyOpportunity}
                  disabled={actionBusy === "prepare-company" || !current.lead_id}
                  className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-bold text-ink disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {actionBusy === "prepare-company" ? <Loader2 className="animate-spin" size={17} /> : <Sparkles size={17} />}
                  {t("Find buying signals")}
                </button>
              </>}</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-sm font-bold text-ink">{t("Risks")}</p>
              <div className="mt-3 space-y-2">{risks.length ? risks.map((risk) => <p key={risk} className="flex items-center gap-2 rounded-lg bg-amber-50 p-3 text-sm font-semibold text-amber-800"><AlertTriangle size={16} />{t(risk)}</p>) : <p className="rounded-lg bg-teal-50 p-3 text-sm font-semibold text-brand">{t("No major missing steps detected for the current stage.")}</p>}</div>
            </div>
          </div>
        </WorkspaceSection>

        <WorkspaceSection id={`contacts-${current.id}`} title="Contact Center" copy="Decision makers, verified contact details and confidence in one place.">
          <div className={`mb-4 rounded-2xl border p-4 ${contactSearchEmpty ? "border-amber-200 bg-amber-50" : current.contacts.length ? "border-teal-200 bg-teal-50" : "border-slate-200 bg-slate-50"}`}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className={`text-xs font-black uppercase tracking-wide ${contactSearchEmpty ? "text-amber-700" : "text-brand"}`}>{t(contactSearchEmpty ? "Contact needed" : current.contacts.length ? "Contact ready" : "Find a decision maker")}</p>
                <h4 className="mt-2 text-lg font-black text-ink">{t(current.contacts.length ? "Decision maker saved" : contactSearchAttempted ? "Contact search completed" : "Search for verified contacts")}</h4>
                <p className="mt-2 text-sm leading-6 text-slate-700">{t(contactSearchEmpty ? (current.contact_search_message || "No verified business email was found. Add a decision maker manually or continue with research.") : current.contacts.length ? "A contact is saved in your private CRM. Review it before sending outreach." : "Search for decision makers first. If no verified email is available, add the contact manually and continue.")}</p>
                {contactRolesSearched.length ? <p className="mt-3 text-xs font-bold uppercase tracking-wide text-slate-500">{t("Roles searched")}: <span className="normal-case tracking-normal text-slate-700">{contactRolesSearched.map((role) => t(role)).join(", ")}</span></p> : null}
              </div>
              <button type="button" onClick={discoverContacts} disabled={actionBusy === "discover-contact" || !current.lead_id} className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-md bg-ink px-4 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-60">
                {actionBusy === "discover-contact" ? <Loader2 className="animate-spin" size={17} /> : <UserRoundSearch size={17} />}
                {t("Find contacts")}
              </button>
            </div>
          </div>
          <div className="mb-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-wide text-brand">{t("Deep contact search")}</p>
                <h4 className="mt-2 text-lg font-black text-ink">{deepSelected?.name || t("Find the best decision maker")}</h4>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  {deepSelected
                    ? `${deepSelected.title || t("Decision maker")} · ${deepSelected.reason || t("Selected by role fit, confidence and available verification data.")}`
                    : t("Run one search to enrich the company, find up to 10 candidates, verify email and detect technologies.")}
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row lg:flex-col">
                <button
                  type="button"
                  onClick={() => runDeepContactSearch(false)}
                  disabled={actionBusy === "deep-contact" || actionBusy === "deep-contact-retry" || !current.lead_id}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-brand px-4 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {actionBusy === "deep-contact" ? <Loader2 className="animate-spin" size={17} /> : <UserRoundSearch size={17} />}
                  {t("Run deep search")}
                </button>
                <button
                  type="button"
                  onClick={() => runDeepContactSearch(true)}
                  disabled={actionBusy === "deep-contact" || actionBusy === "deep-contact-retry" || !current.lead_id}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-bold text-ink disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {actionBusy === "deep-contact-retry" ? <Loader2 className="animate-spin" size={17} /> : <Sparkles size={17} />}
                  {t("Retry search")}
                </button>
              </div>
            </div>
            <div className="mt-4 grid gap-3 lg:grid-cols-3">
              <InfoCell label="Decision maker" value={deepSelected?.name || primaryContact?.name} help="Best contact selected by role, seniority and verification confidence." />
              <InfoCell label="Verified email" value={deepSearch?.verified_email || current.email || primaryContact?.email} help="Only shown as complete when the email is verified or explicitly saved." />
              <InfoCell label="Confidence" value={deepSearch?.confidence_score ? `${deepSearch.confidence_score}%` : null} help="Combined confidence from profile, contact, email verification and technologies." />
            </div>
            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              <div className="rounded-xl bg-slate-50 p-3">
                <p className="text-xs font-black uppercase text-slate-500">{t("Progress")}</p>
                <div className="mt-2 grid gap-2">
                  {["apollo_company_profile", "apollo_people_search", "hunter_domain_search", "email_finder", "technographics"].map((stage) => (
                    <div key={stage} className="flex items-center justify-between gap-3 rounded-lg bg-white px-3 py-2 text-xs font-bold">
                      <span>{t(stage.replaceAll("_", " "))}</span>
                      <span className={`rounded-full px-2 py-1 ${deepStages[stage] === "completed" ? "bg-teal-50 text-brand" : deepStages[stage] === "error" || deepStages[stage] === "missing_key" ? "bg-amber-50 text-amber-800" : "bg-slate-100 text-slate-600"}`}>{t(deepStages[stage] || "waiting")}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-xl bg-slate-50 p-3">
                <p className="text-xs font-black uppercase text-slate-500">{t("Sources and technologies")}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {(deepSources.length ? deepSources : [t("No source yet")]).map((source) => <span key={source} className="rounded-full bg-white px-2 py-1 text-xs font-bold text-slate-700">{t(source)}</span>)}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {(deepTechnologies.length ? deepTechnologies.slice(0, 10) : [t("No technologies found yet")]).map((technology) => <span key={technology} className="rounded-full bg-teal-50 px-2 py-1 text-xs font-bold text-brand">{technology}</span>)}
                </div>
              </div>
            </div>
            {deepCandidates.length > 1 ? (
              <details className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <summary className="cursor-pointer text-sm font-black text-ink">{t("Choose another candidate")}</summary>
                <div className="mt-3 grid gap-2">
                  {deepCandidates.slice(0, 10).map((candidate, index) => (
                    <div key={`${candidate.email || candidate.linkedin || candidate.name || index}`} className="rounded-lg bg-white p-3 text-sm">
                      <p className="font-bold text-ink">{candidate.name || t("Unnamed contact")}</p>
                      <p className="mt-1 text-slate-600">{candidate.title || t("Role unavailable")} · {candidate.email || t("Email not verified")}</p>
                    </div>
                  ))}
                </div>
              </details>
            ) : null}
            {deepErrors.length ? <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm font-semibold text-amber-800">{t(deepErrors[0])}</p> : null}
          </div>
          {current.contacts.length ? <div className="grid gap-3 lg:grid-cols-2">
            {current.contacts.map((contact) => <DecisionMakerCardShell key={contact.id} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h4 className="break-words font-bold text-ink">{contact.name ? contact.name : t(contactDisplayName(contact))}</h4>
                  <p className="mt-1 text-sm text-slate-600">{t(contactRoleLine(contact))}</p>
                </div>
                <span className="rounded-full bg-teal-50 px-3 py-1 text-xs font-bold text-brand">{contactConfidenceLabel(contact.confidence, t)}</span>
              </div>
              <div className="mt-4 grid gap-2 text-sm">
                <p className="flex items-center gap-2 text-slate-700"><Mail size={16} />{contact.email || t("Not available")}</p>
                <p className="flex items-center gap-2 text-slate-700"><Phone size={16} />{contact.phone || t("Not available")}</p>
                <p className="flex items-center gap-2 text-slate-700"><ExternalLink size={16} />{contact.linkedin || t("Not available")}</p>
                <p className="text-xs font-bold uppercase text-slate-500">{t("Data")}: {t(sourceLabel(contact.source))}</p>
              </div>
            </DecisionMakerCardShell>)}
          </div> : <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5">
            <p className="font-bold text-ink">{t("No decision makers yet.")}</p>
            <p className="mt-2 text-sm leading-6 text-slate-600">{t("Use the outreach research action to find or add a verified contact. Emails are never invented.")}</p>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={discoverContacts}
                disabled={actionBusy === "discover-contact" || !current.lead_id}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-ink px-4 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                {actionBusy === "discover-contact" ? <Loader2 className="animate-spin" size={17} /> : <UserRoundSearch size={17} />}
                {t("Find contact")}
              </button>
              <button
                type="button"
                onClick={() => contactFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-bold text-ink"
              >
                <Plus size={17} />
                {t("Add email manually")}
              </button>
            </div>
          </div>}
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <a href={`#outreach-${current.id}`} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-bold text-ink"><UserRoundSearch size={17} /> {t("Review outreach workflow")}</a>
            <a href={`#notes-${current.id}`} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-bold text-ink"><Plus size={17} /> {t("Add contact note")}</a>
          </div>
          <form ref={contactFormRef} onSubmit={addManualContact} className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-sm font-bold text-ink">{t("Add decision maker manually")}</p>
                <p className="mt-1 text-sm leading-6 text-slate-600">{t("Use this when contact discovery cannot verify an email. Manual contacts stay private in your CRM.")}</p>
              </div>
              <span className="w-fit rounded-full bg-white px-3 py-1 text-xs font-bold text-slate-600">{t("Private CRM")}</span>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <label className="text-sm font-semibold text-slate-700">{t("Name")}<input name="name" placeholder={t("Decision maker")} className="mt-2 min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm" /></label>
              <label className="text-sm font-semibold text-slate-700">{t("Role")}<input name="title" placeholder={t("CEO, Founder, Owner")} className="mt-2 min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm" /></label>
              <label className="text-sm font-semibold text-slate-700">{t("Email")}<input name="email" type="email" placeholder="name@company.com" className="mt-2 min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm" /></label>
              <label className="text-sm font-semibold text-slate-700">{t("Phone")}<input name="phone" placeholder="+49..." className="mt-2 min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm" /></label>
              <label className="text-sm font-semibold text-slate-700 md:col-span-2">{t("LinkedIn")}<input name="linkedin" placeholder="https://linkedin.com/in/..." className="mt-2 min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm" /></label>
            </div>
            <button type="submit" disabled={actionBusy === "contact"} className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-brand px-4 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto">{actionBusy === "contact" ? <Loader2 className="animate-spin" size={17} /> : <Plus size={17} />} {t("Save contact")}</button>
          </form>
        </WorkspaceSection>

        <WorkspaceSection id={`outreach-${current.id}`} title="Outreach Center" copy="Every email moves through review before anything is sent. The timeline below shows the exact state.">
          <div className="grid gap-2 sm:grid-cols-4 xl:grid-cols-8">
            {outreachSteps.map(([label, done]) => <div key={label} className={`rounded-xl border p-3 text-sm font-bold ${outreachTone(Boolean(done), label)}`}>
              <CheckCircle2 size={16} className={done ? "" : "text-slate-300"} />
              <p className="mt-2">{t(label)}</p>
            </div>)}
          </div>
          {!current.generated_emails.length && (
            <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <p className="text-sm font-black text-ink">{t("No email draft yet")}</p>
              <p className="mt-2 text-sm leading-6 text-slate-700">{t("AI can generate a draft for review even if no verified email is available yet. Nothing will be sent until you add/verify a recipient and approve.")}</p>
              <button
                type="button"
                onClick={generateEmailDraftForReview}
                disabled={actionBusy === "generate-email-draft" || !current.lead_id}
                className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-brand px-4 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
              >
                {actionBusy === "generate-email-draft" ? <Loader2 className="animate-spin" size={17} /> : <Mail size={17} />}
                {t("Generate email for review")}
              </button>
            </div>
          )}
          <div className="mt-5">
            {current.lead_id ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-sm font-black text-ink">{t("Email review and sending controls")}</p>
                <p className="mt-2 text-sm leading-6 text-slate-600">{t("Review the ready email, edit it in place, approve it, and send it here on the same screen.")}</p>
                <div className="mt-4">
                  <OpportunityCard key={`${current.id}:${currentDraft?.id || "no-draft"}:${currentDraft?.delivery_status || ""}`} lead={lead} api={api} onCompanyUpdated={applyCompanyUpdate} initialDraft={currentDraft} />
                </div>
              </div>
            ) : <p className="rounded-xl bg-amber-50 p-4 text-sm font-semibold text-amber-800">{t("Reconnect this company to a lead before generating outreach.")}</p>}
          </div>
          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-black uppercase tracking-wide text-slate-500">{t("Follow-up plan")}</p>
              <div className="mt-3 space-y-2 text-sm text-slate-700">
                {uniqueStrings([
                  ...safeArray(displayCurrent.ai_outreach_strategy?.follow_up_schedule).map(String),
                  ...safeArray(displayCurrent.ai_sales_timeline?.steps).map((step) => String(step?.action || step?.reminder || ""))
                ]).slice(0, 4).map((item) => (
                  <p key={item} className="rounded-xl bg-slate-50 p-3 font-semibold">{t(item)}</p>
                ))}
                {!uniqueStrings([
                  ...safeArray(displayCurrent.ai_outreach_strategy?.follow_up_schedule).map(String),
                  ...safeArray(displayCurrent.ai_sales_timeline?.steps).map((step) => String(step?.action || step?.reminder || ""))
                ]).length ? <p className="rounded-xl bg-slate-50 p-3">{t("Generate the outreach draft to unlock the suggested follow-up sequence.")}</p> : null}
              </div>
            </article>
            <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-black uppercase tracking-wide text-slate-500">{t("Execution next step")}</p>
              <p className="mt-3 text-lg font-black text-slate-900">{t(nextAction)}</p>
              <p className="mt-2 text-sm leading-6 text-slate-700">{t("Schedule the follow-up in notes, move the CRM stage when the situation changes, and then continue with the next lead from this same workspace.")}</p>
            </article>
          </div>
        </WorkspaceSection>

        <details className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <summary className="cursor-pointer text-sm font-black text-slate-700">{t("Show activity history")}</summary>
          <p className="mt-2 text-sm leading-6 text-slate-600">{t("Open this only when you need to audit what happened with the company.")}</p>
          <div className="mt-4 space-y-3">
            {lifecycle.map(([label, value, description]) => <div key={label} className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-[2rem_10rem_1fr]">
              <div className={`flex h-8 w-8 items-center justify-center rounded-full ${value ? "bg-teal-50 text-brand" : "bg-slate-100 text-slate-400"}`}><Clock3 size={16} /></div>
              <div>
                <p className="font-bold text-ink">{t(label)}</p>
                <p className="mt-1 text-xs text-slate-500">{t(formatDateTime(value))}</p>
              </div>
              <p className="text-sm leading-6 text-slate-600">{t(description)}</p>
            </div>)}
            {current.activity.slice(0, 4).map((item) => {
              const label = activityLabel(item.action);
              const isPreviousSend = label === "Email sent" && currentDraft?.delivery_status !== "sent";
              return <div key={item.id} className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-[2rem_10rem_1fr]">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-50 text-blue-700"><FileText size={16} /></div>
                <div>
                  <p className="font-bold text-ink">{t(isPreviousSend ? "Previous email sent" : label)}</p>
                  <p className="mt-1 text-xs text-slate-500">{new Date(item.created_at).toLocaleString()}</p>
                </div>
                <p className="text-sm leading-6 text-slate-600">{t(isPreviousSend ? "This is a previous activity event. The current draft still needs confirmation before sending." : "Workspace activity was recorded for this company.")}</p>
              </div>;
            })}
          </div>
        </details>
      </div>

      <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-sm font-bold text-ink">{t("Company Actions")}</p>
          <p className="mt-1 text-xs leading-5 text-slate-500">{t("Choose one action and move this company forward now.")}</p>
          <div className="mt-4 grid gap-2">
            <a href={`#contacts-${current.id}`} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-brand px-4 text-sm font-bold text-white"><Phone size={17} /> {t("Contact Now")}</a>
            <a href={`#outreach-${current.id}`} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-bold text-ink"><Mail size={17} /> {t("Review Email")}</a>
            <button type="button" onClick={scheduleFollowUp} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-bold text-ink"><CalendarDays size={17} /> {t("Schedule Follow-up")}</button>
            <Link href="/dashboard/campaigns" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-bold text-ink"><Rocket size={17} /> {t("Add to Campaign")}</Link>
            {onOpenNextLead ? <button type="button" onClick={onOpenNextLead} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-slate-900 px-4 text-sm font-bold text-white"><ArrowRight size={17} /> {t(nextLeadName ? `Open Next Lead: ${nextLeadName}` : "Open Next Lead")}</button> : null}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-sm font-bold text-ink">{t("Move stage")}</p>
          <p className="mt-1 text-xs leading-5 text-slate-500">{t("Update the pipeline when the sales situation changes.")}</p>
          <div className="mt-3 grid gap-2">
            <select aria-label={t("CRM stage")} value={stageValue} onChange={(event) => setStageValue(event.target.value)} className="min-h-11 rounded-md border border-slate-300 bg-white px-3 text-sm">
              {crmStages.map((stage) => <option key={stage} value={stage}>{t(stage)}</option>)}
            </select>
            <button type="button" onClick={() => moveStage()} disabled={actionBusy === "stage"} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-ink px-4 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-60">{actionBusy === "stage" && <Loader2 className="animate-spin" size={16} />} {t("Move stage")}</button>
          </div>
        </section>

        <section id={`notes-${current.id}`} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-sm font-bold text-ink">{t("Notes")}</p>
          <p className="mt-1 text-xs leading-5 text-slate-500">{t("Use short notes, checklists, mentions or attachment links. Rich formatting can be pasted into the note.")}</p>
          <form onSubmit={addNote} className="mt-3 space-y-2">
            <label className="sr-only" htmlFor={`note-${current.id}`}>{t("Add note")}</label>
            <textarea ref={noteTextareaRef} id={`note-${current.id}`} value={noteBody} onChange={(event) => setNoteBody(event.target.value)} placeholder={t("Example: follow up next Tuesday")} className="min-h-28 w-full rounded-md border border-slate-300 bg-white p-3 text-sm" />
            <button type="submit" disabled={actionBusy === "note" || !noteBody.trim()} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-bold text-ink disabled:cursor-not-allowed disabled:opacity-60">{actionBusy === "note" && <Loader2 className="animate-spin" size={16} />} {t("Add note")}</button>
          </form>
          <div className="mt-4 space-y-2">
            {current.notes.length ? current.notes.slice(0, 5).map((note) => <div key={note.id} className="rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
              <p className="whitespace-pre-line">{localizedLegacySalesFallback(note.body, displayCurrent, locale)}</p>
              <p className="mt-2 text-xs text-slate-500">{formatDateTime(note.created_at)}</p>
            </div>) : <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600">{t("No notes yet. Add the next customer conversation or internal follow-up.")}</p>}
          </div>
        </section>

        {actionNotice && <p role="status" className="rounded-2xl bg-teal-50 p-4 text-sm font-semibold text-brand">{actionNotice}</p>}
        {actionError && <p role="alert" className="rounded-2xl bg-red-50 p-4 text-sm font-semibold text-red-700">{actionError}</p>}
        <ActionProgress current={actionCurrentStep} completed={actionCompletedSteps} />
      </aside>
    </div>
  </CompanyCardShell>;
}

function CompactCompanyCard({ company, api }: { company: CrmCompany; api: ApiFn }) {
  const { t, locale } = useI18n();
  const [current, setCurrent] = useState(company);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [currentStep, setCurrentStep] = useState("");
  const [completedSteps, setCompletedSteps] = useState<string[]>([]);
  const healthScore = companyHealthScore(current);
  const nextAction = companyNextAction(current);
  const primaryAction = companyPrimaryAction(current);
  const PrimaryActionIcon = primaryAction.icon;
  const contactCount = current.contacts.length;
  const emailCount = current.generated_emails.length;
  const aiWorkPlan = companyWorkflowStages(current);
  const aiWorkComplete = aiWorkPlan.filter((item) => item.status === "completed").length;
  const aiWorkRunning = aiWorkPlan.some((item) => item.status === "running");
  const aiNextWork = aiWorkPlan.find((item) => item.status !== "completed")?.label || "Approval";
  const website = current.website || current.domain || "";
  const primaryContact = current.contacts.find((contact) => contact.email) || current.contacts[0];

  async function completeMissingCompanyData() {
    if (!current.lead_id) {
      setError(t("Reconnect this company to a lead before generating outreach."));
      return;
    }
    setBusy("complete-data");
    setNotice(t("Collecting missing company data..."));
    setError("");
    setCompletedSteps([]);
    setCurrentStep("Starting automatic AI enrichment...");
    const markStepDone = (step: string) => setCompletedSteps((steps) => steps.includes(step) ? steps : [...steps, step]);
    try {
      setCurrentStep("AI enrichment is running automatically");
      const result = await withTimeout(
        api<WorkspaceAppActionResponse>(`/api/workspace-app/companies/${current.id}/enrichment/restart`, { method: "POST", timeoutMs: 15000 }),
        16000,
        "AI enrichment could not be restarted. The company stays saved in CRM."
      );
      if (result.company) {
        const nextCompany = normalizeCrmCompany(result.company);
        setCurrent(nextCompany);
      }
      const completed = Array.isArray(result.completed_steps) && result.completed_steps.length
        ? result.completed_steps
        : ["Website analysis checked", "Contact search checked", "Email draft checked"];
      completed.forEach(markStepDone);
      const warnings = Array.isArray(result.warnings) ? result.warnings.map((item) => t(item)).filter(Boolean) : [];

      setCurrentStep("");
      setNotice(
        warnings.length
          ? `${t("AI enrichment restarted with some missing fields.")} ${warnings.slice(0, 2).join(" ")}`
          : t("AI enrichment restarted. This card will update as data arrives.")
      );
      trackEvent("company_missing_data_completed", {
        company_id: current.id,
        company: current.name,
        warnings: warnings.length
      });
    } catch (err) {
      setError(friendlyErrorMessage(err, t("Company preparation could not be completed. Try again or continue manually.")));
      setNotice("");
      setCurrentStep("");
    } finally {
      setBusy("");
    }
  }

  async function stopAutoEnrichment() {
    if (!current.lead_id) return;
    setBusy("stop-enrichment");
    setError("");
    try {
      const result = await withTimeout(
        api<WorkspaceAppActionResponse>(`/api/workspace-app/companies/${current.id}/enrichment/cancel`, { method: "POST", timeoutMs: 12000 }),
        13000,
        "AI enrichment stop timed out. Try again."
      );
      if (result.company) setCurrent(normalizeCrmCompany(result.company));
      setNotice(t("AI enrichment stopped. Saved company data stayed in CRM."));
      setCurrentStep("");
    } catch (err) {
      setError(friendlyErrorMessage(err, t("AI enrichment could not be stopped. Try again.")));
    } finally {
      setBusy("");
    }
  }

  const compactFound = aiWorkPlan.filter((item) => item.status === "completed").map((item) => t(item.label));
  const compactMissing = aiWorkPlan.filter((item) => item.status !== "completed").map((item) => t(item.label));

  return <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-teal-200 hover:shadow-md">
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full border px-3 py-1 text-xs font-bold ${stageTone(current.crm_stage)}`}>{t(current.crm_stage)}</span>
          <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-bold text-slate-700">{t("AI Health")} {healthScore}%</span>
        </div>
        <h2 className="mt-3 break-words text-xl font-black tracking-tight text-ink">{current.name}</h2>
        <div className="mt-3 grid gap-2 text-sm text-slate-600 sm:grid-cols-2 xl:grid-cols-4">
          <span className="inline-flex min-w-0 items-center gap-1.5"><Building2 className="shrink-0" size={16} /> <span className="truncate">{current.industry || t("Not available")}</span></span>
          <span className="inline-flex min-w-0 items-center gap-1.5"><MapPin className="shrink-0" size={16} /> <span className="truncate">{[current.city, current.country].filter(Boolean).join(", ") || t("Not available")}</span></span>
          <span className="inline-flex min-w-0 items-center gap-1.5"><UserRound className="shrink-0" size={16} /> <span className="truncate">{contactCount ? `${contactCount} ${t(contactCount === 1 ? "contact" : "contacts")}` : t("No contacts yet")}</span></span>
          <span className="inline-flex min-w-0 items-center gap-1.5"><Mail className="shrink-0" size={16} /> <span className="truncate">{emailCount ? `${emailCount} ${t(emailCount === 1 ? "email draft" : "email drafts")}` : t("No email draft yet")}</span></span>
        </div>
        {website && <a className="mt-3 inline-flex max-w-full items-center gap-1.5 break-all text-sm font-bold text-brand hover:underline" href={website.startsWith("http") ? website : `https://${website}`} target="_blank" rel="noreferrer"><Globe2 className="shrink-0" size={16} />{website}</a>}
        <div className="mt-4 rounded-xl border border-teal-100 bg-teal-50 p-3">
          <p className="text-xs font-bold uppercase text-slate-500">{t("Next recommended action")}</p>
          <p className="mt-1 text-sm font-semibold leading-6 text-ink">{t(nextAction)}</p>
          <p className="mt-1 text-xs leading-5 text-slate-600">{t(primaryAction.copy)}</p>
        </div>
        <div className="mt-4 rounded-xl border border-slate-200 bg-white p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase text-brand">{t("AI work plan")}</p>
              <p className="mt-1 text-sm font-black text-ink">{aiWorkComplete}/{aiWorkPlan.length} {t("ready")}</p>
            </div>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">{t("Next")}: {t(aiNextWork)}</span>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${Math.round((aiWorkComplete / Math.max(aiWorkPlan.length, 1)) * 100)}%` }} />
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {aiWorkPlan.slice(0, 6).map((item) => {
              const Icon = item.status === "running" ? Loader2 : CheckCircle2;
              return (
                <div key={item.key} className={`rounded-lg border px-2 py-2 text-xs font-bold ${workflowStatusTone(item.status)}`}>
                  <div className="flex items-center gap-1.5">
                    <Icon className={item.status === "running" ? "animate-spin" : ""} size={14} />
                    <span>{t(item.label)}</span>
                  </div>
                  <p className="mt-1 text-[11px] font-black uppercase tracking-wide opacity-80">{t(workflowStatusLabel(item.status))}</p>
                  {item.status !== "completed" ? <p className="mt-1 text-[11px] font-semibold leading-4">{t(item.message)}</p> : null}
                </div>
              );
            })}
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-3">
            <div className="rounded-lg bg-teal-50 p-2">
              <p className="text-[11px] font-black uppercase text-brand">{t("Found")}</p>
              <p className="mt-1 text-xs font-semibold leading-5 text-slate-800">{compactFound.length ? compactFound.slice(0, 3).join(", ") : t("Nothing verified yet")}</p>
            </div>
            <div className="rounded-lg bg-amber-50 p-2">
              <p className="text-[11px] font-black uppercase text-amber-700">{t("Still missing")}</p>
              <p className="mt-1 text-xs font-semibold leading-5 text-slate-800">{compactMissing.length ? compactMissing.slice(0, 3).join(", ") : t("No critical gaps")}</p>
            </div>
            <div className="rounded-lg bg-slate-50 p-2">
              <p className="text-[11px] font-black uppercase text-slate-500">{t("Next")}</p>
              <p className="mt-1 text-xs font-semibold leading-5 text-slate-800">{t(compactMissing.length ? "Run all missing steps" : "Review and approve")}</p>
            </div>
          </div>
        </div>
      </div>
      <div className="grid shrink-0 gap-2 lg:w-56">
        {compactMissing.length > 0 ? (
          <button type="button" onClick={completeMissingCompanyData} disabled={busy === "complete-data" || !current.lead_id} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-brand px-4 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-60">
            {busy === "complete-data" ? <Loader2 className="animate-spin" size={17} /> : <Sparkles size={17} />}
            {t(aiWorkRunning ? "Restart AI enrichment" : "Run all missing steps")}
          </button>
        ) : (
          <Link href={`/dashboard/companies?company=${encodeURIComponent(current.id)}`} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-brand px-4 text-sm font-bold text-white">
            <PrimaryActionIcon size={17} />
            {t("Continue work")}
            <ArrowRight size={16} />
          </Link>
        )}
        {aiWorkRunning && <button type="button" onClick={stopAutoEnrichment} disabled={busy === "stop-enrichment"} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-bold text-ink disabled:cursor-not-allowed disabled:opacity-60">
          {busy === "stop-enrichment" ? <Loader2 className="animate-spin" size={17} /> : <Pause size={17} />}
          {t("Stop AI enrichment")}
        </button>}
        {compactMissing.length > 0 && <Link href={`/dashboard/companies?company=${encodeURIComponent(current.id)}`} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-bold text-ink">
          <PrimaryActionIcon size={17} />
          {t("Open company")}
          <ArrowRight size={16} />
        </Link>}
      </div>
    </div>
    <div className="mt-3">
      <ActionProgress current={currentStep} completed={completedSteps} />
    </div>
    {notice && <p role="status" className="mt-3 rounded-xl bg-teal-50 p-3 text-sm font-semibold text-brand">{notice}</p>}
    {error && <p role="alert" className="mt-3 rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p>}
    {current.notes.length > 0 && <div className="mt-3 rounded-xl bg-slate-50 p-3 text-sm text-slate-700">{current.notes.slice(0, 2).map((note) => <p key={note.id}>{localizedLegacySalesFallback(note.body, current, locale)}</p>)}</div>}
    <div className="mt-4 grid gap-3 border-t border-slate-100 pt-4 text-sm sm:grid-cols-3">
      <p><span className="block text-xs font-bold uppercase text-slate-500">{t("Last activity")}</span><span className="font-semibold text-ink">{formatDateTime(current.last_activity_at || current.stage_changed_at || current.updated_at)}</span></p>
      <p><span className="block text-xs font-bold uppercase text-slate-500">{t("Decision maker")}</span><span className="font-semibold text-ink">{primaryContact?.name || primaryContact?.title || t("Not available")}</span></p>
      <p><span className="block text-xs font-bold uppercase text-slate-500">{t("Verified email")}</span><span className="font-semibold text-ink">{current.email || primaryContact?.email || t("Not available")}</span></p>
    </div>
  </article>;
}

export function CompaniesPage() {
  const { api, companies, loading, error, filters, setFilters } = useCrmData();
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const focusedCompanyId = searchParams.get("company") || "";
  const focusedCompany = companies.find((company) => company.id === focusedCompanyId);
  const primaryCompanies = companies.slice(0, 3);
  const secondaryCompanies = companies.slice(3);

  return <div className="space-y-6">
    <PageHeader eyebrow="Companies" title="Open the next company to finish the opportunity." copy="Keep this screen focused: review the best saved companies, fill missing data, prepare the email, then approve." action={<Link href="/dashboard/leads" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-brand px-4 text-sm font-bold text-white">{t("Find leads")} <ArrowRight size={17} /></Link>} />
    {focusedCompany && <section className="rounded-2xl border border-teal-200 bg-teal-50 p-4 text-sm text-slate-700">
      <p className="font-bold text-brand">{t("Opened from CRM pipeline")}</p>
      <p className="mt-1">{t("Continue with the highlighted company, or clear the focus to view the full CRM list.")}</p>
      <Link href="/dashboard/companies" className="mt-3 inline-flex min-h-10 items-center justify-center rounded-md border border-teal-300 bg-white px-3 text-xs font-bold text-brand">{t("Clear focus")}</Link>
    </section>}
    <details className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <summary className="cursor-pointer text-sm font-black text-slate-700">{t("Search and filters")}</summary>
      <div className="mt-4"><CrmFilters filters={filters} setFilters={setFilters} /></div>
    </details>
    {loading ? <EmptyState title="Loading CRM companies" copy="Loading saved companies." /> : error ? <WidgetErrorCard title="Companies could not update" copy={error} /> : focusedCompany ? <WidgetBoundary name={`Company workspace: ${focusedCompany.name}`}><CrmCompanyCard company={focusedCompany} api={api} highlighted /></WidgetBoundary> : companies.length ? <div className="grid gap-4">
      {primaryCompanies.map((company) => <WidgetBoundary key={company.id} name={`Company summary: ${company.name}`}><CompactCompanyCard company={company} api={api} /></WidgetBoundary>)}
      {secondaryCompanies.length > 0 && <details className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <summary className="cursor-pointer text-sm font-black text-slate-700">{t("Show more companies")} · {secondaryCompanies.length}</summary>
        <div className="mt-4 grid gap-4">
          {secondaryCompanies.map((company) => <WidgetBoundary key={company.id} name={`Company summary: ${company.name}`}><CompactCompanyCard company={company} api={api} /></WidgetBoundary>)}
        </div>
      </details>}
    </div> : <EmptyState title="No companies saved yet" copy="Run Lead Finder or add a manual company. OutreachAI will save real companies here, not demo data." action={<Link href="/dashboard/leads" className="inline-flex min-h-11 items-center rounded-md bg-brand px-4 text-sm font-bold text-white">{t("Find companies")}</Link>} />}</div>;
}

export function WebsiteAnalyzerPage() {
  const { api } = useTokenApi();
  const { t } = useI18n();
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setLoading(true);
    setError("");
    try {
      const result = await api<AnalysisResult>("/api/ai/analyze", { method: "POST", body: JSON.stringify({ website: String(data.get("website") || ""), company: String(data.get("company") || ""), niche: String(data.get("niche") || "") }) });
      setAnalysis(normalizeAnalysis(result));
    } catch (err) {
      setError(friendlyErrorMessage(err, "Website analysis could not be completed. Check the website and try again."));
    } finally {
      setLoading(false);
    }
  }
  return <div className="space-y-6"><PageHeader eyebrow="Website Analyzer" title="Analyze a real prospect website." copy="OutreachAI reads the website and extracts ICP, pain points, offer and outreach strategy." /><form onSubmit={submit} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="grid gap-4 md:grid-cols-3"><input required name="website" placeholder="https://company.com" className="min-h-11 rounded-md border border-slate-300 px-3" /><input name="company" placeholder={t("Company name")} className="min-h-11 rounded-md border border-slate-300 px-3" /><input name="niche" placeholder={t("Industry or niche")} className="min-h-11 rounded-md border border-slate-300 px-3" /></div><div className="mt-4"><PrimaryButton type="submit" disabled={loading}>{loading ? <Loader2 className="animate-spin" size={17} /> : <Sparkles size={17} />} {t("Analyze website")}</PrimaryButton></div>{error && <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p>}</form>{analysis ? <WidgetBoundary name="Website analysis results"><section className="grid gap-4 lg:grid-cols-2">{[["Business summary", analysis.company_summary || analysis.summary], ["Services", safeArray(analysis.services).join(", ") || unavailable], ["Target customers", analysis.niche || unavailable], ["Weak points", safeArray(analysis.weaknesses).join(", ") || unavailable], ["Possible outreach angle", analysis.sales_angle || unavailable], ["Suggested offer", analysis.suggested_offer || unavailable], ["Personalization facts", safeArray(analysis.strengths).join(", ") || unavailable], ["Recommended cold email", analysis.outreach_strategy || unavailable]].map(([label, value]) => <article key={label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="font-bold text-ink">{t(label)}</h2><p className="mt-2 text-sm leading-6 text-slate-600">{t(value)}</p></article>)}</section></WidgetBoundary> : <EmptyState title="No website analyzed yet" copy="Enter a real domain. OutreachAI will not show sample analysis." />}</div>;
}

export function ContactsPage() {
  const { contacts, loading, error, filters, setFilters } = useCrmData();
  const { t } = useI18n();
  return <div className="space-y-6"><PageHeader eyebrow="Contacts" title="Decision makers and verified emails." copy="Contacts come from verified contact discovery, local business data, or manual lead import. Missing emails are not invented." /><CrmFilters filters={filters} setFilters={setFilters} />{loading ? <EmptyState title="Loading contacts" copy="Checking saved CRM contacts." /> : error ? <EmptyState title="Contacts unavailable" copy={error} /> : contacts.length ? <section className="grid gap-4 lg:grid-cols-3">{contacts.map((contact) => <article key={contact.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="font-bold text-ink">{contact.name || t("Decision maker unavailable")}</h2><p className="mt-1 text-sm text-slate-600">{contact.title || t("Role unavailable")} · {contact.company}</p><p className="mt-4 rounded-xl bg-slate-50 p-3 text-sm font-semibold">{contact.email || t("No verified email available")}</p><p className="mt-3 text-sm text-slate-600">{t(contact.email_status)} · {t(sourceLabel(contact.source))}</p></article>)}</section> : <EmptyState title="No decision makers yet" copy="Find contacts or add one manually. OutreachAI will not create fake contacts." />}</div>;
}

function campaignReadiness(campaign: Campaign) {
  const hasLeads = Number(campaign.leads || 0) > 0;
  const hasSequence = safeArray(campaign.sequence).length > 0;
  const hasReviewedDraft = safeArray(campaign.sequence).some((step) => Boolean(step.subject || step.body));
  const status = text(campaign.status).toLowerCase();
  const isPaused = status === "paused";
  const isRunning = status === "running" || status === "scheduled";
  if (!hasLeads) {
    return {
      state: "Needs leads",
      copy: "Add at least one saved company before this campaign can move forward.",
      action: "Add leads",
      href: "/dashboard/leads",
      variant: "warning" as const
    };
  }
  if (!hasSequence) {
    return {
      state: "Needs sequence",
      copy: "Create the email and follow-up steps before launch.",
      action: "Create sequence",
      href: "/dashboard/companies",
      variant: "warning" as const
    };
  }
  if (!hasReviewedDraft) {
    return {
      state: "Review required",
      copy: "Generate or review the first email draft before launching.",
      action: "Review emails",
      href: "/dashboard/companies",
      variant: "warning" as const
    };
  }
  if (isPaused) {
    return {
      state: "Paused safely",
      copy: "This campaign is paused. Resume only when the reviewed emails are ready.",
      action: "Resume",
      href: "",
      variant: "ready" as const
    };
  }
  if (isRunning) {
    return {
      state: "Running",
      copy: "Outreach is active. Watch replies and pause anytime.",
      action: "Pause",
      href: "",
      variant: "ready" as const
    };
  }
  return {
    state: "Ready for approval",
    copy: "Reviewed outreach is ready. Launch only when you approve the send.",
    action: "Launch after approval",
    href: "",
    variant: "ready" as const
  };
}

function campaignStepLabel(step: CampaignSequence, translate: (value: string) => string) {
  const rawName = text(step.name).trim();
  if (/^email\s*#?1$/i.test(rawName) || step.step_order === 1) return `${translate("First email")}`;
  const followUpMatch = rawName.match(/follow[-\s]?up\s*#?(\d+)/i);
  if (followUpMatch) return `${translate("Follow-up")} #${followUpMatch[1]}`;
  if (step.step_order > 1 && !rawName) return `${translate("Follow-up")} #${step.step_order - 1}`;
  return translate(rawName || "Email");
}

export function CampaignsPage() {
  const { api, campaigns, setCampaigns, leads, loading, error, refresh } = useSalesData();
  const [notice, setNotice] = useState("");
  const [actionBusy, setActionBusy] = useState("");
  const { t } = useI18n();

  async function createCampaign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(event.currentTarget);
    const lead = leads[0];
    const payload = {
      name: String(data.get("name") || `${lead?.industry || "Outbound"} campaign`),
      industry: String(data.get("industry") || lead?.industry || ""),
      countries: splitList(String(data.get("country") || lead?.country || "")),
      cities: splitList(String(data.get("city") || lead?.city || "")),
      company_size: String(data.get("company_size") || ""),
      keywords: splitList(String(data.get("keywords") || "")),
      language: "English",
      offer: String(data.get("offer") || lead?.suggested_offer || "A practical sales growth improvement based on real company research."),
      cta: String(data.get("cta") || "Open to a quick review?"),
      email_tone: "Professional",
      signature: String(data.get("signature") || ""),
      daily_send_limit: 25,
      working_hours: "09:00-17:00",
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      follow_up_days: 3,
      sequence: [
        { step_order: 1, name: "Email #1", subject: "", body: "", delay_days: 0 },
        { step_order: 2, name: "Follow-up #1", subject: "", body: "", delay_days: 3 },
        { step_order: 3, name: "Follow-up #2", subject: "", body: "", delay_days: 7 },
        { step_order: 4, name: "Follow-up #3", subject: "", body: "", delay_days: 14 }
      ]
    };
    setActionBusy("create");
    setNotice("");
    try {
      const campaign = await api<Campaign>("/api/campaigns", { method: "POST", body: JSON.stringify(payload) });
      setCampaigns((items) => [safeCampaign(campaign), ...items.filter((item) => item.id !== campaign.id)]);
      let attachWarning = "";
      if (lead?.id) {
        try {
          await api<Lead>(`/api/leads/${lead.id}`, { method: "PATCH", body: JSON.stringify({ campaign_id: campaign.id, status: "Qualified" }) });
        } catch (attachError) {
          reportWidgetFailure(attachError, "campaign-lead-attach", { campaign_id: campaign.id, lead_id: lead.id });
          attachWarning = " Campaign was created, but the first lead could not be attached automatically. Open CRM and add leads manually.";
        }
      }
      setNotice(`Campaign created. Your first opportunity was added for review; no email was sent.${attachWarning}`);
      trackEvent("campaign_created_from_workspace", { campaign_id: campaign.id, first_lead_id: lead?.id || "" });
      form.reset();
      await refresh();
    } catch (err) {
      setNotice(friendlyErrorMessage(err, "Campaign could not be created. Check your plan limits and try again."));
    } finally {
      setActionBusy("");
    }
  }

  async function campaignAction(campaignId: string, action: "launch" | "pause" | "resume") {
    setActionBusy(`${campaignId}:${action}`);
    setNotice("");
    try {
      const updated = await api<Campaign>(`/api/campaigns/${campaignId}/${action}`, { method: "POST" });
      setCampaigns((items) => items.map((item) => item.id === campaignId ? safeCampaign({ ...item, ...updated }) : item));
      setNotice(`${updated.name} is now ${updated.status}. Emails still require approved drafts before sending.`);
      trackEvent("campaign_status_updated", { campaign_id: campaignId, action, status: updated.status });
    } catch (err) {
      setNotice(t(friendlyErrorMessage(err, "Campaign status could not be updated.")));
    } finally {
      setActionBusy("");
    }
  }

  return <div className="space-y-6">
    <PageHeader eyebrow="Campaigns" title="Review real outreach before anything is sent." copy="Create a simple sequence from saved opportunities. OutreachAI keeps generated emails in review mode until you approve a send." />
    {notice && <p role="status" className="rounded-2xl border border-slate-200 bg-white p-4 text-sm font-semibold text-slate-700 shadow-sm">{notice}</p>}
    {!loading && !error && leads.length > 0 && <form onSubmit={createCampaign} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-bold uppercase text-brand">{t("Next step")}</p>
          <h2 className="mt-1 text-xl font-bold text-ink">{t("Create a campaign from saved leads")}</h2>
          <p className="mt-2 text-sm text-slate-600">{t("Expected time: 1 minute. You can review every email before anything is sent.")}</p>
        </div>
        <span className="w-fit rounded-full bg-teal-50 px-3 py-1 text-xs font-bold text-brand">{t("Review before send")}</span>
      </div>
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <label className="text-sm font-semibold text-slate-700">{t("Campaign name")}<input name="name" required placeholder={`${leads[0]?.industry || t("Outbound")} ${t("campaign")}`} className="mt-2 min-h-11 w-full rounded-md border border-slate-300 px-3 text-sm" /></label>
        <label className="text-sm font-semibold text-slate-700">{t("Industry")}<input name="industry" defaultValue={leads[0]?.industry || ""} className="mt-2 min-h-11 w-full rounded-md border border-slate-300 px-3 text-sm" /></label>
        <label className="text-sm font-semibold text-slate-700">{t("Country")}<input name="country" defaultValue={leads[0]?.country || ""} className="mt-2 min-h-11 w-full rounded-md border border-slate-300 px-3 text-sm" /></label>
        <label className="text-sm font-semibold text-slate-700">{t("City")}<input name="city" defaultValue={leads[0]?.city || ""} className="mt-2 min-h-11 w-full rounded-md border border-slate-300 px-3 text-sm" /></label>
        <label className="text-sm font-semibold text-slate-700 md:col-span-2">{t("Offer")}<textarea name="offer" defaultValue={leads[0]?.suggested_offer || ""} placeholder={t("What should the email offer?")} className="mt-2 min-h-24 w-full rounded-md border border-slate-300 p-3 text-sm" /></label>
        <label className="text-sm font-semibold text-slate-700">{t("Call to action")}<input name="cta" placeholder={t("Open to a quick review?")} className="mt-2 min-h-11 w-full rounded-md border border-slate-300 px-3 text-sm" /></label>
        <label className="text-sm font-semibold text-slate-700">{t("Signature")}<input name="signature" placeholder={t("Your name")} className="mt-2 min-h-11 w-full rounded-md border border-slate-300 px-3 text-sm" /></label>
      </div>
      <div className="mt-5"><PrimaryButton type="submit" disabled={actionBusy === "create"}>{actionBusy === "create" ? <Loader2 className="animate-spin" size={17} /> : <Plus size={17} />} {t("Create campaign")}</PrimaryButton></div>
    </form>}
    {loading ? <EmptyState title="Loading campaigns" copy="Reading saved campaigns." /> : error ? <EmptyState title="Campaign data unavailable" copy={error} /> : campaigns.length ? <section className="grid gap-4 lg:grid-cols-2">{campaigns.map((campaign) => {
      const readiness = campaignReadiness(campaign);
      const busy = actionBusy.startsWith(campaign.id);
      const canRunAction = !readiness.href;
      const runAction = readiness.action === "Pause" ? "pause" : readiness.action === "Resume" ? "resume" : "launch";
      return <article key={campaign.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="font-bold text-ink">{campaign.name}</h2>
            <p className="mt-2 text-sm text-slate-600">{campaign.leads} {t("leads")} · {campaign.sent} {t("sent")} · {campaign.replies} {t("replies")}</p>
          </div>
          <span className={`w-fit rounded-full px-3 py-1 text-xs font-bold ${readiness.variant === "ready" ? "bg-teal-50 text-brand" : "bg-amber-50 text-amber-800"}`}>{t(readiness.state)}</span>
        </div>
        <div className={`mt-4 rounded-2xl border p-4 ${readiness.variant === "ready" ? "border-teal-100 bg-teal-50" : "border-amber-100 bg-amber-50"}`}>
          <p className="text-sm font-bold uppercase text-brand">{t("Next step")}</p>
          <p className="mt-2 text-lg font-black text-ink">{t(readiness.action)}</p>
          <p className="mt-2 text-sm leading-6 text-slate-700">{t(readiness.copy)}</p>
          <div className="mt-4">
            {canRunAction ? <PrimaryButton onClick={() => campaignAction(campaign.id, runAction)} disabled={busy}>{busy ? <Loader2 className="animate-spin" size={17} /> : runAction === "pause" ? <Pause size={17} /> : <Play size={17} />} {t(readiness.action)}</PrimaryButton> : <Link href={readiness.href} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-brand px-4 text-sm font-bold text-white shadow-sm">{t(readiness.action)} <ArrowRight size={17} /></Link>}
          </div>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs font-bold uppercase text-slate-500">{t("Status")}</p><p className="mt-1 font-bold text-ink">{t(campaign.status)}</p></div>
          <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs font-bold uppercase text-slate-500">{t("Daily limit")}</p><p className="mt-1 font-bold text-ink">{campaign.daily_send_limit || 0}</p></div>
          <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs font-bold uppercase text-slate-500">{t("Working hours")}</p><p className="mt-1 font-bold text-ink">{campaign.working_hours || t("Not available")}</p></div>
        </div>
        <div className="mt-4 space-y-3">{campaign.sequence.length ? campaign.sequence.map((step) => <div key={step.step_order} className="rounded-xl bg-slate-50 p-3"><p className="font-bold">{campaignStepLabel(step, t)}</p><p className="mt-1 text-sm text-slate-600">{step.subject || t("Subject unavailable until AI draft is reviewed")}</p><p className="mt-1 text-xs font-semibold text-slate-500">{t("Delay")}: {step.delay_days} {t("days")}</p></div>) : <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600">{t("No sequence saved yet.")}</p>}</div>
        <p className="mt-4 rounded-xl bg-slate-50 p-3 text-sm font-bold text-slate-700">{t("Review before send: enabled")}</p>
      </article>;
    })}</section> : <EmptyState title="No campaigns yet" copy={leads.length ? "Create a campaign from selected opportunities before sending." : "Find leads first, then create a campaign. No sample campaigns are shown."} action={leads.length ? undefined : <Link href="/dashboard/leads" className="inline-flex min-h-11 items-center rounded-md bg-brand px-4 text-sm font-bold text-white">{t("Find leads")}</Link>} />}
  </div>;
}

export function InboxPage() {
  const { metrics, leads, campaigns, loading, error } = useSalesData();
  const { t } = useI18n();
  const approvedOrSent = leads.filter((lead) => lead.email_approved_at || lead.email_sent_at);
  const repliedLeads = leads.filter((lead) => lead.replied_at);
  const activeCampaigns = campaigns.filter((campaign) => ["running", "active", "sent"].includes(String(campaign.status || "").toLowerCase()));
  const hasReplyData = metrics.replies > 0 || repliedLeads.length > 0;

  return <div className="space-y-6">
    <PageHeader
      eyebrow="Inbox"
      title="Turn replies into meetings."
      copy="This is where OutreachAI keeps follow-up work simple: watch replies, classify intent and move the company to the next CRM step."
      action={<Link href={approvedOrSent.length ? "/dashboard/campaigns" : "/dashboard/companies"} className="inline-flex min-h-11 items-center justify-center rounded-md bg-brand px-4 text-sm font-bold text-white">{t(approvedOrSent.length ? "Review campaigns" : "Prepare email")}</Link>}
    />
    {loading ? <EmptyState title="Loading reply workspace" copy="Reading campaigns and reply events." /> : error ? <WidgetErrorCard title="Reply workspace unavailable" copy={error} /> : <>
      <section className="grid gap-4 sm:grid-cols-3">
        <MetricCard label="Approved emails" value={String(approvedOrSent.length)} help="Ready for reply tracking" />
        <MetricCard label="Replies" value={String(metrics.replies || repliedLeads.length)} help="Real replies captured" />
        <MetricCard label="Reply rate" value={`${metrics.reply_rate || 0}%`} help="From tracked campaigns" />
      </section>
      {hasReplyData ? <section className="grid gap-4 lg:grid-cols-2">
        {repliedLeads.slice(0, 6).map((lead) => <article key={lead.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-bold uppercase text-brand">{t("Reply received")}</p>
          <h2 className="mt-2 text-lg font-black text-ink">{lead.company}</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">{t("Review the reply, update CRM stage and decide the next follow-up.")}</p>
          <Link href={lead.crm_company_id ? `/dashboard/companies?company=${encodeURIComponent(lead.crm_company_id)}` : "/dashboard/companies"} className="mt-4 inline-flex min-h-11 items-center justify-center rounded-md bg-ink px-4 text-sm font-bold text-white">{t("Open company")}</Link>
        </article>)}
      </section> : <EmptyState
        title={activeCampaigns.length ? "No replies yet" : "No active campaign replies yet"}
        copy={activeCampaigns.length ? "Replies will appear here automatically after approved emails receive real responses." : "Approve an email and launch a campaign first. Then OutreachAI will classify replies and show the next sales action here."}
        action={<Link href={approvedOrSent.length ? "/dashboard/campaigns" : "/dashboard/companies"} className="inline-flex min-h-11 items-center rounded-md bg-brand px-4 text-sm font-bold text-white">{t(approvedOrSent.length ? "Review campaigns" : "Prepare email")}</Link>}
      />}
    </>}
  </div>;
}

export function CrmPipelinePage() {
  const { pipeline, loading, error } = useCrmData();
  const { t } = useI18n();
  const totalCompanies = pipeline.companies.length;
  const companiesWithNextStep = pipeline.companies.filter((company) => companyNextAction(company) !== "Keep notes updated and close the outcome.");
  const nextCompany = companiesWithNextStep[0] || pipeline.companies[0];

  return <div className="space-y-6">
    <PageHeader
      eyebrow="CRM Pipeline"
      title="Move real leads from research to revenue."
      copy="Pipeline stages update from saved companies, AI research, email drafts and customer replies."
      action={<Link href="/dashboard/companies" className="inline-flex min-h-11 items-center justify-center rounded-md bg-ink px-4 text-sm font-bold text-white">{t("Review companies")}</Link>}
    />
    {loading ? <EmptyState title="Loading pipeline" copy="Reading CRM stages." /> : error ? <EmptyState title="Pipeline unavailable" copy={error} /> : totalCompanies ? <>
      <section className="grid gap-4 lg:grid-cols-[1.3fr_0.7fr]">
        <article className="rounded-2xl border border-teal-200 bg-teal-50 p-5 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-wide text-brand">{t("Next sales action")}</p>
          <h2 className="mt-2 text-xl font-black text-ink">{nextCompany ? nextCompany.name : t("No company selected")}</h2>
          <p className="mt-2 text-sm leading-6 text-slate-700">{nextCompany ? t(companyNextAction(nextCompany)) : t("Find companies first, then move them through the CRM.")}</p>
          <div className="mt-4 flex flex-col gap-2 min-[430px]:flex-row">
            <Link href={nextCompany ? `/dashboard/companies?company=${encodeURIComponent(nextCompany.id)}` : "/dashboard/companies"} className="inline-flex min-h-11 items-center justify-center rounded-md bg-brand px-4 text-sm font-bold text-white">{t("Open company workspace")}</Link>
            <Link href="/dashboard/leads" className="inline-flex min-h-11 items-center justify-center rounded-md border border-teal-300 bg-white px-4 text-sm font-bold text-brand">{t("Find more leads")}</Link>
          </div>
        </article>
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{t("Pipeline health")}</p>
          <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <p className="rounded-xl bg-slate-50 p-3"><span className="text-2xl font-black text-ink">{totalCompanies}</span><br />{t("Companies in CRM")}</p>
            <p className="rounded-xl bg-slate-50 p-3"><span className="text-2xl font-black text-ink">{companiesWithNextStep.length}</span><br />{t("Need action")}</p>
          </div>
        </article>
      </section>
      <section className="grid gap-4 xl:grid-cols-3 2xl:grid-cols-4">
        {pipeline.stages.map((stage) => {
          const items = pipeline.companies.filter((company) => company.crm_stage === stage);
          return <article key={stage} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-bold text-ink">{t(stage)}</h2>
              <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-600">{items.length}</span>
            </div>
            <div className="mt-4 space-y-3">
              {items.length ? items.map((company) => <div key={company.id} className="rounded-xl bg-slate-50 p-3 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <p className="font-semibold text-slate-800">{company.name}</p>
                  <span className="shrink-0 rounded-full bg-white px-2 py-1 text-[11px] font-bold text-slate-600">{pipelineReadiness(company)}</span>
                </div>
                <p className="mt-1 text-slate-600">{t(emailStatusLabel(company.email_status))} · {t(sourceLabel(company.source))}</p>
                <p className="mt-2 text-xs font-semibold text-brand">{t(companyNextAction(company))}</p>
                <Link href={`/dashboard/companies?company=${encodeURIComponent(company.id)}`} className="mt-3 inline-flex min-h-10 items-center justify-center rounded-md border border-slate-200 bg-white px-3 text-xs font-bold text-ink">{t("Open company")}</Link>
              </div>) : <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-500">{t("No companies in this stage. Move a company here when the sales situation changes.")}</p>}
            </div>
          </article>;
        })}
      </section>
    </> : <EmptyState title="No companies in CRM yet" copy="Find or add your first company. OutreachAI will save it here and show the next sales action." action={<Link href="/dashboard/leads" className="inline-flex min-h-11 items-center rounded-md bg-brand px-4 text-sm font-bold text-white">{t("Find leads")}</Link>} />}</div>;
}

export function DealsPage() {
  const { deals, loading, error, filters, setFilters } = useCrmData();
  const { t } = useI18n();
  return <div className="space-y-6"><PageHeader eyebrow="Deals" title="Revenue opportunities from saved companies." copy="Every saved company gets a CRM deal so you can track the next step toward a meeting or customer." /><CrmFilters filters={filters} setFilters={setFilters} />{loading ? <EmptyState title="Loading deals" copy="Reading CRM opportunities." /> : error ? <EmptyState title="Deals unavailable" copy={error} /> : deals.length ? <section className="grid gap-4 lg:grid-cols-3">{deals.map((deal) => <article key={deal.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-xs font-bold uppercase text-brand">{t(deal.stage)}</p><h2 className="mt-2 font-bold text-ink">{deal.name}</h2><p className="mt-1 text-sm text-slate-600">{deal.company}</p><div className="mt-4 grid grid-cols-2 gap-2 text-sm"><p className="rounded-xl bg-slate-50 p-3"><span className="font-bold">{t("Value")}</span><br />€{Math.round(deal.value || 0).toLocaleString()}</p><p className="rounded-xl bg-slate-50 p-3"><span className="font-bold">{t("Probability")}</span><br />{deal.probability}%</p></div><p className="mt-4 rounded-xl bg-teal-50 p-3 text-sm font-semibold text-brand">{t(deal.next_step || "Review the company and prepare outreach.")}</p></article>)}</section> : <EmptyState title="No deals yet" copy="Saved companies automatically create CRM deals. Start with Lead Finder to build your first opportunity list." action={<Link href="/dashboard/leads" className="inline-flex min-h-11 items-center rounded-md bg-brand px-4 text-sm font-bold text-white">{t("Find companies")}</Link>} />}</div>;
}

export function AnalyticsPage() {
  const { metrics, loading, error } = useSalesData();
  const { t } = useI18n();
  const cards = [["Leads found", metrics.leads], ["Websites analyzed", metrics.funnel?.find((item) => item.status === "analyzed")?.count || 0], ["Emails generated", metrics.emails_sent + metrics.delivered], ["Emails sent", metrics.emails_sent], ["Open rate", `${metrics.open_rate || 0}%`], ["Reply rate", `${metrics.reply_rate || 0}%`], ["Meetings booked", metrics.meetings], ["Clients won", metrics.conversion_rate ? `${metrics.conversion_rate}% conversion` : "0"], ["Estimated revenue", `€${Math.round(metrics.revenue_forecast || metrics.revenue || 0).toLocaleString()}`]];
  const visibleCards = cards.filter(([, value]) => {
    const normalized = String(value);
    return !["0", "0%", "€0"].includes(normalized);
  });
  return <div className="space-y-6"><PageHeader eyebrow="Analytics" title="Measure what creates meetings." copy="Analytics stays focused on the sales actions companies pay for: leads found, emails approved, campaigns sent, replies and meetings." action={<Link href="/dashboard/leads" className="inline-flex min-h-11 items-center justify-center rounded-md bg-brand px-4 text-sm font-bold text-white">{t("Find leads")}</Link>} />{loading ? <EmptyState title="Loading analytics" copy="Reading real workspace metrics." /> : error ? <WidgetErrorCard title="Analytics unavailable" copy={error} /> : visibleCards.length ? <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{visibleCards.map(([label, value]) => <MetricCard key={String(label)} label={String(label)} value={String(value)} help="Workspace data" />)}</section> : <EmptyState title="No performance data yet" copy="Find leads, prepare emails and launch one approved campaign. Analytics will then show real conversion signals instead of placeholder numbers." action={<Link href="/dashboard/leads" className="inline-flex min-h-11 items-center rounded-md bg-brand px-4 text-sm font-bold text-white">{t("Find leads")}</Link>} />}</div>;
}

function OutreachSenderSettingsPanel({ api, ready }: { api: ApiFn; ready: boolean }) {
  const { t } = useI18n();
  const [status, setStatus] = useState<OutreachSenderStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [form, setForm] = useState({
    provider: "resend",
    sender_name: "",
    sender_email: "",
    reply_to: "",
    daily_send_limit: 25,
    enabled: true,
    smtp_host: "",
    smtp_port: 587,
    smtp_username: "",
    smtp_password: "",
    smtp_use_tls: true,
  });

  const loadStatus = useCallback(async () => {
    if (!ready) return;
    setLoading(true);
    setError("");
    try {
      const next = await api<OutreachSenderStatus>("/api/outreach/sender/status");
      setStatus(next);
      setForm({
        provider: next.provider || "resend",
        sender_name: next.sender_name || "",
        sender_email: next.sender_email || "",
        reply_to: next.reply_to || "",
        daily_send_limit: next.daily_send_limit || 25,
        enabled: next.status !== "needs_setup" || next.connected,
        smtp_host: next.smtp_host || "",
        smtp_port: next.smtp_port || 587,
        smtp_username: next.smtp_username || "",
        smtp_password: "",
        smtp_use_tls: true,
      });
    } catch (err) {
      reportWidgetFailure(err, "outreach-sender-status", { endpoint: "/api/outreach/sender/status" });
      setError(userMessage(err, "Email sending setup is temporarily unavailable.", t));
    } finally {
      setLoading(false);
    }
  }, [api, ready, t]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadStatus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadStatus]);

  async function saveSender(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const senderName = form.sender_name.trim();
    const senderEmail = form.sender_email.trim();
    const replyToEmail = form.reply_to.trim();
    const smtpHost = form.smtp_host.trim();
    const smtpUsername = form.smtp_username.trim();
    const smtpPassword = form.smtp_password;
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!senderName || !senderEmail) {
      setError(t("Enter sender name and sender email before saving."));
      setSaved("");
      return;
    }

    if (!emailPattern.test(senderEmail)) {
      setError(t("Enter a valid sender email before saving."));
      setSaved("");
      return;
    }

    if (replyToEmail && !emailPattern.test(replyToEmail)) {
      setError(t("Enter a valid reply-to email or leave it blank."));
      setSaved("");
      return;
    }

    if (form.provider === "smtp") {
      if (!smtpHost || !smtpUsername) {
        setError(t("Enter SMTP host and username before saving."));
        setSaved("");
        return;
      }
      if (!status?.smtp_configured && !smtpPassword.trim()) {
        setError(t("Enter an SMTP password before saving."));
        setSaved("");
        return;
      }
    }
    setSaving(true);
    setError("");
    setSaved("");
    try {
      const next = await api<OutreachSenderStatus>("/api/outreach/sender", {
        method: "PUT",
        body: JSON.stringify({
          provider: form.provider,
          sender_name: senderName,
          sender_email: senderEmail || null,
          reply_to: replyToEmail || null,
          daily_send_limit: Number(form.daily_send_limit) || 25,
          enabled: form.enabled,
          smtp_host: smtpHost,
          smtp_port: Number(form.smtp_port) || 587,
          smtp_username: smtpUsername,
          smtp_password: smtpPassword,
          smtp_use_tls: form.smtp_use_tls,
        }),
      });
      setStatus(next);
      setForm((current) => ({
        ...current,
        provider: next.provider || current.provider,
        sender_name: next.sender_name || current.sender_name,
        sender_email: next.sender_email || current.sender_email,
        reply_to: next.reply_to || current.reply_to,
        daily_send_limit: next.daily_send_limit || current.daily_send_limit,
        smtp_host: next.smtp_host || current.smtp_host,
        smtp_port: next.smtp_port || current.smtp_port,
        smtp_username: next.smtp_username || current.smtp_username,
        smtp_password: "",
      }));
      if (next.connected) {
        setSaved(t("Sending setup saved"));
        setError("");
      } else {
        setSaved("");
        setError(t(next.next_action || next.reason || "Sender is not connected yet. Complete the required sending setup, then try sending again."));
      }
    } catch (err) {
      reportWidgetFailure(err, "outreach-sender-save", { endpoint: "/api/outreach/sender" });
      setError(userMessage(err, "Sending setup could not be saved.", t));
    } finally {
      setSaving(false);
    }
  }

  const badgeClass = status?.connected ? "border-teal-200 bg-teal-50 text-brand" : "border-amber-200 bg-amber-50 text-amber-900";
  return (
    <section id="email-sending" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-bold uppercase text-brand">{t("Email sending")}</p>
          <h2 className="mt-2 text-xl font-black text-ink">{t("Send from your workspace")}</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">{t("Approved emails are sent only when a sender is connected and the daily safety limit allows it.")}</p>
        </div>
        <span className={`inline-flex min-h-9 items-center justify-center rounded-full border px-3 text-sm font-black ${badgeClass}`}>{t(status?.connected ? "Connected" : "Needs setup")}</span>
      </div>
      {loading ? <div className="mt-4 h-28 animate-pulse rounded-xl bg-slate-100" /> : (
        <div className="mt-4 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <form onSubmit={saveSender} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm font-bold text-ink sm:col-span-2">{t("Provider")}
                <select value={form.provider} onChange={(event) => setForm((current) => ({ ...current, provider: event.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm font-semibold">
                  <option value="resend">{t("Connected API sender")}</option>
                  <option value="smtp">{t("SMTP mailbox")}</option>
                </select>
              </label>
              <p className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm font-semibold leading-6 text-slate-700 sm:col-span-2">
                {t("Choose Connected API sender for the fastest setup, or SMTP mailbox if you use your own provider. Gmail and Outlook mailboxes can connect through SMTP with an app password.")}
              </p>
              <label className="text-sm font-bold text-ink">{t("Sender name")}<input value={form.sender_name} onChange={(event) => setForm((current) => ({ ...current, sender_name: event.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-3 text-sm font-semibold" placeholder="Sales Team" /></label>
              <label className="text-sm font-bold text-ink">{t("Sender email")}<input value={form.sender_email} onChange={(event) => setForm((current) => ({ ...current, sender_email: event.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-3 text-sm font-semibold" placeholder="you@company.com" type="email" /></label>
              <label className="text-sm font-bold text-ink">{t("Reply-to email")}<input value={form.reply_to} onChange={(event) => setForm((current) => ({ ...current, reply_to: event.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-3 text-sm font-semibold" placeholder="reply@company.com" type="email" /></label>
              <label className="text-sm font-bold text-ink">{t("Daily safety limit")}<input value={form.daily_send_limit} onChange={(event) => setForm((current) => ({ ...current, daily_send_limit: Number(event.target.value) }))} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-3 text-sm font-semibold" min={1} max={200} type="number" /></label>
              {form.provider === "smtp" && (
                <>
                  <p className="rounded-xl border border-teal-100 bg-teal-50 p-3 text-sm font-semibold leading-6 text-slate-700 sm:col-span-2">
                    {t("When you save SMTP settings, OutreachAI verifies the mailbox login before enabling real sends. Use an app password when your provider requires it.")}
                  </p>
                  <label className="text-sm font-bold text-ink">{t("SMTP host")}<input value={form.smtp_host} onChange={(event) => setForm((current) => ({ ...current, smtp_host: event.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-3 text-sm font-semibold" placeholder="smtp.company.com" /></label>
                  <label className="text-sm font-bold text-ink">{t("SMTP port")}<input value={form.smtp_port} onChange={(event) => setForm((current) => ({ ...current, smtp_port: Number(event.target.value) }))} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-3 text-sm font-semibold" min={1} max={65535} type="number" /></label>
                  <label className="text-sm font-bold text-ink">{t("SMTP username")}<input value={form.smtp_username} onChange={(event) => setForm((current) => ({ ...current, smtp_username: event.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-3 text-sm font-semibold" placeholder="you@company.com" /></label>
                  <label className="text-sm font-bold text-ink">{t("SMTP password")}<input value={form.smtp_password} onChange={(event) => setForm((current) => ({ ...current, smtp_password: event.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-3 text-sm font-semibold" placeholder={t("Leave blank to keep current password")} type="password" /></label>
                  <label className="inline-flex min-h-11 items-center gap-3 rounded-xl border border-slate-200 px-3 text-sm font-bold text-ink sm:col-span-2">
                    <input checked={form.smtp_use_tls} onChange={(event) => setForm((current) => ({ ...current, smtp_use_tls: event.target.checked }))} type="checkbox" className="h-4 w-4" />
                    {t("Use TLS")}
                  </label>
                </>
              )}
            </div>
            <button disabled={saving} className="inline-flex min-h-11 w-full items-center justify-center rounded-md bg-brand px-4 text-sm font-bold text-white disabled:opacity-60 sm:w-auto">{saving ? t("Saving...") : t("Save sending setup")}</button>
            {saved && <p className="rounded-xl bg-teal-50 p-3 text-sm font-bold text-brand">{saved}</p>}
            {error && <p className="rounded-xl bg-red-50 p-3 text-sm font-bold text-red-700">{error}</p>}
          </form>
          <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-700">
            <p className="font-black text-ink">{t(status?.next_action || "Connect sending before launching campaigns.")}</p>
            {status?.reason && <p className="mt-2 leading-6">{t(status.reason)}</p>}
            <div className="mt-4 grid gap-2">
              {[["SPF", status?.spf_status], ["DKIM", status?.dkim_status], ["DMARC", status?.dmarc_status]].map(([label, value]) => <p key={label} className="flex items-center justify-between rounded-xl bg-white px-3 py-2"><span className="font-bold">{label}</span><span>{t(String(value || "not_checked"))}</span></p>)}
              {status?.provider === "smtp" && <p className="flex items-center justify-between rounded-xl bg-white px-3 py-2"><span className="font-bold">{t("SMTP configured")}</span><span>{t(status.smtp_configured ? "Connected" : "Needs setup")}</span></p>}
              {status?.provider === "smtp" && <p className="flex items-center justify-between gap-3 rounded-xl bg-white px-3 py-2"><span className="font-bold">{t("Mailbox verified")}</span><span className="text-right">{status.smtp_verified_at ? new Date(status.smtp_verified_at).toLocaleString() : t("Not verified yet")}</span></p>}
              <p className="flex items-center justify-between rounded-xl bg-white px-3 py-2"><span className="font-bold">{t("Sent today")}</span><span>{status?.sent_today || 0}/{status?.daily_send_limit || 25}</span></p>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

export function SettingsPage() {
  const { t } = useI18n();
  const { api, ready } = useTokenApi();
  const [leadSearchStatus, setLeadSearchStatus] = useState<WorkspaceIntegrationStatus["status"] | "unknown">("unknown");
  const [leadSearchStatusLoading, setLeadSearchStatusLoading] = useState(true);
  const readiness = [
    ["Company setup", "Tell OutreachAI what you sell so lead research and emails match your offer.", "Complete this before your first campaign."],
    ["Lead readiness", "Find or add companies, then save each valid opportunity into CRM.", "Missing data is shown clearly instead of guessed."],
    ["Outreach safety", "Every email stays in review until a person approves the send.", "Nothing external happens automatically."],
    ["Plan and limits", "Your plan controls how many leads, emails and workspaces can be used this month.", "Upgrade only when you hit a real limit."]
  ];

  useEffect(() => {
    let cancelled = false;
    async function loadLeadSearchStatus() {
      if (!ready) return;
      setLeadSearchStatusLoading(true);
      try {
        const response = await api<WorkspaceIntegrationStatusResponse>("/api/workspace-app/integrations/status");
        const status = safeArray(response.integrations).find((item) => item.key === "lead_search")?.status || "missing_key";
        if (!cancelled) setLeadSearchStatus(status);
      } catch (err) {
        reportWidgetFailure(err, "settings-integration-status", { endpoint: "/api/workspace-app/integrations/status" });
        if (!cancelled) setLeadSearchStatus("error");
      } finally {
        if (!cancelled) setLeadSearchStatusLoading(false);
      }
    }
    void loadLeadSearchStatus();
    return () => {
      cancelled = true;
    };
  }, [api, ready]);

  const leadSearchReady = leadSearchStatus === "connected";
  return <div className="space-y-6"><PageHeader eyebrow="Settings" title="Make the workspace ready for your first campaign." copy="Keep setup simple: confirm your company, find leads, review AI work, then approve outreach." action={<Link href="/dashboard/leads" className="inline-flex min-h-11 items-center justify-center rounded-md bg-brand px-4 text-sm font-bold text-white">{t("Find leads")}</Link>} /><section className="grid gap-4 lg:grid-cols-2">{readiness.map(([title, copy, status]) => <article key={title} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="font-bold text-ink">{t(title)}</h2><p className="mt-2 text-sm leading-6 text-slate-600">{t(copy)}</p><p className="mt-4 rounded-xl bg-slate-50 p-3 text-sm font-semibold text-slate-700">{t(status)}</p></article>)}</section><section id="lead-search-key" className={`scroll-mt-24 rounded-2xl border p-5 shadow-sm ${leadSearchReady ? "border-teal-200 bg-teal-50" : "border-amber-200 bg-amber-50"}`}><p className={`text-sm font-bold uppercase ${leadSearchReady ? "text-brand" : "text-amber-800"}`}>{t("Lead search key")}</p>{leadSearchStatusLoading ? <div className="mt-3 h-20 animate-pulse rounded-xl bg-white/70" /> : leadSearchReady ? <><h2 className="mt-2 text-xl font-black text-ink">{t("Ready to find companies")}</h2><p className="mt-2 text-sm leading-6 text-slate-700">{t("Your company search is connected. Start with one narrow market and save results to CRM.")}</p><div className="mt-4 flex flex-col gap-3 min-[430px]:flex-row"><Link href="/dashboard/leads#lead-search-form" className="inline-flex min-h-11 items-center justify-center rounded-md bg-brand px-4 text-sm font-bold text-white">{t("Search market")}</Link><Link href="/dashboard/leads#manual-company" className="inline-flex min-h-11 items-center justify-center rounded-md border border-teal-300 bg-white px-4 text-sm font-bold text-brand">{t("Add company manually")}</Link></div></> : <><h2 className="mt-2 text-xl font-black text-ink">{t("Automatic company search needs one setup step")}</h2><p className="mt-2 text-sm leading-6 text-amber-900">{t("Ask the workspace owner to connect automatic company search. Until then, add companies manually and continue with CRM, research and outreach review.")}</p><div className="mt-4 flex flex-col gap-3 min-[430px]:flex-row"><Link href="/dashboard/leads#manual-company" className="inline-flex min-h-11 items-center justify-center rounded-md bg-brand px-4 text-sm font-bold text-white">{t("Add company manually")}</Link><Link href="/dashboard/billing" className="inline-flex min-h-11 items-center justify-center rounded-md border border-amber-300 bg-white px-4 text-sm font-bold text-amber-900">{t("Check plan")}</Link></div></>}</section><OutreachSenderSettingsPanel api={api} ready={ready} /><details className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><summary className="cursor-pointer text-sm font-bold text-ink">{t("Advanced settings")}</summary><p className="mt-3 text-sm leading-6 text-slate-600">{t("Use this area only when a workspace owner needs to adjust billing, security, team access or sending preferences. New users can start from Lead Finder instead.")}</p><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{["Billing", "Security", "Team access", "Sending preferences"].map((item) => <Link key={item} href={item === "Billing" ? "/dashboard/billing" : "/dashboard/settings"} className="inline-flex min-h-11 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-bold text-ink">{t(item)}</Link>)}</div></details></div>;
}

export function BillingPage() {
  const { metrics, loading, error } = useSalesData();
  const { t } = useI18n();
  return <div className="space-y-6"><PageHeader eyebrow="Billing" title="Subscription and usage." copy="Plan, usage and limits come from billing state. No fake usage is displayed." action={<Link href="/pricing" className="inline-flex min-h-11 items-center justify-center rounded-md bg-ink px-4 text-sm font-bold text-white">{t("Manage plan")}</Link>} />{loading ? <EmptyState title="Loading billing" copy="Reading subscription usage." /> : error ? <EmptyState title="Billing unavailable" copy={error} /> : <section className="grid gap-4 lg:grid-cols-3"><MetricCard label="Current plan" value={t(metrics.plan || "Unavailable")} help="From billing status" /><MetricCard label="Leads" value={String((metrics.usage?.leads as number | undefined) || metrics.leads || 0)} help="Current period usage" /><MetricCard label="Emails sent" value={String(metrics.emails_sent)} help="Approved sends" /></section>}</div>;
}

export function AiEmployeesPage() {
  const { leads, api, loading, error } = useSalesData();
  const { t } = useI18n();
  return <div className="space-y-6"><PageHeader eyebrow="AI Sales Employee" title="One click should replace hours of manual sales research." copy="The AI employee uses real source data only. Missing fields stay visible as unavailable until verified information is available." action={<Link href="/dashboard/leads" className="inline-flex min-h-11 items-center justify-center rounded-md bg-brand px-4 text-sm font-bold text-white">{t("Find or research leads")}</Link>} />{loading ? <EmptyState title="Loading AI work" copy="Reading saved leads." /> : error ? <EmptyState title="AI employee unavailable" copy={error} /> : leads.length ? <div className="grid gap-5">{leads.slice(0, 3).map((lead) => <OpportunityCard key={lead.id || lead.company} lead={lead} api={api} />)}</div> : <EmptyState title="No AI work yet" copy="Find or add real companies first. The AI employee will not show invented results." />}</div>;
}
