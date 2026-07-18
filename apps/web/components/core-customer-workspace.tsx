"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowRight, CheckCircle2, Clock3, ExternalLink, FileText, Inbox, Loader2, Mail, MapPin, Plus, RefreshCw, Save, Search, Send, ShieldCheck, Sparkles, UserRound, XCircle } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { clientApi, friendlyErrorMessage, type ClientApiInit } from "@/lib/client-api";
import type { CrmCompany, CrmContact, Email } from "@/lib/types";
import type { FirstCustomerJob, FirstCustomerResult, FirstCustomerSaveResponse, OutreachSenderStatus, WorkspaceAppActionResponse, WorkspaceAppBootstrapResponse, WorkspaceIntegrationStatus, WorkspaceIntegrationStatusResponse } from "@/lib/customer-api-contracts";

type CoreApi = <T>(path: string, init?: ClientApiInit) => Promise<T>;

type CoreWorkspaceState = {
  bootstrap: WorkspaceAppBootstrapResponse | null;
  integrations: WorkspaceIntegrationStatus[];
  companies: CrmCompany[];
  inbox: Email[];
  senderStatus: OutreachSenderStatus | null;
  loading: boolean;
  error: string;
  notice: string;
  refresh: () => Promise<void>;
  updateCompany: (company: CrmCompany) => void;
  api: CoreApi;
};

type ActionState = {
  busy: string;
  notice: string;
  error: string;
};

declare global {
  interface Window {
    Clerk?: {
      session?: {
        getToken?: () => Promise<string | null>;
      };
    };
  }
}

const localQaAuthEnabled = process.env.NEXT_PUBLIC_APP_ENV === "test"
  && process.env.NEXT_PUBLIC_CLERK_E2E_BYPASS === "true"
  && (process.env.NEXT_PUBLIC_API_URL === "http://127.0.0.1:8000" || process.env.NEXT_PUBLIC_API_URL === "http://localhost:8000");

const workflowStages = ["New Lead", "Contact Found", "Email Draft Ready", "Approved", "Sent", "Replied", "Not Interested"] as const;

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function resolveToken() {
  if (localQaAuthEnabled) return "dev";
  if (typeof window === "undefined") return null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const token = await window.Clerk?.session?.getToken?.();
    if (token) return token;
    await sleep(100);
  }
  return null;
}

function useCoreApi(): CoreApi {
  return useCallback(async <T,>(path: string, init: ClientApiInit = {}) => {
    const token = await resolveToken();
    return clientApi<T>(path, token, init);
  }, []);
}

function safeArray<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

function formatDate(value?: string | null) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not recorded";
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function latestDraft(company: CrmCompany): Email | null {
  return safeArray(company.generated_emails)[0] || null;
}

function primaryContact(company: CrmCompany): CrmContact | null {
  return safeArray(company.contacts)[0] || null;
}

function companyQualityScore(company: CrmCompany) {
  const explicit = Number(company.icp_score ?? company.priority_score ?? company.overall_score ?? company.confidence_score ?? 0);
  if (Number.isFinite(explicit) && explicit > 0) return Math.max(0, Math.min(100, Math.round(explicit)));
  const checks = [
    Boolean(company.website || company.domain),
    Boolean(company.industry),
    Boolean(company.country || company.city),
    Boolean(company.ai_summary || company.sales_angle || company.reasoning),
    Boolean(company.email || primaryContact(company)?.email),
    Boolean(latestDraft(company))
  ];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}

function publicSourceLabel(source?: string | null) {
  if (!source) return "Source not recorded";
  if (/^https?:\/\//i.test(source)) {
    try {
      return new URL(source).hostname.replace(/^www\./, "");
    } catch {
      return "Public source recorded";
    }
  }
  return "Public source recorded";
}

function contactLine(company: CrmCompany) {
  const contact = primaryContact(company);
  if (!contact) return "No public contact saved yet";
  const parts = [contact.name, contact.title].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Recommended contact role";
}

function contactEmail(company: CrmCompany) {
  return company.email || primaryContact(company)?.email || "";
}

function mergeCompanyRecord(incoming: CrmCompany, current?: CrmCompany): CrmCompany {
  if (!current) return incoming;
  return {
    ...current,
    ...incoming,
    contacts: safeArray(incoming.contacts).length ? safeArray(incoming.contacts) : safeArray(current.contacts),
    notes: safeArray(incoming.notes).length ? safeArray(incoming.notes) : safeArray(current.notes),
    activity: safeArray(incoming.activity).length ? safeArray(incoming.activity) : safeArray(current.activity),
    generated_emails: safeArray(incoming.generated_emails).length ? safeArray(incoming.generated_emails) : safeArray(current.generated_emails),
    deals: safeArray(incoming.deals).length ? safeArray(incoming.deals) : safeArray(current.deals)
  };
}

function mergeCompanyIntoList(companies: CrmCompany[], company: CrmCompany): CrmCompany[] {
  const index = companies.findIndex((item) => item.id === company.id);
  if (index < 0) return [company, ...companies];
  return companies.map((item) => item.id === company.id ? mergeCompanyRecord(company, item) : item);
}

function nextActionForCompany(company: CrmCompany) {
  const draft = latestDraft(company);
  const email = contactEmail(company);
  const stage = String(company.crm_stage || "");
  if (!email) return "Find or add a verified business email.";
  if (!draft) return "Prepare the first personalized email.";
  if (draft.delivery_status === "sent" || stage === "Sent") return "Watch for replies and update the CRM stage.";
  if (draft.delivery_status === "approved" || stage === "Approved") return "Send the approved email when ready.";
  return "Review the draft and approve it manually.";
}

function integrationTone(status: WorkspaceIntegrationStatus["status"]) {
  if (status === "connected") return "border-teal-200 bg-teal-50 text-teal-900";
  if (status === "missing_key" || status === "needs_setup") return "border-amber-200 bg-amber-50 text-amber-950";
  return "border-red-200 bg-red-50 text-red-900";
}

function integrationStatusText(status: WorkspaceIntegrationStatus["status"]) {
  if (status === "connected") return "Connected";
  if (status === "missing_key") return "Needs server key";
  if (status === "needs_setup") return "Needs setup";
  return "Unavailable";
}

function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={cx("rounded-3xl border border-slate-200 bg-white p-5 shadow-sm", className)}>{children}</section>;
}

