"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2, ChevronDown, ExternalLink, Loader2, Mail, RefreshCw, Send, Settings, Sparkles, UsersRound } from "lucide-react";
import { friendlyErrorMessage } from "@/lib/client-api";
import { latestDraftForResult, useAiFirstApi, type AiAssistantCommand } from "@/lib/ai-first-api";
import type { FirstCustomerJob, FirstCustomerResult, WorkspaceIntegrationStatus } from "@/lib/customer-api-contracts";
import type { CrmCompany, Email, Workspace } from "@/lib/types";

type Section = "assistant" | "clients" | "emails" | "settings";

const blankCommand: AiAssistantCommand = {
  command: "",
  companyWebsite: "",
  companyDescription: "",
  productOrService: "",
  desiredCustomers: "",
  targetCountry: "",
  targetIndustry: "",
  companySize: "",
  contactTitles: ["Founder", "Head of Sales", "Operations Lead"],
  keywords: [],
  exclusions: [],
  maxResults: 10
};

function csv(value: string) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function pretty(value: string) {
  const text = value.replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function latestEmail(company: CrmCompany) {
  return company.generated_emails?.[0] || null;
}

function sourceUrl(result: FirstCustomerResult) {
  return result.canonical_source_url || result.source_url;
}

function uniqueEmails(companies: CrmCompany[], inbox: Email[]) {
  const byId = new Map<string, Email>();
  for (const company of companies) for (const email of company.generated_emails || []) byId.set(email.id, email);
  for (const email of inbox) byId.set(email.id, email);
  return [...byId.values()];
}

function Frame({ title, copy, children }: { title: string; copy: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
      <div>
        <h1 className="text-2xl font-black tracking-tight text-ink sm:text-3xl">{title}</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{copy}</p>
      </div>
      {children}
    </div>
  );
}

function Notice({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "good" | "bad" }) {
  const toneClass = tone === "good" ? "border-teal-200 bg-teal-50 text-teal-800" : tone === "bad" ? "border-red-200 bg-red-50 text-red-700" : "border-slate-200 bg-white text-slate-700";
  return <div className={`rounded-lg border p-3 text-sm font-semibold leading-6 ${toneClass}`}>{children}</div>;
}

function ResultCard({
  result,
  busy,
  onSave,
  onApprove,
  onSend
}: {
  result: FirstCustomerResult;
  busy: string;
  onSave(result: FirstCustomerResult): void;
  onApprove(result: FirstCustomerResult): void;
  onSend(result: FirstCustomerResult): void;
}) {
  const saved = Boolean(result.company_id || result.lead_id);
  const emailId = latestDraftForResult(result);
  const canSend = Boolean(emailId && result.public_work_contact);
  return (
    <article className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-black text-ink">{result.company_name}</h2>
            <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-black text-slate-700">{result.ai_relevance_score}/100 fit</span>
            <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-black text-slate-700">{result.confidence_score}/100 source</span>
          </div>
          <p className="mt-1 text-sm text-slate-600">{[result.industry, result.country, result.company_size].filter(Boolean).join(" · ") || "Company profile fields were not found yet."}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={Boolean(busy) || saved} onClick={() => onSave(result)} className="inline-flex min-h-10 items-center gap-2 rounded-md bg-ink px-3 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-50">
            {busy === `save:${result.id}` ? <Loader2 className="animate-spin" size={16} /> : <CheckCircle2 size={16} />} {saved ? "Saved" : "Save to CRM"}
          </button>
          <button type="button" disabled={Boolean(busy) || !emailId} onClick={() => onApprove(result)} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-slate-300 px-3 text-sm font-black text-ink disabled:cursor-not-allowed disabled:opacity-50">
            {busy === `approve:${result.id}` ? <Loader2 className="animate-spin" size={16} /> : <Mail size={16} />} Approve draft
          </button>
          <button type="button" disabled={Boolean(busy) || !canSend} onClick={() => onSend(result)} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-slate-300 px-3 text-sm font-black text-ink disabled:cursor-not-allowed disabled:opacity-50">
            {busy === `send:${result.id}` ? <Loader2 className="animate-spin" size={16} /> : <Send size={16} />} Send approved
          </button>
        </div>
      </div>
      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        <div className="rounded-lg bg-slate-50 p-3"><p className="text-xs font-black uppercase text-slate-500">Why it fits</p><p className="mt-2 text-sm leading-6 text-slate-700">{result.fit_explanation || result.signal_description || "No fit explanation returned."}</p></div>
        <div className="rounded-lg bg-slate-50 p-3"><p className="text-xs font-black uppercase text-slate-500">Public source</p><p className="mt-2 text-sm leading-6 text-slate-700">{result.evidence_summary || result.observed_fact || "No evidence summary returned."}</p></div>
        <div className="rounded-lg bg-slate-50 p-3"><p className="text-xs font-black uppercase text-slate-500">Recipient</p><p className="mt-2 text-sm leading-6 text-slate-700">{result.public_work_contact || "No verified public work email yet."}</p></div>
      </div>
      <details className="mt-3 rounded-lg border border-slate-200">
        <summary className="flex cursor-pointer items-center justify-between px-3 py-2 text-sm font-black text-ink">Подробнее <ChevronDown size={16} /></summary>
        <div className="grid gap-3 border-t border-slate-200 p-3 text-sm leading-6 text-slate-700 lg:grid-cols-2">
          <div>
            <p className="font-black text-ink">Source</p>
            {sourceUrl(result) ? <a href={sourceUrl(result)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 break-all font-bold text-teal-700">{result.source_title || sourceUrl(result)} <ExternalLink size={14} /></a> : <p>No source URL returned.</p>}
            <p className="mt-2">{result.evidence_excerpt || "No excerpt returned."}</p>
          </div>
          <div>
            <p className="font-black text-ink">Draft</p>
            <p className="mt-1 font-bold">{result.email_subject || "No subject yet."}</p>
            <p className="mt-2 whitespace-pre-wrap">{result.email_body || result.draft_email || "No email draft yet. Save the result to CRM when ready."}</p>
          </div>
        </div>
      </details>
    </article>
  );
}

function AssistantSection() {
  const api = useAiFirstApi();
  const [form, setForm] = useState(blankCommand);
  const [job, setJob] = useState<FirstCustomerJob | null>(null);
  const [jobs, setJobs] = useState<FirstCustomerJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadJobs = useCallback(async () => {
    if (!api.ready) return;
    try {
      const loaded = await api.listCustomerFinderJobs();
      setJobs(loaded);
      if (!job && loaded[0]) setJob(loaded[0]);
    } catch (err) {
      setError(friendlyErrorMessage(err, "Could not load AI customer searches."));
    }
  }, [api, job]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadJobs(), 0);
    return () => window.clearTimeout(timer);
  }, [loadJobs]);
  useEffect(() => {
    if (!job || ["completed", "partially_completed", "failed"].includes(job.status)) return undefined;
    const timer = window.setInterval(async () => {
      try {
        setJob(await api.getCustomerFinderJob(job.id));
      } catch (err) {
        setError(friendlyErrorMessage(err, "Could not refresh AI customer search."));
      }
    }, 2500);
    return () => window.clearInterval(timer);
  }, [api, job]);

  function update<K extends keyof AiAssistantCommand>(key: K, value: AiAssistantCommand[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    if (!form.command.trim() || !form.companyDescription.trim() || !form.productOrService.trim()) {
      setError("Describe your business, the task, and the customer you want OutreachAI to find.");
      return;
    }
    setLoading(true);
    try {
      const next = await api.startCustomerFinder(form);
      setJob(next);
      setJobs((current) => [next, ...current.filter((item) => item.id !== next.id)]);
      setNotice("AI customer search started. Results appear only after backend verifies public sources.");
    } catch (err) {
      setError(friendlyErrorMessage(err, "AI customer search could not start."));
    } finally {
      setLoading(false);
    }
  }

  async function refreshCurrent() {
    if (!job) return;
    setJob(await api.getCustomerFinderJob(job.id));
  }

  async function save(result: FirstCustomerResult) {
    setBusy(`save:${result.id}`);
    try {
      const response = await api.saveFinderResult(result.id);
      setNotice(response.message);
      await refreshCurrent();
    } catch (err) {
      setError(friendlyErrorMessage(err, "Could not save this client."));
    } finally {
      setBusy("");
    }
  }

  async function approve(result: FirstCustomerResult) {
    if (!result.email_id) return;
    setBusy(`approve:${result.id}`);
    try {
      const response = await api.approveEmail(result.email_id);
      setNotice(response.message);
      await refreshCurrent();
    } catch (err) {
      setError(friendlyErrorMessage(err, "Could not approve the draft."));
    } finally {
      setBusy("");
    }
  }

  async function send(result: FirstCustomerResult) {
    if (!result.email_id) return;
    if (!window.confirm("Send this approved email now? OutreachAI will not send anything without this confirmation.")) return;
    setBusy(`send:${result.id}`);
    try {
      const response = await api.sendApprovedEmail(result.email_id);
      setNotice(response.message);
      await refreshCurrent();
    } catch (err) {
      setError(friendlyErrorMessage(err, "Could not send the approved email."));
    } finally {
      setBusy("");
    }
  }

  const progressText = job ? Object.values(job.progress || {}).map(String).filter(Boolean).join(" · ") : "";

  return (
    <Frame title="AI-помощник" copy="Один помощник принимает задачу обычным языком, запускает реальный First Customer Finder и показывает только backend-результаты с публичными источниками.">
      <form aria-label="AI customer command" onSubmit={submit} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <label className="block text-sm font-black text-ink">AI command<textarea value={form.command} onChange={(event) => update("command", event.target.value)} className="mt-2 min-h-28 w-full rounded-md border border-slate-300 p-3 text-sm leading-6" placeholder="Find first customers for our B2B sales tool among companies with public hiring or growth signals." /></label>
        <div className="mt-4 grid gap-3 lg:grid-cols-3">
          <label className="text-sm font-bold text-slate-700">Company website<input value={form.companyWebsite} onChange={(event) => update("companyWebsite", event.target.value)} className="mt-2 min-h-10 w-full rounded-md border border-slate-300 px-3" placeholder="https://yourcompany.com" /></label>
          <label className="text-sm font-bold text-slate-700 lg:col-span-2">Business description<input value={form.companyDescription} onChange={(event) => update("companyDescription", event.target.value)} className="mt-2 min-h-10 w-full rounded-md border border-slate-300 px-3" placeholder="Describe your real business." /></label>
          <label className="text-sm font-bold text-slate-700">Product or service<input value={form.productOrService} onChange={(event) => update("productOrService", event.target.value)} className="mt-2 min-h-10 w-full rounded-md border border-slate-300 px-3" placeholder="What you sell." /></label>
          <label className="text-sm font-bold text-slate-700">Desired customers<input value={form.desiredCustomers} onChange={(event) => update("desiredCustomers", event.target.value)} className="mt-2 min-h-10 w-full rounded-md border border-slate-300 px-3" placeholder="Who should be found." /></label>
          <label className="text-sm font-bold text-slate-700">Country<input value={form.targetCountry} onChange={(event) => update("targetCountry", event.target.value)} className="mt-2 min-h-10 w-full rounded-md border border-slate-300 px-3" placeholder="Any" /></label>
          <label className="text-sm font-bold text-slate-700">Industry<input value={form.targetIndustry} onChange={(event) => update("targetIndustry", event.target.value)} className="mt-2 min-h-10 w-full rounded-md border border-slate-300 px-3" placeholder="B2B" /></label>
          <label className="text-sm font-bold text-slate-700">Contact titles<input value={form.contactTitles.join(", ")} onChange={(event) => update("contactTitles", csv(event.target.value))} className="mt-2 min-h-10 w-full rounded-md border border-slate-300 px-3" /></label>
          <label className="text-sm font-bold text-slate-700">Keywords<input value={form.keywords.join(", ")} onChange={(event) => update("keywords", csv(event.target.value))} className="mt-2 min-h-10 w-full rounded-md border border-slate-300 px-3" placeholder="Optional public signals" /></label>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="submit" disabled={loading || !api.ready} className="inline-flex min-h-11 items-center gap-2 rounded-md bg-ink px-4 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-60">{loading ? <Loader2 className="animate-spin" size={17} /> : <Sparkles size={17} />} Run First Customer Finder</button>
          <button type="button" onClick={() => void loadJobs()} className="inline-flex min-h-11 items-center gap-2 rounded-md border border-slate-300 px-4 text-sm font-black text-ink"><RefreshCw size={17} /> Refresh</button>
        </div>
      </form>
      {notice ? <Notice tone="good">{notice}</Notice> : null}
      {error ? <Notice tone="bad">{error}</Notice> : null}
      {job ? (
        <section className="grid gap-4">
          <div className="rounded-lg border border-slate-200 bg-white p-4"><p className="text-sm font-black text-ink">Search status: {pretty(job.status)}</p><p className="mt-1 text-sm text-slate-600">{progressText || job.error_message || "Waiting for backend progress."}</p></div>
          {job.results.length ? job.results.map((result) => <ResultCard key={result.id} result={result} busy={busy} onSave={save} onApprove={approve} onSend={send} />) : <Notice>Backend has not returned verified companies for this search yet.</Notice>}
        </section>
      ) : <Notice>No AI customer search has been run in this workspace yet.</Notice>}
      {jobs.length > 1 ? <details className="rounded-lg border border-slate-200 bg-white"><summary className="flex cursor-pointer items-center justify-between p-4 text-sm font-black text-ink">Previous searches <ChevronDown size={16} /></summary><div className="border-t border-slate-200 p-2">{jobs.slice(1).map((item) => <button key={item.id} type="button" onClick={() => setJob(item)} className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-slate-50"><span>{pretty(item.status)}</span><span className="font-bold">{item.results.length} result(s)</span></button>)}</div></details> : null}
    </Frame>
  );
}

function ClientsSection() {
  const api = useAiFirstApi();
  const [companies, setCompanies] = useState<CrmCompany[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!api.ready) return;
    setLoading(true);
    try {
      setCompanies(await api.listCompanies());
      setError("");
    } catch (err) {
      setError(friendlyErrorMessage(err, "Could not load saved clients."));
    } finally {
      setLoading(false);
    }
  }, [api]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  return (
    <Frame title="Клиенты" copy="Только компании, явно сохранённые в CRM текущего workspace. Подробности открываются отдельно.">
      <div className="flex justify-end"><button type="button" onClick={() => void load()} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-slate-300 px-3 text-sm font-black text-ink"><RefreshCw size={16} /> Refresh</button></div>
      {loading ? <Notice>Loading real CRM companies.</Notice> : error ? <Notice tone="bad">{error}</Notice> : companies.length ? (
        <section className="grid gap-3">
          {companies.map((company) => (
            <article key={company.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div><h2 className="text-lg font-black text-ink">{company.name}</h2><p className="mt-1 text-sm text-slate-600">{[company.industry, company.city, company.country].filter(Boolean).join(" · ") || "No company profile fields yet."}</p><p className="mt-2 text-sm leading-6 text-slate-700">{company.ai_summary || company.opportunity_analysis || "AI research has not filled a summary yet."}</p></div>
                <span className="w-fit rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-700">{company.crm_stage || company.email_status}</span>
              </div>
              <details className="mt-3 rounded-lg border border-slate-200"><summary className="flex cursor-pointer items-center justify-between px-3 py-2 text-sm font-black text-ink">Подробнее <ChevronDown size={16} /></summary><div className="grid gap-3 border-t border-slate-200 p-3 text-sm leading-6 text-slate-700 lg:grid-cols-3"><div><p className="font-black text-ink">Website</p>{company.website ? <a className="font-bold text-teal-700" href={company.website} target="_blank" rel="noreferrer">{company.website}</a> : <p>Not found.</p>}</div><div><p className="font-black text-ink">Reason</p><p>{company.reasoning || company.suggested_offer || "No backend reason yet."}</p></div><div><p className="font-black text-ink">Draft</p><p>{latestEmail(company)?.subject || "No draft yet."}</p></div></div></details>
            </article>
          ))}
        </section>
      ) : <Notice>No clients saved yet. Save verified First Customer Finder results from AI-помощник.</Notice>}
    </Frame>
  );
}

function EmailsSection() {
  const api = useAiFirstApi();
  const [companies, setCompanies] = useState<CrmCompany[]>([]);
  const [inbox, setInbox] = useState<Email[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const emails = useMemo(() => uniqueEmails(companies, inbox), [companies, inbox]);
  const load = useCallback(async () => {
    if (!api.ready) return;
    try {
      const [nextCompanies, nextInbox] = await Promise.all([api.listCompanies(), api.listEmails()]);
      setCompanies(nextCompanies);
      setInbox(nextInbox);
      setError("");
    } catch (err) {
      setError(friendlyErrorMessage(err, "Could not load emails."));
    }
  }, [api]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function approve(email: Email) {
    setBusy(`approve:${email.id}`);
    try {
      const response = await api.approveEmail(email.id);
      setNotice(response.message);
      await load();
    } catch (err) {
      setError(friendlyErrorMessage(err, "Could not approve this draft."));
    } finally {
      setBusy("");
    }
  }

  async function send(email: Email) {
    if (!window.confirm("Send this approved email now? OutreachAI will not send automatically.")) return;
    setBusy(`send:${email.id}`);
    try {
      const response = await api.sendApprovedEmail(email.id);
      setNotice(response.message);
      await load();
    } catch (err) {
      setError(friendlyErrorMessage(err, "Could not send this email."));
    } finally {
      setBusy("");
    }
  }

  return (
    <Frame title="Письма" copy="Черновики и отправленные письма из backend. Отправка доступна только после ручного approve и отдельного подтверждения send.">
      <div className="flex justify-end"><button type="button" onClick={() => void load()} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-slate-300 px-3 text-sm font-black text-ink"><RefreshCw size={16} /> Refresh</button></div>
      {notice ? <Notice tone="good">{notice}</Notice> : null}
      {error ? <Notice tone="bad">{error}</Notice> : null}
      {emails.length ? <section className="grid gap-3">{emails.map((email) => <article key={email.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"><div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between"><div><h2 className="text-lg font-black text-ink">{email.subject || "No subject"}</h2><p className="mt-1 text-sm font-bold text-slate-600">{pretty(email.delivery_status)}</p><p className="mt-3 max-w-3xl whitespace-pre-wrap text-sm leading-6 text-slate-700">{email.body || email.preview || "No email body returned."}</p></div><div className="flex flex-wrap gap-2"><button type="button" disabled={Boolean(busy) || email.delivery_status === "sent"} onClick={() => void approve(email)} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-slate-300 px-3 text-sm font-black text-ink disabled:cursor-not-allowed disabled:opacity-50">{busy === `approve:${email.id}` ? <Loader2 className="animate-spin" size={16} /> : <CheckCircle2 size={16} />} Approve</button><button type="button" disabled={Boolean(busy) || email.delivery_status !== "approved"} onClick={() => void send(email)} className="inline-flex min-h-10 items-center gap-2 rounded-md bg-ink px-3 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-50">{busy === `send:${email.id}` ? <Loader2 className="animate-spin" size={16} /> : <Send size={16} />} Send</button></div></div></article>)}</section> : <Notice>No email drafts yet. Save a verified customer result to CRM to create a draft.</Notice>}
    </Frame>
  );
}

function SettingsSection() {
  const api = useAiFirstApi();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [integrations, setIntegrations] = useState<WorkspaceIntegrationStatus[]>([]);
  const [senderStatus, setSenderStatus] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    if (!api.ready) return;
    try {
      const [nextWorkspace, nextIntegrations] = await Promise.all([api.getWorkspace(), api.integrations()]);
      setWorkspace(nextWorkspace);
      setIntegrations(nextIntegrations.integrations);
      try {
        const sender = await api.senderStatus();
        const status = sender.status || (sender.connected ? "connected" : "needs_setup");
        const nextAction = sender.next_action || "Configure a sender before sending approved emails.";
        setSenderStatus(`${status}: ${sender.sender_email || "sender not configured"}. ${nextAction}`);
      } catch {
        setSenderStatus("Sender status is unavailable or not configured.");
      }
      setError("");
    } catch (err) {
      setError(friendlyErrorMessage(err, "Could not load settings."));
    }
  }, [api]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    try {
      const updated = await api.updateWorkspace({
        name: String(data.get("name") || ""),
        company: String(data.get("company") || ""),
        industry: String(data.get("industry") || ""),
        target_country: String(data.get("target_country") || ""),
        target_customer: String(data.get("target_customer") || ""),
        timezone: workspace?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
      });
      setWorkspace(updated);
      setNotice("Workspace settings saved.");
    } catch (err) {
      setError(friendlyErrorMessage(err, "Could not save workspace."));
    }
  }

  return (
    <Frame title="Настройки" copy="Workspace, интеграции и отправитель. Статусы приходят из backend и остаются scoped к текущему аккаунту.">
      {notice ? <Notice tone="good">{notice}</Notice> : null}
      {error ? <Notice tone="bad">{error}</Notice> : null}
      <section className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <form onSubmit={save} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"><h2 className="text-lg font-black text-ink">Workspace</h2><div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-sm font-bold text-slate-700">Name<input name="name" defaultValue={workspace?.name || ""} className="mt-2 min-h-10 w-full rounded-md border border-slate-300 px-3" /></label><label className="text-sm font-bold text-slate-700">Company<input name="company" defaultValue={workspace?.company || ""} className="mt-2 min-h-10 w-full rounded-md border border-slate-300 px-3" /></label><label className="text-sm font-bold text-slate-700">Industry<input name="industry" defaultValue={workspace?.industry || ""} className="mt-2 min-h-10 w-full rounded-md border border-slate-300 px-3" /></label><label className="text-sm font-bold text-slate-700">Target country<input name="target_country" defaultValue={workspace?.target_country || ""} className="mt-2 min-h-10 w-full rounded-md border border-slate-300 px-3" /></label><label className="text-sm font-bold text-slate-700 sm:col-span-2">Target customer<input name="target_customer" defaultValue={workspace?.target_customer || ""} className="mt-2 min-h-10 w-full rounded-md border border-slate-300 px-3" /></label></div><button type="submit" className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-md bg-ink px-4 text-sm font-black text-white"><CheckCircle2 size={16} /> Save workspace</button></form>
        <div className="grid gap-4"><section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"><h2 className="text-lg font-black text-ink">Integrations</h2><div className="mt-3 grid gap-2">{integrations.length ? integrations.map((item) => <div key={item.key} className="rounded-md border border-slate-200 p-3"><div className="flex items-center justify-between gap-3"><p className="font-black text-ink">{item.label}</p><span className={`rounded-full px-2 py-1 text-xs font-black ${item.status === "connected" ? "bg-teal-50 text-teal-800" : "bg-amber-50 text-amber-800"}`}>{item.status}</span></div><p className="mt-1 text-sm leading-6 text-slate-600">{item.message}</p></div>) : <p className="text-sm text-slate-600">Integration status not loaded.</p>}</div></section><section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"><h2 className="text-lg font-black text-ink">Email sender</h2><p className="mt-2 text-sm leading-6 text-slate-700">{senderStatus || "Loading sender status."}</p></section></div>
      </section>
    </Frame>
  );
}

export function AiFirstWorkspace({ section }: { section: Section }) {
  if (section === "clients") return <ClientsSection />;
  if (section === "emails") return <EmailsSection />;
  if (section === "settings") return <SettingsSection />;
  return <AssistantSection />;
}

export function AiFirstHomeLinks() {
  return (
    <div className="grid gap-3 sm:grid-cols-4">
      {[
        { href: "/dashboard", label: "AI-помощник", icon: Sparkles },
        { href: "/dashboard/clients", label: "Клиенты", icon: UsersRound },
        { href: "/dashboard/emails", label: "Письма", icon: Mail },
        { href: "/dashboard/settings", label: "Настройки", icon: Settings }
      ].map((item) => {
        const Icon = item.icon;
        return <Link key={item.href} href={item.href} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-black text-ink"><Icon size={16} /> {item.label}</Link>;
      })}
    </div>
  );
}
