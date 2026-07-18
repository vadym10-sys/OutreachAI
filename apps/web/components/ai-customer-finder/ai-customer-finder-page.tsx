"use client";

import { useAuth } from "@clerk/nextjs";
import { CheckCircle2, ExternalLink, Loader2, Mail, Save, Search, Send, StopCircle } from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useAuthRuntime } from "@/components/app-providers";
import { AppBadge, AppButton, PageHero, SectionPanel, SurfaceCard } from "@/components/design-system";
import { clientApi, friendlyErrorMessage } from "@/lib/client-api";
import { isClerkE2EBypass, isProductionRuntime } from "@/lib/env";

type FinderResult = {
  id: string;
  company_name: string;
  official_website: string;
  industry: string;
  country: string;
  contact_name: string;
  contact_title: string;
  public_work_contact: string;
  signal_description: string;
  source_url: string;
  source_title: string;
  fit_explanation: string;
  verified_status: string;
  lead_id: string;
  company_id: string;
  simple_status: string;
  email_id: string;
  email_subject: string;
  email_body: string;
  email_delivery_status: string;
  can_send: boolean;
};

type FinderJob = {
  id: string;
  status: string;
  progress: { stage?: string; message?: string; percent?: number; saved?: number; candidates?: number; warnings?: string[] };
  summary?: { saved?: number; candidates?: number; warnings?: string[] };
  error_message: string;
  results: FinderResult[];
  created_at: string;
  completed_at?: string | null;
};

type ResultActionResponse = {
  status: string;
  message: string;
  result: FinderResult;
};

const terminalStatuses = new Set(["completed", "partially_completed", "failed"]);

const stageLabels: Record<string, string> = {
  queued: "Preparing search",
  searching: "Finding companies",
  verifying: "Checking source and email",
  enriching: "Saving to CRM and writing email",
  completed: "Ready to review",
  partially_completed: "Ready with partial results",
  failed: "No verified leads found",
};

async function devApi<T>(path: string, init = {}) {
  return clientApi<T>(path, "dev", init);
}

function useOptionalAuth(clerkEnabled: boolean) {
  if (!clerkEnabled || isClerkE2EBypass) {
    return {
      getToken: async () => (isClerkE2EBypass ? "dev" : null),
      isLoaded: !clerkEnabled || isClerkE2EBypass,
      isSignedIn: isClerkE2EBypass,
    };
  }
  // The no-Clerk branch above is required for local/E2E builds where ClerkProvider is intentionally not mounted.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useAuth();
}

function useFinderApi() {
  const { clerkEnabled } = useAuthRuntime();
  const auth = useOptionalAuth(clerkEnabled);
  const getToken = auth.getToken;
  const ready = isClerkE2EBypass || (!clerkEnabled && !isProductionRuntime) || (auth.isLoaded && Boolean(auth.isSignedIn));
  const api = useCallback(async function api<T>(path: string, init = {}) {
    if (isClerkE2EBypass || (!clerkEnabled && !isProductionRuntime)) return devApi<T>(path, init);
    const token = await getToken({ skipCache: true });
    return clientApi<T>(path, token, init);
  }, [clerkEnabled, getToken]);
  return { api, ready };
}