function Button({
  children,
  variant = "primary",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" }) {
  return (
    <button
      className={cx(
        "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-black transition disabled:cursor-not-allowed disabled:opacity-55",
        variant === "primary" && "bg-brand text-white shadow-sm hover:bg-teal-700",
        variant === "secondary" && "border border-slate-300 bg-white text-ink shadow-sm hover:bg-slate-50",
        variant === "danger" && "border border-red-200 bg-red-50 text-red-700 hover:bg-red-100",
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}

function PageIntro({ eyebrow, title, copy, action }: { eyebrow: string; title: string; copy: string; action?: ReactNode }) {
  const { t } = useI18n();
  return (
    <header className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0 max-w-3xl">
          <p className="text-sm font-black uppercase tracking-[0.14em] text-brand">{t(eyebrow)}</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight text-ink sm:text-4xl">{t(title)}</h1>
          <p className="mt-3 text-sm font-semibold leading-6 text-slate-600 sm:text-base">{t(copy)}</p>
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
    </header>
  );
}

function EmptyState({ title, copy, action }: { title: string; copy: string; action?: ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-6 text-center">
      <Sparkles className="mx-auto text-brand" size={26} />
      <h2 className="mt-3 text-xl font-black text-ink">{t(title)}</h2>
      <p className="mx-auto mt-2 max-w-xl text-sm font-semibold leading-6 text-slate-600">{t(copy)}</p>
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </div>
  );
}

function StateBanner({ tone = "info", children }: { tone?: "info" | "success" | "warning" | "error"; children: ReactNode }) {
  return (
    <div className={cx(
      "rounded-2xl border p-4 text-sm font-semibold leading-6",
      tone === "info" && "border-slate-200 bg-white text-slate-700",
      tone === "success" && "border-teal-200 bg-teal-50 text-teal-900",
      tone === "warning" && "border-amber-200 bg-amber-50 text-amber-950",
      tone === "error" && "border-red-200 bg-red-50 text-red-800"
    )}>
      {children}
    </div>
  );
}

function ServiceStatusGrid({ integrations, senderStatus }: { integrations: WorkspaceIntegrationStatus[]; senderStatus: OutreachSenderStatus | null }) {
  const { t } = useI18n();
  const items = integrations.length ? integrations : [
    { key: "lead_search", label: "Company search", status: "needs_setup" as const, message: "Service status has not loaded yet." },
    { key: "contact_discovery", label: "Email verification", status: "needs_setup" as const, message: "Service status has not loaded yet." },
    { key: "ai_research", label: "AI drafts", status: "needs_setup" as const, message: "Service status has not loaded yet." },
    { key: "email_sending", label: "Email sending", status: senderStatus?.status || "needs_setup", message: senderStatus?.next_action || "Connect a verified sender before sending." }
  ];

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => (
        <article key={item.key} className={cx("rounded-2xl border p-4", integrationTone(item.status))}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-black">{t(item.label)}</p>
              <p className="mt-1 text-xs font-black uppercase tracking-wide opacity-70">{t(integrationStatusText(item.status))}</p>
            </div>
            {item.status === "connected" ? <CheckCircle2 size={18} /> : <XCircle size={18} />}
          </div>
          <p className="mt-3 text-xs font-semibold leading-5 opacity-80">{t(item.message)}</p>
        </article>
      ))}
    </div>
  );
}

function useCoreWorkspaceData(): CoreWorkspaceState {
  const api = useCoreApi();
  const [bootstrap, setBootstrap] = useState<WorkspaceAppBootstrapResponse | null>(null);
  const [integrations, setIntegrations] = useState<WorkspaceIntegrationStatus[]>([]);
  const [companies, setCompanies] = useState<CrmCompany[]>([]);
  const [inbox, setInbox] = useState<Email[]>([]);
  const [senderStatus, setSenderStatus] = useState<OutreachSenderStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const { t } = useI18n();

  const updateCompany = useCallback((company: CrmCompany) => {
    setCompanies((current) => mergeCompanyIntoList(current, company));
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    setNotice("");
    const [bootstrapResult, integrationsResult, companiesResult, inboxResult, senderResult] = await Promise.allSettled([
      api<WorkspaceAppBootstrapResponse>("/api/workspace-app/bootstrap", { timeoutMs: 30000 }),
      api<WorkspaceIntegrationStatusResponse>("/api/workspace-app/integrations/status", { timeoutMs: 30000 }),
      api<CrmCompany[]>("/api/workspace-app/companies", { timeoutMs: 30000 }),
      api<Email[]>("/api/inbox", { timeoutMs: 30000 }),
      api<OutreachSenderStatus>("/api/outreach/sender/status", { timeoutMs: 30000 })
    ]);

    if (bootstrapResult.status === "fulfilled") setBootstrap(bootstrapResult.value);
    if (integrationsResult.status === "fulfilled") setIntegrations(safeArray(integrationsResult.value.integrations));
    if (companiesResult.status === "fulfilled") {
      setCompanies((current) => safeArray(companiesResult.value).map((company) => mergeCompanyRecord(company, current.find((item) => item.id === company.id))));
    }
    if (inboxResult.status === "fulfilled") setInbox(safeArray(inboxResult.value));
    if (senderResult.status === "fulfilled") setSenderStatus(senderResult.value);

    const requiredFailed = bootstrapResult.status === "rejected" && companiesResult.status === "rejected";
    if (requiredFailed) {
      setError(friendlyErrorMessage(bootstrapResult.reason, t("Workspace data could not be loaded. Please refresh or sign in again.")));
    } else if ([bootstrapResult, integrationsResult, companiesResult, inboxResult, senderResult].some((item) => item.status === "rejected")) {
      setNotice(t("Some workspace details are temporarily unavailable. Core CRM data is still shown when available."));
    }
    setLoading(false);
  }, [api, t]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refresh();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  return { bootstrap, integrations, companies, inbox, senderStatus, loading, error, notice, refresh, updateCompany, api };
}

function LoadingWorkspace() {
  const { t } = useI18n();
  return (
    <div className="grid gap-4">
      <div className="h-44 animate-pulse rounded-3xl bg-slate-100" />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="h-36 animate-pulse rounded-3xl bg-slate-100" />
        <div className="h-36 animate-pulse rounded-3xl bg-slate-100" />
        <div className="h-36 animate-pulse rounded-3xl bg-slate-100" />
      </div>
      <p className="text-sm font-semibold text-slate-500">{t("Loading workspace...")}</p>
    </div>
  );
}

function ResultStat({ label, value, detail }: { label: string; value: string; detail: string }) {
  const { t } = useI18n();
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4">
      <p className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">{t(label)}</p>
      <p className="mt-2 text-2xl font-black text-ink">{value}</p>
      <p className="mt-1 text-sm font-semibold leading-5 text-slate-600">{t(detail)}</p>
    </article>
  );
}

export function CoreDashboardHome() {
  const data = useCoreWorkspaceData();
  const { t } = useI18n();
  const companies = data.companies.length ? data.companies : safeArray(data.bootstrap?.recent_companies);
  const drafts = companies.filter((company) => latestDraft(company));
  const sent = companies.filter((company) => company.email_sent_at || latestDraft(company)?.delivery_status === "sent");
  const replies = companies.filter((company) => company.replied_at);
  const workspaceName = data.bootstrap?.workspace?.company || data.bootstrap?.workspace?.name || "your workspace";
  const tasks = [
    !companies.length ? { title: "Run your first search", copy: "Describe your product and target market, then review real public-source results.", href: "/dashboard/leads", label: "Start search" } : null,
    companies.some((company) => !contactEmail(company)) ? { title: "Complete contact routes", copy: "Some saved leads do not have a verified public business email yet.", href: "/dashboard/crm", label: "Open CRM" } : null,
    drafts.some((company) => latestDraft(company)?.delivery_status === "draft") ? { title: "Review email drafts", copy: "Approve only the messages you are ready to send manually.", href: "/dashboard/inbox", label: "Open Mail" } : null,
    data.senderStatus && !data.senderStatus.connected ? { title: "Connect email sending", copy: data.senderStatus.next_action || "A verified sender is required before manual sending.", href: "/dashboard/settings#email-sending", label: "Open settings" } : null,
    companies.length && !drafts.length ? { title: "Prepare the first email", copy: "Use a saved CRM lead to generate a short personalized draft.", href: "/dashboard/crm", label: "Prepare draft" } : null
  ].filter(Boolean).slice(0, 4) as Array<{ title: string; copy: string; href: string; label: string }>;

  if (data.loading && !data.bootstrap && !data.companies.length) return <LoadingWorkspace />;

  return (
    <div className="space-y-6">
      <PageIntro
        eyebrow="Home"
        title="Find customers, save CRM leads, write emails."
        copy={`Good to see you. Start from ${workspaceName}. One workflow matters here: find the right companies, save selected leads to CRM, prepare a short email, then send only after review.`}
        action={<Link href="/dashboard/leads" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-brand px-4 text-sm font-black text-white shadow-sm">{t("Start search")} <ArrowRight size={17} /></Link>}
      />
      {data.error ? <StateBanner tone="error">{data.error}</StateBanner> : null}
      {data.notice ? <StateBanner tone="warning">{data.notice}</StateBanner> : null}

      <Card>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.14em] text-brand">{t("Service readiness")}</p>
            <h2 className="mt-1 text-2xl font-black text-ink">{t("Connected services for the customer flow.")}</h2>
            <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">{t("Unavailable services are explained here instead of hiding broken buttons inside the workflow.")}</p>
          </div>
          <Button variant="secondary" onClick={data.refresh}><RefreshCw size={16} />{t("Refresh")}</Button>
        </div>
        <div className="mt-5">
          <ServiceStatusGrid integrations={data.integrations} senderStatus={data.senderStatus} />
        </div>
      </Card>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <ResultStat label="Saved leads" value={companies.length ? String(companies.length) : "Not started"} detail={companies.length ? "Real CRM records in this workspace." : "Run a search and save selected leads."} />
        <ResultStat label="Drafts" value={drafts.length ? String(drafts.length) : "None yet"} detail={drafts.length ? "Waiting for human review." : "Prepare drafts after saving leads."} />
        <ResultStat label="Sent" value={sent.length ? String(sent.length) : "Not sent"} detail="No email is sent automatically." />
        <ResultStat label="Replies" value={replies.length ? String(replies.length) : "No replies"} detail="Replies appear after real email events." />
      </section>

      <section className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <Card>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-black uppercase tracking-[0.14em] text-brand">{t("Today")}</p>
              <h2 className="mt-1 text-2xl font-black text-ink">{t("What to do next.")}</h2>
            </div>
          </div>
          <div className="mt-5 grid gap-3">
            {tasks.length ? tasks.map((task) => (
              <Link key={task.title} href={task.href} className="rounded-2xl border border-slate-200 bg-slate-50 p-4 transition hover:border-teal-200 hover:bg-teal-50">
                <p className="font-black text-ink">{t(task.title)}</p>
                <p className="mt-1 text-sm font-semibold leading-6 text-slate-600">{t(task.copy)}</p>
                <p className="mt-3 inline-flex items-center gap-2 text-sm font-black text-brand">{t(task.label)} <ArrowRight size={15} /></p>
              </Link>
            )) : (
              <StateBanner tone="success">{t("No urgent task right now. Review the latest CRM leads or start a new search when you are ready.")}</StateBanner>
            )}
          </div>
        </Card>

        <Card>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-black uppercase tracking-[0.14em] text-brand">{t("Latest companies")}</p>
              <h2 className="mt-1 text-2xl font-black text-ink">{t("Recently found or saved.")}</h2>
            </div>
            <Link href="/dashboard/crm" className="text-sm font-black text-brand">{t("Open CRM")}</Link>
          </div>
          <div className="mt-5 grid gap-3">
            {companies.slice(0, 5).map((company) => (
              <Link key={company.id} href={`/dashboard/crm?company=${encodeURIComponent(company.id)}`} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-black text-ink">{company.name}</p>
                    <p className="mt-1 truncate text-sm font-semibold text-slate-600">{company.industry || "Industry unknown"} · {company.country || company.city || "Country unknown"}</p>
                  </div>
                  <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-black text-slate-600">{t(company.crm_stage || "New Lead")}</span>
                </div>
                <p className="mt-3 text-sm font-semibold leading-6 text-slate-600">{t(nextActionForCompany(company))}</p>
              </Link>
            ))}
            {!companies.length ? <EmptyState title="No real companies saved yet" copy="Start with one focused search. OutreachAI will not show demo CRM data here." action={<Link href="/dashboard/leads" className="inline-flex min-h-11 items-center justify-center rounded-xl bg-brand px-4 text-sm font-black text-white">{t("Start search")}</Link>} /> : null}
          </div>
        </Card>
      </section>
    </div>
  );
}

function FirstCustomerCard({ result, saving, onSave }: { result: FirstCustomerResult; saving: boolean; onSave: () => void }) {
  const { t } = useI18n();
  const saved = Boolean(result.company_id || result.lead_id);
  const score = Math.max(0, Math.min(100, Math.round(Number(result.ai_relevance_score || 0))));
  return (
    <article className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-black text-ink">{result.company_name}</h2>
            <span className="rounded-full bg-teal-50 px-3 py-1 text-xs font-black text-brand">{score}/100 {t("quality")}</span>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-600">{t(result.verified_status || "unknown")}</span>
          </div>
          <p className="mt-2 text-sm font-semibold text-slate-600">{result.industry || t("Industry unknown")} · {result.country || t("Country unknown")}</p>
        </div>
        <div className="flex flex-col gap-2 min-[430px]:flex-row">
          {result.source_url ? (
            <a href={result.source_url} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-3 text-sm font-black text-ink">
              {t("Source")} <ExternalLink size={15} />
            </a>
          ) : null}
          <Button disabled={saved || saving} onClick={onSave}>
            {saving ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
            {saved ? t("Saved to CRM") : t("Save to CRM")}
          </Button>
        </div>
      </div>
      <div className="mt-5 grid gap-3 md:grid-cols-2">
        <div className="rounded-2xl bg-slate-50 p-4">
          <p className="text-xs font-black uppercase tracking-wide text-slate-500">{t("Why it fits")}</p>
          <p className="mt-2 text-sm font-semibold leading-6 text-ink">{result.fit_explanation || result.evidence_summary || result.signal_description || t("No explanation returned yet.")}</p>
        </div>
        <div className="rounded-2xl bg-slate-50 p-4">
          <p className="text-xs font-black uppercase tracking-wide text-slate-500">{t("Contact route")}</p>
          <p className="mt-2 break-words text-sm font-semibold leading-6 text-ink">{result.public_work_contact || t("No public contact route found")}</p>
          <p className="mt-2 text-sm font-semibold text-slate-600">{result.contact_name || result.contact_title || t("Recommended role not confirmed")}</p>
        </div>
        <div className="rounded-2xl bg-slate-50 p-4">
          <p className="text-xs font-black uppercase tracking-wide text-slate-500">{t("Public signal")}</p>
          <p className="mt-2 text-sm font-semibold leading-6 text-ink">{result.signal_type}: {result.signal_description}</p>
          <p className="mt-2 text-xs font-bold text-slate-500">{t("Date")}: {result.publication_date || result.signal_date || t("Unknown")}</p>
        </div>
        <div className="rounded-2xl bg-slate-950 p-4 text-white">
          <p className="text-xs font-black uppercase tracking-wide text-white/60">{t("Draft preview")}</p>
          <p className="mt-2 whitespace-pre-wrap text-sm font-semibold leading-6 text-white/90">{result.email_body || result.draft_email || result.first_line_opener || t("Draft will be prepared after saving, if AI is connected.")}</p>
        </div>
      </div>
    </article>
  );
}

export function CoreLeadFinderPage() {
  const data = useCoreWorkspaceData();
  const { t } = useI18n();
  const [job, setJob] = useState<FirstCustomerJob | null>(null);
  const [searching, setSearching] = useState(false);
  const [savingId, setSavingId] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const leadSearchStatus = data.integrations.find((item) => item.key === "lead_search")?.status || "needs_setup";
  const searchReady = leadSearchStatus === "connected";
  const workspace = data.bootstrap?.workspace;

  async function runSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    setSearching(true);
    setError("");
    setMessage(t("Searching public sources and verifying every result before showing it."));
    setJob(null);
    try {
      const payload = {
        product_site: String(formData.get("product_site") || "").trim(),
        target_customer: String(formData.get("target_customer") || "").trim(),
        country: String(formData.get("country") || "").trim(),
        industry: String(formData.get("industry") || "").trim(),
        company_size: String(formData.get("company_size") || "").trim(),
        criteria: String(formData.get("criteria") || "").trim(),
        results: Number(formData.get("results") || 5)
      };
      const nextJob = await data.api<FirstCustomerJob>("/api/workspace-app/leads/first-customers/search", {
        method: "POST",
        body: JSON.stringify(payload),
        timeoutMs: 90000,
        retries: 0
      });
      setJob(nextJob);
      const resultCount = safeArray(nextJob.results).length;
      setMessage(resultCount ? t("Verified results are ready. Save only the companies you want in CRM.") : t(nextJob.error_message || "No verified companies were found. Broaden the criteria and try again."));
    } catch (err) {
      setError(friendlyErrorMessage(err, t("Search could not be completed. Check connected services and try again.")));
      setMessage("");
    } finally {
      setSearching(false);
    }
  }

  async function saveResult(result: FirstCustomerResult) {
    setSavingId(result.id);
    setError("");
    setMessage(t("Saving selected lead to CRM and keeping the email as a draft."));
    try {
      const response = await data.api<FirstCustomerSaveResponse>(`/api/workspace-app/leads/first-customers/results/${result.id}/save`, {
        method: "POST",
        timeoutMs: 30000
      });
      setJob((current) => current ? {
        ...current,
        results: current.results.map((item) => item.id === result.id ? response.result : item),
        summary: { ...(current.summary || {}), saved_to_crm: Number(current.summary?.saved_to_crm || 0) + 1 }
      } : current);
      setMessage(t(response.message || "Lead saved to CRM. Review the draft before sending."));
      await data.refresh();
    } catch (err) {
      setError(friendlyErrorMessage(err, t("This lead could not be saved. It may already exist or your session expired.")));
    } finally {
      setSavingId("");
    }
  }

  return (
    <div className="space-y-6">
      <PageIntro
        eyebrow="Search"
        title="Find customers, then decide what to save."
        copy="Enter your product site and target market. OutreachAI searches public sources, shows evidence and keeps CRM creation manual."
        action={<a href="#search-form" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-brand px-4 text-sm font-black text-white">{t("New search")} <ArrowRight size={17} /></a>}
      />
      {data.notice ? <StateBanner tone="warning">{data.notice}</StateBanner> : null}
      {error ? <StateBanner tone="error">{error}</StateBanner> : null}
      {message ? <StateBanner tone={job?.results?.length ? "success" : "info"}>{message}</StateBanner> : null}

      <Card>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.14em] text-brand">{t("Connection")}</p>
            <h2 className="mt-1 text-2xl font-black text-ink">{t(searchReady ? "Automatic search is ready." : "Automatic search needs server keys.")}</h2>
            <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">
              {t(searchReady ? "Results come from public sources and are not saved until you approve them." : "Add the server keys for company search, contact verification and AI drafts before running real search. Manual CRM data stays available.")}
            </p>
          </div>
          {!searchReady ? (
            <Link href="/dashboard/settings#lead-search-key" className="inline-flex min-h-11 items-center justify-center rounded-xl border border-amber-300 bg-amber-50 px-4 text-sm font-black text-amber-950">
              {t("Add key")}
            </Link>
          ) : null}
          <ServiceStatusGrid integrations={data.integrations.filter((item) => ["lead_search", "contact_discovery", "ai_research"].includes(item.key))} senderStatus={data.senderStatus} />
        </div>
      </Card>

      <Card>
        <form id="search-form" aria-label="Customer search" onSubmit={runSearch} className="space-y-5">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.14em] text-brand">{t("Search criteria")}</p>
            <h2 className="mt-1 text-2xl font-black text-ink">{t("Describe the buyer you want.")}</h2>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="text-sm font-bold text-slate-700">{t("Product website")}
              <input name="product_site" required defaultValue={workspace?.company ? "" : "https://"} placeholder="https://your-company.com" className="mt-2 min-h-12 w-full rounded-xl border border-slate-300 px-3 text-sm" />
            </label>
            <label className="text-sm font-bold text-slate-700">{t("Country")}
              <input name="country" required defaultValue={workspace?.target_country || ""} placeholder="Germany" className="mt-2 min-h-12 w-full rounded-xl border border-slate-300 px-3 text-sm" />
            </label>
            <label className="text-sm font-bold text-slate-700">{t("Industry")}
              <input name="industry" required defaultValue={workspace?.industry || ""} placeholder="B2B SaaS" className="mt-2 min-h-12 w-full rounded-xl border border-slate-300 px-3 text-sm" />
            </label>
            <label className="text-sm font-bold text-slate-700">{t("Company size")}
              <input name="company_size" placeholder="20-200 employees" className="mt-2 min-h-12 w-full rounded-xl border border-slate-300 px-3 text-sm" />
            </label>
            <label className="text-sm font-bold text-slate-700 md:col-span-2">{t("Target customer")}
              <textarea name="target_customer" defaultValue={workspace?.target_customer || ""} required placeholder="B2B SaaS companies expanding sales teams in Europe" rows={3} className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-3 text-sm" />
            </label>
            <label className="text-sm font-bold text-slate-700 md:col-span-2">{t("Extra criteria")}
              <textarea name="criteria" placeholder="Look for hiring, expansion, tool replacement, or public complaints about manual workflows." rows={3} className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-3 text-sm" />
            </label>
            <label className="text-sm font-bold text-slate-700">{t("Results")}
              <input name="results" type="number" min={1} max={10} defaultValue={5} className="mt-2 min-h-12 w-full rounded-xl border border-slate-300 px-3 text-sm" />
            </label>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Button type="submit" disabled={searching || !searchReady}>
              {searching ? <Loader2 className="animate-spin" size={17} /> : <Search size={17} />}
              {searching ? t("Searching") : t("Find customers")}
            </Button>
            {!searchReady ? <p className="text-sm font-semibold leading-6 text-amber-800">{t("Search is disabled until production search keys are configured.")}</p> : <p className="text-sm font-semibold leading-6 text-slate-600">{t("No CRM record or email send happens during search.")}</p>}
          </div>
        </form>
      </Card>

      {searching ? <LoadingWorkspace /> : null}
      {job ? (
        <section className="space-y-4">
          <div className="grid gap-3 md:grid-cols-4">
            <ResultStat label="Found" value={String(safeArray(job.results).length)} detail="Evidence-backed results returned." />
            <ResultStat label="Saved" value={String(Number(job.summary?.saved_to_crm || 0))} detail="Manually saved CRM records." />
            <ResultStat label="Rejected" value={String(Number(job.summary?.rejected || 0))} detail="Weak or duplicate results hidden." />
            <ResultStat label="Progress" value={`${Number(job.progress?.percent || 100)}%`} detail={String(job.progress?.stage || job.status)} />
          </div>
          {safeArray(job.results).length ? safeArray(job.results).map((result) => (
            <FirstCustomerCard key={result.id} result={result} saving={savingId === result.id} onSave={() => saveResult(result)} />
          )) : (
            <EmptyState title="No verified results for this search" copy="Try a broader industry, another country, or simpler criteria. OutreachAI will not invent leads to fill the table." />
          )}
        </section>
      ) : !searching && !data.loading ? (
        <EmptyState title="Start a focused customer search" copy="The results area stays empty until a real search returns public-source companies." action={<a href="#search-form" className="inline-flex min-h-11 items-center justify-center rounded-xl bg-brand px-4 text-sm font-black text-white">{t("Start search")}</a>} />
      ) : null}
    </div>
  );
}

