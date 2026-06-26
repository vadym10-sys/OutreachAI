'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { Bell, CheckCircle2, Loader2, Plus, Save, Search, Send, Wand2 } from 'lucide-react';
import { clientApi, splitList } from '@/lib/client-api';
import { hasClerkPublishableKey, isClerkE2EBypass } from '@/lib/env';
import type { Activity, Campaign, DashboardMetrics, Email, Lead, Notification, Profile, Settings } from '@/lib/types';

const pipeline = ['New', 'Qualified', 'Email Generated', 'Sent', 'Opened', 'Replied', 'Meeting', 'Won', 'Lost'];
const tones = ['Professional', 'Friendly', 'Direct', 'Consultative'];
const emptyMetrics: DashboardMetrics = { leads: 0, campaigns: 0, emails_sent: 0, delivered: 0, opened: 0, replies: 0, bounces: 0, open_rate: 0, reply_rate: 0, conversion_rate: 0, meetings: 0, revenue: 0, mrr: 0 };
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

export function DashboardHome() {
  const { api, ready } = useTokenApi();
  const [metrics, setMetrics] = useState<DashboardMetrics>(emptyMetrics);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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
    ['Reply rate', `${metrics.reply_rate}%`], ['Conversion', `${metrics.conversion_rate}%`], ['Meetings', metrics.meetings], ['Revenue', `$${metrics.revenue.toLocaleString()}`], ['MRR', `$${metrics.mrr.toLocaleString()}`]
  ];

  return <div className="min-w-0"><div className="flex flex-col gap-2"><h1 className="text-2xl font-bold min-[390px]:text-3xl">Dashboard</h1><p className="text-slate-600">Real workspace metrics from your campaigns, leads, email activity, and revenue pipeline.</p></div>{error && <Notice message={error} kind="error" />}{loading ? <div className="mt-6"><Skeleton lines={5} /></div> : <><div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{cards.map(([label, value]) => <section key={label} className="rounded-lg border border-slate-200 bg-white p-4"><p className="text-sm text-slate-500">{label}</p><p className="mt-2 text-2xl font-bold">{value}</p></section>)}</div><div className="mt-8 grid gap-6 lg:grid-cols-2"><section className="rounded-lg border border-slate-200 bg-white p-5"><h2 className="font-bold">Activity timeline</h2>{activity.length ? <div className="mt-4 space-y-3">{activity.map((item) => <div key={item.id} className="rounded-md bg-slate-50 p-3 text-sm"><p className="font-semibold">{item.action.replaceAll('.', ' ')}</p><p className="text-slate-500">{new Date(item.created_at).toLocaleString()}</p></div>)}</div> : <EmptyState title="No activity yet" copy="Create a campaign, import leads, or generate an email to start the timeline." />}</section><section className="rounded-lg border border-slate-200 bg-white p-5"><h2 className="flex items-center gap-2 font-bold"><Bell size={18} /> Notifications</h2>{notifications.length ? <div className="mt-4 space-y-3">{notifications.map((item) => <div key={item.id} className="rounded-md bg-slate-50 p-3 text-sm"><p className="font-semibold">{item.title}</p><p className="text-slate-500">{item.message}</p></div>)}</div> : <EmptyState title="No notifications" copy="Background jobs and important account events will appear here." />}</section></div></>}</div>;
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
      name: String(data.get('name') || ''), industry: String(data.get('industry') || ''), countries: splitList(String(data.get('countries') || '')), cities: splitList(String(data.get('cities') || '')),
      company_size: String(data.get('company_size') || ''), keywords: splitList(String(data.get('keywords') || '')), website_filters: splitList(String(data.get('website_filters') || '')),
      language: String(data.get('language') || 'English'), offer: String(data.get('offer') || ''), cta: String(data.get('cta') || ''), email_tone: String(data.get('email_tone') || 'Professional'), signature: String(data.get('signature') || ''), follow_up_days: Number(data.get('follow_up_days') || 3)
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

  return <div className="min-w-0"><h1 className="text-2xl font-bold min-[390px]:text-3xl">Campaign Builder</h1><p className="mt-2 text-slate-600">Create targeted outbound campaigns and generate editable personalized emails.</p>{notice && <Notice message={notice} kind={notice.startsWith('Select') ? 'warning' : 'success'} />}{loading ? <div className="mt-6"><Skeleton lines={4} /></div> : <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_0.9fr]"><form onSubmit={submit} className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 min-[360px]:p-5 sm:grid-cols-2"><input name="name" required placeholder="Campaign name" className="rounded-md border border-slate-300 px-3 py-2 sm:col-span-2" /><input name="industry" placeholder="Industry" className="rounded-md border border-slate-300 px-3 py-2" /><input name="company_size" placeholder="Company size" className="rounded-md border border-slate-300 px-3 py-2" /><input name="countries" placeholder="Countries, comma separated" className="rounded-md border border-slate-300 px-3 py-2" /><input name="cities" placeholder="Cities, comma separated" className="rounded-md border border-slate-300 px-3 py-2" /><input name="keywords" placeholder="Keywords" className="rounded-md border border-slate-300 px-3 py-2" /><input name="website_filters" placeholder="Website filters" className="rounded-md border border-slate-300 px-3 py-2" /><input name="language" defaultValue="English" className="rounded-md border border-slate-300 px-3 py-2" /><select name="email_tone" className="rounded-md border border-slate-300 px-3 py-2">{tones.map((tone) => <option key={tone}>{tone}</option>)}</select><textarea name="offer" placeholder="Offer" className="min-h-24 rounded-md border border-slate-300 p-3 sm:col-span-2" /><input name="cta" placeholder="CTA" className="rounded-md border border-slate-300 px-3 py-2" /><input name="follow_up_days" type="number" defaultValue="3" min="1" max="30" className="rounded-md border border-slate-300 px-3 py-2" /><textarea name="signature" placeholder="Signature" className="min-h-24 rounded-md border border-slate-300 p-3 sm:col-span-2" /><button className="focus-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-brand px-4 py-2 font-semibold text-white sm:col-span-2"><Plus size={18} /> Save campaign</button></form><section className="rounded-lg border border-slate-200 bg-white p-4 min-[360px]:p-5"><h2 className="font-bold">AI Email Generator</h2>{campaigns.length && leads.length ? <div className="mt-4 space-y-3"><select value={selectedCampaign} onChange={(event) => setSelectedCampaign(event.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2">{campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}</select><select value={selectedLead} onChange={(event) => setSelectedLead(event.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2">{leads.map((lead) => <option key={lead.id} value={lead.id}>{lead.company}</option>)}</select><button onClick={generateEmail} disabled={generating} className="focus-ring inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-ink px-4 py-2 font-semibold text-white disabled:opacity-60">{generating ? <Loader2 className="animate-spin" size={18} /> : <Wand2 size={18} />} Generate Email</button>{email && <div className="space-y-3"><div className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600">Delivery status: <span className="font-semibold text-ink">{email.delivery_status}</span></div><input value={email.subject} onChange={(e) => setEmail({ ...email, subject: e.target.value })} className="w-full rounded-md border border-slate-300 px-3 py-2" /><input value={email.preview} onChange={(e) => setEmail({ ...email, preview: e.target.value })} className="w-full rounded-md border border-slate-300 px-3 py-2" /><textarea value={email.body} onChange={(e) => setEmail({ ...email, body: e.target.value })} className="min-h-48 w-full rounded-md border border-slate-300 p-3" /><textarea value={email.follow_up_1 || ''} onChange={(e) => setEmail({ ...email, follow_up_1: e.target.value })} placeholder="Follow-up #1" className="min-h-28 w-full rounded-md border border-slate-300 p-3" /><textarea value={email.follow_up_2 || ''} onChange={(e) => setEmail({ ...email, follow_up_2: e.target.value })} placeholder="Follow-up #2" className="min-h-28 w-full rounded-md border border-slate-300 p-3" /><input value={email.cta} onChange={(e) => setEmail({ ...email, cta: e.target.value })} className="w-full rounded-md border border-slate-300 px-3 py-2" /><div className="grid gap-2 min-[430px]:grid-cols-2"><button onClick={saveEmail} className="focus-ring inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-slate-300 px-4 py-2 font-semibold"><Save size={18} /> Save email</button><button onClick={sendEmail} className="focus-ring inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-brand px-4 py-2 font-semibold text-white"><Send size={18} /> Send</button></div></div>}</div> : <EmptyState title="Campaigns and leads required" copy="Create a campaign and add a lead before generating AI emails." />}</section></div>}<div className="mt-6 grid gap-4 lg:grid-cols-3">{campaigns.map((campaign) => <article key={campaign.id} className="rounded-lg border border-slate-200 bg-white p-4"><div className="flex items-start justify-between gap-3"><div><h2 className="font-bold">{campaign.name}</h2><p className="text-sm text-slate-500">{campaign.industry || 'No industry set'}</p></div><span className="rounded-full bg-teal-50 px-3 py-1 text-xs font-semibold text-brand">{campaign.status}</span></div><dl className="mt-4 grid grid-cols-3 gap-2 text-sm"><div><dt className="text-slate-500">Leads</dt><dd className="font-bold">{campaign.leads}</dd></div><div><dt className="text-slate-500">Sent</dt><dd className="font-bold">{campaign.sent}</dd></div><div><dt className="text-slate-500">Replies</dt><dd className="font-bold">{campaign.replies}</dd></div></dl></article>)}</div>{!campaigns.length && !loading && <div className="mt-6"><EmptyState title="No campaigns" copy="Build your first outbound campaign to start generating emails." /></div>}</div>;
}

export function LeadManager() {
  const { api, ready } = useTokenApi();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState('');

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

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const lead = await api<Lead>('/api/leads', { method: 'POST', body: JSON.stringify({ company: data.get('company'), website: data.get('website'), industry: data.get('industry'), country: data.get('country'), contact: data.get('contact'), email: data.get('email') || null, campaign_id: data.get('campaign_id') || null }) });
    setLeads((items) => [lead, ...items.filter((item) => item.id !== lead.id)]);
    form.reset();
  }

  async function bulkStatus(nextStatus: string) {
    await api('/api/leads/bulk', { method: 'POST', body: JSON.stringify({ ids: selected, status: nextStatus }) });
    setLeads((items) => items.map((lead) => lead.id && selected.includes(lead.id) ? { ...lead, status: nextStatus } : lead));
    setSelected([]);
  }

  return <div className="min-w-0"><h1 className="text-2xl font-bold min-[390px]:text-3xl">Lead Management</h1><p className="mt-2 text-slate-600">Search, filter, sort, paginate, and bulk-manage real leads in your pipeline.</p>{error && <Notice message={error} kind="error" />}<form onSubmit={create} className="mt-6 grid gap-3 rounded-lg border border-slate-200 bg-white p-4 md:grid-cols-4"><input required name="company" placeholder="Company" className="rounded-md border border-slate-300 px-3 py-2" /><input name="website" placeholder="Website" className="rounded-md border border-slate-300 px-3 py-2" /><input name="industry" placeholder="Industry" className="rounded-md border border-slate-300 px-3 py-2" /><input name="country" placeholder="Country" className="rounded-md border border-slate-300 px-3 py-2" /><input name="contact" placeholder="Contact" className="rounded-md border border-slate-300 px-3 py-2" /><input name="email" placeholder="Email" className="rounded-md border border-slate-300 px-3 py-2" /><select name="campaign_id" className="rounded-md border border-slate-300 px-3 py-2"><option value="">No campaign</option>{campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}</select><button className="focus-ring rounded-md bg-brand px-4 py-2 font-semibold text-white">Add lead</button></form><div className="mt-5 flex flex-col gap-3 min-[430px]:flex-row"><div className="relative flex-1"><Search className="absolute left-3 top-3 text-slate-400" size={18} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search leads" className="w-full rounded-md border border-slate-300 py-2 pl-10 pr-3" /></div><select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-md border border-slate-300 px-3 py-2"><option value="">All statuses</option>{pipeline.map((item) => <option key={item}>{item}</option>)}</select><button onClick={load} className="focus-ring rounded-md border border-slate-300 px-4 py-2 font-semibold">Apply</button></div>{selected.length > 0 && <div className="mt-4 flex flex-wrap gap-2 rounded-lg border border-slate-200 bg-white p-3"><span className="py-2 text-sm font-semibold">{selected.length} selected</span>{pipeline.map((item) => <button key={item} onClick={() => bulkStatus(item)} className="focus-ring min-h-11 rounded-md border border-slate-300 px-3 text-sm">{item}</button>)}</div>}{loading ? <div className="mt-6"><Skeleton lines={5} /></div> : leads.length ? <div className="mt-6 space-y-3">{leads.map((lead) => <article key={lead.id || lead.company} className="rounded-lg border border-slate-200 bg-white p-4"><div className="flex items-start gap-3"><input type="checkbox" checked={Boolean(lead.id && selected.includes(lead.id))} onChange={(e) => setSelected((ids) => e.target.checked && lead.id ? [...ids, lead.id] : ids.filter((id) => id !== lead.id))} className="mt-1 size-5" /><div className="min-w-0 flex-1"><div className="flex flex-col gap-2 min-[430px]:flex-row min-[430px]:items-start min-[430px]:justify-between"><div><h2 className="font-bold">{lead.company}</h2><p className="break-all text-sm text-slate-500">{lead.email || lead.website || 'No contact yet'}</p></div><span className="w-fit rounded-full bg-teal-50 px-3 py-1 text-xs font-semibold text-brand">{lead.status}</span></div><dl className="mt-3 grid gap-2 text-sm min-[430px]:grid-cols-4"><div><dt className="text-slate-500">Industry</dt><dd>{lead.industry || '-'}</dd></div><div><dt className="text-slate-500">Country</dt><dd>{lead.country || '-'}</dd></div><div><dt className="text-slate-500">Contact</dt><dd>{lead.contact || '-'}</dd></div><div><dt className="text-slate-500">Campaign</dt><dd>{lead.campaign || '-'}</dd></div></dl></div></div></article>)}</div> : <div className="mt-6"><EmptyState title="No leads" copy="Add a lead manually or run Lead Finder to populate the pipeline." /></div>}</div>;
}

export function InboxAndActivity() {
  const { api, ready } = useTokenApi();
  const [activity, setActivity] = useState<Activity[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!ready) return;
    void Promise.resolve()
      .then(() => {
        setLoading(true);
        setError('');
        return Promise.all([api<Activity[]>('/api/activity'), api<Notification[]>('/api/notifications')]);
      })
      .then(([a, n]) => { setActivity(a); setNotifications(n); })
      .catch((nextError) => setError(nextError instanceof Error ? nextError.message : 'Inbox data could not be loaded.'))
      .finally(() => setLoading(false));
  }, [api, ready]);
  return <div className="min-w-0"><h1 className="text-2xl font-bold min-[390px]:text-3xl">Unified Inbox</h1><p className="mt-2 text-slate-600">Replies, notifications, tags, and activity events in one operational view.</p>{error && <Notice message={error} kind="error" />}{loading ? <div className="mt-6"><Skeleton lines={4} /></div> : <div className="mt-6 grid gap-6 lg:grid-cols-2"><section className="rounded-lg border border-slate-200 bg-white p-5"><h2 className="font-bold">Notifications</h2>{notifications.length ? <div className="mt-4 space-y-3">{notifications.map((item) => <div key={item.id} className="rounded-md bg-slate-50 p-3"><p className="font-semibold">{item.title}</p><p className="text-sm text-slate-500">{item.message}</p></div>)}</div> : <EmptyState title="No notifications" copy="Success, error, warning, and background job updates will appear here." />}</section><section className="rounded-lg border border-slate-200 bg-white p-5"><h2 className="font-bold">Activity</h2>{activity.length ? <div className="mt-4 space-y-3">{activity.map((item) => <div key={item.id} className="rounded-md bg-slate-50 p-3"><p className="font-semibold">{item.action.replaceAll('.', ' ')}</p><p className="text-sm text-slate-500">{new Date(item.created_at).toLocaleString()}</p></div>)}</div> : <EmptyState title="No activity" copy="Every campaign, lead, email, and reply action will be logged here." />}</section></div>}</div>;
}

