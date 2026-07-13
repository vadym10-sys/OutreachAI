"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "@clerk/nextjs";
import { ArrowRight, CheckCircle2, Loader2, ShieldCheck } from "lucide-react";
import { clientApi, friendlyErrorMessage } from "@/lib/client-api";
import { hasClerkPublishableKey, isClerkE2EBypass } from "@/lib/env";
import { useI18n } from "@/lib/i18n/provider";
import type { Workspace } from "@/lib/types";

type WorkspaceSetupForm = {
  name: string;
  company: string;
  industry: string;
  target_country: string;
  target_customer: string;
  timezone: string;
};

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function setupCompleteness(form: WorkspaceSetupForm) {
  return [form.name, form.company, form.industry, form.target_country, form.target_customer].filter((item) => String(item || "").trim()).length;
}

function useWorkspaceApi() {
  if (!hasClerkPublishableKey || isClerkE2EBypass) {
    return {
      ready: true,
      getAuthToken: async () => "dev"
    };
  }

  // The no-Clerk branch is required for local/E2E builds where ClerkProvider is intentionally not mounted.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const { getToken, isLoaded, isSignedIn } = useAuth();

  return {
    ready: isLoaded && Boolean(isSignedIn),
    getAuthToken: async () => {
      if (!isLoaded || !isSignedIn) return null;
      let token = await getToken();
      for (let attempt = 0; !token && attempt < 20; attempt += 1) {
        await delay(100);
        token = await getToken();
      }
      return token;
    }
  };
}

function buildInitialForm(workspace: Workspace): WorkspaceSetupForm {
  return {
    name: workspace.name || "",
    company: workspace.company || "",
    industry: workspace.industry || "",
    target_country: workspace.target_country || "",
    target_customer: workspace.target_customer || "",
    timezone: workspace.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
  };
}

