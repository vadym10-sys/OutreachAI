"use client";

import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import * as Sentry from "@sentry/nextjs";
import { AlertTriangle, ArrowRight, BarChart3, Building2, CalendarDays, CheckCircle2, Clock3, Download, ExternalLink, FileText, Globe2, Inbox, Lightbulb, Loader2, Mail, MapPin, MessageSquare, Pause, Phone, Play, Plus, Search, Send, ShieldCheck, Sparkles, Target, UserRound, UserRoundSearch } from "lucide-react";
import { clientApi, friendlyErrorMessage, splitList } from "@/lib/client-api";
import { hasClerkPublishableKey, isClerkE2EBypass } from "@/lib/env";
import { trackEvent } from "@/lib/posthog";
import { useI18n } from "@/lib/i18n/provider";
import type { Activity, AISalesEmployee, Campaign, CrmCompany, CrmContact, CrmDeal, CrmPipeline, DashboardMetrics, Email, FollowUpSequence, Lead, SalesCopilot, WebsiteAudit } from "@/lib/types";

type ApiFn = <T>(path: string, init?: RequestInit) => Promise<T>;

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

function normalizePipeline(value: Partial<CrmPipeline> | undefined | null): CrmPipeline {
  return {
    stages: safeArray(value?.stages).length ? safeArray(value?.stages) : crmStages,
    companies: safeArray(value?.companies),
    deals: safeArray(value?.deals)
  };
}

function formatDateTime(value?: string | null) {
  if (!value) return "Not recorded yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not recorded yet";
  return date.toLocaleString();
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function devApi<T>(path: string, init: RequestInit = {}) {
  return clientApi<T>(path, "dev", init);
}

function useTokenApi(): { api: ApiFn; ready: boolean } {
  if (!hasClerkPublishableKey || isClerkE2EBypass) {
    return { api: devApi, ready: true };
  }
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const { getToken, isLoaded, isSignedIn } = useAuth();
  // The no-Clerk branch above is required for local/E2E builds where ClerkProvider is intentionally not mounted.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const api = useCallback(async function api<T>(path: string, init: RequestInit = {}) {
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
    size: lead.employee_count ? `${lead.employee_count} employees` : lead.revenue_range || unavailable,
    decisionMaker: [lead.contact, lead.title].filter(Boolean).join(", ") || unavailable,
    verifiedEmail: lead.email ? `${lead.email}${lead.hunter_verified ? " · verified email" : ""}` : lead.hunter_status === "no_verified_email" ? "No verified email found yet." : unavailable,
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
  return [
    ["Company profile", Boolean(lead.company && (lead.website || lead.domain || lead.industry || lead.country))],
    ["Website analysis", profile.websiteAnalysis !== unavailable || Boolean(audit?.improvement_report)],
    ["Decision makers", profile.decisionMaker !== unavailable],
    ["Verified emails", Boolean(lead.email && lead.hunter_verified)],
    ["AI pain analysis", profile.painAnalysis !== unavailable || Boolean(audit?.priority_actions?.length)],
    ["AI opportunity analysis", profile.opportunityAnalysis !== unavailable || Boolean(copilot?.reasoning?.length)],
    ["Personalized offer", profile.offer !== unavailable],
    ["Personalized first email", Boolean(draft?.subject && draft.body)],
    ["Follow-up sequence", Boolean(followUps && (followUps.no_open.length || followUps.opened.length || followUps.replied.length || followUps.clicked.length))],
    ["Confidence score", Boolean(copilot)],
    ["Expected reply rate", profile.expectedReplyRate !== unavailable || Boolean(copilot)],
    ["Priority score", Boolean(copilot)]
  ] as const;
}

function priorityScore(copilot?: SalesCopilot) {
  if (!copilot) return null;
  return Math.round((copilot.probability_to_reply * 0.45) + (copilot.probability_to_buy * 0.45) + Math.min(copilot.estimated_revenue / 1000, 10));
}

function PageHeader({ eyebrow, title, copy, action }: { eyebrow: string; title: string; copy: string; action?: React.ReactNode }) {
  return (
    <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div className="max-w-3xl">
        <p className="text-sm font-bold uppercase tracking-wide text-brand">{eyebrow}</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-ink min-[390px]:text-4xl">{title}</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600 min-[390px]:text-base">{copy}</p>
      </div>
      {action}
    </header>
  );
}

function PrimaryButton({ children, onClick, disabled = false }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean }) {
  return <button onClick={onClick} disabled={disabled} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-brand px-4 text-sm font-bold text-white shadow-sm hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-60">{children}</button>;
}

function SecondaryButton({ children, onClick, disabled = false }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean }) {
  return <button onClick={onClick} disabled={disabled} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-bold text-ink hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-60">{children}</button>;
}

function EmptyState({ title, copy, action }: { title: string; copy: string; action?: React.ReactNode }) {
  return <section className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center shadow-sm"><h2 className="text-lg font-bold text-ink">{title}</h2><p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-600">{copy}</p>{action && <div className="mt-5 flex justify-center">{action}</div>}</section>;
}

function MetricCard({ label, value, help }: { label: string; value: string; help: string }) {
  return <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-sm font-semibold text-slate-500">{label}</p><p className="mt-2 text-3xl font-bold text-ink">{value}</p><p className="mt-2 text-sm text-slate-600">{help}</p></article>;
}

function WorkflowTracker({ activeStep, completedSteps }: { activeStep: string; completedSteps: string[] }) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-bold uppercase text-brand">Sales workflow</p>
          <h2 className="mt-1 text-xl font-bold text-ink">One path from prospect to customer.</h2>
        </div>
        <p className="text-sm font-semibold text-slate-600">Current step: {activeStep}</p>
      </div>
      <div className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {salesWorkflow.map((step) => {
          const done = completedSteps.includes(step);
          const active = activeStep === step;
          return (
            <div key={step} className={`rounded-xl border p-3 text-sm ${active ? "border-teal-300 bg-teal-50 text-brand" : done ? "border-slate-200 bg-slate-50 text-slate-700" : "border-slate-200 bg-white text-slate-500"}`}>
              <div className="flex items-center gap-2">
                <CheckCircle2 size={16} className={done || active ? "text-brand" : "text-slate-300"} />
                <span className="font-bold">{step}</span>
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
      title: `Complete research for ${leadNeedingResearch.company}`,
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
        api<PaginatedLeads>("/api/leads?page_size=100"),
        api<Campaign[]>("/api/campaigns"),
        api<DashboardMetrics>("/api/dashboard")
      ]);
      const [leadResult, campaignResult, dashboardResult] = results;
      if (leadResult.status === "fulfilled") setLeads(leadResult.value.items || []);
      if (campaignResult.status === "fulfilled") setCampaigns(campaignResult.value || []);
      if (dashboardResult.status === "fulfilled") setMetrics({ ...emptyMetrics, ...dashboardResult.value });

      const failed = results.filter((result) => result.status === "rejected") as PromiseRejectedResult[];
      if (failed.length) {
        failed.forEach((result) => {
          Sentry.captureException(result.reason, {
            tags: { area: "sales-workspace-loader" },
            extra: { endpoint_group: "leads-campaigns-dashboard" }
          });
        });
        if (leadResult.status === "rejected" && campaignResult.status === "rejected" && dashboardResult.status === "rejected") {
          setError(friendlyErrorMessage(leadResult.reason, "Workspace data could not be loaded. Please try again."));
        }
      }
    } catch (err) {
      setError(friendlyErrorMessage(err, "Could not load sales workspace data. Please refresh or sign in again."));
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
        api<CrmCompany[]>(`/api/crm/companies${suffix}`),
        api<CrmContact[]>(`/api/crm/contacts${suffix}`),
        api<CrmDeal[]>(`/api/crm/deals${suffix}`),
        api<CrmPipeline>("/api/crm/pipeline")
      ]);
      const [companyResult, contactResult, dealResult, pipelineResult] = results;
      if (companyResult.status === "fulfilled") setCompanies(safeArray(companyResult.value));
      if (contactResult.status === "fulfilled") setContacts(safeArray(contactResult.value));
      if (dealResult.status === "fulfilled") setDeals(safeArray(dealResult.value));
      if (pipelineResult.status === "fulfilled") setPipeline(normalizePipeline(pipelineResult.value));

      const failed = results.filter((result) => result.status === "rejected") as PromiseRejectedResult[];
      if (failed.length) {
        failed.forEach((result) => {
          Sentry.captureException(result.reason, {
            tags: { area: "crm-workspace-loader" },
            extra: { endpoint_group: "companies-contacts-deals-pipeline" }
          });
        });
        if (companyResult.status === "rejected" && contactResult.status === "rejected" && dealResult.status === "rejected" && pipelineResult.status === "rejected") {
          setError(friendlyErrorMessage(companyResult.reason, "CRM data could not be loaded. Please try again."));
        }
      }
    } catch (err) {
      setError(friendlyErrorMessage(err, "CRM data could not be loaded. Please refresh or sign in again."));
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

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    async function loadDashboard() {
      setLoading(true);
      setError("");
      setSupportingError("");
      try {
        const dashboard = await api<DashboardMetrics>("/api/dashboard");
        if (cancelled) return;
        setMetrics({ ...emptyMetrics, ...dashboard });

        const results = await Promise.allSettled([
          api<PaginatedLeads>("/api/leads?page_size=5"),
          api<Campaign[]>("/api/campaigns"),
          api<AISalesEmployee[]>("/api/sales-employees"),
          api<Activity[]>("/api/activity")
        ]);
        if (cancelled) return;
        const [leadResult, campaignResult, employeeResult, activityResult] = results;
        if (leadResult.status === "fulfilled") setLeads(leadResult.value.items || []);
        if (campaignResult.status === "fulfilled") setCampaigns(campaignResult.value || []);
        if (employeeResult.status === "fulfilled") setEmployees(employeeResult.value || []);
        if (activityResult.status === "fulfilled") setActivity(activityResult.value || []);

        const failed = results.filter((result) => result.status === "rejected") as PromiseRejectedResult[];
        if (failed.length) {
          failed.forEach((result) => {
            if (process.env.NODE_ENV !== "production") {
              console.error("Dashboard supporting data could not be loaded", result.reason);
            }
            Sentry.captureException(result.reason, {
              tags: { area: "dashboard-supporting-data" },
              extra: { endpoint_group: "leads-campaigns-employees-activity" }
            });
          });
          setSupportingError("Some dashboard details are temporarily unavailable. Core workspace metrics are loaded.");
        }
      } catch (err) {
        if (process.env.NODE_ENV !== "production") {
          console.error("Dashboard metrics could not be loaded", err);
        }
        Sentry.captureException(err, {
          tags: { area: "dashboard-critical-data" },
          extra: { endpoint: "/api/dashboard" }
        });
        setError(friendlyErrorMessage(err, "Dashboard data could not be loaded."));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadDashboard();
    return () => {
      cancelled = true;
    };
  }, [api, ready]);

  return { metrics, leads, campaigns, employees, activity, loading, error, supportingError };
}