export function AiCustomerFinderPage() {
  const { api, ready } = useFinderApi();
  const [companyWebsite, setCompanyWebsite] = useState("");
  const [desiredCustomers, setDesiredCustomers] = useState("");
  const [job, setJob] = useState<FinderJob | null>(null);
  const [history, setHistory] = useState<FinderJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const activeJob = Boolean(job && !terminalStatuses.has(job.status));
  const savedCount = useMemo(() => job?.results.filter((item) => item.company_id || item.lead_id).length || 0, [job]);
  const readyResults = useMemo(() => (job?.results || []).filter((item) => item.source_url && item.company_id), [job]);

  const refreshJob = useCallback(async (jobId: string) => {
    const next = await api<FinderJob>(`/api/workspace-app/ai-customer-finder/searches/${jobId}`);
    setJob(next);
    return next;
  }, [api]);

  useEffect(() => {
    if (!ready) return;
    let mounted = true;
    api<FinderJob[]>("/api/workspace-app/ai-customer-finder/searches")
      .then((items) => {
        if (!mounted) return;
        setHistory(items);
        setJob((current) => current || items[0] || null);
      })
      .catch((err) => setError(friendlyErrorMessage(err, "Customer Finder history could not load.")));
    return () => {
      mounted = false;
    };
  }, [api, ready]);

  useEffect(() => {
    if (!activeJob || !job?.id) return;
    const timer = window.setInterval(() => {
      refreshJob(job.id).catch((err) => setError(friendlyErrorMessage(err, "Search progress could not update.")));
    }, 2200);
    return () => window.clearInterval(timer);
  }, [activeJob, job?.id, refreshJob]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const payload = {
        company_website: companyWebsite,
        desired_customers: desiredCustomers,
        company_description: companyWebsite,
        product_or_service: desiredCustomers,
        target_country: "Any",
        target_industry: "B2B",
        company_size: "",
        contact_titles: ["Founder", "CEO", "Head of Sales"],
        max_results: 5,
        additional_criteria: desiredCustomers,
        keywords: [],
        exclusions: [],
      };
      const next = await api<FinderJob>("/api/workspace-app/ai-customer-finder/searches", {
        method: "POST",
        body: JSON.stringify(payload),
        timeoutMs: 15000,
      });
      setJob(next);
      setHistory((items) => [next, ...items.filter((item) => item.id !== next.id)]);
    } catch (err) {
      setError(friendlyErrorMessage(err, "Customer search could not start."));
    } finally {
      setLoading(false);
    }
  }

  async function cancelJob() {
    if (!job?.id) return;
    setLoading(true);
    try {
      setJob(await api<FinderJob>(`/api/workspace-app/ai-customer-finder/searches/${job.id}/cancel`, { method: "POST" }));
    } catch (err) {
      setError(friendlyErrorMessage(err, "Search could not be stopped."));
    } finally {
      setLoading(false);
    }
  }

  async function resultAction(resultId: string, action: "draft" | "send") {
    setError("");
    setNotice("");
    try {
      const response = await api<ResultActionResponse>(`/api/workspace-app/ai-customer-finder/results/${resultId}/${action}`, { method: "POST" });
      setNotice(response.message);
      setJob((current) => {
        if (!current) return current;
        return {
          ...current,
          results: current.results.map((item) => (item.id === response.result.id ? response.result : item)),
        };
      });
    } catch (err) {
      setError(friendlyErrorMessage(err, action === "send" ? "Email could not be sent." : "Draft could not be saved."));
    }
  }

  const progressPercent = Math.max(0, Math.min(100, Number(job?.progress?.percent || 0)));
  const stage = String(job?.progress?.stage || job?.status || "queued");

  return (
    <div className="space-y-6">
      <PageHero
        eyebrow="AI Customer Finder"
        title="Find a customer, save the lead, write the email."
        copy="Enter your website and the customers you want. OutreachAI finds public B2B leads, saves them to CRM without duplicates, and prepares a short first email for review."
        action={activeJob ? <AppButton variant="secondary" onClick={cancelJob} disabled={loading}><StopCircle size={17} /> Stop</AppButton> : undefined}
      />

      {error ? <SurfaceCard tone="warning" className="rounded-[1.25rem] text-sm font-semibold text-amber-900">{error}</SurfaceCard> : null}
      {notice ? <SurfaceCard className="rounded-[1.25rem] text-sm font-semibold text-emerald-800">{notice}</SurfaceCard> : null}

      <section className="grid gap-5 xl:grid-cols-[0.9fr_1.35fr]">
        <SectionPanel eyebrow="Start" title="Two inputs. One job." copy="No dashboards or reports. The goal is a CRM lead with a ready first email.">
          <form onSubmit={submit} className="space-y-4">
            <label className="block text-sm font-bold text-slate-700">
              1. Your company website
              <input
                type="url"
                value={companyWebsite}
                required
                onChange={(event) => setCompanyWebsite(event.target.value)}
                placeholder="https://yourcompany.com"
                className="mt-2 min-h-12 w-full rounded-2xl border border-[var(--ui-border)] bg-white px-4 text-sm outline-none focus:ring-2 focus:ring-brand/30"
              />
            </label>
            <label className="block text-sm font-bold text-slate-700">
              2. Who should we find?
              <textarea
                value={desiredCustomers}
                required
                onChange={(event) => setDesiredCustomers(event.target.value)}
                placeholder="B2B SaaS companies in Europe with sales teams that need better outbound research."
                className="mt-2 min-h-32 w-full rounded-2xl border border-[var(--ui-border)] bg-white px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-brand/30"
              />
            </label>
            <AppButton type="submit" disabled={!ready || loading || Boolean(activeJob)}>
              {loading ? <Loader2 className="animate-spin" size={17} /> : <Search size={17} />} Find leads
            </AppButton>
          </form>

          <div className="mt-6 grid gap-2">
            {["Find company", "Find email", "Save to CRM", "Write email", "Send or draft"].map((label, index) => (
              <div key={label} className="flex items-center gap-3 rounded-2xl bg-slate-50 px-3 py-2 text-sm font-bold text-slate-700">
                <span className="grid size-7 place-items-center rounded-full bg-white text-xs text-brand">{index + 1}</span>
                {label}
              </div>
            ))}
          </div>
        </SectionPanel>

        <div className="space-y-5">
          <SurfaceCard className="rounded-[1.5rem]">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.16em] text-brand">Progress</p>
                <h2 className="mt-1 text-2xl font-black text-ink">{stageLabels[stage] || stageLabels[job?.status || "queued"] || "Ready"}</h2>
                <p className="mt-1 text-sm leading-6 text-slate-600">{job?.progress?.message || "Start a search to create CRM-ready leads."}</p>
              </div>
              {activeJob ? <Loader2 className="animate-spin text-brand" size={26} /> : <CheckCircle2 className="text-emerald-600" size={26} />}
            </div>
            <div className="mt-5 h-2 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${progressPercent}%` }} />
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <Stat label="Saved leads" value={savedCount} />
              <Stat label="Ready emails" value={readyResults.filter((item) => item.email_id).length} />
              <Stat label="Found companies" value={job?.results.length || 0} />
            </div>
          </SurfaceCard>

          <SectionPanel eyebrow="Leads" title="Saved in CRM with a ready first email." copy="Only useful fields are shown: company, website, contact, email, source, reason, status, and draft.">
            {readyResults.length ? (
              <div className="space-y-3">
                {readyResults.map((item) => (
                  <LeadCard key={item.id} item={item} onDraft={() => resultAction(item.id, "draft")} onSend={() => resultAction(item.id, "send")} />
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
                <Mail className="mx-auto text-brand" size={30} />
                <h2 className="mt-3 text-lg font-black text-ink">No leads ready yet</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  {job?.status === "failed" ? "No company had enough public evidence. Try a broader customer description." : "The first saved lead will appear here as soon as the worker verifies the company and prepares the email."}
                </p>
              </div>
            )}
          </SectionPanel>

          {history.length > 1 ? (
            <SurfaceCard className="rounded-[1.5rem]">
              <p className="text-sm font-black uppercase text-brand">Recent searches</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {history.slice(0, 5).map((item) => (
                  <button key={item.id} type="button" onClick={() => setJob(item)} className="rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700">
                    {(stageLabels[item.status] || item.status)} · {item.results.length} leads
                  </button>
                ))}
              </div>
            </SurfaceCard>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3">
      <p className="text-xs font-black uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-black text-ink">{value}</p>
    </div>
  );
}

function LeadCard({ item, onDraft, onSend }: { item: FinderResult; onDraft: () => void; onSend: () => void }) {
  const status = item.simple_status || (item.email_delivery_status === "sent" ? "Отправлено" : item.email_id ? "Письмо подготовлено" : "Найден");
  return (
    <article className="rounded-2xl border border-[var(--ui-border)] bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-black text-ink">{item.company_name}</h3>
            <AppBadge tone={item.company_id ? "success" : "warning"}>{item.company_id ? "Saved to CRM" : "Saving"}</AppBadge>
            <AppBadge tone="brand">{status}</AppBadge>
          </div>
          <p className="mt-1 text-sm font-semibold text-slate-600">{item.industry || "Industry unknown"} · {item.country || "Country unknown"}</p>
        </div>
        <a href={item.official_website || item.source_url} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center gap-2 rounded-full border border-slate-200 px-3 text-sm font-bold text-ink">
          Website <ExternalLink size={14} />
        </a>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <Info label="Contact" value={[item.contact_name, item.contact_title].filter(Boolean).join(" · ") || item.contact_title || "Recommended role not confirmed"} />
        <Info label="Email" value={item.public_work_contact || "No verified email yet"} />
        <Info label="Source" value={item.source_title || item.source_url} href={item.source_url} />
        <Info label="Why this company" value={item.fit_explanation || item.signal_description || "Public source matched the customer description."} />
      </div>

      <div className="mt-4 rounded-2xl bg-slate-950 p-4 text-white">
        <p className="text-xs font-black uppercase tracking-wide text-white/60">First email</p>
        <p className="mt-2 text-sm font-black">{item.email_subject || "Draft email"}</p>
        <pre className="mt-3 whitespace-pre-wrap text-sm leading-6 text-white/90">{item.email_body || "Email draft is being prepared."}</pre>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <AppButton variant="secondary" onClick={onDraft} disabled={!item.email_id || item.email_delivery_status === "sent"}>
          <Save size={16} /> Сохранить как черновик
        </AppButton>
        <AppButton onClick={onSend} disabled={!item.can_send || !item.public_work_contact || item.email_delivery_status === "sent"}>
          <Send size={16} /> Отправить
        </AppButton>
      </div>
    </article>
  );
}

function Info({ label, value, href }: { label: string; value: string; href?: string }) {
  return (
    <div className="rounded-2xl bg-slate-50 p-3">
      <p className="text-xs font-black uppercase tracking-wide text-slate-500">{label}</p>
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" className="mt-1 inline-flex min-w-0 items-center gap-1 break-all text-sm font-bold text-brand">
          {value} <ExternalLink size={13} />
        </a>
      ) : (
        <p className="mt-1 text-sm font-semibold leading-6 text-slate-700">{value}</p>
      )}
    </div>
  );
}
