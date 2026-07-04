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
import type { Activity, AISalesEmployee, Campaign, CrmCompany, CrmContact, CrmDeal, CrmPipeline, DashboardMetrics, Email, FollowUpSequence, Lead, SalesCopilot, WebsiteAudit } from "@/lib/types";

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
};

type WorkspaceIntegrationStatus = {
  key: string;
  label: string;
  status: "connected" | "missing_key" | "needs_setup" | "error";
  message: string;
};

type WorkspaceIntegrationStatusResponse = {
  integrations: WorkspaceIntegrationStatus[];
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

const unavailable = "Unavailable until verified data is collected.";

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
    suggested_offer: value.suggested_offer || "",
    outreach_strategy: value.outreach_strategy || "",
    sales_angle: value.sales_angle || "",
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
    stage_changed_at: value.stage_changed_at || null
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

function workspaceManualSaveMessage(result: WorkspaceAppCompanyCreateResponse, company: Lead, t: (key: string) => string) {
  if (result.status === "reused") return t("This company already exists in your CRM.");
  return t("Company saved to CRM. Next: complete sales research.").replace("{company}", company.company);
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

function leadProfile(lead: Lead) {
  const metadata = parseNotes(lead.notes);
  return {
    company: lead.company,
    website: leadWebsite(lead) || unavailable,
    industry: lead.industry || lead.niche || unavailable,
    location: lead.address || [lead.city, lead.country].filter(Boolean).join(", ") || unavailable,
    size: lead.employee_count || lead.revenue_range || unavailable,
    sizeUnit: lead.employee_count ? "employees" : "",
    decisionMaker: [lead.contact, lead.title].filter(Boolean).join(", ") || unavailable,
    verifiedEmail: lead.email || (lead.hunter_status === "no_verified_email" ? "No verified email yet" : unavailable),
    phone: lead.phone || unavailable,
    linkedin: lead.linkedin || unavailable,
    websiteAnalysis: lead.ai_summary || text(metadata.ai_summary),
    painAnalysis: text(metadata.pain_points || metadata.weaknesses || lead.notes),
    opportunityAnalysis: lead.sales_angle || lead.outreach_strategy || text(metadata.sales_angle || metadata.outreach_strategy),
    offer: lead.suggested_offer || text(metadata.suggested_offer),
    expectedReplyRate: lead.expected_reply_rate || text(metadata.expected_reply_rate),
    source: lead.source || text(metadata.source)
  };
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
    ["Decision makers", profile.decisionMaker !== unavailable],
    ["Verified emails", Boolean(lead.email && lead.hunter_verified)],
    ["AI pain analysis", profile.painAnalysis !== unavailable || Boolean(audit?.priority_actions?.length)],
    ["AI opportunity analysis", profile.opportunityAnalysis !== unavailable || Boolean(copilot?.reasoning?.length)],
    ["Personalized offer", profile.offer !== unavailable],
    ["Personalized first email", Boolean(draft?.subject && draft.body)],
    ["Follow-up sequence", Boolean(followUps && (noOpenFollowUps.length || openedFollowUps.length || repliedFollowUps.length || clickedFollowUps.length))],
    ["Confidence score", Boolean(copilot)],
    ["Expected reply rate", profile.expectedReplyRate !== unavailable || Boolean(copilot)],
    ["Priority score", Boolean(copilot)]
  ] as const;
}

function priorityScore(copilot?: SalesCopilot) {
  if (!copilot) return null;
  return Math.round((copilot.probability_to_reply * 0.45) + (copilot.probability_to_buy * 0.45) + Math.min(copilot.estimated_revenue / 1000, 10));
}

function profileSizeText(profile: ReturnType<typeof leadProfile>, t: (key: string) => string) {
  if (profile.size === unavailable) return t(unavailable);
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

  return { api, ready, leads, setLeads, campaigns, metrics, loading, error, refresh };
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
  onCompanyUpdated
}: {
  lead: Lead;
  api: ApiFn;
  onLeadUpdated?: (lead: Lead) => void;
  onCompanyUpdated?: (company: CrmCompany) => void;
}) {
  const { t } = useI18n();
  const [copilot, setCopilot] = useState<SalesCopilot | undefined>();
  const [audit, setAudit] = useState<WebsiteAudit | undefined>();
  const [followUps, setFollowUps] = useState<FollowUpSequence | undefined>();
  const [draft, setDraft] = useState<Email | undefined>();
  const [readyToSend, setReadyToSend] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const profile = leadProfile(lead);
  const coverage = opportunityCoverage(lead, copilot, draft, followUps, audit);
  const completed = coverage.filter(([, done]) => done).length;
  const priority = priorityScore(copilot);
  const visibleStatus = status;
  const companyId = lead.crm_company_id || null;

  async function completeResearch() {
    if (!companyId) {
      setError(t("Save this company to CRM before running AI research."));
      return;
    }
    setBusy(true);
    setReadyToSend(false);
    setDraft(undefined);
    setError("");
    trackEvent("sales_research_started", {
      lead_id: lead.id,
      company: lead.company,
      has_website: Boolean(lead.website || lead.domain)
    });
    const warnings: string[] = [];
    let latestLead: Lead | null = null;
    try {
      if (lead.website || lead.domain) {
        setStatus(t("Analyzing website..."));
        try {
          const analysisResult = await withTimeout(
            api<WorkspaceAppActionResponse>(`/api/workspace-app/companies/${companyId}/analyze`, { method: "POST", timeoutMs: 22000 }),
            24000,
            "Website analysis took too long. The lead stays saved in CRM, and you can retry research."
          );
          if (analysisResult.company) {
            const updatedCompany = normalizeCrmCompany(analysisResult.company);
            latestLead = leadFromCrmCompany(updatedCompany);
            onCompanyUpdated?.(updatedCompany);
            onLeadUpdated?.(latestLead);
          }
          if (analysisResult.status !== "success") {
            warnings.push(t(analysisResult.message || "AI is temporarily unavailable. Try again in a moment."));
          }
        } catch (err) {
          warnings.push(friendlyErrorMessage(err, "Website analysis is temporarily unavailable. The lead stays saved in CRM."));
        }
      }
      setStatus(t("Finding decision makers..."));
      try {
        const contactResult = await withTimeout(
          api<WorkspaceAppActionResponse>(`/api/workspace-app/companies/${companyId}/contacts`, { method: "POST", timeoutMs: 18000 }),
          20000,
          "Contact discovery took too long. Continue with the saved company or retry contacts later."
        );
        if (contactResult.company) {
          const updatedCompany = normalizeCrmCompany(contactResult.company);
          latestLead = leadFromCrmCompany(updatedCompany);
          onCompanyUpdated?.(updatedCompany);
          onLeadUpdated?.(latestLead);
        }
        if (contactResult.status !== "success") {
          warnings.push(t(contactResult.message || "No verified contact was found yet. You can add an email manually and continue."));
        }
      } catch (err) {
        warnings.push(friendlyErrorMessage(err, "Contact discovery is temporarily unavailable. You can add a contact manually and continue."));
      }
      setStatus(t("Preparing personalized first email..."));
      const draftResult = await withTimeout(
        api<WorkspaceAppActionResponse>(`/api/workspace-app/companies/${companyId}/email-draft`, { method: "POST", timeoutMs: 35000 }),
        37000,
        "Email draft took too long. Your CRM research was saved; try generating the email again."
      );
      if (draftResult.company) {
        const updatedCompany = normalizeCrmCompany(draftResult.company);
        latestLead = leadFromCrmCompany(updatedCompany);
        onCompanyUpdated?.(updatedCompany);
        onLeadUpdated?.(latestLead);
      }
      if (!draftResult.email) {
        throw new Error(draftResult.message || "Email draft could not be created.");
      }
      const nextDraft = draftResult.email;
      setStatus([
        t("Email draft is ready. Review it below, then approve the send when you are ready."),
        ...warnings.slice(0, 2)
      ].join(" "));
      setDraft(nextDraft);
      setReadyToSend(true);
      trackEvent("sales_research_completed", {
        lead_id: lead.id,
        company: latestLead?.company || lead.company,
        has_verified_email: Boolean((latestLead || lead).email && (latestLead || lead).hunter_verified),
        warnings: warnings.length
      });
    } catch (err) {
      const reason = friendlyErrorMessage(err, "Research could not be completed. Please check the lead details and try again.");
      setReadyToSend(false);
      setError(reason);
      if (warnings.length) {
        setStatus(warnings.slice(0, 2).join(" "));
      }
      trackEvent("sales_research_failed", {
        lead_id: lead.id,
        company: lead.company,
        reason,
        warnings: warnings.length
      });
    } finally {
      setBusy(false);
    }
  }

  async function approveAndSend() {
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
      setStatus(t("Sending approved email..."));
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
      setError(reason);
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
          <p className="mt-2 text-sm text-slate-600">{profile.industry} · {profile.location} · {profileSizeText(profile, t)}</p>
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
          ["Confidence score", copilot ? t("Purchase probability").replace("{count}", String(copilot.probability_to_buy)) : unavailable],
          ["Priority score", priority === null ? unavailable : `${priority}/100`]
        ].map(([label, value]) => <div key={label} className="rounded-xl bg-slate-50 p-3"><p className="text-xs font-bold uppercase text-slate-500">{t(label)}</p><p className="mt-1 text-sm font-semibold text-slate-800">{t(value)}</p></div>)}
      </div>
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
        {coverage.map(([label, done]) => <span key={label} className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold ${done ? "bg-teal-50 text-brand" : "bg-slate-100 text-slate-500"}`}><CheckCircle2 size={15} />{t(label)}</span>)}
      </div>

      {draft && (readyToSend || draft.delivery_status === "sent") && <section className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
        <p className="text-xs font-bold uppercase text-slate-500">{t("Personalized first email")}</p>
        <p className="mt-2 rounded-lg bg-teal-50 p-3 text-sm font-semibold text-brand">{draft.delivery_status === "sent" ? t("Approved email was sent. CRM stage updated to Contacted.") : t("Review this draft before sending. No email has been sent yet.")}</p>
        <h3 className="mt-2 font-bold text-ink">{draft.subject}</h3>
        <p className="mt-2 whitespace-pre-line text-sm leading-6 text-slate-700">{draft.body}</p>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div className="rounded-lg bg-white p-3 text-sm"><span className="font-bold">{t("Follow-up 1")}:</span> {draft.follow_up_1 || followUps?.no_open?.[0] || t(unavailable)}</div>
          <div className="rounded-lg bg-white p-3 text-sm"><span className="font-bold">{t("Follow-up 2")}:</span> {draft.follow_up_2 || followUps?.opened?.[0] || t(unavailable)}</div>
        </div>
      </section>}

      {visibleStatus && <p className="mt-4 rounded-xl bg-teal-50 p-3 text-sm font-semibold text-brand">{visibleStatus}</p>}
      {error && <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p>}
      <div className="mt-5 flex flex-col gap-2 min-[430px]:flex-row">
        <PrimaryButton onClick={completeResearch} disabled={busy}>{busy ? <Loader2 className="animate-spin" size={17} /> : <Sparkles size={17} />} {t("Complete sales research")}</PrimaryButton>
        <SecondaryButton onClick={approveAndSend} disabled={!readyToSend || busy || !draft || sending || draft.delivery_status === "sent"}>{sending ? <Loader2 className="animate-spin" size={17} /> : <Send size={17} />} {draft?.delivery_status === "sent" ? t("Sent") : t("Approve & send")}</SecondaryButton>
      </div>
    </article>
  );
}

export function DashboardHome() {
  const { metrics, leads, campaigns, employees, activity, loading, error, supportingError, cachedAt } = useDashboardData();
  const { t } = useI18n();
  const hasAnyData = metrics.leads > 0 || metrics.campaigns > 0 || metrics.emails_sent > 0 || metrics.replies > 0 || metrics.meetings > 0 || leads.length > 0 || campaigns.length > 0 || employees.length > 0 || activity.length > 0;
  const nextStep = dashboardNextStep(metrics, leads, campaigns);
  const completedSteps = completedWorkflowSteps(metrics, leads, campaigns);
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
      {supportingError && <WidgetErrorCard title={cachedAt ? "Updating workspace data" : "Dashboard details are temporarily unavailable"} copy={supportingError} />}
      {error && <WidgetErrorCard title="Dashboard metrics could not update" copy={error} />}
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
      <WidgetBoundary name="Customer success path">
        <ActionPanel
          eyebrow="Fastest path to value"
          title="Get from one company to one reviewed email."
          copy="The workspace is organized around the shortest useful sales path: find companies, complete research, review the email, then launch only after approval."
        >
          <div className="grid gap-3 md:grid-cols-4">
            {[
              ["1", "Find companies", "Search one focused market.", "/dashboard/leads"],
              ["2", "Review CRM", "Open saved company workspaces.", "/dashboard/companies"],
              ["3", "Approve outreach", "Review the AI email before sending.", "/dashboard/campaigns"],
              ["4", "Track results", "Move replies through CRM.", "/dashboard/crm"]
            ].map(([step, title, copy, href]) => (
              <Link key={step} href={href} className="rounded-2xl border border-slate-200 bg-slate-50 p-4 transition hover:-translate-y-0.5 hover:border-teal-200 hover:bg-teal-50">
                <span className="grid size-9 place-items-center rounded-xl bg-white text-sm font-black text-brand shadow-sm">{step}</span>
                <h3 className="mt-3 font-black text-ink">{t(title)}</h3>
                <p className="mt-1 text-sm leading-6 text-slate-600">{t(copy)}</p>
              </Link>
            ))}
          </div>
        </ActionPanel>
      </WidgetBoundary>
      <WidgetBoundary name="Sales workflow">
        <WorkflowTracker activeStep={nextStep.step} completedSteps={completedSteps} />
      </WidgetBoundary>
      {activeSignals.length > 0 && <WidgetBoundary name="Workspace metrics"><section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {activeSignals.map((signal) => <MetricCard key={signal.label} label={signal.label} value={signal.value} help={signal.help} />)}
      </section></WidgetBoundary>}
      {!hasAnyData && <WidgetBoundary name="Dashboard onboarding"><EmptyState title={t("Start with one focused lead search.")} copy={t("Choose one country, one city and one industry. OutreachAI will save real companies, analyze websites and prepare outreach only after verified data exists.")} action={<Link href="/dashboard/leads" className="inline-flex min-h-11 items-center justify-center rounded-md bg-brand px-4 text-sm font-bold text-white">{t("Find companies")}</Link>} /></WidgetBoundary>}
      {(employees.length > 0 || activity.length > 0) && <WidgetBoundary name="Latest workspace activity"><section className="grid gap-4 lg:grid-cols-2">
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
      </section></WidgetBoundary>}
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
  const [searching, setSearching] = useState(false);
  const [lastSearchPayload, setLastSearchPayload] = useState<LeadSearchPayload | null>(null);
  const [manualBusy, setManualBusy] = useState(false);
  const [leadSearchStatus, setLeadSearchStatus] = useState<WorkspaceIntegrationStatus["status"] | "unknown">("unknown");
  const { t } = useI18n();
  const visibleMessage = message;
  const automaticSearchReady = leadSearchStatus === "connected";

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
      setMessage(workspaceManualSaveMessage(saved, lead, t));
      setSearchSteps([t("Saved to CRM"), t("Ready for company research")]);
      form.reset();
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

  async function runLeadSearch(payload: LeadSearchPayload) {
    if (!automaticSearchReady) {
      setHasSearched(true);
      setSearchResults([]);
      setSearchSummary({ found: 0, saved: 0, duplicates: 0 });
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
      const found = safeArray(result.companies).map(normalizeCrmCompany).map(leadFromCrmCompany);
      leadFinderDebug("FETCH_FINISHED", { status: result.status, count: found.length, request_id: result.request_id });
      const warnings = safeArray(result.warnings);
      const savedCount = Number(result.companies_saved ?? 0);
      const duplicateCount = Number(result.duplicates_skipped ?? 0);
      const persistenceStep = found.length && savedCount === 0 && duplicateCount > 0 ? t("Already in CRM") : found.length ? t("Saved to CRM") : t("No companies found");
      setSearchSteps([
        t("Lead search finished"),
        t("Found companies count").replace("{count}", String(found.length)),
        persistenceStep,
        ...(warnings.length ? [t("Partial data available")] : [])
      ]);
      setSearchSummary({
        found: found.length,
        saved: savedCount,
        duplicates: duplicateCount
      });
      setLeads((items) => mergeLeads(found, items));
      setSearchResults(found);
      setMessage(workspaceSearchMessage(result, found.length, t));
      trackEvent(found.length ? "lead_finder_search_completed" : "lead_finder_search_empty", {
        country: payload.country,
        city: payload.city,
        industry: payload.industry,
        result_count: found.length,
        status: result.status,
        source: "lead_search"
      });
    } catch (err) {
      leadFinderDebug("FETCH_FINISHED", { status: "error", reason: err instanceof Error ? err.message : "unknown" });
      if (isSessionExpiredError(err)) {
        redirectToSignIn();
        return;
      }
      const reason = userMessage(err, "Lead search could not be completed.", t);
      setSearchResults([]);
      setSearchSummary({ found: 0, saved: 0, duplicates: 0 });
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
      <PageHeader eyebrow="Lead Finder" title="Find real companies and turn each into a sales opportunity." copy="Start with one company you already know, or search a focused market when automatic search is connected. Every saved company stays in your private CRM." />
      <section className="rounded-2xl border border-teal-200 bg-teal-50 p-5 shadow-sm">
        <p className="text-sm font-black uppercase text-brand">{t("Recommended next step")}</p>
        <h2 className="mt-2 text-2xl font-black tracking-tight text-ink">{t("Add one real company first.")}</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-700">{t("You only need a company name and website to start. OutreachAI saves it to CRM, then you can analyze the website, find contacts and prepare an email for review.")}</p>
        <div className="mt-4 flex flex-col gap-3 min-[430px]:flex-row">
          <Link href="#manual-company" className="inline-flex min-h-11 items-center justify-center rounded-xl bg-brand px-4 text-sm font-black text-white shadow-sm">{t("Add company manually")}</Link>
          {automaticSearchReady ? <Link href="#lead-search-form" className="inline-flex min-h-11 items-center justify-center rounded-xl border border-teal-300 bg-white px-4 text-sm font-black text-brand shadow-sm">{t("Search market")}</Link> : <Link href="#lead-search-setup" className="inline-flex min-h-11 items-center justify-center rounded-xl border border-amber-300 bg-white px-4 text-sm font-black text-amber-900 shadow-sm">{t("Automatic search setup")}</Link>}
        </div>
      </section>
      <IntegrationStatusPanel api={api} ready={ready} />
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
        {visibleMessage && <div className="mt-4 flex flex-col gap-3 rounded-xl bg-slate-50 p-3 sm:flex-row sm:items-center sm:justify-between">
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
        {searchSummary && <div className="mt-4 grid gap-2 sm:grid-cols-3" aria-label={t("Lead search summary")}>
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
        </div>}
        {searchSteps.length > 0 && <ol className="mt-4 grid gap-2 text-sm sm:grid-cols-3" aria-label="Lead search progress">
          {searchSteps.map((step, index) => <li key={`${step}-${index}`} className="flex items-center gap-2 rounded-xl bg-teal-50 p-3 font-semibold text-brand"><CheckCircle2 size={16} />{step}</li>)}
        </ol>}
      </form>
      </ActionPanel>
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm font-bold uppercase text-brand">{t("Start here")}</p>
            <h2 className="mt-1 text-xl font-bold text-ink">{t("Add a company in 20 seconds.")}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">{t("This is the fastest reliable path: save one real company, then run research and outreach from its opportunity card.")}</p>
          </div>
          <span className="w-fit rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">{t("Takes 20 seconds")}</span>
        </div>
        <form id="manual-company" aria-label="Manual company entry" onSubmit={addManualLead} className="mt-5 space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="text-sm font-semibold text-slate-700">{t("Company name")}<input name="company" required placeholder="Acme Construction" className="mt-2 min-h-11 w-full rounded-md border border-slate-300 px-3 text-sm" /></label>
            <label className="text-sm font-semibold text-slate-700">{t("Website")}<input name="website" placeholder="https://company.com" className="mt-2 min-h-11 w-full rounded-md border border-slate-300 px-3 text-sm" /></label>
            <label className="text-sm font-semibold text-slate-700">{t("Country")}<input name="country" placeholder="Germany" className="mt-2 min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm" /></label>
            <label className="text-sm font-semibold text-slate-700">{t("City")}<input name="city" placeholder="Berlin" className="mt-2 min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm" /></label>
            <label className="text-sm font-semibold text-slate-700 md:col-span-2">{t("Industry")}<input name="industry" placeholder="Construction" className="mt-2 min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm" /></label>
          </div>
          <details className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <summary className="cursor-pointer text-sm font-bold text-ink">{t("Optional details")}</summary>
            <p className="mt-2 text-sm text-slate-600">{t("Add contact details only if you already know them. You can fill missing data later from the company card.")}</p>
            <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <label className="text-sm font-semibold text-slate-700">{t("Decision maker")}<input name="contact" placeholder="Owner or founder" className="mt-2 min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm" /></label>
              <label className="text-sm font-semibold text-slate-700">{t("Email")}<input name="email" type="email" placeholder="name@company.com" className="mt-2 min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm" /></label>
              <label className="text-sm font-semibold text-slate-700">{t("Phone")}<input name="phone" placeholder="+49..." className="mt-2 min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm" /></label>
            </div>
          </details>
          <div>
            <PrimaryButton type="submit" disabled={manualBusy}>{manualBusy ? <Loader2 className="animate-spin" size={17} /> : <Plus size={17} />} {t("Save company to CRM")}</PrimaryButton>
          </div>
        </form>
      </section>
      {searching ? <LoadingSkeleton title="Searching companies" /> : loading && !hasSearched ? <LoadingSkeleton title="Loading saved companies." /> : error && !hasSearched ? <EmptyState title="Lead data unavailable" copy={error} /> : (hasSearched ? searchResults : leads).length ? <div className="grid gap-5">{(hasSearched ? searchResults : leads).map((lead) => <OpportunityCard key={lead.id || lead.place_id || lead.company} lead={lead} api={api} onLeadUpdated={(updated) => {
        setLeads((items) => items.map((item) => item.id === updated.id ? updated : item));
        setSearchResults((items) => items.map((item) => item.id === updated.id ? updated : item));
      }} />)}</div> : <EmptyState title={hasSearched ? "No matching companies found" : "No real leads yet"} copy={hasSearched ? "No companies matched those filters. Broaden the city, category, or radius and search again." : "Run a lead search or add a company manually. No demo companies are shown."} />}
    </div>
  );
}

function leadFromCrmCompany(company: CrmCompany): Lead {
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
    notes: company.notes[0]?.body || null,
    google_rating: company.google_rating,
    place_id: company.place_id,
    hunter_verified: company.contacts.some((contact) => contact.source === "hunter" && contact.email_status === "Verified"),
    source: company.source,
    ai_summary: company.ai_summary,
    suggested_offer: company.suggested_offer,
    outreach_strategy: company.outreach_strategy,
    sales_angle: company.sales_angle,
    expected_reply_rate: company.expected_reply_rate,
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
  const checks = [
    Boolean(company.website || company.domain),
    Boolean(company.address || company.city || company.country),
    Boolean(company.phone),
    Boolean(company.email || company.contacts.some((contact) => contact.email)),
    Boolean(company.contacts.length),
    Boolean(company.ai_summary),
    Boolean(company.suggested_offer || company.sales_angle),
    Boolean(company.generated_emails.length),
    Boolean(company.email_approved_at || company.generated_emails.some((email) => email.delivery_status === "approved" || email.delivery_status === "sent")),
    Boolean(company.email_sent_at || company.generated_emails.some((email) => email.delivery_status === "sent")),
    Boolean(company.replied_at || company.crm_stage === "Replied" || company.crm_stage === "Meeting Scheduled" || company.crm_stage === "Won"),
    Boolean(company.notes.length || company.activity.length),
  ];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}

function companyNextAction(company: CrmCompany) {
  const hasContact = Boolean(company.email || company.contacts.some((contact) => contact.email));
  const hasDraft = Boolean(company.generated_emails.length);
  const hasApproved = Boolean(company.email_approved_at || company.generated_emails.some((email) => email.delivery_status === "approved" || email.delivery_status === "sent"));
  const hasSent = Boolean(company.email_sent_at || company.generated_emails.some((email) => email.delivery_status === "sent"));
  if (!company.website && !company.domain) return "Add a website so OutreachAI can research this company.";
  if (!company.ai_summary) return "Run company research to create the sales angle.";
  if (!hasContact) return "Find or add a decision maker before preparing outreach.";
  if (!hasDraft) return "Generate a personalized email for review.";
  if (!hasApproved) return "Review and approve the prepared email.";
  if (!hasSent) return "Send the approved email when you are ready.";
  if (!company.replied_at) return "Watch for replies and follow up from the inbox.";
  if (company.crm_stage !== "Meeting Scheduled" && company.crm_stage !== "Won") return "Move the opportunity to the next CRM stage.";
  return "Keep notes updated and close the outcome.";
}

function emailStatusLabel(status?: string | null) {
  if (!status) return "Not prepared";
  const normalized = status.toLowerCase().replace(/[_-]+/g, " ").trim();
  if (normalized === "not prepared") return "Not prepared";
  if (normalized === "draft ready") return "Draft ready";
  if (normalized === "no verified email") return "No verified email";
  return status;
}

function pipelineReadiness(company: CrmCompany) {
  const ready = timelineProgress(company).filter(([, value]) => Boolean(value)).length;
  return `${ready}/8`;
}

function timelineProgress(company: CrmCompany) {
  const steps = [
    ["Saved", company.saved_to_crm_at || company.created_at],
    ["Researched", company.website_analyzed_at || company.ai_summary],
    ["Contact", company.contact_found_at || company.email || company.contacts.length],
    ["Draft", company.email_generated_at || company.generated_emails.length],
    ["Approved", company.email_approved_at],
    ["Sent", company.email_sent_at],
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

function contactConfidenceLabel(confidence: CrmContact["confidence"], t: (key: string) => string) {
  if (confidence === undefined || confidence === null || confidence === "") return t("Confidence not available");
  const value = typeof confidence === "number" ? `${confidence}%` : String(confidence).trim();
  return t("Confidence: {value}").replace("{value}", value);
}

function CrmCompanyCard({ company, api, highlighted = false }: { company: CrmCompany; api: ApiFn; highlighted?: boolean }) {
  const { t } = useI18n();
  const [current, setCurrent] = useState(company);
  const [stageValue, setStageValue] = useState(company.crm_stage);
  const [noteBody, setNoteBody] = useState("");
  const [actionBusy, setActionBusy] = useState("");
  const [actionNotice, setActionNotice] = useState("");
  const [actionError, setActionError] = useState("");
  const noteTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const lead = leadFromCrmCompany(current);
  const healthScore = companyHealthScore(current);
  const nextAction = companyNextAction(current);
  const progress = timelineProgress(current);
  const primaryContact = current.contacts[0];
  const firstDeal = current.deals[0];
  const owner = "Not assigned";
  const companySize = "Not available";
  const estimatedOpportunity = firstDeal?.value ? `€${Math.round(firstDeal.value).toLocaleString()}` : "Not available";
  const buyingSignals = [
    current.website_analyzed_at ? "Website research completed" : "",
    current.contact_found_at || current.contacts.length ? "Decision maker available" : "",
    current.generated_emails.length ? "Outreach draft prepared" : "",
    current.replied_at ? "Reply received" : "",
    current.google_rating ? "Public reputation signal available" : ""
  ].filter(Boolean);
  const risks = [
    !current.email && !current.contacts.some((contact) => contact.email) ? "No verified email yet" : "",
    !current.ai_summary ? "Company research is incomplete" : "",
    !current.generated_emails.length ? "No approved outreach draft yet" : ""
  ].filter(Boolean);
  const outreachSteps = [
    ["Draft", Boolean(current.email_generated_at || current.generated_emails.length)],
    ["Approved", Boolean(current.email_approved_at || current.generated_emails.some((email) => email.delivery_status === "approved" || email.delivery_status === "sent"))],
    ["Sent", Boolean(current.email_sent_at || current.generated_emails.some((email) => email.delivery_status === "sent"))],
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
    ["Contact found", current.contact_found_at, "A decision maker or business contact was added."],
    ["Email generated", current.email_generated_at, "A personalized draft was prepared for review."],
    ["Email approved", current.email_approved_at, "A user approved the draft before sending."],
    ["Email sent", current.email_sent_at, "Approved outreach was sent."],
    ["Email opened", current.opened_at, "The prospect opened the message."],
    ["Reply received", current.replied_at, "A reply was captured in the workspace."],
    ["Stage changed", current.stage_changed_at, t("Current stage is {stage}.").replace("{stage}", t(current.crm_stage))],
  ];

  function applyCompanyUpdate(updatedCompany: CrmCompany) {
    setCurrent(updatedCompany);
    setStageValue(updatedCompany.crm_stage);
  }

  async function moveStage(nextStage = stageValue) {
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
        <div className="grid gap-3 sm:grid-cols-2 xl:w-[34rem]">
          <InfoCell label="Company size" value={companySize === "Not available" ? null : companySize} help="Add company size from lead discovery or manual research." />
          <InfoCell label="Assigned owner" value={owner === "Not assigned" ? null : owner} help="Assign an owner when a teammate takes responsibility." />
          <InfoCell label="Last activity" value={formatDateTime(current.last_activity_at || current.stage_changed_at || current.updated_at)} help="Activity appears after sales work is logged." />
          <div className="rounded-xl border border-teal-200 bg-teal-50 p-4">
            <p className="text-xs font-bold uppercase text-brand">{t("Next recommended action")}</p>
            <p className="mt-2 text-sm font-semibold leading-6 text-ink">{t(nextAction)}</p>
          </div>
        </div>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {progress.map(([label, done]) => <div key={label} className={`rounded-xl border p-3 text-sm ${done ? "border-teal-200 bg-teal-50 text-brand" : "border-slate-200 bg-slate-50 text-slate-500"}`}>
          <CheckCircle2 size={16} className={done ? "text-brand" : "text-slate-300"} />
          <p className="mt-2 font-bold">{t(label)}</p>
        </div>)}
      </div>
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
            <InfoCell label="Technologies" value={null} help="Technology data appears after website research detects it." />
            <InfoCell label="Rating" value={current.google_rating ? `${current.google_rating}/5` : null} help="Rating appears when available from the business listing." />
            <InfoCell label="Data source" value={t(sourceLabel(current.source))} help="The source is shown as business-friendly verified data." />
          </div>
          <div className="mt-4 rounded-2xl bg-slate-50 p-4">
            <p className="text-sm font-bold text-ink">{t("Company description")}</p>
            <p className="mt-2 text-sm leading-6 text-slate-700">{current.ai_summary || t("Not available. Run company research to create a clear description before outreach.")}</p>
          </div>
        </WorkspaceSection>

        <WorkspaceSection id={`insights-${current.id}`} title="AI Insights" copy="A sales-ready summary of why this company matters and what to do next.">
          <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
            <div className="rounded-2xl bg-teal-50 p-4">
              <p className="text-sm font-bold text-brand">{t("AI summary")}</p>
              <p className="mt-2 text-sm leading-6 text-slate-800">{current.ai_summary || t("Not available. Analyze the company website to generate the summary, pain points and sales angle.")}</p>
              <p className="mt-4 text-sm font-bold text-ink">{t("Why this company is interesting")}</p>
              <p className="mt-2 text-sm leading-6 text-slate-700">{current.sales_angle || current.outreach_strategy || t("Not available. Complete sales research to identify the strongest outreach angle.")}</p>
            </div>
            <div className="grid gap-3">
              <InfoCell label="Estimated opportunity" value={estimatedOpportunity === "Not available" ? null : estimatedOpportunity} help="Deal value appears after qualification." />
              <InfoCell label="Confidence score" value={`${healthScore}%`} help="Based on profile completeness, contacts, AI research and outreach state." />
              <InfoCell label="Recommended action" value={t(nextAction)} help="The next safest step in the sales workflow." />
            </div>
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-sm font-bold text-ink">{t("Buying signals")}</p>
              <div className="mt-3 space-y-2">{buyingSignals.length ? buyingSignals.map((signal) => <p key={signal} className="flex items-center gap-2 rounded-lg bg-teal-50 p-3 text-sm font-semibold text-brand"><ShieldCheck size={16} />{t(signal)}</p>) : <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">{t("Not available. Analyze the website and find contacts to reveal buying signals.")}</p>}</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-sm font-bold text-ink">{t("Risks")}</p>
              <div className="mt-3 space-y-2">{risks.length ? risks.map((risk) => <p key={risk} className="flex items-center gap-2 rounded-lg bg-amber-50 p-3 text-sm font-semibold text-amber-800"><AlertTriangle size={16} />{t(risk)}</p>) : <p className="rounded-lg bg-teal-50 p-3 text-sm font-semibold text-brand">{t("No major missing steps detected for the current stage.")}</p>}</div>
            </div>
          </div>
        </WorkspaceSection>

        <WorkspaceSection id={`contacts-${current.id}`} title="Contact Center" copy="Decision makers, verified contact details and confidence in one place.">
          {current.contacts.length ? <div className="grid gap-3 lg:grid-cols-2">
            {current.contacts.map((contact) => <article key={contact.id} className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h4 className="font-bold text-ink">{contact.name || t("Not available")}</h4>
                  <p className="mt-1 text-sm text-slate-600">{contact.title || t("Role not available")}</p>
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
          </div>}
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <a href={`#outreach-${current.id}`} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-ink px-4 text-sm font-bold text-white"><UserRoundSearch size={17} /> {t("Review outreach workflow")}</a>
            <a href={`#notes-${current.id}`} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-bold text-ink"><Plus size={17} /> {t("Add contact note")}</a>
          </div>
        </WorkspaceSection>

        <WorkspaceSection id={`outreach-${current.id}`} title="Outreach Center" copy="Every email moves through review before anything is sent. The timeline below shows the exact state.">
          <div className="grid gap-2 sm:grid-cols-4 xl:grid-cols-8">
            {outreachSteps.map(([label, done]) => <div key={label} className={`rounded-xl border p-3 text-sm font-bold ${outreachTone(Boolean(done), label)}`}>
              <CheckCircle2 size={16} className={done ? "" : "text-slate-300"} />
              <p className="mt-2">{t(label)}</p>
            </div>)}
          </div>
          <div className="mt-5">
            {current.lead_id ? <OpportunityCard lead={lead} api={api} onCompanyUpdated={applyCompanyUpdate} /> : <p className="rounded-xl bg-amber-50 p-4 text-sm font-semibold text-amber-800">{t("Reconnect this company to a lead before generating outreach.")}</p>}
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
            {current.activity.slice(0, 4).map((item) => <div key={item.id} className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-[2rem_10rem_1fr]">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-50 text-blue-700"><FileText size={16} /></div>
              <div>
                <p className="font-bold text-ink">{t(activityLabel(item.action))}</p>
                <p className="mt-1 text-xs text-slate-500">{new Date(item.created_at).toLocaleString()}</p>
              </div>
              <p className="text-sm leading-6 text-slate-600">{t("Workspace activity was recorded for this company.")}</p>
            </div>)}
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
            <select value={stageValue} onChange={(event) => setStageValue(event.target.value)} className="min-h-11 rounded-md border border-slate-300 bg-white px-3 text-sm">
              {crmStages.map((stage) => <option key={stage} value={stage}>{t(stage)}</option>)}
            </select>
            <button type="button" onClick={() => moveStage()} disabled={actionBusy === "stage" || stageValue === current.crm_stage} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-ink px-4 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-60">{actionBusy === "stage" && <Loader2 className="animate-spin" size={16} />} {t("Move stage")}</button>
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
              <p className="whitespace-pre-line">{note.body}</p>
              <p className="mt-2 text-xs text-slate-500">{formatDateTime(note.created_at)}</p>
            </div>) : <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600">{t("No notes yet. Add the next customer conversation or internal follow-up.")}</p>}
          </div>
        </section>

        {actionNotice && <p role="status" className="rounded-2xl bg-teal-50 p-4 text-sm font-semibold text-brand">{actionNotice}</p>}
        {actionError && <p role="alert" className="rounded-2xl bg-red-50 p-4 text-sm font-semibold text-red-700">{actionError}</p>}
      </aside>
    </div>
  </article>;
}

