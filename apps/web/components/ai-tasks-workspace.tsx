"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import * as Sentry from "@sentry/nextjs";
import { AlertTriangle, Bot, CheckCircle2, Clock3, ExternalLink, Loader2, Play, RefreshCw, ShieldCheck, StopCircle, XCircle } from "lucide-react";
import { AppButton, EmptyStateView, LoadingStateView, SurfaceCard } from "@/components/design-system";
import { useAgentRuntimeApi } from "@/lib/agent-runtime-api";
import type { AgentApprovalRequest, AgentRun, AgentRunDetail, AgentRuntimeStatus, AgentTraceEvent } from "@/lib/agent-runtime-contracts";
import { friendlyErrorMessage } from "@/lib/client-api";
import { useI18n } from "@/lib/i18n/provider";
import { trackEvent } from "@/lib/posthog";

type ApprovalChecks = Record<string, { reviewed: boolean; finalSend: boolean; generalReview: boolean }>;

const terminalStatuses = new Set(["completed", "failed", "cancelled"]);
const pollingStatuses = new Set(["queued", "planning", "running"]);
const sensitiveKeyPattern = /(authorization|cookie|api_key|apikey|access_token|refresh_token|oauth|password|secret|token|body|email_body|html_body|text_body)/i;
const internalMessagePattern = /(adapter|backend|control plane|exception|provider|raw error|secret|sql|stack|token|tool|traceback)/i;

const toolLabels: Record<string, string> = {
  understand_business: "aiTasks.tool.understandBusiness",
  search_companies: "aiTasks.tool.searchCompanies",
  research_company: "aiTasks.tool.researchCompany",
  verify_email: "aiTasks.tool.verifyEmail",
  score_lead: "aiTasks.tool.scoreLead",
  save_to_crm: "aiTasks.tool.saveToCrm",
  generate_email_draft: "aiTasks.tool.generateDraft",
  send_email: "aiTasks.tool.sendEmail",
  sync_replies: "aiTasks.tool.syncReplies"
};

function safeErrorText(error: unknown, fallback: string) {
  const message = friendlyErrorMessage(error, fallback);
  if (/control plane|orchestrator|permission|traceback|exception|stack|secret|token|sql/i.test(message)) {
    return fallback;
  }
  return message;
}

function formatDateTime(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatDuration(run?: AgentRun | null) {
  if (!run) return "0s";
  if (run.latency_ms > 0) return `${Math.max(1, Math.round(run.latency_ms / 1000))}s`;
  const start = new Date(run.created_at).getTime();
  const end = run.completed_at ? new Date(run.completed_at).getTime() : new Date(run.updated_at).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return "0s";
  return `${Math.max(1, Math.round((end - start) / 1000))}s`;
}

function tokenTotal(run?: AgentRun | null) {
  if (!run) return 0;
  const usage = run.token_usage || {};
  const total = Number(usage.total_tokens);
  if (Number.isFinite(total)) return total;
  const prompt = Number(usage.prompt_tokens);
  const completion = Number(usage.completion_tokens);
  return Math.max(0, (Number.isFinite(prompt) ? prompt : 0) + (Number.isFinite(completion) ? completion : 0));
}

function estimatedCost(run?: AgentRun | null) {
  if (!run || run.estimated_cost === null || !Number.isFinite(run.estimated_cost)) return "$0.00";
  return `$${run.estimated_cost.toFixed(4)}`;
}

function sanitizeTechnicalValue(value: unknown, depth = 0): unknown {
  if (depth > 5) return "[redacted]";
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") {
    if (/bearer |refresh_token|access_token|smtp_password|api[_-]?key|secret/i.test(value)) return "[redacted]";
    return value.length > 500 ? `${value.slice(0, 500)}...` : value;
  }
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitizeTechnicalValue(item, depth + 1));
  if (typeof value === "object") {
    const clean: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      clean[key] = sensitiveKeyPattern.test(key) ? "[redacted]" : sanitizeTechnicalValue(item, depth + 1);
    }
    return clean;
  }
  return String(value);
}

