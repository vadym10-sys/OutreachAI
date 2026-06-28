"use client";

import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import * as Sentry from "@sentry/nextjs";
import { ArrowRight, BarChart3, CheckCircle2, Clock3, Download, Globe2, Inbox, Loader2, Mail, Pause, Play, Plus, Search, Send, Sparkles, UserRoundSearch } from "lucide-react";
import { clientApi, friendlyErrorMessage, splitList } from "@/lib/client-api";
import { hasClerkPublishableKey, isClerkE2EBypass } from "@/lib/env";
import { trackEvent } from "@/lib/posthog";
import type { Activity, AISalesEmployee, Campaign, DashboardMetrics, Email, FollowUpSequence, Lead, SalesCopilot, WebsiteAudit } from "@/lib/types";

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

const unavailable = "Unavailable until provider data is collected.";

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
    verifiedEmail: lead.email ? `${lead.email}${lead.hunter_verified ? " · verified by Hunter" : ""}` : lead.hunter_status === "no_verified_email" ? "No verified email found by Hunter." : unavailable,
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
      const [leadPage, campaignList, dashboard] = await Promise.all([
        api<PaginatedLeads>("/api/leads?page_size=100"),
        api<Campaign[]>("/api/campaigns"),
        api<DashboardMetrics>("/api/dashboard")
      ]);
      setLeads(leadPage.items || []);
      setCampaigns(campaignList || []);
      setMetrics({ ...emptyMetrics, ...dashboard });
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
            console.error("Dashboard supporting data could not be loaded", result.reason);
            Sentry.captureException(result.reason, {
              tags: { area: "dashboard-supporting-data" },
              extra: { endpoint_group: "leads-campaigns-employees-activity" }
            });
          });
          setSupportingError("Some dashboard details are temporarily unavailable. Core workspace metrics are loaded.");
        }
      } catch (err) {
        console.error("Dashboard metrics could not be loaded", err);
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
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const profile = leadProfile(lead);
  const coverage = opportunityCoverage(lead, copilot, draft, followUps, audit);
  const completed = coverage.filter(([, done]) => done).length;
  const priority = priorityScore(copilot);
  const visibleStatus = draft ? "" : status;

  async function completeResearch() {
    if (!lead.id) {
      setError("Save this lead before running AI research.");
      return;
    }
    setBusy(true);
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
      setDraft(await api<Email>(`/api/leads/${lead.id}/draft-email`, { method: "POST" }));
      setStatus("Complete sales opportunity is ready for review. No email was sent.");
      trackEvent("sales_research_completed", {
        lead_id: lead.id,
        company: lead.company,
        has_verified_email: Boolean(lead.email && lead.hunter_verified)
      });
    } catch (err) {
      const reason = friendlyErrorMessage(err, "Research could not be completed. Check subscription, OpenAI, Hunter, website access, or provider limits.");
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
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">Source: {profile.source}</span>
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

      <div className="mt-5 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {coverage.map(([label, done]) => <span key={label} className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold ${done ? "bg-teal-50 text-brand" : "bg-slate-100 text-slate-500"}`}><CheckCircle2 size={15} />{label}</span>)}
      </div>

      {draft && <section className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
        <p className="text-xs font-bold uppercase text-slate-500">Personalized first email</p>
        <p className="mt-2 rounded-lg bg-teal-50 p-3 text-sm font-semibold text-brand">Complete sales opportunity is ready for review. No email was sent.</p>
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
        <SecondaryButton disabled={!draft}><Send size={17} /> Approve later</SecondaryButton>
      </div>
    </article>
  );
}

export function DashboardHome() {
  const { metrics, leads, campaigns, employees, activity, loading, error, supportingError } = useDashboardData();
  if (loading) return <EmptyState title="Loading your sales workspace" copy="Collecting real leads, campaigns and metrics from your workspace." />;
  if (error) return <EmptyState title="Workspace data unavailable" copy={error} />;
  const nextLead = leads[0];
  const hasAnyData = metrics.leads > 0 || metrics.campaigns > 0 || metrics.emails_sent > 0 || metrics.replies > 0 || metrics.meetings > 0 || leads.length > 0 || campaigns.length > 0 || employees.length > 0 || activity.length > 0;
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Today" title="What should I do now?" copy="Turn the next real company in your workspace into a complete sales opportunity." action={<Link href="/dashboard/leads" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-brand px-4 text-sm font-bold text-white">Find leads <ArrowRight size={17} /></Link>} />
      {supportingError && <p role="status" className="rounded-2xl border border-orange-200 bg-orange-50 p-4 text-sm font-semibold text-orange-700">{supportingError}</p>}
      {nextLead ? <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"><h2 className="text-2xl font-bold text-ink">Complete research for {nextLead.company}</h2><p className="mt-3 text-sm leading-6 text-slate-600">One click can analyze the website, score the opportunity, prepare the first email and create follow-ups. If a provider cannot supply a field, OutreachAI will say why.</p><Link href="/dashboard/companies" className="mt-5 inline-flex min-h-11 items-center justify-center rounded-md bg-ink px-4 text-sm font-bold text-white">Review opportunities</Link></section> : <EmptyState title="No real companies yet" copy="Add or search for companies in Lead Finder. OutreachAI will not show fake pipeline data." action={<Link href="/dashboard/leads" className="inline-flex min-h-11 items-center justify-center rounded-md bg-brand px-4 text-sm font-bold text-white">Find real leads</Link>} />}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Leads found" value={String(metrics.leads || leads.length)} help="Real workspace leads" />
        <MetricCard label="Campaigns" value={String(metrics.campaigns || campaigns.length)} help="Saved campaigns" />
        <MetricCard label="Emails sent" value={String(metrics.emails_sent)} help="Approved sends only" />
        <MetricCard label="Reply rate" value={`${metrics.reply_rate || 0}%`} help="From tracked replies" />
      </section>
      {!hasAnyData && <section className="grid gap-4 md:grid-cols-2">
        <EmptyState title="No leads yet — Find your first companies." copy="Start in Lead Finder with one country and one industry. Saved companies will appear here." action={<Link href="/dashboard/leads" className="inline-flex min-h-11 items-center justify-center rounded-md bg-brand px-4 text-sm font-bold text-white">Find companies</Link>} />
        <EmptyState title="No campaigns yet — Create your first campaign." copy="After leads exist, OutreachAI can prepare outreach drafts for your review." action={<Link href="/dashboard/campaigns" className="inline-flex min-h-11 items-center justify-center rounded-md border border-slate-300 px-4 text-sm font-bold text-ink">Create campaign</Link>} />
        <EmptyState title="No meetings yet." copy="Meetings appear after replies are tracked and marked as booked in the CRM pipeline." action={<Link href="/dashboard/crm" className="inline-flex min-h-11 items-center justify-center rounded-md border border-slate-300 px-4 text-sm font-bold text-ink">Open CRM</Link>} />
        <EmptyState title="No AI work yet." copy="Ask the AI Sales Employee to analyze a saved company or prepare outreach." action={<Link href="/dashboard/sales-employees" className="inline-flex min-h-11 items-center justify-center rounded-md border border-slate-300 px-4 text-sm font-bold text-ink">Open AI Employee</Link>} />
      </section>}
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
  const [searching, setSearching] = useState(false);
  const visibleMessage = message.includes("real companies saved") || message.startsWith("No companies found") || (!searching && message === "Connecting to Google Maps...") ? "" : message;
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
      limit: 10
    };
    setSearching(true);
    setHasSearched(true);
    setSearchResults([]);
    setMessage("Connecting to Google Maps...");
    trackEvent("lead_finder_search_started", {
      country: payload.country,
      city: payload.city,
      industry: payload.industry,
      company_size: payload.company_size,
      radius: payload.radius,
      source: "google_maps"
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
      setLeads(found);
      setSearchResults(found);
      setMessage(found.length ? `${found.length} real companies saved from Google Maps.` : "No companies found. Broaden filters or add a company manually.");
      trackEvent(found.length ? "lead_finder_search_completed" : "lead_finder_search_empty", {
        country: payload.country,
        city: payload.city,
        industry: payload.industry,
        result_count: found.length,
        source: "google_maps"
      });
    } catch (err) {
      const reason = friendlyErrorMessage(err, "Google Maps lead search could not be completed.");
      setSearchResults([]);
      setMessage(reason);
      trackEvent("lead_finder_search_failed", {
        country: payload.country,
        city: payload.city,
        industry: payload.industry,
        source: "google_maps",
        reason
      });
    } finally {
      setSearching(false);
    }
  }
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Lead Finder" title="Find real companies and turn each into a sales opportunity." copy="Search runs through Google Maps, then Hunter and AI enrich what is available. Missing provider data is shown clearly instead of invented." />
      <form onSubmit={submit} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {["country", "city", "industry", "category", "keyword", "company_size", "keywords", "technology", "contact_role", "radius"].map((name) => <label key={name} className="text-sm font-semibold capitalize text-slate-700">{name.replace("_", " ")}<input name={name} type={name === "radius" ? "number" : "text"} defaultValue={name === "radius" ? "10000" : undefined} className="mt-2 min-h-11 w-full rounded-md border border-slate-300 px-3 text-sm" /></label>)}
        </div>
        <PrimaryButton disabled={searching}>{searching ? <Loader2 className="animate-spin" size={17} /> : <Search size={17} />} Find leads</PrimaryButton>
        {visibleMessage && <p className="mt-4 rounded-xl bg-slate-50 p-3 text-sm font-semibold text-slate-700">{visibleMessage}</p>}
      </form>
      {loading && !hasSearched ? <EmptyState title="Loading leads" copy="Reading saved companies from PostgreSQL." /> : error && !hasSearched ? <EmptyState title="Lead data unavailable" copy={error} /> : (hasSearched ? searchResults : leads).length ? <div className="grid gap-5">{(hasSearched ? searchResults : leads).map((lead) => <OpportunityCard key={lead.id || lead.place_id || lead.company} lead={lead} api={api} onLeadUpdated={(updated) => {
        setLeads((items) => items.map((item) => item.id === updated.id ? updated : item));
        setSearchResults((items) => items.map((item) => item.id === updated.id ? updated : item));
      }} />)}</div> : <EmptyState title={hasSearched ? "No matching companies found" : "No real leads yet"} copy={hasSearched ? "Google Maps did not return saved companies for those filters. Broaden the city, category, or radius and search again." : "Run a Google Maps search or add a company through the existing backend. No demo companies are shown."} />}
    </div>
  );
}

