'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@clerk/nextjs';
import { CheckCircle2, Download, Loader2, Send, UploadCloud } from 'lucide-react';
import { clientApi, clientApiBlob, friendlyErrorMessage } from '@/lib/client-api';
import { hasClerkPublishableKey, isClerkE2EBypass } from '@/lib/env';
import { useCustomerViewState } from '@/lib/customer-ui-state';
import type { SalesEmployeeTaskResult } from '@/lib/types';

function text(value: unknown, fallback = 'Not found') {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function numberValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function EmptyResultCard({ title, copy, example, ctaHref, ctaLabel }: { title: string; copy: string; example: string; ctaHref: string; ctaLabel: string }) {
  return (
    <div className="mt-4 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-5">
      <div className="grid size-12 place-items-center rounded-full bg-white text-xl shadow-sm" aria-hidden="true">✓</div>
      <h3 className="mt-4 font-bold text-ink">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-slate-600">{copy}</p>
      <p className="mt-3 rounded-md bg-white p-3 text-sm text-slate-700"><span className="font-semibold">Example result:</span> {example}</p>
      <div className="mt-4 flex flex-col gap-2 min-[430px]:flex-row">
        <Link href={ctaHref} className="inline-flex min-h-11 items-center justify-center rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white">{ctaLabel}</Link>
        <Link href="/dashboard/sales-employees" className="inline-flex min-h-11 items-center justify-center rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-ink">Give a new instruction</Link>
      </div>
    </div>
  );
}

function useTaskApi() {
  if (!hasClerkPublishableKey || isClerkE2EBypass) {
    return { ready: true, getToken: async () => isClerkE2EBypass ? 'dev' : null };
  }
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const { getToken, isLoaded, isSignedIn } = useAuth();
  return { ready: isLoaded && Boolean(isSignedIn), getToken };
}

export function TaskResultClient({ taskId }: { taskId: string }) {
  const { ready, getToken } = useTaskApi();
  const [result, setResult] = useState<SalesEmployeeTaskResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const taskViewState = useCustomerViewState<SalesEmployeeTaskResult>({
    loading,
    error,
    data: result,
    loadingMessage: 'Loading task report...',
    emptyMessage: 'Task result not found.',
    errorFallback: 'Task result could not be loaded. Please refresh and try again.'
  });

  const token = useCallback(async () => isClerkE2EBypass ? 'dev' : await getToken(), [getToken]);

  useEffect(() => {
    if (!ready) return;
    void token()
      .then((authToken) => clientApi<SalesEmployeeTaskResult>(`/api/sales-employees/tasks/${taskId}`, authToken))
      .then(setResult)
      .catch((nextError) => setError(friendlyErrorMessage(nextError, 'Task result could not be loaded. Please refresh and try again.')))
      .finally(() => setLoading(false));
  }, [ready, taskId, token]);

  async function downloadCsv() {
    setBusy('csv');
    setError('');
    try {
      const authToken = await token();
      const blob = await clientApiBlob(`/api/sales-employees/tasks/${taskId}/csv`, authToken);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `ai-employee-task-${taskId}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (nextError) {
      setError(friendlyErrorMessage(nextError, 'CSV download could not be prepared. Please try again.'));
    } finally {
      setBusy('');
    }
  }

  async function action(path: 'export-crm' | 'approve-send') {
    setBusy(path);
    setError('');
    try {
      const authToken = await token();
      const response = await clientApi<{ message: string }>(`/api/sales-employees/tasks/${taskId}/${path}`, authToken, { method: 'POST' });
      setNotice(response.message);
    } catch (nextError) {
      setError(friendlyErrorMessage(nextError, 'This action could not be completed. Please try again.'));
    } finally {
      setBusy('');
    }
  }

  const report = result?.result_json;
  const companies = report?.companies_found || [];
  const emails = report?.prepared_emails || [];
  const tools = report?.tools_used || [];
  const log = report?.ai_action_log || [];

  return <div className="min-w-0"><div className="flex flex-col gap-3 min-[430px]:flex-row min-[430px]:items-start min-[430px]:justify-between"><div><Link href="/dashboard/sales-employees" className="text-sm font-semibold text-brand">Back to AI Employees</Link><h1 className="mt-2 text-2xl font-bold min-[390px]:text-3xl">Task Results</h1><p className="mt-2 break-words text-slate-600">{result?.command || taskViewState.message}</p></div>{result && <span className="w-fit rounded-full bg-teal-50 px-3 py-1 text-xs font-bold text-brand">{result.status}</span>}</div>{taskViewState.status !== "success" && taskViewState.status !== "loading" && taskViewState.status !== "empty" && <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{taskViewState.message}</div>}{notice && <div className="mt-4 rounded-md border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-brand">{notice}</div>}{taskViewState.status === "loading" ? <div className="mt-6 h-48 animate-pulse rounded-lg bg-slate-200" /> : result && report ? <div className="mt-6 space-y-6"><section className="rounded-lg border border-slate-200 bg-white p-5"><div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between"><div><p className="text-sm font-semibold text-brand">{result.employee_name || 'AI Sales Employee'}</p><h2 className="mt-1 text-xl font-bold">{report.final_summary}</h2><p className="mt-2 text-sm text-slate-600">Execution time: {Math.round(result.execution_time_ms / 1000)}s · Completed: {result.completed_at ? new Date(result.completed_at).toLocaleString() : 'Not completed'}</p></div><div className="flex flex-wrap gap-2"><button onClick={downloadCsv} disabled={busy === 'csv' || !companies.length} className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold disabled:opacity-60">{busy === 'csv' ? <Loader2 className="animate-spin" size={16} /> : <Download size={16} />} Download CSV</button><button onClick={() => action('export-crm')} disabled={busy === 'export-crm' || !companies.length} className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold disabled:opacity-60"><UploadCloud size={16} /> Export to CRM</button><button onClick={() => action('approve-send')} disabled={busy === 'approve-send' || !emails.length} className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"><Send size={16} /> Approve & Send</button></div></div><p className="mt-4 rounded-md bg-slate-50 p-3 text-sm text-slate-700"><span className="font-semibold">Next recommended action:</span> {report.next_recommended_action}</p></section>{report.failure_reason && <section className="rounded-lg border border-orange-200 bg-orange-50 p-5"><h2 className="font-bold text-orange-900">No companies found</h2><p className="mt-2 text-sm text-orange-800">{report.failure_reason}</p><p className="mt-3 text-sm text-orange-800">Suggested next command: {text(report.empty_result_details?.suggested_next_command, 'Broaden the search and try again.')}</p></section>}<section className="rounded-lg border border-slate-200 bg-white p-5"><h2 className="font-bold">Companies found</h2>{companies.length ? <div className="mt-4 space-y-3">{companies.map((company, index) => <article key={`${text(company.company_name)}-${index}`} className="rounded-md border border-slate-200 p-3"><div className="flex flex-col gap-2 min-[430px]:flex-row min-[430px]:items-start min-[430px]:justify-between"><div><p className="font-semibold">{text(company.company_name)}</p><p className="break-all text-sm text-slate-500">{text(company.website)}</p></div><span className="w-fit rounded-full bg-teal-50 px-3 py-1 text-xs font-bold text-brand">Confidence {numberValue(company.confidence_score)}%</span></div><dl className="mt-3 grid gap-2 text-sm min-[430px]:grid-cols-3"><div><dt className="text-slate-500">Country</dt><dd>{text(company.country)}</dd></div><div><dt className="text-slate-500">City</dt><dd>{text(company.city)}</dd></div><div><dt className="text-slate-500">Industry</dt><dd>{text(company.industry)}</dd></div><div><dt className="text-slate-500">Phone</dt><dd>{text(company.phone)}</dd></div><div><dt className="text-slate-500">Email</dt><dd>{text(company.email)}</dd></div><div><dt className="text-slate-500">Source</dt><dd>{text(company.source)}</dd></div></dl><p className="mt-3 text-sm text-slate-600">{text(company.short_description)}</p><p className="mt-2 text-sm font-semibold text-ink">{text(company.why_matched)}</p></article>)}</div> : <EmptyResultCard title="No companies matched this task" copy="The search finished safely, but the connected sources did not return companies that matched the filters. Broaden the location, company size, or industry and run a new instruction." example="10 construction companies in Berlin with websites, source, confidence score, and prepared outreach." ctaHref="/dashboard/leads" ctaLabel="Find leads" />}</section><section className="rounded-lg border border-slate-200 bg-white p-5"><h2 className="font-bold">Prepared outreach emails</h2>{emails.length ? <div className="mt-4 space-y-3">{emails.map((email, index) => <article key={index} className="rounded-md bg-slate-50 p-3 text-sm"><p className="font-semibold">{text(email.subject, 'Draft subject')}</p><p className="mt-1 text-slate-500">Target: {text(email.target_company)} · Tone: {text(email.tone, 'Professional')}</p><pre className="mt-3 whitespace-pre-wrap rounded-md bg-white p-3 text-slate-700">{text(email.body, 'Draft body not available')}</pre></article>)}</div> : <EmptyResultCard title="No outreach drafts yet" copy="OutreachAI prepares emails after a qualified company is available. Add or find leads, then ask the AI employee to prepare outreach for review." example="Subject, preview, full email, tone, target company, and next recommended action." ctaHref="/dashboard/campaigns" ctaLabel="Create campaign" />}</section><section className="grid gap-6 lg:grid-cols-2"><div className="rounded-lg border border-slate-200 bg-white p-5"><h2 className="font-bold">Tools used</h2>{tools.length ? <div className="mt-4 space-y-3">{tools.map((tool, index) => <div key={index} className="rounded-md bg-slate-50 p-3 text-sm"><p className="font-semibold">{text(tool.tool_name)}</p><p className="mt-1 text-slate-600">{text(tool.output_summary)}</p><p className="mt-2 text-xs font-bold text-brand">{text(tool.status)} · {numberValue(tool.duration_ms)}ms</p></div>)}</div> : <EmptyResultCard title="No tools ran" copy="This task did not need a connected tool, or it ended before tool execution. Give a more specific instruction to trigger lead search or outreach preparation." example="Lead Finder searched Germany construction companies and returned matching companies." ctaHref="/dashboard/sales-employees" ctaLabel="Give work" />}</div><div className="rounded-lg border border-slate-200 bg-white p-5"><h2 className="font-bold">AI action log</h2>{log.length ? <div className="mt-4 space-y-3">{log.map((item, index) => <div key={index} className="rounded-md bg-slate-50 p-3 text-sm"><p className="flex items-center gap-2 font-semibold"><CheckCircle2 size={16} className="text-brand" />{text(item.step)}</p><p className="mt-1 text-slate-600">{text(item.message)}</p><p className="mt-2 text-xs text-slate-500">{text(item.timestamp, 'No timestamp')} · {text(item.status)}</p></div>)}</div> : <EmptyResultCard title="No timeline yet" copy="The AI timeline appears after a task is planned or executed. It shows each step so you can audit the work before approval." example="Search started, websites analyzed, leads scored, emails prepared, waiting for approval." ctaHref="/dashboard/sales-employees" ctaLabel="Start a task" />}</div></section></div> : <EmptyResultCard title="Task result not found" copy="This report may have been archived or the link may be incomplete. Your saved AI employee tasks are available from the AI Employees page." example="A completed task report with companies, emails, tools, and action log." ctaHref="/dashboard/sales-employees" ctaLabel="Open AI Employees" />}</div>;
}