function CompanyMiniCard({ company, selected, onSelect }: { company: CrmCompany; selected: boolean; onSelect: () => void }) {
  const { t } = useI18n();
  const score = companyQualityScore(company);
  return (
    <button type="button" onClick={onSelect} className={cx("w-full rounded-2xl border p-4 text-left shadow-sm transition", selected ? "border-teal-300 bg-teal-50" : "border-slate-200 bg-white hover:border-slate-300")}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-black text-ink">{company.name}</p>
          <p className="mt-1 truncate text-sm font-semibold text-slate-600">{company.industry || t("Industry unknown")} · {company.country || company.city || t("Country unknown")}</p>
        </div>
        <span className="rounded-full bg-white px-2.5 py-1 text-xs font-black text-slate-600">{score}/100</span>
      </div>
      <p className="mt-3 text-sm font-semibold leading-6 text-slate-600">{t(nextActionForCompany(company))}</p>
    </button>
  );
}

function CompanyDetail({ company, api, onUpdated }: { company: CrmCompany; api: CoreApi; onUpdated: (company: CrmCompany) => void }) {
  const { t } = useI18n();
  const [stage, setStage] = useState(company.crm_stage || "New Lead");
  const [note, setNote] = useState("");
  const [state, setState] = useState<ActionState>({ busy: "", notice: "", error: "" });
  const [localNotes, setLocalNotes] = useState<NonNullable<CrmCompany["notes"]>>(() => safeArray(company.notes));
  const draft = latestDraft(company);
  const contact = primaryContact(company);

  async function moveStage() {
    setState({ busy: "stage", notice: "", error: "" });
    try {
      const updated = await api<CrmCompany>(`/api/crm/companies/${company.id}/stage`, { method: "PATCH", body: JSON.stringify({ stage }) });
      onUpdated(updated);
      setState({ busy: "", notice: t("CRM stage updated."), error: "" });
    } catch (err) {
      setState({ busy: "", notice: "", error: friendlyErrorMessage(err, t("CRM stage could not be updated.")) });
    }
  }

  async function saveNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = note.trim();
    if (!body) return;
    setState({ busy: "note", notice: "", error: "" });
    try {
      const saved = await api<CrmCompany["notes"][number]>(`/api/crm/companies/${company.id}/notes`, { method: "POST", body: JSON.stringify({ body }) });
      const notes = [saved, ...localNotes];
      setLocalNotes(notes);
      onUpdated({ ...company, notes });
      setNote("");
      setState({ busy: "", notice: t("Note saved."), error: "" });
    } catch (err) {
      setState({ busy: "", notice: "", error: friendlyErrorMessage(err, t("Note could not be saved.")) });
    }
  }

  async function generateDraft() {
    setState({ busy: "draft", notice: "", error: "" });
    try {
      const result = await api<WorkspaceAppActionResponse>(`/api/workspace-app/companies/${company.id}/email-draft`, { method: "POST", timeoutMs: 30000 });
      if (result.company) onUpdated(result.company);
      setState({ busy: "", notice: t(result.message || "Email draft created for review. Nothing was sent."), error: "" });
    } catch (err) {
      setState({ busy: "", notice: "", error: friendlyErrorMessage(err, t("Email draft could not be created.")) });
    }
  }

  return (
    <Card className="min-w-0">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-2xl font-black text-ink">{company.name}</h2>
            <span className="rounded-full bg-teal-50 px-3 py-1 text-xs font-black text-brand">{companyQualityScore(company)}/100 {t("quality")}</span>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-600">{t(stage)}</span>
          </div>
          <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">{company.ai_summary || company.reasoning || company.sales_angle || t("No AI summary yet. Prepare the company or add a note before outreach.")}</p>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm font-semibold text-slate-600">
            <span className="inline-flex items-center gap-1.5"><MapPin size={15} />{[company.city, company.country].filter(Boolean).join(", ") || t("Location unknown")}</span>
            {company.website || company.domain ? <a className="inline-flex items-center gap-1.5 text-brand hover:underline" href={company.website || `https://${company.domain}`} target="_blank" rel="noreferrer"><ExternalLink size={15} />{company.website || company.domain}</a> : null}
          </div>
        </div>
        <Link href="/dashboard/inbox" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-black text-ink shadow-sm"><Mail size={16} />{t("Open Mail")}</Link>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl bg-slate-50 p-4">
          <p className="text-xs font-black uppercase tracking-wide text-slate-500">{t("Contact")}</p>
          <p className="mt-2 font-black text-ink">{contactLine(company)}</p>
          <p className="mt-1 break-words text-sm font-semibold text-slate-600">{contactEmail(company) || t("No public business email saved")}</p>
        </div>
        <div className="rounded-2xl bg-slate-50 p-4">
          <p className="text-xs font-black uppercase tracking-wide text-slate-500">{t("Source")}</p>
          <p className="mt-2 text-sm font-semibold leading-6 text-ink">{t(publicSourceLabel(company.source))}</p>
          <p className="mt-1 text-xs font-bold text-slate-500">{t("Saved")}: {formatDate(company.saved_to_crm_at || company.created_at)}</p>
        </div>
        <div className="rounded-2xl bg-slate-50 p-4">
          <p className="text-xs font-black uppercase tracking-wide text-slate-500">{t("Next action")}</p>
          <p className="mt-2 text-sm font-semibold leading-6 text-ink">{t(nextActionForCompany(company))}</p>
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <label className="text-sm font-black text-ink">{t("Lead stage")}
            <select value={stage} onChange={(event) => setStage(event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold">
              {workflowStages.map((item) => <option key={item} value={item}>{t(item)}</option>)}
            </select>
          </label>
          <Button className="mt-3 w-full" variant="secondary" onClick={moveStage} disabled={state.busy === "stage"}>
            {state.busy === "stage" ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
            {t("Update stage")}
          </Button>
        </div>
        <form onSubmit={saveNote} className="rounded-2xl border border-slate-200 bg-white p-4">
          <label className="text-sm font-black text-ink">{t("Notes and history")}
            <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} placeholder={t("Add the next step, context from a reply, or a manual research note.")} className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-3 text-sm" />
          </label>
          <Button className="mt-3" variant="secondary" type="submit" disabled={state.busy === "note" || !note.trim()}>
            {state.busy === "note" ? <Loader2 className="animate-spin" size={16} /> : <Plus size={16} />}
            {t("Add note")}
          </Button>
        </form>
      </div>

      <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-wide text-slate-500">{t("Email draft")}</p>
            <h3 className="mt-1 font-black text-ink">{draft?.subject || t("No draft prepared yet")}</h3>
            <p className="mt-2 whitespace-pre-wrap text-sm font-semibold leading-6 text-slate-700">{draft?.body || t("Generate a draft after the lead has a contact route. Nothing is sent automatically.")}</p>
          </div>
          <Button onClick={generateDraft} disabled={state.busy === "draft"}>
            {state.busy === "draft" ? <Loader2 className="animate-spin" size={16} /> : <FileText size={16} />}
            {draft ? t("Regenerate draft") : t("Prepare email")}
          </Button>
        </div>
      </div>

      {state.notice ? <div className="mt-4"><StateBanner tone="success">{state.notice}</StateBanner></div> : null}
      {state.error ? <div className="mt-4"><StateBanner tone="error">{state.error}</StateBanner></div> : null}
      <div className="mt-5">
        <p className="text-sm font-black text-ink">{t("Activity history")}</p>
        <div className="mt-3 grid gap-2">
          {[...localNotes.map((noteItem) => ({ id: noteItem.id, label: noteItem.body, time: noteItem.created_at })), ...safeArray(company.activity).map((activityItem) => ({ id: activityItem.id, label: activityItem.action, time: activityItem.created_at }))].slice(0, 6).map((item) => (
            <div key={item.id} className="rounded-xl bg-white p-3 text-sm shadow-sm">
              <p className="font-semibold leading-6 text-slate-700">{t(item.label)}</p>
              <p className="text-xs font-bold text-slate-500">{formatDate(item.time)}</p>
            </div>
          ))}
          {!localNotes.length && !safeArray(company.activity).length ? <p className="rounded-xl bg-white p-3 text-sm font-semibold text-slate-600">{t("No notes yet.")}</p> : null}
        </div>
      </div>
    </Card>
  );
}

export function CoreCrmPage() {
  const data = useCoreWorkspaceData();
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const requestedCompanyId = searchParams.get("company") || "";
  const filteredCompanies = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return data.companies;
    return data.companies.filter((company) => [company.name, company.website, company.industry, company.country, company.crm_stage].some((value) => String(value || "").toLowerCase().includes(normalized)));
  }, [data.companies, query]);
  const selected = filteredCompanies.find((company) => company.id === (selectedId || requestedCompanyId)) || filteredCompanies[0] || null;

  function updateCompany(company: CrmCompany) {
    data.updateCompany(company);
    setSelectedId(company.id);
  }

  return (
    <div className="space-y-6">
      <PageIntro
        eyebrow="CRM"
        title="Saved leads, stages, notes and history."
        copy="This CRM shows only companies you saved or added. Use it to finish contact data, prepare a draft and track the next manual action."
        action={<Link href="/dashboard/leads" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-brand px-4 text-sm font-black text-white">{t("Find customers")} <ArrowRight size={17} /></Link>}
      />
      {data.loading && !data.companies.length ? <LoadingWorkspace /> : null}
      {data.error ? <StateBanner tone="error">{data.error}</StateBanner> : null}
      <Card>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <label className="min-w-0 flex-1 text-sm font-black text-ink">{t("Search CRM")}
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("Company, stage, country, website")} className="mt-2 min-h-12 w-full rounded-xl border border-slate-300 px-3 text-sm" />
          </label>
          <Button variant="secondary" onClick={data.refresh}><RefreshCw size={16} />{t("Refresh")}</Button>
        </div>
      </Card>
      {filteredCompanies.length ? (
        <div className="grid gap-4 xl:grid-cols-[24rem_1fr]">
          <div className="grid h-fit gap-3">
            {filteredCompanies.map((company) => <CompanyMiniCard key={company.id} company={company} selected={selected?.id === company.id} onSelect={() => setSelectedId(company.id)} />)}
          </div>
          {selected ? <CompanyDetail key={selected.id} company={selected} api={data.api} onUpdated={updateCompany} /> : null}
        </div>
      ) : !data.loading ? (
        <EmptyState title="No saved leads yet" copy="Run a search and manually save the companies you want to work." action={<Link href="/dashboard/leads" className="inline-flex min-h-11 items-center justify-center rounded-xl bg-brand px-4 text-sm font-black text-white">{t("Start search")}</Link>} />
      ) : null}
    </div>
  );
}