export function CompaniesPage() {
  const { api, leads, setLeads, loading, error } = useSalesData();
  return <div className="space-y-6"><PageHeader eyebrow="Companies" title="Every company should become a complete sales opportunity." copy="Review real companies from PostgreSQL. Run AI research to fill missing opportunity fields." />{loading ? <EmptyState title="Loading companies" copy="Reading saved companies." /> : error ? <EmptyState title="Companies unavailable" copy={error} /> : leads.length ? <div className="grid gap-5">{leads.map((lead) => <OpportunityCard key={lead.id || lead.company} lead={lead} api={api} onLeadUpdated={(updated) => setLeads((items) => items.map((item) => item.id === updated.id ? updated : item))} />)}</div> : <EmptyState title="No companies found" copy="Lead Finder must return real provider data before companies appear here." action={<Link href="/dashboard/leads" className="inline-flex min-h-11 items-center rounded-md bg-brand px-4 text-sm font-bold text-white">Find companies</Link>} />}</div>;
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
      setError(friendlyErrorMessage(err, "Website analysis could not be completed. Check website access, subscription and OpenAI configuration."));
    } finally {
      setLoading(false);
    }
  }
  return <div className="space-y-6"><PageHeader eyebrow="Website Analyzer" title="Analyze a real prospect website." copy="OutreachAI fetches the website and uses OpenAI to extract ICP, pain points, offer and outreach strategy." /><form onSubmit={submit} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="grid gap-4 md:grid-cols-3"><input required name="website" placeholder="https://company.com" className="min-h-11 rounded-md border border-slate-300 px-3" /><input name="company" placeholder="Company name" className="min-h-11 rounded-md border border-slate-300 px-3" /><input name="niche" placeholder="Industry or niche" className="min-h-11 rounded-md border border-slate-300 px-3" /></div><div className="mt-4"><PrimaryButton disabled={loading}>{loading ? <Loader2 className="animate-spin" size={17} /> : <Sparkles size={17} />} Analyze website</PrimaryButton></div>{error && <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p>}</form>{analysis ? <section className="grid gap-4 lg:grid-cols-2">{[["Business summary", analysis.company_summary || analysis.summary], ["Services", analysis.services.join(", ") || unavailable], ["Target customers", analysis.niche || unavailable], ["Weak points", analysis.weaknesses.join(", ") || unavailable], ["Possible outreach angle", analysis.sales_angle || unavailable], ["Suggested offer", analysis.suggested_offer || unavailable], ["Personalization facts", analysis.strengths.join(", ") || unavailable], ["Recommended cold email", analysis.outreach_strategy || unavailable]].map(([label, value]) => <article key={label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="font-bold text-ink">{label}</h2><p className="mt-2 text-sm leading-6 text-slate-600">{value}</p></article>)}</section> : <EmptyState title="No website analyzed yet" copy="Enter a real domain. OutreachAI will not show sample analysis." />}</div>;
}

