'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { AlertTriangle, CalendarDays, CheckCircle2, CreditCard, Loader2, TrendingUp } from 'lucide-react';
import { clientApi, friendlyErrorMessage } from '@/lib/client-api';
import { appUrl, hasClerkPublishableKey, isClerkE2EBypass } from '@/lib/env';
import { useI18n } from '@/lib/i18n/provider';
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
    if (process.env.NODE_ENV !== "production") {
      console.error("Billing storage access failed", error);
    }
    return null;
  }
}

function safeRedirect(url: string) {
  try {
    window.location.assign(url);
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.error("Redirect failed", error);
    }
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
      if (process.env.NODE_ENV !== "production") {
        console.error("Checkout start failed", nextError);
      }
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
          if (process.env.NODE_ENV !== "production") {
            console.error("Checkout continuation failed", error);
          }
          setRunning(false);
        });
    });
  }, [getToken, isLoaded, isSignedIn, running]);

  return null;
}

export function BillingWorkspace({ showDiagnostics = false }: { showDiagnostics?: boolean }) {
  const { getToken, isLoaded, isSignedIn } = useBillingAuth();
  const { t, formatDate, formatNumber, formatCurrency } = useI18n();
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
        const [nextPlans, nextStatus] = await Promise.all([
          apiWithToken<BillingPlan[]>('/api/billing/plans', authToken),
          apiWithToken<BillingStatus>('/api/billing/status', authToken)
        ]);
        setPlans(nextPlans);
        setStatus(nextStatus);
        if (showDiagnostics && process.env.NODE_ENV !== 'production') {
          const [nextDiagnostics, nextRuntimeDiagnostics] = await Promise.all([
            apiWithToken<Diagnostics>('/api/billing/diagnostics', authToken),
            fetch('/api/runtime-diagnostics', { cache: 'no-store' }).then((response) => {
              if (!response.ok) {
                if (process.env.NODE_ENV !== 'production') {
                  console.error('Runtime billing diagnostics failed', { status: response.status });
                }
                throw new Error('REQUEST_FAILED');
              }
              return response.json() as Promise<RuntimeDiagnostics>;
            })
          ]);
          setDiagnostics(nextDiagnostics);
          setRuntimeDiagnostics(nextRuntimeDiagnostics);
        } else if (showDiagnostics) {
          setDiagnostics(await apiWithToken<Diagnostics>('/api/billing/diagnostics', authToken));
        }
      })
      .catch((nextError) => setError(friendlyErrorMessage(nextError, 'Billing could not be loaded. Please refresh and try again.')))
      .finally(() => setLoading(false));
  }, [isLoaded, isSignedIn, showDiagnostics, token]);

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
      setError(friendlyErrorMessage(nextError, 'Secure billing could not be opened. Please try again.'));
    } finally {
      setBusy('');
    }
  }

  const diagnosticsRows = diagnostics ? [
    ['Billing connection loaded', diagnostics.stripe_secret_loaded],
    ['Webhook secret loaded', diagnostics.webhook_secret_loaded],
    ...(runtimeDiagnostics ? [
      ['Frontend publishable key loaded', Boolean(runtimeDiagnostics.stripe_publishable_key_loaded)],
      ['Frontend publishable key is live', Boolean(runtimeDiagnostics.stripe_publishable_key_live)]
    ] as const : []),
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

	  const hasActiveSubscription = Boolean(plans.find((item) => item.current && item.active_subscription));
  const paymentNeedsAttention = Boolean(status?.last_failure_message || status?.last_decline_code || ['past_due', 'incomplete', 'unpaid'].includes(String(status?.status || '')));
  const paymentFailureCopy = status?.last_failure_message || t('billing.paymentFailedFallback');

  return <div className="min-w-0"><CheckoutContinuation /><header className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"><p className="text-sm font-semibold text-brand">Billing</p><h1 className="mt-2 text-2xl font-bold min-[390px]:text-3xl">Keep OutreachAI working for your sales team</h1><p className="mt-2 max-w-2xl text-slate-600">Choose one monthly plan, track usage, and manage payment safely. Your subscription unlocks lead discovery, AI email generation, and reviewed campaign execution.</p></header>{error && <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}{loading ? <div className="mt-6 h-48 animate-pulse rounded-lg bg-slate-200" /> : <><section className="mt-6 grid gap-3 md:grid-cols-4">{[['Why this page exists', 'Billing keeps your lead, AI, and sending limits clear.'], ['Expected result', 'You know your current plan and what is available this month.'], ['Time', 'Plan changes usually take less than one minute.'], ['Success', hasActiveSubscription ? 'Your subscription is active and billing can be managed securely.' : 'Pick a plan to start the 14-day trial.']].map(([label, copy]) => <article key={label} className="rounded-lg border border-slate-200 bg-white p-4 text-sm shadow-sm"><h2 className="font-bold text-ink">{label}</h2><p className="mt-2 text-slate-600">{copy}</p></article>)}</section>{paymentNeedsAttention && <section className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-5 text-amber-950"><div className="flex gap-3"><AlertTriangle className="mt-1 shrink-0" size={20} /><div><h2 className="font-bold">{t('billing.paymentNeedsAttention')}</h2><p className="mt-2 text-sm leading-6">{paymentFailureCopy}</p>{status?.last_payment_failed_at && <p className="mt-2 text-xs font-semibold">{t('billing.lastFailedAt')}: {formatDate(status.last_payment_failed_at, { dateStyle: 'medium', timeStyle: 'short' })}</p>}<p className="mt-3 text-sm">{t('billing.paymentNotActivated')}</p></div></div></section>}<section className="mt-6 rounded-lg border border-slate-200 bg-white p-5"><div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between"><div><p className="text-sm font-semibold text-brand">Current subscription</p><h2 className="mt-2 text-2xl font-bold">{status?.plan || 'Starter'} · {formatCurrency(status?.price || 49)}/month</h2><p className="mt-1 text-sm text-slate-600">Status: <span className="font-semibold capitalize">{status?.status || 'inactive'}</span>{status?.trial_days_remaining ? ` · ${status.trial_days_remaining} trial days remaining` : ''}</p></div><div className="grid gap-2 text-sm text-slate-600 min-[390px]:grid-cols-2"><span className="inline-flex items-center gap-2"><CalendarDays size={16} />Trial ends: {formatDate(status?.trial_end, { dateStyle: 'medium' })}</span><span className="inline-flex items-center gap-2"><TrendingUp size={16} />Next billing: {formatDate(status?.current_period_end, { dateStyle: 'medium' })}</span></div></div><div className="mt-5 grid gap-3 md:grid-cols-2 lg:grid-cols-5">{usageRows.map(([label, used, limit]) => <div key={label} className="rounded-md bg-slate-50 p-3"><p className="text-xs font-semibold uppercase text-slate-500">{label}</p><p className="mt-2 text-lg font-bold">{formatNumber(used)} / {limit === 0 ? 'Unlimited' : typeof limit === 'boolean' ? String(limit) : formatNumber(Number(limit || 0))}</p><div className="mt-3 h-2 rounded-full bg-slate-200"><div className="h-2 rounded-full bg-brand" style={{ width: `${usagePercent(used, limit)}%` }} /></div></div>)}</div></section><div className="mt-6 grid gap-4 lg:grid-cols-3">{plans.map((plan) => <section key={plan.name} className="rounded-lg border border-slate-200 bg-white p-5"><div className="flex items-start justify-between gap-3"><div><h2 className="text-xl font-bold">{plan.name}</h2><p className="mt-2 text-3xl font-bold">{formatCurrency(plan.price)}<span className="text-base font-medium text-slate-500">/mo</span></p><p className="mt-1 text-sm font-semibold text-brand">14-day free trial</p></div>{plan.current && <span className="rounded-full bg-teal-50 px-3 py-1 text-xs font-semibold text-brand">Active</span>}</div><ul className="mt-5 space-y-2 text-sm text-slate-700">{Object.entries(plan.limits).filter(([key]) => !['mrr'].includes(key)).slice(0, 10).map(([key, value]) => <li key={key} className="flex gap-2"><CheckCircle2 className="mt-0.5 shrink-0 text-brand" size={17} />{limitLabel(key, value)}</li>)}</ul><button onClick={() => checkout(plan.name)} disabled={busy === plan.name} className="focus-ring mt-6 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-ink px-4 py-2 font-semibold text-white disabled:opacity-60">{busy === plan.name ? <Loader2 className="animate-spin" size={18} /> : <CreditCard size={18} />}{plan.current ? 'Manage Billing' : `Start ${plan.name}`}</button></section>)}</div>{showDiagnostics && <section className="mt-6 rounded-lg border border-slate-200 bg-white p-5"><div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><h2 className="font-bold">Owner billing health</h2><p className={`text-sm font-bold ${billingOperational ? 'text-brand' : 'text-red-700'}`}>{billingOperational ? 'Billing System Operational' : 'Billing System Needs Attention'}</p></div><div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{diagnosticsRows.map(([label, value]) => <div key={String(label)} className="rounded-md bg-slate-50 p-3 text-sm"><span className="font-semibold">{label}</span><span className={`ml-2 font-bold ${value ? 'text-brand' : 'text-red-700'}`}>{String(Boolean(value))}</span></div>)}</div></section>}</>}</div>;
}

export function BillingDiagnosticsOnly() {
  return <BillingWorkspace showDiagnostics />;
}
