"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { Activity, AlertTriangle, BarChart3, CheckCircle2, Crown, Flag, Loader2, Lock, Server, Sparkles, Users, type LucideIcon } from "lucide-react";
import { apiUrl, e2eUserEmail, hasClerkPublishableKey, isClerkE2EBypass } from "@/lib/env";
import { friendlyErrorMessage } from "@/lib/client-api";
import { useI18n } from "@/lib/i18n/provider";

type OwnerFeatureFlags = {
  ai_ceo_voice: boolean;
  experimental_features: boolean;
  admin_nav: boolean;
  analytics_nav: boolean;
  ai_marketplace: boolean;
};

type OwnerAuditLog = {
  id: string;
  action: string;
  metadata_json?: Record<string, unknown>;
  created_at: string;
};

type OwnerConsoleData = {
  executive_overview: Record<string, string | number>;
  revenue: Record<string, number>;
  customers: Record<string, number>;
  subscriptions: Record<string, number>;
  ai_usage: Record<string, number>;
  product_analytics: Record<string, string | number>;
  error_monitoring: Record<string, string | number>;
  system_health: Record<string, string>;
  feature_flags: OwnerFeatureFlags;
  audit_logs: OwnerAuditLog[];
};

const flagLabels: Array<[keyof OwnerFeatureFlags, string]> = [
  ["ai_ceo_voice", "AI CEO Voice"],
  ["experimental_features", "Experimental features"],
  ["admin_nav", "Admin nav"],
  ["analytics_nav", "Analytics nav"],
  ["ai_marketplace", "AI Marketplace"]
];

const noClerkOwnerAuth = {
  getToken: async () => (isClerkE2EBypass ? "dev" : null),
  isLoaded: true,
  isSignedIn: isClerkE2EBypass
};

function e2eOwnerEmail() {
  try {
    if (typeof window === "undefined") return e2eUserEmail;
    return window.localStorage.getItem("outreachai.e2eUserEmail") || e2eUserEmail;
  } catch (error) {
    console.error("Owner console test email lookup failed", error);
    return e2eUserEmail;
  }
}

function useOwnerAuth() {
  if (!hasClerkPublishableKey || isClerkE2EBypass) {
    return noClerkOwnerAuth;
  }

  // The no-Clerk branch is required for local/E2E builds where ClerkProvider is intentionally not mounted.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useClerkOwnerAuth();
}

function useClerkOwnerAuth() {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  return { getToken, isLoaded, isSignedIn };
}

async function ownerRequest<T>(path: string, token: string | null, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(isClerkE2EBypass ? { "X-Test-User-Email": e2eOwnerEmail() } : {}),
      ...init.headers
    }
  });

  if (response.status === 403) {
    const error = new Error("ACCESS_DENIED");
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
    console.error("Owner Console API request failed", { path, status: response.status, detail });
    throw new Error("REQUEST_FAILED");
  }

  return response.json() as Promise<T>;
}

function StatCard({ label, value, icon: Icon }: { label: string; value: string | number; icon: LucideIcon }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-slate-500">{label}</p>
        <Icon className="text-brand" size={18} aria-hidden="true" />
      </div>
      <p className="mt-3 text-2xl font-bold text-ink">{value}</p>
    </div>
  );
}