export function ContactsPage() {
  const { leads, loading, error } = useSalesData();
  const contacts = leads.filter((lead) => lead.contact || lead.email || lead.title);
  return <div className="space-y-6"><PageHeader eyebrow="Contacts" title="Decision makers and verified emails." copy="Contacts are shown only when provider or manual data exists. Missing emails are not invented." />{loading ? <EmptyState title="Loading contacts" copy="Checking saved leads." /> : error ? <EmptyState title="Contacts unavailable" copy={error} /> : contacts.length ? <section className="grid gap-4 lg:grid-cols-3">{contacts.map((lead) => <article key={lead.id || lead.company} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="font-bold text-ink">{lead.contact || "Decision maker unavailable"}</h2><p className="mt-1 text-sm text-slate-600">{lead.title || "Role unavailable"} · {lead.company}</p><p className="mt-4 rounded-xl bg-slate-50 p-3 text-sm font-semibold">{lead.email || "No verified email available"}</p><p className="mt-3 text-sm text-slate-600">{lead.hunter_verified ? "Verified by Hunter" : "Not verified yet"}</p></article>)}</section> : <EmptyState title="No decision makers yet" copy="Run Hunter enrichment or add a contact manually. OutreachAI will not create fake contacts." />}</div>;
}

export function CampaignsPage() {
  const { campaigns, leads, loading, error } = useSalesData();
  return <div className="space-y-6"><PageHeader eyebrow="Campaigns" title="Review real outreach before anything is sent." copy="Campaigns and sequences come from your workspace. OutreachAI keeps generated emails in review mode." />{loading ? <EmptyState title="Loading campaigns" copy="Reading saved campaigns." /> : error ? <EmptyState title="Campaign data unavailable" copy={error} /> : campaigns.length ? <section className="grid gap-4 lg:grid-cols-2">{campaigns.map((campaign) => <article key={campaign.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="font-bold text-ink">{campaign.name}</h2><p className="mt-2 text-sm text-slate-600">{campaign.leads} leads · {campaign.sent} sent · {campaign.replies} replies · {campaign.status}</p><div className="mt-4 space-y-3">{campaign.sequence.length ? campaign.sequence.map((step) => <div key={step.step_order} className="rounded-xl bg-slate-50 p-3"><p className="font-bold">{step.name || `Email ${step.step_order}`}</p><p className="mt-1 text-sm text-slate-600">{step.subject || "Subject unavailable"}</p></div>) : <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600">No sequence saved yet.</p>}</div><p className="mt-4 rounded-xl bg-teal-50 p-3 text-sm font-bold text-brand">Review before send: enabled</p><div className="mt-4 flex gap-2"><SecondaryButton><Pause size={17} /> Pause</SecondaryButton><PrimaryButton><Play size={17} /> Launch after approval</PrimaryButton></div></article>)}</section> : <EmptyState title="No campaigns yet" copy={leads.length ? "Create a campaign from selected opportunities before sending." : "Find leads first, then create a campaign. No sample campaigns are shown."} />}</div>;
}

export function InboxPage() {
  return <div className="space-y-6"><PageHeader eyebrow="Inbox" title="Replies will appear here when campaigns receive real responses." copy="AI classification is available after Resend/webhook reply events exist in the workspace." /><EmptyState title="No real replies yet" copy="OutreachAI will classify replies as Interested, Not interested, Later, Asked for pricing, Wants a call or Wrong person after inbound events are received." /></div>;
}

export function CrmPipelinePage() {
  const { leads, loading, error } = useSalesData();
  const statuses = ["New", "Researched", "Email prepared", "Contacted", "Replied", "Meeting booked", "Client", "Lost"];
  return <div className="space-y-6"><PageHeader eyebrow="CRM Pipeline" title="Move real leads from research to revenue." copy="Pipeline columns are populated only from saved lead statuses." />{loading ? <EmptyState title="Loading pipeline" copy="Reading lead statuses." /> : error ? <EmptyState title="Pipeline unavailable" copy={error} /> : <section className="grid gap-4 lg:grid-cols-4">{statuses.map((status) => { const items = leads.filter((lead) => lead.status === status); return <article key={status} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><h2 className="font-bold text-ink">{status}</h2><div className="mt-4 space-y-3">{items.length ? items.map((lead) => <div key={lead.id || lead.company} className="rounded-xl bg-slate-50 p-3 text-sm font-semibold text-slate-700">{lead.company}</div>) : <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-500">No leads</p>}</div></article>; })}</section>}</div>;
}

export function AnalyticsPage() {
  const { metrics, loading, error } = useSalesData();
  const cards = [["Leads found", metrics.leads], ["Websites analyzed", metrics.funnel?.find((item) => item.status === "analyzed")?.count || 0], ["Emails generated", metrics.emails_sent + metrics.delivered], ["Emails sent", metrics.emails_sent], ["Open rate", `${metrics.open_rate || 0}%`], ["Reply rate", `${metrics.reply_rate || 0}%`], ["Meetings booked", metrics.meetings], ["Clients won", metrics.conversion_rate ? `${metrics.conversion_rate}% conversion` : "0"], ["Estimated revenue", `€${Math.round(metrics.revenue_forecast || metrics.revenue || 0).toLocaleString()}`]];
  return <div className="space-y-6"><PageHeader eyebrow="Analytics" title="Measure real outbound performance." copy="Metrics come from database, campaigns, email events and subscription state." />{loading ? <EmptyState title="Loading analytics" copy="Reading real workspace metrics." /> : error ? <EmptyState title="Analytics unavailable" copy={error} /> : <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{cards.map(([label, value]) => <MetricCard key={String(label)} label={String(label)} value={String(value)} help="Real workspace metric" />)}</section>}</div>;
}

export function SettingsPage() {
  return <div className="space-y-6"><PageHeader eyebrow="Settings" title="Configure real providers before relying on automation." copy="Apollo, Hunter, OpenAI, Resend and Stripe determine which parts of the opportunity workflow can be completed." /><section className="grid gap-4 lg:grid-cols-2">{["Lead providers", "Email verification", "OpenAI analysis", "Email sending", "Security", "Billing"].map((item) => <article key={item} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="font-bold text-ink">{item}</h2><p className="mt-2 text-sm text-slate-600">If this provider is not configured or entitled, related opportunity fields will show as unavailable instead of fake.</p></article>)}</section></div>;
}

export function BillingPage() {
  const { metrics, loading, error } = useSalesData();
  return <div className="space-y-6"><PageHeader eyebrow="Billing" title="Subscription and usage." copy="Plan, usage and limits come from billing state. No fake usage is displayed." action={<Link href="/pricing" className="inline-flex min-h-11 items-center justify-center rounded-md bg-ink px-4 text-sm font-bold text-white">Manage plan</Link>} />{loading ? <EmptyState title="Loading billing" copy="Reading subscription usage." /> : error ? <EmptyState title="Billing unavailable" copy={error} /> : <section className="grid gap-4 lg:grid-cols-4"><MetricCard label="Current plan" value={metrics.plan || "Unavailable"} help="From billing status" /><MetricCard label="Leads" value={String((metrics.usage?.leads as number | undefined) || metrics.leads || 0)} help="Current period usage" /><MetricCard label="Emails sent" value={String(metrics.emails_sent)} help="Approved sends" /><MetricCard label="MRR" value={`€${Math.round(metrics.mrr || 0).toLocaleString()}`} help="Subscription revenue" /></section>}</div>;
}

export function AiEmployeesPage() {
  const { leads, api, loading, error } = useSalesData();
  return <div className="space-y-6"><PageHeader eyebrow="AI Sales Employee" title="One click should replace hours of manual sales research." copy="The AI employee uses real provider data only. Missing fields stay visible as unavailable until a provider supplies them." action={<Link href="/dashboard/leads" className="inline-flex min-h-11 items-center justify-center rounded-md bg-brand px-4 text-sm font-bold text-white">Find or research leads</Link>} />{loading ? <EmptyState title="Loading AI work" copy="Reading saved leads." /> : error ? <EmptyState title="AI employee unavailable" copy={error} /> : leads.length ? <div className="grid gap-5">{leads.slice(0, 3).map((lead) => <OpportunityCard key={lead.id || lead.company} lead={lead} api={api} />)}</div> : <EmptyState title="No AI work yet" copy="Find or add real companies first. The AI employee will not show invented results." />}</div>;
}
