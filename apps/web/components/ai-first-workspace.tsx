"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { AlertTriangle, CheckCircle2, ChevronDown, ExternalLink, Loader2, Mail, RefreshCw, Send, Settings, ShieldCheck, Sparkles, Trash2, UsersRound } from "lucide-react";
import { AppBadge, AppButton, EmptyStateView, LoadingStateView, SurfaceCard } from "@/components/design-system";
import { useAuthRuntime } from "@/components/app-providers";
import { friendlyErrorMessage } from "@/lib/client-api";
import { latestDraftForResult, useAiFirstApi, type AiAssistantCommand, type ProductionEmailSmokeTestResponse } from "@/lib/ai-first-api";
import type { AiMemoryEntry, AiMemoryExplainResponse, AiMemorySettings, FirstCustomerJob, FirstCustomerResult, OutreachSenderStatus, WorkspaceIntegrationStatus } from "@/lib/customer-api-contracts";
import { e2eUserEmail, ownerEmail } from "@/lib/env";
import { useI18n } from "@/lib/i18n/provider";
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

const aiFirstInboxPageSize = 25;
const aiWorkflowLabels = ["Анализируем ваш бизнес", "Ищем компании", "Проверяем соответствие", "Ищем публичные контакты", "Готовим результаты"];
const crmStatuses = ["New", "Qualified", "Draft ready", "Approved", "Sent", "Replied", "Meeting", "Not interested"];
const fieldClass = "focus-ring mt-2 min-h-11 w-full rounded-xl border border-[var(--ui-border)] bg-white px-3 text-sm text-[var(--ui-text)] outline-none transition hover:border-[var(--ui-border-strong)] focus:border-[var(--ui-brand)]";
const detailSummaryClass = "flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-2xl px-4 py-3 text-sm font-black text-[var(--ui-text)] transition hover:bg-slate-100";
const qaAuthEnabled = process.env.NEXT_PUBLIC_APP_ENV === "test"
  && process.env.NEXT_PUBLIC_CLERK_E2E_BYPASS === "true"
  && (process.env.NEXT_PUBLIC_API_URL === "http://127.0.0.1:8000" || process.env.NEXT_PUBLIC_API_URL === "http://localhost:8000");

