'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@clerk/nextjs';
import { Brain, Check, CheckCircle2, ClipboardList, Loader2, Mic, Play, Plus, Save, Search, Send, Sparkles, Wand2, X } from 'lucide-react';
import { clientApi, friendlyErrorMessage, splitList } from '@/lib/client-api';
import { hasClerkPublishableKey, isClerkE2EBypass } from '@/lib/env';
import { LanguageSwitcher } from '@/components/language-switcher';
import { useI18n } from '@/lib/i18n/provider';
import type { Activity, AdminSummary, AISalesEmployee, BillingPlan, Campaign, CampaignAnalytics, DashboardMetrics, Email, FollowUpSequence, GrowthEngine, Lead, MeetingPrep, Notification, Profile, SalesCopilot, SalesEmployeeLeadInsight, SalesEmployeeMemory, SalesEmployeePerformance, SalesEmployeeRun, SalesEmployeeTaskPlan, Settings, TeamRouterDashboard, TeamRouterPlan, Usage, WebsiteAudit, Workspace } from '@/lib/types';

const pipeline = ['New', 'Qualified', 'Contacted', 'Interested', 'Meeting', 'Won', 'Lost', 'Archive'];
const tones = ['Professional', 'Friendly', 'Direct', 'Consultative'];
const salesModes = ['Review Mode', 'Semi-Auto Mode'];
const emptyMetrics: DashboardMetrics = { leads: 0, campaigns: 0, emails_sent: 0, delivered: 0, opened: 0, replies: 0, bounces: 0, open_rate: 0, reply_rate: 0, ctr: 0, conversion_rate: 0, meetings: 0, revenue: 0, revenue_forecast: 0, mrr: 0, arr: 0, revenue_series: [], funnel: [], pipeline: [], plan: 'Starter', usage: {} };
const simpleExperience = process.env.NEXT_PUBLIC_SIMPLE_EXPERIENCE !== 'false';
const showAdvancedSettings = process.env.NEXT_PUBLIC_SHOW_ADVANCED_SETTINGS === 'true';
const devApi = async function api<T>(path: string, init: RequestInit = {}) {
  return clientApi<T>(path, 'dev', init);
};

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function useTokenApi() {
  if (!hasClerkPublishableKey || isClerkE2EBypass) {
    return { api: devApi, ready: true };
  }

  // The no-Clerk branch is required for local/E2E builds where ClerkProvider is intentionally not mounted.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useClerkTokenApi();
}

function useClerkTokenApi() {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const api = useCallback(async function api<T>(path: string, init: RequestInit = {}) {
    if (!isLoaded || !isSignedIn) throw new Error('Authentication is not ready');
    let token = await getToken();
    for (let attempt = 0; !token && attempt < 20; attempt += 1) {
      await delay(100);
      token = await getToken();
    }
    if (!token) throw new Error('Authentication token is not available');
    return clientApi<T>(path, token, init);
  }, [getToken, isLoaded, isSignedIn]);

  return { api, ready: isLoaded && Boolean(isSignedIn) };
}

function Skeleton({ lines = 3 }: { lines?: number }) {
  return <div className="space-y-3">{Array.from({ length: lines }).map((_, index) => <div key={index} className="h-16 animate-pulse rounded-lg bg-slate-200" />)}</div>;
}

function EmptyState({ title, copy }: { title: string; copy: string }) {
  return <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center"><p className="font-semibold text-ink">{title}</p><p className="mt-2 text-sm text-slate-500">{copy}</p></div>;
}

function Notice({ message, kind = 'success' }: { message: string; kind?: 'success' | 'error' | 'warning' }) {
  const color = kind === 'error' ? 'border-red-200 bg-red-50 text-red-700' : kind === 'warning' ? 'border-orange-200 bg-orange-50 text-orange-700' : 'border-teal-200 bg-teal-50 text-brand';
  return <div className={`mt-4 rounded-md border px-4 py-3 text-sm ${color}`}>{message}</div>;
}

function RecentTaskReports({ tasks }: { tasks: Record<string, unknown>[] }) {
  const completed = tasks.filter((task) => task.status === 'finished').slice(-5).reverse();
  return <div className="rounded-lg border border-slate-200 bg-white p-4"><h2 className="font-bold">Completed task reports</h2>{completed.length ? <div className="mt-4 space-y-3">{completed.map((task) => { const preview = (task.result_preview || {}) as Record<string, unknown>; return <article key={String(task.id)} className="rounded-md border border-slate-200 p-3 text-sm"><div className="flex flex-col gap-2 min-[430px]:flex-row min-[430px]:items-start min-[430px]:justify-between"><div><p className="font-semibold">{String(task.command || task.goal || 'Completed task')}</p><p className="mt-1 text-slate-600">{String(preview.final_summary || preview.failure_reason || 'Task completed with a saved report.')}</p></div><span className="w-fit rounded-full bg-teal-50 px-3 py-1 text-xs font-bold text-brand">{Number(preview.companies_found || 0)} companies</span></div><p className="mt-2 text-slate-500">Emails prepared: {Number(preview.prepared_emails || 0)} · Next: {String(preview.next_recommended_action || 'View the full report')}</p><Link href={`/dashboard/ai-employees/tasks/${String(task.id)}`} className="focus-ring mt-3 inline-flex min-h-11 items-center justify-center rounded-md bg-ink px-4 py-2 font-semibold text-white">View Results</Link></article>; })}</div> : <EmptyState title="No completed task reports" copy="Approved task results will appear here with companies, contacts, emails, tools, and logs." />}</div>;
}

function metricNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function textValue(value: unknown, fallback = '') {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function speechRecognitionLocale(language: string) {
  if (language === 'Russian') return 'ru-RU';
  if (language === 'Spanish') return 'es-ES';
  if (language === 'French') return 'fr-FR';
  if (language === 'Italian') return 'it-IT';
  if (language === 'Polish') return 'pl-PL';
  return 'en-US';
}

type DashboardStageId = 'registration' | 'company' | 'leads' | 'campaign' | 'approval' | 'launch' | 'results';

type DashboardStage = {
  id: DashboardStageId;
  labelKey: string;
  helpKey: string;
  complete: boolean;
  active: boolean;
};

function DashboardSkeleton() {
  const { t } = useI18n();
  return <div className="space-y-5" aria-label={t('dashboard.loading')}>
    <div className="h-40 animate-pulse rounded-lg bg-slate-200" />
    <div className="h-24 animate-pulse rounded-lg bg-slate-200" />
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      <div className="h-28 animate-pulse rounded-lg bg-slate-200" />
      <div className="h-28 animate-pulse rounded-lg bg-slate-200" />
      <div className="h-28 animate-pulse rounded-lg bg-slate-200" />
    </div>
  </div>;
}

function DashboardProgressTracker({ stages }: { stages: DashboardStage[] }) {
  const { t } = useI18n();
  return <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm" aria-labelledby="dashboard-progress-title">
    <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="text-sm font-semibold text-brand">{t('dashboard.progressEyebrow')}</p>
        <h2 id="dashboard-progress-title" className="mt-1 text-lg font-bold text-ink">{t('dashboard.progressTitle')}</h2>
      </div>
      <p className="max-w-xl text-sm text-slate-600">{t('dashboard.progressHelp')}</p>
    </div>
    <ol className="mt-5 grid gap-2 min-[480px]:grid-cols-2 lg:grid-cols-7">
      {stages.map((stage, index) => {
        const className = 'rounded-md border p-3 text-sm ' + (stage.active ? 'border-brand bg-teal-50' : stage.complete ? 'border-teal-100 bg-white' : 'border-slate-200 bg-slate-50');
        const markerClassName = 'grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold ' + (stage.complete ? 'bg-brand text-white' : stage.active ? 'bg-ink text-white' : 'bg-white text-slate-500');
        return <li key={stage.id} aria-current={stage.active ? 'step' : undefined} className={className}>
          <div className="flex items-center gap-2">
            <span className={markerClassName}>{stage.complete ? '✓' : index + 1}</span>
            <p className="font-semibold text-ink">{t(stage.labelKey)}</p>
          </div>
          <p className="mt-2 text-xs leading-5 text-slate-600">{t(stage.helpKey)}</p>
        </li>;
      })}
    </ol>
  </section>;
}

function DashboardCelebrations({ milestones }: { milestones: string[] }) {
  const { t } = useI18n();
  if (!milestones.length) return null;
  return <section className="grid gap-3 sm:grid-cols-2" aria-label={t('dashboard.celebrations')}>
    {milestones.map((key) => <article key={key} className="rounded-lg border border-teal-200 bg-teal-50 p-4 text-sm text-brand">
      <p className="font-bold">{t('dashboard.milestoneComplete')}</p>
      <p className="mt-1 text-slate-700">{t(key)}</p>
    </article>)}
  </section>;
}

export function DashboardHome() {
  const { api, ready } = useTokenApi();
  const { t, formatCurrency, formatNumber } = useI18n();
  const [metrics, setMetrics] = useState<DashboardMetrics>(emptyMetrics);
  const [growth, setGrowth] = useState<GrowthEngine | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [optimisticAction, setOptimisticAction] = useState('');

  useEffect(() => {
    if (!ready) return;
    void Promise.resolve()
      .then(() => {
        setLoading(true);
        setError('');
        return Promise.all([api<DashboardMetrics>('/api/dashboard'), api<GrowthEngine>('/api/growth-engine')]);
      })
      .then(([nextMetrics, nextGrowth]) => {
        setMetrics(nextMetrics);
        setGrowth(nextGrowth);
      })
      .catch((nextError) => {
        console.error('Dashboard data could not be loaded', nextError);
        setError(t('dashboard.loadError'));
      })
      .finally(() => setLoading(false));
  }, [api, ready, t]);

  const hasLeads = metrics.leads > 0;
  const hasCampaigns = metrics.campaigns > 0;
  const hasEmails = metrics.emails_sent > 0;
  const hasReplies = metrics.replies > 0;
  const hasRevenue = metricNumber(metrics.revenue) > 0;
  const aiResult = growth?.briefing?.recommended_actions?.[0];
  const hasAiResult = Boolean(aiResult?.title || aiResult?.action || aiResult?.why);

  const currentStage: DashboardStageId = hasRevenue || hasReplies
    ? 'results'
    : hasEmails
      ? 'launch'
      : hasCampaigns
        ? 'approval'
        : hasLeads
          ? 'campaign'
          : 'leads';

  const primaryAction = currentStage === 'results'
    ? { href: '/dashboard/analytics', label: t('dashboard.ctaReviewResults'), help: t('dashboard.ctaReviewResultsHelp') }
    : currentStage === 'launch'
      ? { href: '/dashboard/inbox', label: t('dashboard.ctaCheckReplies'), help: t('dashboard.ctaCheckRepliesHelp') }
      : currentStage === 'approval'
        ? { href: '/dashboard/campaigns', label: t('dashboard.ctaApproveCampaign'), help: t('dashboard.ctaApproveCampaignHelp') }
        : currentStage === 'campaign'
          ? { href: '/dashboard/campaigns', label: t('dashboard.ctaCreateCampaign'), help: t('dashboard.ctaCreateCampaignHelp') }
          : { href: '/dashboard/leads', label: t('dashboard.ctaFindLeads'), help: t('dashboard.ctaFindLeadsHelp') };

  const stages: DashboardStage[] = [
    { id: 'registration', labelKey: 'dashboard.stepRegistration', helpKey: 'dashboard.stepRegistrationHelp', complete: true, active: false },
    { id: 'company', labelKey: 'dashboard.stepCompany', helpKey: 'dashboard.stepCompanyHelp', complete: true, active: false },
    { id: 'leads', labelKey: 'dashboard.stepFindLeads', helpKey: 'dashboard.stepFindLeadsHelp', complete: hasLeads, active: currentStage === 'leads' },
    { id: 'campaign', labelKey: 'dashboard.stepCampaign', helpKey: 'dashboard.stepCampaignHelp', complete: hasCampaigns, active: currentStage === 'campaign' },
    { id: 'approval', labelKey: 'dashboard.stepApproval', helpKey: 'dashboard.stepApprovalHelp', complete: hasEmails, active: currentStage === 'approval' },
    { id: 'launch', labelKey: 'dashboard.stepLaunch', helpKey: 'dashboard.stepLaunchHelp', complete: hasReplies || hasRevenue, active: currentStage === 'launch' },
    { id: 'results', labelKey: 'dashboard.stepResults', helpKey: 'dashboard.stepResultsHelp', complete: hasRevenue, active: currentStage === 'results' },
  ];

  const milestones = [
    hasLeads ? 'dashboard.celebrationLeads' : '',
    hasCampaigns ? 'dashboard.celebrationCampaign' : '',
    hasEmails ? 'dashboard.celebrationLaunch' : '',
    hasRevenue ? 'dashboard.celebrationRevenue' : '',
  ].filter(Boolean);

  const visibleMetrics = [
    hasLeads ? { label: t('dashboard.metricLeads'), value: formatNumber(metrics.leads), help: t('dashboard.metricLeadsHelp') } : null,
    hasCampaigns ? { label: t('dashboard.metricCampaigns'), value: formatNumber(metrics.campaigns), help: t('dashboard.metricCampaignsHelp') } : null,
    hasEmails ? { label: t('dashboard.metricEmails'), value: formatNumber(metrics.emails_sent), help: t('dashboard.metricEmailsHelp') } : null,
    metrics.replies > 0 ? { label: t('dashboard.metricReplies'), value: formatNumber(metrics.replies), help: t('dashboard.metricRepliesHelp') } : null,
    metrics.meetings > 0 ? { label: t('dashboard.metricMeetings'), value: formatNumber(metrics.meetings), help: t('dashboard.metricMeetingsHelp') } : null,
    hasRevenue ? { label: t('dashboard.metricRevenue'), value: formatCurrency(metricNumber(metrics.revenue)), help: t('dashboard.metricRevenueHelp') } : null,
  ].filter(Boolean) as { label: string; value: string; help: string }[];

  return <div className="min-w-0 space-y-6">
    <header className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-3xl">
          <p className="text-sm font-semibold text-brand">{t('dashboard.eyebrow')}</p>
          <h1 className="mt-2 text-3xl font-bold tracking-normal text-ink min-[430px]:text-4xl">{t('dashboard.title')}</h1>
          <p className="mt-3 text-base leading-7 text-slate-600">{t('dashboard.v2Subtitle')}</p>
        </div>
        <Link href={primaryAction.href} onClick={() => setOptimisticAction(primaryAction.label)} className="focus-ring inline-flex min-h-11 w-full items-center justify-center rounded-md bg-ink px-5 py-3 text-sm font-bold text-white sm:w-auto" aria-describedby="dashboard-primary-help">
          {primaryAction.label}
        </Link>
      </div>
      <p id="dashboard-primary-help" className="mt-4 max-w-2xl text-sm text-slate-600">{primaryAction.help}</p>
      {optimisticAction && <p role="status" className="mt-4 rounded-md bg-teal-50 px-4 py-3 text-sm font-semibold text-brand">{t('dashboard.optimisticPrefix')} {optimisticAction}</p>}
    </header>

    {loading ? <DashboardSkeleton /> : <>
      {error && <Notice message={error} kind="warning" />}

      <section className="rounded-xl border border-teal-200 bg-teal-50 p-5 shadow-sm sm:p-6" aria-labelledby="dashboard-priority-title">
        <p className="text-sm font-semibold text-brand">{t('dashboard.priorityEyebrow')}</p>
        <h2 id="dashboard-priority-title" className="mt-2 text-2xl font-bold text-ink">{t('dashboard.stage.' + currentStage + '.title')}</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-700">{t('dashboard.stage.' + currentStage + '.copy')}</p>
      </section>

      <DashboardProgressTracker stages={stages} />
      <DashboardCelebrations milestones={milestones} />

      {visibleMetrics.length > 0 ? <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label={t('dashboard.relevantSignals')}>
        {visibleMetrics.map((item) => <article key={item.label} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm font-semibold text-slate-500">{item.label}</p>
          <p className="mt-2 text-3xl font-bold text-ink">{item.value}</p>
          <p className="mt-2 text-sm leading-6 text-slate-600">{item.help}</p>
        </article>)}
      </section> : <section className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center" aria-labelledby="dashboard-empty-title">
        <p className="text-sm font-semibold text-brand">{t('dashboard.emptyEyebrow')}</p>
        <h2 id="dashboard-empty-title" className="mt-2 text-xl font-bold text-ink">{t('dashboard.emptyTitle')}</h2>
        <p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-slate-600">{t('dashboard.emptyCopy')}</p>
      </section>}

      {hasCampaigns && <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="dashboard-campaign-health-title">
        <p className="text-sm font-semibold text-brand">{t('dashboard.campaignHealth')}</p>
        <h2 id="dashboard-campaign-health-title" className="mt-2 text-xl font-bold text-ink">{t('dashboard.campaignHealthTitle')}</h2>
        <p className="mt-2 text-sm text-slate-600">{t('dashboard.campaignHealthHelp')}</p>
        <dl className="mt-4 grid gap-3 min-[430px]:grid-cols-3">
          <div className="rounded-md bg-slate-50 p-3"><dt className="text-sm text-slate-500">{t('dashboard.metricOpenRate')}</dt><dd className="mt-1 text-2xl font-bold">{metrics.open_rate}%</dd></div>
          <div className="rounded-md bg-slate-50 p-3"><dt className="text-sm text-slate-500">{t('dashboard.metricReplyRate')}</dt><dd className="mt-1 text-2xl font-bold">{metrics.reply_rate}%</dd></div>
          <div className="rounded-md bg-slate-50 p-3"><dt className="text-sm text-slate-500">{t('dashboard.metricConversion')}</dt><dd className="mt-1 text-2xl font-bold">{metrics.conversion_rate}%</dd></div>
        </dl>
      </section>}

      {hasAiResult && <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="dashboard-ai-result-title">
        <p className="text-sm font-semibold text-brand">{t('dashboard.latestAiResult')}</p>
        <h2 id="dashboard-ai-result-title" className="mt-2 text-xl font-bold text-ink">{textValue(aiResult?.title, t('dashboard.latestAiFallback'))}</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">{textValue(aiResult?.why, t('dashboard.latestAiHelp'))}</p>
        {Boolean(aiResult?.action) && <p className="mt-3 rounded-md bg-slate-50 p-3 text-sm font-semibold text-ink">{textValue(aiResult?.action)}</p>}
      </section>}
    </>}
  </div>;
}

export function CampaignBuilder() {
  const { api, ready } = useTokenApi();
  const { aiLanguage } = useI18n();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [selectedCampaign, setSelectedCampaign] = useState('');
  const [selectedLead, setSelectedLead] = useState('');
  const [email, setEmail] = useState<Email | null>(null);
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [analytics, setAnalytics] = useState<Record<string, CampaignAnalytics>>({});
  const [analyticsLoading, setAnalyticsLoading] = useState('');
  const [campaignStep, setCampaignStep] = useState(1);
  const [showCampaignAdvanced, setShowCampaignAdvanced] = useState(false);

  const load = useCallback(() => {
    if (!ready) return;
    setLoading(true);
    Promise.all([api<Campaign[]>('/api/campaigns'), api<{ items: Lead[] }>('/api/leads?page_size=100')])
      .then(([c, l]) => { setCampaigns(c); setLeads(l.items); if (c[0]) setSelectedCampaign(c[0].id); if (l.items[0]) setSelectedLead(l.items[0].id || ''); })
      .catch((nextError) => setNotice(friendlyErrorMessage(nextError, 'Campaign data could not be loaded. Please refresh and try again.')))
      .finally(() => setLoading(false));
  }, [api, ready]);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(event.currentTarget);
    const payload = {
      name: String(data.get('name') || ''),
      industry: String(data.get('industry') || ''),
      countries: splitList(String(data.get('countries') || '')),
      cities: splitList(String(data.get('cities') || '')),
      company_size: String(data.get('company_size') || ''),
      keywords: splitList(String(data.get('keywords') || '')),
      website_filters: splitList(String(data.get('website_filters') || '')),
      language: String(data.get('language') || aiLanguage),
      offer: String(data.get('offer') || ''),
      cta: String(data.get('cta') || ''),
      email_tone: String(data.get('email_tone') || 'Professional'),
      signature: String(data.get('signature') || ''),
      follow_up_days: Number(data.get('follow_up_days') || 3),
      timezone: String(data.get('timezone') || 'UTC'),
      working_hours: String(data.get('working_hours') || '09:00-17:00'),
      daily_send_limit: Number(data.get('daily_send_limit') || 50),
      sequence: [
        { step_order: 1, name: 'Email #1', subject: String(data.get('email_1_subject') || ''), body: String(data.get('email_1_body') || ''), delay_days: 0 },
        { step_order: 2, name: 'Follow-up #1', subject: String(data.get('follow_1_subject') || ''), body: String(data.get('follow_1_body') || ''), delay_days: Number(data.get('follow_1_delay') || 3) },
        { step_order: 3, name: 'Follow-up #2', subject: String(data.get('follow_2_subject') || ''), body: String(data.get('follow_2_body') || ''), delay_days: Number(data.get('follow_2_delay') || 7) },
        { step_order: 4, name: 'Follow-up #3', subject: String(data.get('follow_3_subject') || ''), body: String(data.get('follow_3_body') || ''), delay_days: Number(data.get('follow_3_delay') || 12) }
      ]
    };
    const created = await api<Campaign>('/api/campaigns', { method: 'POST', body: JSON.stringify(payload) });
    setCampaigns((items) => [created, ...items.filter((item) => item.id !== created.id)]);
    setSelectedCampaign(created.id);
    setNotice('Campaign saved. You can now attach leads and generate personalized emails.');
    form.reset();
  }

  async function generateEmail() {
    if (!selectedCampaign || !selectedLead) { setNotice('Select a campaign and lead before generating an email.'); return; }
    setGenerating(true);
    try {
      const created = await api<Email>('/api/emails/generate', { method: 'POST', body: JSON.stringify({ campaign_id: selectedCampaign, lead_id: selectedLead }) });
      setEmail(created);
      setNotice('AI email generated and saved.');
    } finally { setGenerating(false); }
  }

  async function saveEmail() {
    if (!email) return;
    const saved = await api<Email>(`/api/emails/${email.id}`, { method: 'PATCH', body: JSON.stringify({ subject: email.subject, preview: email.preview, body: email.body, cta: email.cta, follow_up_1: email.follow_up_1, follow_up_2: email.follow_up_2 }) });
    setEmail(saved);
    setNotice('Email changes saved.');
  }

  async function sendEmail() {
    if (!email) return;
    const sent = await api<Email>(`/api/emails/${email.id}/send`, { method: 'POST' });
    setEmail(sent);
    setNotice(`Email ${sent.delivery_status}.`);
  }

  async function campaignAction(id: string, action: 'launch' | 'pause' | 'resume' | 'duplicate') {
    const updated = await api<Campaign>(`/api/campaigns/${id}/${action}`, { method: 'POST' });
    setCampaigns((items) => action === 'duplicate' ? [updated, ...items] : items.map((item) => item.id === updated.id ? updated : item));
    setNotice(action === 'duplicate' ? 'Campaign duplicated.' : `Campaign ${action}d.`);
  }

  async function generateCampaignAnalytics(id: string) {
    setAnalyticsLoading(id);
    try {
      const result = await api<CampaignAnalytics>(`/api/campaigns/${id}/ai-analytics`, { method: 'POST' });
      setAnalytics((items) => ({ ...items, [id]: result }));
      setNotice('AI campaign analytics generated.');
    } finally { setAnalyticsLoading(''); }
  }

  if (simpleExperience) {
    return <div className="min-w-0 space-y-6">
      <header className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-sm font-semibold text-brand">Step 3 of 4</p>
        <h1 className="mt-2 text-2xl font-bold min-[390px]:text-3xl">Create a campaign</h1>
        <p className="mt-2 max-w-2xl text-slate-600">Tell OutreachAI who you want to contact and what you want them to do. AI prepares the email; you approve it before sending.</p>
        <a href="#campaign-wizard" className="focus-ring mt-5 inline-flex min-h-11 items-center justify-center rounded-md bg-ink px-5 py-2 text-sm font-semibold text-white">Start campaign</a>
      </header>
      {notice && <Notice message={notice} kind={notice.startsWith('Select') ? 'warning' : 'success'} />}
      {loading ? <Skeleton lines={4} /> : <div className="grid gap-6 xl:grid-cols-[1fr_0.9fr]">
        <form id="campaign-wizard" onSubmit={submit} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-5 grid gap-2 min-[430px]:grid-cols-3">
            {['Campaign', 'Audience', 'Offer'].map((label, index) => <button key={label} type="button" onClick={() => setCampaignStep(index + 1)} className={`min-h-11 rounded-md px-3 text-sm font-semibold ${campaignStep === index + 1 ? 'bg-brand text-white' : 'border border-slate-300 text-slate-700'}`}>{index + 1}. {label}</button>)}
          </div>
          {campaignStep === 1 && <section className="space-y-4">
            <div><h2 className="text-xl font-bold text-ink">What is this campaign for?</h2><p className="mt-1 text-sm text-slate-600">Use a simple name and industry so you can recognize it later.</p></div>
            <label className="block"><span className="text-sm font-semibold text-slate-700">Campaign name</span><input name="name" required placeholder="Example: German builders outreach" className="mt-2 w-full rounded-md border border-slate-300 px-3 py-3" /></label>
            <label className="block"><span className="text-sm font-semibold text-slate-700">Industry</span><input name="industry" placeholder="Example: Construction" className="mt-2 w-full rounded-md border border-slate-300 px-3 py-3" /></label>
            <button type="button" onClick={() => setCampaignStep(2)} className="focus-ring min-h-11 w-full rounded-md bg-brand px-4 py-2 font-semibold text-white">Continue</button>
          </section>}
          {campaignStep === 2 && <section className="space-y-4">
            <div><h2 className="text-xl font-bold text-ink">Who should OutreachAI contact?</h2><p className="mt-1 text-sm text-slate-600">Keep the first audience narrow: one country, one city, one type of company.</p></div>
            <label className="block"><span className="text-sm font-semibold text-slate-700">Country</span><input name="countries" placeholder="Germany" className="mt-2 w-full rounded-md border border-slate-300 px-3 py-3" /></label>
            <label className="block"><span className="text-sm font-semibold text-slate-700">City</span><input name="cities" placeholder="Berlin" className="mt-2 w-full rounded-md border border-slate-300 px-3 py-3" /></label>
            <label className="block"><span className="text-sm font-semibold text-slate-700">Keywords</span><input name="keywords" placeholder="renovation, construction, property" className="mt-2 w-full rounded-md border border-slate-300 px-3 py-3" /></label>
            <div className="grid gap-3 min-[430px]:grid-cols-2"><button type="button" onClick={() => setCampaignStep(1)} className="min-h-11 rounded-md border border-slate-300 px-4 font-semibold">Back</button><button type="button" onClick={() => setCampaignStep(3)} className="min-h-11 rounded-md bg-brand px-4 font-semibold text-white">Continue</button></div>
          </section>}
          {campaignStep === 3 && <section className="space-y-4">
            <div><h2 className="text-xl font-bold text-ink">What should the email offer?</h2><p className="mt-1 text-sm text-slate-600">Write one clear offer and one clear action you want the prospect to take.</p></div>
            <label className="block"><span className="text-sm font-semibold text-slate-700">Offer</span><textarea name="offer" required placeholder="We help construction companies book more qualified project calls." className="mt-2 min-h-28 w-full rounded-md border border-slate-300 p-3" /></label>
            <label className="block"><span className="text-sm font-semibold text-slate-700">Call to action</span><input name="cta" placeholder="Book a 15-minute call" className="mt-2 w-full rounded-md border border-slate-300 px-3 py-3" /></label>
            <label className="block"><span className="text-sm font-semibold text-slate-700">Signature</span><textarea name="signature" placeholder="Vadym, OutreachAI" className="mt-2 min-h-20 w-full rounded-md border border-slate-300 p-3" /></label>
            <details className="rounded-md border border-slate-200 bg-slate-50 p-3" open={showCampaignAdvanced} onToggle={(event) => setShowCampaignAdvanced(event.currentTarget.open)}>
              <summary className="cursor-pointer font-semibold text-ink">Advanced settings</summary>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <input name="company_size" placeholder="Company size" className="rounded-md border border-slate-300 px-3 py-2" />
                <input name="website_filters" placeholder="Website filters" className="rounded-md border border-slate-300 px-3 py-2" />
                <input name="language" defaultValue={aiLanguage} className="rounded-md border border-slate-300 px-3 py-2" />
                <select name="email_tone" className="rounded-md border border-slate-300 px-3 py-2">{tones.map((tone) => <option key={tone}>{tone}</option>)}</select>
                <input name="timezone" defaultValue="UTC" placeholder="Timezone" className="rounded-md border border-slate-300 px-3 py-2" />
                <input name="daily_send_limit" type="number" defaultValue="25" min="1" max="250" className="rounded-md border border-slate-300 px-3 py-2" />
              </div>
            </details>
            <div className="grid gap-3 min-[430px]:grid-cols-2"><button type="button" onClick={() => setCampaignStep(2)} className="min-h-11 rounded-md border border-slate-300 px-4 font-semibold">Back</button><button className="focus-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-brand px-4 py-2 font-semibold text-white"><Plus size={18} /> Save campaign</button></div>
          </section>}
        </form>
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-xl font-bold text-ink">Review AI email</h2>
          <p className="mt-2 text-sm text-slate-600">After you have one campaign and one lead, generate the first email here. You can edit it before sending.</p>
          {campaigns.length && leads.length ? <div className="mt-4 space-y-3"><select value={selectedCampaign} onChange={(event) => setSelectedCampaign(event.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-3">{campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}</select><select value={selectedLead} onChange={(event) => setSelectedLead(event.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-3">{leads.map((lead) => <option key={lead.id} value={lead.id}>{lead.company}</option>)}</select><button onClick={generateEmail} disabled={generating} className="focus-ring inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-ink px-4 py-2 font-semibold text-white disabled:opacity-60">{generating ? <Loader2 className="animate-spin" size={18} /> : <Wand2 size={18} />} Generate email for review</button>{email && <div className="space-y-3 rounded-md bg-slate-50 p-3"><input value={email.subject} onChange={(e) => setEmail({ ...email, subject: e.target.value })} className="w-full rounded-md border border-slate-300 px-3 py-2 font-semibold" /><textarea value={email.body} onChange={(e) => setEmail({ ...email, body: e.target.value })} className="min-h-48 w-full rounded-md border border-slate-300 p-3" /><div className="grid gap-2 min-[430px]:grid-cols-2"><button onClick={saveEmail} className="min-h-11 rounded-md border border-slate-300 px-4 font-semibold">Save draft</button><button onClick={sendEmail} className="min-h-11 rounded-md bg-brand px-4 font-semibold text-white">Approve & send</button></div></div>}</div> : <EmptyState title="Add one lead first" copy="Find or add a company before generating an email." />}
        </section>
      </div>}
      <section className="grid gap-4 lg:grid-cols-3">{campaigns.map((campaign) => <article key={campaign.id} className="rounded-lg border border-slate-200 bg-white p-4"><h2 className="font-bold">{campaign.name}</h2><p className="mt-1 text-sm text-slate-500">{campaign.industry || 'Industry not set'} · {campaign.status}</p><div className="mt-4 grid grid-cols-3 gap-2 text-sm"><div><p className="text-slate-500">Leads</p><p className="font-bold">{campaign.leads}</p></div><div><p className="text-slate-500">Sent</p><p className="font-bold">{campaign.sent}</p></div><div><p className="text-slate-500">Replies</p><p className="font-bold">{campaign.replies}</p></div></div><details className="mt-4"><summary className="cursor-pointer text-sm font-semibold text-brand">Advanced actions</summary><div className="mt-3 flex flex-wrap gap-2">{['launch', 'pause', 'resume', 'duplicate'].map((action) => <button key={action} onClick={() => campaignAction(campaign.id, action as 'launch' | 'pause' | 'resume' | 'duplicate')} className="min-h-11 rounded-md border border-slate-300 px-3 text-sm font-semibold capitalize">{action}</button>)}</div></details></article>)}</section>
      {!campaigns.length && !loading && <EmptyState title="No campaigns yet" copy="Use the three-step campaign builder above. Start with one small audience and one clear offer." />}
    </div>;
  }

  return <div className="min-w-0"><h1 className="text-2xl font-bold min-[390px]:text-3xl">Campaign Builder</h1><p className="mt-2 text-slate-600">Create targeted outbound campaigns with schedules, send limits, working hours, and a four-step sequence.</p>{notice && <Notice message={notice} kind={notice.startsWith('Select') ? 'warning' : 'success'} />}{loading ? <div className="mt-6"><Skeleton lines={4} /></div> : <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_0.9fr]"><form onSubmit={submit} className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 min-[360px]:p-5 sm:grid-cols-2"><input name="name" required placeholder="Campaign name" className="rounded-md border border-slate-300 px-3 py-2 sm:col-span-2" /><input name="industry" placeholder="Industry" className="rounded-md border border-slate-300 px-3 py-2" /><input name="company_size" placeholder="Company size" className="rounded-md border border-slate-300 px-3 py-2" /><input name="countries" placeholder="Countries, comma separated" className="rounded-md border border-slate-300 px-3 py-2" /><input name="cities" placeholder="Cities, comma separated" className="rounded-md border border-slate-300 px-3 py-2" /><input name="keywords" placeholder="Keywords" className="rounded-md border border-slate-300 px-3 py-2" /><input name="website_filters" placeholder="Website filters" className="rounded-md border border-slate-300 px-3 py-2" /><input name="language" defaultValue={aiLanguage} className="rounded-md border border-slate-300 px-3 py-2" /><select name="email_tone" className="rounded-md border border-slate-300 px-3 py-2">{tones.map((tone) => <option key={tone}>{tone}</option>)}</select><textarea name="offer" placeholder="Offer" className="min-h-24 rounded-md border border-slate-300 p-3 sm:col-span-2" /><input name="cta" placeholder="CTA" className="rounded-md border border-slate-300 px-3 py-2" /><input name="timezone" defaultValue="UTC" placeholder="Timezone" className="rounded-md border border-slate-300 px-3 py-2" /><input name="working_hours" defaultValue="09:00-17:00" placeholder="Working hours" className="rounded-md border border-slate-300 px-3 py-2" /><input name="daily_send_limit" type="number" defaultValue="50" min="1" max="500" placeholder="Daily send limit" className="rounded-md border border-slate-300 px-3 py-2" /><input name="follow_up_days" type="number" defaultValue="3" min="1" max="30" className="rounded-md border border-slate-300 px-3 py-2" /><textarea name="signature" placeholder="Signature" className="min-h-24 rounded-md border border-slate-300 p-3 sm:col-span-2" /><div className="grid gap-3 rounded-md bg-slate-50 p-3 sm:col-span-2"><p className="font-semibold">Sequence editor</p><input name="email_1_subject" placeholder="Email #1 subject" className="rounded-md border border-slate-300 px-3 py-2" /><textarea name="email_1_body" placeholder="Email #1 body" className="min-h-24 rounded-md border border-slate-300 p-3" /><div className="grid gap-3 min-[430px]:grid-cols-[1fr_90px]"><input name="follow_1_subject" placeholder="Follow-up #1 subject" className="rounded-md border border-slate-300 px-3 py-2" /><input name="follow_1_delay" type="number" defaultValue="3" min="1" className="rounded-md border border-slate-300 px-3 py-2" /></div><textarea name="follow_1_body" placeholder="Follow-up #1 body" className="min-h-20 rounded-md border border-slate-300 p-3" /><div className="grid gap-3 min-[430px]:grid-cols-[1fr_90px]"><input name="follow_2_subject" placeholder="Follow-up #2 subject" className="rounded-md border border-slate-300 px-3 py-2" /><input name="follow_2_delay" type="number" defaultValue="7" min="1" className="rounded-md border border-slate-300 px-3 py-2" /></div><textarea name="follow_2_body" placeholder="Follow-up #2 body" className="min-h-20 rounded-md border border-slate-300 p-3" /><div className="grid gap-3 min-[430px]:grid-cols-[1fr_90px]"><input name="follow_3_subject" placeholder="Follow-up #3 subject" className="rounded-md border border-slate-300 px-3 py-2" /><input name="follow_3_delay" type="number" defaultValue="12" min="1" className="rounded-md border border-slate-300 px-3 py-2" /></div><textarea name="follow_3_body" placeholder="Follow-up #3 body" className="min-h-20 rounded-md border border-slate-300 p-3" /></div><button className="focus-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-brand px-4 py-2 font-semibold text-white sm:col-span-2"><Plus size={18} /> Save campaign</button></form><section className="rounded-lg border border-slate-200 bg-white p-4 min-[360px]:p-5"><h2 className="font-bold">AI Email Generator</h2>{campaigns.length && leads.length ? <div className="mt-4 space-y-3"><select value={selectedCampaign} onChange={(event) => setSelectedCampaign(event.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2">{campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}</select><select value={selectedLead} onChange={(event) => setSelectedLead(event.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2">{leads.map((lead) => <option key={lead.id} value={lead.id}>{lead.company}</option>)}</select><button onClick={generateEmail} disabled={generating} className="focus-ring inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-ink px-4 py-2 font-semibold text-white disabled:opacity-60">{generating ? <Loader2 className="animate-spin" size={18} /> : <Wand2 size={18} />} Generate Email</button>{email && <div className="space-y-3"><div className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600">Delivery status: <span className="font-semibold text-ink">{email.delivery_status}</span></div><input value={email.subject} onChange={(e) => setEmail({ ...email, subject: e.target.value })} className="w-full rounded-md border border-slate-300 px-3 py-2" /><input value={email.preview} onChange={(e) => setEmail({ ...email, preview: e.target.value })} className="w-full rounded-md border border-slate-300 px-3 py-2" /><textarea value={email.body} onChange={(e) => setEmail({ ...email, body: e.target.value })} className="min-h-48 w-full rounded-md border border-slate-300 p-3" /><textarea value={email.follow_up_1 || ''} onChange={(e) => setEmail({ ...email, follow_up_1: e.target.value })} placeholder="Follow-up #1" className="min-h-28 w-full rounded-md border border-slate-300 p-3" /><textarea value={email.follow_up_2 || ''} onChange={(e) => setEmail({ ...email, follow_up_2: e.target.value })} placeholder="Follow-up #2" className="min-h-28 w-full rounded-md border border-slate-300 p-3" /><input value={email.cta} onChange={(e) => setEmail({ ...email, cta: e.target.value })} className="w-full rounded-md border border-slate-300 px-3 py-2" /><div className="grid gap-2 min-[430px]:grid-cols-2"><button onClick={saveEmail} className="focus-ring inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-slate-300 px-4 py-2 font-semibold"><Save size={18} /> Save email</button><button onClick={sendEmail} className="focus-ring inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-brand px-4 py-2 font-semibold text-white"><Send size={18} /> Send</button></div></div>}</div> : <EmptyState title="Campaigns and leads required" copy="Create a campaign and add a lead before generating AI emails." />}</section></div>}<div className="mt-6 grid gap-4 lg:grid-cols-3">{campaigns.map((campaign) => <article key={campaign.id} className="rounded-lg border border-slate-200 bg-white p-4"><div className="flex items-start justify-between gap-3"><div><h2 className="font-bold">{campaign.name}</h2><p className="text-sm text-slate-500">{campaign.industry || 'No industry set'}</p></div><span className="rounded-full bg-teal-50 px-3 py-1 text-xs font-semibold text-brand">{campaign.status}</span></div><dl className="mt-4 grid grid-cols-2 gap-2 text-sm min-[430px]:grid-cols-4"><div><dt className="text-slate-500">Leads</dt><dd className="font-bold">{campaign.leads}</dd></div><div><dt className="text-slate-500">Sent</dt><dd className="font-bold">{campaign.sent}</dd></div><div><dt className="text-slate-500">Replies</dt><dd className="font-bold">{campaign.replies}</dd></div><div><dt className="text-slate-500">Limit</dt><dd className="font-bold">{campaign.daily_send_limit}/day</dd></div></dl><p className="mt-3 text-sm text-slate-500">{campaign.timezone} · {campaign.working_hours}</p><div className="mt-4 flex flex-wrap gap-2">{['launch', 'pause', 'resume', 'duplicate'].map((action) => <button key={action} onClick={() => campaignAction(campaign.id, action as 'launch' | 'pause' | 'resume' | 'duplicate')} className="focus-ring min-h-11 rounded-md border border-slate-300 px-3 text-sm font-semibold capitalize">{action}</button>)}<button onClick={() => generateCampaignAnalytics(campaign.id)} className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-md border border-slate-300 px-3 text-sm font-semibold">{analyticsLoading === campaign.id ? <Loader2 className="animate-spin" size={16} /> : <Sparkles size={16} />} Analytics</button></div>{analytics[campaign.id] && <div className="mt-4 rounded-md bg-slate-50 p-3 text-sm"><div className="grid grid-cols-3 gap-2"><div><p className="text-slate-500">Success</p><p className="font-bold">{analytics[campaign.id].campaign_success}%</p></div><div><p className="text-slate-500">Reply</p><p className="font-bold">{analytics[campaign.id].predicted_reply_rate}%</p></div><div><p className="text-slate-500">Conv.</p><p className="font-bold">{analytics[campaign.id].predicted_conversion_rate}%</p></div></div><ul className="mt-2 list-disc space-y-1 pl-4 text-slate-600">{analytics[campaign.id].suggested_improvements.slice(0, 3).map((item) => <li key={item}>{item}</li>)}</ul></div>}{campaign.sequence?.length ? <div className="mt-4 space-y-2">{campaign.sequence.map((step) => <div key={step.step_order} className="rounded-md bg-slate-50 p-2 text-sm"><p className="font-semibold">{step.name}</p><p className="text-slate-500">{step.delay_days} day delay</p></div>)}</div> : null}</article>)}</div>{!campaigns.length && !loading && <div className="mt-6"><EmptyState title="No campaigns" copy="Build your first outbound campaign to start generating emails." /></div>}</div>;
}

export function LeadManager() {
  const { api, ready } = useTokenApi();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [finding, setFinding] = useState(false);
  const [aiLoading, setAiLoading] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [copilot, setCopilot] = useState<Record<string, SalesCopilot>>({});
  const [audits, setAudits] = useState<Record<string, WebsiteAudit>>({});
  const [meetingPrep, setMeetingPrep] = useState<Record<string, MeetingPrep>>({});
  const [followUps, setFollowUps] = useState<Record<string, FollowUpSequence>>({});
  const [leadAdvancedOpen, setLeadAdvancedOpen] = useState(false);
  const [leadStep, setLeadStep] = useState(1);
  const [leadCountry, setLeadCountry] = useState('');
  const [leadCity, setLeadCity] = useState('');
  const [leadIndustry, setLeadIndustry] = useState('');

  const load = useCallback(() => {
    if (!ready) return;
    setLoading(true);
    setError('');
    Promise.all([api<{ items: Lead[] }>(`/api/leads?search=${encodeURIComponent(search)}&status=${encodeURIComponent(status)}&page_size=50`), api<Campaign[]>('/api/campaigns')])
      .then(([leadPage, nextCampaigns]) => { setLeads(leadPage.items); setCampaigns(nextCampaigns); })
      .catch((nextError) => setError(friendlyErrorMessage(nextError, 'Lead data could not be loaded. Please refresh and try again.')))
      .finally(() => setLoading(false));
  }, [api, ready, search, status]);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === '/' && document.activeElement instanceof HTMLElement && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) {
        event.preventDefault();
        document.getElementById('lead-search')?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  async function find(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setFinding(true);
    setNotice('');
    try {
      const found = await api<Lead[]>('/api/leads/find', { method: 'POST', body: JSON.stringify({ industry: data.get('industry'), niche: data.get('industry'), country: data.get('country'), city: data.get('city'), employee_count: data.get('employee_count'), revenue: data.get('revenue'), technologies: splitList(String(data.get('technologies') || '')), keywords: splitList(String(data.get('keywords') || '')), limit: Number(data.get('limit') || 10) }) });
      setLeads((items) => [...found, ...items.filter((item) => !found.some((lead) => lead.id === item.id))]);
      setNotice(`Imported ${found.length} leads and queued website analysis where possible.`);
    } catch (nextError) {
      setError(friendlyErrorMessage(nextError, 'Lead discovery could not be completed. Please adjust the filters and try again.'));
    } finally { setFinding(false); }
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const lead = await api<Lead>('/api/leads', { method: 'POST', body: JSON.stringify({ company: data.get('company'), website: data.get('website'), industry: data.get('industry'), country: data.get('country'), city: data.get('city'), contact: data.get('contact'), email: data.get('email') || null, campaign_id: data.get('campaign_id') || null }) });
    setLeads((items) => [lead, ...items.filter((item) => item.id !== lead.id)]);
    setNotice(`${lead.company} imported and analyzed when a website was available.`);
    form.reset();
  }

  async function bulkStatus(nextStatus: string) {
    await api('/api/leads/bulk', { method: 'POST', body: JSON.stringify({ ids: selected, status: nextStatus }) });
    setLeads((items) => items.map((lead) => lead.id && selected.includes(lead.id) ? { ...lead, status: nextStatus } : lead));
    setSelected([]);
  }

  async function runLeadAi<T>(lead: Lead, action: 'copilot' | 'website-audit' | 'meeting-prep' | 'follow-ups', setter: (id: string, value: T) => void) {
    if (!lead.id) return;
    setAiLoading(`${lead.id}:${action}`);
    setError('');
    try {
      const result = await api<T>(`/api/leads/${lead.id}/${action}`, { method: 'POST' });
      setter(lead.id, result);
      setNotice(`AI ${action.replace('-', ' ')} generated for ${lead.company}.`);
    } catch (nextError) {
      setError(friendlyErrorMessage(nextError, `AI ${action.replace('-', ' ')} could not be completed. Please try again.`));
    } finally { setAiLoading(''); }
  }

  if (simpleExperience) {
    return <div className="min-w-0 space-y-6">
      <header className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-sm font-semibold text-brand">Step 2 of 4</p>
        <h1 className="mt-2 text-2xl font-bold min-[390px]:text-3xl">Find leads</h1>
        <p className="mt-2 max-w-2xl text-slate-600">Choose who you want to sell to. OutreachAI finds companies and prepares them for review.</p>
        <a href="#lead-search-form" className="focus-ring mt-5 inline-flex min-h-11 items-center justify-center rounded-md bg-ink px-5 py-2 text-sm font-semibold text-white">Find companies</a>
      </header>
      {error && <Notice message={error} kind="error" />}
      {notice && <Notice message={notice} />}
      <form id="lead-search-form" onSubmit={find} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-5"><h2 className="text-xl font-bold text-ink">Who should OutreachAI find?</h2><p className="mt-1 text-sm text-slate-600">Start simple. You can narrow the search after the first results.</p></div>
        <div className="mb-5 grid gap-2 min-[430px]:grid-cols-3">
          {['Country', 'Industry', 'Company size'].map((label, index) => <button key={label} type="button" onClick={() => setLeadStep(index + 1)} className={`min-h-11 rounded-md px-3 text-sm font-semibold ${leadStep === index + 1 ? 'bg-brand text-white' : 'border border-slate-300 text-slate-700'}`}>{index + 1}. {label}</button>)}
        </div>
        {leadStep === 1 && <section className="space-y-4">
          <div><h3 className="text-lg font-bold text-ink">Where should we search?</h3><p className="mt-1 text-sm text-slate-600">Choose one country first. A focused search is easier to review.</p></div>
          <label className="block"><span className="text-sm font-semibold text-slate-700">Country</span><input required name="country" value={leadCountry} onChange={(event) => setLeadCountry(event.target.value)} placeholder="Germany" className="mt-2 w-full rounded-md border border-slate-300 px-3 py-3" /></label>
          <label className="block"><span className="text-sm font-semibold text-slate-700">City</span><input name="city" value={leadCity} onChange={(event) => setLeadCity(event.target.value)} placeholder="Berlin" className="mt-2 w-full rounded-md border border-slate-300 px-3 py-3" /></label>
          <button type="button" onClick={() => setLeadStep(2)} className="min-h-11 w-full rounded-md bg-brand px-4 py-2 font-semibold text-white min-[430px]:w-auto">Continue</button>
        </section>}
        {leadStep === 2 && <section className="space-y-4">
          <div><h3 className="text-lg font-bold text-ink">What industry should we target?</h3><p className="mt-1 text-sm text-slate-600">Use words a business owner would use, like construction, real estate, or dental clinics.</p></div>
          <input type="hidden" name="country" value={leadCountry} />
          <input type="hidden" name="city" value={leadCity} />
          <label className="block"><span className="text-sm font-semibold text-slate-700">Industry</span><input name="industry" value={leadIndustry} onChange={(event) => setLeadIndustry(event.target.value)} placeholder="Construction" className="mt-2 w-full rounded-md border border-slate-300 px-3 py-3" /></label>
          <div className="grid gap-3 min-[430px]:grid-cols-2"><button type="button" onClick={() => setLeadStep(1)} className="min-h-11 rounded-md border border-slate-300 px-4 font-semibold">Back</button><button type="button" onClick={() => setLeadStep(3)} className="min-h-11 rounded-md bg-brand px-4 font-semibold text-white">Continue</button></div>
        </section>}
        {leadStep === 3 && <section className="space-y-4">
          <div><h3 className="text-lg font-bold text-ink">What company size is best?</h3><p className="mt-1 text-sm text-slate-600">Pick the range your offer helps most. If unsure, start with 11-50 employees.</p></div>
          <input type="hidden" name="country" value={leadCountry} />
          <input type="hidden" name="city" value={leadCity} />
          <input type="hidden" name="industry" value={leadIndustry} />
          <label className="block"><span className="text-sm font-semibold text-slate-700">Company size</span><select name="employee_count" defaultValue="11-50" className="mt-2 w-full rounded-md border border-slate-300 px-3 py-3"><option value="1-10">1-10 employees</option><option value="11-50">11-50 employees</option><option value="51-200">51-200 employees</option><option value="201-500">201-500 employees</option><option value="500+">500+ employees</option></select></label>
          <div className="grid gap-3 min-[430px]:grid-cols-2"><button type="button" onClick={() => setLeadStep(2)} className="min-h-11 rounded-md border border-slate-300 px-4 font-semibold">Back</button><button disabled={finding || !leadCountry.trim()} className="focus-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-brand px-4 py-2 font-semibold text-white disabled:opacity-60">{finding ? <Loader2 className="animate-spin" size={18} /> : <Search size={18} />} Search</button></div>
        </section>}
        <details className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3" open={leadAdvancedOpen} onToggle={(event) => setLeadAdvancedOpen(event.currentTarget.open)}>
          <summary className="cursor-pointer font-semibold text-ink">Advanced settings</summary>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <input name="keywords" placeholder="Keywords" className="rounded-md border border-slate-300 px-3 py-2" />
            <input name="revenue" placeholder="Revenue" className="rounded-md border border-slate-300 px-3 py-2" />
            <input name="technologies" placeholder="Technologies" className="rounded-md border border-slate-300 px-3 py-2" />
            <input name="limit" type="number" min="1" max="25" defaultValue="10" className="rounded-md border border-slate-300 px-3 py-2" />
          </div>
        </details>
      </form>
      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div><h2 className="text-xl font-bold text-ink">Companies to review</h2><p className="mt-1 text-sm text-slate-600">Check each company before adding it to a campaign.</p></div>
          <div className="relative md:w-80"><Search className="absolute left-3 top-3 text-slate-400" size={18} /><input id="lead-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search companies" className="w-full rounded-md border border-slate-300 py-2 pl-10 pr-3" /></div>
        </div>
        {loading ? <div className="mt-6"><Skeleton lines={4} /></div> : leads.length ? <div className="mt-5 space-y-3">{leads.map((lead) => <article key={lead.id || lead.company} className="rounded-lg border border-slate-200 p-4"><div className="flex flex-col gap-3 min-[430px]:flex-row min-[430px]:items-start min-[430px]:justify-between"><div><h3 className="font-bold text-ink">{lead.company}</h3><p className="mt-1 break-all text-sm text-slate-500">{lead.website || lead.email || 'Contact details not found yet'}</p></div><span className="w-fit rounded-full bg-teal-50 px-3 py-1 text-xs font-semibold text-brand">{lead.status}</span></div><dl className="mt-3 grid gap-2 text-sm min-[430px]:grid-cols-3"><div><dt className="text-slate-500">Industry</dt><dd>{lead.industry || 'Not found'}</dd></div><div><dt className="text-slate-500">Location</dt><dd>{[lead.city, lead.country].filter(Boolean).join(', ') || 'Not found'}</dd></div><div><dt className="text-slate-500">Contact</dt><dd>{lead.email || lead.contact || 'Not found'}</dd></div></dl><div className="mt-4 flex flex-wrap gap-2"><button onClick={() => runLeadAi<SalesCopilot>(lead, 'copilot', (key, value) => setCopilot((items) => ({ ...items, [key]: value })))} className="min-h-11 rounded-md border border-slate-300 px-3 text-sm font-semibold">Review with AI</button><Link href="/dashboard/campaigns" className="inline-flex min-h-11 items-center justify-center rounded-md bg-ink px-3 text-sm font-semibold text-white">Use in campaign</Link></div></article>)}</div> : <div className="mt-5"><EmptyState title="No companies yet" copy="Search by country, city, and industry. Start broad, then narrow the results after OutreachAI finds companies." /></div>}
      </section>
      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-xl font-bold text-ink">Add one company manually</h2>
        <p className="mt-1 text-sm text-slate-600">Use this when you already know a company you want AI to analyze.</p>
        <form onSubmit={create} className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_auto]"><input required name="company" placeholder="Company name" className="rounded-md border border-slate-300 px-3 py-3" /><input name="website" placeholder="Website" className="rounded-md border border-slate-300 px-3 py-3" /><button className="min-h-11 rounded-md border border-slate-300 px-4 font-semibold">Add company</button><input type="hidden" name="industry" /><input type="hidden" name="country" /><input type="hidden" name="city" /><input type="hidden" name="contact" /><input type="hidden" name="email" /><input type="hidden" name="campaign_id" /></form>
      </section>
    </div>;
  }

  return <div className="min-w-0"><h1 className="text-2xl font-bold min-[390px]:text-3xl">Lead Management</h1><p className="mt-2 text-slate-600">Discover, enrich, score, prepare, and bulk-manage production leads. Press <kbd className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">/</kbd> to search.</p>{error && <Notice message={error} kind="error" />}{notice && <Notice message={notice} />}<form onSubmit={find} className="mt-6 grid gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm transition md:grid-cols-4"><input required name="country" placeholder="Country" className="rounded-md border border-slate-300 px-3 py-2" /><input name="city" placeholder="City" className="rounded-md border border-slate-300 px-3 py-2" /><input name="industry" placeholder="Industry" className="rounded-md border border-slate-300 px-3 py-2" /><input name="keywords" placeholder="Keywords" className="rounded-md border border-slate-300 px-3 py-2" /><input name="employee_count" placeholder="Employee count" className="rounded-md border border-slate-300 px-3 py-2" /><input name="revenue" placeholder="Revenue" className="rounded-md border border-slate-300 px-3 py-2" /><input name="technologies" placeholder="Technologies" className="rounded-md border border-slate-300 px-3 py-2" /><input name="limit" type="number" min="1" max="25" defaultValue="10" className="rounded-md border border-slate-300 px-3 py-2" /><button disabled={finding} className="focus-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-ink px-4 py-2 font-semibold text-white md:col-span-4">{finding ? <Loader2 className="animate-spin" size={18} /> : <Search size={18} />} Find leads</button></form><form onSubmit={create} className="mt-6 grid gap-3 rounded-lg border border-slate-200 bg-white p-4 md:grid-cols-4"><input required name="company" placeholder="Company" className="rounded-md border border-slate-300 px-3 py-2" /><input name="website" placeholder="Website" className="rounded-md border border-slate-300 px-3 py-2" /><input name="industry" placeholder="Industry" className="rounded-md border border-slate-300 px-3 py-2" /><input name="country" placeholder="Country" className="rounded-md border border-slate-300 px-3 py-2" /><input name="city" placeholder="City" className="rounded-md border border-slate-300 px-3 py-2" /><input name="contact" placeholder="Contact" className="rounded-md border border-slate-300 px-3 py-2" /><input name="email" placeholder="Email" className="rounded-md border border-slate-300 px-3 py-2" /><select name="campaign_id" className="rounded-md border border-slate-300 px-3 py-2"><option value="">No campaign</option>{campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}</select><button className="focus-ring min-h-11 rounded-md bg-brand px-4 py-2 font-semibold text-white md:col-span-4">Add lead</button></form><div className="mt-5 flex flex-col gap-3 min-[430px]:flex-row"><div className="relative flex-1"><Search className="absolute left-3 top-3 text-slate-400" size={18} /><input id="lead-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search leads" className="w-full rounded-md border border-slate-300 py-2 pl-10 pr-3" /></div><select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-md border border-slate-300 px-3 py-2"><option value="">All statuses</option>{pipeline.map((item) => <option key={item}>{item}</option>)}</select><button onClick={load} className="focus-ring min-h-11 rounded-md border border-slate-300 px-4 py-2 font-semibold">Apply</button></div>{selected.length > 0 && <div className="mt-4 flex flex-wrap gap-2 rounded-lg border border-slate-200 bg-white p-3"><span className="py-2 text-sm font-semibold">{selected.length} selected</span>{pipeline.map((item) => <button key={item} onClick={() => bulkStatus(item)} className="focus-ring min-h-11 rounded-md border border-slate-300 px-3 text-sm">{item}</button>)}</div>}{loading ? <div className="mt-6"><Skeleton lines={5} /></div> : leads.length ? <div className="mt-6 space-y-3">{leads.map((lead) => { const id = lead.id || lead.company; const leadCopilot = lead.id ? copilot[lead.id] : undefined; const audit = lead.id ? audits[lead.id] : undefined; const prep = lead.id ? meetingPrep[lead.id] : undefined; const follow = lead.id ? followUps[lead.id] : undefined; return <article key={id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-soft"><div className="flex items-start gap-3"><input type="checkbox" checked={Boolean(lead.id && selected.includes(lead.id))} onChange={(e) => setSelected((ids) => e.target.checked && lead.id ? [...ids, lead.id] : ids.filter((item) => item !== lead.id))} className="mt-1 size-5" /><div className="min-w-0 flex-1"><div className="flex flex-col gap-2 min-[430px]:flex-row min-[430px]:items-start min-[430px]:justify-between"><div><h2 className="font-bold">{lead.company}</h2><p className="break-all text-sm text-slate-500">{lead.email || lead.website || 'No contact yet'}</p></div><span className="w-fit rounded-full bg-teal-50 px-3 py-1 text-xs font-semibold text-brand">{lead.status}</span></div><dl className="mt-3 grid gap-2 text-sm min-[430px]:grid-cols-4"><div><dt className="text-slate-500">Industry</dt><dd>{lead.industry || '-'}</dd></div><div><dt className="text-slate-500">Country</dt><dd>{lead.country || '-'}</dd></div><div><dt className="text-slate-500">Contact</dt><dd>{lead.contact || '-'}</dd></div><div><dt className="text-slate-500">Value</dt><dd>€{metricNumber(lead.revenue).toLocaleString()}</dd></div></dl><div className="mt-4 flex flex-wrap gap-2"><button onClick={() => runLeadAi<SalesCopilot>(lead, 'copilot', (key, value) => setCopilot((items) => ({ ...items, [key]: value })))} className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-md border border-slate-300 px-3 text-sm font-semibold"><Brain size={16} /> Copilot</button><button onClick={() => runLeadAi<WebsiteAudit>(lead, 'website-audit', (key, value) => setAudits((items) => ({ ...items, [key]: value })))} className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-md border border-slate-300 px-3 text-sm font-semibold"><Sparkles size={16} /> Audit</button><button onClick={() => runLeadAi<MeetingPrep>(lead, 'meeting-prep', (key, value) => setMeetingPrep((items) => ({ ...items, [key]: value })))} className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-md border border-slate-300 px-3 text-sm font-semibold"><ClipboardList size={16} /> Meeting</button><button onClick={() => runLeadAi<FollowUpSequence>(lead, 'follow-ups', (key, value) => setFollowUps((items) => ({ ...items, [key]: value })))} className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-md border border-slate-300 px-3 text-sm font-semibold"><Wand2 size={16} /> Follow-up</button>{aiLoading.startsWith(String(lead.id)) && <Loader2 className="mt-3 animate-spin text-brand" size={18} />}</div>{leadCopilot && <div className="mt-4 grid gap-3 rounded-md bg-slate-50 p-3 text-sm min-[430px]:grid-cols-3"><div><p className="text-slate-500">Reply</p><p className="text-xl font-bold">{leadCopilot.probability_to_reply}%</p></div><div><p className="text-slate-500">Buy</p><p className="text-xl font-bold">{leadCopilot.probability_to_buy}%</p></div><div><p className="text-slate-500">Revenue</p><p className="text-xl font-bold">€{leadCopilot.estimated_revenue.toLocaleString()}</p></div><p className="min-[430px]:col-span-3"><span className="font-semibold">Subject:</span> {leadCopilot.best_subject_line}</p><p className="min-[430px]:col-span-3"><span className="font-semibold">CTA:</span> {leadCopilot.best_cta}</p></div>}{audit && <div className="mt-3 rounded-md bg-slate-50 p-3 text-sm"><p className="font-semibold">Website audit</p><p className="mt-1 text-slate-600">{audit.improvement_report}</p><div className="mt-2 flex flex-wrap gap-2">{audit.priority_actions.map((item) => <span key={item} className="rounded-full bg-white px-2 py-1 text-xs font-semibold">{item}</span>)}</div></div>}{prep && <div className="mt-3 rounded-md bg-slate-50 p-3 text-sm"><p className="font-semibold">Meeting prep</p><p className="mt-1 text-slate-600">{prep.company_summary}</p><p className="mt-2 font-semibold">Strategy: <span className="font-normal text-slate-600">{prep.sales_strategy}</span></p></div>}{follow && <div className="mt-3 grid gap-2 rounded-md bg-slate-50 p-3 text-sm min-[430px]:grid-cols-2">{Object.entries(follow).map(([state, items]) => <div key={state}><p className="font-semibold capitalize">{state.replace('_', ' ')}</p><p className="mt-1 text-slate-600">{items[0] || 'No draft yet'}</p></div>)}</div>}{lead.notes && <p className="mt-3 line-clamp-3 rounded-md bg-slate-50 p-3 text-xs text-slate-600">{lead.notes}</p>}</div></div></article>; })}</div> : <div className="mt-6"><EmptyState title="No leads" copy="Add a lead manually or run Lead Finder to populate the pipeline." /></div>}</div>;
}

export function AISalesEmployees() {
  const { api, ready } = useTokenApi();
  const { aiLanguage } = useI18n();
  const [employees, setEmployees] = useState<AISalesEmployee[]>([]);
  const [employeeId, setEmployeeId] = useState('');
  const [leads, setLeads] = useState<Lead[]>([]);
  const [insights, setInsights] = useState<Record<string, SalesEmployeeLeadInsight>>({});
  const [emails, setEmails] = useState<Record<string, Email>>({});
  const [runResult, setRunResult] = useState<SalesEmployeeRun | null>(null);
  const [taskPlan, setTaskPlan] = useState<SalesEmployeeTaskPlan | null>(null);
  const [memory, setMemory] = useState<SalesEmployeeMemory | null>(null);
  const [performance, setPerformance] = useState<SalesEmployeePerformance | null>(null);
  const [team, setTeam] = useState<TeamRouterDashboard | null>(null);
  const [teamPlan, setTeamPlan] = useState<TeamRouterPlan | null>(null);
  const [teamCommand, setTeamCommand] = useState('');
  const [command, setCommand] = useState('');
  const [listening, setListening] = useState(false);
  const [teamListening, setTeamListening] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const loadLeads = useCallback((id: string) => {
    if (!id) return Promise.resolve([]);
    return api<Lead[]>(`/api/sales-employees/${id}/leads`).then((items) => { setLeads(items); return items; });
  }, [api]);

  const loadEmployeeContext = useCallback((id: string) => {
    if (!id) return Promise.resolve();
    return Promise.all([
      api<SalesEmployeeMemory>(`/api/sales-employees/${id}/memory`),
      api<SalesEmployeePerformance>(`/api/sales-employees/${id}/performance`)
    ]).then(([nextMemory, nextPerformance]) => {
      setMemory(nextMemory);
      setPerformance(nextPerformance);
    });
  }, [api]);

  const loadTeam = useCallback(() => {
    return api<TeamRouterDashboard>('/api/team-router').then((dashboard) => {
      setTeam(dashboard);
      setTeamPlan(dashboard.current_plan || null);
      return dashboard;
    });
  }, [api]);

  const load = useCallback(() => {
    if (!ready) return;
    setLoading(true);
    setError('');
    Promise.all([api<AISalesEmployee[]>('/api/sales-employees'), loadTeam()])
      .then(([items]) => {
        setEmployees(items);
        const next = employeeId || items[0]?.id || '';
        setEmployeeId(next);
        return Promise.all([loadLeads(next), loadEmployeeContext(next)]);
      })
      .catch((nextError) => setError(friendlyErrorMessage(nextError, 'AI Sales Employees could not be loaded. Please refresh and try again.')))
      .finally(() => setLoading(false));
  }, [api, ready, employeeId, loadLeads, loadEmployeeContext, loadTeam]);

  useEffect(() => { void Promise.resolve().then(load); }, [load]);

  async function createEmployee(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy('create');
    try {
      const created = await api<AISalesEmployee>('/api/sales-employees', {
        method: 'POST',
        body: JSON.stringify({
          name: data.get('name'),
          role: data.get('role') || 'AI Sales Development Representative',
          product_service: data.get('product_service') || '',
          target_customer: data.get('target_customer') || '',
          target_countries: splitList(String(data.get('target_countries') || '')),
          target_industries: splitList(String(data.get('target_industries') || '')),
          offer: data.get('offer') || '',
          cta: data.get('cta') || 'Book a quick call',
          sending_mode: data.get('sending_mode') || 'Review Mode',
          daily_limit: Number(data.get('daily_limit') || 25),
          working_hours: data.get('working_hours') || '09:00-17:00',
          tone: data.get('tone') || 'Professional',
          language: data.get('language') || aiLanguage,
          signature: data.get('signature') || ''
        })
      });
      setEmployees((items) => [created, ...items.filter((item) => item.id !== created.id)]);
      setEmployeeId(created.id);
      setLeads([]);
      setTaskPlan(null);
      void loadEmployeeContext(created.id);
      setNotice(`${created.name} created in ${created.sending_mode}.`);
      form.reset();
    } catch (nextError) {
      setError(friendlyErrorMessage(nextError, 'AI Sales Employee could not be created. Please review the fields and try again.'));
    } finally { setBusy(''); }
  }

  function startVoice() {
    const SpeechRecognition = (window as unknown as { SpeechRecognition?: new () => any; webkitSpeechRecognition?: new () => any }).SpeechRecognition || (window as unknown as { webkitSpeechRecognition?: new () => any }).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setError('Voice input is not supported in this browser. Type the work request instead.');
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = speechRecognitionLocale(selectedEmployee?.language || aiLanguage);
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => setListening(true);
    recognition.onend = () => setListening(false);
    recognition.onerror = () => {
      setListening(false);
      setError('Voice recording failed. Type the request or try again.');
    };
    recognition.onresult = (event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => {
      const transcript = event.results?.[0]?.[0]?.transcript || '';
      setCommand(transcript);
      setNotice('Voice command transcribed. Review it, then ask the employee to plan the work.');
    };
    recognition.start();
  }

  function startTeamVoice() {
    const SpeechRecognition = (window as unknown as { SpeechRecognition?: new () => any; webkitSpeechRecognition?: new () => any }).SpeechRecognition || (window as unknown as { webkitSpeechRecognition?: new () => any }).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setError('Voice input is not supported in this browser. Type the team command instead.');
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = speechRecognitionLocale(aiLanguage);
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => setTeamListening(true);
    recognition.onend = () => setTeamListening(false);
    recognition.onerror = () => {
      setTeamListening(false);
      setError('Voice recording failed. Type the command or try again.');
    };
    recognition.onresult = (event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => {
      const transcript = event.results?.[0]?.[0]?.transcript || '';
      setTeamCommand(transcript);
      setNotice('Voice command transcribed. Review it, then route it to the AI team.');
    };
    recognition.start();
  }

  async function routeTeamCommand(source: 'voice' | 'text' = 'text') {
    if (!teamCommand.trim()) return;
    setBusy('team-route');
    setError('');
    try {
      const plan = await api<TeamRouterPlan>('/api/team-router/route', { method: 'POST', body: JSON.stringify({ command: teamCommand, transcript_source: source }) });
      setTeamPlan(plan);
      const dashboard = await loadTeam();
      if (!dashboard.current_plan) setTeamPlan(plan);
      setNotice(`${plan.primary_employee} Employee is leading. ${plan.assigned_employees.join(', ')} received subtasks for approval.`);
    } catch (nextError) {
      setError(friendlyErrorMessage(nextError, 'AI Team Router could not classify this command. Please simplify the request and try again.'));
    } finally { setBusy(''); }
  }

  async function decideTeamPlan(action: 'approve' | 'cancel') {
    if (!teamPlan) return;
    setBusy(`team-${action}`);
    setError('');
    try {
      const plan = await api<TeamRouterPlan>('/api/team-router/approve', { method: 'POST', body: JSON.stringify({ plan_id: teamPlan.id, action }) });
      setTeamPlan(plan);
      const dashboard = await loadTeam();
      if (!dashboard.current_plan) setTeamPlan(plan);
      setNotice(action === 'approve' ? 'Team plan approved. Execution remains internal and safety-gated.' : 'Team plan cancelled.');
    } catch (nextError) {
      setError(friendlyErrorMessage(nextError, 'Team plan decision could not be saved. Please try again.'));
    } finally { setBusy(''); }
  }

  async function executeTeamPlan() {
    if (!teamPlan) return;
    setBusy('team-execute');
    setError('');
    try {
      const plan = await api<TeamRouterPlan>('/api/team-router/execute', { method: 'POST', body: JSON.stringify({ plan_id: teamPlan.id, action: 'approve' }) });
      setTeamPlan(plan);
      const dashboard = await loadTeam();
      if (!dashboard.current_plan) setTeamPlan(plan);
      setNotice('AI team finished internal work. No email, campaign, CRM change, or deletion was performed automatically.');
    } catch (nextError) {
      setError(friendlyErrorMessage(nextError, 'Team execution could not be completed. No external action was performed.'));
    } finally { setBusy(''); }
  }

  async function createPlan(source: 'voice' | 'text' = 'text') {
    if (!employeeId || !command.trim()) return;
    setBusy('plan');
    setError('');
    try {
      const plan = await api<SalesEmployeeTaskPlan>(`/api/sales-employees/${employeeId}/plan`, { method: 'POST', body: JSON.stringify({ command, transcript_source: source }) });
      setTaskPlan(plan);
      await loadEmployeeContext(employeeId);
      setNotice(`${selectedEmployee?.name || 'Your AI employee'} prepared a plan and is waiting for approval.`);
    } catch (nextError) {
      setError(friendlyErrorMessage(nextError, 'Planning could not be completed. Please try again.'));
    } finally { setBusy(''); }
  }

  async function decidePlan(action: 'approve' | 'cancel') {
    if (!employeeId || !taskPlan) return;
    setBusy(action);
    setError('');
    try {
      const plan = await api<SalesEmployeeTaskPlan>(`/api/sales-employees/${employeeId}/approve-plan`, { method: 'POST', body: JSON.stringify({ plan_id: taskPlan.id, action }) });
      setTaskPlan(plan);
      await loadEmployeeContext(employeeId);
      setNotice(action === 'approve' ? 'Plan approved. The employee can execute the safe workflow now.' : 'Plan cancelled.');
    } catch (nextError) {
      setError(friendlyErrorMessage(nextError, 'Plan decision could not be saved. Please try again.'));
    } finally { setBusy(''); }
  }

  async function executePlan() {
    if (!employeeId || !taskPlan) return;
    setBusy('execute');
    setError('');
    try {
      const plan = await api<SalesEmployeeTaskPlan>(`/api/sales-employees/${employeeId}/execute-plan`, { method: 'POST', body: JSON.stringify({ plan_id: taskPlan.id, action: 'approve' }) });
      setTaskPlan(plan);
      await Promise.all([loadLeads(employeeId), loadEmployeeContext(employeeId)]);
      setNotice('Execution finished. No emails were sent and no campaign was launched without approval.');
    } catch (nextError) {
      setError(friendlyErrorMessage(nextError, 'Execution could not be completed. No emails were sent.'));
    } finally { setBusy(''); }
  }

  async function importManual(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!employeeId) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy('manual');
    try {
      const imported = await api<Lead[]>(`/api/sales-employees/${employeeId}/leads/manual`, { method: 'POST', body: JSON.stringify({ companies: [{ company: data.get('company'), website: data.get('website') || null, industry: data.get('industry') || null, country: data.get('country') || null, contact: data.get('contact') || null, email: data.get('email') || null, status: 'New' }] }) });
      setLeads((items) => [...imported, ...items.filter((item) => !imported.some((lead) => lead.id === item.id))]);
      setNotice(`Imported ${imported.length} lead.`);
      form.reset();
    } catch (nextError) {
      setError(friendlyErrorMessage(nextError, 'Manual import could not be completed. Please check the company details.'));
    } finally { setBusy(''); }
  }

  async function importText(path: 'websites' | 'google-maps', field: 'websites' | 'export_text', event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!employeeId) return;
    const data = new FormData(event.currentTarget);
    setBusy(path);
    try {
      const imported = await api<Lead[]>(`/api/sales-employees/${employeeId}/leads/${path}`, { method: 'POST', body: JSON.stringify({ [field]: data.get(field) }) });
      setLeads((items) => [...imported, ...items.filter((item) => !imported.some((lead) => lead.id === item.id))]);
      setNotice(`Imported ${imported.length} leads.`);
    } catch (nextError) {
      setError(friendlyErrorMessage(nextError, 'Import could not be completed. Please review the list and try again.'));
    } finally { setBusy(''); }
  }

  async function qualify(lead: Lead) {
    if (!employeeId || !lead.id) return;
    setBusy(`qualify-${lead.id}`);
    try {
      const insight = await api<SalesEmployeeLeadInsight>(`/api/sales-employees/${employeeId}/leads/${lead.id}/qualify`, { method: 'POST' });
      setInsights((items) => ({ ...items, [lead.id as string]: insight }));
      setNotice(`${lead.company} qualified: ICP ${insight.icp_score}/100.`);
    } catch (nextError) {
      setError(friendlyErrorMessage(nextError, 'Qualification could not be completed. Please try again.'));
    } finally { setBusy(''); }
  }

  async function draft(lead: Lead) {
    if (!employeeId || !lead.id) return;
    setBusy(`draft-${lead.id}`);
    try {
      const email = await api<Email>(`/api/sales-employees/${employeeId}/leads/${lead.id}/draft-email`, { method: 'POST' });
      setEmails((items) => ({ ...items, [lead.id as string]: email }));
      setNotice(email.delivery_status === 'pending_approval' ? 'Draft created for approval.' : 'Draft created for automation.');
    } catch (nextError) {
      setError(friendlyErrorMessage(nextError, 'Draft could not be created. Please try again.'));
    } finally { setBusy(''); }
  }

  async function approve(lead: Lead) {
    const email = lead.id ? emails[lead.id] : undefined;
    if (!employeeId || !lead.id || !email) return;
    setBusy(`approve-${lead.id}`);
    try {
      const approved = await api<Email>(`/api/sales-employees/${employeeId}/emails/${email.id}/approve`, { method: 'POST' });
      setEmails((items) => ({ ...items, [lead.id as string]: approved }));
      setNotice('Email approved.');
    } catch (nextError) {
      setError(friendlyErrorMessage(nextError, 'Approval could not be saved. Please try again.'));
    } finally { setBusy(''); }
  }

  async function runEmployee() {
    if (!employeeId) return;
    setBusy('run');
    try {
      const result = await api<SalesEmployeeRun>(`/api/sales-employees/${employeeId}/run`, { method: 'POST' });
      setRunResult(result);
      await Promise.all([loadLeads(employeeId), loadEmployeeContext(employeeId)]);
      setNotice(`Run complete: ${result.leads_qualified} qualified, ${result.emails_generated} drafted, ${result.emails_sent} sent.`);
    } catch (nextError) {
      setError(friendlyErrorMessage(nextError, 'Employee run could not be completed. No unapproved external action was performed.'));
    } finally { setBusy(''); }
  }

  const selectedEmployee = employees.find((employee) => employee.id === employeeId);

  if (simpleExperience) {
    return <div className="min-w-0 space-y-6">
      <header className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-sm font-semibold text-brand">Step 4 of 4</p>
        <h1 className="mt-2 text-2xl font-bold min-[390px]:text-3xl">AI Employees</h1>
        <p className="mt-2 max-w-2xl text-slate-600">Give one clear instruction. The AI prepares work and waits for your approval before anything external happens.</p>
        <a href="#give-work" className="focus-ring mt-5 inline-flex min-h-11 items-center justify-center rounded-md bg-ink px-5 py-2 text-sm font-semibold text-white">Give work</a>
      </header>
      {error && <Notice message={error} kind="error" />}
      {notice && <Notice message={notice} />}
      {loading ? <Skeleton lines={4} /> : <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <section className="space-y-4">
          <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-xl font-bold text-ink">Your sales employee</h2>
            <p className="mt-1 text-sm text-slate-600">Start with one employee in Review Mode. You stay in control.</p>
            {employees.length ? <div className="mt-4 space-y-3">{employees.slice(0, 3).map((employee) => <button key={employee.id} onClick={() => { setEmployeeId(employee.id); setTaskPlan(null); void Promise.all([loadLeads(employee.id), loadEmployeeContext(employee.id)]); }} className={`w-full rounded-md border p-4 text-left ${employeeId === employee.id ? 'border-brand bg-teal-50' : 'border-slate-200'}`}><div className="flex items-start justify-between gap-3"><div><p className="font-semibold text-ink">{employee.name}</p><p className="mt-1 text-sm text-slate-500">{employee.product_service || employee.role}</p></div><span className="rounded-full bg-white px-2 py-1 text-xs font-semibold">{employee.sending_mode}</span></div><p className="mt-3 text-sm text-slate-600">{employee.pending_approval} items waiting for review · {employee.leads} leads</p></button>)}</div> : <form onSubmit={createEmployee} className="mt-4 space-y-3"><input required name="name" placeholder="Employee name" className="w-full rounded-md border border-slate-300 px-3 py-3" /><input name="product_service" placeholder="What should they sell?" className="w-full rounded-md border border-slate-300 px-3 py-3" /><input name="target_customer" placeholder="Who is the target customer?" className="w-full rounded-md border border-slate-300 px-3 py-3" /><input type="hidden" name="role" value="AI Sales Development Representative" /><input type="hidden" name="target_countries" /><input type="hidden" name="target_industries" /><input type="hidden" name="sending_mode" value="Review Mode" /><input type="hidden" name="daily_limit" value="25" /><input type="hidden" name="working_hours" value="09:00-17:00" /><input type="hidden" name="tone" value="Professional" /><input type="hidden" name="language" value={aiLanguage} /><input type="hidden" name="offer" /><input type="hidden" name="cta" value="Book a quick call" /><input type="hidden" name="signature" /><button disabled={busy === 'create'} className="min-h-11 w-full rounded-md bg-brand px-4 font-semibold text-white">Create employee</button></form>}
          </div>
          <RecentTaskReports tasks={memory?.previous_tasks || []} />
        </section>
        <section id="give-work" className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-xl font-bold text-ink">What should your employee do?</h2>
          <p className="mt-1 text-sm text-slate-600">Use plain language, for example: “Find 20 construction companies in Berlin and prepare outreach.”</p>
          <textarea value={command} onChange={(event) => setCommand(event.target.value)} placeholder="Find 20 construction companies in Berlin and prepare outreach." className="mt-4 min-h-32 w-full rounded-md border border-slate-300 p-3" />
          <div className="mt-3 flex flex-col gap-2 min-[430px]:flex-row"><button type="button" onClick={startVoice} disabled={!employeeId || listening} className="min-h-11 rounded-md border border-slate-300 px-4 font-semibold"><Mic size={18} className="mr-2 inline" />{listening ? 'Listening' : 'Record voice'}</button><button onClick={() => createPlan(listening ? 'voice' : 'text')} disabled={!employeeId || !command.trim() || busy === 'plan'} className="focus-ring min-h-11 rounded-md bg-ink px-4 font-semibold text-white disabled:opacity-60">{busy === 'plan' ? 'Planning...' : 'Create plan'}</button></div>
          {taskPlan ? <div className="mt-5 rounded-lg border border-teal-200 bg-teal-50 p-4"><p className="text-sm font-semibold text-brand">Plan ready for review</p><h3 className="mt-1 text-xl font-bold text-ink">{taskPlan.goal}</h3><p className="mt-2 text-sm text-slate-700">{taskPlan.expected_result}</p><ol className="mt-4 space-y-2 text-sm">{taskPlan.steps.slice(0, 5).map((step, index) => <li key={`${step}-${index}`} className="rounded-md bg-white p-3"><span className="font-semibold">{index + 1}. </span>{step}</li>)}</ol><div className="mt-4 grid gap-2 min-[430px]:grid-cols-2">{taskPlan.status === 'waiting_approval' && <><button onClick={() => decidePlan('approve')} className="min-h-11 rounded-md bg-brand px-4 font-semibold text-white">Approve plan</button><button onClick={() => decidePlan('cancel')} className="min-h-11 rounded-md border border-slate-300 px-4 font-semibold">Cancel</button></>}{taskPlan.status === 'approved' && <button onClick={executePlan} className="min-h-11 rounded-md bg-ink px-4 font-semibold text-white">Run approved work</button>}</div></div> : <div className="mt-5 rounded-md border border-dashed border-slate-300 p-4 text-sm text-slate-600">Your AI employee will show a plan here before doing any work.</div>}
        </section>
      </div>}
    </div>;
  }

  return <div className="min-w-0"><div className="flex flex-col gap-3 min-[430px]:flex-row min-[430px]:items-start min-[430px]:justify-between"><div><h1 className="text-2xl font-bold min-[390px]:text-3xl">AI Employees</h1><p className="mt-2 text-slate-600">Route one command to Sales, Marketing, Support, and Operations employees. Every external action requires approval.</p></div><button onClick={runEmployee} disabled={!employeeId || busy === 'run'} className="focus-ring inline-flex min-h-11 w-fit items-center justify-center gap-2 rounded-md bg-ink px-4 py-2 font-semibold text-white disabled:opacity-60">{busy === 'run' ? <Loader2 className="animate-spin" size={18} /> : <Brain size={18} />} Run reviewed queue</button></div>{error && <Notice message={error} kind="error" />}{notice && <Notice message={notice} />}{runResult && <Notice message={`Last run: ${runResult.mode}; ${runResult.emails_sent} sent; ${runResult.blocked.length} blocked.`} kind={runResult.blocked.length ? 'warning' : 'success'} />}<section className="mt-6 rounded-lg border border-slate-200 bg-white p-4 shadow-sm min-[390px]:p-5"><div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between"><div><h2 className="text-xl font-bold">AI Team Router</h2><p className="mt-1 text-sm text-slate-600">Type or record one instruction. OutreachAI classifies intent, assigns employees, splits subtasks, and waits for approval.</p></div><span className="w-fit rounded-full bg-teal-50 px-3 py-1 text-xs font-semibold text-brand">Review-first safety</span></div><div className="mt-4 grid gap-3 min-[430px]:grid-cols-[1fr_auto]"><textarea value={teamCommand} onChange={(event) => setTeamCommand(event.target.value)} placeholder="Find construction companies in Germany and prepare outreach. Create LinkedIn posts for my SaaS. Summarize customer replies." className="min-h-28 rounded-md border border-slate-300 p-3" /><button type="button" onClick={startTeamVoice} disabled={teamListening} className="focus-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-slate-300 px-4 py-2 font-semibold"><Mic size={18} /> {teamListening ? 'Listening' : 'Record'}</button></div><div className="mt-3 flex flex-wrap gap-2"><button onClick={() => routeTeamCommand(teamListening ? 'voice' : 'text')} disabled={!teamCommand.trim() || busy === 'team-route'} className="focus-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-ink px-4 py-2 font-semibold text-white disabled:opacity-60">{busy === 'team-route' ? <Loader2 className="animate-spin" size={18} /> : <Sparkles size={18} />} Route command</button></div>{teamPlan && <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4"><div className="flex flex-col gap-2 min-[430px]:flex-row min-[430px]:items-start min-[430px]:justify-between"><div><p className="text-sm font-semibold text-brand">Detected intent · {teamPlan.detected_intent}</p><h3 className="mt-1 text-xl font-bold">{teamPlan.primary_employee} Employee leads</h3><p className="mt-1 text-sm text-slate-600">{teamPlan.assigned_employees.join(', ')} · {teamPlan.priority} · {teamPlan.risk_level} risk · {teamPlan.estimated_execution_time}</p></div><span className="w-fit rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-700">{teamPlan.required_approval ? 'Approval required' : 'Internal only'}</span></div><div className="mt-4 grid gap-3 lg:grid-cols-2">{teamPlan.subtasks.map((subtask) => <article key={subtask.id} className="rounded-md bg-white p-3 text-sm"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold">{subtask.employee}: {subtask.title}</p><p className="mt-1 text-slate-600">{subtask.objective}</p></div><span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold">{subtask.status}</span></div><p className="mt-2 text-slate-500">Tools: {subtask.required_tools.join(', ') || 'Workspace context'} · Risk: {subtask.risk_level}</p>{subtask.result && <p className="mt-2 rounded-md bg-teal-50 p-2 text-brand">{subtask.result}</p>}</article>)}</div><div className="mt-4 rounded-md bg-white p-3 text-sm"><p className="font-semibold">Safety</p><p className="mt-1 text-slate-600">{teamPlan.safety_notes.join(' ')}</p></div><div className="mt-4 flex flex-wrap gap-2">{teamPlan.status === 'waiting_approval' && <><button onClick={() => decideTeamPlan('approve')} disabled={busy === 'team-approve'} className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-md bg-brand px-4 py-2 font-semibold text-white"><Check size={18} /> Approve team plan</button><button onClick={() => decideTeamPlan('cancel')} disabled={busy === 'team-cancel'} className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-md border border-slate-300 px-4 py-2 font-semibold"><X size={18} /> Cancel</button></>}{teamPlan.status === 'approved' && <button onClick={executeTeamPlan} disabled={busy === 'team-execute'} className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-md bg-ink px-4 py-2 font-semibold text-white">{busy === 'team-execute' ? <Loader2 className="animate-spin" size={18} /> : <Play size={18} />} Execute approved internal work</button>}</div>{teamPlan.progress.length > 0 && <div className="mt-4 grid gap-2 md:grid-cols-3">{teamPlan.progress.map((item, index) => <div key={`${item}-${index}`} className="flex items-center gap-2 rounded-md bg-white px-3 py-2 text-sm"><CheckCircle2 size={16} className="text-brand" /> {item}</div>)}</div>}</div>}</section><section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">{(team?.employees || []).map((employee) => <article key={employee.employee} className="rounded-lg border border-slate-200 bg-white p-4"><div className="flex items-start justify-between gap-3"><div><h2 className="font-bold">{employee.employee} Employee</h2><p className="mt-1 text-sm text-slate-500">{employee.role}</p></div><span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold capitalize">{employee.status}</span></div><dl className="mt-4 grid grid-cols-3 gap-2 text-sm"><div><dt className="text-slate-500">Active</dt><dd className="text-xl font-bold">{employee.active_tasks}</dd></div><div><dt className="text-slate-500">Done</dt><dd className="text-xl font-bold">{employee.completed_tasks}</dd></div><div><dt className="text-slate-500">Score</dt><dd className="text-xl font-bold">{employee.performance}%</dd></div></dl><p className="mt-3 line-clamp-2 text-sm text-slate-600">{employee.last_activity}</p>{employee.results.length > 0 && <p className="mt-3 rounded-md bg-teal-50 p-2 text-sm text-brand">{employee.results[employee.results.length - 1]}</p>}</article>)}</section>{loading ? <div className="mt-6"><Skeleton lines={5} /></div> : <div className="mt-6 grid gap-6 xl:grid-cols-[0.9fr_1.1fr]"><section className="space-y-4"><form onSubmit={createEmployee} className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2"><h2 className="font-bold sm:col-span-2">Hire AI Sales Employee</h2><input required name="name" placeholder="Name" className="rounded-md border border-slate-300 px-3 py-2" /><input name="role" defaultValue="AI Sales Development Representative" placeholder="Role" className="rounded-md border border-slate-300 px-3 py-2" /><textarea name="product_service" placeholder="Product/service it sells" className="min-h-24 rounded-md border border-slate-300 p-3 sm:col-span-2" /><input name="target_customer" placeholder="Target customer" className="rounded-md border border-slate-300 px-3 py-2" /><input name="target_countries" placeholder="Target countries" className="rounded-md border border-slate-300 px-3 py-2" /><input name="target_industries" placeholder="Target industries" className="rounded-md border border-slate-300 px-3 py-2" /><select name="sending_mode" defaultValue="Review Mode" className="rounded-md border border-slate-300 px-3 py-2">{salesModes.map((mode) => <option key={mode}>{mode}</option>)}</select><textarea name="offer" placeholder="Offer" className="min-h-20 rounded-md border border-slate-300 p-3 sm:col-span-2" /><input name="cta" defaultValue="Book a quick call" placeholder="CTA" className="rounded-md border border-slate-300 px-3 py-2" /><input name="daily_limit" type="number" min="1" max="250" defaultValue="25" className="rounded-md border border-slate-300 px-3 py-2" /><input name="working_hours" defaultValue="09:00-17:00" className="rounded-md border border-slate-300 px-3 py-2" /><select name="tone" className="rounded-md border border-slate-300 px-3 py-2">{tones.map((tone) => <option key={tone}>{tone}</option>)}</select><input name="language" defaultValue={aiLanguage} className="rounded-md border border-slate-300 px-3 py-2" /><textarea name="signature" placeholder="Signature" className="min-h-20 rounded-md border border-slate-300 p-3 sm:col-span-2" /><button disabled={busy === 'create'} className="focus-ring min-h-11 rounded-md bg-brand px-4 py-2 font-semibold text-white sm:col-span-2">Create AI Sales Employee</button></form><section className="rounded-lg border border-slate-200 bg-white p-4"><h2 className="font-bold">Team</h2>{employees.length ? <div className="mt-4 space-y-3">{employees.map((employee) => <button key={employee.id} onClick={() => { setEmployeeId(employee.id); setTaskPlan(null); void Promise.all([loadLeads(employee.id), loadEmployeeContext(employee.id)]); }} className={`w-full rounded-md border p-3 text-left ${employeeId === employee.id ? 'border-brand bg-teal-50' : 'border-slate-200'}`}><div className="flex items-start justify-between gap-3"><div><p className="font-semibold">{employee.name}</p><p className="text-sm text-slate-500">{employee.role}</p></div><span className="rounded-full bg-white px-2 py-1 text-xs font-semibold">{employee.sending_mode}</span></div><dl className="mt-3 grid grid-cols-4 gap-2 text-xs"><div><dt className="text-slate-500">Leads</dt><dd className="font-bold">{employee.leads}</dd></div><div><dt className="text-slate-500">Review</dt><dd className="font-bold">{employee.pending_approval}</dd></div><div><dt className="text-slate-500">Sent</dt><dd className="font-bold">{employee.sent}</dd></div><div><dt className="text-slate-500">Limit</dt><dd className="font-bold">{employee.daily_limit}</dd></div></dl></button>)}</div> : <EmptyState title="No employees" copy="Create one to start a safe AI sales workflow." />}</section><section className="rounded-lg border border-slate-200 bg-white p-4"><h2 className="font-bold">Performance</h2><div className="mt-4 grid grid-cols-2 gap-3 text-sm"><div className="rounded-md bg-slate-50 p-3"><p className="text-slate-500">Tasks</p><p className="text-xl font-bold">{performance?.tasks_completed || 0}</p></div><div className="rounded-md bg-slate-50 p-3"><p className="text-slate-500">Success</p><p className="text-xl font-bold">{performance?.success_rate || 0}%</p></div><div className="rounded-md bg-slate-50 p-3"><p className="text-slate-500">Reply</p><p className="text-xl font-bold">{performance?.reply_rate || 0}%</p></div><div className="rounded-md bg-slate-50 p-3"><p className="text-slate-500">Meetings</p><p className="text-xl font-bold">{performance?.meeting_rate || 0}%</p></div><div className="rounded-md bg-slate-50 p-3"><p className="text-slate-500">Revenue</p><p className="text-xl font-bold">€{metricNumber(performance?.revenue_influence).toLocaleString()}</p></div><div className="rounded-md bg-slate-50 p-3"><p className="text-slate-500">Time saved</p><p className="text-xl font-bold">{performance?.time_saved_hours || 0}h</p></div></div></section></section><section className="space-y-6"><div className="rounded-lg border border-slate-200 bg-white p-4"><h2 className="font-bold">Give work to {selectedEmployee?.name || 'your AI employee'}</h2><p className="mt-1 text-sm text-slate-500">Voice or type a sales task. The employee will understand the intent, build a plan, and wait for approval before external actions.</p><div className="mt-4 grid gap-3 min-[430px]:grid-cols-[1fr_auto]"><textarea value={command} onChange={(event) => setCommand(event.target.value)} placeholder="Find construction companies in Germany. Create an email campaign. Analyse my last campaign." className="min-h-28 rounded-md border border-slate-300 p-3" /><button type="button" onClick={startVoice} disabled={!employeeId || listening} className="focus-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-slate-300 px-4 py-2 font-semibold"><Mic size={18} /> {listening ? 'Listening' : 'Record'}</button></div><div className="mt-3 flex flex-wrap gap-2"><button onClick={() => createPlan(listening ? 'voice' : 'text')} disabled={!employeeId || !command.trim() || busy === 'plan'} className="focus-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-ink px-4 py-2 font-semibold text-white disabled:opacity-60">{busy === 'plan' ? <Loader2 className="animate-spin" size={18} /> : <Brain size={18} />} Build execution plan</button></div>{taskPlan && <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4"><div className="flex flex-col gap-2 min-[430px]:flex-row min-[430px]:items-start min-[430px]:justify-between"><div><p className="text-sm font-semibold text-brand">Current task · {taskPlan.status}</p><h3 className="mt-1 text-xl font-bold">{taskPlan.goal}</h3><p className="mt-1 text-sm text-slate-600">{taskPlan.intent} · {taskPlan.priority} priority · {taskPlan.estimated_execution_time}</p></div><span className="w-fit rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-700">{taskPlan.requires_approval ? 'Approval required' : 'Review first'}</span></div><p className="mt-3 text-sm text-slate-600">{taskPlan.expected_result}</p><ol className="mt-4 space-y-2 text-sm">{taskPlan.steps.map((step, index) => <li key={`${step}-${index}`} className="rounded-md bg-white p-3"><span className="font-semibold">{index + 1}. </span>{step}</li>)}</ol><div className="mt-4 grid gap-3 md:grid-cols-2"><div className="rounded-md bg-white p-3 text-sm"><p className="font-semibold">Required tools</p><p className="mt-1 text-slate-600">{taskPlan.required_tools.join(', ') || 'None'}</p></div><div className="rounded-md bg-white p-3 text-sm"><p className="font-semibold">Safety</p><p className="mt-1 text-slate-600">{taskPlan.safety_notes.join(' ')}</p></div></div><div className="mt-4 flex flex-wrap gap-2">{taskPlan.status === 'waiting_approval' && <><button onClick={() => decidePlan('approve')} disabled={busy === 'approve'} className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-md bg-brand px-4 py-2 font-semibold text-white"><Check size={18} /> Approve</button><button onClick={() => decidePlan('cancel')} disabled={busy === 'cancel'} className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-md border border-slate-300 px-4 py-2 font-semibold"><X size={18} /> Cancel</button></>}{taskPlan.status === 'approved' && <button onClick={executePlan} disabled={busy === 'execute'} className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-md bg-ink px-4 py-2 font-semibold text-white">{busy === 'execute' ? <Loader2 className="animate-spin" size={18} /> : <Play size={18} />} Execute approved plan</button>}</div>{taskPlan.progress.length > 0 && <div className="mt-4 space-y-2">{taskPlan.progress.map((item, index) => <div key={`${item}-${index}`} className="flex items-center gap-2 rounded-md bg-white px-3 py-2 text-sm"><CheckCircle2 size={16} className="text-brand" /> {item}</div>)}</div>}</div>}</div><div className="rounded-lg border border-slate-200 bg-white p-4"><h2 className="font-bold">Memory</h2><div className="mt-4 grid gap-3 text-sm md:grid-cols-2"><div className="rounded-md bg-slate-50 p-3"><p className="font-semibold">Industries</p><p className="mt-1 text-slate-600">{memory?.industries.join(', ') || 'No pattern yet'}</p></div><div className="rounded-md bg-slate-50 p-3"><p className="font-semibold">Countries</p><p className="mt-1 text-slate-600">{memory?.countries.join(', ') || 'No pattern yet'}</p></div><div className="rounded-md bg-slate-50 p-3"><p className="font-semibold">Tone</p><p className="mt-1 text-slate-600">{memory?.preferred_tone || selectedEmployee?.tone || 'Professional'}</p></div><div className="rounded-md bg-slate-50 p-3"><p className="font-semibold">Preferences</p><p className="mt-1 text-slate-600">{memory?.customer_preferences.join(', ') || 'No preferences stored'}</p></div></div></div><div className="rounded-lg border border-slate-200 bg-white p-4"><h2 className="font-bold">Today&apos;s Results</h2><dl className="mt-4 grid grid-cols-2 gap-3 text-sm min-[430px]:grid-cols-4"><div className="rounded-md bg-slate-50 p-3"><dt className="text-slate-500">Leads Found</dt><dd className="text-xl font-bold">{selectedEmployee?.leads || 0}</dd></div><div className="rounded-md bg-slate-50 p-3"><dt className="text-slate-500">Emails Generated</dt><dd className="text-xl font-bold">{selectedEmployee?.pending_approval || 0}</dd></div><div className="rounded-md bg-slate-50 p-3"><dt className="text-slate-500">Meetings Booked</dt><dd className="text-xl font-bold">{performance?.meeting_rate ? Math.round(performance.meeting_rate) : 0}</dd></div><div className="rounded-md bg-slate-50 p-3"><dt className="text-slate-500">Revenue Generated</dt><dd className="text-xl font-bold">€{metricNumber(performance?.revenue_influence).toLocaleString()}</dd></div></dl></div><RecentTaskReports tasks={memory?.previous_tasks || []} /><div className="rounded-lg border border-slate-200 bg-white p-4"><h2 className="font-bold">Lead discovery</h2><p className="mt-1 text-sm text-slate-500">{selectedEmployee ? `${selectedEmployee.name} works in ${selectedEmployee.sending_mode}. Default mode is Review Mode.` : 'Create or select an employee first.'}</p><form onSubmit={importManual} className="mt-4 grid gap-3 md:grid-cols-2"><input required name="company" placeholder="Company" className="rounded-md border border-slate-300 px-3 py-2" /><input name="website" placeholder="Website" className="rounded-md border border-slate-300 px-3 py-2" /><input name="industry" placeholder="Industry" className="rounded-md border border-slate-300 px-3 py-2" /><input name="country" placeholder="Country" className="rounded-md border border-slate-300 px-3 py-2" /><input name="contact" placeholder="Contact" className="rounded-md border border-slate-300 px-3 py-2" /><input name="email" placeholder="Email" className="rounded-md border border-slate-300 px-3 py-2" /><button disabled={!employeeId || busy === 'manual'} className="focus-ring min-h-11 rounded-md bg-brand px-4 py-2 font-semibold text-white md:col-span-2">Add company manually</button></form><form onSubmit={(event) => importText('websites', 'websites', event)} className="mt-4 space-y-3"><textarea name="websites" placeholder="Paste one website per line" className="min-h-28 w-full rounded-md border border-slate-300 p-3" /><button disabled={!employeeId} className="focus-ring min-h-11 rounded-md border border-slate-300 px-4 py-2 font-semibold">Import website list</button></form><form onSubmit={(event) => importText('google-maps', 'export_text', event)} className="mt-4 space-y-3"><textarea name="export_text" placeholder="Paste Google Maps export rows" className="min-h-28 w-full rounded-md border border-slate-300 p-3" /><button disabled={!employeeId} className="focus-ring min-h-11 rounded-md border border-slate-300 px-4 py-2 font-semibold">Import Google Maps export</button></form><p className="mt-4 rounded-md bg-slate-50 p-3 text-sm text-slate-600">CSV import is supported for prepared lead lists. Apollo, Clay, and People Data Labs are planned integration sources and stay hidden until they are production-ready.</p></div><div className="rounded-lg border border-slate-200 bg-white p-4"><h2 className="font-bold">Employee leads</h2>{leads.length ? <div className="mt-4 space-y-3">{leads.map((lead) => { const insight = lead.id ? insights[lead.id] : undefined; const email = lead.id ? emails[lead.id] : undefined; return <article key={lead.id || lead.company} className="rounded-md border border-slate-200 p-3"><div className="flex flex-col gap-2 min-[430px]:flex-row min-[430px]:items-start min-[430px]:justify-between"><div><p className="font-semibold">{lead.company}</p><p className="break-all text-sm text-slate-500">{lead.email || lead.website || 'No contact yet'}</p></div><span className="w-fit rounded-full bg-teal-50 px-3 py-1 text-xs font-semibold text-brand">{lead.status}</span></div><div className="mt-3 flex flex-wrap gap-2"><button onClick={() => qualify(lead)} className="focus-ring min-h-11 rounded-md border border-slate-300 px-3 text-sm font-semibold">Qualify</button><button onClick={() => draft(lead)} className="focus-ring min-h-11 rounded-md border border-slate-300 px-3 text-sm font-semibold">Draft email</button>{email?.delivery_status === 'pending_approval' && <button onClick={() => approve(lead)} className="focus-ring min-h-11 rounded-md bg-brand px-3 text-sm font-semibold text-white">Approve</button>}</div>{insight && <div className="mt-3 grid gap-2 rounded-md bg-slate-50 p-3 text-sm min-[430px]:grid-cols-3"><div><p className="text-slate-500">ICP</p><p className="text-xl font-bold">{insight.icp_score}%</p></div><div><p className="text-slate-500">Purchase</p><p className="text-xl font-bold">{insight.purchase_probability}%</p></div><div><p className="text-slate-500">Plan</p><p className="text-xl font-bold">{insight.recommended_plan}</p></div><p className="min-[430px]:col-span-3"><span className="font-semibold">Angle:</span> {insight.best_sales_angle}</p><p className="min-[430px]:col-span-3"><span className="font-semibold">CTA:</span> {insight.best_cta}</p></div>}{email && <div className="mt-3 rounded-md bg-slate-50 p-3 text-sm"><p className="font-semibold">{email.subject}</p><p className="mt-1 text-slate-500">Status: {email.delivery_status}</p><p className="mt-2 line-clamp-3 text-slate-600">{email.body}</p></div>}</article>; })}</div> : <EmptyState title="No employee leads" copy="Add a company, paste websites, import Google Maps rows, or upload a prepared CSV list." />}</div></section></div>}</div>;
}

export function InboxAndActivity() {
  const { api, ready } = useTokenApi();
  const [activity, setActivity] = useState<Activity[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [inbox, setInbox] = useState<Email[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!ready) return;
    void Promise.resolve()
      .then(() => {
        setLoading(true);
        setError('');
        return Promise.all([api<Email[]>('/api/inbox'), api<Activity[]>('/api/activity'), api<Notification[]>('/api/notifications')]);
      })
      .then(([messages, a, n]) => { setInbox(messages); setActivity(a); setNotifications(n); })
      .catch((nextError) => setError(friendlyErrorMessage(nextError, 'Inbox data could not be loaded. Please refresh and try again.')))
      .finally(() => setLoading(false));
  }, [api, ready]);
  if (simpleExperience) {
    return <div className="min-w-0 space-y-6">
      <header className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-sm font-semibold text-brand">Replies</p>
        <h1 className="mt-2 text-2xl font-bold min-[390px]:text-3xl">Customer replies</h1>
        <p className="mt-2 max-w-2xl text-slate-600">When prospects answer your campaigns, their messages and recommended next steps appear here.</p>
        <Link href="/dashboard/campaigns" className="focus-ring mt-5 inline-flex min-h-11 items-center justify-center rounded-md bg-ink px-5 py-2 text-sm font-semibold text-white">Create a campaign</Link>
      </header>
      {error && <Notice message="Replies are temporarily unavailable. Your campaigns and leads are still safe." kind="warning" />}
      {loading ? <Skeleton lines={4} /> : <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-xl font-bold text-ink">Replies to review</h2>
        <p className="mt-1 text-sm text-slate-600">OutreachAI will classify replies and suggest a next action after your first campaign is live.</p>
        {inbox.length ? <div className="mt-5 space-y-3">{inbox.map((item) => <article key={item.id} className="rounded-md border border-slate-200 p-4">
          <div className="flex flex-col gap-2 min-[430px]:flex-row min-[430px]:items-start min-[430px]:justify-between">
            <p className="font-semibold text-ink">{item.subject}</p>
            <span className="w-fit rounded-full bg-teal-50 px-3 py-1 text-xs font-semibold text-brand">{String(item.tags?.category || item.delivery_status)}</span>
          </div>
          <p className="mt-2 text-sm text-slate-600">{item.preview || item.body}</p>
          {Boolean(item.reply_assistant?.next_step) && <p className="mt-3 rounded-md bg-slate-50 p-3 text-sm font-semibold text-ink">Next step: {String(item.reply_assistant?.next_step)}</p>}
        </article>)}</div> : <div className="mt-5 space-y-4 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-5">
          <div>
            <h3 className="font-bold text-ink">No replies yet</h3>
            <p className="mt-2 text-sm text-slate-600">Replies arrive after a campaign sends approved emails. Start with one small campaign, review the AI email, then approve it.</p>
          </div>
          <Link href="/dashboard/campaigns" className="inline-flex min-h-11 w-full items-center justify-center rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white min-[430px]:w-auto">Prepare campaign</Link>
        </div>}
      </section>}
      <details className="rounded-lg border border-slate-200 bg-white p-5">
        <summary className="cursor-pointer font-semibold text-ink">Activity log</summary>
        {activity.length ? <div className="mt-4 space-y-3">{activity.slice(0, 10).map((item) => <div key={item.id} className="rounded-md bg-slate-50 p-3 text-sm"><p className="font-semibold">{item.action.replaceAll('.', ' ')}</p><p className="text-slate-500">{new Date(item.created_at).toLocaleString()}</p></div>)}</div> : <p className="mt-4 rounded-md bg-slate-50 p-3 text-sm text-slate-600">Activity will appear after leads, emails, replies, or billing changes happen.</p>}
      </details>
    </div>;
  }
  return <div className="min-w-0"><h1 className="text-2xl font-bold min-[390px]:text-3xl">Unified Inbox</h1><p className="mt-2 text-slate-600">Replies, AI categories, notifications, tags, and activity events in one operational view.</p>{error && <Notice message={error} kind="error" />}{loading ? <div className="mt-6"><Skeleton lines={4} /></div> : <div className="mt-6 grid gap-6 lg:grid-cols-2"><section className="rounded-lg border border-slate-200 bg-white p-5 lg:col-span-2"><h2 className="font-bold">Replies</h2>{inbox.length ? <div className="mt-4 space-y-3">{inbox.map((item) => <article key={item.id} className="rounded-md bg-slate-50 p-3"><div className="flex flex-col gap-2 min-[430px]:flex-row min-[430px]:items-start min-[430px]:justify-between"><p className="font-semibold">{item.subject}</p><span className="w-fit rounded-full bg-white px-2 py-1 text-xs font-semibold">{String(item.tags?.category || item.delivery_status)}</span></div><p className="mt-2 text-sm text-slate-600">{item.preview || item.body}</p>{Boolean(item.reply_assistant?.next_step) && <p className="mt-2 text-xs font-semibold text-brand">Next step: {String(item.reply_assistant?.next_step)}</p>}</article>)}</div> : <EmptyState title="No replies yet" copy="Inbound replies will be categorized and routed here automatically." />}</section><section className="rounded-lg border border-slate-200 bg-white p-5"><h2 className="font-bold">Notifications</h2>{notifications.length ? <div className="mt-4 space-y-3">{notifications.map((item) => <div key={item.id} className="rounded-md bg-slate-50 p-3"><p className="font-semibold">{item.title}</p><p className="text-sm text-slate-500">{item.message}</p></div>)}</div> : <EmptyState title="No notifications" copy="Success, error, warning, and background job updates will appear here." />}</section><section className="rounded-lg border border-slate-200 bg-white p-5"><h2 className="font-bold">Activity</h2>{activity.length ? <div className="mt-4 space-y-3">{activity.map((item) => <div key={item.id} className="rounded-md bg-slate-50 p-3"><p className="font-semibold">{item.action.replaceAll('.', ' ')}</p><p className="text-sm text-slate-500">{new Date(item.created_at).toLocaleString()}</p></div>)}</div> : <EmptyState title="No activity" copy="Every campaign, lead, email, and reply action will be logged here." />}</section></div>}</div>;
}

export function SettingsAndProfile() {
  const { api, ready } = useTokenApi();
  const { aiLanguage } = useI18n();
  const [profile, setProfile] = useState<Profile>({ workspace: '', company: '', timezone: 'UTC', language: 'English' });
  const [settings, setSettings] = useState<Settings | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [plans, setPlans] = useState<BillingPlan[]>([]);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    if (!ready) return;
    Promise.all([api<Profile>('/api/profile'), api<Settings>('/api/settings'), api<Workspace>('/api/workspace'), api<BillingPlan[]>('/api/billing/plans'), api<Usage>('/api/billing/usage')])
      .then(([p, s, w, nextPlans, nextUsage]) => { setProfile(p); setSettings(s); setWorkspace(w); setPlans(Array.isArray(nextPlans) ? nextPlans : []); setUsage(nextUsage?.usage ? nextUsage : null); })
      .catch((nextError) => setNotice(friendlyErrorMessage(nextError, 'Settings could not be loaded. Please refresh and try again.')));
  }, [api, ready]);
  async function saveProfile(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const data = new FormData(event.currentTarget); const saved = await api<Profile>('/api/profile', { method: 'PUT', body: JSON.stringify({ workspace: data.get('workspace'), company: data.get('company'), avatar_url: data.get('avatar_url') || null, timezone: data.get('timezone'), language: aiLanguage }) }); setProfile(saved); setNotice('Workspace saved.'); }
  async function saveSettings() { if (!settings) return; await api<Settings>('/api/settings', { method: 'PUT', body: JSON.stringify(settings) }); setNotice('Settings saved.'); }
  const members = workspace?.members || [];
  if (simpleExperience) {
    return <div className="min-w-0 space-y-6">
      <header className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-sm font-semibold text-brand">Workspace setup</p>
        <h1 className="mt-2 text-2xl font-bold min-[390px]:text-3xl">Settings</h1>
        <p className="mt-2 max-w-2xl text-slate-600">Tell OutreachAI what company you represent so AI can write and target more accurately.</p>
        <button form="workspace-profile" className="focus-ring mt-5 inline-flex min-h-11 items-center justify-center rounded-md bg-ink px-5 py-2 text-sm font-semibold text-white">Save workspace</button>
      </header>
      {notice && <Notice message={notice} kind={notice.includes('could not') ? 'warning' : 'success'} />}
      {!settings ? <Skeleton lines={5} /> : <div className="grid gap-6 xl:grid-cols-[1fr_0.8fr]">
        <form id="workspace-profile" onSubmit={saveProfile} className="space-y-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div>
            <h2 className="text-xl font-bold text-ink">Company profile</h2>
            <p className="mt-1 text-sm text-slate-600">Keep this simple. You can improve it later after your first campaign.</p>
          </div>
          <label className="block"><span className="text-sm font-semibold text-slate-700">Workspace name</span><input name="workspace" value={profile.workspace} onChange={(e) => setProfile({ ...profile, workspace: e.target.value })} placeholder="OutreachAI workspace" className="mt-2 w-full rounded-md border border-slate-300 px-3 py-3" /></label>
          <label className="block"><span className="text-sm font-semibold text-slate-700">Company name</span><input name="company" value={profile.company} onChange={(e) => setProfile({ ...profile, company: e.target.value })} placeholder="Your company" className="mt-2 w-full rounded-md border border-slate-300 px-3 py-3" /></label>
          <label className="block"><span className="text-sm font-semibold text-slate-700">Timezone</span><input name="timezone" value={profile.timezone} onChange={(e) => setProfile({ ...profile, timezone: e.target.value })} placeholder="Europe/Warsaw" className="mt-2 w-full rounded-md border border-slate-300 px-3 py-3" /></label>
          <input type="hidden" name="avatar_url" value={profile.avatar_url || ''} />
          <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm font-semibold text-slate-700">Language</p>
            <p className="mt-1 text-sm text-slate-600">The selected language is used for the interface and AI employee replies.</p>
            <div className="mt-3"><LanguageSwitcher /></div>
          </div>
          <button className="focus-ring inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-brand px-4 py-2 font-semibold text-white"><CheckCircle2 size={18} /> Save workspace</button>
        </form>
        <aside className="space-y-6">
          <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-xl font-bold text-ink">Next step</h2>
            <p className="mt-2 text-sm text-slate-600">After saving your company, find one focused list of leads and create one campaign for review.</p>
            <Link href="/dashboard/leads" className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white">Find leads</Link>
          </section>
          <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-xl font-bold text-ink">Plan and usage</h2>
            {usage ? <div className="mt-4 grid gap-3 text-sm">
              <p className="rounded-md bg-slate-50 p-3">Leads used: <span className="font-semibold">{usage.usage.leads}/{usage.limits.leads}</span></p>
              <p className="rounded-md bg-slate-50 p-3">AI emails used: <span className="font-semibold">{usage.usage.ai_generations}/{usage.limits.ai_generations}</span></p>
              <p className="rounded-md bg-slate-50 p-3">Email sends used: <span className="font-semibold">{usage.usage.email_sends}/{usage.limits.email_sends}</span></p>
            </div> : <p className="mt-2 rounded-md bg-slate-50 p-3 text-sm text-slate-600">Usage appears after your first lead or campaign.</p>}
            <Link href="/dashboard/billing" className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-ink">Open billing</Link>
          </section>
          <details className="rounded-lg border border-slate-200 bg-white p-5">
            <summary className="cursor-pointer font-semibold text-ink">Advanced settings</summary>
            <div className="mt-4 space-y-4">
              <section className="rounded-md bg-slate-50 p-4">
                <h3 className="font-semibold">Team</h3>
                {members.length ? <div className="mt-3 space-y-2">{members.map((member) => <div key={member.id} className="flex items-center justify-between gap-3 rounded-md bg-white p-3 text-sm"><span className="break-all">{member.email || member.user_id}</span><span className="rounded-full bg-slate-100 px-2 py-1 font-semibold">{member.role}</span></div>)}</div> : <p className="mt-2 text-sm text-slate-600">Team members appear here after they accept an invitation.</p>}
              </section>
              <section className="rounded-md bg-red-50 p-4">
                <h3 className="font-semibold text-red-800">Account deletion</h3>
                <p className="mt-1 text-sm text-red-700">Use this only when you want the workspace owner to review account removal.</p>
                <button type="button" onClick={() => api('/api/profile', { method: 'DELETE' }).then(() => setNotice('Account deletion request queued.'))} className="focus-ring mt-3 min-h-11 w-full rounded-md border border-red-200 bg-white px-4 py-2 font-semibold text-red-700">Request deletion</button>
              </section>
            </div>
          </details>
        </aside>
      </div>}
    </div>;
  }
  return <div className="min-w-0">
    <h1 className="text-2xl font-bold min-[390px]:text-3xl">Settings</h1>
    <p className="mt-2 text-slate-600">Manage your profile, workspace, billing, language, and security preferences.</p>
    {notice && <Notice message={notice} />}
    {!settings ? <div className="mt-6"><Skeleton lines={5} /></div> : <div className="mt-6 grid gap-6 xl:grid-cols-[0.85fr_1.15fr]">
      <div className="space-y-6">
        <form onSubmit={saveProfile} className="space-y-3 rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="font-bold">Profile</h2>
          <input name="workspace" value={profile.workspace} onChange={(e) => setProfile({ ...profile, workspace: e.target.value })} placeholder="Workspace name" className="w-full rounded-md border border-slate-300 px-3 py-2" />
          <input name="company" value={profile.company} onChange={(e) => setProfile({ ...profile, company: e.target.value })} placeholder="Company name" className="w-full rounded-md border border-slate-300 px-3 py-2" />
          <input name="avatar_url" value={profile.avatar_url || ''} onChange={(e) => setProfile({ ...profile, avatar_url: e.target.value })} placeholder="Avatar URL" className="w-full rounded-md border border-slate-300 px-3 py-2" />
          <input name="timezone" value={profile.timezone} onChange={(e) => setProfile({ ...profile, timezone: e.target.value })} placeholder="Timezone" className="w-full rounded-md border border-slate-300 px-3 py-2" />
          <LanguageSwitcher />
          <button className="focus-ring inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-brand px-4 py-2 font-semibold text-white"><CheckCircle2 size={18} /> Save profile</button>
        </form>
        <section className="rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="font-bold">Organization</h2>
          <p className="mt-2 text-sm text-slate-600">{workspace?.company || workspace?.name || 'Workspace'} · {workspace?.industry || 'Industry not set'}</p>
          <div className="mt-4 space-y-2">{members.length ? members.map((member) => <div key={member.id} className="flex items-center justify-between gap-3 rounded-md bg-slate-50 p-3 text-sm"><span className="break-all">{member.email || member.user_id}</span><span className="rounded-full bg-white px-2 py-1 font-semibold">{member.role}</span></div>) : <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-500">Team members will appear here after they accept an invitation.</p>}</div>
        </section>
        <section className="rounded-lg border border-red-100 bg-white p-5">
          <h2 className="font-bold">Security</h2>
          <p className="mt-2 text-sm text-slate-600">Need to close the account? Submit a deletion request and the workspace owner will be notified.</p>
          <button type="button" onClick={() => api('/api/profile', { method: 'DELETE' }).then(() => setNotice('Account deletion request queued.'))} className="focus-ring mt-4 min-h-11 w-full rounded-md border border-red-200 px-4 py-2 font-semibold text-red-700">Request account deletion</button>
        </section>
      </div>
      <div className="space-y-6">
        <section className="rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="font-bold">Billing and usage</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-3">{plans.map((plan) => <div key={plan.name} className="rounded-md border border-slate-200 p-3"><div className="flex justify-between gap-3"><span className="font-semibold">{plan.name}</span><span>€{plan.price}/mo</span></div><p className="mt-1 text-sm text-slate-500">{plan.current ? 'Current plan' : `${plan.limits.leads} leads/month`}</p></div>)}</div>
          {usage && <div className="mt-4 grid gap-3 rounded-md bg-slate-50 p-3 text-sm md:grid-cols-3"><p>Leads: {usage.usage.leads}/{usage.limits.leads}</p><p>AI generations: {usage.usage.ai_generations}/{usage.limits.ai_generations}</p><p>Email sends: {usage.usage.email_sends}/{usage.limits.email_sends}</p></div>}
        </section>
        <section className="rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="font-bold">Workspace preferences</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {['General', 'AI', 'Email', 'Notifications', 'Billing', 'API', 'Security'].map((item) => <div key={item} className="rounded-md bg-slate-50 p-3 text-sm"><p className="font-semibold">{item}</p><p className="mt-1 text-slate-500">Configured for this workspace.</p></div>)}
          </div>
        </section>
        {showAdvancedSettings && <section className="rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="font-bold">Advanced settings</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2">{(Object.keys(settings) as Array<keyof Settings>).map((key) => <label key={key} className="block rounded-md border border-slate-200 p-3"><span className="text-sm font-semibold capitalize">{key}</span><textarea value={JSON.stringify(settings[key], null, 2)} onChange={(e) => { try { setSettings({ ...settings, [key]: JSON.parse(e.target.value) }); } catch {} }} className="mt-2 min-h-32 w-full rounded-md border border-slate-300 p-2 font-mono text-xs" /></label>)}</div>
          <button onClick={saveSettings} className="focus-ring mt-4 min-h-11 rounded-md bg-ink px-4 py-2 font-semibold text-white"><Save size={18} className="mr-2 inline" />Save advanced settings</button>
        </section>}
      </div>
    </div>}
  </div>;
}

export function AnalyticsReal() { return <DashboardHome />; }

export function AdminPanel() {
  const { api, ready } = useTokenApi();
  const [summary, setSummary] = useState<AdminSummary | null>(null);
  const [logs, setLogs] = useState<Activity[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!ready) return;
    Promise.all([api<AdminSummary>('/api/admin/summary'), api<Activity[]>('/api/admin/logs')])
      .then(([nextSummary, nextLogs]) => { setSummary(nextSummary); setLogs(nextLogs); })
      .catch((nextError) => setError(friendlyErrorMessage(nextError, 'Admin data could not be loaded. Please refresh and try again.')));
  }, [api, ready]);

  if (error) return <Notice message={error} kind="error" />;
  if (!summary) return <Skeleton lines={5} />;

  const cards = [
    ['Users', summary.users],
    ['Workspaces', summary.workspaces],
    ['Subscriptions', summary.subscriptions],
    ['Revenue', `$${summary.revenue.toLocaleString()}`],
    ['Leads used', summary.usage.leads],
    ['AI used', summary.usage.ai_generations],
    ['Emails sent', summary.usage.email_sends],
    ['API health', summary.system_health.api]
  ];

  return <div className="min-w-0"><h1 className="text-2xl font-bold min-[390px]:text-3xl">Admin Panel</h1><p className="mt-2 text-slate-600">Users, subscriptions, revenue, usage, system health, and operational logs.</p><div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{cards.map(([label, value]) => <section key={label} className="rounded-lg border border-slate-200 bg-white p-4"><p className="text-sm text-slate-500">{label}</p><p className="mt-2 text-2xl font-bold">{value}</p></section>)}</div><section className="mt-6 rounded-lg border border-slate-200 bg-white p-5"><h2 className="font-bold">System logs</h2>{logs.length ? <div className="mt-4 space-y-3">{logs.map((item) => <div key={item.id} className="rounded-md bg-slate-50 p-3 text-sm"><p className="font-semibold">{item.action.replaceAll('.', ' ')}</p><p className="text-slate-500">{new Date(item.created_at).toLocaleString()}</p></div>)}</div> : <EmptyState title="No logs" copy="Audit and activity logs will appear here as customers use the platform." />}</section></div>;
}

export function OnboardingFlow() {
  const { api, ready } = useTokenApi();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({ company: '', industry: '', target_country: '', target_customer: '', connect_openai: false, launch_first_campaign: false });
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (!ready) return;
    api<Workspace>('/api/onboarding').then((next) => {
      setWorkspace(next);
      setStep(next.onboarding_step || 1);
      setForm({ company: next.company, industry: next.industry, target_country: next.target_country, target_customer: next.target_customer, connect_openai: false, launch_first_campaign: next.onboarding_completed });
    }).catch((nextError) => setNotice(friendlyErrorMessage(nextError, 'Onboarding could not be loaded. Please refresh and try again.')));
  }, [api, ready]);

  async function save(nextStep: number) {
    const saved = await api<Workspace>('/api/onboarding', { method: 'PUT', body: JSON.stringify({ ...form, step: nextStep }) });
    setWorkspace(saved);
    setStep(nextStep);
    setNotice(saved.onboarding_completed ? 'Onboarding complete. Your first campaign can be launched from Campaigns.' : 'Progress saved.');
  }

  if (!workspace) return <div className="mx-auto max-w-3xl p-4"><Skeleton lines={5} /></div>;

  const steps = [
    { title: 'Company website', why: 'AI needs to understand what you sell before it can find the right customers.', next: 'OutreachAI will use your company context when preparing leads and emails.', time: 'About 30 seconds' },
    { title: 'Industry', why: 'This helps OutreachAI choose relevant sales angles and avoid generic outreach.', next: 'Your lead search will start from businesses that match this market.', time: 'About 20 seconds' },
    { title: 'Target country', why: 'A focused market gives cleaner lead results and easier campaign review.', next: 'Lead Finder will use this country as the default search area.', time: 'About 15 seconds' },
    { title: 'Target customer', why: 'AI writes better emails when it knows who the buyer is.', next: 'Campaign Builder will turn this into the first outreach angle.', time: 'About 30 seconds' },
    { title: 'AI connection', why: 'Production AI powers analysis, outreach drafts, and recommendations.', next: 'You can continue now and manage AI settings later if needed.', time: 'Optional' },
    { title: 'First campaign', why: 'The fastest path to value is one reviewed campaign with one focused audience.', next: 'After setup, create a campaign and approve the first email draft.', time: 'About 2 minutes' }
  ];
  const current = steps[step - 1] || steps[0];

  return <main className="mx-auto min-h-screen max-w-3xl px-4 py-8">
    <p className="text-sm font-semibold text-brand">Setup</p>
    <h1 className="mt-2 text-2xl font-bold min-[390px]:text-3xl">Set up OutreachAI</h1>
    <p className="mt-2 text-slate-600">Finish the basics, then create your first reviewed campaign. You can adjust everything later.</p>
    {notice && <Notice message={notice} /> }
    <section className="mt-6 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-5 grid gap-2 min-[430px]:grid-cols-3">
        {steps.map((item, index) => <button key={item.title} onClick={() => setStep(index + 1)} className={`min-h-11 rounded-md px-3 text-sm font-semibold ${step === index + 1 ? 'bg-brand text-white' : 'border border-slate-300 text-slate-700'}`}>{index + 1}. {item.title}</button>)}
      </div>
      <div className="rounded-lg bg-slate-50 p-4">
        <h2 className="text-xl font-bold text-ink">{current.title}</h2>
        <dl className="mt-4 grid gap-3 text-sm md:grid-cols-3">
          <div><dt className="font-semibold text-slate-700">Why</dt><dd className="mt-1 text-slate-600">{current.why}</dd></div>
          <div><dt className="font-semibold text-slate-700">What happens next</dt><dd className="mt-1 text-slate-600">{current.next}</dd></div>
          <div><dt className="font-semibold text-slate-700">Expected time</dt><dd className="mt-1 text-slate-600">{current.time}</dd></div>
        </dl>
      </div>
      <div className="mt-5">
        {step === 1 && <label className="block"><span className="font-semibold">Company website or name</span><input value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} placeholder="outreachaiaiai.com" className="mt-2 w-full rounded-md border border-slate-300 px-3 py-3" /></label>}
        {step === 2 && <label className="block"><span className="font-semibold">Industry</span><input value={form.industry} onChange={(e) => setForm({ ...form, industry: e.target.value })} placeholder="Construction, real estate, consulting..." className="mt-2 w-full rounded-md border border-slate-300 px-3 py-3" /></label>}
        {step === 3 && <label className="block"><span className="font-semibold">Target country</span><input value={form.target_country} onChange={(e) => setForm({ ...form, target_country: e.target.value })} placeholder="Germany" className="mt-2 w-full rounded-md border border-slate-300 px-3 py-3" /></label>}
        {step === 4 && <label className="block"><span className="font-semibold">Target customer</span><input value={form.target_customer} onChange={(e) => setForm({ ...form, target_customer: e.target.value })} placeholder="Construction company owners with 10-50 employees" className="mt-2 w-full rounded-md border border-slate-300 px-3 py-3" /></label>}
        {step === 5 && <label className="flex min-h-11 items-start gap-3 rounded-md border border-slate-200 p-4"><input type="checkbox" checked={form.connect_openai} onChange={(e) => setForm({ ...form, connect_openai: e.target.checked })} className="mt-1 size-5" /><span><span className="font-semibold">Use workspace AI settings</span><span className="mt-1 block text-sm text-slate-600">You can manage provider settings later. No customer action is sent automatically.</span></span></label>}
        {step === 6 && <label className="flex min-h-11 items-start gap-3 rounded-md border border-slate-200 p-4"><input type="checkbox" checked={form.launch_first_campaign} onChange={(e) => setForm({ ...form, launch_first_campaign: e.target.checked })} className="mt-1 size-5" /><span><span className="font-semibold">Prepare my first campaign</span><span className="mt-1 block text-sm text-slate-600">OutreachAI will guide you to Campaigns after setup. You still approve every email.</span></span></label>}
      </div>
      <div className="mt-6 grid gap-3 min-[430px]:grid-cols-2"><button onClick={() => save(Math.max(1, step - 1))} className="min-h-11 rounded-md border border-slate-300 px-4 font-semibold">Back</button><button onClick={() => save(Math.min(6, step + 1))} className="min-h-11 rounded-md bg-brand px-4 font-semibold text-white">{step === 6 ? 'Finish setup' : 'Continue'}</button></div>
    </section>
  </main>;
}