function technicalTrace(trace: AgentTraceEvent[]) {
  return trace.map((event) => ({
    time: event.created_at,
    status: event.status,
    step: event.tool_name ? toolLabels[event.tool_name] || "aiTasks.tool.default" : "aiTasks.event",
    message: event.message,
    latency_ms: event.latency_ms,
    token_usage: sanitizeTechnicalValue(event.token_usage),
    estimated_cost: event.estimated_cost
  }));
}

function outputSummary(detail: AgentRunDetail | null, translate: (key: string) => string) {
  if (!detail) return translate("aiTasks.noResultYet");
  if (detail.run.status === "waiting_approval") return translate("aiTasks.resultWaitingApproval");
  if (detail.run.status === "failed") return translate("aiTasks.resultFailed");
  if (detail.run.status === "cancelled") return translate("aiTasks.resultCancelled");
  const completed = [...detail.steps].reverse().find((step) => step.status === "completed" && Object.keys(step.output || {}).length);
  if (!completed) return detail.run.status === "completed" ? translate("aiTasks.resultCompletedNoOutput") : translate("aiTasks.noResultYet");
  const output = completed.output || {};
  if (output.status === "dry_run" || output.dry_run === true) return translate("aiTasks.resultDryRun");
  if (typeof output.reason === "string" && output.reason && !internalMessagePattern.test(output.reason)) {
    return output.reason.slice(0, 240);
  }
  if (Array.isArray(output.results)) return `${output.results.length} ${translate("aiTasks.resultsPrepared")}`;
  if (output.company_id) return translate("aiTasks.resultCrmReady");
  if (output.email_id) return translate("aiTasks.resultDraftReady");
  return translate("aiTasks.resultCompleted");
}

function approvalEmailId(approval: AgentApprovalRequest) {
  const id = approval.tool_arguments.email_id;
  return typeof id === "string" ? id : "";
}

function hasPendingApprovals(detail: AgentRunDetail | null) {
  return Boolean(detail?.approvals.some((approval) => approval.approval_state === "pending"));
}

