"use client";

import { useAuth } from "@clerk/nextjs";
import { ExternalLink, Loader2, Search, ShieldCheck, StopCircle } from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useAuthRuntime } from "@/components/app-providers";
import { AppBadge, AppButton, MetricSurface, PageHero, SectionPanel, SurfaceCard } from "@/components/design-system";
import { clientApi, friendlyErrorMessage, splitList } from "@/lib/client-api";
import { isClerkE2EBypass, isProductionRuntime } from "@/lib/env";

type FinderResult = {
  id: string;
  company_name: string;
  official_website: string;
  industry: string;
  country: string;
  company_size: string;
  contact_name: string;
  contact_title: string;
  public_work_contact: string;
  signal_type: string;
  signal_description: string;
  signal_date: string;
  source_url: string;
  source_title: string;
  source_type: string;
  evidence_excerpt: string;
  evidence_summary: string;
  fit_explanation: string;
  ai_relevance_score: number;
  confidence_score: number;
  verified_status: string;
  checked_at: string;
  source_provider: string;
  lead_id: string;
  company_id: string;
  score_delta: number;
  intent_alert: boolean;
  intent_timeline: Array<{
    change_type?: string;
    detected_at?: string;
    signal?: string;
    previous_score?: number | null;
    current_score?: number;
    score_delta?: number;
    source_url?: string;
  }>;
};

type FinderJob = {
  id: string;
  status: string;
  progress: { stage?: string; message?: string; percent?: number; warnings?: string[] };
  criteria: Record<string, unknown>;
  error_message: string;
  results: FinderResult[];
  created_at: string;
  completed_at?: string | null;
};

