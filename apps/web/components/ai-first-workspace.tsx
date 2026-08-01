"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, ChevronDown, ExternalLink, Loader2, Mail, PauseCircle, RefreshCw, Send, Settings, ShieldCheck, Sparkles, Square, Trash2, UsersRound } from "lucide-react";
import { AppBadge, AppButton, EmptyStateView, LoadingStateView, SurfaceCard } from "@/components/design-system";
import { friendlyErrorMessage } from "@/lib/client-api";
import { latestDraftForResult, useAiFirstApi, type AiAssistantCommand } from "@/lib/ai-first-api";
import type { AiMemoryEntry, AiMemoryExplainResponse, AiMemorySettings, FirstCustomerJob, FirstCustomerResult, OutreachSenderStatus, WorkspaceIntegrationStatus } from "@/lib/customer-api-contracts";
import type { Campaign, CrmCompany, Email, Workspace } from "@/lib/types";

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

const aiFirstInboxPageSize = 100;
const aiWorkflowLabels = ["Describe business", "AI searches", "AI analyses", "Lead score", "Evidence", "Research profile", "Outreach strategy", "Save to CRM", "Draft email", "Manual approval", "Send"];
const crmStatuses = ["New", "Qualified", "Draft ready", "Approved", "Sent", "Replied", "Meeting", "Not interested"];
const fieldClass = "focus-ring mt-2 min-h-11 w-full rounded-xl border border-[var(--ui-border)] bg-white px-3 text-sm text-[var(--ui-text)] outline-none transition hover:border-[var(--ui-border-strong)] focus:border-[var(--ui-brand)]";
const detailSummaryClass = "flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-2xl px-4 py-3 text-sm font-black text-[var(--ui-text)] transition hover:bg-slate-100";