function pretty(value: string) {
  const text = value.replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const providerLockedEmailStatuses = new Set(["sent", "delivered", "opened", "replied", "bounced", "failed"]);

export function canEditEmailDraft(email: Pick<Email, "delivery_status" | "direction" | "sent_at" | "delivered_at" | "opened_at" | "bounced_at" | "replied_at">) {
  const status = String(email.delivery_status || "").toLowerCase();
  const direction = String(email.direction || "outbound").toLowerCase();
  return direction === "outbound" && (status === "draft" || status === "approved") && !providerLockedEmailStatuses.has(status) && !email.sent_at && !email.delivered_at && !email.opened_at && !email.bounced_at && !email.replied_at;
}

function canSendApprovedEmail(email: Email) {
  const status = String(email.delivery_status || "").toLowerCase();
  const direction = String(email.direction || "outbound").toLowerCase();
  return direction === "outbound" && status === "approved" && !email.sent_at && !email.delivered_at && !email.opened_at && !email.bounced_at && !email.replied_at;
}

function canRecoverEmailForRetry(email: Email) {
  const status = String(email.delivery_status || "").toLowerCase();
  const direction = String(email.direction || "outbound").toLowerCase();
  return direction === "outbound" && status === "send_confirmation_pending" && !email.sent_at;
}

function isProductionSmokeTestEmail(email: Email) {
  const tags = email.tags || {};
  return tags.source === "production_smoke_test" && tags.is_test === true;
}

function emailSafetyState(email: Email) {
  if (canRecoverEmailForRetry(email)) return "Delivery is unconfirmed. Check Gmail/SMTP Sent and recover only if the message is not there.";
  if (!canEditEmailDraft(email)) return "Read-only. Inbound replies and provider delivery records cannot be edited.";
  if (email.delivery_status === "approved") return "Approved. Editing will return it to draft and require approval again.";
  return "Manual approval required.";
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

function currentE2EUserEmail() {
  try {
    if (typeof window === "undefined") return e2eUserEmail;
    return window.localStorage.getItem("outreachai.e2eUserEmail") || e2eUserEmail;
  } catch {
    return e2eUserEmail;
  }
}

function useIsSystemOwner() {
  const { clerkEnabled } = useAuthRuntime();
  const [testEmail, setTestEmail] = useState(e2eUserEmail);

  useEffect(() => {
    if (!qaAuthEnabled && clerkEnabled) return;
    const timer = window.setTimeout(() => setTestEmail(currentE2EUserEmail()), 0);
    return () => window.clearTimeout(timer);
  }, [clerkEnabled]);

  if (!clerkEnabled || qaAuthEnabled) {
    return testEmail.trim().toLowerCase() === ownerEmail;
  }

  // The no-Clerk branch is required for local/E2E builds where ClerkProvider is intentionally not mounted.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const { user } = useUser();
  const currentEmail = user?.primaryEmailAddress?.emailAddress || user?.emailAddresses?.[0]?.emailAddress || "";
  return currentEmail.trim().toLowerCase() === ownerEmail;
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

function composeCommand(description: string, website: string) {
  const cleanDescription = description.trim();
  const cleanWebsite = normalizeWebsite(website);
  if (cleanDescription && cleanWebsite) return `${cleanDescription}\nСайт: ${cleanWebsite}`;
  return cleanDescription || cleanWebsite;
}

export function missingQuestion(command: string) {
  const text = command.trim();
  if (!text) return "Вставьте сайт или одним предложением опишите бизнес и кого хотите найти.";
  if (!isWebsiteInput(text) && text.length < 18) return "Что вы продаёте и кому?";
  return "";
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

type EmailDraftEdit = { recipient_email: string; subject: string; body: string };

function mergeDraftEdits(current: Record<string, EmailDraftEdit>, emails: Email[]) {
  const next = { ...current };
  for (const email of emails) {
    if (!next[email.id]) next[email.id] = { recipient_email: email.recipient_email || "", subject: email.subject || "", body: email.body || email.preview || "" };
  }
  return next;
}

function companyForEmail(companies: CrmCompany[], email: Email) {
  return companies.find((company) => company.generated_emails?.some((item) => item.id === email.id))
    || companies.find((company) => Boolean(email.lead_id) && company.lead_id === email.lead_id)
    || null;
}

function emailRecipient(email: Email, company?: CrmCompany | null) {
  return String(email.recipient_email || email.tags?.recipient_email || company?.email || "").trim();
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

function Notice({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "good" | "bad" | "warn" }) {
  const toneClass = tone === "good" ? "border-teal-200 bg-teal-50 text-teal-800" : tone === "bad" ? "border-red-200 bg-red-50 text-red-700" : tone === "warn" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-[var(--ui-border)] bg-white text-[var(--ui-text-soft)]";
  return <div role={tone === "bad" ? "alert" : "status"} aria-live="polite" className={`rounded-2xl border p-4 text-sm font-semibold leading-6 shadow-sm ${toneClass}`}>{children}</div>;
}

function PremiumPanel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <SurfaceCard className={`rounded-[1.75rem] p-5 transition motion-safe:hover:-translate-y-0.5 motion-safe:hover:shadow-raised ${className}`}>{children}</SurfaceCard>;
}

function ScoreTile({ label, value, copy, insufficientLabel = "Insufficient data", scoreSuffix = "out of 100" }: { label: string; value?: number | null; copy?: string; insufficientLabel?: string; scoreSuffix?: string }) {
  const score = typeof value === "number" ? Math.max(0, Math.min(100, Math.round(value))) : null;
  const tone = score === null ? "text-slate-500" : score >= 75 ? "text-teal-700" : score >= 50 ? "text-amber-700" : "text-red-700";
  return (
    <div aria-label={`${label}: ${score === null ? insufficientLabel : `${score} ${scoreSuffix}`}`} className="min-h-[8.5rem] rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-surface-subtle)] p-4 transition hover:border-[var(--ui-border-strong)]">
      <p className="text-xs font-black uppercase tracking-[0.08em] text-[var(--ui-text-soft)]">{label}</p>
      <p className={`mt-2 text-3xl font-black tracking-tight ${tone}`}>{score === null ? insufficientLabel : score}</p>
      {copy ? <p className="mt-2 text-sm font-semibold leading-6 text-[var(--ui-text-soft)]">{copy}</p> : null}
    </div>
  );
}

function EvidenceLine({ label, value, href }: { label: string; value?: string; href?: string }) {
  const text = String(value || "").trim();
  const testId = `evidence-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}`;
  return (
    <div data-testid={testId} className="min-h-[7.5rem] rounded-2xl border border-[var(--ui-border)] bg-white p-4 transition hover:border-[var(--ui-border-strong)]">
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

function activeWorkflowIndex(job: FirstCustomerJob | null) {
  const rawStage = String(job?.progress?.stage || job?.status || "").toLowerCase();
  if (!job) return -1;
  if (rawStage.includes("queued") || rawStage.includes("analysis") || rawStage.includes("analy")) return 0;
  if (rawStage.includes("search") || rawStage.includes("candidate")) return 1;
  if (rawStage.includes("verify") || rawStage.includes("scor") || rawStage.includes("match")) return 2;
  if (rawStage.includes("contact") || rawStage.includes("enrich")) return 3;
  if (["completed", "partially_completed", "failed"].includes(job.status) || rawStage.includes("complete")) return 4;
  if (job.results.length) return 4;
  return 1;
}

function workflowProgressText(job: FirstCustomerJob | null) {
  if (!job) return "Ожидаю описание бизнеса или URL сайта.";
  const backendMessage = String(job.progress?.message || job.error_message || "").trim();
  if (backendMessage) return backendMessage;
  if (job.status === "queued") return "Задача поставлена в очередь backend.";
  if (job.status === "running") return "Backend выполняет поиск и проверку результатов.";
  if (job.status === "failed") return "Backend вернул ошибку поиска.";
  if (job.status === "partially_completed") return "Результаты готовы частично. Неподтверждённые данные оставлены для проверки.";
  if (job.status === "completed") return "Результаты готовы.";
  return "AI is checking backend progress.";
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
  hideActions = false
}: {
  result: FirstCustomerResult;
  busy: string;
  onSave(result: FirstCustomerResult): void;
  hideActions?: boolean;
}) {
  const saved = Boolean(result.company_id || result.lead_id);
  const emailId = latestDraftForResult(result);
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
          <AppButton size="sm" disabled={Boolean(busy) || saved} onClick={() => onSave(result)} aria-label={`${saved ? "Saved" : "Сохранить в CRM"} ${result.company_name}`}>
            {busy === `save:${result.id}` ? <Loader2 className="animate-spin" size={16} /> : <CheckCircle2 size={16} />} {saved ? "Saved" : "Сохранить в CRM"}
          </AppButton>
          <Link href="/dashboard/emails" aria-disabled={!emailId} className={`focus-ring inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-[var(--ui-border)] px-3 text-sm font-black shadow-sm ${emailId ? "bg-white text-[var(--ui-text)]" : "pointer-events-none bg-slate-100 text-slate-400"}`}>
            <Mail size={16} /> Review draft
          </Link>
        </div> : null}
      </div>
      <div className="mt-5 grid gap-3 lg:grid-cols-4">
        <ScoreTile label="Overall score" value={overallScore} />
        <ScoreTile label="AI confidence" value={aiConfidence} />
        <ScoreTile label="Contact verification" value={contactConfidence} />
        <ScoreTile label="Outreach readiness" value={outreachReadiness} />
      </div>
      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        <EvidenceLine label="Why this company" value={result.fit_explanation || result.signal_description || "No fit explanation returned."} />
        <EvidenceLine label="Confirmed buying signals" value={result.evidence_summary || result.observed_fact || "Недостаточно подтверждённых buying signals."} />
        <EvidenceLine label="Source" value={result.source_title || sourceUrl(result) || "Источник не подтверждён"} href={sourceUrl(result)} />
        <EvidenceLine label="Contact and verification" value={[result.public_work_contact || "Контакт не подтверждён", websiteVerificationLabel(result)].filter(Boolean).join(" · ")} />
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

function evidenceScore(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function customerFinderScoreTiles(company: CrmCompany) {
  return {
    overallLeadScore: evidenceScore(company.overall_lead_score),
    websiteQuality: evidenceScore(company.website_quality_score),
    contactConfidence: evidenceScore(company.contact_confidence_score),
    outreachReadiness: evidenceScore(company.outreach_readiness_score),
    explanation: String(company.lead_score_explanation || "").trim()
  };
}

function AssistantSection() {
  const api = useAiFirstApi();
  const router = useRouter();
  const [businessDescription, setBusinessDescription] = useState("");
  const [website, setWebsite] = useState("");
  const [advanced, setAdvanced] = useState(blankCommand);
  const [understanding, setUnderstanding] = useState("");
  const [job, setJob] = useState<FirstCustomerJob | null>(null);
  const [jobs, setJobs] = useState<FirstCustomerJob[]>([]);
  const [sender, setSender] = useState<OutreachSenderStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
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
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    const command = composeCommand(businessDescription, website);
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
      setNotice("AI Поиск запущен. Результаты будут сохранены в CRM только после вашего нажатия.");
    } catch (err) {
      setError(friendlyErrorMessage(err, "AI customer search could not start."));
    } finally {
      setLoading(false);
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
    if (!window.confirm("Disconnect this Gmail mailbox from AI Поиск?")) return;
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

  async function saveResult(result: FirstCustomerResult) {
    setBusy(`save:${result.id}`);
    setError("");
    setNotice("");
    try {
      const response = await api.saveFinderResult(result.id);
      setNotice(`${response.message} Откройте CRM: карточка компании и draft письма уже подготовлены backend.`);
      if (job) setJob(await api.getCustomerFinderJob(job.id));
      router.push("/dashboard/clients");
    } catch (err) {
      setError(friendlyErrorMessage(err, "Could not save this company to CRM."));
    } finally {
      setBusy("");
    }
  }

  function updateAdvanced<K extends keyof AiAssistantCommand>(key: K, value: AiAssistantCommand[K]) {
    setAdvanced((current) => ({ ...current, [key]: value }));
  }

  const command = composeCommand(businessDescription, website);
  const criteria = commandToCriteria(command || "Find first customers", advanced);
  const progress = job?.progress || {};
  const found = job?.results.length || 0;
  const saved = job?.results.filter((result) => result.company_id || result.lead_id).length || Number(progress.saved || 0);
  const prepared = job?.results.filter((result) => result.email_id || result.email_body || result.draft_email).length || 0;
  const needsReview = job?.results.filter((result) => resultNeedsReview(result)).length || 0;
  const senderReady = gmailOAuthReady(sender);
  const canStartGmailOAuth = gmailOAuthStartReady(sender);
  const aiControlsReady = Boolean(hydrated && api.ready && sender && job);
  const activeStep = activeWorkflowIndex(job);
  const progressText = workflowProgressText(job);
  const nextAction = !senderReady
    ? "Подключите Gmail"
    : prepared > 0 && saved > 0
      ? "Письмо готово к подтверждению"
      : found > 0
        ? "Сохраните подходящую компанию в CRM"
        : job?.status === "failed"
          ? "Проверьте описание и запустите поиск ещё раз"
          : "Опишите бизнес и запустите AI Поиск";

  return (
    <Frame title="AI Поиск" copy="Один экран для первого продажного действия: описать бизнес, найти компании с evidence, сохранить в CRM и проверить AI draft перед отправкой.">
      <PremiumPanel className="bg-gradient-to-br from-white via-white to-slate-50">
        <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
          <form aria-label="AI customer command" onSubmit={submit} className="rounded-[1.5rem] border border-[var(--ui-border)] bg-white p-4 shadow-soft">
            <label className="block text-sm font-black text-[var(--ui-text)]">Опишите, что вы продаёте и кому хотите продавать<textarea value={businessDescription} onChange={(event) => setBusinessDescription(event.target.value)} className="focus-ring mt-2 min-h-40 w-full resize-y rounded-[1.25rem] border border-[var(--ui-border)] bg-[var(--ui-surface-subtle)] p-4 text-base leading-7 text-[var(--ui-text)] outline-none transition hover:border-[var(--ui-border-strong)] focus:border-[var(--ui-brand)] focus:bg-white" placeholder="Например: продаём AI-продавца для B2B SaaS команд, которые хотят находить клиентов и отправлять персональные письма после ручного approval" /></label>
            <label className="mt-3 block text-sm font-black text-[var(--ui-text)]">URL сайта, если есть<input value={website} onChange={(event) => setWebsite(event.target.value)} className={fieldClass} placeholder="https://example.com" /></label>
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
                <WorkflowStep key={label} index={index + 1} label={label} active={index === activeStep} />
              ))}
            </div>
          </div>
        </div>
      </PremiumPanel>
      {notice ? <Notice tone="good">{notice}</Notice> : null}
      {error ? <Notice tone="bad">{error}</Notice> : null}
      <section className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <PremiumPanel>
          <p className="text-sm font-black text-ink">Понимание задачи</p>
          <p className="mt-2 text-sm leading-6 text-slate-700">{understanding || understandingFor(command || "https://outreachaiaiai.com", criteria)}</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-5">
            {[["Найдено", found], ["CRM", saved], ["Draft", prepared], ["Review", needsReview], ["Шаг", activeStep + 1 > 0 ? activeStep + 1 : 0]].map(([label, value]) => <div key={String(label)} className="rounded-2xl bg-[var(--ui-surface-subtle)] p-3"><p className="text-xs font-black uppercase text-[var(--ui-text-soft)]">{label}</p><p className="mt-1 text-2xl font-black text-[var(--ui-text)]">{value}</p></div>)}
          </div>
          <div role="status" aria-live="polite" className="mt-4 rounded-2xl bg-[var(--ui-surface-subtle)] p-4">
            <p className="text-xs font-black uppercase text-[var(--ui-text-soft)]">Что AI делает сейчас</p>
            <p className="mt-2 text-sm leading-6 text-[var(--ui-text-soft)]">{progressText}</p>
            {needsReview ? <p className="mt-2 text-sm font-bold text-amber-700">{needsReview} лид(ов) оставлены со статусом «Требует проверки».</p> : null}
          </div>
        </PremiumPanel>
        <PremiumPanel>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-black text-ink">Следующее действие</h2>
            <AppBadge tone={senderReady ? "success" : "warning"}>{senderReady ? "Gmail connected" : "Gmail needed"}</AppBadge>
          </div>
          <div className="mt-3 grid gap-2 text-sm leading-6 text-slate-700">
            <p><span className="font-black text-ink">Рекомендация:</span> {nextAction}</p>
            <p><span className="font-black text-ink">Почта:</span> {senderReady ? `${sender?.oauth_mailbox} через Gmail OAuth` : "подключите Gmail OAuth перед отправкой"}</p>
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
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <Link href="/dashboard/clients" className="focus-ring inline-flex min-h-11 items-center justify-center rounded-md border border-slate-300 bg-white px-3 text-sm font-black text-ink">Открыть CRM</Link>
            <Link href="/dashboard/emails" className="focus-ring inline-flex min-h-11 items-center justify-center rounded-md border border-slate-300 bg-white px-3 text-sm font-black text-ink">Проверить письма</Link>
          </div>
        </PremiumPanel>
      </section>
      {job?.results.length ? <div className="grid gap-5">
        {job.results.filter((result) => !needsReviewTier(result)).length ? <section className="grid gap-3"><h2 className="text-sm font-black uppercase tracking-[0.08em] text-[var(--ui-text-soft)]">Verified / Relevant</h2>{job.results.filter((result) => !needsReviewTier(result)).map((result) => <ResultCard key={result.id} result={result} busy={busy} onSave={saveResult} />)}</section> : null}
        {job.results.filter(needsReviewTier).length ? <section className="grid gap-3"><h2 className="text-sm font-black uppercase tracking-[0.08em] text-amber-700">Needs review</h2>{job.results.filter(needsReviewTier).map((result) => <ResultCard key={result.id} result={result} busy={busy} onSave={saveResult} />)}</section> : null}
      </div> : null}
      {jobs.length > 1 ? <details className="rounded-[1.5rem] border border-[var(--ui-border)] bg-white shadow-sm"><summary className={detailSummaryClass}>Previous searches <ChevronDown size={16} /></summary><div className="border-t border-[var(--ui-border)] p-2">{jobs.slice(1).map((item) => <button key={item.id} type="button" onClick={() => setJob(item)} className="focus-ring flex min-h-11 w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition hover:bg-slate-50"><span>{pretty(item.status)}</span><span className="font-bold">{item.results.length} result(s)</span></button>)}</div></details> : null}
    </Frame>
  );
}

function ClientsSection() {
  const api = useAiFirstApi();
  const { t, locale } = useI18n();
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
  const insufficientLabel = t("Insufficient data");
  const scoreSuffix = t("out of 100");
  return (
    <Frame title="CRM" copy="Простой список компаний: стадия, контакт, последнее действие и следующее рекомендуемое действие.">
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
            <p className="mt-2 text-sm font-semibold leading-6 text-slate-700">{nextCompany ? (latestEmail(nextCompany) ? "Review the email approval state, then send only after explicit confirmation." : "Open lead details, verify evidence and create the personalised draft.") : "Find leads from AI Поиск first."}</p>
          </PremiumPanel>
          {companies.map((company) => {
            const scoring = customerFinderScoreTiles(company);
            const scoreCopy = scoring.explanation || (locale === "ru" ? "Оценка рассчитана из подтверждённых AI Search evidence." : "Score calculated from confirmed AI Search evidence.");
            return (
            <SurfaceCard as="article" key={company.id} className="rounded-[1.75rem] p-5 transition motion-safe:hover:-translate-y-0.5">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0"><h2 className="text-xl font-black tracking-tight text-ink">{company.name}</h2><p className="mt-1 text-sm text-slate-600">{[company.industry, company.city, company.country].filter(Boolean).join(" · ") || "No company profile fields yet."}</p><p className="mt-2 text-sm leading-6 text-slate-700">{company.ai_summary || company.opportunity_analysis || "AI research has not filled a summary yet."}</p></div>
                <div className="flex flex-wrap gap-2 lg:justify-end">
                  <AppBadge tone="neutral">{company.crm_stage || company.email_status}</AppBadge>
                  <AppBadge tone={latestEmail(company)?.delivery_status === "sent" ? "success" : "brand"}>{latestEmail(company)?.delivery_status || "draft needed"}</AppBadge>
                </div>
              </div>
              <div className="mt-4 grid gap-3 lg:grid-cols-4">
                <ScoreTile label="Overall Lead Score" value={scoring.overallLeadScore} copy={scoring.overallLeadScore === null ? undefined : scoreCopy} insufficientLabel={insufficientLabel} scoreSuffix={scoreSuffix} />
                <ScoreTile label="Website Quality" value={scoring.websiteQuality} insufficientLabel={insufficientLabel} scoreSuffix={scoreSuffix} />
                <ScoreTile label="Contact Confidence" value={scoring.contactConfidence} insufficientLabel={insufficientLabel} scoreSuffix={scoreSuffix} />
                <ScoreTile label="Outreach Readiness" value={scoring.outreachReadiness} insufficientLabel={insufficientLabel} scoreSuffix={scoreSuffix} />
              </div>
              <CompanyMemoryExplain company={company} />
              <details className="mt-4 rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-surface-subtle)]"><summary className={detailSummaryClass}>Подробнее <ChevronDown size={16} /></summary><div className="grid gap-3 border-t border-[var(--ui-border)] p-4 text-sm leading-6 text-[var(--ui-text-soft)] lg:grid-cols-3"><EvidenceLine label="Website" value={company.website || "Not found"} href={company.website || undefined} /><EvidenceLine label="Lead Reasoning" value={company.reasoning || company.suggested_offer || "No backend reason yet."} /><EvidenceLine label="Email draft" value={latestEmail(company)?.subject || "No draft yet."} /><EvidenceLine label="Research Profile" value={company.ai_summary || company.opportunity_analysis || "Недостаточно данных"} /><EvidenceLine label="Outreach Strategy" value={company.outreach_strategy || company.sales_angle || "No outreach strategy yet."} /><EvidenceLine label="Manual Review" value={latestEmail(company)?.delivery_status === "approved" ? "Approved. Send still requires explicit confirmation." : "Review required before any send."} /></div></details>
            </SurfaceCard>
            );
          })}
        </section>
      ) : <EmptyStateView title="No companies saved yet." copy="Save a verified AI Поиск result to CRM. Unsafe results stay in review instead of becoming CRM records." />}
    </Frame>
  );
}

function EmailsSection() {
  const api = useAiFirstApi();
  const [companies, setCompanies] = useState<CrmCompany[]>([]);
  const [inbox, setInbox] = useState<Email[]>([]);
  const [draftEdits, setDraftEdits] = useState<Record<string, EmailDraftEdit>>({});
  const [recoverConfirmations, setRecoverConfirmations] = useState<Record<string, boolean>>({});
  const [inboxCursor, setInboxCursor] = useState("");
  const [inboxHasMore, setInboxHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [sendConfirmationEmail, setSendConfirmationEmail] = useState<Email | null>(null);
  const [sender, setSender] = useState<OutreachSenderStatus | null>(null);
  const emails = useMemo(() => uniqueEmails(companies, inbox), [companies, inbox]);
  const load = useCallback(async () => {
    if (!api.ready) return;
    setLoading(true);
    try {
      const [nextCompanies, nextInbox, nextSender] = await Promise.all([api.listCompanies(), api.listEmails("", aiFirstInboxPageSize), api.senderStatus()]);
      setCompanies(nextCompanies);
      setInbox(nextInbox.messages);
      setSender(nextSender);
      setDraftEdits((current) => mergeDraftEdits(current, uniqueEmails(nextCompanies, nextInbox.messages)));
      setInboxCursor(nextInbox.nextCursor);
      setInboxHasMore(nextInbox.hasMore);
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
    setBusy("inbox:more");
    setActionError("");
    try {
      const olderInbox = await api.listEmails(inboxCursor, aiFirstInboxPageSize);
      setInbox((current) => uniqueEmails([], [...current, ...olderInbox.messages]));
      setDraftEdits((current) => mergeDraftEdits(current, olderInbox.messages));
      setInboxCursor(olderInbox.nextCursor);
      setInboxHasMore(olderInbox.hasMore);
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

  async function saveEmailEdits(email: Email) {
    if (!canEditEmailDraft(email)) {
      setActionError("Inbound replies and sent provider records are read-only.");
      return;
    }
    const edit = draftEdits[email.id] || { recipient_email: emailRecipient(email, companyForEmail(companies, email)), subject: email.subject || "", body: email.body || "" };
    const wasApproved = email.delivery_status === "approved";
    const canEditRecipient = String(email.delivery_status || "").toLowerCase() === "draft";
    setBusy(`edit:${email.id}`);
    setNotice("");
    setActionError("");
    try {
      const response = await api.updateEmail(email.id, {
        ...(canEditRecipient ? { recipient_email: (edit.recipient_email || emailRecipient(email, companyForEmail(companies, email))).trim() } : {}),
        subject: edit.subject,
        body: edit.body,
        preview: edit.body.slice(0, 180)
      });
      setNotice(wasApproved ? "Changes saved. This email is back in draft and must be approved again before sending." : response.message);
      await load();
    } catch (err) {
      setActionError(friendlyErrorMessage(err, "Could not save this draft."));
    } finally {
      setBusy("");
    }
  }

  async function send(email: Email) {
    setSendConfirmationEmail(email);
  }

  async function confirmSend(email: Email) {
    const smokeTest = isProductionSmokeTestEmail(email);
    const smokeTestId = String(email.tags?.smoke_test_id || "");
    const smokeRecipient = emailRecipient(email);
    const relatedCompany = companyForEmail(companies, email);
    const edit = draftEdits[email.id] || { recipient_email: emailRecipient(email, relatedCompany), subject: email.subject || "", body: email.body || email.preview || "" };
    const senderEmail = String(sender?.oauth_mailbox || sender?.sender_email || email.tags?.sender_email || "").trim().toLowerCase();
    const recipientEmail = String(edit.recipient_email || smokeRecipient || "").trim().toLowerCase();
    setBusy(`send:${email.id}`);
    setNotice("");
    setActionError("");
    try {
      if (!smokeTest) {
        if (!senderEmail || !recipientEmail || !edit.subject || !edit.body) {
          throw new Error("Sender, recipient, subject, and body are required before final send confirmation.");
        }
        await api.approveEmail(email.id, {
          confirmed_exact_draft: true,
          sender_email: senderEmail,
          recipient_email: recipientEmail,
          subject: edit.subject,
          body: edit.body
        });
      }
      const response = await api.sendApprovedEmail(email.id, smokeTest ? { confirmed_send: true, smoke_test_id: smokeTestId, recipient_email: smokeRecipient } : undefined);
      setNotice(response.message);
      setSendConfirmationEmail(null);
      await load();
    } catch (err) {
      setActionError(friendlyErrorMessage(err, "Could not send this email."));
    } finally {
      setBusy("");
    }
  }

  async function recoverForRetry(email: Email) {
    if (!canRecoverEmailForRetry(email)) return;
    if (!recoverConfirmations[email.id]) {
      setActionError("Confirm that the message is not in Gmail or SMTP Sent before recovering it for retry.");
      return;
    }
    setBusy(`recover:${email.id}`);
    setNotice("");
    setActionError("");
    try {
      const response = await api.recoverEmailForRetry(email.id, true);
      setNotice(response.message || "Interrupted send recovered for retry. Nothing was sent automatically.");
      setRecoverConfirmations((current) => ({ ...current, [email.id]: false }));
      await load();
    } catch (err) {
      setActionError(friendlyErrorMessage(err, "Could not recover this email for retry."));
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
        const edit = draftEdits[email.id] || { recipient_email: emailRecipient(email, relatedCompany), subject: email.subject || "", body: email.body || email.preview || "" };
        const editable = canEditEmailDraft(email);
        const approvedEditable = editable && email.delivery_status === "approved";
        const recipientEditable = editable && email.delivery_status === "draft";
        const recipient = emailRecipient(email, relatedCompany);
        const sendable = canSendApprovedEmail(email) && Boolean(recipient);
        const recoverable = canRecoverEmailForRetry(email);
        const recoveryConfirmed = Boolean(recoverConfirmations[email.id]);
        const smokeTest = isProductionSmokeTestEmail(email);
        return <SurfaceCard as="article" key={email.id} className="rounded-[1.75rem] p-5 transition motion-safe:hover:-translate-y-0.5">
          <div className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
            <div>
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.08em] text-[var(--ui-text-soft)]">{smokeTest ? "Production smoke-test draft" : "Editable email draft"}</p>
                  <h2 className="mt-2 text-xl font-black tracking-tight text-ink">{email.subject || "No subject"}</h2>
                  <p className="mt-1 text-sm font-bold text-slate-600">{pretty(email.delivery_status)}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <AppButton variant="secondary" size="sm" disabled={Boolean(busy) || !editable} onClick={() => void saveEmailEdits(email)} aria-label={`Save email edits ${email.subject || email.id}`}>{busy === `edit:${email.id}` ? <Loader2 className="animate-spin" size={16} /> : <CheckCircle2 size={16} />} Save edits</AppButton>
                  <AppButton variant="secondary" size="sm" disabled={Boolean(busy) || !editable || email.delivery_status === "approved"} onClick={() => void approve(email)} aria-label={`Approve email ${email.subject || email.id}`}>{busy === `approve:${email.id}` ? <Loader2 className="animate-spin" size={16} /> : <CheckCircle2 size={16} />} Approve</AppButton>
                  <AppButton size="sm" disabled={Boolean(busy) || !sendable} onClick={() => void send(email)} aria-label={`Send email ${email.subject || email.id}`}>{busy === `send:${email.id}` ? <Loader2 className="animate-spin" size={16} /> : <Send size={16} />} Send</AppButton>
                </div>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <EvidenceLine label="Recipient" value={recipient || "Recipient not returned by this backend response"} />
                <EvidenceLine label="Company" value={relatedCompany?.name || "Company not linked in this response"} />
                {smokeTest ? <EvidenceLine label="Workspace" value={String(email.tags?.workspace_name || relatedCompany?.name || "Current workspace")} /> : null}
                {smokeTest ? <EvidenceLine label="Sender" value={String(email.tags?.sender_email || "Not returned")} /> : null}
                {smokeTest ? <EvidenceLine label="Provider" value={providerLabel(String(email.tags?.sender_provider || ""))} /> : null}
                {smokeTest ? <EvidenceLine label="Smoke test ID" value={String(email.tags?.smoke_test_id || "")} /> : null}
              </div>
              <div className="mt-4 grid gap-3 rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-surface-subtle)] p-4">
                {approvedEditable ? <Notice tone="warn">Editing an approved email returns it to draft. Approve it again before Send is enabled.</Notice> : null}
                {recoverable ? <Notice tone="warn">
                  <div className="space-y-3">
                    <p className="font-black text-amber-950">Delivery confirmation required</p>
                    <p>Check Gmail or SMTP Sent for this mailbox. Recover for retry only after you confirm this exact email was not sent.</p>
                    <label className="flex items-start gap-3 text-sm font-bold text-amber-950">
                      <input
                        type="checkbox"
                        checked={recoveryConfirmed}
                        onChange={(event) => setRecoverConfirmations((current) => ({ ...current, [email.id]: event.target.checked }))}
                        className="mt-1 h-4 w-4 rounded border-amber-400"
                      />
                      I checked Gmail/SMTP Sent and this email was not sent.
                    </label>
                    <AppButton variant="secondary" size="sm" disabled={Boolean(busy) || !recoveryConfirmed} onClick={() => void recoverForRetry(email)} aria-label={`Recover for retry ${email.subject || email.id}`}>
                      {busy === `recover:${email.id}` ? <Loader2 className="animate-spin" size={16} /> : <ShieldCheck size={16} />} Recover for retry
                    </AppButton>
                  </div>
                </Notice> : null}
                {!editable && !recoverable ? <Notice tone="warn">This message is read-only because it is an inbound reply or provider delivery record.</Notice> : null}
                <label className="text-xs font-black uppercase tracking-[0.08em] text-[var(--ui-text-soft)]">Recipient email<input type="email" value={edit.recipient_email} onChange={(event) => setDraftEdits((current) => ({ ...current, [email.id]: { ...(current[email.id] || edit), recipient_email: event.target.value } }))} disabled={!recipientEditable} className={fieldClass} /></label>
                <label className="text-xs font-black uppercase tracking-[0.08em] text-[var(--ui-text-soft)]">Subject<input value={edit.subject} onChange={(event) => setDraftEdits((current) => ({ ...current, [email.id]: { ...(current[email.id] || edit), subject: event.target.value } }))} disabled={!editable} className={fieldClass} /></label>
                <label className="text-xs font-black uppercase tracking-[0.08em] text-[var(--ui-text-soft)]">Body<textarea value={edit.body} onChange={(event) => setDraftEdits((current) => ({ ...current, [email.id]: { ...(current[email.id] || edit), body: event.target.value } }))} disabled={!editable} className="focus-ring mt-2 min-h-48 w-full resize-y rounded-xl border border-[var(--ui-border)] bg-white p-3 text-sm leading-7 text-[var(--ui-text)] outline-none transition hover:border-[var(--ui-border-strong)] focus:border-[var(--ui-brand)]" /></label>
              </div>
            </div>
            <aside className="rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-surface-subtle)] p-4">
              <p className="text-xs font-black uppercase tracking-[0.08em] text-[var(--ui-text-soft)]">AI reasoning</p>
              <p className="mt-2 text-sm font-semibold leading-6 text-slate-700">{relatedCompany?.reasoning || relatedCompany?.ai_summary || "No AI reasoning returned for this draft yet."}</p>
              <div className="mt-4 grid gap-3">
                <EvidenceLine label="Evidence used" value={relatedCompany?.opportunity_analysis || relatedCompany?.suggested_offer || "Недостаточно данных"} />
                <EvidenceLine label="Outreach strategy" value={relatedCompany?.outreach_strategy || relatedCompany?.sales_angle || "No outreach strategy returned yet."} />
                <EvidenceLine label="Safety state" value={emailSafetyState(email)} />
                <EvidenceLine label="Reply tracking" value={email.delivery_status === "replied" ? (replySummary || "Reply received. Review and respond manually.") : email.replied_at ? "Reply timestamp recorded. Review the conversation before responding." : "No reply tracked yet."} />
              </div>
            </aside>
          </div>
        </SurfaceCard>;
      })}</section>{inboxHasMore ? <AppButton variant="secondary" disabled={Boolean(busy)} onClick={() => void loadOlderReplies()}>
        {busy === "inbox:more" ? <Loader2 className="animate-spin" size={16} /> : <Mail size={16} />} Load older replies
      </AppButton> : null}</div> : <EmptyStateView title="No email drafts yet." copy="Save a verified customer result to CRM to create a draft. AI will not send anything without explicit approval." />}
      {sendConfirmationEmail ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4" role="dialog" aria-modal="true" aria-labelledby="send-confirmation-title">
          <div className="max-h-[calc(100vh-2rem)] w-full max-w-lg overflow-y-auto rounded-2xl border border-[var(--ui-border)] bg-white p-5 shadow-2xl">
            <h2 id="send-confirmation-title" className="text-lg font-black text-ink">Final Send confirmation</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">OutreachAI will send this approved email only after this confirmation. Closing this dialog sends nothing.</p>
            {isProductionSmokeTestEmail(sendConfirmationEmail) ? (
              <div className="mt-4 grid gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm">
                <EvidenceLine label="Smoke test ID" value={String(sendConfirmationEmail.tags?.smoke_test_id || "")} />
                <EvidenceLine label="Recipient" value={emailRecipient(sendConfirmationEmail)} />
                <EvidenceLine label="Workspace" value={String(sendConfirmationEmail.tags?.workspace_name || "Current workspace")} />
                <EvidenceLine label="Sender" value={String(sendConfirmationEmail.tags?.sender_email || "Not returned")} />
                <EvidenceLine label="Provider" value={providerLabel(String(sendConfirmationEmail.tags?.sender_provider || ""))} />
              </div>
            ) : (
              <div className="mt-4 grid gap-3 rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-surface-subtle)] p-4 text-sm">
                {(() => {
                  const relatedCompany = companyForEmail(companies, sendConfirmationEmail);
                  const edit = draftEdits[sendConfirmationEmail.id] || { recipient_email: emailRecipient(sendConfirmationEmail, relatedCompany), subject: sendConfirmationEmail.subject || "", body: sendConfirmationEmail.body || sendConfirmationEmail.preview || "" };
                  return (
                    <>
                      <EvidenceLine label="Sender" value={String(sender?.oauth_mailbox || sender?.sender_email || "Sender not connected")} />
                      <EvidenceLine label="Recipient" value={edit.recipient_email || "Recipient not returned by this backend response"} />
                      <EvidenceLine label="Subject" value={edit.subject || "No subject"} />
                      <div>
                        <p className="text-xs font-black uppercase tracking-[0.08em] text-[var(--ui-text-soft)]">Full body</p>
                        <pre className="mt-2 max-h-72 overflow-y-auto whitespace-pre-wrap rounded-xl bg-white p-3 text-sm leading-6 text-slate-800">{edit.body || "No body"}</pre>
                      </div>
                    </>
                  );
                })()}
              </div>
            )}
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <AppButton variant="secondary" size="sm" disabled={Boolean(busy)} onClick={() => setSendConfirmationEmail(null)}>Cancel</AppButton>
              <AppButton size="sm" disabled={Boolean(busy)} onClick={() => void confirmSend(sendConfirmationEmail)} aria-label={`Confirm Send ${sendConfirmationEmail.subject || sendConfirmationEmail.id}`}>
                {busy === `send:${sendConfirmationEmail.id}` ? <Loader2 className="animate-spin" size={16} /> : <Send size={16} />}
                Confirm Send
              </AppButton>
            </div>
          </div>
        </div>
      ) : null}
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
  const isSystemOwner = useIsSystemOwner();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [integrations, setIntegrations] = useState<WorkspaceIntegrationStatus[]>([]);
  const [sender, setSender] = useState<OutreachSenderStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [smokeRecipient, setSmokeRecipient] = useState("");
  const [smokeRecipientConfirmed, setSmokeRecipientConfirmed] = useState(false);
  const [lastSmokeTest, setLastSmokeTest] = useState<ProductionEmailSmokeTestResponse["smoke_test"] | null>(null);

  const load = useCallback(async () => {
    if (!api.ready) return;
    setLoading(true);
    try {
      const [nextWorkspace, nextIntegrations, nextSender, activeSmokeTest] = await Promise.all([
        api.getWorkspace(),
        api.integrations(),
        api.senderStatus(),
        isSystemOwner ? api.getActiveProductionEmailSmokeTest() : Promise.resolve<ProductionEmailSmokeTestResponse | null>(null)
      ]);
      setWorkspace(nextWorkspace);
      setIntegrations(nextIntegrations.integrations);
      setSender(nextSender);
      setLastSmokeTest(activeSmokeTest?.smoke_test || null);
      setError("");
    } catch (err) {
      setError(friendlyErrorMessage(err, "Could not load settings."));
    } finally {
      setLoading(false);
    }
  }, [api, isSystemOwner]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const payload = {
      name: String(data.get("name") || "").trim(),
      company: String(data.get("company") || "").trim(),
      industry: String(data.get("industry") || "").trim(),
      target_country: String(data.get("target_country") || "").trim(),
      target_customer: String(data.get("target_customer") || "").trim(),
      offer: String(data.get("offer") || "").trim(),
      cta: String(data.get("cta") || "Book a quick call").trim() || "Book a quick call",
      tone: String(data.get("tone") || "Professional").trim() || "Professional",
      timezone: workspace?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
    };
    const missing = [
      ["name", "Name"],
      ["company", "Company"],
      ["industry", "Industry"],
      ["target_country", "Target country"],
      ["target_customer", "Target customer"]
    ].filter(([key]) => !payload[key as keyof typeof payload]).map(([, label]) => label);
    if (missing.length) {
      setNotice("");
      setError(`Complete these workspace fields before saving: ${missing.join(", ")}.`);
      return;
    }
    setBusy("workspace:save");
    setError("");
    setNotice("");
    try {
      const updated = await api.updateWorkspace(payload);
      setWorkspace(updated);
      setNotice("Workspace settings saved.");
    } catch (err) {
      setError(friendlyErrorMessage(err, "Could not save workspace."));
    } finally {
      setBusy("");
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

  async function createSmokeTest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("smoke:create");
    setError("");
    setNotice("");
    try {
      const response = await api.createProductionEmailSmokeTest({
        recipient_email: smokeRecipient.trim(),
        confirmed_recipient_control: smokeRecipientConfirmed
      });
      setLastSmokeTest(response.smoke_test || null);
      setNotice(`${response.message} Workspace: ${response.smoke_test?.workspace_name || workspace?.name || "current"}. Sender: ${response.smoke_test?.sender_email || "not returned"} via ${providerLabel(response.smoke_test?.sender_provider)}. Recipient: ${response.smoke_test?.recipient_email || smokeRecipient}.`);
    } catch (err) {
      const message = friendlyErrorMessage(err, "Could not create production email smoke test.");
      setError(
        message.includes("couldn’t find what you were looking for") || message.includes("couldn't find what you were looking for")
          ? "Production email smoke-test endpoint is not available on the connected backend. Verify this preview is connected to a branch-matched API."
          : message
      );
    } finally {
      setBusy("");
    }
  }

  async function cleanupSmokeTest() {
    if (!lastSmokeTest?.smoke_test_id) {
      setError("No smoke-test ID is available for cleanup.");
      return;
    }
    if (!window.confirm(`Cleanup production smoke-test records for ${lastSmokeTest.smoke_test_id}?`)) return;
    setBusy("smoke:cleanup");
    setError("");
    setNotice("");
    try {
      const response = await api.cleanupProductionEmailSmokeTest(lastSmokeTest.smoke_test_id);
      setNotice(response.message);
      setLastSmokeTest(null);
      setSmokeRecipient("");
      setSmokeRecipientConfirmed(false);
    } catch (err) {
      setError(friendlyErrorMessage(err, "Could not cleanup production smoke-test records."));
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
        <form onSubmit={save} className="ui-card rounded-[1.75rem] p-5"><h2 className="text-lg font-black text-ink">Workspace</h2><p className="mt-1 text-sm leading-6 text-slate-600">Profile and workspace fields used by AI context.</p><div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="text-sm font-bold text-[var(--ui-text-soft)]">Name<input name="name" defaultValue={workspace?.name || ""} className={fieldClass} /></label><label className="text-sm font-bold text-[var(--ui-text-soft)]">Company<input name="company" defaultValue={workspace?.company || ""} className={fieldClass} /></label><label className="text-sm font-bold text-[var(--ui-text-soft)]">Industry<input name="industry" defaultValue={workspace?.industry || ""} className={fieldClass} /></label><label className="text-sm font-bold text-[var(--ui-text-soft)]">Target country<input name="target_country" defaultValue={workspace?.target_country || ""} className={fieldClass} /></label><label className="text-sm font-bold text-[var(--ui-text-soft)] sm:col-span-2">Target customer<input name="target_customer" defaultValue={workspace?.target_customer || ""} className={fieldClass} /></label><label className="text-sm font-bold text-[var(--ui-text-soft)] sm:col-span-2">Offer<textarea name="offer" defaultValue={workspace?.offer || ""} className="focus-ring mt-2 min-h-28 w-full resize-y rounded-xl border border-[var(--ui-border)] bg-white p-3 text-sm leading-7" /></label><label className="text-sm font-bold text-[var(--ui-text-soft)]">Tone<input name="tone" defaultValue={workspace?.tone || "Professional"} className={fieldClass} /></label><label className="text-sm font-bold text-[var(--ui-text-soft)]">CTA<input name="cta" defaultValue={workspace?.cta || "Book a quick call"} className={fieldClass} /></label></div><AppButton type="submit" size="md" disabled={busy === "workspace:save"} className="mt-4">{busy === "workspace:save" ? <Loader2 className="animate-spin" size={16} /> : <CheckCircle2 size={16} />} {busy === "workspace:save" ? "Saving workspace..." : "Save workspace"}</AppButton></form>
        <div className="grid gap-4"><SurfaceCard className="rounded-[1.75rem] p-5"><h2 className="text-lg font-black text-ink">Integrations</h2><div className="mt-3 grid gap-2">{integrations.length ? integrations.map((item) => <div key={item.key} className="rounded-2xl border border-[var(--ui-border)] p-3 transition hover:border-[var(--ui-border-strong)]"><div className="flex items-center justify-between gap-3"><p className="font-black text-ink">{item.label}</p><AppBadge tone={item.status === "connected" ? "success" : "warning"}>{item.status}</AppBadge></div><p className="mt-1 text-sm leading-6 text-slate-600">{item.message}</p></div>) : <p className="text-sm text-slate-600">Integration status not loaded.</p>}</div></SurfaceCard><SurfaceCard className="rounded-[1.75rem] p-5"><div className="flex items-start justify-between gap-3"><div><h2 className="text-lg font-black text-ink">Email sender</h2><p className="mt-1 text-sm leading-6 text-slate-600">Gmail OAuth is checked separately from other staging senders.</p></div><AppBadge tone={gmailReady ? "success" : "warning"}>{gmailReady ? "connected" : "needs OAuth"}</AppBadge></div><div className="mt-4 rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-surface-subtle)] p-4 text-sm leading-6 text-slate-700"><p><span className="font-black text-ink">Provider:</span> {oauthProvider}</p><p><span className="font-black text-ink">Mailbox:</span> {sender?.oauth_mailbox || "Not connected"}</p><p><span className="font-black text-ink">OAuth status:</span> {sender?.oauth_status || "not_connected"}</p><p><span className="font-black text-ink">Connected at:</span> {formatDateTime(sender?.oauth_connected_at)}</p><p><span className="font-black text-ink">Other sender:</span> {currentProvider}{sender?.provider !== "gmail" && sender?.sender_email ? ` (${sender.sender_email})` : ""}</p></div>{!gmailReady && !canStartGmailOAuth ? <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm font-bold text-amber-800">{gmailOAuthStartReason(sender)}</p> : null}<div className="mt-4 flex flex-wrap gap-2"><AppButton size="sm" disabled={Boolean(busy) || !canStartGmailOAuth} onClick={() => void connectGmail()}><Mail size={16} /> {busy === "connect" ? "Opening Gmail..." : gmailReady ? "Reconnect Gmail" : "Connect Gmail"}</AppButton>{gmailReady ? <AppButton variant="secondary" size="sm" disabled={Boolean(busy)} onClick={() => void disconnectGmail()}>Disconnect</AppButton> : null}<AppButton variant="secondary" size="sm" disabled={Boolean(busy)} onClick={() => void load()} aria-label="Refresh settings"><RefreshCw size={16} /> Refresh</AppButton></div></SurfaceCard></div>
      </section>
      {isSystemOwner ? <SurfaceCard className="rounded-[1.75rem] p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-lg font-black text-ink">Production email smoke test</h2>
            <p className="mt-1 text-sm leading-6 text-slate-600">Owner-only isolated test draft for the current workspace sender.</p>
          </div>
          <AppBadge tone="warning">owner only</AppBadge>
        </div>
        <form onSubmit={createSmokeTest} className="mt-4 grid gap-3">
          <label className="text-sm font-bold text-[var(--ui-text-soft)]">
            Recipient email
            <input type="email" value={smokeRecipient} onChange={(event) => setSmokeRecipient(event.target.value)} className={fieldClass} placeholder="owner-controlled address" />
          </label>
          <label className="flex items-start gap-3 text-sm font-bold text-slate-700">
            <input type="checkbox" checked={smokeRecipientConfirmed} onChange={(event) => setSmokeRecipientConfirmed(event.target.checked)} className="mt-1 h-4 w-4 rounded border-[var(--ui-border)]" />
            I control this recipient email and want to create isolated production smoke-test records.
          </label>
          <div className="flex flex-wrap gap-2">
            <AppButton type="submit" size="sm" disabled={Boolean(busy) || !smokeRecipient.trim() || !smokeRecipientConfirmed}>
              {busy === "smoke:create" ? <Loader2 className="animate-spin" size={16} /> : <ShieldCheck size={16} />}
              Production email smoke test
            </AppButton>
            <AppButton variant="secondary" size="sm" disabled={Boolean(busy) || !lastSmokeTest?.smoke_test_id} onClick={() => void cleanupSmokeTest()}>
              {busy === "smoke:cleanup" ? <Loader2 className="animate-spin" size={16} /> : <Trash2 size={16} />}
              Cleanup smoke test
            </AppButton>
            {lastSmokeTest?.smoke_test_id ? <Link href="/dashboard/emails" className="focus-ring inline-flex min-h-10 items-center rounded-full border border-[var(--ui-border)] bg-white px-3 text-sm font-black text-ink transition hover:border-[var(--ui-brand)]">Open draft</Link> : null}
          </div>
        </form>
        {lastSmokeTest ? <div className="mt-4 grid gap-3 rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-surface-subtle)] p-4 sm:grid-cols-2"><EvidenceLine label="Workspace" value={lastSmokeTest.workspace_name} /><EvidenceLine label="Sender" value={lastSmokeTest.sender_email || "Not returned"} /><EvidenceLine label="Provider" value={providerLabel(lastSmokeTest.sender_provider)} /><EvidenceLine label="Recipient" value={lastSmokeTest.recipient_email} /><EvidenceLine label="Smoke test ID" value={lastSmokeTest.smoke_test_id} /></div> : null}
      </SurfaceCard> : null}
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
        { href: "/dashboard", label: "AI Поиск", icon: Sparkles },
        { href: "/dashboard/clients", label: "CRM", icon: UsersRound },
        { href: "/dashboard/emails", label: "Письма", icon: Mail },
        { href: "/dashboard/settings", label: "Настройки", icon: Settings }
      ].map((item) => {
        const Icon = item.icon;
        return <Link key={item.href} href={item.href} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-black text-ink"><Icon size={16} /> {item.label}</Link>;
      })}
    </div>
  );
}