function CompactCompanyCard({ company }: { company: CrmCompany }) {
  const { t } = useI18n();
  const healthScore = companyHealthScore(company);
  const nextAction = companyNextAction(company);
  const contactCount = company.contacts.length;
  const emailCount = company.generated_emails.length;
  const website = company.website || company.domain || "";
  const primaryContact = company.contacts.find((contact) => contact.email) || company.contacts[0];

  return <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-teal-200 hover:shadow-md">
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full border px-3 py-1 text-xs font-bold ${stageTone(company.crm_stage)}`}>{t(company.crm_stage)}</span>
          <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-bold text-slate-700">{t("AI Health")} {healthScore}%</span>
        </div>
        <h2 className="mt-3 break-words text-xl font-black tracking-tight text-ink">{company.name}</h2>
        <div className="mt-3 grid gap-2 text-sm text-slate-600 sm:grid-cols-2 xl:grid-cols-4">
          <span className="inline-flex min-w-0 items-center gap-1.5"><Building2 className="shrink-0" size={16} /> <span className="truncate">{company.industry || t("Not available")}</span></span>
          <span className="inline-flex min-w-0 items-center gap-1.5"><MapPin className="shrink-0" size={16} /> <span className="truncate">{[company.city, company.country].filter(Boolean).join(", ") || t("Not available")}</span></span>
          <span className="inline-flex min-w-0 items-center gap-1.5"><UserRound className="shrink-0" size={16} /> <span className="truncate">{contactCount ? `${contactCount} ${t(contactCount === 1 ? "contact" : "contacts")}` : t("No contacts yet")}</span></span>
          <span className="inline-flex min-w-0 items-center gap-1.5"><Mail className="shrink-0" size={16} /> <span className="truncate">{emailCount ? `${emailCount} ${t(emailCount === 1 ? "email draft" : "email drafts")}` : t("No email draft yet")}</span></span>
        </div>
        {website && <a className="mt-3 inline-flex max-w-full items-center gap-1.5 break-all text-sm font-bold text-brand hover:underline" href={website.startsWith("http") ? website : `https://${website}`} target="_blank" rel="noreferrer"><Globe2 className="shrink-0" size={16} />{website}</a>}
        <div className="mt-4 rounded-xl bg-slate-50 p-3">
          <p className="text-xs font-bold uppercase text-slate-500">{t("Next recommended action")}</p>
          <p className="mt-1 text-sm font-semibold leading-6 text-ink">{t(nextAction)}</p>
        </div>
      </div>
      <div className="grid shrink-0 gap-2 lg:w-56">
        <Link href={`/dashboard/companies?company=${encodeURIComponent(company.id)}`} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-ink px-4 text-sm font-bold text-white"><ArrowRight size={17} /> {t("Open company workspace")}</Link>
        <Link href={`/dashboard/crm`} className="inline-flex min-h-11 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-bold text-ink">{t("View pipeline")}</Link>
      </div>
    </div>
    <div className="mt-4 grid gap-3 border-t border-slate-100 pt-4 text-sm sm:grid-cols-3">
      <p><span className="block text-xs font-bold uppercase text-slate-500">{t("Last activity")}</span><span className="font-semibold text-ink">{formatDateTime(company.last_activity_at || company.stage_changed_at || company.updated_at)}</span></p>
      <p><span className="block text-xs font-bold uppercase text-slate-500">{t("Decision maker")}</span><span className="font-semibold text-ink">{primaryContact?.name || primaryContact?.title || t("Not available")}</span></p>
      <p><span className="block text-xs font-bold uppercase text-slate-500">{t("Verified email")}</span><span className="font-semibold text-ink">{company.email || primaryContact?.email || t("Not available")}</span></p>
    </div>
  </article>;
}

