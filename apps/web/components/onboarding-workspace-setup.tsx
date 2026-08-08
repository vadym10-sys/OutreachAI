"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "@clerk/nextjs";
import { ArrowRight, CheckCircle2, Loader2, ShieldCheck } from "lucide-react";
import { AppBadge, SurfaceCard } from "@/components/design-system";
import { authSessionPendingMessage, clientApi, friendlyErrorMessage } from "@/lib/client-api";
import { hasClerkPublishableKey, isClerkE2EBypass } from "@/lib/env";
import { useI18n } from "@/lib/i18n/provider";
import { NetworkStatusBanner } from "@/components/network-status-banner";
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

async function resolveWorkspaceToken(getAuthToken: () => Promise<string | null>, attempts = 3) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const token = await getAuthToken();
    if (token) return token;
    if (attempt < attempts - 1) {
      await delay(250 * (attempt + 1));
    }
  }
  return null;
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
      let token = await getToken({ skipCache: true });
      for (let attempt = 0; !token && attempt < 20; attempt += 1) {
        await delay(100);
        token = await getToken({ skipCache: true });
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
      const token = await resolveWorkspaceToken(getAuthToken);
      if (!token) {
        setError(t(authSessionPendingMessage));
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
      const token = await resolveWorkspaceToken(getAuthToken);
      if (!token || !active) {
        if (active) {
          setLoading(false);
          setError(t(authSessionPendingMessage));
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
      const token = await resolveWorkspaceToken(getAuthToken);
      if (!token) {
        setError(t(authSessionPendingMessage));
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
    <>
      <NetworkStatusBanner />
      <main className="min-h-screen bg-[var(--ui-bg)] px-4 py-8 min-[360px]:px-5 sm:px-6">
        <div className="mx-auto max-w-6xl">
          <header className="max-w-3xl">
            <AppBadge tone="brand">{t("Step 1 of 5")}</AppBadge>
            <h1 className="mt-4 text-4xl font-black leading-tight tracking-normal text-[var(--ui-text)] min-[390px]:text-5xl">
              {t("What does your business sell?")}
            </h1>
            <p className="mt-3 text-base leading-7 text-[var(--ui-text-soft)]">
              {t("Short setup: business, ICP, markets, Gmail optional, start finding customers.")}
            </p>
          </header>

          <section className="mt-8 grid gap-5 lg:grid-cols-[0.82fr_1.18fr] lg:items-start">
            <SurfaceCard as="article" className="rounded-[1.75rem] p-5 shadow-soft">
              <p className="text-sm font-black text-[var(--ui-text)]">{workspace?.name || t("shell.privateWorkspace")}</p>
              <p className="mt-2 text-sm leading-6 text-[var(--ui-text-soft)]">{t("workspace.privateCopy")}</p>
              <div className="mt-5 grid gap-2">
                {[
                  ["1", "What does your business sell?"],
                  ["2", "Who is your ideal customer?"],
                  ["3", "Which markets do you target?"],
                  ["4", "Connect Gmail or skip for now."],
                  ["5", "Start finding customers."],
                ].map(([number, label], index) => (
                  <div key={label} className={`flex items-center gap-3 rounded-2xl border px-3 py-3 text-sm font-bold ${index === 0 ? "border-[var(--ui-brand)] bg-[var(--ui-brand-soft)] text-[var(--ui-text)]" : "border-[var(--ui-border)] bg-[var(--ui-surface)] text-[var(--ui-text-soft)]"}`}>
                    <span className={`grid size-7 shrink-0 place-items-center rounded-full text-xs font-black ${index === 0 ? "bg-[var(--ui-brand)] text-white" : "bg-white text-[var(--ui-text-soft)]"}`}>{number}</span>
                    {t(label)}
                  </div>
                ))}
              </div>
              <div className="mt-5 flex items-start gap-2 rounded-2xl bg-[var(--ui-surface-success)] p-3 text-sm font-semibold text-success">
                <ShieldCheck className="mt-0.5 shrink-0" size={16} />
                {t("workspace.dataIsolation")}
              </div>
            </SurfaceCard>

            <SurfaceCard as="section" className="rounded-[2rem] p-5 shadow-raised sm:p-7">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-sm font-black text-[var(--ui-text)]">{t("workspace.finishSetup")}</p>
                  <p className="mt-1 text-sm leading-6 text-[var(--ui-text-soft)]">{t("workspace.setupCopy")}</p>
                </div>
                <span className="inline-flex w-fit items-center gap-2 rounded-full bg-[var(--ui-surface-subtle)] px-3 py-1 text-xs font-black text-[var(--ui-text)]">
                  <CheckCircle2 size={14} /> {completion}/5
                </span>
              </div>

              {loading ? (
                <div className="mt-6 space-y-3" aria-live="polite" aria-label={t("common.loading")}>
                  <div className="h-12 animate-pulse rounded-xl bg-[var(--ui-surface-subtle)]" />
                  <div className="h-12 animate-pulse rounded-xl bg-[var(--ui-surface-subtle)]" />
                  <div className="h-36 animate-pulse rounded-2xl bg-[var(--ui-surface-subtle)]" />
                  <div className="h-12 animate-pulse rounded-xl bg-[var(--ui-surface-subtle)]" />
                </div>
              ) : (
                <form aria-label={t("Workspace setup form")} onSubmit={saveWorkspace} className="mt-6 space-y-4">
                  <label className="block text-sm font-bold text-[var(--ui-text)]">
                    {t("workspace.company")}
                    <input
                      value={form.company}
                      onChange={(event) => setForm((current) => ({ ...current, company: event.target.value }))}
                      placeholder={t("workspace.companyPlaceholder")}
                      className="focus-ring mt-2 min-h-12 w-full rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface)] px-4 text-base"
                    />
                    <span className="mt-1 block text-xs font-medium text-[var(--ui-text-soft)]">{t("workspace.companyHelp")}</span>
                  </label>

                  <label className="block text-sm font-bold text-[var(--ui-text)]">
                    {t("Describe your business")}
                    <textarea
                      value={form.name}
                      onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                      placeholder={t("Paste your website URL or describe your business in text.")}
                      rows={4}
                      className="focus-ring mt-2 min-h-36 w-full resize-y rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-surface)] px-4 py-3 text-base leading-7"
                    />
                    <span className="mt-1 block text-xs font-medium text-[var(--ui-text-soft)]">{t("workspace.nameHelp")}</span>
                  </label>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="block text-sm font-bold text-[var(--ui-text)]">
                      {t("workspace.industry")}
                      <input
                        value={form.industry}
                        onChange={(event) => setForm((current) => ({ ...current, industry: event.target.value }))}
                        placeholder={t("workspace.industryPlaceholder")}
                        className="focus-ring mt-2 min-h-12 w-full rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface)] px-4 text-base"
                      />
                    </label>

                    <label className="block text-sm font-bold text-[var(--ui-text)]">
                      {t("workspace.targetCountry")}
                      <input
                        value={form.target_country}
                        onChange={(event) => setForm((current) => ({ ...current, target_country: event.target.value }))}
                        placeholder={t("workspace.countryPlaceholder")}
                        className="focus-ring mt-2 min-h-12 w-full rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface)] px-4 text-base"
                      />
                    </label>
                  </div>

                  <label className="block text-sm font-bold text-[var(--ui-text)]">
                    {t("workspace.targetCustomer")}
                    <input
                      value={form.target_customer}
                      onChange={(event) => setForm((current) => ({ ...current, target_customer: event.target.value }))}
                      placeholder={t("workspace.customerPlaceholder")}
                      className="focus-ring mt-2 min-h-12 w-full rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface)] px-4 text-base"
                    />
                    <span className="mt-1 block text-xs font-medium text-[var(--ui-text-soft)]">{t("workspace.customerHelp")}</span>
                  </label>

                  <div className="rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-surface)] p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-sm font-black text-[var(--ui-text)]">{t("Connect Gmail or skip for now.")}</p>
                        <p className="mt-1 text-sm leading-6 text-[var(--ui-text-soft)]">{t("Gmail can be connected later from Settings before sending approved emails.")}</p>
                      </div>
                      <Link href="/dashboard/settings" className="focus-ring inline-flex min-h-11 items-center justify-center rounded-full border border-[var(--ui-border)] bg-white px-4 text-sm font-black text-[var(--ui-text)] shadow-sm">
                        {t("Open settings")}
                      </Link>
                    </div>
                  </div>

                  {notice ? <p className="rounded-2xl bg-[var(--ui-surface-success)] p-3 text-sm font-bold text-success">{notice}</p> : null}
                  {error ? (
                    <div className="rounded-2xl bg-[var(--ui-surface-danger)] p-3 text-sm font-semibold text-danger">
                      <p>{error}</p>
                      <button
                        type="button"
                        onClick={() => {
                          setLoading(true);
                          setError("");
                          void loadWorkspace().finally(() => setLoading(false));
                        }}
                        className="focus-ring mt-2 inline-flex min-h-11 items-center justify-center rounded-full border border-[var(--ui-border)] bg-white px-4 text-sm font-bold text-danger"
                      >
                        {t("common.tryAgain")}
                      </button>
                    </div>
                  ) : null}

                  <div className="flex flex-col gap-2 pt-1 sm:flex-row">
                    <button type="submit" disabled={saving} className="focus-ring inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-[var(--ui-brand)] px-5 text-sm font-black text-white shadow-soft disabled:cursor-not-allowed disabled:opacity-60">
                      {saving ? <Loader2 className="animate-spin" size={17} /> : <CheckCircle2 size={17} />}
                      {t("workspace.save")}
                    </button>
                    <Link href={setupReady ? "/dashboard/leads" : "/dashboard"} className="focus-ring inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-[var(--ui-border)] bg-white px-5 text-sm font-black text-[var(--ui-text)] shadow-sm">
                      {setupReady ? t("Start finding customers") : t("nav.dashboard")} <ArrowRight size={16} />
                    </Link>
                  </div>
                </form>
              )}

              {setupReady ? (
                <div className="mt-5 rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-surface-success)] p-4 text-sm text-success">
                  <p className="font-bold">{t("workspace.setupComplete")}</p>
                  <p className="mt-1">{t("You can now search companies, save CRM records, and review outreach from one private workspace.")}</p>
                </div>
              ) : null}
            </SurfaceCard>
          </section>
        </div>
      </main>
    </>
  );
}