function OpportunityCard({ lead, api, onLeadUpdated }: { lead: Lead; api: ApiFn; onLeadUpdated?: (lead: Lead) => void }) {
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

  async function completeResearch() {
    if (!lead.id) {
      setError("Save this lead before running AI research.");
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
    try {
      if (lead.website || lead.domain) {
        setStatus("Analyzing website...");
        const analysis = await api<AnalysisResult>("/api/ai/analyze", {
          method: "POST",
          body: JSON.stringify({ lead_id: lead.id, website: leadWebsite(lead), company: lead.company, niche: lead.industry || lead.niche || "" })
        });
        onLeadUpdated?.({ ...lead, ai_summary: analysis.summary, suggested_offer: analysis.suggested_offer, outreach_strategy: analysis.outreach_strategy, sales_angle: analysis.sales_angle, expected_reply_rate: analysis.expected_reply_rate, industry: lead.industry || analysis.industry || undefined });
      }
      setStatus("Running AI opportunity analysis...");
      setCopilot(await api<SalesCopilot>(`/api/leads/${lead.id}/copilot`, { method: "POST" }));
      if (lead.website || lead.domain) {
        setStatus("Auditing website pain points...");
        setAudit(await api<WebsiteAudit>(`/api/leads/${lead.id}/website-audit`, { method: "POST" }));
      }
      setStatus("Generating follow-up sequence...");
      setFollowUps(await api<FollowUpSequence>(`/api/leads/${lead.id}/follow-ups`, { method: "POST" }));
      setStatus("Preparing personalized first email...");
      const nextDraft = await api<Email>(`/api/leads/${lead.id}/draft-email`, { method: "POST" });
      setStatus("Email draft is ready. Review it below, then approve the send when you are ready.");
      setDraft(nextDraft);
      setReadyToSend(true);
      trackEvent("sales_research_completed", {
        lead_id: lead.id,
        company: lead.company,
        has_verified_email: Boolean(lead.email && lead.hunter_verified)
      });
    } catch (err) {
      const reason = friendlyErrorMessage(err, "Research could not be completed. Please check the lead details and try again.");
      setReadyToSend(false);
      setError(reason);
      trackEvent("sales_research_failed", {
        lead_id: lead.id,
        company: lead.company,
        reason
      });
    } finally {
      setBusy(false);
    }
  }

  async function approveAndSend() {
    if (!draft?.id) {
      setError("Generate and review the email before approving a send.");
      return;
    }
    setSending(true);
    setError("");
    setStatus("Approving email...");
    try {
      const approved = await withTimeout(
        api<Email>(`/api/emails/${draft.id}/approve`, { method: "POST" }),
        15000,
        "Email approval timed out. Please try again before sending."
      );
      setDraft(approved);
      setStatus("Sending approved email...");
      const sent = await withTimeout(
        api<Email>(`/api/emails/${draft.id}/send`, { method: "POST" }),
        30000,
        "Email sending timed out. Please try again before approving another send."
      );
      setDraft(sent);
      setReadyToSend(false);
      setStatus("Approved email was sent. CRM stage updated to Contacted.");
      onLeadUpdated?.({ ...lead, status: "Contacted", email_approved_at: new Date().toISOString(), email_sent_at: sent.sent_at || new Date().toISOString() });
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
          <p className="mt-2 text-sm text-slate-600">{profile.industry} · {profile.location} · {profile.size}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="rounded-full bg-teal-50 px-3 py-1 text-xs font-bold text-brand">{completed}/12 complete</span>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">Data: {sourceLabel(profile.source)}</span>
        </div>
      </div>

      <div className="mt-5 grid gap-3 lg:grid-cols-3">
        {[
          ["Company profile", `${profile.industry} · ${profile.location}`],
          ["Decision maker", profile.decisionMaker],
          ["Verified email", profile.verifiedEmail],
          ["AI pain analysis", audit?.priority_actions?.join(", ") || profile.painAnalysis],
          ["AI opportunity analysis", copilot?.reasoning?.join(" ") || profile.opportunityAnalysis],
          ["Personalized offer", profile.offer],
          ["Expected reply rate", copilot ? `${copilot.probability_to_reply}%` : profile.expectedReplyRate],
          ["Confidence score", copilot ? `${copilot.probability_to_buy}% purchase probability` : unavailable],
          ["Priority score", priority === null ? unavailable : `${priority}/100`]
        ].map(([label, value]) => <div key={label} className="rounded-xl bg-slate-50 p-3"><p className="text-xs font-bold uppercase text-slate-500">{label}</p><p className="mt-1 text-sm font-semibold text-slate-800">{value}</p></div>)}
      </div>
      <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Found", lead.found_at || lead.created_at],
          ["Saved to CRM", lead.saved_to_crm_at],
          ["Analyzed", lead.website_analyzed_at],
          ["Email generated", lead.email_generated_at],
          ["Email approved", lead.email_approved_at],
          ["Last activity", lead.last_activity_at || lead.stage_changed_at],
        ].map(([label, value]) => <div key={label} className="rounded-xl border border-slate-200 bg-white p-3">
          <p className="font-semibold text-slate-700">{label}</p>
          <p className="mt-1 text-slate-500">{formatDateTime(value)}</p>
        </div>)}
      </div>

      <div className="mt-5 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {coverage.map(([label, done]) => <span key={label} className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold ${done ? "bg-teal-50 text-brand" : "bg-slate-100 text-slate-500"}`}><CheckCircle2 size={15} />{label}</span>)}
      </div>

      {draft && (readyToSend || draft.delivery_status === "sent") && <section className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
        <p className="text-xs font-bold uppercase text-slate-500">Personalized first email</p>
        <p className="mt-2 rounded-lg bg-teal-50 p-3 text-sm font-semibold text-brand">{draft.delivery_status === "sent" ? "Approved email was sent. CRM stage updated to Contacted." : "Review this draft before sending. No email has been sent yet."}</p>
        <h3 className="mt-2 font-bold text-ink">{draft.subject}</h3>
        <p className="mt-2 whitespace-pre-line text-sm leading-6 text-slate-700">{draft.body}</p>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div className="rounded-lg bg-white p-3 text-sm"><span className="font-bold">Follow-up 1:</span> {draft.follow_up_1 || followUps?.no_open?.[0] || unavailable}</div>
          <div className="rounded-lg bg-white p-3 text-sm"><span className="font-bold">Follow-up 2:</span> {draft.follow_up_2 || followUps?.opened?.[0] || unavailable}</div>
        </div>
      </section>}

      {visibleStatus && <p className="mt-4 rounded-xl bg-teal-50 p-3 text-sm font-semibold text-brand">{visibleStatus}</p>}
      {error && <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p>}
      <div className="mt-5 flex flex-col gap-2 min-[430px]:flex-row">
        <PrimaryButton onClick={completeResearch} disabled={busy}>{busy ? <Loader2 className="animate-spin" size={17} /> : <Sparkles size={17} />} Complete sales research</PrimaryButton>
        <SecondaryButton onClick={approveAndSend} disabled={!readyToSend || busy || !draft || sending || draft.delivery_status === "sent"}>{sending ? <Loader2 className="animate-spin" size={17} /> : <Send size={17} />} {draft?.delivery_status === "sent" ? "Sent" : "Approve & send"}</SecondaryButton>
      </div>
    </article>
  );
}

