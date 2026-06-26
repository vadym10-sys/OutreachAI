'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { CheckCircle2, CreditCard, Loader2 } from 'lucide-react';
import { clientApi } from '@/lib/client-api';
import { appUrl, hasClerkPublishableKey, isClerkE2EBypass, stripePublishableKey } from '@/lib/env';
import type { BillingPlan } from '@/lib/types';

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
};

function isPlan(value: string | null): value is PlanName {
  return Boolean(value && planNames.includes(value as PlanName));
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

export function PricingCheckoutButton({ plan, children = 'Subscribe' }: { plan: PlanName; children?: React.ReactNode }) {
  const { getToken, isLoaded, isSignedIn } = useBillingAuth();
  const [loading, setLoading] = useState(false);

  async function startCheckout() {
    window.localStorage.setItem(pendingPlanKey, plan);
    if (!hasClerkPublishableKey || !isLoaded || !isSignedIn) {
      window.location.assign(`/sign-up?plan=${encodeURIComponent(plan)}`);
      return;
    }
    setLoading(true);
    try {
      const token = await getToken();
      const session = await apiWithToken<{ url: string }>('/api/billing/checkout', token, {
        method: 'POST',
        body: JSON.stringify({ plan })
      });
      window.localStorage.removeItem(pendingPlanKey);
      window.location.assign(session.url);
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
    const plan = window.localStorage.getItem(pendingPlanKey);
    if (!isPlan(plan)) return;
    window.queueMicrotask(() => {
      setRunning(true);
      void getToken()
        .then((token) => apiWithToken<{ url: string }>('/api/billing/checkout', token, { method: 'POST', body: JSON.stringify({ plan }) }))
        .then((session) => {
          window.localStorage.removeItem(pendingPlanKey);
          window.location.assign(session.url);
        })
        .catch(() => setRunning(false));
    });
  }, [getToken, isLoaded, isSignedIn, running]);

  return null;
}

export function BillingWorkspace() {
  const { getToken, isLoaded, isSignedIn } = useBillingAuth();
  const [plans, setPlans] = useState<BillingPlan[]>([]);
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const token = useCallback(async () => isClerkE2EBypass ? 'dev' : await getToken(), [getToken]);

  useEffect(() => {
    if (hasClerkPublishableKey && (!isLoaded || !isSignedIn)) return;
    void Promise.resolve()
      .then(async () => {
        const authToken = await token();
        const [nextPlans, nextDiagnostics] = await Promise.all([
          apiWithToken<BillingPlan[]>('/api/billing/plans', authToken),
          apiWithToken<Diagnostics>('/api/billing/diagnostics', authToken)
        ]);
        setPlans(nextPlans);
        setDiagnostics({ ...nextDiagnostics, publishable_key_loaded: Boolean(stripePublishableKey) });
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
      window.location.assign(session.url);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Stripe session could not be created.');
    } finally {
      setBusy('');
    }
  }

  const diagnosticsRows = diagnostics ? [
    ['Stripe secret loaded', diagnostics.stripe_secret_loaded],
    ['Webhook secret loaded', diagnostics.webhook_secret_loaded],
    ['Publishable key loaded', diagnostics.publishable_key_loaded],
    ['Starter price ID loaded', diagnostics.starter_price_id_loaded],
    ['Pro price ID loaded', diagnostics.pro_price_id_loaded],
    ['Agency price ID loaded', diagnostics.agency_price_id_loaded]
  ] : [];

  return <div className="min-w-0"><CheckoutContinuation /><h1 className="text-2xl font-bold min-[390px]:text-3xl">Billing</h1><p className="mt-2 text-slate-600">Choose a monthly Stripe subscription, upgrade or downgrade plans, and open the Billing Portal for active subscriptions.</p>{error && <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}{loading ? <div className="mt-6 h-48 animate-pulse rounded-lg bg-slate-200" /> : <><div className="mt-6 grid gap-4 lg:grid-cols-3">{plans.map((plan) => <section key={plan.name} className="rounded-lg border border-slate-200 bg-white p-5"><div className="flex items-start justify-between gap-3"><div><h2 className="text-xl font-bold">{plan.name}</h2><p className="mt-2 text-3xl font-bold">€{plan.price}<span className="text-base font-medium text-slate-500">/mo</span></p></div>{plan.current && <span className="rounded-full bg-teal-50 px-3 py-1 text-xs font-semibold text-brand">Active</span>}</div><ul className="mt-5 space-y-2 text-sm text-slate-700">{Object.entries(plan.limits).filter(([key]) => key !== 'mrr').map(([key, value]) => <li key={key} className="flex gap-2"><CheckCircle2 className="text-brand" size={17} />{key.replaceAll('_', ' ')}: {value}</li>)}</ul><button onClick={() => checkout(plan.name)} disabled={busy === plan.name} className="focus-ring mt-6 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-ink px-4 py-2 font-semibold text-white disabled:opacity-60">{busy === plan.name ? <Loader2 className="animate-spin" size={18} /> : <CreditCard size={18} />}{plan.current ? 'Manage Billing' : `Subscribe to ${plan.name}`}</button></section>)}</div><section className="mt-6 rounded-lg border border-slate-200 bg-white p-5"><h2 className="font-bold">Billing diagnostics</h2><div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{diagnosticsRows.map(([label, value]) => <div key={String(label)} className="rounded-md bg-slate-50 p-3 text-sm"><span className="font-semibold">{label}</span><span className={`ml-2 font-bold ${value ? 'text-brand' : 'text-red-700'}`}>{String(Boolean(value))}</span></div>)}</div></section></>}</div>;
}

export function BillingDiagnosticsOnly() {
  return <BillingWorkspace />;
}