function pretty(value: string) {
  const text = value.replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function providerLabel(provider?: string) {
  if (provider === "gmail") return "Gmail OAuth";
  if (provider === "smtp") return "SMTP";
  if (provider === "resend") return "Connected API sender";
  if (provider === "outlook") return "Outlook";
  return provider ? pretty(provider) : "Not configured";
}

function gmailOAuthReady(sender: OutreachSenderStatus | null) {
  return Boolean(sender?.oauth_connected && sender.oauth_provider === "gmail" && sender.oauth_status === "connected" && sender.oauth_mailbox);
}

function gmailOAuthStartReady(sender: OutreachSenderStatus | null) {
  return Boolean(sender?.oauth_start_ready);
}

function gmailOAuthStartReason(sender: OutreachSenderStatus | null) {
  return sender?.oauth_start_reason || "Google OAuth is not configured for this environment.";
}

function formatDateTime(value?: string) {
  if (!value) return "Not connected";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function isWebsiteInput(value: string) {
  return /^https?:\/\/\S+$/i.test(value.trim()) || /^[\w.-]+\.[a-z]{2,}(\/\S*)?$/i.test(value.trim());
}

function normalizeWebsite(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function inferCountry(command: string) {
  const normalized = command.toLowerCase();
  if (/germany|германи|deutschland|немец/i.test(normalized)) return "Germany";
  if (/poland|польш|polska/i.test(normalized)) return "Poland";
  if (/united states|usa|сша/i.test(normalized)) return "United States";
  if (/uk|united kingdom|britain|британ/i.test(normalized)) return "United Kingdom";
  return "Any";
}

function inferIndustry(command: string) {
  const normalized = command.toLowerCase();
  if (/local service|cleaning|accounting|bookkeeping|ремонт|service compan|services compan/i.test(normalized)) return "Local services";
  if (/agency|agencies|агентств|marketing/i.test(normalized)) return "B2B agencies";
  if (/manufactur|factory|industrial|производ/i.test(normalized)) return "Manufacturing";
  if (/saas|software|crm|b2b|ai|sales|outbound/i.test(normalized)) return "B2B SaaS";
  if (/строитель|construction|renovation/i.test(normalized)) return "Construction";
  if (/clinic|health|medical|healthcare/i.test(normalized)) return "Healthcare";
  return "B2B";
}

function inferProduct(command: string) {
  const text = command.trim();
  if (isWebsiteInput(text)) return "Business described by the submitted website";
  const cleaned = text.replace(/^мы\s+прода[её]м\s+/i, "").replace(/^we\s+sell\s+/i, "");
  return cleaned.slice(0, 220) || "B2B product or service";
}

function extractSearchAudience(command: string) {
  const withoutTestPrefix = command.trim().replace(/^E2E_TEST_[\w-]+\s*/i, "");
  const searchIntent = /^(find|search for|look for|найди|найти|ищи|подбери)\b/i.test(withoutTestPrefix);
  if (!searchIntent) return "";

  const cleaned = withoutTestPrefix
    .replace(/^(find|search for|look for|найди|найти|ищи|подбери)\s+/i, "")
    .replace(/^\d+\s+/i, "")
    .trim();

  return cleaned.slice(0, 420);
}

function inferAudience(command: string, targetCountry?: string, targetIndustry?: string) {
  const requestedAudience = extractSearchAudience(command);
  if (requestedAudience) return requestedAudience;

  const country = targetCountry || inferCountry(command);
  const industry = targetIndustry || inferIndustry(command);
  const suffix = country === "Any" ? "" : ` in ${country}`;
  return `${industry} companies${suffix} with public timing, hiring, growth, or workflow pain signals.`;
}

function inferMaxResults(command: string, fallback: number) {
  const match = command.match(/\b(?:find|search for|look for|найди|найти|ищи|подбери)\s+(\d{1,2})\b/i);
  if (!match) return fallback;
  const value = Number(match[1]);
  return Number.isFinite(value) ? Math.max(1, Math.min(50, value)) : fallback;
}

export function commandToCriteria(command: string, advanced: Pick<AiAssistantCommand, "targetCountry" | "targetIndustry" | "companySize" | "contactTitles" | "keywords" | "exclusions" | "maxResults">): AiAssistantCommand {
  const input = command.trim();
  const website = isWebsiteInput(input) ? normalizeWebsite(input) : "";
  const targetCountry = advanced.targetCountry || inferCountry(input);
  const targetIndustry = advanced.targetIndustry || inferIndustry(input);
  const desiredCustomers = inferAudience(input, targetCountry, targetIndustry);
  return {
    command: input,
    companyWebsite: website,
    companyDescription: website || input,
    productOrService: inferProduct(input),
    desiredCustomers,
    targetCountry,
    targetIndustry,
    companySize: advanced.companySize,
    contactTitles: advanced.contactTitles.length ? advanced.contactTitles : ["Founder", "Head of Sales", "Revenue Operations"],
    keywords: advanced.keywords,
    exclusions: advanced.exclusions,
    maxResults: inferMaxResults(input, advanced.maxResults)
  };
}

function understandingFor(command: string, criteria: AiAssistantCommand) {
  const source = criteria.companyWebsite ? `сайт ${criteria.companyWebsite}` : "описание бизнеса";
  return `Я понял ваш бизнес так: ${criteria.productOrService}. Сначала проанализирую ${source}, затем буду искать ${criteria.desiredCustomers} Подходящие роли: ${criteria.contactTitles.join(", ")}.`;
}

export function missingQuestion(command: string) {
  const text = command.trim();
  if (!text) return "Вставьте сайт или одним предложением опишите бизнес и кого хотите найти.";
  if (!isWebsiteInput(text) && text.length < 18) return "Что вы продаёте и кому?";
  return "";
}

function safeToAutoSave(result: FirstCustomerResult) {
  return Boolean(sourceUrl(result)) && ["verified", "partially_verified"].includes(result.verified_status) && result.confidence_score >= 60 && result.ai_relevance_score >= 60;
}

function resultNeedsReview(result: FirstCustomerResult) {
  if (result.result_tier === "Weak / needs review") return "weak match требует проверки";
  if (result.website_verification_status === "temporarily_unavailable") return "website verification temporarily unavailable";
  if (!sourceUrl(result)) return "нет публичного источника";
  if (!result.public_work_contact) return "нет подтверждённого публичного делового контакта";
  if (result.confidence_score < 60) return "низкий confidence";
  if (result.ai_relevance_score < 60) return "низкий fit score";
  if (!["verified", "partially_verified"].includes(result.verified_status)) return "статус проверки недостаточен";
  return "";
}

function needsReviewTier(result: FirstCustomerResult) {
  return result.result_tier === "Weak / needs review" || result.website_verification_status === "temporarily_unavailable" || result.missing_buying_signal;
}

function websiteVerificationLabel(result: FirstCustomerResult) {
  const status = typeof result.website_verification_status === "string" ? result.website_verification_status : "";
  const warning = typeof result.website_verification_warning === "string" ? result.website_verification_warning : "";
  const fallback = typeof result.source_verification_status === "string" ? result.source_verification_status : "Not returned";
  return status ? `${status}${warning ? `: ${warning}` : ""}` : fallback;
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

function companyForEmail(companies: CrmCompany[], email: Email) {
  return companies.find((company) => company.generated_emails?.some((item) => item.id === email.id))
    || companies.find((company) => Boolean(email.lead_id) && company.lead_id === email.lead_id)
    || null;
}

function replyAssistantText(email: Email) {
  const assistant = email.reply_assistant || {};
  const classification = String(assistant.classification || assistant.category || "").trim();
  const suggested = String(assistant.suggested_response || assistant.suggested_reply || "").trim();
  const nextStep = String(assistant.next_step || "").trim();
  return [classification && `Classification: ${classification}`, suggested && `Suggested reply: ${suggested}`, nextStep && `Next step: ${nextStep}`].filter(Boolean).join("\n");
}

function Frame({ title, copy, children }: { title: string; copy: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 ui-animate-enter">
      <div>
        <h1 className="ui-title text-2xl sm:text-3xl">{title}</h1>
        <p className="ui-copy mt-2 max-w-3xl">{copy}</p>
      </div>
      {children}
    </div>
  );
}

function Notice({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "good" | "bad" }) {
  const toneClass = tone === "good" ? "border-teal-200 bg-teal-50 text-teal-800" : tone === "bad" ? "border-red-200 bg-red-50 text-red-700" : "border-[var(--ui-border)] bg-white text-[var(--ui-text-soft)]";
  return <div role={tone === "bad" ? "alert" : "status"} aria-live="polite" className={`rounded-2xl border p-4 text-sm font-semibold leading-6 shadow-sm ${toneClass}`}>{children}</div>;
}

function PremiumPanel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <SurfaceCard className={`rounded-[1.75rem] p-5 transition motion-safe:hover:-translate-y-0.5 motion-safe:hover:shadow-raised ${className}`}>{children}</SurfaceCard>;
}

function ScoreTile({ label, value, copy }: { label: string; value?: number; copy?: string }) {
  const score = typeof value === "number" ? Math.max(0, Math.min(100, Math.round(value))) : null;
  const tone = score === null ? "text-slate-500" : score >= 75 ? "text-teal-700" : score >= 50 ? "text-amber-700" : "text-red-700";
  return (
    <div aria-label={`${label}: ${score === null ? "Недостаточно данных" : `${score} из 100`}`} className="min-h-[8.5rem] rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-surface-subtle)] p-4 transition hover:border-[var(--ui-border-strong)]">
      <p className="text-xs font-black uppercase tracking-[0.08em] text-[var(--ui-text-soft)]">{label}</p>
      <p className={`mt-2 text-3xl font-black tracking-tight ${tone}`}>{score === null ? "Недостаточно данных" : score}</p>
      {copy ? <p className="mt-2 text-sm font-semibold leading-6 text-[var(--ui-text-soft)]">{copy}</p> : null}
    </div>
  );
}

function EvidenceLine({ label, value, href }: { label: string; value?: string; href?: string }) {
  const text = String(value || "").trim();
  return (
    <div className="min-h-[7.5rem] rounded-2xl border border-[var(--ui-border)] bg-white p-4 transition hover:border-[var(--ui-border-strong)]">
      <p className="text-xs font-black uppercase tracking-[0.08em] text-[var(--ui-text-soft)]">{label}</p>
      {href && text ? (
        <a href={href} target="_blank" rel="noreferrer" className="focus-ring mt-2 inline-flex min-h-10 items-center gap-1 break-all rounded-lg text-sm font-bold leading-6 text-teal-700">
          {text} <ExternalLink size={14} />
        </a>
      ) : (
        <p className="mt-2 text-sm font-semibold leading-6 text-[var(--ui-text-soft)]">{text || "Недостаточно данных"}</p>
      )}
    </div>
  );
}

function memoryTypeLabel(value: string) {
  if (value === "verified_fact") return "Verified fact";
  if (value === "approved_preference") return "Approved preference";
  if (value === "ai_inference") return "AI assumption";
  if (value === "outcome") return "Outcome";
  return pretty(value || "interaction");
}

function retrievalModeLabel(settings?: AiMemorySettings | null) {
  const mode = settings?.last_retrieval_mode || "none";
  if (mode === "pgvector") return "pgvector";
  if (mode === "openai_embedding") return "OpenAI embedding";
  if (mode === "keyword") return settings?.pgvector_available ? "keyword; pgvector available, not used" : "keyword fallback";
  return settings?.pgvector_available ? "none; pgvector available, not used" : "none";
}

function CompanyMemoryExplain({ company }: { company: CrmCompany }) {
  const api = useAiFirstApi();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [decision, setDecision] = useState<AiMemoryExplainResponse | null>(null);
  const [error, setError] = useState("");

  async function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (decision || !api.ready) return;
    setLoading(true);
    setError("");
    try {
      setDecision(await api.explainMemoryDecision(company.id));
    } catch (err) {
      setError(friendlyErrorMessage(err, "Could not explain this AI decision."));
    } finally {
      setLoading(false);
    }
  }

  const verified = decision?.verified_facts || [];
  const assumptions = decision?.ai_assumptions || [];
  const memories = decision?.used_memories || [];
  const confidenceBasis = decision?.confidence_basis || company.ai_sales_workspace?.confidence_basis || "Недостаточно данных";

  return (
    <div className="mt-4 rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-surface-subtle)] p-4">
      <AppButton variant="secondary" size="sm" disabled={loading} onClick={() => void toggle()} aria-expanded={open}>
        {loading ? <Loader2 className="animate-spin" size={16} /> : <ShieldCheck size={16} />}
        Why AI decided this?
      </AppButton>
      {open ? (
        <div className="mt-4 grid gap-3 text-sm leading-6 text-[var(--ui-text-soft)]">
          <h3 className="text-sm font-black uppercase tracking-[0.08em] text-[var(--ui-text-soft)]">Decision evidence</h3>
          {error ? <Notice tone="bad">{error}</Notice> : null}
          {loading ? <LoadingStateView title="Loading decision evidence." /> : null}
          {!loading && decision ? (
            <>
              <EvidenceLine label="Confidence basis" value={confidenceBasis} />
              <div className="grid gap-3 lg:grid-cols-2">
                <div className="rounded-2xl border border-[var(--ui-border)] bg-white p-4">
                  <p className="text-xs font-black uppercase tracking-[0.08em] text-[var(--ui-text-soft)]">Verified facts</p>
                  {verified.length ? verified.map((item) => <p key={item.id} className="mt-2 font-semibold">{item.content || item.source}</p>) : <p className="mt-2 font-semibold">Недостаточно данных</p>}
                </div>
                <div className="rounded-2xl border border-[var(--ui-border)] bg-white p-4">
                  <p className="text-xs font-black uppercase tracking-[0.08em] text-[var(--ui-text-soft)]">AI assumptions</p>
                  {assumptions.length ? assumptions.map((item) => <p key={item.id} className="mt-2 font-semibold">{item.content || item.source}</p>) : <p className="mt-2 font-semibold">Недостаточно данных</p>}
                </div>
              </div>
              <div className="rounded-2xl border border-[var(--ui-border)] bg-white p-4">
                <p className="text-xs font-black uppercase tracking-[0.08em] text-[var(--ui-text-soft)]">Sources</p>
                <p className="mt-2 font-semibold">{decision.sources.length ? decision.sources.join(", ") : "Недостаточно данных"}</p>
              </div>
              <div className="rounded-2xl border border-[var(--ui-border)] bg-white p-4">
                <p className="text-xs font-black uppercase tracking-[0.08em] text-[var(--ui-text-soft)]">Used memories</p>
                {memories.length ? memories.map((item) => (
                  <p key={item.id} className="mt-2 font-semibold">
                    {memoryTypeLabel(item.type)} · {item.source || "workspace"} · {Math.round(Number(item.relevance_score || 0) * 100)}%
                  </p>
                )) : <p className="mt-2 font-semibold">Недостаточно данных</p>}
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function WorkflowStep({ index, label, active }: { index: number; label: string; active?: boolean }) {
  return (
    <div className={`flex min-h-11 items-center gap-3 rounded-full border px-3 text-sm font-black transition ${active ? "border-[var(--ui-brand)] bg-[var(--ui-brand)] text-white shadow-glow" : "border-[var(--ui-border)] bg-white text-[var(--ui-text-soft)]"}`}>
      <span className={`grid size-7 place-items-center rounded-full text-xs ${active ? "bg-white text-slate-950" : "bg-slate-100 text-slate-600"}`}>{index}</span>
      {label}
    </div>
  );
}

function qualityGateLabel(result: FirstCustomerResult) {
  const review = resultNeedsReview(result);
  if (!review) return "Quality gate passed";
  return `Review required: ${review}`;
}

function ResultCard({
  result,
  busy,
  onSave,
  onApprove,
  onSend,
  hideActions = false
}: {
  result: FirstCustomerResult;
  busy: string;
  onSave(result: FirstCustomerResult): void;
  onApprove(result: FirstCustomerResult): void;
  onSend(result: FirstCustomerResult): void;
  hideActions?: boolean;
}) {
  const saved = Boolean(result.company_id || result.lead_id);
  const emailId = latestDraftForResult(result);
  const canSend = Boolean(emailId && result.public_work_contact);
  const overallScore = result.overall_lead_score ?? result.ai_relevance_score;
  const contactConfidence = result.contact_confidence_score ?? result.confidence_score;
  const outreachReadiness = result.outreach_readiness_score;
  const aiConfidence = result.ai_confidence_score ?? result.confidence_score;
  const qualityGate = qualityGateLabel(result);
  const reviewReason = resultNeedsReview(result);
  return (
    <SurfaceCard as="article" className="rounded-[1.75rem] p-5 transition motion-safe:hover:-translate-y-0.5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="ui-title text-xl">{result.company_name}</h2>
            <AppBadge tone="dark">{overallScore}/100 score</AppBadge>
            {result.result_tier ? <AppBadge tone={result.result_tier === "Strong match" ? "success" : result.result_tier === "Relevant match" ? "warning" : "neutral"}>{result.result_tier}</AppBadge> : null}
            <AppBadge tone={qualityGate.includes("passed") ? "success" : "warning"}>{qualityGate}</AppBadge>
            {reviewReason ? <AppBadge tone="warning">Needs review</AppBadge> : null}
          </div>
          <p className="mt-1 text-sm text-[var(--ui-text-soft)]">{[result.industry, result.country, result.company_size].filter(Boolean).join(" · ") || "Company profile fields were not found yet."}</p>
        </div>
        {!hideActions ? <div className="flex flex-wrap gap-2">
          <AppButton size="sm" disabled={Boolean(busy) || saved} onClick={() => onSave(result)} aria-label={`${saved ? "Saved" : "Save to CRM"} ${result.company_name}`}>
            {busy === `save:${result.id}` ? <Loader2 className="animate-spin" size={16} /> : <CheckCircle2 size={16} />} {saved ? "Saved" : "Save to CRM"}
          </AppButton>
          <AppButton variant="secondary" size="sm" disabled={Boolean(busy) || !emailId} onClick={() => onApprove(result)} aria-label={`Approve draft for ${result.company_name}`}>
            {busy === `approve:${result.id}` ? <Loader2 className="animate-spin" size={16} /> : <Mail size={16} />} Approve draft
          </AppButton>
          <AppButton variant="secondary" size="sm" disabled={Boolean(busy) || !canSend} onClick={() => onSend(result)} aria-label={`Send email for ${result.company_name}`}>
            {busy === `send:${result.id}` ? <Loader2 className="animate-spin" size={16} /> : <Send size={16} />} Send approved
          </AppButton>
        </div> : null}
      </div>
      <div className="mt-5 grid gap-3 lg:grid-cols-4">
        <ScoreTile label="Overall Lead Score" value={overallScore} />
        <ScoreTile label="AI Confidence" value={aiConfidence} />
        <ScoreTile label="Contact Confidence" value={contactConfidence} />
        <ScoreTile label="Outreach Readiness" value={outreachReadiness} />
      </div>
      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        <EvidenceLine label="Why this company" value={result.fit_explanation || result.signal_description || "No fit explanation returned."} />
        <EvidenceLine label="Evidence" value={result.evidence_summary || result.observed_fact || "No evidence summary returned."} />
        <EvidenceLine label="Recommended decision maker" value={[result.contact_name, result.contact_title].filter(Boolean).join(" · ") || result.contact_title || "Decision maker not confirmed"} />
        <EvidenceLine label="Website verification" value={websiteVerificationLabel(result)} />
      </div>
      <details className="mt-4 rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-surface-subtle)]">
        <summary className={detailSummaryClass}>Подробнее <ChevronDown size={16} /></summary>
        <div className="grid gap-3 border-t border-[var(--ui-border)] p-4 text-sm leading-6 text-[var(--ui-text-soft)] lg:grid-cols-2">
          <EvidenceLine label="Source" value={result.source_title || sourceUrl(result)} href={sourceUrl(result)} />
          <EvidenceLine label="Contact route" value={result.public_work_contact || "No verified public work email yet."} />
          <EvidenceLine label="Facts" value={result.evidence_excerpt || result.observed_fact || "No excerpt returned."} />
          <div className="rounded-2xl border border-[var(--ui-border)] bg-white p-4">
            <p className="text-xs font-black uppercase tracking-[0.08em] text-[var(--ui-text-soft)]">Outreach Strategy</p>
            <p className="mt-2 font-bold text-[var(--ui-text)]">{result.email_subject || "No subject yet."}</p>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--ui-text-soft)]">{result.email_body || result.draft_email || "No email draft yet. Save the result to CRM when ready."}</p>
          </div>
        </div>
      </details>
    </SurfaceCard>
  );
}

function AssistantSection() {
  const api = useAiFirstApi();
  const [command, setCommand] = useState("");
  const [advanced, setAdvanced] = useState(blankCommand);
  const [understanding, setUnderstanding] = useState("");
  const [job, setJob] = useState<FirstCustomerJob | null>(null);
  const [jobs, setJobs] = useState<FirstCustomerJob[]>([]);
  const [sender, setSender] = useState<OutreachSenderStatus | null>(null);
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [loading, setLoading] = useState(false);
  const [autoSaving, setAutoSaving] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const autoSaveJobIds = useRef(new Set<string>());
  const mounted = useRef(true);

  const loadJobs = useCallback(async () => {
    if (!api.ready) return;
    try {
      const loaded = await api.listCustomerFinderJobs();
      setJobs(loaded);
      setJob((current) => current || loaded[0] || null);
    } catch (err) {
      setError(friendlyErrorMessage(err, "Could not load AI customer searches."));
    }
  }, [api]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadJobs(), 0);
    return () => window.clearTimeout(timer);
  }, [loadJobs]);
  useEffect(() => {
    const timer = window.setTimeout(() => setHydrated(true), 0);
    return () => {
      window.clearTimeout(timer);
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!api.ready) return undefined;
    const timer = window.setTimeout(async () => {
      try {
        setSender(await api.senderStatus());
      } catch {
        setSender(null);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [api]);
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
  useEffect(() => {
    if (!job || !["completed", "partially_completed"].includes(job.status) || autoSaving || autoSaveJobIds.current.has(job.id)) return;
    const unsaved = job.results.filter((result) => !result.company_id && !result.lead_id && safeToAutoSave(result));
    if (!unsaved.length) return;
    autoSaveJobIds.current.add(job.id);
    void (async () => {
      setAutoSaving(true);
      let saved = 0;
      try {
        for (const result of unsaved) {
          await api.saveFinderResult(result.id);
          saved += 1;
        }
        if (!mounted.current) return;
        setNotice(`${saved} verified compan${saved === 1 ? "y was" : "ies were"} saved to CRM. Drafts are ready for review.`);
        setJob(await api.getCustomerFinderJob(job.id));
      } catch (err) {
        if (mounted.current) {
          setError(friendlyErrorMessage(err, "Could not automatically save one verified company."));
        }
      } finally {
        if (mounted.current) {
          setAutoSaving(false);
        }
      }
    })();
  }, [api, autoSaving, job]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    const question = missingQuestion(command);
    if (question) {
      setError(question);
      return;
    }
    const criteria = commandToCriteria(command, advanced);
    setUnderstanding(understandingFor(command, criteria));
    setLoading(true);
    try {
      const next = await api.startCustomerFinder(criteria);
      setJob(next);
      setJobs((current) => [next, ...current.filter((item) => item.id !== next.id)]);
      setNotice("First Customer Finder started. Verified results will be saved to CRM automatically; unsafe results stay as Требует проверки.");
    } catch (err) {
      setError(friendlyErrorMessage(err, "AI customer search could not start."));
    } finally {
      setLoading(false);
    }
  }

  async function allowCampaign() {
    if (!job) return;
    const criteria = commandToCriteria(command || "Find first customers", advanced);
    const firstSafe = job.results.find((result) => safeToAutoSave(result));
    setBusy("campaign:allow");
    try {
      const created = campaign || await api.createCampaign({
        name: `AI Autopilot - ${criteria.targetCountry || "First customers"}`,
        industry: criteria.targetIndustry,
        countries: criteria.targetCountry && criteria.targetCountry !== "Any" ? [criteria.targetCountry] : [],
        company_size: criteria.companySize || null,
        keywords: criteria.keywords,
        website_filters: criteria.companyWebsite ? [criteria.companyWebsite] : [],
        language: "Auto by recipient",
        offer: criteria.productOrService,
        cta: "Book a quick fit review",
        email_tone: "Personal and concise",
        signature: "OutreachAI",
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        working_hours: "09:00-17:00",
        daily_send_limit: Math.min(sender?.remaining_today || 10, 10),
        sequence: [{
          step_order: 1,
          name: "Autopilot first email",
          subject: firstSafe?.email_subject || "Personalized first email",
          body: firstSafe?.email_body || firstSafe?.draft_email || "Generated per recipient after CRM save.",
          delay_days: 0
        }]
      });
      const approved = await api.approveAutopilotCampaign(created.id, job.id);
      setCampaign(approved);
      setNotice("AI Autopilot approved. Backend queued safe jobs; staging mode blocks real-company sends unless the test mailbox domain is explicitly allowed.");
    } catch (err) {
      setError(friendlyErrorMessage(err, "Could not record campaign permission."));
    } finally {
      setBusy("");
    }
  }

  async function connectMail() {
    if (!gmailOAuthStartReady(sender)) {
      setError(gmailOAuthStartReason(sender));
      return;
    }
    setBusy("mail:connect");
    setError("");
    try {
      const response = await api.startGmailOAuth();
      window.location.assign(response.auth_url);
    } catch (err) {
      setError(friendlyErrorMessage(err, "Could not start secure Google mail connection."));
      setBusy("");
    }
  }

  async function disconnectMail() {
    if (!window.confirm("Disconnect this Gmail mailbox from AI Autopilot?")) return;
    setBusy("mail:disconnect");
    try {
      setSender(await api.disconnectGmail());
      setNotice("Mail connection disconnected for this workspace.");
    } catch (err) {
      setError(friendlyErrorMessage(err, "Could not disconnect Gmail."));
    } finally {
      setBusy("");
    }
  }

  async function syncReplies() {
    setBusy("mail:sync");
    try {
      const result = await api.syncGmailReplies();
      setNotice(`Replies synced: ${result.synced}. AI classified replies without sending automatic responses.`);
    } catch (err) {
      setError(friendlyErrorMessage(err, "Could not sync Gmail replies."));
    } finally {
      setBusy("");
    }
  }

  async function autopilotAction(action: "pause" | "stop") {
    if (!campaign) {
      setNotice(action === "pause" ? "AI Autopilot paused locally. No emails will be sent." : "AI Autopilot stopped locally. No emails will be sent.");
      return;
    }
    try {
      const actionRequest = api.campaignAction(campaign.id, action);
      setBusy(`campaign:${action}`);
      const updated = await actionRequest;
      setCampaign(updated);
      setNotice(action === "pause" ? "Campaign paused in backend." : "Campaign stopped in backend.");
    } catch (err) {
      setError(friendlyErrorMessage(err, `Could not ${action} this campaign.`));
    } finally {
      setBusy("");
    }
  }

  function updateAdvanced<K extends keyof AiAssistantCommand>(key: K, value: AiAssistantCommand[K]) {
    setAdvanced((current) => ({ ...current, [key]: value }));
  }

  const criteria = commandToCriteria(command || "Find first customers", advanced);
  const progress = job?.progress || {};
  const found = job?.results.length || 0;
  const saved = job?.results.filter((result) => result.company_id || result.lead_id).length || Number(progress.saved || 0);
  const prepared = job?.results.filter((result) => result.email_id || result.email_body || result.draft_email).length || 0;
  const needsReview = job?.results.filter((result) => resultNeedsReview(result)).length || 0;
  const sent = campaign?.sent || 0;
  const replies = campaign?.replies || 0;
  const senderReady = gmailOAuthReady(sender);
  const canStartGmailOAuth = gmailOAuthStartReady(sender);
  const campaignApproved = Boolean(campaign);
  const aiControlsReady = Boolean(hydrated && api.ready && sender && job);
  const canAllowAutopilot = Boolean(aiControlsReady && found > 0 && saved > 0 && prepared > 0 && senderReady && (sender?.remaining_today || 0) > 0 && !campaignApproved);
  const campaignControlBusy = busy === "campaign:pause" || busy === "campaign:stop";
  const canControlAutopilot = Boolean(aiControlsReady && campaignApproved && !campaignControlBusy);
  const autopilotControlState = !aiControlsReady ? "loading" : campaignApproved ? "ready_to_control" : canAllowAutopilot ? "ready_to_approve" : "blocked";
  const sample = job?.results.find((result) => result.email_body || result.draft_email);
  const stage = campaign?.status === "Paused" || campaign?.status === "paused" ? "Приостановлен" : autoSaving ? "Сохраняет" : job?.status === "queued" ? "Анализирует" : job?.status === "running" ? "Ищет" : job?.results.length ? (campaign?.status === "Running" || campaign?.status === "running" ? "Отправляет" : "Готовит письма") : "Анализирует";
  const progressText = job ? `${stage}: ${String(progress.message || job.error_message || "AI is checking backend progress.")}` : "Ожидаю сайт или описание бизнеса.";

  return (
    <Frame title="AI-помощник" copy="Вставьте сайт или опишите бизнес. OutreachAI сам соберет критерии, запустит First Customer Finder, покажет evidence, сохранит проверенные компании в CRM и подготовит письма для ручного approval.">
      <PremiumPanel className="bg-gradient-to-br from-white via-white to-slate-50">
        <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
          <form aria-label="AI customer command" onSubmit={submit} className="rounded-[1.5rem] border border-[var(--ui-border)] bg-white p-4 shadow-soft">
            <label className="block text-sm font-black text-[var(--ui-text)]">AI command<textarea value={command} onChange={(event) => setCommand(event.target.value)} className="focus-ring mt-2 min-h-40 w-full resize-y rounded-[1.25rem] border border-[var(--ui-border)] bg-[var(--ui-surface-subtle)] p-4 text-base leading-7 text-[var(--ui-text)] outline-none transition hover:border-[var(--ui-border-strong)] focus:border-[var(--ui-brand)] focus:bg-white" placeholder="Вставьте сайт или опишите свой бизнес и кого хотите найти" /></label>
            <div className="mt-4 grid grid-cols-2 gap-2">
          <AppButton type="submit" disabled={loading || !hydrated || !api.ready} className="w-full">{loading ? <Loader2 className="animate-spin" size={17} /> : <Sparkles size={17} />} Запустить AI</AppButton>
          <AppButton variant="secondary" onClick={() => void loadJobs()} className="w-full" aria-label="Обновить AI searches"><RefreshCw size={17} /> Обновить</AppButton>
            </div>
            <details className="mt-4 rounded-2xl border border-[var(--ui-border)] bg-white">
              <summary className={detailSummaryClass}>Расширенные настройки <ChevronDown size={16} /></summary>
              <div className="grid gap-3 border-t border-[var(--ui-border)] p-3 lg:grid-cols-3">
            <label className="text-sm font-bold text-[var(--ui-text-soft)]">Страна<input value={advanced.targetCountry} onChange={(event) => updateAdvanced("targetCountry", event.target.value)} className={fieldClass} placeholder="Auto" /></label>
            <label className="text-sm font-bold text-[var(--ui-text-soft)]">Отрасль<input value={advanced.targetIndustry} onChange={(event) => updateAdvanced("targetIndustry", event.target.value)} className={fieldClass} placeholder="Auto" /></label>
            <label className="text-sm font-bold text-[var(--ui-text-soft)]">Дневной лимит<input type="number" min={1} max={50} value={advanced.maxResults} onChange={(event) => updateAdvanced("maxResults", Number(event.target.value || 10))} className={fieldClass} /></label>
              </div>
            </details>
          </form>
          <div className="flex flex-col justify-between gap-4">
            <div className="rounded-[1.5rem] border border-teal-100 bg-teal-50 p-4">
              <div className="flex items-start gap-3">
                <ShieldCheck className="mt-0.5 text-teal-700" size={22} />
                <div>
                  <p className="text-sm font-black text-ink">Manual approval stays on</p>
                  <p className="mt-2 text-sm font-semibold leading-6 text-slate-700">AI may find, analyse and draft. Real sending still requires a reviewed recipient, subject, body and explicit approval.</p>
                </div>
              </div>
            </div>
            <div className="grid gap-2">
              {aiWorkflowLabels.map((label, index) => (
                <WorkflowStep key={label} index={index + 1} label={label} active={index === (found ? prepared ? 9 : 7 : 0)} />
              ))}
            </div>
          </div>
        </div>
      </PremiumPanel>
      <div data-ai-controls-ready={aiControlsReady ? "true" : "false"} data-autopilot-state={autopilotControlState} className="grid grid-cols-2 gap-2 rounded-[1.5rem] border border-slate-200 bg-white p-3 shadow-sm">
        <AppButton variant="secondary" disabled={!canControlAutopilot} onClick={() => void autopilotAction("pause")} className="w-full border-amber-300 text-amber-800"><PauseCircle size={17} /> Пауза</AppButton>
        <AppButton variant="secondary" disabled={!canControlAutopilot} onClick={() => void autopilotAction("stop")} className="w-full border-red-300 text-red-700"><Square size={17} /> Остановить</AppButton>
      </div>
      {notice ? <Notice tone="good">{notice}</Notice> : null}
      {error ? <Notice tone="bad">{error}</Notice> : null}
      <section className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <PremiumPanel>
          <p className="text-sm font-black text-ink">Понимание задачи</p>
          <p className="mt-2 text-sm leading-6 text-slate-700">{understanding || understandingFor(command || "https://outreachaiaiai.com", criteria)}</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-5">
            {[["Найдено", found], ["CRM", saved], ["Подготовлено", prepared], ["Отправлено", sent], ["Ответы", replies]].map(([label, value]) => <div key={String(label)} className="rounded-2xl bg-[var(--ui-surface-subtle)] p-3"><p className="text-xs font-black uppercase text-[var(--ui-text-soft)]">{label}</p><p className="mt-1 text-2xl font-black text-[var(--ui-text)]">{value}</p></div>)}
          </div>
          <div role="status" aria-live="polite" className="mt-4 rounded-2xl bg-[var(--ui-surface-subtle)] p-4">
            <p className="text-xs font-black uppercase text-[var(--ui-text-soft)]">Что AI делает сейчас</p>
            <p className="mt-2 text-sm leading-6 text-[var(--ui-text-soft)]">{autoSaving ? "Сохраняю проверенные компании в CRM и создаю черновики через backend." : progressText}</p>
            {needsReview ? <p className="mt-2 text-sm font-bold text-amber-700">{needsReview} лид(ов) оставлены со статусом «Требует проверки».</p> : null}
          </div>
        </PremiumPanel>
        <PremiumPanel>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-black text-ink">AI Autopilot</h2>
            <AppBadge tone={campaign?.status === "Running" || campaign?.status === "running" ? "success" : "warning"}>{campaign?.status || "needs approval"}</AppBadge>
          </div>
          <div className="mt-3 grid gap-2 text-sm leading-6 text-slate-700">
            <p><span className="font-black text-ink">Почта:</span> {senderReady ? `${sender?.oauth_mailbox} через Gmail OAuth` : "подключите Gmail OAuth перед автономной отправкой"}</p>
            <p><span className="font-black text-ink">Аудитория:</span> {criteria.desiredCustomers}</p>
            <p><span className="font-black text-ink">Страны:</span> {criteria.targetCountry || "Auto"}</p>
            <p><span className="font-black text-ink">Дневной лимит:</span> {Math.min(sender?.remaining_today || 0, 10)} из {sender?.daily_send_limit || 0}</p>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {!senderReady ? <AppButton variant="secondary" size="sm" disabled={Boolean(busy) || !canStartGmailOAuth} onClick={() => void connectMail()}><Mail size={16} /> {busy === "mail:connect" ? "Opening Gmail..." : "Connect Gmail"}</AppButton> : null}
            {senderReady ? <AppButton variant="secondary" size="sm" disabled={Boolean(busy)} onClick={() => void syncReplies()}><RefreshCw size={16} /> Проверить ответы</AppButton> : null}
            {senderReady ? <AppButton variant="secondary" size="sm" disabled={Boolean(busy)} onClick={() => void disconnectMail()}>Отключить</AppButton> : null}
          </div>
          {!senderReady && !canStartGmailOAuth ? <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">{gmailOAuthStartReason(sender)}</p> : null}
          <details className="mt-3 rounded-2xl border border-[var(--ui-border)]"><summary className={detailSummaryClass}>Пример письма <ChevronDown size={16} /></summary><p className="whitespace-pre-wrap border-t border-[var(--ui-border)] p-3 text-sm leading-6 text-[var(--ui-text-soft)]">{sample?.email_body || sample?.draft_email || "Пример появится после первого найденного и сохраненного результата."}</p></details>
          <AppButton disabled={!canAllowAutopilot || Boolean(busy)} onClick={() => void allowCampaign()} className="mt-4 w-full">{busy === "campaign:allow" ? <Loader2 className="animate-spin" size={17} /> : <CheckCircle2 size={17} />} Разрешить эту кампанию</AppButton>
          {!canAllowAutopilot ? <p className="mt-2 text-xs font-bold leading-5 text-slate-500">Autopilot включится только после verified sender, CRM-save, черновиков, публичных источников, лимитов тарифа и дневного лимита.</p> : null}
        </PremiumPanel>
      </section>
      {job?.results.length ? <details className="rounded-[1.75rem] border border-[var(--ui-border)] bg-white shadow-soft"><summary className={detailSummaryClass}>Подробнее по найденным компаниям <ChevronDown size={16} /></summary><div className="grid gap-5 border-t border-[var(--ui-border)] p-4">
        {job.results.filter((result) => !needsReviewTier(result)).length ? <section className="grid gap-3"><h2 className="text-sm font-black uppercase tracking-[0.08em] text-[var(--ui-text-soft)]">Verified / Relevant</h2>{job.results.filter((result) => !needsReviewTier(result)).map((result) => <ResultCard key={result.id} result={result} busy="" onSave={() => undefined} onApprove={() => undefined} onSend={() => undefined} hideActions />)}</section> : null}
        {job.results.filter(needsReviewTier).length ? <section className="grid gap-3"><h2 className="text-sm font-black uppercase tracking-[0.08em] text-amber-700">Needs review</h2>{job.results.filter(needsReviewTier).map((result) => <ResultCard key={result.id} result={result} busy="" onSave={() => undefined} onApprove={() => undefined} onSend={() => undefined} hideActions />)}</section> : null}
      </div></details> : null}
      {jobs.length > 1 ? <details className="rounded-[1.5rem] border border-[var(--ui-border)] bg-white shadow-sm"><summary className={detailSummaryClass}>Previous searches <ChevronDown size={16} /></summary><div className="border-t border-[var(--ui-border)] p-2">{jobs.slice(1).map((item) => <button key={item.id} type="button" onClick={() => setJob(item)} className="focus-ring flex min-h-11 w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition hover:bg-slate-50"><span>{pretty(item.status)}</span><span className="font-bold">{item.results.length} result(s)</span></button>)}</div></details> : null}
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
  const nextCompany = companies.find((company) => !latestEmail(company)) || companies.find((company) => latestEmail(company)?.delivery_status !== "sent") || companies[0];
  return (
    <Frame title="Клиенты" copy="CRM Queue: только компании, явно сохранённые в текущем workspace. Следующее действие важнее сложного pipeline.">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
          {crmStatuses.map((status) => <AppBadge key={status} tone="neutral">{status}</AppBadge>)}
        </div>
        <AppButton variant="secondary" size="sm" onClick={() => void load()} aria-label="Refresh CRM companies"><RefreshCw size={16} /> Refresh</AppButton>
      </div>
      {loading ? <LoadingStateView title="Loading real CRM companies." /> : error ? <Notice tone="bad">{error}</Notice> : companies.length ? (
        <section className="grid gap-4">
          <PremiumPanel className="border-teal-200 bg-teal-50">
            <p className="text-xs font-black uppercase tracking-[0.14em] text-teal-800">Next sales action</p>
            <h2 className="mt-2 text-2xl font-black text-ink">{nextCompany?.name || "No company selected"}</h2>
            <p className="mt-2 text-sm font-semibold leading-6 text-slate-700">{nextCompany ? (latestEmail(nextCompany) ? "Review the email approval state, then send only after explicit confirmation." : "Open lead details, verify evidence and create the personalised draft.") : "Find leads from AI-помощник first."}</p>
          </PremiumPanel>
          {companies.map((company) => (
            <SurfaceCard as="article" key={company.id} className="rounded-[1.75rem] p-5 transition motion-safe:hover:-translate-y-0.5">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0"><h2 className="text-xl font-black tracking-tight text-ink">{company.name}</h2><p className="mt-1 text-sm text-slate-600">{[company.industry, company.city, company.country].filter(Boolean).join(" · ") || "No company profile fields yet."}</p><p className="mt-2 text-sm leading-6 text-slate-700">{company.ai_summary || company.opportunity_analysis || "AI research has not filled a summary yet."}</p></div>
                <div className="flex flex-wrap gap-2 lg:justify-end">
                  <AppBadge tone="neutral">{company.crm_stage || company.email_status}</AppBadge>
                  <AppBadge tone={latestEmail(company)?.delivery_status === "sent" ? "success" : "brand"}>{latestEmail(company)?.delivery_status || "draft needed"}</AppBadge>
                </div>
              </div>
              <div className="mt-4 grid gap-3 lg:grid-cols-4">
                <ScoreTile label="Overall Lead Score" value={Number(company.overall_score || company.priority_score || company.icp_score || 0) || undefined} />
                <ScoreTile label="Website Quality" value={Number(company.ai_company_predictions?.sales_readiness?.score || company.icp_score || 0) || undefined} />
                <ScoreTile label="Contact Confidence" value={Number(company.confidence_score || 0) || undefined} />
                <ScoreTile label="Outreach Readiness" value={latestEmail(company) ? 80 : undefined} />
              </div>
              <CompanyMemoryExplain company={company} />
              <details className="mt-4 rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-surface-subtle)]"><summary className={detailSummaryClass}>Подробнее <ChevronDown size={16} /></summary><div className="grid gap-3 border-t border-[var(--ui-border)] p-4 text-sm leading-6 text-[var(--ui-text-soft)] lg:grid-cols-3"><EvidenceLine label="Website" value={company.website || "Not found"} href={company.website || undefined} /><EvidenceLine label="Lead Reasoning" value={company.reasoning || company.suggested_offer || "No backend reason yet."} /><EvidenceLine label="Email draft" value={latestEmail(company)?.subject || "No draft yet."} /><EvidenceLine label="Research Profile" value={company.ai_summary || company.opportunity_analysis || "Недостаточно данных"} /><EvidenceLine label="Outreach Strategy" value={company.outreach_strategy || company.sales_angle || "No outreach strategy yet."} /><EvidenceLine label="Manual Review" value={latestEmail(company)?.delivery_status === "approved" ? "Approved. Send still requires explicit confirmation." : "Review required before any send."} /></div></details>
            </SurfaceCard>
          ))}
        </section>
      ) : <EmptyStateView title="No clients saved yet." copy="Save verified First Customer Finder results from AI-помощник. Unsafe results stay in review instead of becoming CRM records." />}
    </Frame>
  );
}

function EmailsSection() {
  const api = useAiFirstApi();
  const [companies, setCompanies] = useState<CrmCompany[]>([]);
  const [inbox, setInbox] = useState<Email[]>([]);
  const [inboxPage, setInboxPage] = useState(1);
  const [inboxHasMore, setInboxHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const emails = useMemo(() => uniqueEmails(companies, inbox), [companies, inbox]);
  const load = useCallback(async () => {
    if (!api.ready) return;
    setLoading(true);
    try {
      const [nextCompanies, nextInbox] = await Promise.all([api.listCompanies(), api.listEmails(1, aiFirstInboxPageSize)]);
      setCompanies(nextCompanies);
      setInbox(nextInbox);
      setInboxPage(1);
      setInboxHasMore(nextInbox.length === aiFirstInboxPageSize);
      setLoadError("");
    } catch (err) {
      setLoadError(friendlyErrorMessage(err, "Could not load emails."));
    } finally {
      setLoading(false);
    }
  }, [api]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function loadOlderReplies() {
    if (!api.ready || !inboxHasMore || busy) return;
    const nextPage = inboxPage + 1;
    setBusy("inbox:more");
    setActionError("");
    try {
      const olderInbox = await api.listEmails(nextPage, aiFirstInboxPageSize);
      setInbox((current) => uniqueEmails([], [...current, ...olderInbox]));
      setInboxPage(nextPage);
      setInboxHasMore(olderInbox.length === aiFirstInboxPageSize);
    } catch (err) {
      setActionError(friendlyErrorMessage(err, "Could not load older replies."));
    } finally {
      setBusy("");
    }
  }

  async function approve(email: Email) {
    setBusy(`approve:${email.id}`);
    setNotice("");
    setActionError("");
    try {
      const response = await api.approveEmail(email.id);
      setNotice(response.message);
      await load();
    } catch (err) {
      setActionError(friendlyErrorMessage(err, "Could not approve this draft."));
    } finally {
      setBusy("");
    }
  }

  async function send(email: Email) {
    if (!window.confirm("Send this approved email now? OutreachAI will not send automatically.")) return;
    setBusy(`send:${email.id}`);
    setNotice("");
    setActionError("");
    try {
      const response = await api.sendApprovedEmail(email.id);
      setNotice(response.message);
      await load();
    } catch (err) {
      setActionError(friendlyErrorMessage(err, "Could not send this email."));
    } finally {
      setBusy("");
    }
  }

  async function trackReplies() {
    setBusy("reply:sync");
    setNotice("");
    setActionError("");
    try {
      const result = await api.syncGmailReplies();
      setNotice(`Replies synced: ${result.synced}. Reply tracking refreshed without sending automatic responses.`);
      await load();
    } catch (err) {
      setActionError(friendlyErrorMessage(err, "Could not sync Gmail replies."));
    } finally {
      setBusy("");
    }
  }

  return (
    <Frame title="Письма" copy="Email Approval Workspace: черновики и отправленные письма из backend. Отправка доступна только после ручного approve и отдельного подтверждения send.">
      <div className="flex flex-wrap justify-end gap-2">
        <AppButton variant="secondary" size="sm" disabled={Boolean(busy)} onClick={() => void trackReplies()} aria-label="Track replies from Gmail">
          {busy === "reply:sync" ? <Loader2 className="animate-spin" size={16} /> : <RefreshCw size={16} />} Track replies
        </AppButton>
        <AppButton variant="secondary" size="sm" onClick={() => void load()} aria-label="Refresh email drafts"><RefreshCw size={16} /> Refresh</AppButton>
      </div>
      {notice ? <Notice tone="good">{notice}</Notice> : null}
      {actionError ? <Notice tone="bad">{actionError}</Notice> : null}
      {loadError ? <Notice tone="bad">{loadError}</Notice> : null}
      <PremiumPanel className="border-amber-200 bg-amber-50">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 text-amber-700" size={22} />
          <div>
            <p className="font-black text-ink">AI creates drafts only</p>
            <p className="mt-1 text-sm font-semibold leading-6 text-amber-900">Approve verifies the draft. Send still requires a separate explicit confirmation and uses the existing backend email action.</p>
          </div>
        </div>
      </PremiumPanel>
      {loading ? <LoadingStateView title="Loading email approval workspace." /> : emails.length ? <div className="space-y-4"><section className="grid gap-4">{emails.map((email) => {
        const relatedCompany = companyForEmail(companies, email);
        const replySummary = replyAssistantText(email);
        return <SurfaceCard as="article" key={email.id} className="rounded-[1.75rem] p-5 transition motion-safe:hover:-translate-y-0.5">
          <div className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
            <div>
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.08em] text-[var(--ui-text-soft)]">Editable email draft</p>
                  <h2 className="mt-2 text-xl font-black tracking-tight text-ink">{email.subject || "No subject"}</h2>
                  <p className="mt-1 text-sm font-bold text-slate-600">{pretty(email.delivery_status)}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <AppButton variant="secondary" size="sm" disabled={Boolean(busy) || email.delivery_status === "sent"} onClick={() => void approve(email)} aria-label={`Approve email ${email.subject || email.id}`}>{busy === `approve:${email.id}` ? <Loader2 className="animate-spin" size={16} /> : <CheckCircle2 size={16} />} Approve</AppButton>
                  <AppButton size="sm" disabled={Boolean(busy) || email.delivery_status !== "approved"} onClick={() => void send(email)} aria-label={`Send email ${email.subject || email.id}`}>{busy === `send:${email.id}` ? <Loader2 className="animate-spin" size={16} /> : <Send size={16} />} Send</AppButton>
                </div>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <EvidenceLine label="Recipient" value={relatedCompany?.email || "Recipient not returned by this backend response"} />
                <EvidenceLine label="Company" value={relatedCompany?.name || "Company not linked in this response"} />
              </div>
              <div className="mt-4 rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-surface-subtle)] p-4">
                <p className="text-xs font-black uppercase tracking-[0.08em] text-[var(--ui-text-soft)]">Body</p>
                <p className="mt-3 max-w-3xl whitespace-pre-wrap text-sm leading-7 text-[var(--ui-text-soft)]">{email.body || email.preview || "No email body returned."}</p>
              </div>
            </div>
            <aside className="rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-surface-subtle)] p-4">
              <p className="text-xs font-black uppercase tracking-[0.08em] text-[var(--ui-text-soft)]">AI reasoning</p>
              <p className="mt-2 text-sm font-semibold leading-6 text-slate-700">{relatedCompany?.reasoning || relatedCompany?.ai_summary || "No AI reasoning returned for this draft yet."}</p>
              <div className="mt-4 grid gap-3">
                <EvidenceLine label="Evidence used" value={relatedCompany?.opportunity_analysis || relatedCompany?.suggested_offer || "Недостаточно данных"} />
                <EvidenceLine label="Outreach strategy" value={relatedCompany?.outreach_strategy || relatedCompany?.sales_angle || "No outreach strategy returned yet."} />
                <EvidenceLine label="Safety state" value={email.delivery_status === "approved" ? "Approved. Send still requires confirmation." : email.delivery_status === "sent" ? "Sent through backend." : "Manual approval required."} />
                <EvidenceLine label="Reply tracking" value={email.delivery_status === "replied" ? (replySummary || "Reply received. Review and respond manually.") : email.replied_at ? "Reply timestamp recorded. Review the conversation before responding." : "No reply tracked yet."} />
              </div>
            </aside>
          </div>
        </SurfaceCard>;
      })}</section>{inboxHasMore ? <AppButton variant="secondary" disabled={Boolean(busy)} onClick={() => void loadOlderReplies()}>
        {busy === "inbox:more" ? <Loader2 className="animate-spin" size={16} /> : <Mail size={16} />} Load older replies
      </AppButton> : null}</div> : <EmptyStateView title="No email drafts yet." copy="Save a verified customer result to CRM to create a draft. AI will not send anything without explicit approval." />}
    </Frame>
  );
}

function AiFirstMemoryPanel() {
  const api = useAiFirstApi();
  const [settings, setSettings] = useState<AiMemorySettings | null>(null);
  const [entries, setEntries] = useState<AiMemoryEntry[]>([]);
  const [preference, setPreference] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    if (!api.ready) return;
    setLoading(true);
    try {
      const [nextSettings, nextEntries] = await Promise.all([api.memorySettings(), api.memoryEntries()]);
      setSettings(nextSettings);
      setEntries(nextEntries.entries);
      setError("");
    } catch (err) {
      setError(friendlyErrorMessage(err, "Could not load AI Memory."));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function toggleMemory() {
    if (!settings) return;
    setBusy("toggle");
    setNotice("");
    setError("");
    try {
      setSettings(await api.updateMemorySettings(!settings.enabled));
      setNotice(!settings.enabled ? "Workspace memory is on." : "Workspace memory is off.");
    } catch (err) {
      setError(friendlyErrorMessage(err, "Could not update AI Memory."));
    } finally {
      setBusy("");
    }
  }

  async function savePreference(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = preference.trim();
    if (!content) return;
    setBusy("preference");
    setNotice("");
    setError("");
    try {
      const created = await api.saveMemoryPreference(content);
      setEntries((current) => [created, ...current.filter((item) => item.id !== created.id)]);
      setPreference("");
      setNotice("Preference saved after explicit confirmation.");
    } catch (err) {
      setError(friendlyErrorMessage(err, "Could not save this preference."));
    } finally {
      setBusy("");
    }
  }

  async function deleteEntry(entry: AiMemoryEntry) {
    setBusy(`delete:${entry.id}`);
    setNotice("");
    setError("");
    try {
      await api.deleteMemoryEntry(entry.id);
      setEntries((current) => current.filter((item) => item.id !== entry.id));
      setNotice("Memory entry deleted.");
    } catch (err) {
      setError(friendlyErrorMessage(err, "Could not delete this memory entry."));
    } finally {
      setBusy("");
    }
  }

  async function clearMemory() {
    if (!window.confirm("Clear AI Memory for this workspace? This will not affect other workspaces.")) return;
    setBusy("clear");
    setNotice("");
    setError("");
    try {
      const response = await api.clearMemory();
      setEntries([]);
      setSettings((current) => current ? { ...current, active_count: 0, counts_by_type: {} } : current);
      setNotice(`Cleared ${response.deleted} memory item(s).`);
    } catch (err) {
      setError(friendlyErrorMessage(err, "Could not clear AI Memory."));
    } finally {
      setBusy("");
    }
  }

  const enabledText = settings?.enabled ? "Workspace memory is on" : "Workspace memory is off";
  const statusTone = settings?.enabled ? "success" : "warning";

  return (
    <SurfaceCard className="rounded-[1.75rem] p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-black text-ink">AI Memory</h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">Isolated workspace memory for verified facts, approved preferences, interactions, assumptions and outcomes.</p>
        </div>
        <AppBadge tone={statusTone}>{enabledText}</AppBadge>
      </div>
      {notice ? <div className="mt-3"><Notice tone="good">{notice}</Notice></div> : null}
      {error ? <div className="mt-3"><Notice tone="bad">{error}</Notice></div> : null}
      {loading ? <LoadingStateView title="Loading AI Memory." /> : (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <EvidenceLine label="Remembered" value={`${settings?.active_count ?? entries.length} active item(s)`} />
            <EvidenceLine label="Retrieval" value={retrievalModeLabel(settings)} />
            <EvidenceLine label="Retention" value={`${settings?.retention_days || 0} days`} />
          </div>
          <form onSubmit={savePreference} className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]">
            <label className="text-sm font-bold text-[var(--ui-text-soft)]">
              Confirmed preference
              <input value={preference} onChange={(event) => setPreference(event.target.value)} className={fieldClass} placeholder="Example: use a concise, consultative tone" />
            </label>
            <AppButton type="submit" size="md" disabled={Boolean(busy) || !preference.trim()} className="self-end">
              {busy === "preference" ? <Loader2 className="animate-spin" size={16} /> : <CheckCircle2 size={16} />}
              Save
            </AppButton>
          </form>
          <div className="mt-4 flex flex-wrap gap-2">
            <AppButton variant="secondary" size="sm" disabled={Boolean(busy) || !settings} onClick={() => void toggleMemory()}>
              {busy === "toggle" ? <Loader2 className="animate-spin" size={16} /> : <ShieldCheck size={16} />}
              {settings?.enabled ? "Turn off" : "Turn on"}
            </AppButton>
            <AppButton variant="secondary" size="sm" disabled={Boolean(busy)} onClick={() => void load()} aria-label="Refresh AI Memory"><RefreshCw size={16} /> Refresh</AppButton>
            <AppButton variant="secondary" size="sm" disabled={Boolean(busy) || !entries.length} onClick={() => void clearMemory()}><Trash2 size={16} /> Clear memory</AppButton>
          </div>
          <div className="mt-4 grid gap-2">
            {entries.slice(0, 5).map((entry) => (
              <div key={entry.id} className="flex flex-col gap-3 rounded-2xl border border-[var(--ui-border)] bg-white p-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="text-xs font-black uppercase tracking-[0.08em] text-[var(--ui-text-soft)]">{memoryTypeLabel(entry.memory_type)} · {entry.source}</p>
                  <p className="mt-1 break-words text-sm font-semibold leading-6 text-slate-700">{entry.content}</p>
                </div>
                <AppButton variant="secondary" size="sm" disabled={Boolean(busy)} onClick={() => void deleteEntry(entry)} aria-label={`Delete memory ${entry.id}`}>
                  {busy === `delete:${entry.id}` ? <Loader2 className="animate-spin" size={16} /> : <Trash2 size={16} />}
                  Delete
                </AppButton>
              </div>
            ))}
            {!entries.length ? <p className="rounded-2xl border border-[var(--ui-border)] bg-white p-3 text-sm font-semibold text-slate-600">No memory entries stored yet.</p> : null}
          </div>
        </>
      )}
    </SurfaceCard>
  );
}

function SettingsSection() {
  const api = useAiFirstApi();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [integrations, setIntegrations] = useState<WorkspaceIntegrationStatus[]>([]);
  const [sender, setSender] = useState<OutreachSenderStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    if (!api.ready) return;
    setLoading(true);
    try {
      const [nextWorkspace, nextIntegrations, nextSender] = await Promise.all([api.getWorkspace(), api.integrations(), api.senderStatus()]);
      setWorkspace(nextWorkspace);
      setIntegrations(nextIntegrations.integrations);
      setSender(nextSender);
      setError("");
    } catch (err) {
      setError(friendlyErrorMessage(err, "Could not load settings."));
    } finally {
      setLoading(false);
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

  async function connectGmail() {
    if (!gmailOAuthStartReady(sender)) {
      setError(gmailOAuthStartReason(sender));
      return;
    }
    setBusy("connect");
    setError("");
    try {
      const response = await api.startGmailOAuth();
      window.location.assign(response.auth_url);
    } catch (err) {
      setError(friendlyErrorMessage(err, "Could not start secure Google OAuth."));
      setBusy("");
    }
  }

  async function disconnectGmail() {
    if (!window.confirm("Disconnect this Gmail OAuth mailbox? Other sender settings will not be treated as Gmail OAuth.")) return;
    setBusy("disconnect");
    setError("");
    try {
      setSender(await api.disconnectGmail());
      setNotice("Gmail OAuth disconnected.");
    } catch (err) {
      setError(friendlyErrorMessage(err, "Could not disconnect Gmail OAuth."));
    } finally {
      setBusy("");
    }
  }

  const gmailReady = gmailOAuthReady(sender);
  const canStartGmailOAuth = gmailOAuthStartReady(sender);
  const currentProvider = providerLabel(sender?.provider);
  const oauthProvider = gmailReady ? "Gmail OAuth" : "Not connected";

  return (
    <Frame title="Настройки" copy="Workspace, Gmail OAuth, sender safety, billing и account. Статусы приходят из backend и остаются scoped к текущему аккаунту.">
      {notice ? <Notice tone="good">{notice}</Notice> : null}
      {error ? <Notice tone="bad">{error}</Notice> : null}
      {loading ? <LoadingStateView title="Loading workspace settings." /> : null}
      <section className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <form onSubmit={save} className="ui-card rounded-[1.75rem] p-5"><h2 className="text-lg font-black text-ink">Workspace</h2><p className="mt-1 text-sm leading-6 text-slate-600">Profile and workspace fields used by AI context.</p><div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="text-sm font-bold text-[var(--ui-text-soft)]">Name<input name="name" defaultValue={workspace?.name || ""} className={fieldClass} /></label><label className="text-sm font-bold text-[var(--ui-text-soft)]">Company<input name="company" defaultValue={workspace?.company || ""} className={fieldClass} /></label><label className="text-sm font-bold text-[var(--ui-text-soft)]">Industry<input name="industry" defaultValue={workspace?.industry || ""} className={fieldClass} /></label><label className="text-sm font-bold text-[var(--ui-text-soft)]">Target country<input name="target_country" defaultValue={workspace?.target_country || ""} className={fieldClass} /></label><label className="text-sm font-bold text-[var(--ui-text-soft)] sm:col-span-2">Target customer<input name="target_customer" defaultValue={workspace?.target_customer || ""} className={fieldClass} /></label></div><AppButton type="submit" size="md" className="mt-4"><CheckCircle2 size={16} /> Save workspace</AppButton></form>
        <div className="grid gap-4"><SurfaceCard className="rounded-[1.75rem] p-5"><h2 className="text-lg font-black text-ink">Integrations</h2><div className="mt-3 grid gap-2">{integrations.length ? integrations.map((item) => <div key={item.key} className="rounded-2xl border border-[var(--ui-border)] p-3 transition hover:border-[var(--ui-border-strong)]"><div className="flex items-center justify-between gap-3"><p className="font-black text-ink">{item.label}</p><AppBadge tone={item.status === "connected" ? "success" : "warning"}>{item.status}</AppBadge></div><p className="mt-1 text-sm leading-6 text-slate-600">{item.message}</p></div>) : <p className="text-sm text-slate-600">Integration status not loaded.</p>}</div></SurfaceCard><SurfaceCard className="rounded-[1.75rem] p-5"><div className="flex items-start justify-between gap-3"><div><h2 className="text-lg font-black text-ink">Email sender</h2><p className="mt-1 text-sm leading-6 text-slate-600">Gmail OAuth is checked separately from other staging senders.</p></div><AppBadge tone={gmailReady ? "success" : "warning"}>{gmailReady ? "connected" : "needs OAuth"}</AppBadge></div><div className="mt-4 rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-surface-subtle)] p-4 text-sm leading-6 text-slate-700"><p><span className="font-black text-ink">Provider:</span> {oauthProvider}</p><p><span className="font-black text-ink">Mailbox:</span> {sender?.oauth_mailbox || "Not connected"}</p><p><span className="font-black text-ink">OAuth status:</span> {sender?.oauth_status || "not_connected"}</p><p><span className="font-black text-ink">Connected at:</span> {formatDateTime(sender?.oauth_connected_at)}</p><p><span className="font-black text-ink">Other sender:</span> {currentProvider}{sender?.provider !== "gmail" && sender?.sender_email ? ` (${sender.sender_email})` : ""}</p></div>{!gmailReady && !canStartGmailOAuth ? <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm font-bold text-amber-800">{gmailOAuthStartReason(sender)}</p> : null}<div className="mt-4 flex flex-wrap gap-2"><AppButton size="sm" disabled={Boolean(busy) || !canStartGmailOAuth} onClick={() => void connectGmail()}><Mail size={16} /> {busy === "connect" ? "Opening Gmail..." : gmailReady ? "Reconnect Gmail" : "Connect Gmail"}</AppButton>{gmailReady ? <AppButton variant="secondary" size="sm" disabled={Boolean(busy)} onClick={() => void disconnectGmail()}>Disconnect</AppButton> : null}<AppButton variant="secondary" size="sm" disabled={Boolean(busy)} onClick={() => void load()} aria-label="Refresh settings"><RefreshCw size={16} /> Refresh</AppButton></div></SurfaceCard></div>
      </section>
      <section className="grid gap-4 md:grid-cols-3">
        <PremiumPanel><p className="text-sm font-black text-ink">Email safety</p><p className="mt-2 text-sm leading-6 text-slate-600">Manual approval, Pause and Stop remain visible before external sending.</p></PremiumPanel>
        <PremiumPanel><p className="text-sm font-black text-ink">Plan</p><p className="mt-2 text-sm leading-6 text-slate-600">Plan management stays on the existing billing route.</p><Link href="/dashboard/billing" className="focus-ring mt-3 inline-flex min-h-10 items-center rounded-full border border-[var(--ui-border)] bg-white px-3 text-sm font-black text-ink transition hover:border-[var(--ui-brand)]">Open billing</Link></PremiumPanel>
        <PremiumPanel><p className="text-sm font-black text-ink">Account</p><p className="mt-2 text-sm leading-6 text-slate-600">Authentication remains handled by the secure account session.</p></PremiumPanel>
      </section>
      <AiFirstMemoryPanel />
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