export function OnboardingWorkspaceSetup() {
  const { t } = useI18n();
  const { ready, getAuthToken } = useWorkspaceApi();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [form, setForm] = useState<WorkspaceSetupForm>({
    name: "",
    company: "",
    industry: "",
    target_country: "",
    target_customer: "",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const completion = useMemo(() => setupCompleteness(form), [form]);
  const setupReady = completion >= 4;

  const loadWorkspace = useCallback(async () => {
    if (!ready) return;
    try {
      const token = await getAuthToken();
      if (!token) {
        setError(t("Your session has expired. Please sign in again."));
        return;
      }
      const loaded = await clientApi<Workspace>("/api/workspace/me", token);
      setWorkspace(loaded);
      setForm(buildInitialForm(loaded));
    } catch (nextError) {
      setError(friendlyErrorMessage(nextError, t("Onboarding could not be loaded. Please refresh and try again.")));
    } finally {
      setLoading(false);
    }
  }, [getAuthToken, ready, t]);

  useEffect(() => {
    let active = true;
    const run = async () => {
      const token = await getAuthToken();
      if (!token || !active) {
        if (active) {
          setLoading(false);
          setError(t("Your session has expired. Please sign in again."));
        }
        return;
      }

      try {
        const loaded = await clientApi<Workspace>("/api/workspace/me", token);
        if (!active) return;
        setWorkspace(loaded);
        setForm(buildInitialForm(loaded));
      } catch (nextError) {
        if (!active) return;
        setError(friendlyErrorMessage(nextError, t("Onboarding could not be loaded. Please refresh and try again.")));
      } finally {
        if (active) setLoading(false);
      }
    };

    if (ready) {
      void run();
    }

    return () => {
      active = false;
    };
  }, [getAuthToken, ready, t]);

  async function saveWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");

    if (!form.name.trim() || !form.company.trim()) {
      setError(t("workspace.setupRequired"));
      return;
    }

    setSaving(true);
    try {
      const token = await getAuthToken();
      if (!token) {
        setError(t("Your session has expired. Please sign in again."));
        return;
      }

      const payload = {
        name: form.name.trim(),
        company: form.company.trim(),
        industry: form.industry.trim(),
        target_country: form.target_country.trim(),
        target_customer: form.target_customer.trim(),
        timezone: form.timezone.trim() || "UTC"
      };

      const updated = await clientApi<Workspace>("/api/workspace", token, {
        method: "PUT",
        body: JSON.stringify(payload)
      });

      setWorkspace(updated);
      setForm(buildInitialForm(updated));
      setNotice(t("workspace.saved"));
    } catch (nextError) {
      setError(friendlyErrorMessage(nextError, t("workspace.saveFailed")));
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="mx-auto min-h-screen max-w-4xl px-4 py-8 sm:px-6">
      <p className="text-sm font-semibold text-brand">{t("Setup")}</p>
      <h1 className="mt-2 text-3xl font-black tracking-tight text-ink">{t("Set up OutreachAI")}</h1>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
        {t("Create your private workspace once. OutreachAI then uses your company and market context for lead search, CRM, and reviewed outreach.")}
      </p>

      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="grid gap-5 lg:grid-cols-[1fr_1.35fr] lg:items-start">
          <article className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-black uppercase tracking-wide text-brand">{t("workspace.privateAccount")}</p>
            <h2 className="mt-2 text-xl font-black text-ink">{workspace?.name || t("shell.privateWorkspace")}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-700">{t("workspace.privateCopy")}</p>
            <div className="mt-4 space-y-2 text-sm">
              <div className="rounded-xl bg-white p-3 font-semibold text-slate-800">{t("workspace.stepCompany")}</div>
              <div className="rounded-xl bg-white p-3 font-semibold text-slate-800">{t("workspace.stepMarket")}</div>
              <div className="rounded-xl bg-white p-3 font-semibold text-slate-800">{t("workspace.stepLeads")}</div>
            </div>
            <div className="mt-4 flex items-center gap-2 rounded-xl bg-teal-50 p-3 text-sm font-semibold text-brand">
              <ShieldCheck size={16} />
              {t("workspace.dataIsolation")}
            </div>
          </article>

          <article className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-black text-ink">{t("workspace.finishSetup")}</p>
                <p className="mt-1 text-sm text-slate-600">{t("workspace.setupCopy")}</p>
              </div>
              <span className="inline-flex w-fit items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-700">
                <CheckCircle2 size={14} /> {completion}/5
              </span>
            </div>

            {loading ? (
              <div className="mt-5 space-y-3" aria-live="polite" aria-label={t("common.loading")}>
                <div className="h-11 animate-pulse rounded-xl bg-slate-200" />
                <div className="h-11 animate-pulse rounded-xl bg-slate-200" />
                <div className="h-11 animate-pulse rounded-xl bg-slate-200" />
                <div className="h-11 animate-pulse rounded-xl bg-slate-200" />
                <div className="h-11 animate-pulse rounded-xl bg-slate-200" />
              </div>
            ) : (
              <form aria-label={t("Workspace setup form")} onSubmit={saveWorkspace} className="mt-5 space-y-3">
                <label className="block text-sm font-bold text-slate-700">
                  {t("workspace.name")}
                  <input
                    value={form.name}
                    onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                    placeholder={t("workspace.namePlaceholder")}
                    className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm"
                  />
                  <span className="mt-1 block text-xs font-medium text-slate-500">{t("workspace.nameHelp")}</span>
                </label>

                <label className="block text-sm font-bold text-slate-700">
                  {t("workspace.company")}
                  <input
                    value={form.company}
                    onChange={(event) => setForm((current) => ({ ...current, company: event.target.value }))}
                    placeholder={t("workspace.companyPlaceholder")}
                    className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm"
                  />
                  <span className="mt-1 block text-xs font-medium text-slate-500">{t("workspace.companyHelp")}</span>
                </label>

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block text-sm font-bold text-slate-700">
                    {t("workspace.industry")}
                    <input
                      value={form.industry}
                      onChange={(event) => setForm((current) => ({ ...current, industry: event.target.value }))}
                      placeholder={t("workspace.industryPlaceholder")}
                      className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm"
                    />
                    <span className="mt-1 block text-xs font-medium text-slate-500">{t("workspace.industryHelp")}</span>
                  </label>

                  <label className="block text-sm font-bold text-slate-700">
                    {t("workspace.targetCountry")}
                    <input
                      value={form.target_country}
                      onChange={(event) => setForm((current) => ({ ...current, target_country: event.target.value }))}
                      placeholder={t("workspace.countryPlaceholder")}
                      className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm"
                    />
                    <span className="mt-1 block text-xs font-medium text-slate-500">{t("workspace.countryHelp")}</span>
                  </label>
                </div>

                <label className="block text-sm font-bold text-slate-700">
                  {t("workspace.targetCustomer")}
                  <input
                    value={form.target_customer}
                    onChange={(event) => setForm((current) => ({ ...current, target_customer: event.target.value }))}
                    placeholder={t("workspace.customerPlaceholder")}
                    className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm"
                  />
                  <span className="mt-1 block text-xs font-medium text-slate-500">{t("workspace.customerHelp")}</span>
                </label>

                {notice ? <p className="rounded-xl bg-teal-50 p-3 text-sm font-bold text-brand">{notice}</p> : null}
                {error ? (
                  <div className="rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700">
                    <p>{error}</p>
                    <button
                      type="button"
                      onClick={() => {
                        setLoading(true);
                        setError("");
                        void loadWorkspace().finally(() => setLoading(false));
                      }}
                      className="mt-2 inline-flex min-h-11 items-center justify-center rounded-md border border-red-200 bg-white px-3 text-sm font-bold text-red-700"
                    >
                      {t("common.tryAgain")}
                    </button>
                  </div>
                ) : null}

                <div className="flex flex-col gap-2 pt-1 sm:flex-row">
                  <button type="submit" disabled={saving} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-brand px-5 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-60">
                    {saving ? <Loader2 className="animate-spin" size={17} /> : <CheckCircle2 size={17} />}
                    {t("workspace.save")}
                  </button>
                  <Link href={setupReady ? "/dashboard/leads" : "/dashboard"} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-5 text-sm font-black text-ink">
                    {setupReady ? t("workspace.nextLeadFinder") : t("nav.dashboard")} <ArrowRight size={16} />
                  </Link>
                </div>
              </form>
            )}

            {setupReady ? (
              <div className="mt-4 rounded-xl border border-teal-200 bg-teal-50 p-3 text-sm text-brand">
                <p className="font-bold">{t("workspace.setupComplete")}</p>
                <p className="mt-1">{t("You can now search companies, save CRM records, and review outreach from one private workspace.")}</p>
              </div>
            ) : null}
          </article>
        </div>
      </section>
    </main>
  );
}
