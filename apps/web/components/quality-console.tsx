"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { AlertTriangle, CheckCircle2, ClipboardList, Loader2, ShieldAlert, Stethoscope, Wrench } from "lucide-react";
import { apiProxyUrl, e2eUserEmail, hasClerkPublishableKey, isClerkE2EBypass, ownerEmail } from "@/lib/env";
import { friendlyErrorMessage } from "@/lib/client-api";
import type { QualityCheck, QualityDashboard, QualityIssue, QualityRepairTask } from "@/lib/types";

const noClerkAuth = {
  getToken: async () => (isClerkE2EBypass ? "dev" : null),
  isLoaded: true,
  isSignedIn: isClerkE2EBypass
};

function e2eOwnerEmail() {
  try {
    if (typeof window === "undefined") return e2eUserEmail || ownerEmail;
    return window.localStorage.getItem("outreachai.e2eOwnerEmail") || e2eUserEmail || ownerEmail;
  } catch {
    return e2eUserEmail || ownerEmail;
  }
}

function useQualityAuth() {
  if (!hasClerkPublishableKey || isClerkE2EBypass) return noClerkAuth;
  // The no-Clerk branch is required for local/E2E builds where ClerkProvider is intentionally not mounted.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useAuth();
}

async function qualityRequest<T>(path: string, token: string | null, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${apiProxyUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(isClerkE2EBypass ? { "X-Test-User-Email": e2eOwnerEmail() } : {}),
      ...init.headers
    }
  });

  if (response.status === 403) {
    const error = new Error("Access denied.");
    error.name = "AccessDeniedError";
    throw error;
  }

  if (!response.ok) {
    let detail = "";
    try {
      detail = await response.text();
    } catch {
      detail = "Response body could not be read.";
    }
    if (process.env.NODE_ENV !== "production") {
      console.error("Quality Console API request failed", { path, status: response.status, detail });
    }
    throw new Error("Quality Console could not load. Please refresh and try again.");
  }

  return response.json() as Promise<T>;
}

function statusClass(status: string) {
  if (status === "healthy") return "bg-teal-50 text-brand";
  if (status === "broken") return "bg-red-50 text-red-700";
  if (status === "blocked") return "bg-orange-50 text-orange-700";
  return "bg-amber-50 text-amber-700";
}

function severityClass(severity: string) {
  if (severity === "critical") return "bg-red-600 text-white";
  if (severity === "high") return "bg-red-50 text-red-700";
  if (severity === "medium") return "bg-amber-50 text-amber-700";
  return "bg-slate-100 text-slate-700";
}

function safeList<T>(value: T[] | undefined | null): T[] {
  return Array.isArray(value) ? value : [];
}

function normalizeQualityDashboard(value: Partial<QualityDashboard>): QualityDashboard {
  return {
    health_score: typeof value.health_score === "number" ? value.health_score : 0,
    status: typeof value.status === "string" ? value.status : "degraded",
    summary: typeof value.summary === "string" ? value.summary : "Quality status could not be fully loaded.",
    deployment_gate: value.deployment_gate && typeof value.deployment_gate === "object" ? value.deployment_gate : {},
    checks: safeList(value.checks),
    open_bugs: safeList(value.open_bugs),
    repair_tasks: safeList(value.repair_tasks),
    sentry_issues: safeList(value.sentry_issues),
    failed_integrations: safeList(value.failed_integrations),
    failed_tests: safeList(value.failed_tests),
    broken_flows: safeList(value.broken_flows),
    suggested_fixes: safeList(value.suggested_fixes),
    last_run_at: value.last_run_at || null
  };
}