export function DashboardHome() {
  const { metrics, leads, campaigns, employees, activity, loading, error, supportingError } = useDashboardData();
  if (loading) return <EmptyState title="Loading your sales workspace" copy="Collecting real leads, campaigns and metrics from your workspace." />;
  if (error) return <EmptyState title="Workspace data unavailable" copy={error} />;
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
      <PageHeader eyebrow="Today" title="What should I do now?" copy="OutreachAI keeps one obvious next action so you can move from lead search to meetings without thinking through the whole system." action={<Link href={nextStep.href} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-brand px-4 text-sm font-bold text-white">{nextStep.label} <ArrowRight size={17} /></Link>} />
      {supportingError && <p role="status" className="rounded-2xl border border-orange-200 bg-orange-50 p-4 text-sm font-semibold text-orange-700">{supportingError}</p>}
      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <p className="text-sm font-bold uppercase text-brand">{nextStep.step}</p>
        <h2 className="mt-2 text-2xl font-bold text-ink">{nextStep.title}</h2>
        <p className="mt-3 text-sm leading-6 text-slate-600">{nextStep.copy}</p>
        <Link href={nextStep.href} className="mt-5 inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-ink px-4 text-sm font-bold text-white">{nextStep.label}<ArrowRight size={17} /></Link>
      </section>
      <WorkflowTracker activeStep={nextStep.step} completedSteps={completedSteps} />
      {activeSignals.length > 0 && <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {activeSignals.map((signal) => <MetricCard key={signal.label} label={signal.label} value={signal.value} help={signal.help} />)}
      </section>}
      {!hasAnyData && <EmptyState title="Start with one focused lead search." copy="Choose one country, one city and one industry. OutreachAI will save real companies, analyze websites and prepare outreach only after verified data exists." action={<Link href="/dashboard/leads" className="inline-flex min-h-11 items-center justify-center rounded-md bg-brand px-4 text-sm font-bold text-white">Find companies</Link>} />}
      {(employees.length > 0 || activity.length > 0) && <section className="grid gap-4 lg:grid-cols-2">
        {employees.length > 0 && <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-bold text-ink">AI Employees</h2>
          <p className="mt-2 text-sm text-slate-600">Active AI workers connected to this workspace.</p>
          <div className="mt-4 space-y-2">{employees.slice(0, 3).map((employee) => <div key={employee.id} className="rounded-xl bg-slate-50 p-3 text-sm"><p className="font-bold">{employee.name}</p><p className="text-slate-600">{employee.role} · {employee.status}</p></div>)}</div>
        </article>}
        {activity.length > 0 && <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-bold text-ink">Recent activity</h2>
          <p className="mt-2 text-sm text-slate-600">Latest workspace actions from real saved events.</p>
          <div className="mt-4 space-y-2">{activity.slice(0, 5).map((item) => <div key={item.id} className="rounded-xl bg-slate-50 p-3 text-sm"><p className="font-bold">{item.action.replaceAll(".", " ")}</p><p className="text-slate-600">{new Date(item.created_at).toLocaleString()}</p></div>)}</div>
        </article>}
      </section>}
    </div>
  );
}

