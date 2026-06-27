'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { Bell, Brain, Check, CheckCircle2, ClipboardList, Loader2, Mic, Moon, Play, Plus, Save, Search, Send, Sparkles, Wand2, X } from 'lucide-react';
import { clientApi, splitList } from '@/lib/client-api';
import { hasClerkPublishableKey, isClerkE2EBypass } from '@/lib/env';
import type { Activity, AdminSummary, AISalesEmployee, BillingPlan, Campaign, CampaignAnalytics, DashboardMetrics, Email, FollowUpSequence, Lead, MeetingPrep, Notification, Profile, SalesCopilot, SalesEmployeeLeadInsight, SalesEmployeeMemory, SalesEmployeePerformance, SalesEmployeeRun, SalesEmployeeTaskPlan, Settings, Usage, WebsiteAudit, Workspace } from '@/lib/types';

const pipeline = ['New', 'Qualified', 'Contacted', 'Interested', 'Meeting', 'Won', 'Lost', 'Archive'];
const tones = ['Professional', 'Friendly', 'Direct', 'Consultative'];
const salesModes = ['Review Mode', 'Semi-Auto Mode', 'Autonomous Mode'];
const emptyMetrics: DashboardMetrics = { leads: 0, campaigns: 0, emails_sent: 0, delivered: 0, opened: 0, replies: 0, bounces: 0, open_rate: 0, reply_rate: 0, ctr: 0, conversion_rate: 0, meetings: 0, revenue: 0, revenue_forecast: 0, mrr: 0, arr: 0, revenue_series: [], funnel: [], pipeline: [], plan: 'Starter', usage: {} };
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

function metricNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function DashboardHome() {
  const { api, ready } = useTokenApi();
  const [metrics, setMetrics] = useState<DashboardMetrics>(emptyMetrics);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [darkMode, setDarkMode] = useState(false);

  useEffect(() => { document.documentElement.classList.toggle('dark', darkMode); }, [darkMode]);

  useEffect(() => {
    if (!ready) return;
    void Promise.resolve()
      .then(() => {
        setLoading(true);
        setError('');
        return Promise.all([api<DashboardMetrics>('/api/dashboard'), api<Activity[]>('/api/activity'), api<Notification[]>('/api/notifications')]);
      })
      .then(([nextMetrics, nextActivity, nextNotifications]) => { setMetrics(nextMetrics); setActivity(nextActivity); setNotifications(nextNotifications); })
      .catch((nextError) => setError(nextError instanceof Error ? nextError.message : 'Dashboard data could not be loaded.'))
      .finally(() => setLoading(false));
  }, [api, ready]);

  const cards = [
    ['Leads', metrics.leads], ['Campaigns', metrics.campaigns], ['Emails sent', metrics.emails_sent], ['Delivered', metrics.delivered],
    ['Opened', metrics.opened], ['Replies', metrics.replies], ['Bounces', metrics.bounces], ['Open rate', `${metrics.open_rate}%`],
    ['Reply rate', `${metrics.reply_rate}%`], ['CTR', `${metrics.ctr}%`], ['Conversion', `${metrics.conversion_rate}%`], ['Meetings', metrics.meetings], ['Revenue', `€${metricNumber(metrics.revenue).toLocaleString()}`], ['Forecast', `€${metricNumber(metrics.revenue_forecast).toLocaleString()}`], ['MRR', `€${metricNumber(metrics.mrr).toLocaleString()}`], ['ARR', `€${metricNumber(metrics.arr).toLocaleString()}`], ['Plan', metrics.plan || 'Starter']
  ];

  const funnel = metrics.funnel || [];
  return <div className="min-w-0"><div className="flex flex-col gap-3 min-[430px]:flex-row min-[430px]:items-start min-[430px]:justify-between"><div><h1 className="text-2xl font-bold min-[390px]:text-3xl">Dashboard</h1><p className="mt-2 text-slate-600">Real workspace metrics from your campaigns, leads, email activity, and revenue pipeline.</p></div><button onClick={() => setDarkMode((value) => !value)} className="focus-ring inline-flex min-h-11 w-fit items-center gap-2 rounded-md border border-slate-300 px-3 text-sm font-semibold"><Moon size={16} /> {darkMode ? 'Light' : 'Dark'}</button></div>{error && <Notice message={error} kind="error" />}{loading ? <div className="mt-6"><Skeleton lines={5} /></div> : <><div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{cards.map(([label, value]) => <section key={label} className="rounded-lg border border-slate-200 bg-white p-4"><p className="text-sm text-slate-500">{label}</p><p className="mt-2 text-2xl font-bold">{value}</p></section>)}</div><div className="mt-8 grid gap-6 lg:grid-cols-3"><section className="rounded-lg border border-slate-200 bg-white p-5"><h2 className="font-bold">Conversion funnel</h2>{funnel.length ? <div className="mt-4 space-y-3">{funnel.map((item) => <div key={item.status}><div className="flex justify-between text-sm"><span>{item.status}</span><span className="font-semibold">{item.count}</span></div><div className="mt-1 h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-brand" style={{ width: `${Math.min(100, Math.max(8, metrics.leads ? item.count / metrics.leads * 100 : 0))}%` }} /></div></div>)}</div> : <EmptyState title="No funnel yet" copy="Leads will appear here as they move through the pipeline." />}</section><section className="rounded-lg border border-slate-200 bg-white p-5"><h2 className="font-bold">Activity timeline</h2>{activity.length ? <div className="mt-4 space-y-3">{activity.map((item) => <div key={item.id} className="rounded-md bg-slate-50 p-3 text-sm"><p className="font-semibold">{item.action.replaceAll('.', ' ')}</p><p className="text-slate-500">{new Date(item.created_at).toLocaleString()}</p></div>)}</div> : <EmptyState title="No activity yet" copy="Create a campaign, import leads, or generate an email to start the timeline." />}</section><section className="rounded-lg border border-slate-200 bg-white p-5"><h2 className="flex items-center gap-2 font-bold"><Bell size={18} /> Notifications</h2>{notifications.length ? <div className="mt-4 space-y-3">{notifications.map((item) => <div key={item.id} className="rounded-md bg-slate-50 p-3 text-sm"><p className="font-semibold">{item.title}</p><p className="text-slate-500">{item.message}</p></div>)}</div> : <EmptyState title="No notifications" copy="Background jobs and important account events will appear here." />}</section></div></>}</div>;
}

