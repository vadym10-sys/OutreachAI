"use client";

import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Component, FormEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState, type ButtonHTMLAttributes, type ErrorInfo } from "react";
import * as Sentry from "@sentry/nextjs";
import { AlertTriangle, ArrowRight, BarChart3, Building2, CalendarDays, CheckCircle2, Clock3, Download, ExternalLink, FileText, Globe2, Inbox, Lightbulb, Loader2, Mail, MapPin, MessageSquare, Pause, Phone, Play, Plus, Search, Send, ShieldCheck, Sparkles, Target, UserRound, UserRoundSearch } from "lucide-react";
import { useAuthRuntime } from "@/components/app-providers";
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
      campaigns?: Campaign[];
      employees?: AISalesEmployee[];
      activity?: Activity[];
      cached_at?: string;
    };
    return {
      metrics: safeDashboardMetrics(parsed.metrics),
      leads: safeArray(parsed.leads),
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

function useTokenApi(): { api: ApiFn; ready: boolean } {
  const { clerkEnabled } = useAuthRuntime();
  if ((!clerkEnabled && !isProductionRuntime) || isClerkE2EBypass) {
    return { api: devApi, ready: true };
  }
  if (!clerkEnabled) {
    return {
      api: async () => {
        redirectToSignIn();
        throw new Error("Please sign in again before continuing.");
      },
      ready: false
    };
  }
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const { getToken, isLoaded, isSignedIn } = useAuth();
  // The no-Clerk branch above is required for local/E2E builds where ClerkProvider is intentionally not mounted.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const api = useCallback(async function api<T>(path: string, init: ClientApiInit = {}) {
    if (!isLoaded || !isSignedIn) throw new Error("Please sign in again before continuing.");
    let token = await getToken();
    for (let attempt = 0; !token && attempt < 20; attempt += 1) {
      await delay(100);
      token = await getToken();
    }
    if (!token) throw new Error("Please sign in again before continuing.");
    return clientApi<T>(path, token, init);
  }, [getToken, isLoaded, isSignedIn]);
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

function confidenceLabel(profile: ReturnType<typeof leadProfile>, copilot: SalesCopilot | undefined, t: (key: string) => string) {
  if (copilot) return t("Purchase probability").replace("{count}", String(copilot.probability_to_buy));
  if (typeof profile.icpScore === "number" && profile.icpScore > 0) return t("ICP fit score").replace("{count}", String(profile.icpScore));
  const replyRate = parseReplyRate(profile.expectedReplyRate);
  if (replyRate !== null) return t("Estimated from reply forecast").replace("{count}", String(replyRate));
  return unavailable;
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

function priorityScore(profile: ReturnType<typeof leadProfile>, copilot?: SalesCopilot, draft?: Email) {
  if (copilot) return Math.round((copilot.probability_to_reply * 0.45) + (copilot.probability_to_buy * 0.45) + Math.min((copilot.estimated_revenue ?? 0) / 1000, 10));
  const icp = typeof profile.icpScore === "number" ? profile.icpScore : 0;
  const replyRate = parseReplyRate(profile.expectedReplyRate) ?? 0;
  if (!icp && !replyRate && !draft) return null;
  const draftBonus = draft?.subject && draft.body ? 10 : 0;
  return Math.max(0, Math.min(100, Math.round(icp * 0.7 + replyRate * 1.5 + draftBonus)));
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
    <header className="min-w-0 max-w-full overflow-hidden rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6 lg:flex lg:items-end lg:justify-between lg:gap-6">
      <div className="min-w-0 max-w-3xl">
        <p className="text-sm font-bold uppercase tracking-wide text-brand">{t(eyebrow)}</p>
        <h1 aria-label={translatedTitle} className="mt-2 text-[clamp(2rem,7vw,3.5rem)] font-black leading-[0.98] tracking-tight text-ink">{translatedTitle}</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600 min-[390px]:text-base">{t(copy)}</p>
      </div>
      {action && <div className="mt-5 min-w-0 max-w-full shrink-0 [&>a]:w-full [&>button]:w-full min-[430px]:[&>a]:w-auto min-[430px]:[&>button]:w-auto lg:mt-0">{action}</div>}
    </header>
  );
}