function DraftCard({ company, senderStatus, api, onUpdated }: { company: CrmCompany; senderStatus: OutreachSenderStatus | null; api: CoreApi; onUpdated: () => void }) {
  const { t } = useI18n();
  const draft = latestDraft(company);
  const [subject, setSubject] = useState(draft?.subject || "");
  const [body, setBody] = useState(draft?.body || "");
  const [deliveryStatus, setDeliveryStatus] = useState(draft?.delivery_status || "draft");
  const [confirmSend, setConfirmSend] = useState(false);
  const [state, setState] = useState<ActionState>({ busy: "", notice: "", error: "" });

  if (!draft) return null;

  async function saveDraft() {
    if (!draft) return;
    setState({ busy: "save", notice: "", error: "" });
    try {
      await api<Email>(`/api/emails/${draft.id}`, { method: "PATCH", body: JSON.stringify({ subject, body }) });
      setState({ busy: "", notice: t("Draft saved. Nothing was sent."), error: "" });
      onUpdated();
    } catch (err) {
      setState({ busy: "", notice: "", error: friendlyErrorMessage(err, t("Draft could not be saved.")) });
    }
  }

  async function approveDraft() {
    if (!draft) return;
    setState({ busy: "approve", notice: "", error: "" });
    try {
      await api<WorkspaceAppActionResponse>(`/api/workspace-app/emails/${draft.id}/approve`, { method: "POST" });
      setDeliveryStatus("approved");
      setState({ busy: "", notice: t("Email approved. It is ready to send, but nothing was sent automatically."), error: "" });
      onUpdated();
    } catch (err) {
      setState({ busy: "", notice: "", error: friendlyErrorMessage(err, t("Email approval could not be completed.")) });
    }
  }

  async function sendDraft() {
    if (!draft || deliveryStatus !== "approved") return;
    if (!confirmSend) {
      setConfirmSend(true);
      setState({ busy: "", notice: t("Confirm the recipient and click Confirm send. Nothing has been sent yet."), error: "" });
      return;
    }
    setState({ busy: "send", notice: "", error: "" });
    try {
      await api<WorkspaceAppActionResponse>(`/api/workspace-app/emails/${draft.id}/send`, { method: "POST", timeoutMs: 30000 });
      setDeliveryStatus("sent");
      setState({ busy: "", notice: t("Approved email was sent. CRM stage updated."), error: "" });
      setConfirmSend(false);
      onUpdated();
    } catch (err) {
      setState({ busy: "", notice: "", error: friendlyErrorMessage(err, t("Email could not be sent. The draft remains saved.")) });
    }
  }

  const recipient = contactEmail(company);
  const canSend = deliveryStatus === "approved" && Boolean(recipient) && Boolean(senderStatus?.connected);

  return (
    <article className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-black text-ink">{company.name}</h2>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-600">{t(deliveryStatus)}</span>
          </div>
          <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">{t("Recipient")}: {recipient || t("No verified recipient email yet")}</p>
        </div>
        <Link href={`/dashboard/crm?company=${encodeURIComponent(company.id)}`} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-3 text-sm font-black text-ink">{t("Open CRM")} <ArrowRight size={15} /></Link>
      </div>
      <div className="mt-5 grid gap-4">
        <label className="text-sm font-black text-ink">{t("Subject")}
          <input value={subject} onChange={(event) => setSubject(event.target.value)} disabled={deliveryStatus === "sent"} className="mt-2 min-h-12 w-full rounded-xl border border-slate-300 px-3 text-sm font-semibold disabled:bg-slate-100" />
        </label>
        <label className="text-sm font-black text-ink">{t("Message")}
          <textarea value={body} onChange={(event) => setBody(event.target.value)} disabled={deliveryStatus === "sent"} rows={7} className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-3 text-sm font-semibold leading-6 disabled:bg-slate-100" />
        </label>
      </div>
      {!senderStatus?.connected ? <div className="mt-4"><StateBanner tone="warning">{t(senderStatus?.next_action || "Connect a verified sender before sending. You can still save drafts.")}</StateBanner></div> : null}
      {confirmSend ? <div className="mt-4"><StateBanner tone="warning">{t("This sends one email to the saved recipient. Confirm only after reviewing the content.")}</StateBanner></div> : null}
      {state.notice ? <div className="mt-4"><StateBanner tone="success">{state.notice}</StateBanner></div> : null}
      {state.error ? <div className="mt-4"><StateBanner tone="error">{state.error}</StateBanner></div> : null}
      <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Button variant="secondary" onClick={saveDraft} disabled={state.busy === "save" || deliveryStatus === "sent"}>
          {state.busy === "save" ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
          {t("Save as draft")}
        </Button>
        <Button variant="secondary" onClick={approveDraft} disabled={state.busy === "approve" || deliveryStatus === "approved" || deliveryStatus === "sent"}>
          {state.busy === "approve" ? <Loader2 className="animate-spin" size={16} /> : <CheckCircle2 size={16} />}
          {t("Approve")}
        </Button>
        <Button onClick={sendDraft} disabled={state.busy === "send" || !canSend}>
          {state.busy === "send" ? <Loader2 className="animate-spin" size={16} /> : <Send size={16} />}
          {confirmSend ? t("Confirm send") : t("Send manually")}
        </Button>
      </div>
    </article>
  );
}

export function CoreMailPage() {
  const data = useCoreWorkspaceData();
  const { t } = useI18n();
  const draftCompanies = data.companies.filter((company) => latestDraft(company));
  const replyEvents = data.companies.filter((company) => company.replied_at);

  return (
    <div className="space-y-6">
      <PageIntro
        eyebrow="Mail"
        title="Review drafts, send manually, track replies."
        copy="Every email is draft-only until you save edits, approve the message and confirm the send. Replies and delivery events update CRM status."
        action={<Link href="/dashboard/crm" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-brand px-4 text-sm font-black text-white">{t("Open CRM")} <ArrowRight size={17} /></Link>}
      />
      {data.loading && !data.companies.length ? <LoadingWorkspace /> : null}
      {data.error ? <StateBanner tone="error">{data.error}</StateBanner> : null}
      <Card>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.14em] text-brand">{t("Sending safety")}</p>
            <h2 className="mt-1 text-2xl font-black text-ink">{t("No automatic email sending.")}</h2>
            <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">{t("A draft must be saved, approved and confirmed before the backend sends one email.")}</p>
          </div>
          <Button variant="secondary" onClick={data.refresh}><RefreshCw size={16} />{t("Refresh")}</Button>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-3">
          <ResultStat label="Drafts" value={draftCompanies.length ? String(draftCompanies.length) : "None"} detail="Prepared emails waiting for review." />
          <ResultStat label="Sender" value={data.senderStatus?.connected ? "Connected" : "Not ready"} detail={data.senderStatus?.connected ? "Manual sending can be confirmed." : "Drafts can be saved until setup is complete."} />
          <ResultStat label="Replies" value={replyEvents.length ? String(replyEvents.length) : "No replies"} detail="Reply events are recorded after sending." />
        </div>
      </Card>

      <section className="grid gap-4">
        {draftCompanies.map((company) => (
          <DraftCard key={`${company.id}:${latestDraft(company)?.id || "no-draft"}`} company={company} senderStatus={data.senderStatus} api={data.api} onUpdated={data.refresh} />
        ))}
        {!draftCompanies.length && !data.loading ? (
          <EmptyState title="No drafts ready yet" copy="Save a company to CRM, then prepare the first email. Drafts will appear here for manual review." action={<Link href="/dashboard/crm" className="inline-flex min-h-11 items-center justify-center rounded-xl bg-brand px-4 text-sm font-black text-white">{t("Open CRM")}</Link>} />
        ) : null}
      </section>

      <Card>
        <div className="flex items-center gap-2">
          <Inbox size={20} className="text-brand" />
          <h2 className="text-2xl font-black text-ink">{t("Replies and status")}</h2>
        </div>
        <div className="mt-5 grid gap-3">
          {replyEvents.map((company) => (
            <Link key={company.id} href={`/dashboard/crm?company=${encodeURIComponent(company.id)}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="font-black text-ink">{company.name}</p>
              <p className="mt-1 text-sm font-semibold text-slate-600">{t("Reply received")}: {formatDate(company.replied_at)}</p>
            </Link>
          ))}
          {!replyEvents.length ? <p className="rounded-2xl bg-slate-50 p-4 text-sm font-semibold leading-6 text-slate-600">{t("No replies yet. After manual sends, delivery and reply events will appear here when webhooks are configured.")}</p> : null}
          {data.inbox.length ? <p className="text-sm font-semibold text-slate-500">{t("Inbox events loaded")}: {data.inbox.length}</p> : null}
        </div>
      </Card>
    </div>
  );
}
