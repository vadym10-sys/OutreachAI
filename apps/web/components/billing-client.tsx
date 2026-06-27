'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { CalendarDays, CheckCircle2, CreditCard, Loader2, TrendingUp } from 'lucide-react';
import { clientApi } from '@/lib/client-api';
import { appUrl, hasClerkPublishableKey, isClerkE2EBypass } from '@/lib/env';
import type { BillingPlan, BillingStatus } from '@/lib/types';

const pendingPlanKey = 'outreachai.pendingPlan';
const planNames = ['Starter', 'Pro', 'Agency'] as const;

type PlanName = typeof planNames[number];

type Diagnostics = {
  stripe_secret_loaded: boolean;
  webhook_secret_loaded: boolean;
  publishable_key_loaded: boolean;
  starter_price_id_loaded: boolean;
  pro_price_id_loaded: boolean;
  agency_price_id_loaded: boolean;
  checkout_session_creation_works: boolean;
  webhook_receives_signed_events: boolean;
  subscription_sync_healthy: boolean;
};

type RuntimeDiagnostics = {
  stripe_publishable_key_loaded: boolean;
  stripe_publishable_key_live: boolean;
};

function isPlan(value: string | null): value is PlanName {
  return Boolean(value && planNames.includes(value as PlanName));
}

function safePendingPlan(action: "get" | "set" | "remove", value?: PlanName) {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    if (action === "set" && value) {
      window.localStorage.setItem(pendingPlanKey, value);
      return value;
    }
    if (action === "remove") {
      window.localStorage.removeItem(pendingPlanKey);
      return null;
    }
    return window.localStorage.getItem(pendingPlanKey);
  } catch (error) {
    console.error("Billing localStorage access failed", error);
    return null;
  }
}

function safeRedirect(url: string) {
  try {
    window.location.assign(url);
  } catch (error) {
    console.error("Redirect failed", error);
    window.location.href = url;
  }
}

async function apiWithToken<T>(path: string, token: string | null, init: RequestInit = {}) {
  return clientApi<T>(path, token || (isClerkE2EBypass ? 'dev' : null), init);
}

function useBillingAuth() {
  if (!hasClerkPublishableKey || isClerkE2EBypass) {
    return { getToken: async () => isClerkE2EBypass ? 'dev' : null, isLoaded: true, isSignedIn: isClerkE2EBypass };
  }

  // The no-Clerk branch is required for local/E2E builds where ClerkProvider is intentionally not mounted.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useClerkBillingAuth();
}

function useClerkBillingAuth() {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  return { getToken, isLoaded, isSignedIn };
}

function formatDate(value?: string | null) {
  if (!value) return 'Not scheduled';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value));
}

function usagePercent(used: number, limit: number | boolean | undefined) {
  if (!limit || typeof limit === 'boolean') return 0;
  return Math.min(100, Math.round((used / limit) * 100));
}

function limitLabel(key: string, value: number | boolean) {
  if (typeof value === 'boolean') return `${key.replaceAll('_', ' ')}: ${value ? 'Included' : 'Upgrade required'}`;
  if (value === 0) return `${key.replaceAll('_', ' ')}: Unlimited`;
  return `${key.replaceAll('_', ' ')}: ${value.toLocaleString()}`;
}

export function PricingCheckoutButton({ plan, children = 'Subscribe' }: { plan: PlanName; children?: React.ReactNode }) {
  const { getToken, isLoaded, isSignedIn } = useBillingAuth();
  const [loading, setLoading] = useState(false);

  async function startCheckout() {
    safePendingPlan("set", plan);
    if (!hasClerkPublishableKey || !isLoaded || !isSignedIn) {
      safeRedirect(`/sign-up?plan=${encodeURIComponent(plan)}`);
      return;
    }
    setLoading(true);
    try {
      const token = await getToken();
      const session = await apiWithToken<{ url: string }>('/api/billing/checkout', token, {
        method: 'POST',
        body: JSON.stringify({ plan })
      });
      safePendingPlan("remove");
      safeRedirect(session.url);
    } catch (nextError) {
      console.error("Checkout start failed", nextError);
    } finally {
      setLoading(false);
    }
  }

  return <button onClick={startCheckout} disabled={loading} className="focus-ring inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-ink px-5 py-3 text-center text-sm font-semibold text-white shadow-soft transition hover:bg-slate-800 disabled:opacity-60 min-[360px]:w-auto">{loading ? <Loader2 className="animate-spin" size={18} /> : <CreditCard size={18} />}{children}</button>;
}