function PrimaryButton({ children, type = "button", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { children: React.ReactNode }) {
  return <button type={type} {...props} className="inline-flex min-h-12 max-w-full items-center justify-center gap-2 rounded-xl bg-brand px-5 text-sm font-black text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-teal-700 disabled:cursor-not-allowed disabled:translate-y-0 disabled:opacity-60">{children}</button>;
}

function SecondaryButton({ children, type = "button", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { children: React.ReactNode }) {
  return <button type={type} {...props} className="inline-flex min-h-12 max-w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-5 text-sm font-black text-ink shadow-sm transition hover:-translate-y-0.5 hover:border-slate-400 disabled:cursor-not-allowed disabled:translate-y-0 disabled:opacity-60">{children}</button>;
}

function EmptyState({ title, copy, action }: { title: string; copy: string; action?: React.ReactNode }) {
  const { t } = useI18n();
  return <section className="rounded-3xl border border-dashed border-slate-300 bg-white p-6 text-center shadow-sm sm:p-8"><div className="mx-auto grid size-12 place-items-center rounded-2xl bg-teal-50 text-brand"><Sparkles size={22} /></div><h2 className="mt-4 text-xl font-black text-ink">{t(title)}</h2><p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-600">{t(copy)}</p>{action && <div className="mt-5 flex justify-center">{action}</div>}</section>;
}

function WidgetErrorCard({ title, copy = "This section could not update. The rest of your workspace is still available.", onRetry }: { title: string; copy?: string; onRetry?: () => void }) {
  const { t } = useI18n();
  return (
    <section role="status" className="rounded-2xl border border-amber-200 bg-amber-50 p-5 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-bold text-amber-950">{t(title)}</p>
          <p className="mt-1 text-sm leading-6 text-amber-800">{t(copy)}</p>
        </div>
        {onRetry && (
          <button type="button" onClick={onRetry} className="inline-flex min-h-11 items-center justify-center rounded-md bg-white px-4 text-sm font-bold text-amber-950 shadow-sm">
            {t("Retry")}
          </button>
        )}
      </div>
    </section>
  );
}

function MetricCard({ label, value, help }: { label: string; value: string; help: string }) {
  const { t } = useI18n();
  return <article className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-sm font-bold text-slate-500">{t(label)}</p><p className="mt-2 text-3xl font-black text-ink">{value}</p><p className="mt-2 text-sm leading-6 text-slate-600">{t(help)}</p></article>;
}

function ActionPanel({ eyebrow, title, copy, children }: { eyebrow: string; title: string; copy: string; children: ReactNode }) {
  const { t } = useI18n();
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <p className="text-sm font-bold uppercase text-brand">{t(eyebrow)}</p>
      <h2 className="mt-2 text-2xl font-black tracking-tight text-ink">{t(title)}</h2>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{t(copy)}</p>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function LoadingSkeleton({ title = "Loading workspace" }: { title?: string }) {
  const { t } = useI18n();
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <p className="text-sm font-bold uppercase text-brand">{t(title)}</p>
      <div className="mt-5 grid gap-3">
        <div className="h-8 w-2/3 animate-pulse rounded-xl bg-slate-200" />
        <div className="h-4 w-full animate-pulse rounded-xl bg-slate-100" />
        <div className="h-4 w-5/6 animate-pulse rounded-xl bg-slate-100" />
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div className="h-24 animate-pulse rounded-2xl bg-slate-100" />
          <div className="h-24 animate-pulse rounded-2xl bg-slate-100" />
          <div className="h-24 animate-pulse rounded-2xl bg-slate-100" />
        </div>
      </div>
    </section>
  );
}

function WorkflowTracker({ activeStep, completedSteps }: { activeStep: string; completedSteps: string[] }) {
  const { t } = useI18n();
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-bold uppercase text-brand">{t("Sales workflow")}</p>
          <h2 className="mt-1 text-xl font-bold text-ink">{t("One path from prospect to customer.")}</h2>
        </div>
        <p className="text-sm font-semibold text-slate-600">{t("Current step")}: {t(activeStep)}</p>
      </div>
      <div className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {salesWorkflow.map((step) => {
          const done = completedSteps.includes(step);
          const active = activeStep === step;
          return (
            <div key={step} className={`rounded-xl border p-3 text-sm ${active ? "border-teal-300 bg-teal-50 text-brand" : done ? "border-slate-200 bg-slate-50 text-slate-700" : "border-slate-200 bg-white text-slate-500"}`}>
              <div className="flex items-center gap-2">
                <CheckCircle2 size={16} className={done || active ? "text-brand" : "text-slate-300"} />
                <span className="font-bold">{t(step)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
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
  ["Personalize email", "Turn company research into a reviewed email.", "/dashboard/companies"],
  ["Launch campaign", "Send only after approval.", "/dashboard/campaigns"],
  ["Handle replies", "Classify replies and move deals forward.", "/dashboard/inbox"],
  ["Measure results", "See what creates meetings.", "/dashboard/analytics"]
] as const;

function CoreActionGrid({ activeHref }: { activeHref?: string }) {
  const { t } = useI18n();
  return (
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
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

  return { metrics, leads, campaigns, employees, activity, loading, error, supportingError, cachedAt };
}

function OpportunityCard({
  lead,
  api,
  onLeadUpdated,
  onCompanyUpdated,
  initialDraft
}: {
  lead: Lead;
  api: ApiFn;
  onLeadUpdated?: (lead: Lead) => void;
  onCompanyUpdated?: (company: CrmCompany) => void;
  initialDraft?: Email | null;
}) {
  const { t } = useI18n();
  const savedDraft = initialDraft || lead.generated_emails?.[0] || null;
  const [copilot, setCopilot] = useState<SalesCopilot | undefined>();
  const [audit, setAudit] = useState<WebsiteAudit | undefined>();
  const [followUps, setFollowUps] = useState<FollowUpSequence | undefined>();
  const [draft, setDraft] = useState<Email | undefined>(() => savedDraft || undefined);
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
  const profile = leadProfile(lead);
  const coverage = opportunityCoverage(lead, copilot, draft, followUps, audit);
  const completed = coverage.filter(([, done]) => done).length;
  const missingCoverage = coverage.filter(([, done]) => !done).map(([label]) => label);
  const priority = priorityScore(profile, copilot, draft);
  const visibleStatus = status;
  const companyId = lead.crm_company_id || null;
  const nextStep = opportunityNextStep(lead, draft);
  const contactSearch = contactSearchDetails(lead);
  const contactNeedsManualStep = !lead.email && (contactSearch.checked || lead.hunter_status === "no_verified_email");
  const dataFacts = opportunityDataFacts(lead, profile, t);
  const dataSummary = dataCollectionSummaryFromFacts(dataFacts, t);
  const summaryParts = [profile.industry, profile.location, profile.size !== unavailable ? profileSizeText(profile, t) : ""].filter((item) => item && item !== unavailable);
  const recipientEmail = String(lead.email || "").trim();

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
        onCompanyUpdated?.(updatedCompany);
        onLeadUpdated?.(leadFromCrmCompany(updatedCompany));
      }
      setStatus(t(result.message || "AI enrichment restarted. This card will update as data arrives."));
      trackEvent("sales_research_queued", {
        lead_id: lead.id,
        company: lead.company
      });
    } catch (err) {
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
      setReadyToSend(false);
      setSendConfirmOpen(false);
      setStatus(t("Approved email was sent. CRM stage updated to Contacted."));
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
    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-4 min-[520px]:flex-row min-[520px]:items-start min-[520px]:justify-between">
        <div>
          <h2 className="text-xl font-bold text-ink">{lead.company}</h2>
          <p className="mt-1 break-all text-sm text-slate-500">{profile.website}</p>
          <p className="mt-2 text-sm text-slate-600">{summaryParts.join(" · ")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="rounded-full bg-teal-50 px-3 py-1 text-xs font-bold text-brand">{t("Completion count").replace("{count}", String(completed))}</span>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">{t("Data")}: {t(sourceLabel(profile.source))}</span>
        </div>
      </div>

      <div className="mt-5 grid gap-3 lg:grid-cols-3">
        {[
          ["Company profile", `${profile.industry} · ${profile.location}`],
          ["Decision maker", profile.decisionMaker],
          ["Verified email", profile.verifiedEmail],
          ["AI pain analysis", safeArray(audit?.priority_actions).join(", ") || profile.painAnalysis],
          ["AI opportunity analysis", safeArray(copilot?.reasoning).join(" ") || profile.opportunityAnalysis],
          ["Personalized offer", profile.offer],
          ["Expected reply rate", copilot ? `${copilot.probability_to_reply}%` : profile.expectedReplyRate],
          ["Confidence score", confidenceLabel(profile, copilot, t)],
          ["Priority score", priority === null ? unavailable : `${priority}/100`]
        ].map(([label, value]) => <div key={label} className="rounded-xl bg-slate-50 p-3"><p className="text-xs font-bold uppercase text-slate-500">{t(label)}</p><p className="mt-1 text-sm font-semibold text-slate-800">{t(value)}</p></div>)}
      </div>

      <section className="mt-5 rounded-2xl border border-teal-200 bg-teal-50 p-4">
        <p className="text-xs font-black uppercase tracking-wide text-brand">{t("Next step")}</p>
        <h3 className="mt-2 text-lg font-black text-ink">{t(nextStep.title)}</h3>
        <p className="mt-2 text-sm leading-6 text-slate-700">{t(nextStep.copy)}</p>
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
        <p className="mt-2 rounded-lg bg-teal-50 p-3 text-sm font-semibold text-brand">{draft.delivery_status === "sent" ? t("Approved email was sent. CRM stage updated to Contacted.") : draft.delivery_status === "approved" ? t("Email approved. Nothing was sent yet.") : t("Review this draft before sending. No email has been sent yet.")}</p>
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
        <h3 className="mt-2 font-bold text-ink">{draft.subject}</h3>
        <p className="mt-2 whitespace-pre-line text-sm leading-6 text-slate-700">{draft.body}</p>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div className="whitespace-pre-line rounded-lg bg-white p-3 text-sm"><span className="font-bold">{t("Follow-up 1")}:</span> {cleanGeneratedText(draft.follow_up_1 || followUps?.no_open?.[0]) || t(unavailable)}</div>
          <div className="whitespace-pre-line rounded-lg bg-white p-3 text-sm"><span className="font-bold">{t("Follow-up 2")}:</span> {cleanGeneratedText(draft.follow_up_2 || followUps?.opened?.[0]) || t(unavailable)}</div>
        </div>
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
      <div className="mt-5 flex flex-col gap-2 min-[430px]:flex-row">
        <PrimaryButton onClick={completeResearch} disabled={busy}>{busy ? <Loader2 className="animate-spin" size={17} /> : <Sparkles size={17} />} {t(missingCoverage.length ? "Run all missing steps" : "Refresh AI research")}</PrimaryButton>
        <SecondaryButton onClick={approveDraft} disabled={busy || !draft || sending || draft.delivery_status === "approved" || draft.delivery_status === "sent"}>{sending ? <Loader2 className="animate-spin" size={17} /> : <CheckCircle2 size={17} />} {draft?.delivery_status === "sent" ? t("Sent") : draft?.delivery_status === "approved" ? t("Approved") : t("Approve email")}</SecondaryButton>
        <SecondaryButton onClick={() => sendApprovedEmail(false)} disabled={busy || !draft || sending || senderLoading || draft.delivery_status !== "approved"}>{sending || senderLoading ? <Loader2 className="animate-spin" size={17} /> : <Send size={17} />} {draft?.delivery_status === "sent" ? t("Sent") : t("Send approved email")}</SecondaryButton>
      </div>
    </article>
  );
}

export function DashboardHome() {
  const { metrics, leads, campaigns, employees, activity, loading, error, supportingError, cachedAt } = useDashboardData();
  const { t } = useI18n();
  const hasAnyData = metrics.leads > 0 || metrics.campaigns > 0 || metrics.emails_sent > 0 || metrics.replies > 0 || metrics.meetings > 0 || leads.length > 0 || campaigns.length > 0 || employees.length > 0 || activity.length > 0;
  const nextStep = dashboardNextStep(metrics, leads, campaigns);
  const activeSignals = [
    { label: "Leads found", value: String(metrics.leads || leads.length), help: "Real workspace leads", show: metrics.leads > 0 || leads.length > 0 },
    { label: "Campaigns", value: String(metrics.campaigns || campaigns.length), help: "Saved campaigns", show: metrics.campaigns > 0 || campaigns.length > 0 },
    { label: "Emails sent", value: String(metrics.emails_sent), help: "Approved sends only", show: metrics.emails_sent > 0 },
    { label: "Reply rate", value: `${metrics.reply_rate || 0}%`, help: "From tracked replies", show: metrics.replies > 0 || metrics.emails_sent > 0 }
  ].filter((signal) => signal.show);
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={t("Today")}
        title={t("What should I do now?")}
        copy={t(hasAnyData ? "OutreachAI keeps one obvious next action so you can move from lead search to meetings without thinking through the whole system." : "This is your private account. Leads, CRM, campaigns, billing and settings are visible only to your workspace. Start with one real company or a focused lead search.")}
        action={<Link href={nextStep.href} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-brand px-4 text-sm font-bold text-white">{t(nextStep.label)} <ArrowRight size={17} /></Link>}
      />
      {loading && <WidgetErrorCard title="Loading your private workspace" copy="Your dashboard is opening. You can already use the main actions below." />}
      {supportingError && !hasAnyData && <WidgetErrorCard title={cachedAt ? "Updating workspace data" : "Dashboard details are temporarily unavailable"} copy={supportingError} />}
      {error && <WidgetErrorCard title="Dashboard metrics could not update" copy={error} />}
      <WidgetBoundary name="Main customer actions">
        <CoreActionGrid activeHref={nextStep.href} />
      </WidgetBoundary>
      {!hasAnyData && <WidgetBoundary name="Private workspace onboarding"><section className="rounded-3xl border border-teal-100 bg-gradient-to-br from-white to-teal-50/70 p-5 shadow-sm sm:p-6">
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
      </section></WidgetBoundary>}
      <WidgetBoundary name="Today’s priority">
        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <p className="text-sm font-bold uppercase text-brand">{t(nextStep.step)}</p>
          <h2 className="mt-2 text-2xl font-bold text-ink">{t(nextStep.title)}</h2>
          <p className="mt-3 text-sm leading-6 text-slate-600">{t(nextStep.copy)}</p>
          <Link href={nextStep.href} className="mt-5 inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-ink px-4 text-sm font-bold text-white">{t(nextStep.label)}<ArrowRight size={17} /></Link>
        </section>
      </WidgetBoundary>
      {activeSignals.length > 0 && <WidgetBoundary name="Workspace metrics"><details className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <summary className="cursor-pointer text-sm font-black text-slate-700">{t("Show workspace details")}</summary>
        <section className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {activeSignals.map((signal) => <MetricCard key={signal.label} label={signal.label} value={signal.value} help={signal.help} />)}
        </section>
      </details></WidgetBoundary>}
      {!hasAnyData && <WidgetBoundary name="Dashboard onboarding"><EmptyState title={t("Start with one focused lead search.")} copy={t("Choose one country, one city and one industry. OutreachAI will save real companies, analyze websites and prepare outreach only after verified data exists.")} action={<Link href="/dashboard/leads" className="inline-flex min-h-11 items-center justify-center rounded-md bg-brand px-4 text-sm font-bold text-white">{t("Find companies")}</Link>} /></WidgetBoundary>}
      {(employees.length > 0 || activity.length > 0) && <WidgetBoundary name="Latest workspace activity"><details className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <summary className="cursor-pointer text-sm font-black text-slate-700">{t("Show recent activity")}</summary>
        <section className="mt-4 grid gap-4 lg:grid-cols-2">
        {employees.length > 0 && <WidgetBoundary name="AI employee summary"><article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-bold text-ink">{t("AI Employees")}</h2>
          <p className="mt-2 text-sm text-slate-600">{t("Active AI workers connected to this workspace.")}</p>
          <div className="mt-4 space-y-2">{employees.slice(0, 3).map((employee) => <div key={employee.id} className="rounded-xl bg-slate-50 p-3 text-sm"><p className="font-bold">{employee.name}</p><p className="text-slate-600">{employee.role} · {employee.status}</p></div>)}</div>
        </article></WidgetBoundary>}
        {activity.length > 0 && <WidgetBoundary name="Recent activity"><article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-bold text-ink">{t("Recent activity")}</h2>
          <p className="mt-2 text-sm text-slate-600">{t("Latest workspace actions from real saved events.")}</p>
          <div className="mt-4 space-y-2">{activity.slice(0, 5).map((item) => <div key={item.id} className="rounded-xl bg-slate-50 p-3 text-sm"><p className="font-bold">{t(activityLabel(item.action))}</p><p className="text-slate-600">{new Date(item.created_at).toLocaleString()}</p></div>)}</div>
        </article></WidgetBoundary>}
        </section>
      </details></WidgetBoundary>}
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
  const { t } = useI18n();
  const visibleMessage = message;
  const automaticSearchReady = leadSearchStatus === "connected";
  const firstSavedLead = searchResults.find((lead) => lead.crm_company_id || lead.id) || null;
  const nextCompanyHref = firstSavedLead?.crm_company_id ? `/dashboard/companies?company=${firstSavedLead.crm_company_id}` : "/dashboard/companies";

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
    if (!ready || !hasSearched || !searchResults.some(leadHasRunningWorkflow)) return;
    let cancelled = false;
    const refreshSearchCompanies = async () => {
      try {
        const companies = await api<CrmCompany[]>("/api/workspace-app/companies");
        if (cancelled) return;
        const normalized = safeArray(companies).map(normalizeCrmCompany);
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
      {!automaticSearchReady && <IntegrationStatusPanel api={api} ready={ready} />}
      {automaticSearchReady && <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-sm font-black uppercase text-brand">{t("AI Command Bar")}</p>
            <h2 className="mt-2 text-xl font-black tracking-tight text-ink">{t("Describe the customers you want.")}</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-700">{t("Write one sentence. OutreachAI turns it into filters, searches companies, enriches them, and saves the results to CRM.")}</p>
          </div>
          <span className="w-fit rounded-full bg-teal-50 px-3 py-1 text-xs font-black text-brand">{t("Fastest path")}</span>
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
          <textarea
            value={leadCommand}
            onChange={(event) => setLeadCommand(event.target.value)}
            disabled={!automaticSearchReady || commandBusy || searching}
            rows={2}
            placeholder={t("Find 25 construction companies in Berlin with 20-100 employees")}
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
              <h2 className="mt-1 text-xl font-bold text-ink">{t("Add company manually")}</h2>
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
      {searching ? <LoadingSkeleton title="Searching companies" /> : loading && !hasSearched ? <LoadingSkeleton title="Loading saved companies." /> : error && !hasSearched ? <EmptyState title="Lead data unavailable" copy={error} /> : (hasSearched ? searchResults : leads).length ? <div className="grid gap-5">{(hasSearched ? searchResults : leads).map((lead) => <OpportunityCard key={`${lead.id || lead.place_id || lead.company}:${lead.generated_emails?.[0]?.id || "no-draft"}:${lead.generated_emails?.[0]?.delivery_status || ""}`} lead={lead} api={api} onLeadUpdated={(updated) => {
        setLeads((items) => items.map((item) => item.id === updated.id ? updated : item));
        setSearchResults((items) => items.map((item) => item.id === updated.id ? updated : item));
      }} />)}</div> : <EmptyState title={hasSearched ? "No matching companies found" : "No real leads yet"} copy={hasSearched ? "No companies matched those filters. Broaden the city, category, or radius and search again." : "Run a lead search or add a company manually. No demo companies are shown."} />}
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

function CrmCompanyCard({ company, api, highlighted = false }: { company: CrmCompany; api: ApiFn; highlighted?: boolean }) {
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

  function applyCompanyUpdate(updatedCompany: CrmCompany) {
    setCurrent(updatedCompany);
    setStageValue(updatedCompany.crm_stage);
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

  async function prepareMeeting() {
    const template = t("Meeting note template").replace("{company}", current.name);
    if (!noteBody.trim()) {
      setNoteBody(template);
      window.setTimeout(() => noteTextareaRef.current?.focus(), 0);
    }
    const updated = await moveStage("Meeting Scheduled");
    if (updated) {
      setActionNotice(t("Meeting step prepared. Add the date, time and calendar link in the note, then save it."));
    }
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

  async function runDeepContactSearch(force = false) {
    if (!current.lead_id) {
      setActionError(t("Reconnect this company to a lead before finding contacts."));
      return;
    }
    setActionBusy(force ? "deep-contact-retry" : "deep-contact");
    setActionError("");
    setActionNotice(t("Running deep contact search..."));
    try {
      const result = await withTimeout(
        api<WorkspaceAppActionResponse>(`/api/workspace-app/companies/${current.id}/deep-contact-search`, {
          method: "POST",
          body: JSON.stringify({ force }),
          timeoutMs: 45000
        }),
        50000,
        "Deep contact search took too long. Saved data stayed in CRM; try again with a smaller company profile."
      );
      if (result.company) {
        applyCompanyUpdate(normalizeCrmCompany(result.company));
      }
      setActionNotice(t(result.message || "Deep contact search finished."));
      trackEvent("deep_contact_search_completed", {
        company_id: current.id,
        company: current.name,
        force
      });
    } catch (err) {
      const reason = friendlyErrorMessage(err, t("Deep contact search could not be completed. Try again or add the contact manually."));
      setActionError(reason);
      setActionNotice("");
      trackEvent("deep_contact_search_failed", {
        company_id: current.id,
        company: current.name,
        reason
      });
    } finally {
      setActionBusy("");
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

  return <article id={`company-${current.id}`} className={`scroll-mt-24 overflow-hidden rounded-3xl border bg-slate-50 shadow-sm ${highlighted ? "border-teal-300 ring-4 ring-teal-100" : "border-slate-200"}`}>
    <div className="border-b border-slate-200 bg-white p-5 sm:p-6">
      <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
        <div className="flex min-w-0 gap-4">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-ink text-xl font-black text-white shadow-sm">
            {current.name.slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full border px-3 py-1 text-xs font-bold ${stageTone(current.crm_stage)}`}>{t(current.crm_stage)}</span>
              <span className="rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700">{t("AI Health")} {healthScore}%</span>
            </div>
            <h2 className="mt-3 text-2xl font-black tracking-tight text-ink sm:text-3xl">{current.name}</h2>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm text-slate-600">
              <span className="inline-flex items-center gap-1.5"><Building2 size={16} />{fieldValue(current.industry, t("Not available"))}</span>
              <span className="inline-flex items-center gap-1.5"><MapPin size={16} />{[current.city, current.country].filter(Boolean).join(", ") || t("Not available")}</span>
              <span className="inline-flex items-center gap-1.5"><Globe2 size={16} />{current.website || current.domain ? <a className="break-all font-semibold text-brand hover:underline" href={current.website || `https://${current.domain}`} target="_blank" rel="noreferrer">{current.website || current.domain}</a> : t("Not available")}</span>
            </div>
          </div>
        </div>
      </div>
      <div className="mt-5 rounded-3xl border border-teal-200 bg-gradient-to-br from-white via-white to-teal-50 p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-black uppercase tracking-wide text-brand">{t("AI Sales Brief")}</p>
            <h3 className="mt-2 text-2xl font-black tracking-tight text-ink">{t("Should we work this lead now?")}</h3>
            <p className="mt-2 text-sm leading-6 text-slate-700">{t("Open this brief and understand the company, the angle, the message and the next best action in 30 seconds.")}</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row lg:flex-col lg:items-end">
            <span className={`inline-flex w-fit items-center gap-2 rounded-full border px-3 py-2 text-sm font-black ${salesBrief.score >= 70 ? "border-teal-200 bg-teal-50 text-brand" : salesBrief.score >= 50 ? "border-amber-200 bg-amber-50 text-amber-800" : "border-slate-200 bg-slate-100 text-slate-700"}`}>
              <Target size={16} />
              {t(salesBrief.fit)} · {salesBrief.score}/100
            </span>
            <span className="inline-flex w-fit items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700">
              <BarChart3 size={16} />
              {t("Reply probability")}: {salesBrief.replyProbability}
            </span>
          </div>
        </div>

        <div className="mt-5 rounded-2xl border border-teal-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-black uppercase tracking-wide text-brand">{t("AI decision")}</p>
              <h4 className="mt-2 text-xl font-black text-ink">{t(salesBrief.decision)}</h4>
              <p className="mt-2 text-sm leading-6 text-slate-700">{t(salesBrief.decisionReason)}</p>
            </div>
            {primaryAction.action ? (
              <button
                type="button"
                onClick={runPrimaryAction}
                disabled={(primaryAction.action === "prepare-company" && (actionBusy === "prepare-company" || !current.lead_id)) || (primaryAction.action === "discover-contact" && (actionBusy === "discover-contact" || !current.lead_id)) || (primaryAction.action === "move-stage" && actionBusy === "stage")}
                className="inline-flex min-h-11 w-full shrink-0 items-center justify-center gap-2 rounded-md bg-brand px-4 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
              >
                {(primaryAction.action === "prepare-company" && actionBusy === "prepare-company") || (primaryAction.action === "discover-contact" && actionBusy === "discover-contact") || (primaryAction.action === "move-stage" && actionBusy === "stage") ? <Loader2 className="animate-spin" size={17} /> : <PrimaryActionIcon size={17} />}
                {t(primaryAction.label)}
              </button>
            ) : (
              <a href={primaryAction.target} className="inline-flex min-h-11 w-full shrink-0 items-center justify-center gap-2 rounded-md bg-brand px-4 text-sm font-bold text-white sm:w-auto">
                <PrimaryActionIcon size={17} />
                {t(primaryAction.label)}
                <ArrowRight size={16} />
              </a>
            )}
          </div>
          <div className="mt-4 grid gap-3 lg:grid-cols-3">
            <div className="rounded-xl bg-teal-50 p-3">
              <p className="text-xs font-black uppercase text-brand">{t("Best evidence")}</p>
              <ul className="mt-2 space-y-2 text-sm font-semibold leading-5 text-ink">
                {salesBrief.strongestSignals.length ? salesBrief.strongestSignals.map((item) => <li key={item} className="flex gap-2"><CheckCircle2 className="mt-0.5 shrink-0 text-brand" size={16} />{t(item)}</li>) : <li>{t("No strong signal yet. Run company research first.")}</li>}
              </ul>
            </div>
            <div className="rounded-xl bg-amber-50 p-3">
              <p className="text-xs font-black uppercase text-amber-800">{t("Main risks")}</p>
              <ul className="mt-2 space-y-2 text-sm font-semibold leading-5 text-amber-950">
                {salesBrief.topRisks.length ? salesBrief.topRisks.map((item) => <li key={item} className="flex gap-2"><AlertTriangle className="mt-0.5 shrink-0" size={16} />{t(item)}</li>) : <li>{t("No major risk for the current stage.")}</li>}
              </ul>
            </div>
            <div className="rounded-xl bg-slate-50 p-3">
              <p className="text-xs font-black uppercase text-slate-500">{t("Three-step plan")}</p>
              <ol className="mt-2 space-y-2 text-sm font-semibold leading-5 text-ink">
                {salesBrief.actionPlan.map((item, index) => <li key={`${item}-${index}`} className="flex gap-2"><span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-white text-xs font-black text-brand">{index + 1}</span>{t(item)}</li>)}
              </ol>
            </div>
          </div>
        </div>

        <div className="mt-5 grid gap-3 lg:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="text-xs font-bold uppercase text-slate-500">{t("What they do")}</p>
            <p className="mt-2 text-sm font-semibold leading-6 text-ink">{t(salesBrief.whatTheyDo)}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="text-xs font-bold uppercase text-slate-500">{t("Why they could become a customer")}</p>
            <p className="mt-2 text-sm font-semibold leading-6 text-ink">{t(salesBrief.whyFit)}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="text-xs font-bold uppercase text-slate-500">{t("Likely need")}</p>
            <p className="mt-2 text-sm font-semibold leading-6 text-ink">{t(salesBrief.likelyNeed)}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="text-xs font-bold uppercase text-slate-500">{t("Why our product helps")}</p>
            <p className="mt-2 text-sm font-semibold leading-6 text-ink">{t(salesBrief.whyUs)}</p>
          </div>
        </div>

        <div className="mt-3 grid gap-3 lg:grid-cols-[0.85fr_1.15fr]">
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="text-xs font-bold uppercase text-slate-500">{t("How to start the conversation")}</p>
            <p className="mt-2 text-sm font-semibold leading-6 text-ink">{t(salesBrief.opener)}</p>
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3">
              <p className="text-xs font-bold uppercase text-amber-800">{t("What needs attention")}</p>
              <p className="mt-1 text-sm font-semibold leading-6 text-amber-950">{t(salesBrief.blocker)}</p>
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-bold uppercase text-slate-500">{t("First personalized message")}</p>
                <h4 className="mt-2 text-base font-black text-ink">{t(salesBrief.firstMessageSubject)}</h4>
              </div>
              {!current.generated_emails.length && (
                <button
                  type="button"
                  onClick={prepareCompanyOpportunity}
                  disabled={actionBusy === "prepare-company" || !current.lead_id}
                  className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-md bg-brand px-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {actionBusy === "prepare-company" ? <Loader2 className="animate-spin" size={16} /> : <Mail size={16} />}
                  {t("Generate email")}
                </button>
              )}
            </div>
            <p className="mt-3 whitespace-pre-line text-sm leading-6 text-slate-700">{t(salesBrief.firstMessage)}</p>
          </div>
        </div>

        <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-bold uppercase text-slate-500">{t("Why AI expects this reply probability")}</p>
          <p className="mt-2 text-sm leading-6 text-slate-700">{t(salesBrief.replyReason)}</p>
        </div>
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="text-xs font-bold uppercase text-slate-500">{t("Data used for this brief")}</p>
            {salesBrief.qualitySources.length ? (
              <ul className="mt-2 space-y-2 text-sm leading-6 text-slate-700">
                {salesBrief.qualitySources.slice(0, 4).map((item) => <li key={item} className="flex gap-2"><CheckCircle2 className="mt-1 shrink-0 text-brand" size={15} />{t(item)}</li>)}
              </ul>
            ) : (
              <p className="mt-2 text-sm leading-6 text-slate-700">{t("Only the saved CRM profile is available so far.")}</p>
            )}
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="text-xs font-bold uppercase text-slate-500">{t("What would improve it")}</p>
            <ul className="mt-2 space-y-2 text-sm leading-6 text-slate-700">
              {(salesBrief.qualityGaps.length ? salesBrief.qualityGaps : salesBrief.providerImprovements.length ? salesBrief.providerImprovements : ["No critical improvement needed right now."]).slice(0, 4).map((item) => <li key={item} className="flex gap-2"><AlertTriangle className="mt-1 shrink-0 text-amber-700" size={15} />{t(item)}</li>)}
            </ul>
          </div>
        </div>
      </div>
    </div>

    <div className="border-b border-slate-200 bg-white px-5 pb-5 sm:px-6">
      <section className="rounded-3xl border border-slate-200 bg-slate-50 p-4 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-black uppercase tracking-wide text-brand">{t("AI Company Intelligence")}</p>
            <h3 className="mt-2 text-xl font-black tracking-tight text-ink">{t("Everything useful for deciding whether to work this account.")}</h3>
            <p className="mt-2 text-sm leading-6 text-slate-600">{t("OutreachAI merges public profile, website research, contact enrichment and CRM data, removes duplicates and scores field confidence.")}</p>
          </div>
          <div className="rounded-2xl border border-teal-200 bg-white p-4 text-left shadow-sm lg:min-w-48">
            <p className="text-xs font-black uppercase text-slate-500">{t("Lead Score")}</p>
            <p className="mt-1 text-3xl font-black text-brand">{intelligenceScore}/100</p>
            <p className="mt-1 text-xs font-semibold text-slate-500">{t("Confidence")}: {intelligence?.lead_score?.confidence ?? displayCurrent.confidence_score ?? healthScore}%</p>
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <IntelligenceValue
            label="Official website"
            confidence={intelligenceFields.official_website?.confidence}
            value={intelligenceFields.official_website?.value ? <a className="break-all text-brand hover:underline" href={String(intelligenceFields.official_website.value)} target="_blank" rel="noreferrer">{String(intelligenceFields.official_website.value)}</a> : t("Not available")}
          />
          <IntelligenceValue label="Business description" confidence={intelligenceFields.business_description?.confidence} value={String(intelligenceFields.business_description?.value || displayCurrent.ai_summary || t("Not available"))} />
          <IntelligenceValue label="Industry" confidence={intelligenceFields.industry?.confidence} value={String(intelligenceFields.industry?.value || displayCurrent.industry || t("Not available"))} />
          <IntelligenceValue label="Employees" confidence={intelligenceFields.employee_count?.confidence} value={String(intelligenceFields.employee_count?.value || t("Not available"))} />
          <IntelligenceValue label="CEO / Founder" confidence={intelligenceFields.ceo_founder?.confidence} value={String(intelligenceCeo?.name || intelligenceCeo?.title || t("Not available"))} />
          <IntelligenceValue label="Company LinkedIn" confidence={intelligenceFields.company_linkedin?.confidence} value={intelligenceFields.company_linkedin?.value ? <a className="break-all text-brand hover:underline" href={String(intelligenceFields.company_linkedin.value)} target="_blank" rel="noreferrer">{String(intelligenceFields.company_linkedin.value)}</a> : t("Not available")} />
        </div>

        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="text-xs font-black uppercase tracking-wide text-slate-500">{t("Useful data found")}</p>
            <div className="mt-3 grid gap-2">
              {(intelligenceTechnologies.length ? [`${t("Technologies")}: ${intelligenceTechnologies.slice(0, 8).join(", ")}`] : [])
                .concat(intelligenceEmails.length ? [`${t("Verified emails")}: ${intelligenceEmails.slice(0, 3).join(", ")}`] : [])
                .concat(intelligencePhones.length ? [`${t("Phones")}: ${intelligencePhones.slice(0, 3).join(", ")}`] : [])
                .concat(intelligenceEmployeeLinks.length ? [`${t("Key employee LinkedIn")}: ${intelligenceEmployeeLinks.slice(0, 2).join(", ")}`] : [])
                .concat(intelligenceSocials.length ? [`${t("Social profiles")}: ${intelligenceSocials.slice(0, 3).join(", ")}`] : [])
                .slice(0, 5)
                .map((item) => <p key={item} className="rounded-xl bg-teal-50 p-3 text-sm font-semibold leading-6 text-brand">{item}</p>)}
              {!intelligenceTechnologies.length && !intelligenceEmails.length && !intelligencePhones.length && !intelligenceEmployeeLinks.length && !intelligenceSocials.length ? (
                <p className="rounded-xl bg-slate-50 p-3 text-sm leading-6 text-slate-600">{t("Run enrichment to collect contacts, technologies and social profiles.")}</p>
              ) : null}
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="text-xs font-black uppercase tracking-wide text-slate-500">{t("Why contact this company")}</p>
            <p className="mt-2 text-sm font-semibold leading-6 text-ink">{String(intelligenceFields.personalized_reason?.value || salesBrief.whyFit)}</p>
            <div className="mt-3 space-y-2">
              {(intelligenceSignals.length ? intelligenceSignals : intelligenceReasons).slice(0, 4).map((signal) => (
                <p key={signal} className="flex gap-2 rounded-xl bg-teal-50 p-3 text-sm font-semibold leading-6 text-brand"><ShieldCheck className="mt-1 shrink-0" size={15} />{t(signal)}</p>
              ))}
              {!intelligenceSignals.length && !intelligenceReasons.length ? <p className="rounded-xl bg-slate-50 p-3 text-sm leading-6 text-slate-600">{t("No buying signal yet. Run company research first.")}</p> : null}
            </div>
          </div>
        </div>

        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="text-xs font-black uppercase tracking-wide text-slate-500">{t("Sources used")}</p>
            <p className="mt-2 text-sm leading-6 text-slate-700">{(intelligenceSources.length ? intelligenceSources : salesBrief.qualitySources).map((item) => t(item)).join(", ") || t("Only the saved CRM profile is available so far.")}</p>
          </div>
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
            <p className="text-xs font-black uppercase tracking-wide text-amber-800">{t("What can still be improved")}</p>
            <p className="mt-2 text-sm font-semibold leading-6 text-amber-950">{(intelligenceMissing.length ? intelligenceMissing : salesBrief.qualityGaps).slice(0, 5).map((item) => t(item)).join(", ") || t("No critical improvement needed right now.")}</p>
            {intelligenceMissing.length ? (
              <button type="button" onClick={prepareCompanyOpportunity} disabled={actionBusy === "prepare-company" || !current.lead_id} className="mt-3 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-md bg-brand px-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto">
                {actionBusy === "prepare-company" ? <Loader2 className="animate-spin" size={16} /> : <Sparkles size={16} />}
                {t("Collect missing data")}
              </button>
            ) : null}
          </div>
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
            {current.contacts.map((contact) => <article key={contact.id} className="rounded-2xl border border-slate-200 bg-white p-4">
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
            </article>)}
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
                onClick={prepareCompanyOpportunity}
                disabled={actionBusy === "prepare-company" || !current.lead_id}
                className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-brand px-4 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
              >
                {actionBusy === "prepare-company" ? <Loader2 className="animate-spin" size={17} /> : <Mail size={17} />}
                {t("Generate email for review")}
              </button>
            </div>
          )}
          <div className="mt-5">
            {current.lead_id ? (
              <details className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <summary className="cursor-pointer text-sm font-black text-ink">{t("Open email review and sending controls")}</summary>
                <p className="mt-2 text-sm leading-6 text-slate-600">{t("Use this only when you are ready to review, approve or send. Nothing is sent without confirmation.")}</p>
                <div className="mt-4">
                  <OpportunityCard key={`${current.id}:${currentDraft?.id || "no-draft"}:${currentDraft?.delivery_status || ""}`} lead={lead} api={api} onCompanyUpdated={applyCompanyUpdate} initialDraft={currentDraft} />
                </div>
              </details>
            ) : <p className="rounded-xl bg-amber-50 p-4 text-sm font-semibold text-amber-800">{t("Reconnect this company to a lead before generating outreach.")}</p>}
          </div>
        </WorkspaceSection>

        <WorkspaceSection id={`timeline-${current.id}`} title="CRM Timeline" copy="A complete audit trail of what happened, when it happened and what needs attention.">
          <div className="space-y-3">
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
        </WorkspaceSection>
      </div>

      <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-sm font-bold text-ink">{t("Quick Actions")}</p>
          <p className="mt-1 text-xs leading-5 text-slate-500">{t("Important actions stay within reach. Nothing is sent without approval.")}</p>
          <div className="mt-4 grid gap-2">
            <a href={`#outreach-${current.id}`} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-brand px-4 text-sm font-bold text-white"><Sparkles size={17} /> {t("Review AI research")}</a>
            <a href={`#contacts-${current.id}`} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-bold text-ink"><UserRoundSearch size={17} /> {t("Review contacts")}</a>
            <a href={`#outreach-${current.id}`} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-bold text-ink"><Mail size={17} /> {t("Review email draft")}</a>
            <a href={`#outreach-${current.id}`} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-bold text-ink"><Send size={17} /> {t("Review approval path")}</a>
            <button type="button" onClick={prepareMeeting} disabled={actionBusy === "stage" || current.crm_stage === "Meeting Scheduled"} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-bold text-ink disabled:cursor-not-allowed disabled:opacity-60">{actionBusy === "stage" ? <Loader2 className="animate-spin" size={17} /> : <CalendarDays size={17} />} {t("Prepare meeting")}</button>
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
  </article>;
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
      <WidgetBoundary name="Primary company actions">
        <CoreActionGrid activeHref="/dashboard/companies" />
      </WidgetBoundary>
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
    setSaving(true);
    setError("");
    setSaved("");
    try {
      const next = await api<OutreachSenderStatus>("/api/outreach/sender", {
        method: "PUT",
        body: JSON.stringify({
          provider: form.provider,
          sender_name: form.sender_name,
          sender_email: form.sender_email || null,
          reply_to: form.reply_to || null,
          daily_send_limit: Number(form.daily_send_limit) || 25,
          enabled: form.enabled,
          smtp_host: form.smtp_host,
          smtp_port: Number(form.smtp_port) || 587,
          smtp_username: form.smtp_username,
          smtp_password: form.smtp_password,
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
      setSaved(t("Sending setup saved"));
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
                  <option value="gmail">{t("Gmail (needs OAuth)")}</option>
                  <option value="outlook">{t("Outlook (needs OAuth)")}</option>
                </select>
              </label>
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
  return <div className="space-y-6"><PageHeader eyebrow="Billing" title="Subscription and usage." copy="Plan, usage and limits come from billing state. No fake usage is displayed." action={<Link href="/pricing" className="inline-flex min-h-11 items-center justify-center rounded-md bg-ink px-4 text-sm font-bold text-white">{t("Manage plan")}</Link>} />{loading ? <EmptyState title="Loading billing" copy="Reading subscription usage." /> : error ? <EmptyState title="Billing unavailable" copy={error} /> : <section className="grid gap-4 lg:grid-cols-4"><MetricCard label="Current plan" value={t(metrics.plan || "Unavailable")} help="From billing status" /><MetricCard label="Leads" value={String((metrics.usage?.leads as number | undefined) || metrics.leads || 0)} help="Current period usage" /><MetricCard label="Emails sent" value={String(metrics.emails_sent)} help="Approved sends" /><MetricCard label="MRR" value={`€${Math.round(metrics.mrr || 0).toLocaleString()}`} help="Subscription revenue" /></section>}</div>;
}

export function AiEmployeesPage() {
  const { leads, api, loading, error } = useSalesData();
  const { t } = useI18n();
  return <div className="space-y-6"><PageHeader eyebrow="AI Sales Employee" title="One click should replace hours of manual sales research." copy="The AI employee uses real source data only. Missing fields stay visible as unavailable until verified information is available." action={<Link href="/dashboard/leads" className="inline-flex min-h-11 items-center justify-center rounded-md bg-brand px-4 text-sm font-bold text-white">{t("Find or research leads")}</Link>} />{loading ? <EmptyState title="Loading AI work" copy="Reading saved leads." /> : error ? <EmptyState title="AI employee unavailable" copy={error} /> : leads.length ? <div className="grid gap-5">{leads.slice(0, 3).map((lead) => <OpportunityCard key={lead.id || lead.company} lead={lead} api={api} />)}</div> : <EmptyState title="No AI work yet" copy="Find or add real companies first. The AI employee will not show invented results." />}</div>;
}