const initialForm = {
  company_description: "",
  product_or_service: "",
  target_country: "",
  target_industry: "",
  company_size: "",
  contact_titles: "Founder, CEO, Head of Sales",
  max_results: "10",
  keywords: "",
  exclusions: "",
  additional_criteria: "",
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
  const [form, setForm] = useState(initialForm);
  const [job, setJob] = useState<FinderJob | null>(null);
  const [history, setHistory] = useState<FinderJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [verifiedOnly, setVerifiedOnly] = useState(true);
  const [error, setError] = useState("");

  const activeJob = job && !["completed", "partially_completed", "failed"].includes(job.status);
  const visibleResults = useMemo(() => {
    const items = job?.results || [];
    return verifiedOnly ? items.filter((item) => item.verified_status === "verified" && item.source_url) : items;
  }, [job, verifiedOnly]);

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
      .catch((err) => setError(friendlyErrorMessage(err, "AI Customer Finder history could not load.")));
    return () => {
      mounted = false;
    };
  }, [api, ready]);

  useEffect(() => {
    if (!activeJob || !job?.id) return;
    const timer = window.setInterval(() => {
      refreshJob(job.id).catch((err) => setError(friendlyErrorMessage(err, "AI Customer Finder progress could not update.")));
    }, 2500);
    return () => window.clearInterval(timer);
  }, [activeJob, job?.id, refreshJob]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const payload = {
        company_description: form.company_description,
        product_or_service: form.product_or_service,
        target_country: form.target_country,
        target_industry: form.target_industry,
        company_size: form.company_size,
        contact_titles: splitList(form.contact_titles),
        max_results: Number(form.max_results || 10),
        additional_criteria: form.additional_criteria,
        keywords: splitList(form.keywords),
        exclusions: splitList(form.exclusions),
      };
      const next = await api<FinderJob>("/api/workspace-app/ai-customer-finder/searches", {
        method: "POST",
        body: JSON.stringify(payload),
        timeoutMs: 15000,
      });
      setJob(next);
      setHistory((items) => [next, ...items.filter((item) => item.id !== next.id)]);
    } catch (err) {
      setError(friendlyErrorMessage(err, "AI Customer Finder could not start."));
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
      setError(friendlyErrorMessage(err, "AI Customer Finder could not be stopped."));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHero
        eyebrow="AI Customer Finder"
        title="Find companies with verified public intent signals."
        copy="Search approved public sources, verify every result, score fit, and save confirmed companies into the existing CRM without sending outreach."
        action={activeJob ? <AppButton variant="secondary" onClick={cancelJob} disabled={loading}><StopCircle size={17} /> Stop search</AppButton> : undefined}
      />

      {error ? <SurfaceCard tone="warning" className="rounded-[1.5rem] text-sm font-semibold text-amber-900">{error}</SurfaceCard> : null}

      <section className="grid gap-5 xl:grid-cols-[0.95fr_1.4fr]">
        <SectionPanel eyebrow="Search criteria" title="Describe the customers worth finding." copy="The search only returns records with a verified public source URL. Unknown fields stay blank.">
          <form onSubmit={submit} className="grid gap-4">
            <Field label="Your company" value={form.company_description} onChange={(value) => setForm({ ...form, company_description: value })} placeholder="AI platform for outbound sales teams" required />
            <Field label="Product or service" value={form.product_or_service} onChange={(value) => setForm({ ...form, product_or_service: value })} placeholder="Finds companies with buying signals and drafts reviewed outreach" required />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Target country" value={form.target_country} onChange={(value) => setForm({ ...form, target_country: value })} placeholder="Germany" required />
              <Field label="Target industry" value={form.target_industry} onChange={(value) => setForm({ ...form, target_industry: value })} placeholder="B2B SaaS" required />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Company size" value={form.company_size} onChange={(value) => setForm({ ...form, company_size: value })} placeholder="10-200 employees" />
              <Field label="Max results" type="number" value={form.max_results} onChange={(value) => setForm({ ...form, max_results: value })} placeholder="10" />
            </div>
            <Field label="Contact roles" value={form.contact_titles} onChange={(value) => setForm({ ...form, contact_titles: value })} placeholder="Founder, CEO, Head of Sales" />
            <Field label="Keywords" value={form.keywords} onChange={(value) => setForm({ ...form, keywords: value })} placeholder="sales automation, CRM, outbound" />
            <Field label="Exclusions" value={form.exclusions} onChange={(value) => setForm({ ...form, exclusions: value })} placeholder="agencies, freelancers" />
            <label className="text-sm font-bold text-slate-700">Additional criteria<textarea value={form.additional_criteria} onChange={(event) => setForm({ ...form, additional_criteria: event.target.value })} className="mt-2 min-h-28 w-full rounded-2xl border border-[var(--ui-border)] bg-white px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-brand/30" placeholder="Look for teams hiring SDRs or describing manual lead research." /></label>
            <AppButton type="submit" disabled={!ready || loading || Boolean(activeJob)}>{loading ? <Loader2 className="animate-spin" size={17} /> : <Search size={17} />} Start verified search</AppButton>
          </form>
        </SectionPanel>

        <div className="space-y-5">
          <section className="grid gap-3 sm:grid-cols-3">
            <MetricSurface label="Status" value={job?.status || "No search"} detail={job?.progress?.message || "Start a search to build CRM-ready accounts."} />
            <MetricSurface label="Progress" value={`${job?.progress?.percent || 0}%`} detail={job?.progress?.stage || "Waiting"} />
            <MetricSurface label="Verified results" value={visibleResults.length} detail="Saved or ready inside CRM with source evidence." />
          </section>

          <SectionPanel eyebrow="Results" title="Verified companies saved to CRM." copy="Every material claim links back to a public source. Unverified records are hidden by default.">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <label className="inline-flex items-center gap-2 text-sm font-bold text-slate-700">
                <input type="checkbox" checked={verifiedOnly} onChange={(event) => setVerifiedOnly(event.target.checked)} className="size-4 rounded border-slate-300" />
                Verified only
              </label>
              {activeJob ? <span className="inline-flex items-center gap-2 text-sm font-bold text-brand"><Loader2 className="animate-spin" size={16} /> Working in background</span> : null}
            </div>
            {visibleResults.length ? (
              <div className="overflow-hidden rounded-2xl border border-[var(--ui-border)] bg-white">
                <div className="grid gap-0 divide-y divide-slate-100">
                  {visibleResults.map((item) => <ResultRow key={item.id} item={item} />)}
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
                <ShieldCheck className="mx-auto text-brand" size={28} />
                <h2 className="mt-3 text-lg font-black text-ink">No verified results yet</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">The system will keep partial progress and only show companies with source evidence.</p>
              </div>
            )}
          </SectionPanel>

          {history.length > 1 ? (
            <SurfaceCard className="rounded-[1.5rem]">
              <p className="text-sm font-black uppercase text-brand">Recent searches</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {history.slice(0, 6).map((item) => (
                  <button key={item.id} type="button" onClick={() => setJob(item)} className="rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700">
                    {item.status} · {item.results.length} results
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

function Field({ label, value, onChange, placeholder, required, type = "text" }: { label: string; value: string; onChange: (value: string) => void; placeholder: string; required?: boolean; type?: string }) {
  return (
    <label className="text-sm font-bold text-slate-700">
      {label}
      <input
        type={type}
        value={value}
        required={required}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="mt-2 min-h-12 w-full rounded-2xl border border-[var(--ui-border)] bg-white px-4 text-sm outline-none focus:ring-2 focus:ring-brand/30"
      />
    </label>
  );
}

function ResultRow({ item }: { item: FinderResult }) {
  const timeline = Array.isArray(item.intent_timeline) ? item.intent_timeline.slice(-3) : [];
  return (
    <article className="grid gap-4 p-4 lg:grid-cols-[1fr_auto] lg:items-start">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-lg font-black text-ink">{item.company_name}</h3>
          <AppBadge tone={item.verified_status === "verified" ? "success" : "warning"}>{item.verified_status}</AppBadge>
          <AppBadge tone="brand">{item.signal_type.replaceAll("_", " ")}</AppBadge>
          {item.intent_alert ? <AppBadge tone="success">Intent alert</AppBadge> : null}
          {item.score_delta > 0 ? <AppBadge tone="warning">Intent +{item.score_delta}</AppBadge> : null}
        </div>
        <p className="mt-2 text-sm font-semibold text-slate-600">{item.industry || "Industry unknown"} · {item.country || "Country unknown"} · {item.company_size || "Size unverified"}</p>
        <p className="mt-3 text-sm leading-6 text-slate-700">{item.signal_description}</p>
        <p className="mt-2 rounded-2xl bg-slate-50 p-3 text-sm leading-6 text-slate-700">{item.evidence_summary || item.evidence_excerpt}</p>
        <div className="mt-3 flex flex-wrap gap-2 text-sm font-bold">
          <a href={item.source_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-2 text-ink">
            Source <ExternalLink size={14} />
          </a>
          {item.company_id ? <span className="rounded-full bg-teal-50 px-3 py-2 text-brand">Saved to CRM</span> : null}
          {item.contact_title ? <span className="rounded-full bg-slate-100 px-3 py-2 text-slate-700">Recommended role: {item.contact_title}</span> : null}
        </div>
        {timeline.length ? (
          <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-3">
            <p className="text-xs font-black uppercase tracking-wide text-slate-500">Intent timeline</p>
            <div className="mt-3 space-y-2">
              {timeline.map((event, index) => (
                <div key={`${event.detected_at || "event"}-${index}`} className="flex items-start gap-3 text-sm">
                  <span className="mt-1 size-2 rounded-full bg-brand" aria-hidden="true" />
                  <p className="min-w-0 flex-1 text-slate-700">
                    <span className="font-bold text-ink">{event.change_type?.replaceAll("_", " ") || "intent signal"}</span>
                    {typeof event.previous_score === "number" && typeof event.current_score === "number" ? <span> moved score {event.previous_score} → {event.current_score}</span> : null}
                    {event.signal ? <span className="block truncate text-slate-500">{event.signal}</span> : null}
                  </p>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
      <div className="grid min-w-36 grid-cols-2 gap-2 text-center lg:grid-cols-1">
        <div className="rounded-2xl bg-[#101114] px-4 py-3 text-white">
          <p className="text-xs font-bold uppercase text-white/60">Relevance</p>
          <p className="text-2xl font-black">{item.ai_relevance_score}</p>
        </div>
        <div className="rounded-2xl bg-slate-100 px-4 py-3 text-ink">
          <p className="text-xs font-bold uppercase text-slate-500">Confidence</p>
          <p className="text-2xl font-black">{item.confidence_score}</p>
        </div>
      </div>
    </article>
  );
}