function Evidence({ evidence }: { evidence: Record<string, unknown> }) {
  const entries = Object.entries(evidence).slice(0, 6);
  if (!entries.length) return <p className="mt-2 text-sm text-slate-500">No extra evidence captured.</p>;
  return (
    <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
      {entries.map(([key, value]) => (
        <div key={key} className="rounded-md bg-slate-50 px-3 py-2">
          <dt className="font-semibold capitalize text-slate-500">{key.replaceAll("_", " ")}</dt>
          <dd className="mt-1 break-words text-slate-700">{typeof value === "object" ? JSON.stringify(value) : String(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

function CheckCard({ check }: { check: QualityCheck }) {
  const Icon = check.status === "healthy" ? CheckCircle2 : AlertTriangle;
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase text-slate-500">{check.module}</p>
          <h3 className="mt-1 text-base font-bold text-ink">{check.name}</h3>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className={`inline-flex min-h-8 items-center gap-1 rounded-full px-3 text-xs font-bold ${statusClass(check.status)}`}><Icon size={14} />{check.status}</span>
          <span className={`inline-flex min-h-8 items-center rounded-full px-3 text-xs font-bold ${severityClass(check.severity)}`}>{check.severity}</span>
        </div>
      </div>
      <p className="mt-3 text-sm leading-6 text-slate-700">{check.summary}</p>
      {check.suggested_fix && <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm font-semibold text-slate-700">{check.suggested_fix}</p>}
      <Evidence evidence={check.evidence} />
    </article>
  );
}

function RepairTaskCard({ task }: { task: QualityRepairTask }) {
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-bold text-ink">{task.title}</h3>
          <p className="mt-1 text-sm text-slate-600">{task.diagnosis}</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-bold ${severityClass(task.priority)}`}>{task.priority}</span>
      </div>
      <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">{task.suggested_fix}</p>
      <div className="mt-3 text-sm text-slate-600">
        <p className="font-bold text-ink">Required before approval</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {task.required_tests.map((item) => <li key={item}>{item}</li>)}
        </ul>
      </div>
    </article>
  );
}

function IssueRow({ issue, onCreateTask, creating }: { issue: QualityIssue; onCreateTask: (issue: QualityIssue) => void; creating: boolean }) {
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-xs font-bold uppercase text-slate-500">{issue.module}</p>
          <h3 className="mt-1 text-base font-bold text-ink">{issue.title}</h3>
          <p className="mt-2 text-sm leading-6 text-slate-700">{issue.root_cause}</p>
        </div>
        <button type="button" onClick={() => onCreateTask(issue)} disabled={creating} className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-md bg-brand px-4 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-60">
          {creating ? <Loader2 className="animate-spin" size={16} /> : <Wrench size={16} />}
          Create repair task
        </button>
      </div>
      <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm font-semibold text-slate-700">{issue.suggested_fix}</p>
    </article>
  );
}

export function QualityConsole() {
  const { getToken, isLoaded, isSignedIn } = useQualityAuth();
  const [data, setData] = useState<QualityDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [creating, setCreating] = useState("");
  const [error, setError] = useState("");
  const [accessDenied, setAccessDenied] = useState(false);

  const load = useCallback(async () => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      setAccessDenied(true);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const token = await getToken();
      const dashboard = await qualityRequest<Partial<QualityDashboard>>("/api/admin/quality", token);
      setData(normalizeQualityDashboard(dashboard));
      setAccessDenied(false);
    } catch (nextError) {
      if (nextError instanceof Error && nextError.name === "AccessDeniedError") setAccessDenied(true);
      else setError(friendlyErrorMessage(nextError, "Quality Console could not load. Please refresh and try again."));
    } finally {
      setLoading(false);
    }
  }, [getToken, isLoaded, isSignedIn]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function runQaCheck() {
    setRunning(true);
    setError("");
    try {
      const token = await getToken();
      const dashboard = await qualityRequest<Partial<QualityDashboard>>("/api/admin/quality/run", token, { method: "POST" });
      setData(normalizeQualityDashboard(dashboard));
    } catch (nextError) {
      setError(friendlyErrorMessage(nextError, "QA check could not run. Please try again."));
    } finally {
      setRunning(false);
    }
  }

  async function createTask(issue: QualityIssue) {
    setCreating(issue.fingerprint);
    setError("");
    try {
      const token = await getToken();
      const task = await qualityRequest<QualityRepairTask>("/api/admin/quality/tasks", token, {
        method: "POST",
        body: JSON.stringify({ fingerprint: issue.fingerprint })
      });
      setData((current) => current ? { ...current, repair_tasks: [task, ...current.repair_tasks.filter((item) => item.id !== task.id)] } : current);
    } catch (nextError) {
      setError(friendlyErrorMessage(nextError, "Repair task could not be created."));
    } finally {
      setCreating("");
    }
  }

  if (loading) {
    return <div className="grid gap-4 md:grid-cols-3">{[1, 2, 3].map((item) => <div key={item} className="h-36 animate-pulse rounded-xl bg-slate-200" />)}</div>;
  }

  if (accessDenied) {
    return (
      <section className="mx-auto max-w-xl rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <ShieldAlert className="mx-auto text-red-600" size={36} />
        <h1 className="mt-4 text-2xl font-bold text-ink">Access denied.</h1>
        <p className="mt-2 text-sm text-slate-600">This internal quality console is restricted to the OutreachAI owner.</p>
      </section>
    );
  }

  if (!data) {
    return <section className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-red-700">{error || "Quality Console could not load."}</section>;
  }

  const failedChecks = data.checks.filter((check) => check.status !== "healthy");

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <span className="inline-flex min-h-8 items-center gap-2 rounded-full bg-teal-50 px-3 text-xs font-bold text-brand"><Stethoscope size={14} />Internal only</span>
            <h1 className="mt-3 text-2xl font-bold text-ink md:text-3xl">AI Quality & Self-Healing</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">Detects production risks, creates repair tasks, and blocks unsafe fixes until tests and owner approval are complete.</p>
          </div>
          <button type="button" onClick={runQaCheck} disabled={running} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-brand px-4 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-60">
            {running ? <Loader2 className="animate-spin" size={17} /> : <ClipboardList size={17} />}
            Run QA check
          </button>
        </div>
        {error && <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p>}
      </section>

      <section className="grid gap-4 md:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm font-semibold text-slate-500">Health score</p>
          <p className="mt-2 text-4xl font-bold text-ink">{data.health_score}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm font-semibold text-slate-500">Status</p>
          <p className={`mt-3 inline-flex rounded-full px-3 py-1 text-sm font-bold ${statusClass(data.status)}`}>{data.status}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm font-semibold text-slate-500">Open bugs</p>
          <p className="mt-2 text-4xl font-bold text-ink">{data.open_bugs.length}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm font-semibold text-slate-500">Repair tasks</p>
          <p className="mt-2 text-4xl font-bold text-ink">{data.repair_tasks.length}</p>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-bold text-ink">Deployment gate</h2>
        <p className="mt-2 text-sm text-slate-600">AI can suggest fixes, but deployment stays blocked until these checks pass and the owner approves the release.</p>
        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {Object.entries(data.deployment_gate).map(([key, value]) => <div key={key} className="rounded-lg bg-slate-50 p-3 text-sm"><p className="font-bold capitalize text-ink">{key.replaceAll("_", " ")}</p><p className="mt-1 text-slate-600">{String(value)}</p></div>)}
        </div>
      </section>

      <section>
        <h2 className="text-lg font-bold text-ink">Issues to fix first</h2>
        <div className="mt-4 grid gap-4">
          {data.open_bugs.length ? data.open_bugs.map((issue) => <IssueRow key={issue.id} issue={issue} onCreateTask={createTask} creating={creating === issue.fingerprint} />) : <p className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-sm">No open quality bugs. Keep running the gate before every deploy.</p>}
        </div>
      </section>

      <section>
        <h2 className="text-lg font-bold text-ink">Module checks</h2>
        <div className="mt-4 grid gap-4 xl:grid-cols-2">
          {(failedChecks.length ? failedChecks : data.checks).map((check) => <CheckCard key={`${check.module}-${check.name}`} check={check} />)}
        </div>
      </section>

      <section>
        <h2 className="text-lg font-bold text-ink">Repair tasks</h2>
        <div className="mt-4 grid gap-4 xl:grid-cols-2">
          {data.repair_tasks.length ? data.repair_tasks.map((task) => <RepairTaskCard key={task.id} task={task} />) : <p className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-sm">No repair tasks yet. Create one from an issue after reviewing the evidence.</p>}
        </div>
      </section>
    </div>
  );
}