function KeyValuePanel({ title, values }: { title: string; values: Record<string, string | number> }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-base font-bold text-ink">{title}</h2>
      <div className="mt-4 divide-y divide-slate-100">
        {Object.entries(values).map(([key, value]) => (
          <div key={key} className="flex min-h-11 items-center justify-between gap-4 py-2 text-sm">
            <span className="capitalize text-slate-500">{key.replaceAll("_", " ")}</span>
            <span className="text-right font-semibold text-ink">{String(value)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function AuditMetadata({ metadata }: { metadata?: Record<string, unknown> }) {
  const entries = Object.entries(metadata || {}).filter(([, value]) => value !== null && value !== undefined && value !== "");
  if (!entries.length) return <p className="mt-1 text-xs text-slate-500">No extra details</p>;
  return (
    <dl className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
      {entries.slice(0, 6).map(([key, value]) => (
        <div key={key} className="rounded-md bg-slate-50 px-3 py-2">
          <dt className="font-semibold capitalize text-slate-500">{key.replaceAll("_", " ")}</dt>
          <dd className="mt-1 break-words text-slate-700">{Array.isArray(value) ? value.join(", ") : typeof value === "object" ? "Saved details" : String(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

export function OwnerConsole() {
  const { t } = useI18n();
  const { getToken, isLoaded, isSignedIn } = useOwnerAuth();
  const [data, setData] = useState<OwnerConsoleData | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingFlag, setSavingFlag] = useState<string | null>(null);
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
      const response = await ownerRequest<OwnerConsoleData>("/api/owner/console", token);
      setData(response);
      setAccessDenied(false);
    } catch (nextError) {
      if (nextError instanceof Error && nextError.name === "AccessDeniedError") {
        setAccessDenied(true);
      } else {
        setError(friendlyErrorMessage(nextError, t("owner.loadError")));
      }
    } finally {
      setLoading(false);
    }
  }, [getToken, isLoaded, isSignedIn, t]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function toggleFlag(flag: keyof OwnerFeatureFlags) {
    if (!data || savingFlag) return;
    setSavingFlag(flag);
    setError("");
    try {
      const token = await getToken();
      const featureFlags = await ownerRequest<OwnerFeatureFlags>("/api/owner/feature-flags", token, {
        method: "PATCH",
        body: JSON.stringify({ [flag]: !data.feature_flags[flag] })
      });
      setData({ ...data, feature_flags: featureFlags });
    } catch (nextError) {
      setError(friendlyErrorMessage(nextError, t("owner.flagError")));
    } finally {
      setSavingFlag(null);
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-28 animate-pulse rounded-lg bg-slate-200" />
        <div className="grid gap-4 md:grid-cols-3">
          {[1, 2, 3].map((item) => <div key={item} className="h-32 animate-pulse rounded-lg bg-slate-200" />)}
        </div>
      </div>
    );
  }

  if (accessDenied) {
    return (
      <div className="mx-auto max-w-xl rounded-lg border border-slate-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto grid size-12 place-items-center rounded-full bg-red-50 text-red-600">
          <Lock size={22} aria-hidden="true" />
        </div>
        <h1 className="mt-4 text-2xl font-bold text-ink">{t("owner.accessDenied")}</h1>
        <p className="mt-2 text-sm text-slate-600">{t("owner.accessDeniedCopy")}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-lg border border-orange-200 bg-orange-50 p-5 text-sm text-orange-800">
        {error || t("owner.loadError")}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700">
              <Crown size={14} aria-hidden="true" />
              {t("owner.badge")}
            </div>
            <h1 className="mt-3 text-2xl font-bold text-ink md:text-3xl">{t("owner.title")}</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-600">{t("owner.subtitle")}</p>
          </div>
          <button type="button" onClick={() => void load()} className="focus-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            <CheckCircle2 size={18} aria-hidden="true" />
            {t("common.refresh")}
          </button>
        </div>
        {error && <div className="mt-4 rounded-md border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-800">{error}</div>}
      </header>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={t("owner.mrr")} value={`€${Math.round(data.revenue.mrr || 0).toLocaleString()}`} icon={BarChart3} />
        <StatCard label={t("owner.arr")} value={`€${Math.round(data.revenue.arr || 0).toLocaleString()}`} icon={Sparkles} />
        <StatCard label={t("owner.customers")} value={data.customers.users || 0} icon={Users} />
        <StatCard label={t("owner.systemHealth")} value={data.executive_overview.status || "operational"} icon={Server} />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <KeyValuePanel title={t("owner.executiveOverview")} values={data.executive_overview} />
        <KeyValuePanel title={t("owner.revenue")} values={data.revenue} />
        <KeyValuePanel title={t("owner.customersSection")} values={data.customers} />
        <KeyValuePanel title={t("owner.subscriptions")} values={data.subscriptions} />
        <KeyValuePanel title={t("owner.aiUsage")} values={data.ai_usage} />
        <KeyValuePanel title={t("owner.productAnalytics")} values={data.product_analytics} />
        <KeyValuePanel title={t("owner.errorMonitoring")} values={data.error_monitoring} />
        <KeyValuePanel title={t("owner.systemHealth")} values={data.system_health} />
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2">
          <Flag className="text-brand" size={18} aria-hidden="true" />
          <h2 className="text-base font-bold text-ink">{t("owner.featureFlags")}</h2>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {flagLabels.map(([flag, label]) => (
            <button key={flag} type="button" onClick={() => void toggleFlag(flag)} className="focus-ring flex min-h-14 items-center justify-between gap-4 rounded-md border border-slate-200 px-4 py-3 text-left hover:bg-slate-50" aria-pressed={data.feature_flags[flag]}>
              <span>
                <span className="block text-sm font-semibold text-ink">{label}</span>
                <span className="block text-xs text-slate-500">{data.feature_flags[flag] ? t("owner.enabled") : t("owner.disabled")}</span>
              </span>
              {savingFlag === flag ? <Loader2 className="animate-spin text-brand" size={18} aria-hidden="true" /> : <span className={`h-6 w-11 rounded-full p-1 transition ${data.feature_flags[flag] ? "bg-brand" : "bg-slate-300"}`}><span className={`block size-4 rounded-full bg-white transition ${data.feature_flags[flag] ? "translate-x-5" : ""}`} /></span>}
            </button>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2">
          <Activity className="text-brand" size={18} aria-hidden="true" />
          <h2 className="text-base font-bold text-ink">{t("owner.auditLogs")}</h2>
        </div>
        {data.audit_logs.length ? (
          <div className="mt-4 divide-y divide-slate-100">
            {data.audit_logs.map((log) => (
              <article key={log.id} className="py-3 text-sm">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <p className="font-semibold text-ink">{log.action}</p>
                  <time className="text-xs text-slate-500">{new Date(log.created_at).toLocaleString()}</time>
                </div>
                <AuditMetadata metadata={log.metadata_json} />
              </article>
            ))}
          </div>
        ) : (
          <div className="mt-4 flex items-start gap-3 rounded-md border border-dashed border-slate-300 p-4 text-sm text-slate-600">
            <AlertTriangle size={18} aria-hidden="true" />
            {t("owner.noAuditLogs")}
          </div>
        )}
      </section>
    </div>
  );
}