export function CompaniesPage() {
  const { api, companies, loading, error, filters, setFilters } = useCrmData();
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const focusedCompanyId = searchParams.get("company") || "";
  const focusedCompany = companies.find((company) => company.id === focusedCompanyId);

  return <div className="space-y-6">
    <PageHeader eyebrow="Companies" title="Every company is saved in your CRM." copy="Companies found by lead search, contact verification, or manual entry stay here after refresh." />
    {focusedCompany && <section className="rounded-2xl border border-teal-200 bg-teal-50 p-4 text-sm text-slate-700">
      <p className="font-bold text-brand">{t("Opened from CRM pipeline")}</p>
      <p className="mt-1">{t("Continue with the highlighted company, or clear the focus to view the full CRM list.")}</p>
      <Link href="/dashboard/companies" className="mt-3 inline-flex min-h-10 items-center justify-center rounded-md border border-teal-300 bg-white px-3 text-xs font-bold text-brand">{t("Clear focus")}</Link>
    </section>}
    <CrmFilters filters={filters} setFilters={setFilters} />
    {loading ? <EmptyState title="Loading CRM companies" copy="Loading saved companies." /> : error ? <WidgetErrorCard title="Companies could not update" copy={error} /> : focusedCompany ? <WidgetBoundary name={`Company workspace: ${focusedCompany.name}`}><CrmCompanyCard company={focusedCompany} api={api} highlighted /></WidgetBoundary> : companies.length ? <div className="grid gap-4">{companies.map((company) => <WidgetBoundary key={company.id} name={`Company summary: ${company.name}`}><CompactCompanyCard company={company} /></WidgetBoundary>)}</div> : <EmptyState title="No companies saved yet" copy="Run Lead Finder or add a manual company. OutreachAI will save real companies here, not demo data." action={<Link href="/dashboard/leads" className="inline-flex min-h-11 items-center rounded-md bg-brand px-4 text-sm font-bold text-white">{t("Find companies")}</Link>} />}</div>;
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

export function CampaignsPage() {
  const { api, campaigns, leads, loading, error, refresh } = useSalesData();
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
      setNotice(`${updated.name} is now ${updated.status}. Emails still require approved drafts before sending.`);
      trackEvent("campaign_status_updated", { campaign_id: campaignId, action, status: updated.status });
      await refresh();
    } catch (err) {
      setNotice(friendlyErrorMessage(err, "Campaign status could not be updated."));
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
        <label className="text-sm font-semibold text-slate-700">{t("CTA")}<input name="cta" placeholder={t("Open to a quick review?")} className="mt-2 min-h-11 w-full rounded-md border border-slate-300 px-3 text-sm" /></label>
        <label className="text-sm font-semibold text-slate-700">{t("Signature")}<input name="signature" placeholder={t("Your name")} className="mt-2 min-h-11 w-full rounded-md border border-slate-300 px-3 text-sm" /></label>
      </div>
      <div className="mt-5"><PrimaryButton type="submit" disabled={actionBusy === "create"}>{actionBusy === "create" ? <Loader2 className="animate-spin" size={17} /> : <Plus size={17} />} {t("Create campaign")}</PrimaryButton></div>
    </form>}
    {loading ? <EmptyState title="Loading campaigns" copy="Reading saved campaigns." /> : error ? <EmptyState title="Campaign data unavailable" copy={error} /> : campaigns.length ? <section className="grid gap-4 lg:grid-cols-2">{campaigns.map((campaign) => <article key={campaign.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="font-bold text-ink">{campaign.name}</h2><p className="mt-2 text-sm text-slate-600">{campaign.leads} {t("leads")} · {campaign.sent} {t("sent")} · {campaign.replies} {t("replies")} · {t(campaign.status)}</p><div className="mt-4 space-y-3">{campaign.sequence.length ? campaign.sequence.map((step) => <div key={step.step_order} className="rounded-xl bg-slate-50 p-3"><p className="font-bold">{step.name || `${t("Email")} ${step.step_order}`}</p><p className="mt-1 text-sm text-slate-600">{step.subject || t("Subject unavailable until AI draft is reviewed")}</p><p className="mt-1 text-xs font-semibold text-slate-500">{t("Delay")}: {step.delay_days} {t("days")}</p></div>) : <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600">{t("No sequence saved yet.")}</p>}</div><p className="mt-4 rounded-xl bg-teal-50 p-3 text-sm font-bold text-brand">{t("Review before send: enabled")}</p><div className="mt-4 grid gap-2 min-[430px]:grid-cols-2"><SecondaryButton onClick={() => campaignAction(campaign.id, "pause")} disabled={actionBusy === `${campaign.id}:pause`}><Pause size={17} /> {t("Pause")}</SecondaryButton><PrimaryButton onClick={() => campaignAction(campaign.id, campaign.status === "Paused" ? "resume" : "launch")} disabled={actionBusy === `${campaign.id}:launch` || actionBusy === `${campaign.id}:resume`}>{actionBusy.startsWith(campaign.id) ? <Loader2 className="animate-spin" size={17} /> : <Play size={17} />} {campaign.status === "Paused" ? t("Resume") : t("Launch after approval")}</PrimaryButton></div></article>)}</section> : <EmptyState title="No campaigns yet" copy={leads.length ? "Create a campaign from selected opportunities before sending." : "Find leads first, then create a campaign. No sample campaigns are shown."} action={leads.length ? undefined : <Link href="/dashboard/leads" className="inline-flex min-h-11 items-center rounded-md bg-brand px-4 text-sm font-bold text-white">{t("Find leads")}</Link>} />}
  </div>;
}

export function InboxPage() {
  return <div className="space-y-6"><PageHeader eyebrow="Inbox" title="Replies will appear here when campaigns receive real responses." copy="AI classification is available after reply events exist in the workspace." /><EmptyState title="No real replies yet" copy="OutreachAI will classify replies as Interested, Not interested, Later, Asked for pricing, Wants a call or Wrong person after replies are received." /></div>;
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
  const cards = [["Leads found", metrics.leads], ["Websites analyzed", metrics.funnel?.find((item) => item.status === "analyzed")?.count || 0], ["Emails generated", metrics.emails_sent + metrics.delivered], ["Emails sent", metrics.emails_sent], ["Open rate", `${metrics.open_rate || 0}%`], ["Reply rate", `${metrics.reply_rate || 0}%`], ["Meetings booked", metrics.meetings], ["Clients won", metrics.conversion_rate ? `${metrics.conversion_rate}% conversion` : "0"], ["Estimated revenue", `€${Math.round(metrics.revenue_forecast || metrics.revenue || 0).toLocaleString()}`]];
  return <div className="space-y-6"><PageHeader eyebrow="Analytics" title="Measure real outbound performance." copy="Metrics come from saved campaigns, email events and subscription activity." />{loading ? <EmptyState title="Loading analytics" copy="Reading real workspace metrics." /> : error ? <EmptyState title="Analytics unavailable" copy={error} /> : <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{cards.map(([label, value]) => <MetricCard key={String(label)} label={String(label)} value={String(value)} help="Real workspace metric" />)}</section>}</div>;
}

export function SettingsPage() {
  const { t } = useI18n();
  const readiness = [
    ["Company setup", "Tell OutreachAI what you sell so lead research and emails match your offer.", "Complete this before your first campaign."],
    ["Lead readiness", "Find or add companies, then save each valid opportunity into CRM.", "Missing data is shown clearly instead of guessed."],
    ["Outreach safety", "Every email stays in review until a person approves the send.", "Nothing external happens automatically."],
    ["Plan and limits", "Your plan controls how many leads, emails and workspaces can be used this month.", "Upgrade only when you hit a real limit."]
  ];
  return <div className="space-y-6"><PageHeader eyebrow="Settings" title="Make the workspace ready for your first campaign." copy="Keep setup simple: confirm your company, find leads, review AI work, then approve outreach." action={<Link href="/dashboard/leads" className="inline-flex min-h-11 items-center justify-center rounded-md bg-brand px-4 text-sm font-bold text-white">{t("Find leads")}</Link>} /><section className="grid gap-4 lg:grid-cols-2">{readiness.map(([title, copy, status]) => <article key={title} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="font-bold text-ink">{t(title)}</h2><p className="mt-2 text-sm leading-6 text-slate-600">{t(copy)}</p><p className="mt-4 rounded-xl bg-slate-50 p-3 text-sm font-semibold text-slate-700">{t(status)}</p></article>)}</section><section id="lead-search-key" className="scroll-mt-24 rounded-2xl border border-amber-200 bg-amber-50 p-5 shadow-sm"><p className="text-sm font-bold uppercase text-amber-800">{t("Lead search key")}</p><h2 className="mt-2 text-xl font-black text-ink">{t("Automatic company search needs one setup step")}</h2><p className="mt-2 text-sm leading-6 text-amber-900">{t("Ask the workspace owner to connect automatic company search. Until then, add companies manually and continue with CRM, research and outreach review.")}</p><div className="mt-4 flex flex-col gap-3 min-[430px]:flex-row"><Link href="/dashboard/leads#manual-company" className="inline-flex min-h-11 items-center justify-center rounded-md bg-brand px-4 text-sm font-bold text-white">{t("Add company manually")}</Link><Link href="/dashboard/billing" className="inline-flex min-h-11 items-center justify-center rounded-md border border-amber-300 bg-white px-4 text-sm font-bold text-amber-900">{t("Check plan")}</Link></div></section><details className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><summary className="cursor-pointer text-sm font-bold text-ink">{t("Advanced settings")}</summary><p className="mt-3 text-sm leading-6 text-slate-600">{t("Use this area only when a workspace owner needs to adjust billing, security, team access or sending preferences. New users can start from Lead Finder instead.")}</p><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{["Billing", "Security", "Team access", "Sending preferences"].map((item) => <Link key={item} href={item === "Billing" ? "/dashboard/billing" : "/dashboard/settings"} className="inline-flex min-h-11 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-bold text-ink">{t(item)}</Link>)}</div></details></div>;
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