export function LeadFinderPage() {
  const { api, leads, setLeads, loading, error } = useSalesData();
  const [searchResults, setSearchResults] = useState<Lead[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [message, setMessage] = useState("");
  const [searchSteps, setSearchSteps] = useState<string[]>([]);
  const [searching, setSearching] = useState(false);
  const [manualBusy, setManualBusy] = useState(false);
  const { t } = useI18n();
  const visibleMessage = message;

  async function addManualLead(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const payload = {
      company: String(data.get("company") || "").trim(),
      website: String(data.get("website") || "").trim(),
      country: String(data.get("country") || "").trim(),
      city: String(data.get("city") || "").trim(),
      industry: String(data.get("industry") || "").trim(),
      contact: String(data.get("contact") || "").trim(),
      email: String(data.get("email") || "").trim(),
      phone: String(data.get("phone") || "").trim(),
      status: "New"
    };
    if (!payload.company) {
      setMessage("Add the company name before saving.");
      return;
    }
    setManualBusy(true);
    setHasSearched(false);
    setMessage("Saving company to CRM...");
    setSearchSteps(["Saving company to CRM..."]);
    try {
      const saved = await withTimeout(
        api<Lead>("/api/leads", { method: "POST", body: JSON.stringify(payload) }),
        30000,
        "Company save timed out. Please try again."
      );
      setLeads((items) => [saved, ...items.filter((item) => item.id !== saved.id)]);
      setSearchResults((items) => [saved, ...items.filter((item) => item.id !== saved.id)]);
      setMessage(`${saved.company} was saved to CRM. Next: complete sales research.`);
      setSearchSteps(["Saved to CRM", "Ready for company research"]);
      form.reset();
      trackEvent("manual_lead_created", {
        has_website: Boolean(saved.website || saved.domain),
        has_email: Boolean(saved.email),
        source: "manual"
      });
    } catch (err) {
      const reason = friendlyErrorMessage(err, "Company could not be saved. Check the details and try again.");
      setMessage(reason);
      setSearchSteps(["Save stopped"]);
      trackEvent("manual_lead_create_failed", { reason });
    } finally {
      setManualBusy(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const payload = {
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
    setSearching(true);
    setHasSearched(true);
    setSearchResults([]);
    setSearchSteps(["Connecting to lead sources..."]);
    setMessage("Searching companies...");
    trackEvent("lead_finder_search_started", {
      country: payload.country,
      city: payload.city,
      industry: payload.industry,
      company_size: payload.company_size,
      radius: payload.radius,
      source: "lead_search"
    });
    try {
      const found = await withTimeout(
        api<Lead[]>("/api/leads/find", {
          method: "POST",
          body: JSON.stringify(payload)
        }),
        45000,
        "Lead search timed out. Try a smaller radius or broader filters."
      );
      setSearchSteps((items) => [...items, `Found ${found.length} companies`, "Saved to CRM"]);
      setLeads(found);
      setSearchResults(found);
      setMessage(found.length ? `Found ${found.length} companies. Saved to CRM.` : "No results. Try a broader city, industry, radius, or fewer filters.");
      trackEvent(found.length ? "lead_finder_search_completed" : "lead_finder_search_empty", {
        country: payload.country,
        city: payload.city,
        industry: payload.industry,
        result_count: found.length,
        source: "lead_search"
      });
    } catch (err) {
      const reason = friendlyErrorMessage(err, "Lead search could not be completed.");
      setSearchResults([]);
      setSearchSteps((items) => [...items, "Search stopped"]);
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
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Lead Finder" title="Find real companies and turn each into a sales opportunity." copy="Search your target market, verify available contacts, and enrich each company with AI research. Missing data is shown clearly instead of invented." />
      <form aria-label="Lead search" onSubmit={submit} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-5 rounded-xl bg-teal-50 p-4">
          <p className="text-sm font-bold text-brand">Step 1 of 3 · Choose a focused market</p>
          <p className="mt-1 text-sm leading-6 text-slate-700">Use one country, one city and one industry. A narrower search creates better opportunities faster.</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="text-sm font-semibold text-slate-700">Country<input name="country" required placeholder="Germany" className="mt-2 min-h-11 w-full rounded-md border border-slate-300 px-3 text-sm" /></label>
          <label className="text-sm font-semibold text-slate-700">City<input name="city" required placeholder="Berlin" className="mt-2 min-h-11 w-full rounded-md border border-slate-300 px-3 text-sm" /></label>
          <label className="text-sm font-semibold text-slate-700">Industry<input name="industry" required placeholder="Construction" className="mt-2 min-h-11 w-full rounded-md border border-slate-300 px-3 text-sm" /></label>
          <label className="text-sm font-semibold text-slate-700">Company size<input name="company_size" placeholder="11-50" className="mt-2 min-h-11 w-full rounded-md border border-slate-300 px-3 text-sm" /></label>
          <label className="text-sm font-semibold text-slate-700">Number of leads<input name="limit" type="number" min="1" max="25" defaultValue="10" className="mt-2 min-h-11 w-full rounded-md border border-slate-300 px-3 text-sm" /></label>
        </div>
        <details className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <summary className="cursor-pointer text-sm font-bold text-ink">Advanced settings</summary>
          <p className="mt-2 text-sm text-slate-600">Use these only when the first search is too broad or too narrow.</p>
          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <label className="text-sm font-semibold text-slate-700">Business category<input name="category" placeholder="Construction company" className="mt-2 min-h-11 w-full rounded-md border border-slate-300 px-3 text-sm" /></label>
            <label className="text-sm font-semibold text-slate-700">Keyword<input name="keyword" placeholder="renovation, contractor" className="mt-2 min-h-11 w-full rounded-md border border-slate-300 px-3 text-sm" /></label>
            <label className="text-sm font-semibold text-slate-700">Extra keywords<input name="keywords" placeholder="commercial, builders" className="mt-2 min-h-11 w-full rounded-md border border-slate-300 px-3 text-sm" /></label>
            <label className="text-sm font-semibold text-slate-700">Technology<input name="technology" placeholder="WordPress, Shopify" className="mt-2 min-h-11 w-full rounded-md border border-slate-300 px-3 text-sm" /></label>
            <label className="text-sm font-semibold text-slate-700">Contact role<input name="contact_role" placeholder="Owner, Founder, CEO" className="mt-2 min-h-11 w-full rounded-md border border-slate-300 px-3 text-sm" /></label>
            <label className="text-sm font-semibold text-slate-700">Radius meters<input name="radius" type="number" defaultValue="10000" className="mt-2 min-h-11 w-full rounded-md border border-slate-300 px-3 text-sm" /></label>
          </div>
        </details>
        <div className="mt-5 flex flex-col gap-3 min-[430px]:flex-row min-[430px]:items-center">
          <PrimaryButton disabled={searching}>{searching ? <Loader2 className="animate-spin" size={17} /> : <Search size={17} />} {searching ? t("Searching") : t("Find leads")}</PrimaryButton>
          <p className="text-sm text-slate-600">Expected time: 30-60 seconds. Saved companies will stay after refresh.</p>
        </div>
        {visibleMessage && <p className="mt-4 rounded-xl bg-slate-50 p-3 text-sm font-semibold text-slate-700">{visibleMessage}</p>}
        {searchSteps.length > 0 && <ol className="mt-4 grid gap-2 text-sm sm:grid-cols-3" aria-label="Lead search progress">
          {searchSteps.map((step, index) => <li key={`${step}-${index}`} className="flex items-center gap-2 rounded-xl bg-teal-50 p-3 font-semibold text-brand"><CheckCircle2 size={16} />{step}</li>)}
        </ol>}
      </form>
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm font-bold uppercase text-brand">Fast fallback</p>
            <h2 className="mt-1 text-xl font-bold text-ink">Already know a company?</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">Add it once. OutreachAI saves it to CRM, keeps it after refresh, and lets you run research and outreach review from the same opportunity card.</p>
          </div>
          <span className="w-fit rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">Takes 20 seconds</span>
        </div>
        <form aria-label="Manual company entry" onSubmit={addManualLead} className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <label className="text-sm font-semibold text-slate-700">Company name<input name="company" required placeholder="Acme Construction" className="mt-2 min-h-11 w-full rounded-md border border-slate-300 px-3 text-sm" /></label>
          <label className="text-sm font-semibold text-slate-700">Website<input name="website" placeholder="https://company.com" className="mt-2 min-h-11 w-full rounded-md border border-slate-300 px-3 text-sm" /></label>
          <label className="text-sm font-semibold text-slate-700">Country<input name="country" placeholder="Germany" className="mt-2 min-h-11 w-full rounded-md border border-slate-300 px-3 text-sm" /></label>
          <label className="text-sm font-semibold text-slate-700">City<input name="city" placeholder="Berlin" className="mt-2 min-h-11 w-full rounded-md border border-slate-300 px-3 text-sm" /></label>
          <label className="text-sm font-semibold text-slate-700">Industry<input name="industry" placeholder="Construction" className="mt-2 min-h-11 w-full rounded-md border border-slate-300 px-3 text-sm" /></label>
          <label className="text-sm font-semibold text-slate-700">Decision maker<input name="contact" placeholder="Owner or founder" className="mt-2 min-h-11 w-full rounded-md border border-slate-300 px-3 text-sm" /></label>
          <label className="text-sm font-semibold text-slate-700">Email<input name="email" type="email" placeholder="name@company.com" className="mt-2 min-h-11 w-full rounded-md border border-slate-300 px-3 text-sm" /></label>
          <label className="text-sm font-semibold text-slate-700">Phone<input name="phone" placeholder="+49..." className="mt-2 min-h-11 w-full rounded-md border border-slate-300 px-3 text-sm" /></label>
          <div className="md:col-span-2 xl:col-span-4">
            <PrimaryButton disabled={manualBusy}>{manualBusy ? <Loader2 className="animate-spin" size={17} /> : <Plus size={17} />} Save company to CRM</PrimaryButton>
          </div>
        </form>
      </section>
      {loading && !hasSearched ? <EmptyState title="Loading leads" copy="Loading saved companies." /> : error && !hasSearched ? <EmptyState title="Lead data unavailable" copy={error} /> : (hasSearched ? searchResults : leads).length ? <div className="grid gap-5">{(hasSearched ? searchResults : leads).map((lead) => <OpportunityCard key={lead.id || lead.place_id || lead.company} lead={lead} api={api} onLeadUpdated={(updated) => {
        setLeads((items) => items.map((item) => item.id === updated.id ? updated : item));
        setSearchResults((items) => items.map((item) => item.id === updated.id ? updated : item));
      }} />)}</div> : <EmptyState title={hasSearched ? "No matching companies found" : "No real leads yet"} copy={hasSearched ? "No companies matched those filters. Broaden the city, category, or radius and search again." : "Run a lead search or add a company manually. No demo companies are shown."} />}
    </div>
  );
}

function leadFromCrmCompany(company: CrmCompany): Lead {
  return {
    id: company.lead_id || undefined,
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
  };
}

function CrmFilters({ filters, setFilters }: { filters: Record<string, string>; setFilters: (filters: { search: string; city: string; country: string; industry: string; stage: string; email_status: string; source: string }) => void }) {
  const update = (key: string, value: string) => setFilters({ search: "", city: "", country: "", industry: "", stage: "", email_status: "", source: "", ...filters, [key]: value });
  return <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
    <p className="text-sm font-bold text-ink">Search and filter CRM</p>
    <div className="mt-3 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
      <input value={filters.search} onChange={(event) => update("search", event.target.value)} placeholder="Company or website" className="min-h-11 rounded-md border border-slate-300 px-3 text-sm" />
      <input value={filters.city} onChange={(event) => update("city", event.target.value)} placeholder="City" className="min-h-11 rounded-md border border-slate-300 px-3 text-sm" />
      <input value={filters.country} onChange={(event) => update("country", event.target.value)} placeholder="Country" className="min-h-11 rounded-md border border-slate-300 px-3 text-sm" />
      <input value={filters.industry} onChange={(event) => update("industry", event.target.value)} placeholder="Industry" className="min-h-11 rounded-md border border-slate-300 px-3 text-sm" />
      <input value={filters.stage} onChange={(event) => update("stage", event.target.value)} placeholder="Stage" className="min-h-11 rounded-md border border-slate-300 px-3 text-sm" />
      <input value={filters.source} onChange={(event) => update("source", event.target.value)} placeholder="Data type" className="min-h-11 rounded-md border border-slate-300 px-3 text-sm" />
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

function fieldValue(value?: string | number | null) {
  if (value === undefined || value === null || value === "") return "Not available";
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
  return action.replaceAll(".", " ").replaceAll("_", " ");
}

function InfoCell({ label, value, help }: { label: string; value?: string | number | null; help: string }) {
  const missing = value === undefined || value === null || value === "";
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-xs font-bold uppercase text-slate-500">{label}</p>
      <p className={`mt-2 text-sm font-semibold ${missing ? "text-slate-500" : "text-ink"}`}>{fieldValue(value)}</p>
      {missing && <p className="mt-2 text-xs leading-5 text-slate-500">{help}</p>}
    </div>
  );
}

function WorkspaceSection({ id, title, copy, children }: { id: string; title: string; copy: string; children: ReactNode }) {
  return (
    <section id={id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4">
        <h3 className="text-lg font-bold text-ink">{title}</h3>
        <p className="mt-1 text-sm leading-6 text-slate-600">{copy}</p>
      </div>
      {children}
    </section>
  );
}

function CrmCompanyCard({ company, api }: { company: CrmCompany; api: ApiFn }) {
  const [current, setCurrent] = useState(company);
  const [stageValue, setStageValue] = useState(company.crm_stage);
  const [noteBody, setNoteBody] = useState("");
  const [actionBusy, setActionBusy] = useState("");
  const [actionNotice, setActionNotice] = useState("");
  const [actionError, setActionError] = useState("");
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
  const lifecycle = [
    ["Lead found", current.found_at, "Company was discovered and added to your workspace."],
    ["Saved to CRM", current.saved_to_crm_at || current.created_at, "The company is stored in your CRM."],
    ["Website analyzed", current.website_analyzed_at, "AI research created the company summary and sales angle."],
    ["Contact found", current.contact_found_at, "A decision maker or business contact was added."],
    ["Email generated", current.email_generated_at, "A personalized draft was prepared for review."],
    ["Email approved", current.email_approved_at, "A user approved the draft before sending."],
    ["Email sent", current.email_sent_at, "Approved outreach was sent."],
    ["Email opened", current.opened_at, "The prospect opened the message."],
    ["Reply received", current.replied_at, "A reply was captured in the workspace."],
    ["Stage changed", current.stage_changed_at, `Current stage is ${current.crm_stage}.`],
  ];

  async function moveStage(nextStage = stageValue) {
    setActionBusy("stage");
    setActionError("");
    setActionNotice("");
    try {
      const updated = await api<CrmCompany>(`/api/crm/companies/${current.id}/stage`, { method: "PATCH", body: JSON.stringify({ stage: nextStage }) });
      setCurrent(updated);
      setStageValue(updated.crm_stage);
      setActionNotice(`CRM stage moved to ${updated.crm_stage}.`);
    } catch (err) {
      setActionError(friendlyErrorMessage(err, "CRM stage could not be updated. Check your session and try again."));
    } finally {
      setActionBusy("");
    }
  }
  async function addNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = noteBody.trim();
    if (!body) {
      setActionError("Write a note before saving.");
      return;
    }
    setActionBusy("note");
    setActionError("");
    setActionNotice("");
    try {
      const note = await api<CrmCompany["notes"][number]>(`/api/crm/companies/${current.id}/notes`, { method: "POST", body: JSON.stringify({ body }) });
      setCurrent({ ...current, notes: [note, ...current.notes] });
      setNoteBody("");
      setActionNotice("Note saved to the activity history.");
    } catch (err) {
      setActionError(friendlyErrorMessage(err, "Note could not be saved. Check your session and try again."));
    } finally {
      setActionBusy("");
    }
  }
  return <article className="overflow-hidden rounded-3xl border border-slate-200 bg-slate-50 shadow-sm">
    <div className="border-b border-slate-200 bg-white p-5 sm:p-6">
      <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
        <div className="flex min-w-0 gap-4">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-ink text-xl font-black text-white shadow-sm">
            {current.name.slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full border px-3 py-1 text-xs font-bold ${stageTone(current.crm_stage)}`}>{current.crm_stage}</span>
              <span className="rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700">AI Health {healthScore}%</span>
            </div>
            <h2 className="mt-3 text-2xl font-black tracking-tight text-ink sm:text-3xl">{current.name}</h2>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm text-slate-600">
              <span className="inline-flex items-center gap-1.5"><Building2 size={16} />{fieldValue(current.industry)}</span>
              <span className="inline-flex items-center gap-1.5"><MapPin size={16} />{[current.city, current.country].filter(Boolean).join(", ") || "Not available"}</span>
              <span className="inline-flex items-center gap-1.5"><Globe2 size={16} />{current.website || current.domain ? <a className="break-all font-semibold text-brand hover:underline" href={current.website || `https://${current.domain}`} target="_blank" rel="noreferrer">{current.website || current.domain}</a> : "Not available"}</span>
            </div>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:w-[34rem]">
          <InfoCell label="Company size" value={companySize === "Not available" ? null : companySize} help="Add company size from lead discovery or manual research." />
          <InfoCell label="Assigned owner" value={owner === "Not assigned" ? null : owner} help="Assign an owner when a teammate takes responsibility." />
          <InfoCell label="Last activity" value={formatDateTime(current.last_activity_at || current.stage_changed_at || current.updated_at)} help="Activity appears after sales work is logged." />
          <div className="rounded-xl border border-teal-200 bg-teal-50 p-4">
            <p className="text-xs font-bold uppercase text-brand">Next recommended action</p>
            <p className="mt-2 text-sm font-semibold leading-6 text-ink">{nextAction}</p>
          </div>
        </div>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {progress.map(([label, done]) => <div key={label} className={`rounded-xl border p-3 text-sm ${done ? "border-teal-200 bg-teal-50 text-brand" : "border-slate-200 bg-slate-50 text-slate-500"}`}>
          <CheckCircle2 size={16} className={done ? "text-brand" : "text-slate-300"} />
          <p className="mt-2 font-bold">{label}</p>
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
            <InfoCell label="Map listing" value={current.place_id ? "Available" : null} help="Run lead discovery to connect the local business listing." />
            <InfoCell label="Technologies" value={null} help="Technology data appears after website research detects it." />
            <InfoCell label="Rating" value={current.google_rating ? `${current.google_rating}/5` : null} help="Rating appears when available from the business listing." />
            <InfoCell label="Data source" value={sourceLabel(current.source)} help="The source is shown as business-friendly verified data." />
          </div>
          <div className="mt-4 rounded-2xl bg-slate-50 p-4">
            <p className="text-sm font-bold text-ink">Company description</p>
            <p className="mt-2 text-sm leading-6 text-slate-700">{current.ai_summary || "Not available. Run company research to create a clear description before outreach."}</p>
          </div>
        </WorkspaceSection>

        <WorkspaceSection id={`insights-${current.id}`} title="AI Insights" copy="A sales-ready summary of why this company matters and what to do next.">
          <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
            <div className="rounded-2xl bg-teal-50 p-4">
              <p className="text-sm font-bold text-brand">AI summary</p>
              <p className="mt-2 text-sm leading-6 text-slate-800">{current.ai_summary || "Not available. Analyze the company website to generate the summary, pain points and sales angle."}</p>
              <p className="mt-4 text-sm font-bold text-ink">Why this company is interesting</p>
              <p className="mt-2 text-sm leading-6 text-slate-700">{current.sales_angle || current.outreach_strategy || "Not available. Complete sales research to identify the strongest outreach angle."}</p>
            </div>
            <div className="grid gap-3">
              <InfoCell label="Estimated opportunity" value={estimatedOpportunity === "Not available" ? null : estimatedOpportunity} help="Deal value appears after qualification." />
              <InfoCell label="Confidence score" value={`${healthScore}%`} help="Based on profile completeness, contacts, AI research and outreach state." />
              <InfoCell label="Recommended action" value={nextAction} help="The next safest step in the sales workflow." />
            </div>
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-sm font-bold text-ink">Buying signals</p>
              <div className="mt-3 space-y-2">{buyingSignals.length ? buyingSignals.map((signal) => <p key={signal} className="flex items-center gap-2 rounded-lg bg-teal-50 p-3 text-sm font-semibold text-brand"><ShieldCheck size={16} />{signal}</p>) : <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">Not available. Analyze the website and find contacts to reveal buying signals.</p>}</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-sm font-bold text-ink">Risks</p>
              <div className="mt-3 space-y-2">{risks.length ? risks.map((risk) => <p key={risk} className="flex items-center gap-2 rounded-lg bg-amber-50 p-3 text-sm font-semibold text-amber-800"><AlertTriangle size={16} />{risk}</p>) : <p className="rounded-lg bg-teal-50 p-3 text-sm font-semibold text-brand">No major missing steps detected for the current stage.</p>}</div>
            </div>
          </div>
        </WorkspaceSection>

        <WorkspaceSection id={`contacts-${current.id}`} title="Contact Center" copy="Decision makers, verified contact details and confidence in one place.">
          {current.contacts.length ? <div className="grid gap-3 lg:grid-cols-2">
            {current.contacts.map((contact) => <article key={contact.id} className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h4 className="font-bold text-ink">{contact.name || "Not available"}</h4>
                  <p className="mt-1 text-sm text-slate-600">{contact.title || "Role not available"}</p>
                </div>
                <span className="rounded-full bg-teal-50 px-3 py-1 text-xs font-bold text-brand">{contact.confidence || "Not available"} confidence</span>
              </div>
              <div className="mt-4 grid gap-2 text-sm">
                <p className="flex items-center gap-2 text-slate-700"><Mail size={16} />{contact.email || "Not available"}</p>
                <p className="flex items-center gap-2 text-slate-700"><Phone size={16} />{contact.phone || "Not available"}</p>
                <p className="flex items-center gap-2 text-slate-700"><ExternalLink size={16} />{contact.linkedin || "Not available"}</p>
                <p className="text-xs font-bold uppercase text-slate-500">Data: {sourceLabel(contact.source)}</p>
              </div>
            </article>)}
          </div> : <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5">
            <p className="font-bold text-ink">No decision makers yet.</p>
            <p className="mt-2 text-sm leading-6 text-slate-600">Use the outreach research action to find or add a verified contact. Emails are never invented.</p>
          </div>}
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <a href={`#outreach-${current.id}`} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-ink px-4 text-sm font-bold text-white"><UserRoundSearch size={17} /> Review outreach workflow</a>
            <a href={`#notes-${current.id}`} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-bold text-ink"><Plus size={17} /> Add contact note</a>
          </div>
        </WorkspaceSection>

        <WorkspaceSection id={`outreach-${current.id}`} title="Outreach Center" copy="Every email moves through review before anything is sent. The timeline below shows the exact state.">
          <div className="grid gap-2 sm:grid-cols-4 xl:grid-cols-8">
            {outreachSteps.map(([label, done]) => <div key={label} className={`rounded-xl border p-3 text-sm font-bold ${outreachTone(Boolean(done), label)}`}>
              <CheckCircle2 size={16} className={done ? "" : "text-slate-300"} />
              <p className="mt-2">{label}</p>
            </div>)}
          </div>
          <div className="mt-5">
            {current.lead_id ? <OpportunityCard lead={lead} api={api} /> : <p className="rounded-xl bg-amber-50 p-4 text-sm font-semibold text-amber-800">Reconnect this company to a lead before generating outreach.</p>}
          </div>
        </WorkspaceSection>

        <WorkspaceSection id={`timeline-${current.id}`} title="CRM Timeline" copy="A complete audit trail of what happened, when it happened and what needs attention.">
          <div className="space-y-3">
            {lifecycle.map(([label, value, description]) => <div key={label} className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-[2rem_10rem_1fr]">
              <div className={`flex h-8 w-8 items-center justify-center rounded-full ${value ? "bg-teal-50 text-brand" : "bg-slate-100 text-slate-400"}`}><Clock3 size={16} /></div>
              <div>
                <p className="font-bold text-ink">{label}</p>
                <p className="mt-1 text-xs text-slate-500">{formatDateTime(value)}</p>
              </div>
              <p className="text-sm leading-6 text-slate-600">{description}</p>
            </div>)}
            {current.activity.slice(0, 4).map((item) => <div key={item.id} className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-[2rem_10rem_1fr]">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-50 text-blue-700"><FileText size={16} /></div>
              <div>
                <p className="font-bold text-ink">{activityLabel(item.action)}</p>
                <p className="mt-1 text-xs text-slate-500">{new Date(item.created_at).toLocaleString()}</p>
              </div>
              <p className="text-sm leading-6 text-slate-600">Workspace activity was recorded for this company.</p>
            </div>)}
          </div>
        </WorkspaceSection>
      </div>

      <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-sm font-bold text-ink">Quick Actions</p>
          <p className="mt-1 text-xs leading-5 text-slate-500">Important actions stay within reach. Nothing is sent without approval.</p>
          <div className="mt-4 grid gap-2">
            <a href={`#outreach-${current.id}`} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-brand px-4 text-sm font-bold text-white"><Sparkles size={17} /> Review AI research</a>
            <a href={`#contacts-${current.id}`} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-bold text-ink"><UserRoundSearch size={17} /> Review contacts</a>
            <a href={`#outreach-${current.id}`} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-bold text-ink"><Mail size={17} /> Review email draft</a>
            <a href={`#outreach-${current.id}`} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-bold text-ink"><Send size={17} /> Review approval path</a>
            <button type="button" onClick={() => moveStage("Meeting Scheduled")} disabled={actionBusy === "stage" || current.crm_stage === "Meeting Scheduled"} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-bold text-ink disabled:cursor-not-allowed disabled:opacity-60">{actionBusy === "stage" ? <Loader2 className="animate-spin" size={17} /> : <CalendarDays size={17} />} Book meeting</button>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-sm font-bold text-ink">Move stage</p>
          <p className="mt-1 text-xs leading-5 text-slate-500">Update the pipeline when the sales situation changes.</p>
          <div className="mt-3 grid gap-2">
            <select value={stageValue} onChange={(event) => setStageValue(event.target.value)} className="min-h-11 rounded-md border border-slate-300 bg-white px-3 text-sm">
              {crmStages.map((stage) => <option key={stage} value={stage}>{stage}</option>)}
            </select>
            <button type="button" onClick={() => moveStage()} disabled={actionBusy === "stage" || stageValue === current.crm_stage} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-ink px-4 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-60">{actionBusy === "stage" && <Loader2 className="animate-spin" size={16} />} Move stage</button>
          </div>
        </section>

        <section id={`notes-${current.id}`} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-sm font-bold text-ink">Notes</p>
          <p className="mt-1 text-xs leading-5 text-slate-500">Use short notes, checklists, mentions or attachment links. Rich formatting can be pasted into the note.</p>
          <form onSubmit={addNote} className="mt-3 space-y-2">
            <label className="sr-only" htmlFor={`note-${current.id}`}>Add note</label>
            <textarea id={`note-${current.id}`} value={noteBody} onChange={(event) => setNoteBody(event.target.value)} placeholder="Example: @Alex follow up next Tuesday&#10;- [ ] Send pricing&#10;- [ ] Confirm meeting time" className="min-h-28 w-full rounded-md border border-slate-300 bg-white p-3 text-sm" />
            <button type="submit" disabled={actionBusy === "note" || !noteBody.trim()} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-bold text-ink disabled:cursor-not-allowed disabled:opacity-60">{actionBusy === "note" && <Loader2 className="animate-spin" size={16} />} Add note</button>
          </form>
          <div className="mt-4 space-y-2">
            {current.notes.length ? current.notes.slice(0, 5).map((note) => <div key={note.id} className="rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
              <p className="whitespace-pre-line">{note.body}</p>
              <p className="mt-2 text-xs text-slate-500">{formatDateTime(note.created_at)}</p>
            </div>) : <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600">No notes yet. Add the next customer conversation or internal follow-up.</p>}
          </div>
        </section>

        {actionNotice && <p role="status" className="rounded-2xl bg-teal-50 p-4 text-sm font-semibold text-brand">{actionNotice}</p>}
        {actionError && <p role="alert" className="rounded-2xl bg-red-50 p-4 text-sm font-semibold text-red-700">{actionError}</p>}
      </aside>
    </div>
  </article>;
}

export function CompaniesPage() {
  const { api, companies, loading, error, filters, setFilters } = useCrmData();
  return <div className="space-y-6"><PageHeader eyebrow="Companies" title="Every company is saved in your CRM." copy="Companies found by lead search, contact verification, or manual entry stay here after refresh." /> <CrmFilters filters={filters} setFilters={setFilters} />{loading ? <EmptyState title="Loading CRM companies" copy="Loading saved companies." /> : error ? <EmptyState title="Companies unavailable" copy={error} /> : companies.length ? <div className="grid gap-5">{companies.map((company) => <CrmCompanyCard key={company.id} company={company} api={api} />)}</div> : <EmptyState title="No companies saved yet" copy="Run Lead Finder or add a manual company. OutreachAI will save real companies here, not demo data." action={<Link href="/dashboard/leads" className="inline-flex min-h-11 items-center rounded-md bg-brand px-4 text-sm font-bold text-white">Find companies</Link>} />}</div>;
}

export function WebsiteAnalyzerPage() {
  const { api } = useTokenApi();
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setLoading(true);
    setError("");
    try {
      setAnalysis(await api<AnalysisResult>("/api/ai/analyze", { method: "POST", body: JSON.stringify({ website: String(data.get("website") || ""), company: String(data.get("company") || ""), niche: String(data.get("niche") || "") }) }));
    } catch (err) {
      setError(friendlyErrorMessage(err, "Website analysis could not be completed. Check the website and try again."));
    } finally {
      setLoading(false);
    }
  }
  return <div className="space-y-6"><PageHeader eyebrow="Website Analyzer" title="Analyze a real prospect website." copy="OutreachAI reads the website and extracts ICP, pain points, offer and outreach strategy." /><form onSubmit={submit} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="grid gap-4 md:grid-cols-3"><input required name="website" placeholder="https://company.com" className="min-h-11 rounded-md border border-slate-300 px-3" /><input name="company" placeholder="Company name" className="min-h-11 rounded-md border border-slate-300 px-3" /><input name="niche" placeholder="Industry or niche" className="min-h-11 rounded-md border border-slate-300 px-3" /></div><div className="mt-4"><PrimaryButton disabled={loading}>{loading ? <Loader2 className="animate-spin" size={17} /> : <Sparkles size={17} />} Analyze website</PrimaryButton></div>{error && <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p>}</form>{analysis ? <section className="grid gap-4 lg:grid-cols-2">{[["Business summary", analysis.company_summary || analysis.summary], ["Services", analysis.services.join(", ") || unavailable], ["Target customers", analysis.niche || unavailable], ["Weak points", analysis.weaknesses.join(", ") || unavailable], ["Possible outreach angle", analysis.sales_angle || unavailable], ["Suggested offer", analysis.suggested_offer || unavailable], ["Personalization facts", analysis.strengths.join(", ") || unavailable], ["Recommended cold email", analysis.outreach_strategy || unavailable]].map(([label, value]) => <article key={label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="font-bold text-ink">{label}</h2><p className="mt-2 text-sm leading-6 text-slate-600">{value}</p></article>)}</section> : <EmptyState title="No website analyzed yet" copy="Enter a real domain. OutreachAI will not show sample analysis." />}</div>;
}

export function ContactsPage() {
  const { contacts, loading, error, filters, setFilters } = useCrmData();
  return <div className="space-y-6"><PageHeader eyebrow="Contacts" title="Decision makers and verified emails." copy="Contacts come from verified contact discovery, local business data, or manual lead import. Missing emails are not invented." /><CrmFilters filters={filters} setFilters={setFilters} />{loading ? <EmptyState title="Loading contacts" copy="Checking saved CRM contacts." /> : error ? <EmptyState title="Contacts unavailable" copy={error} /> : contacts.length ? <section className="grid gap-4 lg:grid-cols-3">{contacts.map((contact) => <article key={contact.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="font-bold text-ink">{contact.name || "Decision maker unavailable"}</h2><p className="mt-1 text-sm text-slate-600">{contact.title || "Role unavailable"} · {contact.company}</p><p className="mt-4 rounded-xl bg-slate-50 p-3 text-sm font-semibold">{contact.email || "No verified email available"}</p><p className="mt-3 text-sm text-slate-600">{contact.email_status} · {sourceLabel(contact.source)}</p></article>)}</section> : <EmptyState title="No decision makers yet" copy="Find contacts or add one manually. OutreachAI will not create fake contacts." />}</div>;
}

export function CampaignsPage() {
  const { api, campaigns, leads, loading, error, refresh } = useSalesData();
  const [notice, setNotice] = useState("");
  const [actionBusy, setActionBusy] = useState("");

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
      if (lead?.id) {
        await api<Lead>(`/api/leads/${lead.id}`, { method: "PATCH", body: JSON.stringify({ campaign_id: campaign.id, status: "Qualified" }) });
      }
      setNotice("Campaign created. Your first opportunity was added for review; no email was sent.");
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
          <p className="text-sm font-bold uppercase text-brand">Next step</p>
          <h2 className="mt-1 text-xl font-bold text-ink">Create a campaign from saved leads</h2>
          <p className="mt-2 text-sm text-slate-600">Expected time: 1 minute. You can review every email before anything is sent.</p>
        </div>
        <span className="w-fit rounded-full bg-teal-50 px-3 py-1 text-xs font-bold text-brand">Review before send</span>
      </div>
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <label className="text-sm font-semibold text-slate-700">Campaign name<input name="name" required placeholder={`${leads[0]?.industry || "Outbound"} campaign`} className="mt-2 min-h-11 w-full rounded-md border border-slate-300 px-3 text-sm" /></label>
        <label className="text-sm font-semibold text-slate-700">Industry<input name="industry" defaultValue={leads[0]?.industry || ""} className="mt-2 min-h-11 w-full rounded-md border border-slate-300 px-3 text-sm" /></label>
        <label className="text-sm font-semibold text-slate-700">Country<input name="country" defaultValue={leads[0]?.country || ""} className="mt-2 min-h-11 w-full rounded-md border border-slate-300 px-3 text-sm" /></label>
        <label className="text-sm font-semibold text-slate-700">City<input name="city" defaultValue={leads[0]?.city || ""} className="mt-2 min-h-11 w-full rounded-md border border-slate-300 px-3 text-sm" /></label>
        <label className="text-sm font-semibold text-slate-700 md:col-span-2">Offer<textarea name="offer" defaultValue={leads[0]?.suggested_offer || ""} placeholder="What should the email offer?" className="mt-2 min-h-24 w-full rounded-md border border-slate-300 p-3 text-sm" /></label>
        <label className="text-sm font-semibold text-slate-700">CTA<input name="cta" placeholder="Open to a quick review?" className="mt-2 min-h-11 w-full rounded-md border border-slate-300 px-3 text-sm" /></label>
        <label className="text-sm font-semibold text-slate-700">Signature<input name="signature" placeholder="Your name" className="mt-2 min-h-11 w-full rounded-md border border-slate-300 px-3 text-sm" /></label>
      </div>
      <div className="mt-5"><PrimaryButton disabled={actionBusy === "create"}>{actionBusy === "create" ? <Loader2 className="animate-spin" size={17} /> : <Plus size={17} />} Create campaign</PrimaryButton></div>
    </form>}
    {loading ? <EmptyState title="Loading campaigns" copy="Reading saved campaigns." /> : error ? <EmptyState title="Campaign data unavailable" copy={error} /> : campaigns.length ? <section className="grid gap-4 lg:grid-cols-2">{campaigns.map((campaign) => <article key={campaign.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="font-bold text-ink">{campaign.name}</h2><p className="mt-2 text-sm text-slate-600">{campaign.leads} leads · {campaign.sent} sent · {campaign.replies} replies · {campaign.status}</p><div className="mt-4 space-y-3">{campaign.sequence.length ? campaign.sequence.map((step) => <div key={step.step_order} className="rounded-xl bg-slate-50 p-3"><p className="font-bold">{step.name || `Email ${step.step_order}`}</p><p className="mt-1 text-sm text-slate-600">{step.subject || "Subject unavailable until AI draft is reviewed"}</p><p className="mt-1 text-xs font-semibold text-slate-500">Delay: {step.delay_days} days</p></div>) : <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600">No sequence saved yet.</p>}</div><p className="mt-4 rounded-xl bg-teal-50 p-3 text-sm font-bold text-brand">Review before send: enabled</p><div className="mt-4 grid gap-2 min-[430px]:grid-cols-2"><SecondaryButton onClick={() => campaignAction(campaign.id, "pause")} disabled={actionBusy === `${campaign.id}:pause`}><Pause size={17} /> Pause</SecondaryButton><PrimaryButton onClick={() => campaignAction(campaign.id, campaign.status === "Paused" ? "resume" : "launch")} disabled={actionBusy === `${campaign.id}:launch` || actionBusy === `${campaign.id}:resume`}>{actionBusy.startsWith(campaign.id) ? <Loader2 className="animate-spin" size={17} /> : <Play size={17} />} {campaign.status === "Paused" ? "Resume" : "Launch after approval"}</PrimaryButton></div></article>)}</section> : <EmptyState title="No campaigns yet" copy={leads.length ? "Create a campaign from selected opportunities before sending." : "Find leads first, then create a campaign. No sample campaigns are shown."} action={leads.length ? undefined : <Link href="/dashboard/leads" className="inline-flex min-h-11 items-center rounded-md bg-brand px-4 text-sm font-bold text-white">Find leads</Link>} />}
  </div>;
}

export function InboxPage() {
  return <div className="space-y-6"><PageHeader eyebrow="Inbox" title="Replies will appear here when campaigns receive real responses." copy="AI classification is available after reply events exist in the workspace." /><EmptyState title="No real replies yet" copy="OutreachAI will classify replies as Interested, Not interested, Later, Asked for pricing, Wants a call or Wrong person after replies are received." /></div>;
}

export function CrmPipelinePage() {
  const { pipeline, loading, error } = useCrmData();
  return <div className="space-y-6"><PageHeader eyebrow="CRM Pipeline" title="Move real leads from research to revenue." copy="Pipeline stages update from saved companies, AI research, email drafts and customer replies." action={<Link href="/dashboard/companies" className="inline-flex min-h-11 items-center justify-center rounded-md bg-ink px-4 text-sm font-bold text-white">Review companies</Link>} />{loading ? <EmptyState title="Loading pipeline" copy="Reading CRM stages." /> : error ? <EmptyState title="Pipeline unavailable" copy={error} /> : <section className="grid gap-4 xl:grid-cols-3 2xl:grid-cols-4">{pipeline.stages.map((stage) => { const items = pipeline.companies.filter((company) => company.crm_stage === stage); return <article key={stage} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-center justify-between gap-3"><h2 className="font-bold text-ink">{stage}</h2><span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-600">{items.length}</span></div><div className="mt-4 space-y-3">{items.length ? items.map((company) => <div key={company.id} className="rounded-xl bg-slate-50 p-3 text-sm"><p className="font-semibold text-slate-800">{company.name}</p><p className="mt-1 text-slate-600">{company.email_status} · {sourceLabel(company.source)}</p><p className="mt-2 text-xs font-semibold text-brand">{companyNextAction(company)}</p></div>) : <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-500">No companies in this stage. Move a company here when the sales situation changes.</p>}</div></article>; })}</section>}</div>;
}

export function DealsPage() {
  const { deals, loading, error, filters, setFilters } = useCrmData();
  return <div className="space-y-6"><PageHeader eyebrow="Deals" title="Revenue opportunities from saved companies." copy="Every saved company gets a CRM deal so you can track the next step toward a meeting or customer." /><CrmFilters filters={filters} setFilters={setFilters} />{loading ? <EmptyState title="Loading deals" copy="Reading CRM opportunities." /> : error ? <EmptyState title="Deals unavailable" copy={error} /> : deals.length ? <section className="grid gap-4 lg:grid-cols-3">{deals.map((deal) => <article key={deal.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-xs font-bold uppercase text-brand">{deal.stage}</p><h2 className="mt-2 font-bold text-ink">{deal.name}</h2><p className="mt-1 text-sm text-slate-600">{deal.company}</p><div className="mt-4 grid grid-cols-2 gap-2 text-sm"><p className="rounded-xl bg-slate-50 p-3"><span className="font-bold">Value</span><br />€{Math.round(deal.value || 0).toLocaleString()}</p><p className="rounded-xl bg-slate-50 p-3"><span className="font-bold">Probability</span><br />{deal.probability}%</p></div><p className="mt-4 rounded-xl bg-teal-50 p-3 text-sm font-semibold text-brand">{deal.next_step || "Review the company and prepare outreach."}</p></article>)}</section> : <EmptyState title="No deals yet" copy="Saved companies automatically create CRM deals. Start with Lead Finder to build your first opportunity list." action={<Link href="/dashboard/leads" className="inline-flex min-h-11 items-center rounded-md bg-brand px-4 text-sm font-bold text-white">Find companies</Link>} />}</div>;
}

export function AnalyticsPage() {
  const { metrics, loading, error } = useSalesData();
  const cards = [["Leads found", metrics.leads], ["Websites analyzed", metrics.funnel?.find((item) => item.status === "analyzed")?.count || 0], ["Emails generated", metrics.emails_sent + metrics.delivered], ["Emails sent", metrics.emails_sent], ["Open rate", `${metrics.open_rate || 0}%`], ["Reply rate", `${metrics.reply_rate || 0}%`], ["Meetings booked", metrics.meetings], ["Clients won", metrics.conversion_rate ? `${metrics.conversion_rate}% conversion` : "0"], ["Estimated revenue", `€${Math.round(metrics.revenue_forecast || metrics.revenue || 0).toLocaleString()}`]];
  return <div className="space-y-6"><PageHeader eyebrow="Analytics" title="Measure real outbound performance." copy="Metrics come from saved campaigns, email events and subscription activity." />{loading ? <EmptyState title="Loading analytics" copy="Reading real workspace metrics." /> : error ? <EmptyState title="Analytics unavailable" copy={error} /> : <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{cards.map(([label, value]) => <MetricCard key={String(label)} label={String(label)} value={String(value)} help="Real workspace metric" />)}</section>}</div>;
}

export function SettingsPage() {
  const readiness = [
    ["Company setup", "Tell OutreachAI what you sell so lead research and emails match your offer.", "Complete this before your first campaign."],
    ["Lead readiness", "Find or add companies, then save each valid opportunity into CRM.", "Missing data is shown clearly instead of guessed."],
    ["Outreach safety", "Every email stays in review until a person approves the send.", "Nothing external happens automatically."],
    ["Plan and limits", "Your plan controls how many leads, emails and workspaces can be used this month.", "Upgrade only when you hit a real limit."]
  ];
  return <div className="space-y-6"><PageHeader eyebrow="Settings" title="Make the workspace ready for your first campaign." copy="Keep setup simple: confirm your company, find leads, review AI work, then approve outreach." action={<Link href="/dashboard/leads" className="inline-flex min-h-11 items-center justify-center rounded-md bg-brand px-4 text-sm font-bold text-white">Find leads</Link>} /><section className="grid gap-4 lg:grid-cols-2">{readiness.map(([title, copy, status]) => <article key={title} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="font-bold text-ink">{title}</h2><p className="mt-2 text-sm leading-6 text-slate-600">{copy}</p><p className="mt-4 rounded-xl bg-slate-50 p-3 text-sm font-semibold text-slate-700">{status}</p></article>)}</section><details className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><summary className="cursor-pointer text-sm font-bold text-ink">Advanced settings</summary><p className="mt-3 text-sm leading-6 text-slate-600">Use this area only when a workspace owner needs to adjust billing, security, team access or sending preferences. New users can start from Lead Finder instead.</p><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{["Billing", "Security", "Team access", "Sending preferences"].map((item) => <Link key={item} href={item === "Billing" ? "/dashboard/billing" : "/dashboard/settings"} className="inline-flex min-h-11 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-bold text-ink">{item}</Link>)}</div></details></div>;
}

export function BillingPage() {
  const { metrics, loading, error } = useSalesData();
  return <div className="space-y-6"><PageHeader eyebrow="Billing" title="Subscription and usage." copy="Plan, usage and limits come from billing state. No fake usage is displayed." action={<Link href="/pricing" className="inline-flex min-h-11 items-center justify-center rounded-md bg-ink px-4 text-sm font-bold text-white">Manage plan</Link>} />{loading ? <EmptyState title="Loading billing" copy="Reading subscription usage." /> : error ? <EmptyState title="Billing unavailable" copy={error} /> : <section className="grid gap-4 lg:grid-cols-4"><MetricCard label="Current plan" value={metrics.plan || "Unavailable"} help="From billing status" /><MetricCard label="Leads" value={String((metrics.usage?.leads as number | undefined) || metrics.leads || 0)} help="Current period usage" /><MetricCard label="Emails sent" value={String(metrics.emails_sent)} help="Approved sends" /><MetricCard label="MRR" value={`€${Math.round(metrics.mrr || 0).toLocaleString()}`} help="Subscription revenue" /></section>}</div>;
}

export function AiEmployeesPage() {
  const { leads, api, loading, error } = useSalesData();
  return <div className="space-y-6"><PageHeader eyebrow="AI Sales Employee" title="One click should replace hours of manual sales research." copy="The AI employee uses real source data only. Missing fields stay visible as unavailable until verified information is available." action={<Link href="/dashboard/leads" className="inline-flex min-h-11 items-center justify-center rounded-md bg-brand px-4 text-sm font-bold text-white">Find or research leads</Link>} />{loading ? <EmptyState title="Loading AI work" copy="Reading saved leads." /> : error ? <EmptyState title="AI employee unavailable" copy={error} /> : leads.length ? <div className="grid gap-5">{leads.slice(0, 3).map((lead) => <OpportunityCard key={lead.id || lead.company} lead={lead} api={api} />)}</div> : <EmptyState title="No AI work yet" copy="Find or add real companies first. The AI employee will not show invented results." />}</div>;
}