export function CheckoutContinuation() {
  const { getToken, isLoaded, isSignedIn } = useBillingAuth();
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || running) return;
    const plan = safePendingPlan("get");
    if (!isPlan(plan)) return;
    const schedule = typeof window.queueMicrotask === "function" ? window.queueMicrotask : (callback: () => void) => window.setTimeout(callback, 0);
    schedule(() => {
      setRunning(true);
      void getToken()
        .then((token) => apiWithToken<{ url: string }>('/api/billing/checkout', token, { method: 'POST', body: JSON.stringify({ plan }) }))
        .then((session) => {
          safePendingPlan("remove");
          safeRedirect(session.url);
        })
        .catch((error) => {
          console.error("Checkout continuation failed", error);
          setRunning(false);
        });
    });
  }, [getToken, isLoaded, isSignedIn, running]);

  return null;
}

export function BillingWorkspace() {
  const { getToken, isLoaded, isSignedIn } = useBillingAuth();
  const [plans, setPlans] = useState<BillingPlan[]>([]);
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const [runtimeDiagnostics, setRuntimeDiagnostics] = useState<RuntimeDiagnostics | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const token = useCallback(async () => isClerkE2EBypass ? 'dev' : await getToken(), [getToken]);

  useEffect(() => {
    if (hasClerkPublishableKey && (!isLoaded || !isSignedIn)) return;
    void Promise.resolve()
      .then(async () => {
        const authToken = await token();
        const [nextPlans, nextDiagnostics, nextStatus, nextRuntimeDiagnostics] = await Promise.all([
          apiWithToken<BillingPlan[]>('/api/billing/plans', authToken),
          apiWithToken<Diagnostics>('/api/billing/diagnostics', authToken),
          apiWithToken<BillingStatus>('/api/billing/status', authToken),
          fetch('/api/runtime-diagnostics', { cache: 'no-store' }).then((response) => {
            if (!response.ok) throw new Error('Runtime diagnostics could not be loaded.');
            return response.json() as Promise<RuntimeDiagnostics>;
          })
        ]);
        setPlans(nextPlans);
        setStatus(nextStatus);
        setDiagnostics(nextDiagnostics);
        setRuntimeDiagnostics(nextRuntimeDiagnostics);
      })
      .catch((nextError) => setError(nextError instanceof Error ? nextError.message : 'Billing could not be loaded.'))
      .finally(() => setLoading(false));
  }, [isLoaded, isSignedIn, token]);

  async function checkout(plan: string) {
    setBusy(plan);
    setError('');
    try {
      const authToken = await token();
      const current = plans.find((item) => item.current && item.active_subscription);
      const session = current
        ? await apiWithToken<{ url: string }>('/api/billing/portal', authToken, { method: 'POST', body: JSON.stringify({ return_url: `${appUrl}/dashboard/billing` }) })
        : await apiWithToken<{ url: string }>('/api/billing/checkout', authToken, { method: 'POST', body: JSON.stringify({ plan }) });
      safeRedirect(session.url);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Stripe session could not be created.');
    } finally {
      setBusy('');
    }
  }

  const diagnosticsRows = diagnostics ? [
    ['Stripe secret loaded', diagnostics.stripe_secret_loaded],
    ['Webhook secret loaded', diagnostics.webhook_secret_loaded],
    ['Frontend publishable key loaded', Boolean(runtimeDiagnostics?.stripe_publishable_key_loaded)],
    ['Frontend publishable key is live', Boolean(runtimeDiagnostics?.stripe_publishable_key_live)],
    ['Starter price ID', diagnostics.starter_price_id_loaded],
    ['Pro price ID', diagnostics.pro_price_id_loaded],
    ['Agency price ID', diagnostics.agency_price_id_loaded],
    ['Checkout session creation', diagnostics.checkout_session_creation_works],
    ['Webhook receives signed events', diagnostics.webhook_receives_signed_events],
    ['Subscription sync healthy', diagnostics.subscription_sync_healthy],
    ['Billing status endpoint healthy', Boolean(status)]
  ] : [];
  const billingOperational = diagnosticsRows.length > 0 && diagnosticsRows.every(([, value]) => Boolean(value));

  const usageRows = status ? [
    ['Leads used this month', status.usage.leads || 0, status.limits.leads],
    ['AI emails used this month', status.usage.ai_generations || 0, status.limits.ai_generations],
    ['Email sends used this month', status.usage.email_sends || 0, status.limits.email_sends],
    ['AI Sales Employees used', status.sales_employees_used, status.limits.sales_employees],
    ['Workspace usage', status.workspaces_used, status.limits.workspaces]
  ] as const : [];

  return <div className="min-w-0"><CheckoutContinuation /><h1 className="text-2xl font-bold min-[390px]:text-3xl">Billing</h1><p className="mt-2 text-slate-600">Choose a monthly Stripe subscription, upgrade or downgrade plans, and open the Billing Portal for active subscriptions.</p>{error && <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}{loading ? <div className="mt-6 h-48 animate-pulse rounded-lg bg-slate-200" /> : <><section className="mt-6 rounded-lg border border-slate-200 bg-white p-5"><div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between"><div><p className="text-sm font-semibold text-brand">Current subscription</p><h2 className="mt-2 text-2xl font-bold">{status?.plan || 'Starter'} · €{status?.price || 49}/month</h2><p className="mt-1 text-sm text-slate-600">Status: <span className="font-semibold capitalize">{status?.status || 'inactive'}</span>{status?.trial_days_remaining ? ` · ${status.trial_days_remaining} trial days remaining` : ''}</p></div><div className="grid gap-2 text-sm text-slate-600 min-[390px]:grid-cols-2"><span className="inline-flex items-center gap-2"><CalendarDays size={16} />Trial ends: {formatDate(status?.trial_end)}</span><span className="inline-flex items-center gap-2"><TrendingUp size={16} />Next billing: {formatDate(status?.current_period_end)}</span></div></div><div className="mt-5 grid gap-3 md:grid-cols-2 lg:grid-cols-5">{usageRows.map(([label, used, limit]) => <div key={label} className="rounded-md bg-slate-50 p-3"><p className="text-xs font-semibold uppercase text-slate-500">{label}</p><p className="mt-2 text-lg font-bold">{used.toLocaleString()} / {limit === 0 ? 'Unlimited' : typeof limit === 'boolean' ? String(limit) : Number(limit || 0).toLocaleString()}</p><div className="mt-3 h-2 rounded-full bg-slate-200"><div className="h-2 rounded-full bg-brand" style={{ width: `${usagePercent(used, limit)}%` }} /></div></div>)}</div></section><div className="mt-6 grid gap-4 lg:grid-cols-3">{plans.map((plan) => <section key={plan.name} className="rounded-lg border border-slate-200 bg-white p-5"><div className="flex items-start justify-between gap-3"><div><h2 className="text-xl font-bold">{plan.name}</h2><p className="mt-2 text-3xl font-bold">€{plan.price}<span className="text-base font-medium text-slate-500">/mo</span></p><p className="mt-1 text-sm font-semibold text-brand">14-day free trial</p></div>{plan.current && <span className="rounded-full bg-teal-50 px-3 py-1 text-xs font-semibold text-brand">Active</span>}</div><ul className="mt-5 space-y-2 text-sm text-slate-700">{Object.entries(plan.limits).filter(([key]) => !['mrr'].includes(key)).slice(0, 10).map(([key, value]) => <li key={key} className="flex gap-2"><CheckCircle2 className="mt-0.5 shrink-0 text-brand" size={17} />{limitLabel(key, value)}</li>)}</ul><button onClick={() => checkout(plan.name)} disabled={busy === plan.name} className="focus-ring mt-6 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-ink px-4 py-2 font-semibold text-white disabled:opacity-60">{busy === plan.name ? <Loader2 className="animate-spin" size={18} /> : <CreditCard size={18} />}{plan.current ? 'Manage Billing' : `Subscribe to ${plan.name}`}</button></section>)}</div><section className="mt-6 rounded-lg border border-slate-200 bg-white p-5"><div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><h2 className="font-bold">Billing diagnostics</h2><p className={`text-sm font-bold ${billingOperational ? 'text-brand' : 'text-red-700'}`}>{billingOperational ? '🟢 Billing System Operational' : 'Billing System Needs Attention'}</p></div><div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{diagnosticsRows.map(([label, value]) => <div key={String(label)} className="rounded-md bg-slate-50 p-3 text-sm"><span className="font-semibold">{label}</span><span className={`ml-2 font-bold ${value ? 'text-brand' : 'text-red-700'}`}>{String(Boolean(value))}</span></div>)}</div></section></>}</div>;
}

export function BillingDiagnosticsOnly() {
  return <BillingWorkspace />;
}