export function AiTasksWorkspace() {
  const api = useAgentRuntimeApi();
  const { t } = useI18n();
  const [objective, setObjective] = useState("");
  const [dryRun, setDryRun] = useState(true);
  const [status, setStatus] = useState<AgentRuntimeStatus | null>(null);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [approvalQueue, setApprovalQueue] = useState<AgentApprovalRequest[]>([]);
  const [selected, setSelected] = useState<AgentRunDetail | null>(null);
  const [trace, setTrace] = useState<AgentTraceEvent[]>([]);
  const [selectedRunId, setSelectedRunId] = useState("");
  const [loading, setLoading] = useState(true);
  const [statusChecked, setStatusChecked] = useState(false);
  const [statusFailed, setStatusFailed] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [checks, setChecks] = useState<ApprovalChecks>({});

  const runtimeUnavailable = Boolean(statusChecked && status && (!status.enabled || !status.can_create_runs));
  const canMutate = Boolean(
    statusChecked && !statusFailed && status?.enabled === true && status.can_create_runs === true && !loading
  );
  const forceDryRun = status?.force_dry_run === true;
  const effectiveDryRun = forceDryRun || dryRun;
  const selectedRun = selected?.run || null;
  const selectedPollingRunId = selectedRun?.id || "";
  const selectedPollingStatus = selectedRun?.status || "";
  const selectedPendingApprovals = selected?.approvals.filter((approval) => approval.approval_state === "pending") || [];
  const canResume = Boolean(selectedRun && selectedRun.status === "waiting_approval" && !hasPendingApprovals(selected) && canMutate);

  const loadWorkspace = useCallback(async (preferredRunId?: string, options: { background?: boolean } = {}) => {
    if (!api.ready) return;
    if (!options.background) setLoading(true);
    setError("");
    setStatusChecked(false);
    setStatusFailed(false);
    let nextError = "";
    try {
      const runtimeStatus = await api.status();
      setStatus(runtimeStatus);
    } catch (statusError) {
      setStatus(null);
      setStatusFailed(true);
      nextError = safeErrorText(statusError, t("aiTasks.loadError"));
      Sentry.captureException(statusError, { tags: { area: "ai-tasks-status" } });
      trackEvent("ai_tasks_status_failed", {});
    } finally {
      setStatusChecked(true);
    }
    try {
      const [runPage, approvals] = await Promise.all([
        api.listRuns({ limit: 20 }),
        api.listApprovals({ status: "pending", limit: 20 })
      ]);
      setRuns(runPage.runs);
      setApprovalQueue(approvals.approvals);
      const runId = preferredRunId || selectedRunId || runPage.runs[0]?.id || "";
      if (runId) {
        const detail = await api.getRun(runId);
        setSelected(detail);
        setSelectedRunId(detail.run.id);
        try {
          const nextTrace = await api.getTrace(runId);
          setTrace(nextTrace.trace);
        } catch (traceError) {
          setTrace([]);
          Sentry.captureException(traceError, { tags: { area: "ai-tasks-trace" } });
        }
      } else {
        setSelected(null);
        setTrace([]);
        setSelectedRunId("");
      }
    } catch (loadError) {
      nextError = nextError || safeErrorText(loadError, t("aiTasks.loadError"));
      Sentry.captureException(loadError, { tags: { area: "ai-tasks-load" } });
      trackEvent("ai_tasks_load_failed", {});
    } finally {
      if (nextError) setError(nextError);
      if (!options.background) setLoading(false);
    }
  }, [api, selectedRunId, t]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadWorkspace(), 0);
    return () => window.clearTimeout(timer);
  }, [loadWorkspace]);

  const refreshRun = useCallback(async (runId: string) => {
    if (!api.ready || !runId) return;
    try {
      const detail = await api.getRun(runId);
      setSelected(detail);
      setSelectedRunId(detail.run.id);
      setRuns((current) => {
        let found = false;
        const next = current.map((item) => {
          if (item.id !== detail.run.id) return item;
          found = true;
          return detail.run;
        });
        return found ? next : [detail.run, ...current].slice(0, 20);
      });
      setApprovalQueue((current) => {
        const pendingForRun = detail.approvals.filter((approval) => approval.approval_state === "pending");
        const otherRuns = current.filter((approval) => approval.run_id !== detail.run.id);
        return [...pendingForRun, ...otherRuns].slice(0, 20);
      });
      try {
        const nextTrace = await api.getTrace(runId);
        setTrace(nextTrace.trace);
      } catch (traceError) {
        setTrace([]);
        Sentry.captureException(traceError, { tags: { area: "ai-tasks-trace" } });
      }
    } catch (pollError) {
      setError(safeErrorText(pollError, t("aiTasks.loadError")));
      Sentry.captureException(pollError, { tags: { area: "ai-tasks-run-poll" } });
    }
  }, [api, t]);

  const refresh = useCallback(async (runId = selectedRunId, background = false) => {
    await loadWorkspace(runId || undefined, { background });
  }, [loadWorkspace, selectedRunId]);

  useEffect(() => {
    if (!api.ready || !selectedPollingRunId || !pollingStatuses.has(selectedPollingStatus)) return undefined;
    const timer = window.setInterval(() => {
      void refreshRun(selectedPollingRunId);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [api.ready, refreshRun, selectedPollingRunId, selectedPollingStatus]);

  async function startRun(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canMutate || !objective.trim()) return;
    setBusy("start");
    setNotice("");
    setError("");
    try {
      const created = await api.createRun({ objective: objective.trim(), dry_run: effectiveDryRun });
      setSelected(created);
      setSelectedRunId(created.run.id);
      setObjective("");
      setNotice(t("aiTasks.started"));
      trackEvent("ai_tasks_run_started", { dry_run: effectiveDryRun, force_dry_run: forceDryRun });
      await refreshRun(created.run.id);
    } catch (startError) {
      setError(safeErrorText(startError, t("aiTasks.startError")));
      Sentry.captureException(startError, { tags: { area: "ai-tasks-start" } });
      trackEvent("ai_tasks_run_failed", {});
    } finally {
      setBusy("");
    }
  }

  async function approve(approval: AgentApprovalRequest) {
    if (!canMutate) return;
    const current = checks[approval.id] || { reviewed: false, finalSend: false, generalReview: false };
    const sendApproval = approval.tool_name === "send_email";
    if (sendApproval && (!current.reviewed || !current.finalSend)) {
      setError(t("aiTasks.sendApprovalMissing"));
      return;
    }
    if (!sendApproval && !current.generalReview) {
      setError(t("aiTasks.reviewApprovalMissing"));
      return;
    }
    setBusy(`approve:${approval.id}`);
    setError("");
    try {
      const detail = await api.approve(approval.run_id, {
        approval_request_id: approval.id,
        idempotency_key: `ai-task-approval-${approval.id}-${Date.now()}`,
        manual_draft_approval: sendApproval ? current.reviewed : current.generalReview,
        final_send_confirmation: sendApproval ? current.finalSend : false,
        reason: sendApproval ? "Draft reviewed and final send separately confirmed." : "Action reviewed in AI Tasks."
      });
      setSelected(detail);
      setSelectedRunId(detail.run.id);
      setNotice(t("aiTasks.approvedNeedsResume"));
      trackEvent("ai_tasks_approval_approved", { send_approval: sendApproval });
      await refresh(detail.run.id);
    } catch (approvalError) {
      setError(safeErrorText(approvalError, t("aiTasks.approvalError")));
    } finally {
      setBusy("");
    }
  }

  async function reject(approval: AgentApprovalRequest) {
    if (!canMutate) return;
    if (!window.confirm(t("aiTasks.confirmReject"))) return;
    setBusy(`reject:${approval.id}`);
    setError("");
    try {
      const detail = await api.reject(approval.run_id, approval.id, "Rejected in AI Tasks.");
      setSelected(detail);
      setNotice(t("aiTasks.rejected"));
      trackEvent("ai_tasks_approval_rejected", {});
      await refresh(detail.run.id);
    } catch (rejectError) {
      setError(safeErrorText(rejectError, t("aiTasks.rejectError")));
    } finally {
      setBusy("");
    }
  }

  async function resume() {
    if (!selectedRun || !canMutate) return;
    setBusy("resume");
    setError("");
    try {
      const detail = await api.resume(selectedRun.id);
      setSelected(detail);
      setNotice(t("aiTasks.resumed"));
      trackEvent("ai_tasks_resumed", {});
      await refreshRun(detail.run.id);
    } catch (resumeError) {
      setError(safeErrorText(resumeError, t("aiTasks.resumeError")));
    } finally {
      setBusy("");
    }
  }

  async function cancel() {
    if (!selectedRun || !canMutate || terminalStatuses.has(selectedRun.status)) return;
    if (!window.confirm(t("aiTasks.confirmCancel"))) return;
    setBusy("cancel");
    setError("");
    try {
      const detail = await api.cancel(selectedRun.id, "Cancelled in AI Tasks.");
      setSelected(detail);
      setNotice(t("aiTasks.cancelled"));
      trackEvent("ai_tasks_cancelled", {});
      await refresh(detail.run.id);
    } catch (cancelError) {
      setError(safeErrorText(cancelError, t("aiTasks.cancelError")));
    } finally {
      setBusy("");
    }
  }

  const statusLabel = useMemo(() => selectedRun ? t(`aiTasks.status.${selectedRun.status}`) : t("aiTasks.status.none"), [selectedRun, t]);

  return (
    <div className="ai-tasks-workspace space-y-5">
      <header className="grid gap-4 lg:grid-cols-[1.4fr_0.8fr] lg:items-stretch">
        <section className="rounded-[1.75rem] border border-[var(--ui-border)] bg-white p-5 shadow-soft">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-sm font-black text-brand">{t("aiTasks.eyebrow")}</p>
              <h1 className="mt-2 text-3xl font-black tracking-normal text-ink">{t("aiTasks.title")}</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">{t("aiTasks.subtitle")}</p>
            </div>
            <AppButton variant="secondary" size="sm" onClick={() => void refresh()} disabled={loading || Boolean(busy)} aria-label={t("aiTasks.retry")}>
              <RefreshCw size={16} />
              {t("aiTasks.retry")}
            </AppButton>
          </div>
          {runtimeUnavailable ? (
            <div role="status" className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold leading-6 text-amber-900">
              {t("aiTasks.disabledMessage")}
            </div>
          ) : null}
          {forceDryRun ? (
            <div role="status" className="mt-4 rounded-2xl border border-teal-200 bg-teal-50 p-4 text-sm font-bold leading-6 text-teal-900">
              {t("aiTasks.forceDryRunNotice")}
            </div>
          ) : null}
          {error ? <div role="alert" className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">{error}</div> : null}
          {notice ? <div role="status" className="mt-4 rounded-2xl border border-teal-200 bg-teal-50 p-4 text-sm font-bold text-brand">{notice}</div> : null}
        </section>
        <section className="rounded-[1.75rem] border border-slate-200 bg-slate-950 p-5 text-white shadow-soft">
          <div className="flex items-start gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-white/10">
              <ShieldCheck size={22} />
            </span>
            <div>
              <p className="text-sm font-black">{t("aiTasks.safetyTitle")}</p>
              <p className="mt-2 text-sm leading-6 text-white/70">{t("aiTasks.safetyCopy")}</p>
            </div>
          </div>
          <dl className="mt-5 grid grid-cols-3 gap-2 text-sm">
            <div className="rounded-2xl bg-white/10 p-3"><dt className="text-white/55">{t("aiTasks.duration")}</dt><dd className="mt-1 font-black">{formatDuration(selectedRun)}</dd></div>
            <div className="rounded-2xl bg-white/10 p-3"><dt className="text-white/55">{t("aiTasks.tokens")}</dt><dd className="mt-1 font-black">{tokenTotal(selectedRun)}</dd></div>
            <div className="rounded-2xl bg-white/10 p-3"><dt className="text-white/55">{t("aiTasks.cost")}</dt><dd className="mt-1 font-black">{estimatedCost(selectedRun)}</dd></div>
          </dl>
        </section>
      </header>

      <form onSubmit={startRun} className="rounded-[1.75rem] border border-[var(--ui-border)] bg-white p-4 shadow-soft sm:p-5">
        <label className="block text-base font-black text-ink">
          {t("aiTasks.objectiveLabel")}
          <textarea
            value={objective}
            onChange={(event) => setObjective(event.target.value)}
            placeholder={t("aiTasks.objectivePlaceholder")}
            disabled={!canMutate || busy === "start"}
            className="focus-ring mt-3 min-h-40 w-full resize-y rounded-[1.5rem] border border-[var(--ui-border)] bg-[var(--ui-surface-subtle)] p-4 text-base leading-7 text-ink outline-none transition focus:border-[var(--ui-brand)] focus:bg-white disabled:cursor-not-allowed disabled:opacity-60"
          />
        </label>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <label className={`flex min-h-12 items-center gap-3 rounded-2xl border px-4 text-sm font-bold ${forceDryRun ? "border-slate-300 bg-slate-100 text-slate-600" : "border-slate-200 bg-slate-50 text-slate-700"}`}>
            <input
              type="checkbox"
              checked={effectiveDryRun}
              onChange={(event) => {
                if (!forceDryRun) setDryRun(event.target.checked);
              }}
              disabled={forceDryRun || !canMutate || busy === "start"}
              aria-describedby={forceDryRun ? "ai-tasks-force-dry-run-help" : undefined}
              className="size-4 accent-teal-700 disabled:cursor-not-allowed"
            />
            <span>
              {t("aiTasks.dryRun")}
              {forceDryRun ? <span id="ai-tasks-force-dry-run-help" className="mt-1 block text-xs font-bold text-slate-500">{t("aiTasks.forceDryRunHelp")}</span> : null}
            </span>
          </label>
          <AppButton type="submit" disabled={!canMutate || busy === "start" || !objective.trim()} className="w-full sm:w-auto">
            {busy === "start" ? <Loader2 className="animate-spin" size={18} /> : <Play size={18} />}
            {t("aiTasks.start")}
          </AppButton>
        </div>
      </form>

      {loading ? (
        <LoadingStateView title={t("aiTasks.loading")} />
      ) : (
        <section className="grid gap-5 xl:grid-cols-[0.85fr_1.45fr_0.9fr]">
          <SurfaceCard className="rounded-[1.75rem] p-4">
            <h2 className="text-lg font-black text-ink">{t("aiTasks.recent")}</h2>
            <div className="mt-4 space-y-2">
              {runs.length ? runs.map((run) => (
                <button
                  key={run.id}
                  type="button"
                  onClick={() => void refresh(run.id)}
                  className={`focus-ring w-full rounded-2xl border p-3 text-left transition ${selectedRun?.id === run.id ? "border-slate-950 bg-slate-950 text-white" : "border-slate-200 bg-white hover:bg-slate-50"}`}
                >
                  <span className="block truncate text-sm font-black">{run.objective}</span>
                  <span className={`mt-2 inline-flex rounded-full px-2 py-1 text-[11px] font-black ${selectedRun?.id === run.id ? "bg-white/15 text-white" : "bg-slate-100 text-slate-700"}`}>{t(`aiTasks.status.${run.status}`)}</span>
                  <span className={`mt-2 block text-xs ${selectedRun?.id === run.id ? "text-white/60" : "text-slate-500"}`}>{formatDateTime(run.created_at)}</span>
                </button>
              )) : <EmptyStateView title={t("aiTasks.emptyTitle")} copy={t("aiTasks.emptyCopy")} />}
            </div>
          </SurfaceCard>

          <SurfaceCard className="rounded-[1.75rem] p-4 sm:p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-xl font-black text-ink">{selectedRun?.objective || t("aiTasks.detailTitle")}</h2>
                <p className="mt-2 text-sm font-semibold text-slate-500">{statusLabel}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <AppButton variant="secondary" size="sm" disabled={!canResume || busy === "resume"} onClick={() => void resume()}>
                  {busy === "resume" ? <Loader2 className="animate-spin" size={16} /> : <Play size={16} />}
                  {t("aiTasks.resume")}
                </AppButton>
                <AppButton variant="destructive" size="sm" disabled={!canMutate || !selectedRun || terminalStatuses.has(selectedRun.status) || busy === "cancel"} onClick={() => void cancel()}>
                  {busy === "cancel" ? <Loader2 className="animate-spin" size={16} /> : <StopCircle size={16} />}
                  {t("aiTasks.cancel")}
                </AppButton>
              </div>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <Metric label={t("aiTasks.duration")} value={formatDuration(selectedRun)} icon={<Clock3 size={16} />} />
              <Metric label={t("aiTasks.tokens")} value={String(tokenTotal(selectedRun))} icon={<Bot size={16} />} />
              <Metric label={t("aiTasks.cost")} value={estimatedCost(selectedRun)} icon={<ShieldCheck size={16} />} />
            </div>
            <div className="mt-5">
              <h3 className="text-sm font-black text-ink">{t("aiTasks.timeline")}</h3>
              <ol className="mt-3 space-y-3">
                {selected?.steps.length ? selected.steps.map((step) => (
                  <li key={step.id} className="flex gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                    <span className={`mt-1 grid size-7 shrink-0 place-items-center rounded-full ${step.status === "completed" ? "bg-teal-600 text-white" : step.status === "failed" ? "bg-red-600 text-white" : "bg-white text-slate-700"}`}>
                      {step.status === "completed" ? <CheckCircle2 size={15} /> : step.step_index + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="break-words text-sm font-black text-ink">{step.title || t(toolLabels[step.tool_name] || "aiTasks.tool.default")}</p>
                      <p className="mt-1 text-xs font-bold text-slate-500">{t(`aiTasks.stepStatus.${step.status}`)}</p>
                    </div>
                  </li>
                )) : <li className="rounded-2xl border border-dashed border-slate-300 p-5 text-sm font-semibold text-slate-600">{t("aiTasks.noTimeline")}</li>}
              </ol>
            </div>
            <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-4">
              <h3 className="text-sm font-black text-ink">{t("aiTasks.result")}</h3>
              <p className="mt-2 text-sm leading-6 text-slate-700">{outputSummary(selected, t)}</p>
            </div>
            <details className="mt-5 rounded-2xl border border-slate-200 bg-slate-50">
              <summary className="cursor-pointer px-4 py-3 text-sm font-black text-ink">{t("aiTasks.technicalDetails")}</summary>
              <pre className="max-h-80 overflow-auto border-t border-slate-200 p-4 text-xs leading-5 text-slate-700">{JSON.stringify(technicalTrace(trace).map((event) => ({ ...event, step: t(event.step) })), null, 2)}</pre>
            </details>
          </SurfaceCard>

          <SurfaceCard className="rounded-[1.75rem] p-4">
            <h2 className="text-lg font-black text-ink">{t("aiTasks.pendingApprovals")}</h2>
            <div className="mt-4 space-y-3">
              {(selectedPendingApprovals.length ? selectedPendingApprovals : approvalQueue).length ? (selectedPendingApprovals.length ? selectedPendingApprovals : approvalQueue).map((approval) => {
                const sendApproval = approval.tool_name === "send_email";
                const current = checks[approval.id] || { reviewed: false, finalSend: false, generalReview: false };
                return (
                  <div key={approval.id} className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                    <p className="text-sm font-black text-amber-950">{t(toolLabels[approval.tool_name] || "aiTasks.approvalRequired")}</p>
                    <p className="mt-2 text-sm leading-6 text-amber-900">{sendApproval ? t("aiTasks.sendApprovalCopy") : t("aiTasks.approvalCopy")}</p>
                    {sendApproval ? (
                      <div className="mt-3 space-y-2">
                        <Link href={approvalEmailId(approval) ? `/dashboard/emails?email=${encodeURIComponent(approvalEmailId(approval))}` : "/dashboard/emails"} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-white px-3 text-sm font-black text-amber-950 shadow-sm">
                          {t("aiTasks.reviewEmail")} <ExternalLink size={15} />
                        </Link>
                        <label className="flex gap-2 text-sm font-bold text-amber-950"><input type="checkbox" checked={current.reviewed} onChange={(event) => setChecks((state) => ({ ...state, [approval.id]: { ...current, reviewed: event.target.checked } }))} /> {t("aiTasks.confirmDraftReviewed")}</label>
                        <label className="flex gap-2 text-sm font-bold text-amber-950"><input type="checkbox" checked={current.finalSend} onChange={(event) => setChecks((state) => ({ ...state, [approval.id]: { ...current, finalSend: event.target.checked } }))} /> {t("aiTasks.confirmFinalSend")}</label>
                      </div>
                    ) : (
                      <label className="mt-3 flex gap-2 text-sm font-bold text-amber-950"><input type="checkbox" checked={current.generalReview} onChange={(event) => setChecks((state) => ({ ...state, [approval.id]: { ...current, generalReview: event.target.checked } }))} /> {t("aiTasks.confirmReviewed")}</label>
                    )}
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      <AppButton size="sm" disabled={!canMutate || busy === `approve:${approval.id}`} onClick={() => void approve(approval)}>
                        {busy === `approve:${approval.id}` ? <Loader2 className="animate-spin" size={16} /> : <CheckCircle2 size={16} />}
                        {t("aiTasks.approve")}
                      </AppButton>
                      <AppButton variant="destructive" size="sm" disabled={!canMutate || busy === `reject:${approval.id}`} onClick={() => void reject(approval)}>
                        {busy === `reject:${approval.id}` ? <Loader2 className="animate-spin" size={16} /> : <XCircle size={16} />}
                        {t("aiTasks.reject")}
                      </AppButton>
                    </div>
                  </div>
                );
              }) : (
                <div className="rounded-2xl border border-dashed border-slate-300 p-5 text-sm font-semibold text-slate-600">
                  {t("aiTasks.noApprovals")}
                </div>
              )}
            </div>
            {!canMutate ? (
              <div className="mt-4 flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-900">
                <AlertTriangle className="shrink-0" size={18} />
                {t("aiTasks.mutationsDisabled")}
              </div>
            ) : null}
          </SurfaceCard>
        </section>
      )}
    </div>
  );
}

function Metric({ label, value, icon }: { label: string; value: string; icon: ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
      <div className="flex items-center gap-2 text-xs font-black uppercase text-slate-500">{icon}{label}</div>
      <p className="mt-2 text-lg font-black text-ink">{value}</p>
    </div>
  );
}