export function CampaignBuilder() {
  const { api, ready } = useTokenApi();
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

  const load = useCallback(() => {
    if (!ready) return;
    setLoading(true);
    Promise.all([api<Campaign[]>('/api/campaigns'), api<{ items: Lead[] }>('/api/leads?page_size=100')])
      .then(([c, l]) => { setCampaigns(c); setLeads(l.items); if (c[0]) setSelectedCampaign(c[0].id); if (l.items[0]) setSelectedLead(l.items[0].id || ''); })
      .catch((nextError) => setNotice(nextError instanceof Error ? nextError.message : 'Campaign data could not be loaded.'))
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
      language: String(data.get('language') || 'English'),
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

  return <div className="min-w-0"><h1 className="text-2xl font-bold min-[390px]:text-3xl">Campaign Builder</h1><p className="mt-2 text-slate-600">Create targeted outbound campaigns with schedules, send limits, working hours, and a four-step sequence.</p>{notice && <Notice message={notice} kind={notice.startsWith('Select') ? 'warning' : 'success'} />}{loading ? <div className="mt-6"><Skeleton lines={4} /></div> : <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_0.9fr]"><form onSubmit={submit} className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 min-[360px]:p-5 sm:grid-cols-2"><input name="name" required placeholder="Campaign name" className="rounded-md border border-slate-300 px-3 py-2 sm:col-span-2" /><input name="industry" placeholder="Industry" className="rounded-md border border-slate-300 px-3 py-2" /><input name="company_size" placeholder="Company size" className="rounded-md border border-slate-300 px-3 py-2" /><input name="countries" placeholder="Countries, comma separated" className="rounded-md border border-slate-300 px-3 py-2" /><input name="cities" placeholder="Cities, comma separated" className="rounded-md border border-slate-300 px-3 py-2" /><input name="keywords" placeholder="Keywords" className="rounded-md border border-slate-300 px-3 py-2" /><input name="website_filters" placeholder="Website filters" className="rounded-md border border-slate-300 px-3 py-2" /><input name="language" defaultValue="English" className="rounded-md border border-slate-300 px-3 py-2" /><select name="email_tone" className="rounded-md border border-slate-300 px-3 py-2">{tones.map((tone) => <option key={tone}>{tone}</option>)}</select><textarea name="offer" placeholder="Offer" className="min-h-24 rounded-md border border-slate-300 p-3 sm:col-span-2" /><input name="cta" placeholder="CTA" className="rounded-md border border-slate-300 px-3 py-2" /><input name="timezone" defaultValue="UTC" placeholder="Timezone" className="rounded-md border border-slate-300 px-3 py-2" /><input name="working_hours" defaultValue="09:00-17:00" placeholder="Working hours" className="rounded-md border border-slate-300 px-3 py-2" /><input name="daily_send_limit" type="number" defaultValue="50" min="1" max="500" placeholder="Daily send limit" className="rounded-md border border-slate-300 px-3 py-2" /><input name="follow_up_days" type="number" defaultValue="3" min="1" max="30" className="rounded-md border border-slate-300 px-3 py-2" /><textarea name="signature" placeholder="Signature" className="min-h-24 rounded-md border border-slate-300 p-3 sm:col-span-2" /><div className="grid gap-3 rounded-md bg-slate-50 p-3 sm:col-span-2"><p className="font-semibold">Sequence editor</p><input name="email_1_subject" placeholder="Email #1 subject" className="rounded-md border border-slate-300 px-3 py-2" /><textarea name="email_1_body" placeholder="Email #1 body" className="min-h-24 rounded-md border border-slate-300 p-3" /><div className="grid gap-3 min-[430px]:grid-cols-[1fr_90px]"><input name="follow_1_subject" placeholder="Follow-up #1 subject" className="rounded-md border border-slate-300 px-3 py-2" /><input name="follow_1_delay" type="number" defaultValue="3" min="1" className="rounded-md border border-slate-300 px-3 py-2" /></div><textarea name="follow_1_body" placeholder="Follow-up #1 body" className="min-h-20 rounded-md border border-slate-300 p-3" /><div className="grid gap-3 min-[430px]:grid-cols-[1fr_90px]"><input name="follow_2_subject" placeholder="Follow-up #2 subject" className="rounded-md border border-slate-300 px-3 py-2" /><input name="follow_2_delay" type="number" defaultValue="7" min="1" className="rounded-md border border-slate-300 px-3 py-2" /></div><textarea name="follow_2_body" placeholder="Follow-up #2 body" className="min-h-20 rounded-md border border-slate-300 p-3" /><div className="grid gap-3 min-[430px]:grid-cols-[1fr_90px]"><input name="follow_3_subject" placeholder="Follow-up #3 subject" className="rounded-md border border-slate-300 px-3 py-2" /><input name="follow_3_delay" type="number" defaultValue="12" min="1" className="rounded-md border border-slate-300 px-3 py-2" /></div><textarea name="follow_3_body" placeholder="Follow-up #3 body" className="min-h-20 rounded-md border border-slate-300 p-3" /></div><button className="focus-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-brand px-4 py-2 font-semibold text-white sm:col-span-2"><Plus size={18} /> Save campaign</button></form><section className="rounded-lg border border-slate-200 bg-white p-4 min-[360px]:p-5"><h2 className="font-bold">AI Email Generator</h2>{campaigns.length && leads.length ? <div className="mt-4 space-y-3"><select value={selectedCampaign} onChange={(event) => setSelectedCampaign(event.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2">{campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}</select><select value={selectedLead} onChange={(event) => setSelectedLead(event.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2">{leads.map((lead) => <option key={lead.id} value={lead.id}>{lead.company}</option>)}</select><button onClick={generateEmail} disabled={generating} className="focus-ring inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-ink px-4 py-2 font-semibold text-white disabled:opacity-60">{generating ? <Loader2 className="animate-spin" size={18} /> : <Wand2 size={18} />} Generate Email</button>{email && <div className="space-y-3"><div className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600">Delivery status: <span className="font-semibold text-ink">{email.delivery_status}</span></div><input value={email.subject} onChange={(e) => setEmail({ ...email, subject: e.target.value })} className="w-full rounded-md border border-slate-300 px-3 py-2" /><input value={email.preview} onChange={(e) => setEmail({ ...email, preview: e.target.value })} className="w-full rounded-md border border-slate-300 px-3 py-2" /><textarea value={email.body} onChange={(e) => setEmail({ ...email, body: e.target.value })} className="min-h-48 w-full rounded-md border border-slate-300 p-3" /><textarea value={email.follow_up_1 || ''} onChange={(e) => setEmail({ ...email, follow_up_1: e.target.value })} placeholder="Follow-up #1" className="min-h-28 w-full rounded-md border border-slate-300 p-3" /><textarea value={email.follow_up_2 || ''} onChange={(e) => setEmail({ ...email, follow_up_2: e.target.value })} placeholder="Follow-up #2" className="min-h-28 w-full rounded-md border border-slate-300 p-3" /><input value={email.cta} onChange={(e) => setEmail({ ...email, cta: e.target.value })} className="w-full rounded-md border border-slate-300 px-3 py-2" /><div className="grid gap-2 min-[430px]:grid-cols-2"><button onClick={saveEmail} className="focus-ring inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-slate-300 px-4 py-2 font-semibold"><Save size={18} /> Save email</button><button onClick={sendEmail} className="focus-ring inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-brand px-4 py-2 font-semibold text-white"><Send size={18} /> Send</button></div></div>}</div> : <EmptyState title="Campaigns and leads required" copy="Create a campaign and add a lead before generating AI emails." />}</section></div>}<div className="mt-6 grid gap-4 lg:grid-cols-3">{campaigns.map((campaign) => <article key={campaign.id} className="rounded-lg border border-slate-200 bg-white p-4"><div className="flex items-start justify-between gap-3"><div><h2 className="font-bold">{campaign.name}</h2><p className="text-sm text-slate-500">{campaign.industry || 'No industry set'}</p></div><span className="rounded-full bg-teal-50 px-3 py-1 text-xs font-semibold text-brand">{campaign.status}</span></div><dl className="mt-4 grid grid-cols-2 gap-2 text-sm min-[430px]:grid-cols-4"><div><dt className="text-slate-500">Leads</dt><dd className="font-bold">{campaign.leads}</dd></div><div><dt className="text-slate-500">Sent</dt><dd className="font-bold">{campaign.sent}</dd></div><div><dt className="text-slate-500">Replies</dt><dd className="font-bold">{campaign.replies}</dd></div><div><dt className="text-slate-500">Limit</dt><dd className="font-bold">{campaign.daily_send_limit}/day</dd></div></dl><p className="mt-3 text-sm text-slate-500">{campaign.timezone} · {campaign.working_hours}</p><div className="mt-4 flex flex-wrap gap-2">{['launch', 'pause', 'resume', 'duplicate'].map((action) => <button key={action} onClick={() => campaignAction(campaign.id, action as 'launch' | 'pause' | 'resume' | 'duplicate')} className="focus-ring min-h-11 rounded-md border border-slate-300 px-3 text-sm font-semibold capitalize">{action}</button>)}<button onClick={() => generateCampaignAnalytics(campaign.id)} className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-md border border-slate-300 px-3 text-sm font-semibold">{analyticsLoading === campaign.id ? <Loader2 className="animate-spin" size={16} /> : <Sparkles size={16} />} Analytics</button></div>{analytics[campaign.id] && <div className="mt-4 rounded-md bg-slate-50 p-3 text-sm"><div className="grid grid-cols-3 gap-2"><div><p className="text-slate-500">Success</p><p className="font-bold">{analytics[campaign.id].campaign_success}%</p></div><div><p className="text-slate-500">Reply</p><p className="font-bold">{analytics[campaign.id].predicted_reply_rate}%</p></div><div><p className="text-slate-500">Conv.</p><p className="font-bold">{analytics[campaign.id].predicted_conversion_rate}%</p></div></div><ul className="mt-2 list-disc space-y-1 pl-4 text-slate-600">{analytics[campaign.id].suggested_improvements.slice(0, 3).map((item) => <li key={item}>{item}</li>)}</ul></div>}{campaign.sequence?.length ? <div className="mt-4 space-y-2">{campaign.sequence.map((step) => <div key={step.step_order} className="rounded-md bg-slate-50 p-2 text-sm"><p className="font-semibold">{step.name}</p><p className="text-slate-500">{step.delay_days} day delay</p></div>)}</div> : null}</article>)}</div>{!campaigns.length && !loading && <div className="mt-6"><EmptyState title="No campaigns" copy="Build your first outbound campaign to start generating emails." /></div>}</div>;
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

  const load = useCallback(() => {
    if (!ready) return;
    setLoading(true);
    setError('');
    Promise.all([api<{ items: Lead[] }>(`/api/leads?search=${encodeURIComponent(search)}&status=${encodeURIComponent(status)}&page_size=50`), api<Campaign[]>('/api/campaigns')])
      .then(([leadPage, nextCampaigns]) => { setLeads(leadPage.items); setCampaigns(nextCampaigns); })
      .catch((nextError) => setError(nextError instanceof Error ? nextError.message : 'Lead data could not be loaded.'))
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
      setError(nextError instanceof Error ? nextError.message : 'Lead discovery failed.');
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
      setError(nextError instanceof Error ? nextError.message : `AI ${action} failed.`);
    } finally { setAiLoading(''); }
  }

  return <div className="min-w-0"><h1 className="text-2xl font-bold min-[390px]:text-3xl">Lead Management</h1><p className="mt-2 text-slate-600">Discover, enrich, score, prepare, and bulk-manage production leads. Press <kbd className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">/</kbd> to search.</p>{error && <Notice message={error} kind="error" />}{notice && <Notice message={notice} />}<form onSubmit={find} className="mt-6 grid gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm transition md:grid-cols-4"><input required name="country" placeholder="Country" className="rounded-md border border-slate-300 px-3 py-2" /><input name="city" placeholder="City" className="rounded-md border border-slate-300 px-3 py-2" /><input name="industry" placeholder="Industry" className="rounded-md border border-slate-300 px-3 py-2" /><input name="keywords" placeholder="Keywords" className="rounded-md border border-slate-300 px-3 py-2" /><input name="employee_count" placeholder="Employee count" className="rounded-md border border-slate-300 px-3 py-2" /><input name="revenue" placeholder="Revenue" className="rounded-md border border-slate-300 px-3 py-2" /><input name="technologies" placeholder="Technologies" className="rounded-md border border-slate-300 px-3 py-2" /><input name="limit" type="number" min="1" max="25" defaultValue="10" className="rounded-md border border-slate-300 px-3 py-2" /><button disabled={finding} className="focus-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-ink px-4 py-2 font-semibold text-white md:col-span-4">{finding ? <Loader2 className="animate-spin" size={18} /> : <Search size={18} />} Find leads</button></form><form onSubmit={create} className="mt-6 grid gap-3 rounded-lg border border-slate-200 bg-white p-4 md:grid-cols-4"><input required name="company" placeholder="Company" className="rounded-md border border-slate-300 px-3 py-2" /><input name="website" placeholder="Website" className="rounded-md border border-slate-300 px-3 py-2" /><input name="industry" placeholder="Industry" className="rounded-md border border-slate-300 px-3 py-2" /><input name="country" placeholder="Country" className="rounded-md border border-slate-300 px-3 py-2" /><input name="city" placeholder="City" className="rounded-md border border-slate-300 px-3 py-2" /><input name="contact" placeholder="Contact" className="rounded-md border border-slate-300 px-3 py-2" /><input name="email" placeholder="Email" className="rounded-md border border-slate-300 px-3 py-2" /><select name="campaign_id" className="rounded-md border border-slate-300 px-3 py-2"><option value="">No campaign</option>{campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}</select><button className="focus-ring min-h-11 rounded-md bg-brand px-4 py-2 font-semibold text-white md:col-span-4">Add lead</button></form><div className="mt-5 flex flex-col gap-3 min-[430px]:flex-row"><div className="relative flex-1"><Search className="absolute left-3 top-3 text-slate-400" size={18} /><input id="lead-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search leads" className="w-full rounded-md border border-slate-300 py-2 pl-10 pr-3" /></div><select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-md border border-slate-300 px-3 py-2"><option value="">All statuses</option>{pipeline.map((item) => <option key={item}>{item}</option>)}</select><button onClick={load} className="focus-ring min-h-11 rounded-md border border-slate-300 px-4 py-2 font-semibold">Apply</button></div>{selected.length > 0 && <div className="mt-4 flex flex-wrap gap-2 rounded-lg border border-slate-200 bg-white p-3"><span className="py-2 text-sm font-semibold">{selected.length} selected</span>{pipeline.map((item) => <button key={item} onClick={() => bulkStatus(item)} className="focus-ring min-h-11 rounded-md border border-slate-300 px-3 text-sm">{item}</button>)}</div>}{loading ? <div className="mt-6"><Skeleton lines={5} /></div> : leads.length ? <div className="mt-6 space-y-3">{leads.map((lead) => { const id = lead.id || lead.company; const leadCopilot = lead.id ? copilot[lead.id] : undefined; const audit = lead.id ? audits[lead.id] : undefined; const prep = lead.id ? meetingPrep[lead.id] : undefined; const follow = lead.id ? followUps[lead.id] : undefined; return <article key={id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-soft"><div className="flex items-start gap-3"><input type="checkbox" checked={Boolean(lead.id && selected.includes(lead.id))} onChange={(e) => setSelected((ids) => e.target.checked && lead.id ? [...ids, lead.id] : ids.filter((item) => item !== lead.id))} className="mt-1 size-5" /><div className="min-w-0 flex-1"><div className="flex flex-col gap-2 min-[430px]:flex-row min-[430px]:items-start min-[430px]:justify-between"><div><h2 className="font-bold">{lead.company}</h2><p className="break-all text-sm text-slate-500">{lead.email || lead.website || 'No contact yet'}</p></div><span className="w-fit rounded-full bg-teal-50 px-3 py-1 text-xs font-semibold text-brand">{lead.status}</span></div><dl className="mt-3 grid gap-2 text-sm min-[430px]:grid-cols-4"><div><dt className="text-slate-500">Industry</dt><dd>{lead.industry || '-'}</dd></div><div><dt className="text-slate-500">Country</dt><dd>{lead.country || '-'}</dd></div><div><dt className="text-slate-500">Contact</dt><dd>{lead.contact || '-'}</dd></div><div><dt className="text-slate-500">Value</dt><dd>€{metricNumber(lead.revenue).toLocaleString()}</dd></div></dl><div className="mt-4 flex flex-wrap gap-2"><button onClick={() => runLeadAi<SalesCopilot>(lead, 'copilot', (key, value) => setCopilot((items) => ({ ...items, [key]: value })))} className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-md border border-slate-300 px-3 text-sm font-semibold"><Brain size={16} /> Copilot</button><button onClick={() => runLeadAi<WebsiteAudit>(lead, 'website-audit', (key, value) => setAudits((items) => ({ ...items, [key]: value })))} className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-md border border-slate-300 px-3 text-sm font-semibold"><Sparkles size={16} /> Audit</button><button onClick={() => runLeadAi<MeetingPrep>(lead, 'meeting-prep', (key, value) => setMeetingPrep((items) => ({ ...items, [key]: value })))} className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-md border border-slate-300 px-3 text-sm font-semibold"><ClipboardList size={16} /> Meeting</button><button onClick={() => runLeadAi<FollowUpSequence>(lead, 'follow-ups', (key, value) => setFollowUps((items) => ({ ...items, [key]: value })))} className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-md border border-slate-300 px-3 text-sm font-semibold"><Wand2 size={16} /> Follow-up</button>{aiLoading.startsWith(String(lead.id)) && <Loader2 className="mt-3 animate-spin text-brand" size={18} />}</div>{leadCopilot && <div className="mt-4 grid gap-3 rounded-md bg-slate-50 p-3 text-sm min-[430px]:grid-cols-3"><div><p className="text-slate-500">Reply</p><p className="text-xl font-bold">{leadCopilot.probability_to_reply}%</p></div><div><p className="text-slate-500">Buy</p><p className="text-xl font-bold">{leadCopilot.probability_to_buy}%</p></div><div><p className="text-slate-500">Revenue</p><p className="text-xl font-bold">€{leadCopilot.estimated_revenue.toLocaleString()}</p></div><p className="min-[430px]:col-span-3"><span className="font-semibold">Subject:</span> {leadCopilot.best_subject_line}</p><p className="min-[430px]:col-span-3"><span className="font-semibold">CTA:</span> {leadCopilot.best_cta}</p></div>}{audit && <div className="mt-3 rounded-md bg-slate-50 p-3 text-sm"><p className="font-semibold">Website audit</p><p className="mt-1 text-slate-600">{audit.improvement_report}</p><div className="mt-2 flex flex-wrap gap-2">{audit.priority_actions.map((item) => <span key={item} className="rounded-full bg-white px-2 py-1 text-xs font-semibold">{item}</span>)}</div></div>}{prep && <div className="mt-3 rounded-md bg-slate-50 p-3 text-sm"><p className="font-semibold">Meeting prep</p><p className="mt-1 text-slate-600">{prep.company_summary}</p><p className="mt-2 font-semibold">Strategy: <span className="font-normal text-slate-600">{prep.sales_strategy}</span></p></div>}{follow && <div className="mt-3 grid gap-2 rounded-md bg-slate-50 p-3 text-sm min-[430px]:grid-cols-2">{Object.entries(follow).map(([state, items]) => <div key={state}><p className="font-semibold capitalize">{state.replace('_', ' ')}</p><p className="mt-1 text-slate-600">{items[0] || 'No draft yet'}</p></div>)}</div>}{lead.notes && <p className="mt-3 line-clamp-3 rounded-md bg-slate-50 p-3 text-xs text-slate-600">{lead.notes}</p>}</div></div></article>; })}</div> : <div className="mt-6"><EmptyState title="No leads" copy="Add a lead manually or run Lead Finder to populate the pipeline." /></div>}</div>;
}

export function AISalesEmployees() {
  const { api, ready } = useTokenApi();
  const [employees, setEmployees] = useState<AISalesEmployee[]>([]);
  const [employeeId, setEmployeeId] = useState('');
  const [leads, setLeads] = useState<Lead[]>([]);
  const [insights, setInsights] = useState<Record<string, SalesEmployeeLeadInsight>>({});
  const [emails, setEmails] = useState<Record<string, Email>>({});
  const [runResult, setRunResult] = useState<SalesEmployeeRun | null>(null);
  const [taskPlan, setTaskPlan] = useState<SalesEmployeeTaskPlan | null>(null);
  const [memory, setMemory] = useState<SalesEmployeeMemory | null>(null);
  const [performance, setPerformance] = useState<SalesEmployeePerformance | null>(null);
  const [command, setCommand] = useState('');
  const [listening, setListening] = useState(false);
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

  const load = useCallback(() => {
    if (!ready) return;
    setLoading(true);
    setError('');
    api<AISalesEmployee[]>('/api/sales-employees')
      .then((items) => {
        setEmployees(items);
        const next = employeeId || items[0]?.id || '';
        setEmployeeId(next);
        return Promise.all([loadLeads(next), loadEmployeeContext(next)]);
      })
      .catch((nextError) => setError(nextError instanceof Error ? nextError.message : 'AI Sales Employees could not be loaded.'))
      .finally(() => setLoading(false));
  }, [api, ready, employeeId, loadLeads, loadEmployeeContext]);

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
          language: data.get('language') || 'English',
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
      setError(nextError instanceof Error ? nextError.message : 'AI Sales Employee could not be created.');
    } finally { setBusy(''); }
  }

  function startVoice() {
    const SpeechRecognition = (window as unknown as { SpeechRecognition?: new () => any; webkitSpeechRecognition?: new () => any }).SpeechRecognition || (window as unknown as { webkitSpeechRecognition?: new () => any }).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setError('Voice input is not supported in this browser. Type the work request instead.');
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = selectedEmployee?.language || 'en-US';
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
      setError(nextError instanceof Error ? nextError.message : 'Planning failed.');
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
      setError(nextError instanceof Error ? nextError.message : 'Plan decision failed.');
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
      setError(nextError instanceof Error ? nextError.message : 'Execution failed.');
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
      setError(nextError instanceof Error ? nextError.message : 'Manual import failed.');
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
      setError(nextError instanceof Error ? nextError.message : 'Import failed.');
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
      setError(nextError instanceof Error ? nextError.message : 'Qualification failed.');
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
      setError(nextError instanceof Error ? nextError.message : 'Draft failed.');
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
      setError(nextError instanceof Error ? nextError.message : 'Approval failed.');
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
      setError(nextError instanceof Error ? nextError.message : 'Employee run failed.');
    } finally { setBusy(''); }
  }

  const selectedEmployee = employees.find((employee) => employee.id === employeeId);

  return <div className="min-w-0"><div className="flex flex-col gap-3 min-[430px]:flex-row min-[430px]:items-start min-[430px]:justify-between"><div><h1 className="text-2xl font-bold min-[390px]:text-3xl">AI Sales Employees</h1><p className="mt-2 text-slate-600">Assign sales work in plain language. Your AI employee plans, asks for approval, then executes safe reviewed work.</p></div><button onClick={runEmployee} disabled={!employeeId || busy === 'run'} className="focus-ring inline-flex min-h-11 w-fit items-center justify-center gap-2 rounded-md bg-ink px-4 py-2 font-semibold text-white disabled:opacity-60">{busy === 'run' ? <Loader2 className="animate-spin" size={18} /> : <Brain size={18} />} Run reviewed queue</button></div>{error && <Notice message={error} kind="error" />}{notice && <Notice message={notice} />}{runResult && <Notice message={`Last run: ${runResult.mode}; ${runResult.emails_sent} sent; ${runResult.blocked.length} blocked.`} kind={runResult.blocked.length ? 'warning' : 'success'} />}{loading ? <div className="mt-6"><Skeleton lines={5} /></div> : <div className="mt-6 grid gap-6 xl:grid-cols-[0.9fr_1.1fr]"><section className="space-y-4"><form onSubmit={createEmployee} className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2"><h2 className="font-bold sm:col-span-2">Hire AI Sales Employee</h2><input required name="name" placeholder="Name" className="rounded-md border border-slate-300 px-3 py-2" /><input name="role" defaultValue="AI Sales Development Representative" placeholder="Role" className="rounded-md border border-slate-300 px-3 py-2" /><textarea name="product_service" placeholder="Product/service it sells" className="min-h-24 rounded-md border border-slate-300 p-3 sm:col-span-2" /><input name="target_customer" placeholder="Target customer" className="rounded-md border border-slate-300 px-3 py-2" /><input name="target_countries" placeholder="Target countries" className="rounded-md border border-slate-300 px-3 py-2" /><input name="target_industries" placeholder="Target industries" className="rounded-md border border-slate-300 px-3 py-2" /><select name="sending_mode" defaultValue="Review Mode" className="rounded-md border border-slate-300 px-3 py-2">{salesModes.map((mode) => <option key={mode}>{mode}</option>)}</select><textarea name="offer" placeholder="Offer" className="min-h-20 rounded-md border border-slate-300 p-3 sm:col-span-2" /><input name="cta" defaultValue="Book a quick call" placeholder="CTA" className="rounded-md border border-slate-300 px-3 py-2" /><input name="daily_limit" type="number" min="1" max="250" defaultValue="25" className="rounded-md border border-slate-300 px-3 py-2" /><input name="working_hours" defaultValue="09:00-17:00" className="rounded-md border border-slate-300 px-3 py-2" /><select name="tone" className="rounded-md border border-slate-300 px-3 py-2">{tones.map((tone) => <option key={tone}>{tone}</option>)}</select><input name="language" defaultValue="English" className="rounded-md border border-slate-300 px-3 py-2" /><textarea name="signature" placeholder="Signature" className="min-h-20 rounded-md border border-slate-300 p-3 sm:col-span-2" /><button disabled={busy === 'create'} className="focus-ring min-h-11 rounded-md bg-brand px-4 py-2 font-semibold text-white sm:col-span-2">Create AI Sales Employee</button></form><section className="rounded-lg border border-slate-200 bg-white p-4"><h2 className="font-bold">Team</h2>{employees.length ? <div className="mt-4 space-y-3">{employees.map((employee) => <button key={employee.id} onClick={() => { setEmployeeId(employee.id); setTaskPlan(null); void Promise.all([loadLeads(employee.id), loadEmployeeContext(employee.id)]); }} className={`w-full rounded-md border p-3 text-left ${employeeId === employee.id ? 'border-brand bg-teal-50' : 'border-slate-200'}`}><div className="flex items-start justify-between gap-3"><div><p className="font-semibold">{employee.name}</p><p className="text-sm text-slate-500">{employee.role}</p></div><span className="rounded-full bg-white px-2 py-1 text-xs font-semibold">{employee.sending_mode}</span></div><dl className="mt-3 grid grid-cols-4 gap-2 text-xs"><div><dt className="text-slate-500">Leads</dt><dd className="font-bold">{employee.leads}</dd></div><div><dt className="text-slate-500">Review</dt><dd className="font-bold">{employee.pending_approval}</dd></div><div><dt className="text-slate-500">Sent</dt><dd className="font-bold">{employee.sent}</dd></div><div><dt className="text-slate-500">Limit</dt><dd className="font-bold">{employee.daily_limit}</dd></div></dl></button>)}</div> : <EmptyState title="No employees" copy="Create one to start a safe AI sales workflow." />}</section><section className="rounded-lg border border-slate-200 bg-white p-4"><h2 className="font-bold">Performance</h2><div className="mt-4 grid grid-cols-2 gap-3 text-sm"><div className="rounded-md bg-slate-50 p-3"><p className="text-slate-500">Tasks</p><p className="text-xl font-bold">{performance?.tasks_completed || 0}</p></div><div className="rounded-md bg-slate-50 p-3"><p className="text-slate-500">Success</p><p className="text-xl font-bold">{performance?.success_rate || 0}%</p></div><div className="rounded-md bg-slate-50 p-3"><p className="text-slate-500">Reply</p><p className="text-xl font-bold">{performance?.reply_rate || 0}%</p></div><div className="rounded-md bg-slate-50 p-3"><p className="text-slate-500">Meetings</p><p className="text-xl font-bold">{performance?.meeting_rate || 0}%</p></div><div className="rounded-md bg-slate-50 p-3"><p className="text-slate-500">Revenue</p><p className="text-xl font-bold">€{metricNumber(performance?.revenue_influence).toLocaleString()}</p></div><div className="rounded-md bg-slate-50 p-3"><p className="text-slate-500">Time saved</p><p className="text-xl font-bold">{performance?.time_saved_hours || 0}h</p></div></div></section></section><section className="space-y-6"><div className="rounded-lg border border-slate-200 bg-white p-4"><h2 className="font-bold">Give work to {selectedEmployee?.name || 'your AI employee'}</h2><p className="mt-1 text-sm text-slate-500">Voice or type a sales task. The employee will understand the intent, build a plan, and wait for approval before external actions.</p><div className="mt-4 grid gap-3 min-[430px]:grid-cols-[1fr_auto]"><textarea value={command} onChange={(event) => setCommand(event.target.value)} placeholder="Find construction companies in Germany. Create an email campaign. Analyse my last campaign." className="min-h-28 rounded-md border border-slate-300 p-3" /><button type="button" onClick={startVoice} disabled={!employeeId || listening} className="focus-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-slate-300 px-4 py-2 font-semibold"><Mic size={18} /> {listening ? 'Listening' : 'Record'}</button></div><div className="mt-3 flex flex-wrap gap-2"><button onClick={() => createPlan(listening ? 'voice' : 'text')} disabled={!employeeId || !command.trim() || busy === 'plan'} className="focus-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-ink px-4 py-2 font-semibold text-white disabled:opacity-60">{busy === 'plan' ? <Loader2 className="animate-spin" size={18} /> : <Brain size={18} />} Build execution plan</button></div>{taskPlan && <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4"><div className="flex flex-col gap-2 min-[430px]:flex-row min-[430px]:items-start min-[430px]:justify-between"><div><p className="text-sm font-semibold text-brand">Current task · {taskPlan.status}</p><h3 className="mt-1 text-xl font-bold">{taskPlan.goal}</h3><p className="mt-1 text-sm text-slate-600">{taskPlan.intent} · {taskPlan.priority} priority · {taskPlan.estimated_execution_time}</p></div><span className="w-fit rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-700">{taskPlan.requires_approval ? 'Approval required' : 'Review first'}</span></div><p className="mt-3 text-sm text-slate-600">{taskPlan.expected_result}</p><ol className="mt-4 space-y-2 text-sm">{taskPlan.steps.map((step, index) => <li key={`${step}-${index}`} className="rounded-md bg-white p-3"><span className="font-semibold">{index + 1}. </span>{step}</li>)}</ol><div className="mt-4 grid gap-3 md:grid-cols-2"><div className="rounded-md bg-white p-3 text-sm"><p className="font-semibold">Required tools</p><p className="mt-1 text-slate-600">{taskPlan.required_tools.join(', ') || 'None'}</p></div><div className="rounded-md bg-white p-3 text-sm"><p className="font-semibold">Safety</p><p className="mt-1 text-slate-600">{taskPlan.safety_notes.join(' ')}</p></div></div><div className="mt-4 flex flex-wrap gap-2">{taskPlan.status === 'waiting_approval' && <><button onClick={() => decidePlan('approve')} disabled={busy === 'approve'} className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-md bg-brand px-4 py-2 font-semibold text-white"><Check size={18} /> Approve</button><button onClick={() => decidePlan('cancel')} disabled={busy === 'cancel'} className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-md border border-slate-300 px-4 py-2 font-semibold"><X size={18} /> Cancel</button></>}{taskPlan.status === 'approved' && <button onClick={executePlan} disabled={busy === 'execute'} className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-md bg-ink px-4 py-2 font-semibold text-white">{busy === 'execute' ? <Loader2 className="animate-spin" size={18} /> : <Play size={18} />} Execute approved plan</button>}</div>{taskPlan.progress.length > 0 && <div className="mt-4 space-y-2">{taskPlan.progress.map((item, index) => <div key={`${item}-${index}`} className="flex items-center gap-2 rounded-md bg-white px-3 py-2 text-sm"><CheckCircle2 size={16} className="text-brand" /> {item}</div>)}</div>}</div>}</div><div className="rounded-lg border border-slate-200 bg-white p-4"><h2 className="font-bold">Memory</h2><div className="mt-4 grid gap-3 text-sm md:grid-cols-2"><div className="rounded-md bg-slate-50 p-3"><p className="font-semibold">Industries</p><p className="mt-1 text-slate-600">{memory?.industries.join(', ') || 'No pattern yet'}</p></div><div className="rounded-md bg-slate-50 p-3"><p className="font-semibold">Countries</p><p className="mt-1 text-slate-600">{memory?.countries.join(', ') || 'No pattern yet'}</p></div><div className="rounded-md bg-slate-50 p-3"><p className="font-semibold">Tone</p><p className="mt-1 text-slate-600">{memory?.preferred_tone || selectedEmployee?.tone || 'Professional'}</p></div><div className="rounded-md bg-slate-50 p-3"><p className="font-semibold">Preferences</p><p className="mt-1 text-slate-600">{memory?.customer_preferences.join(', ') || 'No preferences stored'}</p></div></div></div><div className="rounded-lg border border-slate-200 bg-white p-4"><h2 className="font-bold">Today&apos;s Results</h2><dl className="mt-4 grid grid-cols-2 gap-3 text-sm min-[430px]:grid-cols-4"><div className="rounded-md bg-slate-50 p-3"><dt className="text-slate-500">Leads Found</dt><dd className="text-xl font-bold">{selectedEmployee?.leads || 0}</dd></div><div className="rounded-md bg-slate-50 p-3"><dt className="text-slate-500">Emails Generated</dt><dd className="text-xl font-bold">{selectedEmployee?.pending_approval || 0}</dd></div><div className="rounded-md bg-slate-50 p-3"><dt className="text-slate-500">Meetings Booked</dt><dd className="text-xl font-bold">{performance?.meeting_rate ? Math.round(performance.meeting_rate) : 0}</dd></div><div className="rounded-md bg-slate-50 p-3"><dt className="text-slate-500">Revenue Generated</dt><dd className="text-xl font-bold">€{metricNumber(performance?.revenue_influence).toLocaleString()}</dd></div></dl></div><div className="rounded-lg border border-slate-200 bg-white p-4"><h2 className="font-bold">Lead discovery</h2><p className="mt-1 text-sm text-slate-500">{selectedEmployee ? `${selectedEmployee.name} works in ${selectedEmployee.sending_mode}. Default mode is Review Mode.` : 'Create or select an employee first.'}</p><form onSubmit={importManual} className="mt-4 grid gap-3 md:grid-cols-2"><input required name="company" placeholder="Company" className="rounded-md border border-slate-300 px-3 py-2" /><input name="website" placeholder="Website" className="rounded-md border border-slate-300 px-3 py-2" /><input name="industry" placeholder="Industry" className="rounded-md border border-slate-300 px-3 py-2" /><input name="country" placeholder="Country" className="rounded-md border border-slate-300 px-3 py-2" /><input name="contact" placeholder="Contact" className="rounded-md border border-slate-300 px-3 py-2" /><input name="email" placeholder="Email" className="rounded-md border border-slate-300 px-3 py-2" /><button disabled={!employeeId || busy === 'manual'} className="focus-ring min-h-11 rounded-md bg-brand px-4 py-2 font-semibold text-white md:col-span-2">Add company manually</button></form><form onSubmit={(event) => importText('websites', 'websites', event)} className="mt-4 space-y-3"><textarea name="websites" placeholder="Paste one website per line" className="min-h-28 w-full rounded-md border border-slate-300 p-3" /><button disabled={!employeeId} className="focus-ring min-h-11 rounded-md border border-slate-300 px-4 py-2 font-semibold">Import website list</button></form><form onSubmit={(event) => importText('google-maps', 'export_text', event)} className="mt-4 space-y-3"><textarea name="export_text" placeholder="Paste Google Maps export rows" className="min-h-28 w-full rounded-md border border-slate-300 p-3" /><button disabled={!employeeId} className="focus-ring min-h-11 rounded-md border border-slate-300 px-4 py-2 font-semibold">Import Google Maps export</button></form><p className="mt-4 rounded-md bg-slate-50 p-3 text-sm text-slate-600">CSV upload is available via <code>/api/sales-employees/{employeeId || 'employee_id'}/leads/csv</code>. Apollo, Clay, and People Data Labs are prepared as future employee-level sources.</p></div><div className="rounded-lg border border-slate-200 bg-white p-4"><h2 className="font-bold">Employee leads</h2>{leads.length ? <div className="mt-4 space-y-3">{leads.map((lead) => { const insight = lead.id ? insights[lead.id] : undefined; const email = lead.id ? emails[lead.id] : undefined; return <article key={lead.id || lead.company} className="rounded-md border border-slate-200 p-3"><div className="flex flex-col gap-2 min-[430px]:flex-row min-[430px]:items-start min-[430px]:justify-between"><div><p className="font-semibold">{lead.company}</p><p className="break-all text-sm text-slate-500">{lead.email || lead.website || 'No contact yet'}</p></div><span className="w-fit rounded-full bg-teal-50 px-3 py-1 text-xs font-semibold text-brand">{lead.status}</span></div><div className="mt-3 flex flex-wrap gap-2"><button onClick={() => qualify(lead)} className="focus-ring min-h-11 rounded-md border border-slate-300 px-3 text-sm font-semibold">Qualify</button><button onClick={() => draft(lead)} className="focus-ring min-h-11 rounded-md border border-slate-300 px-3 text-sm font-semibold">Draft email</button>{email?.delivery_status === 'pending_approval' && <button onClick={() => approve(lead)} className="focus-ring min-h-11 rounded-md bg-brand px-3 text-sm font-semibold text-white">Approve</button>}</div>{insight && <div className="mt-3 grid gap-2 rounded-md bg-slate-50 p-3 text-sm min-[430px]:grid-cols-3"><div><p className="text-slate-500">ICP</p><p className="text-xl font-bold">{insight.icp_score}%</p></div><div><p className="text-slate-500">Purchase</p><p className="text-xl font-bold">{insight.purchase_probability}%</p></div><div><p className="text-slate-500">Plan</p><p className="text-xl font-bold">{insight.recommended_plan}</p></div><p className="min-[430px]:col-span-3"><span className="font-semibold">Angle:</span> {insight.best_sales_angle}</p><p className="min-[430px]:col-span-3"><span className="font-semibold">CTA:</span> {insight.best_cta}</p></div>}{email && <div className="mt-3 rounded-md bg-slate-50 p-3 text-sm"><p className="font-semibold">{email.subject}</p><p className="mt-1 text-slate-500">Status: {email.delivery_status}</p><p className="mt-2 line-clamp-3 text-slate-600">{email.body}</p></div>}</article>; })}</div> : <EmptyState title="No employee leads" copy="Add a company, paste websites, import Google Maps rows, or upload CSV via API." />}</div></section></div>}</div>;
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
      .catch((nextError) => setError(nextError instanceof Error ? nextError.message : 'Inbox data could not be loaded.'))
      .finally(() => setLoading(false));
  }, [api, ready]);
  return <div className="min-w-0"><h1 className="text-2xl font-bold min-[390px]:text-3xl">Unified Inbox</h1><p className="mt-2 text-slate-600">Replies, AI categories, notifications, tags, and activity events in one operational view.</p>{error && <Notice message={error} kind="error" />}{loading ? <div className="mt-6"><Skeleton lines={4} /></div> : <div className="mt-6 grid gap-6 lg:grid-cols-2"><section className="rounded-lg border border-slate-200 bg-white p-5 lg:col-span-2"><h2 className="font-bold">Replies</h2>{inbox.length ? <div className="mt-4 space-y-3">{inbox.map((item) => <article key={item.id} className="rounded-md bg-slate-50 p-3"><div className="flex flex-col gap-2 min-[430px]:flex-row min-[430px]:items-start min-[430px]:justify-between"><p className="font-semibold">{item.subject}</p><span className="w-fit rounded-full bg-white px-2 py-1 text-xs font-semibold">{String(item.tags?.category || item.delivery_status)}</span></div><p className="mt-2 text-sm text-slate-600">{item.preview || item.body}</p>{Boolean(item.reply_assistant?.next_step) && <p className="mt-2 text-xs font-semibold text-brand">Next step: {String(item.reply_assistant?.next_step)}</p>}</article>)}</div> : <EmptyState title="No replies yet" copy="Inbound replies will be categorized and routed here automatically." />}</section><section className="rounded-lg border border-slate-200 bg-white p-5"><h2 className="font-bold">Notifications</h2>{notifications.length ? <div className="mt-4 space-y-3">{notifications.map((item) => <div key={item.id} className="rounded-md bg-slate-50 p-3"><p className="font-semibold">{item.title}</p><p className="text-sm text-slate-500">{item.message}</p></div>)}</div> : <EmptyState title="No notifications" copy="Success, error, warning, and background job updates will appear here." />}</section><section className="rounded-lg border border-slate-200 bg-white p-5"><h2 className="font-bold">Activity</h2>{activity.length ? <div className="mt-4 space-y-3">{activity.map((item) => <div key={item.id} className="rounded-md bg-slate-50 p-3"><p className="font-semibold">{item.action.replaceAll('.', ' ')}</p><p className="text-sm text-slate-500">{new Date(item.created_at).toLocaleString()}</p></div>)}</div> : <EmptyState title="No activity" copy="Every campaign, lead, email, and reply action will be logged here." />}</section></div>}</div>;
}

export function SettingsAndProfile() {
  const { api, ready } = useTokenApi();
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
      .catch((nextError) => setNotice(nextError instanceof Error ? nextError.message : 'Settings could not be loaded.'));
  }, [api, ready]);
  async function saveProfile(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const data = new FormData(event.currentTarget); const saved = await api<Profile>('/api/profile', { method: 'PUT', body: JSON.stringify({ workspace: data.get('workspace'), company: data.get('company'), avatar_url: data.get('avatar_url') || null, timezone: data.get('timezone'), language: data.get('language') }) }); setProfile(saved); setNotice('Profile saved.'); }
  async function saveSettings() { if (!settings) return; await api<Settings>('/api/settings', { method: 'PUT', body: JSON.stringify(settings) }); setNotice('Settings saved.'); }
  const members = workspace?.members || [];
  return <div className="min-w-0"><h1 className="text-2xl font-bold min-[390px]:text-3xl">Settings</h1><p className="mt-2 text-slate-600">Organization, members, billing, API, email, notifications, security, and profile preferences.</p>{notice && <Notice message={notice} />}{!settings ? <div className="mt-6"><Skeleton lines={5} /></div> : <div className="mt-6 grid gap-6 xl:grid-cols-[0.8fr_1.2fr]"><div className="space-y-6"><form onSubmit={saveProfile} className="space-y-3 rounded-lg border border-slate-200 bg-white p-5"><h2 className="font-bold">User profile</h2><input name="workspace" value={profile.workspace} onChange={(e) => setProfile({ ...profile, workspace: e.target.value })} placeholder="Workspace" className="w-full rounded-md border border-slate-300 px-3 py-2" /><input name="company" value={profile.company} onChange={(e) => setProfile({ ...profile, company: e.target.value })} placeholder="Company" className="w-full rounded-md border border-slate-300 px-3 py-2" /><input name="avatar_url" value={profile.avatar_url || ''} onChange={(e) => setProfile({ ...profile, avatar_url: e.target.value })} placeholder="Avatar URL" className="w-full rounded-md border border-slate-300 px-3 py-2" /><input name="timezone" value={profile.timezone} onChange={(e) => setProfile({ ...profile, timezone: e.target.value })} placeholder="Timezone" className="w-full rounded-md border border-slate-300 px-3 py-2" /><input name="language" value={profile.language} onChange={(e) => setProfile({ ...profile, language: e.target.value })} placeholder="Language" className="w-full rounded-md border border-slate-300 px-3 py-2" /><button className="focus-ring inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-brand px-4 py-2 font-semibold text-white"><CheckCircle2 size={18} /> Save profile</button><button type="button" onClick={() => api('/api/profile', { method: 'DELETE' }).then(() => setNotice('Delete account request queued.'))} className="focus-ring min-h-11 w-full rounded-md border border-red-200 px-4 py-2 font-semibold text-red-700">Delete account</button></form><section className="rounded-lg border border-slate-200 bg-white p-5"><h2 className="font-bold">Organization</h2><p className="mt-2 text-sm text-slate-600">{workspace?.company || workspace?.name || 'Workspace'} · {workspace?.industry || 'Industry not set'}</p><div className="mt-4 space-y-2">{members.length ? members.map((member) => <div key={member.id} className="flex items-center justify-between gap-3 rounded-md bg-slate-50 p-3 text-sm"><span className="break-all">{member.email || member.user_id}</span><span className="rounded-full bg-white px-2 py-1 font-semibold">{member.role}</span></div>) : <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-500">No team members loaded yet.</p>}</div></section><section className="rounded-lg border border-slate-200 bg-white p-5"><h2 className="font-bold">Billing and usage</h2><div className="mt-4 grid gap-3">{plans.map((plan) => <div key={plan.name} className="rounded-md border border-slate-200 p-3"><div className="flex justify-between"><span className="font-semibold">{plan.name}</span><span>€{plan.price}/mo</span></div><p className="mt-1 text-sm text-slate-500">{plan.current ? 'Current plan' : `${plan.limits.leads} leads/month`}</p></div>)}</div>{usage && <div className="mt-4 rounded-md bg-slate-50 p-3 text-sm"><p>Period: {usage.period}</p><p>Leads: {usage.usage.leads}/{usage.limits.leads}</p><p>AI generations: {usage.usage.ai_generations}/{usage.limits.ai_generations}</p><p>Email sends: {usage.usage.email_sends}/{usage.limits.email_sends}</p></div>}</section></div><section className="rounded-lg border border-slate-200 bg-white p-5"><h2 className="font-bold">Workspace settings</h2><div className="mt-4 grid gap-4 md:grid-cols-2">{(Object.keys(settings) as Array<keyof Settings>).map((key) => <label key={key} className="block rounded-md border border-slate-200 p-3"><span className="text-sm font-semibold capitalize">{key}</span><textarea value={JSON.stringify(settings[key], null, 2)} onChange={(e) => { try { setSettings({ ...settings, [key]: JSON.parse(e.target.value) }); } catch {} }} className="mt-2 min-h-32 w-full rounded-md border border-slate-300 p-2 font-mono text-xs" /></label>)}</div><button onClick={saveSettings} className="focus-ring mt-4 min-h-11 rounded-md bg-ink px-4 py-2 font-semibold text-white"><Save size={18} className="mr-2 inline" />Save settings</button></section></div>}</div>;
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
      .catch((nextError) => setError(nextError instanceof Error ? nextError.message : 'Admin data could not be loaded.'));
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
    }).catch((nextError) => setNotice(nextError instanceof Error ? nextError.message : 'Onboarding could not be loaded.'));
  }, [api, ready]);

  async function save(nextStep: number) {
    const saved = await api<Workspace>('/api/onboarding', { method: 'PUT', body: JSON.stringify({ ...form, step: nextStep }) });
    setWorkspace(saved);
    setStep(nextStep);
    setNotice(saved.onboarding_completed ? 'Onboarding complete. Your first campaign can be launched from Campaigns.' : 'Progress saved.');
  }

  if (!workspace) return <div className="mx-auto max-w-3xl p-4"><Skeleton lines={5} /></div>;

  return <main className="mx-auto min-h-screen max-w-3xl px-4 py-8"><h1 className="text-2xl font-bold min-[390px]:text-3xl">Set up OutreachAI</h1><p className="mt-2 text-slate-600">Complete the six commercial onboarding steps before launching your first campaign.</p>{notice && <Notice message={notice} /> }<section className="mt-6 rounded-lg border border-slate-200 bg-white p-5"><div className="mb-5 flex flex-wrap gap-2">{[1, 2, 3, 4, 5, 6].map((item) => <button key={item} onClick={() => setStep(item)} className={`min-h-11 rounded-md px-4 font-semibold ${step === item ? 'bg-brand text-white' : 'border border-slate-300'}`}>Step {item}</button>)}</div>{step === 1 && <label className="block"><span className="font-semibold">Company</span><input value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2" /></label>}{step === 2 && <label className="block"><span className="font-semibold">Industry</span><input value={form.industry} onChange={(e) => setForm({ ...form, industry: e.target.value })} className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2" /></label>}{step === 3 && <label className="block"><span className="font-semibold">Target country</span><input value={form.target_country} onChange={(e) => setForm({ ...form, target_country: e.target.value })} className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2" /></label>}{step === 4 && <label className="block"><span className="font-semibold">Target customer</span><input value={form.target_customer} onChange={(e) => setForm({ ...form, target_customer: e.target.value })} className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2" /></label>}{step === 5 && <label className="flex min-h-11 items-center gap-3"><input type="checkbox" checked={form.connect_openai} onChange={(e) => setForm({ ...form, connect_openai: e.target.checked })} className="size-5" /><span>Connect OpenAI later from Settings</span></label>}{step === 6 && <label className="flex min-h-11 items-center gap-3"><input type="checkbox" checked={form.launch_first_campaign} onChange={(e) => setForm({ ...form, launch_first_campaign: e.target.checked })} className="size-5" /><span>Launch first campaign after setup</span></label>}<div className="mt-6 grid gap-3 min-[430px]:grid-cols-2"><button onClick={() => save(Math.max(1, step - 1))} className="min-h-11 rounded-md border border-slate-300 px-4 font-semibold">Back</button><button onClick={() => save(Math.min(6, step + 1))} className="min-h-11 rounded-md bg-brand px-4 font-semibold text-white">{step === 6 ? 'Finish' : 'Continue'}</button></div></section></main>;
}