export function SettingsAndProfile() {
  const { api, ready } = useTokenApi();
  const [profile, setProfile] = useState<Profile>({ workspace: '', company: '', timezone: 'UTC', language: 'English' });
  const [settings, setSettings] = useState<Settings | null>(null);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    if (!ready) return;
    Promise.all([api<Profile>('/api/profile'), api<Settings>('/api/settings')])
      .then(([p, s]) => { setProfile(p); setSettings(s); })
      .catch((nextError) => setNotice(nextError instanceof Error ? nextError.message : 'Settings could not be loaded.'));
  }, [api, ready]);
  async function saveProfile(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const data = new FormData(event.currentTarget); const saved = await api<Profile>('/api/profile', { method: 'PUT', body: JSON.stringify({ workspace: data.get('workspace'), company: data.get('company'), avatar_url: data.get('avatar_url') || null, timezone: data.get('timezone'), language: data.get('language') }) }); setProfile(saved); setNotice('Profile saved.'); }
  async function saveSettings() { if (!settings) return; await api<Settings>('/api/settings', { method: 'PUT', body: JSON.stringify(settings) }); setNotice('Settings saved.'); }
  return <div className="min-w-0"><h1 className="text-2xl font-bold min-[390px]:text-3xl">Settings</h1><p className="mt-2 text-slate-600">Workspace profile, company settings, AI, email, billing, security, and API preferences.</p>{notice && <Notice message={notice} />}{!settings ? <div className="mt-6"><Skeleton lines={5} /></div> : <div className="mt-6 grid gap-6 xl:grid-cols-[0.8fr_1.2fr]"><form onSubmit={saveProfile} className="space-y-3 rounded-lg border border-slate-200 bg-white p-5"><h2 className="font-bold">User profile</h2><input name="workspace" value={profile.workspace} onChange={(e) => setProfile({ ...profile, workspace: e.target.value })} placeholder="Workspace" className="w-full rounded-md border border-slate-300 px-3 py-2" /><input name="company" value={profile.company} onChange={(e) => setProfile({ ...profile, company: e.target.value })} placeholder="Company" className="w-full rounded-md border border-slate-300 px-3 py-2" /><input name="avatar_url" value={profile.avatar_url || ''} onChange={(e) => setProfile({ ...profile, avatar_url: e.target.value })} placeholder="Avatar URL" className="w-full rounded-md border border-slate-300 px-3 py-2" /><input name="timezone" value={profile.timezone} onChange={(e) => setProfile({ ...profile, timezone: e.target.value })} placeholder="Timezone" className="w-full rounded-md border border-slate-300 px-3 py-2" /><input name="language" value={profile.language} onChange={(e) => setProfile({ ...profile, language: e.target.value })} placeholder="Language" className="w-full rounded-md border border-slate-300 px-3 py-2" /><button className="focus-ring inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-brand px-4 py-2 font-semibold text-white"><CheckCircle2 size={18} /> Save profile</button><button type="button" onClick={() => api('/api/profile', { method: 'DELETE' }).then(() => setNotice('Delete account request queued.'))} className="focus-ring min-h-11 w-full rounded-md border border-red-200 px-4 py-2 font-semibold text-red-700">Delete account</button></form><section className="rounded-lg border border-slate-200 bg-white p-5"><h2 className="font-bold">Workspace settings</h2><div className="mt-4 grid gap-4 md:grid-cols-2">{(Object.keys(settings) as Array<keyof Settings>).map((key) => <label key={key} className="block rounded-md border border-slate-200 p-3"><span className="text-sm font-semibold capitalize">{key}</span><textarea value={JSON.stringify(settings[key], null, 2)} onChange={(e) => { try { setSettings({ ...settings, [key]: JSON.parse(e.target.value) }); } catch {} }} className="mt-2 min-h-32 w-full rounded-md border border-slate-300 p-2 font-mono text-xs" /></label>)}</div><button onClick={saveSettings} className="focus-ring mt-4 min-h-11 rounded-md bg-ink px-4 py-2 font-semibold text-white"><Save size={18} className="mr-2 inline" />Save settings</button></section></div>}</div>;
}

export function AnalyticsReal() { return <DashboardHome />; }
