"use client";

import { Component, useCallback, useEffect, useMemo, useState, type ErrorInfo, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserButton, useAuth, useUser } from "@clerk/nextjs";
import * as Sentry from "@sentry/nextjs";
import { ArrowRight, BarChart3, Bot, Building2, CheckCircle2, CreditCard, Crown, Globe2, Handshake, Inbox, LayoutDashboard, Loader2, MailSearch, Megaphone, Menu, Search, Settings, Shield, UserRoundSearch, Users } from "lucide-react";
import { e2eUserEmail, isClerkE2EBypass, isProductionRuntime, ownerEmail } from "@/lib/env";
import { CheckoutContinuation } from "@/components/billing-client";
import { LanguageSwitcher } from "@/components/language-switcher";
import { useAuthRuntime } from "@/components/app-providers";
import { useI18n } from "@/lib/i18n/provider";
import { clientApi, friendlyErrorMessage } from "@/lib/client-api";
import type { Workspace } from "@/lib/types";
import { captureLogRocketException } from "@/lib/logrocket";
import { capturePostHogException, trackEvent } from "@/lib/posthog";

const nav = [
  { href: "/dashboard", labelKey: "nav.dashboard", icon: LayoutDashboard },
  { href: "/dashboard/leads", labelKey: "nav.leads", icon: Search },
  { href: "/dashboard/companies", labelKey: "nav.companies", icon: Building2 },
  { href: "/dashboard/campaigns", labelKey: "nav.campaigns", icon: Megaphone },
  { href: "/dashboard/crm", labelKey: "nav.crm", icon: Users, featureFlag: "NEXT_PUBLIC_SHOW_ADVANCED_NAV" },
  { href: "/dashboard/billing", labelKey: "nav.billing", icon: CreditCard, featureFlag: "NEXT_PUBLIC_SHOW_ADVANCED_NAV" },
  { href: "/dashboard/settings", labelKey: "nav.settings", icon: Settings, featureFlag: "NEXT_PUBLIC_SHOW_ADVANCED_NAV" },
  { href: "/dashboard/deals", labelKey: "nav.deals", icon: Handshake, featureFlag: "NEXT_PUBLIC_SHOW_ADVANCED_NAV" },
  { href: "/dashboard/website-analyzer", labelKey: "nav.websiteAnalyzer", icon: Globe2, featureFlag: "NEXT_PUBLIC_SHOW_ADVANCED_NAV" },
  { href: "/dashboard/contacts", labelKey: "nav.contacts", icon: UserRoundSearch, featureFlag: "NEXT_PUBLIC_SHOW_ADVANCED_NAV" },
  { href: "/dashboard/inbox", labelKey: "nav.inbox", icon: Inbox, featureFlag: "NEXT_PUBLIC_SHOW_ADVANCED_NAV" },
  { href: "/dashboard/analytics", labelKey: "nav.analytics", icon: BarChart3, featureFlag: "NEXT_PUBLIC_SHOW_ADVANCED_NAV" },
  { href: "/dashboard/sales-employees", labelKey: "nav.aiEmployees", icon: Bot, featureFlag: "NEXT_PUBLIC_SHOW_ADVANCED_NAV" },
  { href: "/dashboard/owner", labelKey: "nav.owner", icon: Crown, ownerOnly: true },
  { href: "/admin", labelKey: "nav.admin", icon: Shield, featureFlag: "NEXT_PUBLIC_SHOW_ADMIN_NAV" }
];

const featureFlags = {
  NEXT_PUBLIC_SHOW_ADVANCED_NAV: process.env.NEXT_PUBLIC_SHOW_ADVANCED_NAV === "true",
  NEXT_PUBLIC_SHOW_ADMIN_NAV: process.env.NEXT_PUBLIC_SHOW_ADMIN_NAV === "true"
};

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function redirectToSignIn() {
  if (typeof window === "undefined" || isClerkE2EBypass) return;
  const redirectUrl = encodeURIComponent(`${window.location.pathname}${window.location.search}`);
  window.location.assign(`/sign-in?redirect_url=${redirectUrl}`);
}

function isSessionExpiredError(error: unknown) {
  return error instanceof Error && /sign in again|session has expired/i.test(error.message);
}

function currentE2EUserEmail() {
  try {
    if (typeof window === "undefined") return e2eUserEmail;
    return window.localStorage.getItem("outreachai.e2eUserEmail") || e2eUserEmail;
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.error("Owner test email lookup failed", error);
    }
    return e2eUserEmail;
  }
}

async function getE2EAuthToken() {
  return isClerkE2EBypass ? "dev" : null;
}

function useDashboardIdentity() {
  const [testEmail, setTestEmail] = useState(e2eUserEmail);
  const { clerkEnabled } = useAuthRuntime();

  useEffect(() => {
    if (isClerkE2EBypass || !clerkEnabled) {
      const timer = window.setTimeout(() => setTestEmail(currentE2EUserEmail()), 0);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [clerkEnabled]);

  if ((!clerkEnabled && !isProductionRuntime) || isClerkE2EBypass) {
    return {
      isOwner: testEmail.trim().toLowerCase() === ownerEmail,
      userId: testEmail ? `e2e:${testEmail}` : "e2e-user",
      email: testEmail,
      workspaceId: "e2e-workspace",
      ready: true,
      getAuthToken: getE2EAuthToken
    };
  }

  if (!clerkEnabled) {
    return {
      isOwner: false,
      userId: "anonymous",
      email: "",
      workspaceId: "unknown-workspace",
      ready: false,
      getAuthToken: async () => null
    };
  }

  // The no-Clerk branch is required for local/E2E builds where ClerkProvider is intentionally not mounted.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const { user } = useUser();
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const { getToken, isLoaded, isSignedIn } = useAuth();
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const getAuthToken = useCallback(async () => {
    if (!isLoaded || !isSignedIn) return null;
    let token = await getToken();
    for (let attempt = 0; !token && attempt < 20; attempt += 1) {
      await delay(100);
      token = await getToken();
    }
    return token;
  }, [getToken, isLoaded, isSignedIn]);
  const currentEmail = user?.primaryEmailAddress?.emailAddress || user?.emailAddresses?.[0]?.emailAddress || "";
  const publicMetadata = user?.publicMetadata as { workspace_id?: unknown; workspaceId?: unknown } | undefined;
  return {
    isOwner: currentEmail.trim().toLowerCase() === ownerEmail,
    userId: user?.id || "unknown-user",
    email: currentEmail,
    workspaceId: String(publicMetadata?.workspace_id || publicMetadata?.workspaceId || "unknown-workspace"),
    ready: isLoaded && Boolean(isSignedIn),
    getAuthToken
  };
}

class DashboardContentBoundary extends Component<{ children: ReactNode; pathname: string }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidUpdate(previous: { pathname: string }) {
    if (previous.pathname !== this.props.pathname && this.state.failed) {
      this.setState({ failed: false });
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    Sentry.captureException(error, {
      tags: { area: "dashboard-content-boundary" },
      extra: { current_route: this.props.pathname, component_stack: info.componentStack }
    });
    captureLogRocketException(error, {
      area: "dashboard-content-boundary",
      current_route: this.props.pathname
    });
    capturePostHogException(error, {
      area: "dashboard-content-boundary",
      current_route: this.props.pathname,
      component_stack: info.componentStack
    });
    trackEvent("dashboard_content_failure", {
      current_route: this.props.pathname
    });
  }

  render() {
    if (this.state.failed) {
      return (
        <section role="status" className="rounded-2xl border border-amber-200 bg-amber-50 p-5 shadow-sm">
          <DashboardBoundaryFallback onRetry={() => this.setState({ failed: false })} />
        </section>
      );
    }

    return this.props.children;
  }
}

function DashboardBoundaryFallback({ onRetry }: { onRetry: () => void }) {
  const { t } = useI18n();

  return (
    <>
      <p className="text-lg font-bold text-amber-950">{t("dashboard.sectionUnavailable")}</p>
      <p className="mt-2 text-sm leading-6 text-amber-800">{t("dashboard.sectionUnavailableCopy")}</p>
      <button type="button" onClick={onRetry} className="mt-4 inline-flex min-h-11 items-center justify-center rounded-md bg-white px-4 text-sm font-bold text-amber-950 shadow-sm">
        {t("dashboard.retrySection")}
      </button>
    </>
  );
}

function profileInitials(email: string, workspaceLabel: string) {
  const source = (email || workspaceLabel || "Workspace").trim();
  const name = source.includes("@") ? source.split("@")[0] : source;
  const parts = name.split(/[\s._-]+/).filter(Boolean);
  const first = parts[0]?.[0] || "W";
  const second = parts.length > 1 ? parts[1]?.[0] : parts[0]?.[1];
  return `${first || ""}${second || ""}`.toUpperCase();
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { t } = useI18n();
  const { clerkEnabled } = useAuthRuntime();
  const { isOwner, userId, email, workspaceId, ready, getAuthToken } = useDashboardIdentity();
  const visibleNav = nav.filter((item) => (!item.featureFlag || featureFlags[item.featureFlag as keyof typeof featureFlags]) && (!item.ownerOnly || isOwner));
  const primaryMobileNav = visibleNav.slice(0, 4);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [workspaceLoadFailed, setWorkspaceLoadFailed] = useState(false);
  const [workspaceSaving, setWorkspaceSaving] = useState(false);
  const [workspaceNotice, setWorkspaceNotice] = useState("");
  const [workspaceError, setWorkspaceError] = useState("");

  const loadWorkspace = useCallback(async () => {
    if (!ready) return null;
    try {
      const token = await getAuthToken();
      if (!token) {
        redirectToSignIn();
        return null;
      }
      const loadedWorkspace = await clientApi<Workspace>("/api/workspace/me", token);
      setWorkspace(loadedWorkspace);
      setWorkspaceLoadFailed(false);
      return loadedWorkspace;
    } catch (error) {
      if (isSessionExpiredError(error)) {
        redirectToSignIn();
        return null;
      }
      setWorkspaceLoadFailed(true);
      Sentry.captureException(error, {
        tags: { area: "workspace-shell", current_route: pathname },
        extra: { user_id: userId }
      });
      captureLogRocketException(error, {
        area: "workspace-shell",
        current_route: pathname
      });
      trackEvent("workspace_shell_load_failed", { current_route: pathname });
      return null;
    }
  }, [getAuthToken, pathname, ready, userId]);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const loaded = await loadWorkspace();
      if (cancelled && loaded) {
        return;
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [loadWorkspace]);

  useEffect(() => {
    Sentry.setUser({ id: userId, email: email || undefined });
    Sentry.setTag("current_route", pathname);
    Sentry.setTag("workspace_id", workspace?.id || workspaceId);
    Sentry.setTag("release", process.env.NEXT_PUBLIC_RELEASE || "outreachai-web@1.0.0");
    Sentry.setTag("environment", process.env.NEXT_PUBLIC_APP_ENV || process.env.NODE_ENV || "development");
    Sentry.setContext("outreachai", {
      workspace_id: workspaceId,
      loaded_workspace_id: workspace?.id,
      user_id: userId,
      current_route: pathname
    });
  }, [email, pathname, userId, workspace?.id, workspaceId]);

  const rawWorkspaceName = workspace?.name?.trim() || "";
  const isGenericWorkspaceName = !rawWorkspaceName || ["outreach workspace", "private workspace"].includes(rawWorkspaceName.toLowerCase());
  const rawWorkspaceLabel = !isGenericWorkspaceName ? rawWorkspaceName : workspace?.company?.trim();
  const fallbackWorkspaceLabel = isClerkE2EBypass ? "QA Private Workspace" : t("shell.privateWorkspace");
  const workspaceLabel = rawWorkspaceLabel
    ? rawWorkspaceLabel
    : workspace
      ? t("shell.privateWorkspace")
      : fallbackWorkspaceLabel;
  const workspaceOwnerEmail = workspace?.members?.find((member) => member.role === "owner" && member.email)?.email || workspace?.members?.find((member) => member.email)?.email || email;
  const accountLabel = workspaceOwnerEmail ? `${t("shell.account")}: ${workspaceOwnerEmail}` : t("shell.privateWorkspace");
  const accountInitials = profileInitials(workspaceOwnerEmail || email, workspaceLabel);

  useEffect(() => {
    const label = t("shell.account");
    const updateClerkUserButtonLabel = () => {
      document.querySelectorAll(".dashboard-user-button button").forEach((button) => {
        if (button.getAttribute("aria-label") !== label) {
          button.setAttribute("aria-label", label);
        }
        if (button.getAttribute("title") !== label) {
          button.setAttribute("title", label);
        }
      });
    };
    updateClerkUserButtonLabel();
    const timeoutId = window.setTimeout(updateClerkUserButtonLabel, 250);
    const observer = new MutationObserver(updateClerkUserButtonLabel);
    document.querySelectorAll(".dashboard-user-button").forEach((node) => {
      observer.observe(node, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-label", "title"] });
    });
    return () => {
      window.clearTimeout(timeoutId);
      observer.disconnect();
    };
  }, [t, workspaceOwnerEmail, email]);
  const workspaceReadyScore = useMemo(() => {
    if (!workspace) return 0;
    return [isGenericWorkspaceName ? "" : workspace.name, workspace.company, workspace.industry, workspace.target_country, workspace.target_customer].filter((item) => String(item || "").trim()).length;
  }, [isGenericWorkspaceName, workspace]);
  const workspaceNeedsSetup = Boolean(workspace && workspaceReadyScore < 4);
  const showWorkspaceSetupPanel = workspaceNeedsSetup;

  async function saveWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWorkspaceNotice("");
    setWorkspaceError("");
    const form = event.currentTarget;
    const formData = new FormData(form);
    const payload = {
      name: String(formData.get("name") || "").trim(),
      company: String(formData.get("company") || "").trim(),
      industry: String(formData.get("industry") || "").trim(),
      target_country: String(formData.get("target_country") || "").trim(),
      target_customer: String(formData.get("target_customer") || "").trim(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || workspace?.timezone || "UTC"
    };
    if (!payload.name || !payload.company) {
      setWorkspaceError(t("workspace.setupRequired"));
      return;
    }
    setWorkspaceSaving(true);
    try {
      const token = await getAuthToken();
      if (!token) {
        redirectToSignIn();
        return;
      }
      const updated = await clientApi<Workspace>("/api/workspace", token, {
        method: "PUT",
        body: JSON.stringify(payload)
      });
      setWorkspace(updated);
      setWorkspaceNotice(t("workspace.saved"));
      trackEvent("workspace_setup_saved", {
        has_company: Boolean(updated.company),
        has_industry: Boolean(updated.industry),
        has_target_country: Boolean(updated.target_country)
      });
    } catch (error) {
      if (isSessionExpiredError(error)) {
        redirectToSignIn();
        return;
      }
      setWorkspaceError(friendlyErrorMessage(error, t("workspace.saveFailed")));
      Sentry.captureException(error, {
        tags: { area: "workspace-setup", current_route: pathname },
        extra: { user_id: userId, workspace_id: workspace?.id }
      });
      captureLogRocketException(error, { area: "workspace-setup", current_route: pathname });
      trackEvent("workspace_setup_failed", { current_route: pathname });
    } finally {
      setWorkspaceSaving(false);
    }
  }

  function closeMobileMenu() {
    setMobileMenuOpen(false);
    if (typeof document !== "undefined" && document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  }

  return (
    <div className="dashboard-safe min-h-screen min-w-0 max-w-[100vw] overflow-x-clip bg-slate-50">
      <CheckoutContinuation />
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-slate-200 bg-white px-4 py-5 lg:block">
        <Link href="/dashboard" className="mb-8 block text-xl font-bold tracking-tight text-ink">OutreachAI</Link>
        <nav className="space-y-1">
          {visibleNav.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href;
            const label = t(item.labelKey);
            return (
              <Link key={item.href} href={item.href} className={`flex min-h-11 items-center gap-3 rounded-md px-3 py-2 text-sm font-medium ${active ? "bg-teal-50 text-brand" : "text-slate-700 hover:bg-slate-100"}`}>
                <Icon size={18} aria-hidden="true" />
                {label}
              </Link>
            );
          })}
        </nav>
      </aside>
      <div className="min-w-0 max-w-[100vw] overflow-x-clip lg:pl-64">
        <header className="sticky top-0 z-30 flex min-h-16 max-w-full items-center justify-between gap-2 overflow-visible border-b border-slate-200 bg-white/95 px-4 backdrop-blur min-[360px]:px-5">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <div className="group relative lg:hidden">
              <button
                type="button"
                onFocus={() => setMobileMenuOpen(true)}
                onMouseDown={() => setMobileMenuOpen(true)}
                onPointerDown={() => setMobileMenuOpen(true)}
                onTouchStart={() => setMobileMenuOpen(true)}
                onClick={() => setMobileMenuOpen(true)}
                className="focus-ring grid size-11 place-items-center rounded-md border border-slate-300 bg-white text-slate-700"
                aria-label={t("nav.open")}
                aria-expanded={mobileMenuOpen}
              >
                <Menu size={20} aria-hidden="true" />
              </button>
              <div className={`${mobileMenuOpen ? "block" : "hidden"} fixed inset-0 z-50 lg:hidden`}>
                <button type="button" aria-label={t("nav.close")} className="absolute inset-0 z-0 bg-slate-950/20" onClick={closeMobileMenu} />
                <div role="dialog" aria-label={t("nav.open")} className="absolute left-3 top-[4.25rem] z-10 max-h-[calc(100dvh-5rem)] w-[min(calc(100vw-1.5rem),20rem)] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-3 shadow-2xl">
                  <div className="mb-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <p className="truncate text-sm font-bold text-ink">{workspaceLabel}</p>
                    <p className="mt-1 truncate text-xs font-semibold text-slate-500">{accountLabel}</p>
                    <div className="mt-3 min-[430px]:hidden">
                      <LanguageSwitcher compact />
                    </div>
                  </div>
                  <nav className="space-y-1" aria-label={t("nav.open")}>
                    {visibleNav.map((item) => {
                      const Icon = item.icon;
                      const active = pathname === item.href;
                      const label = t(item.labelKey);
                      return (
                        <Link key={item.href} href={item.href} onClick={closeMobileMenu} className={`flex min-h-12 items-center gap-3 rounded-xl px-3 py-2 text-sm font-semibold ${active ? "bg-teal-50 text-brand" : "text-slate-700 hover:bg-slate-100"}`}>
                          <Icon size={18} aria-hidden="true" />
                          {label}
                        </Link>
                      );
                    })}
                  </nav>
                </div>
              </div>
            </div>
            <div className="min-w-0">
              <span className="block truncate text-sm font-semibold text-slate-700">{workspaceLabel}</span>
              <span className="block max-w-[58vw] truncate text-xs font-medium text-slate-500 sm:max-w-none">{accountLabel}</span>
            </div>
          </div>
          <div className="hidden shrink-0 md:block">
            <LanguageSwitcher compact />
          </div>
          <div className="hidden min-w-0 shrink-0 text-right md:block">
            <p className="truncate text-xs font-bold uppercase text-brand">{t("workspace.privateAccount")}</p>
            <p className="max-w-52 truncate text-sm font-semibold text-slate-700">{workspaceOwnerEmail || email || t("shell.account")}</p>
          </div>
          <div className="dashboard-user-button grid size-10 shrink-0 place-items-center overflow-hidden rounded-full ring-2 ring-teal-100" aria-label={t("shell.account")}>
            {clerkEnabled && !isClerkE2EBypass ? (
              <UserButton
                appearance={{
                  elements: {
                    avatarBox: "size-10",
                    userButtonTrigger: "size-10",
                    userButtonPopoverCard: "shadow-soft border border-slate-200"
                  }
                }}
              />
            ) : (
              <div className="grid size-10 place-items-center rounded-full bg-teal-50 text-xs font-black text-brand" aria-label={accountLabel} title={accountLabel}>
                {accountInitials}
              </div>
            )}
          </div>
        </header>
        <main className="min-w-0 max-w-[100vw] overflow-x-clip px-4 py-5 pb-28 min-[360px]:px-5 lg:p-8">
          {showWorkspaceSetupPanel && <section className="mb-6 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="grid gap-5 lg:grid-cols-[1.1fr_1.4fr] lg:items-start">
              <div className="min-w-0">
                <p className="text-sm font-bold uppercase text-brand">{t("workspace.privateAccount")}</p>
                <h1 className="mt-2 text-2xl font-black tracking-tight text-ink sm:text-3xl">{workspaceLabel}</h1>
                <p className="mt-2 text-sm leading-6 text-slate-600">{t("workspace.privateCopy")}</p>
                <div className="mt-4 grid gap-2 text-sm">
                  <div className="flex items-center gap-2 rounded-xl bg-teal-50 p-3 font-semibold text-brand"><CheckCircle2 size={16} />{t("workspace.owner")}: {workspaceOwnerEmail || email || t("shell.account")}</div>
                  <div className="flex items-center gap-2 rounded-xl bg-slate-50 p-3 font-semibold text-slate-700"><CheckCircle2 size={16} />{t("workspace.dataIsolation")}</div>
                </div>
              </div>
              <form onSubmit={saveWorkspace} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-sm font-black text-ink">{t(workspaceNeedsSetup ? "workspace.finishSetup" : "workspace.setupComplete")}</p>
                    <p className="mt-1 text-sm leading-6 text-slate-600">{t("workspace.setupCopy")}</p>
                  </div>
                  <span className="w-fit rounded-full bg-white px-3 py-1 text-xs font-black text-brand shadow-sm">{workspaceReadyScore}/5</span>
                </div>
                <div className="mt-4 rounded-2xl border border-teal-100 bg-white p-3">
                  <p className="text-xs font-black uppercase tracking-wide text-brand">{t("workspace.howItWorksTitle")}</p>
                  <ol className="mt-2 grid gap-2 text-sm font-semibold text-slate-700">
                    <li>{t("workspace.stepCompany")}</li>
                    <li>{t("workspace.stepMarket")}</li>
                    <li>{t("workspace.stepLeads")}</li>
                  </ol>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <label className="text-sm font-bold text-slate-700">{t("workspace.name")}<input name="name" defaultValue={workspace?.name || ""} placeholder={t("workspace.namePlaceholder")} className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm" /><span className="mt-1 block text-xs font-medium leading-5 text-slate-500">{t("workspace.nameHelp")}</span></label>
                  <label className="text-sm font-bold text-slate-700">{t("workspace.company")}<input name="company" defaultValue={workspace?.company || ""} placeholder={t("workspace.companyPlaceholder")} className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm" /><span className="mt-1 block text-xs font-medium leading-5 text-slate-500">{t("workspace.companyHelp")}</span></label>
                  <label className="text-sm font-bold text-slate-700">{t("workspace.industry")}<input name="industry" defaultValue={workspace?.industry || ""} placeholder={t("workspace.industryPlaceholder")} className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm" /><span className="mt-1 block text-xs font-medium leading-5 text-slate-500">{t("workspace.industryHelp")}</span></label>
                  <label className="text-sm font-bold text-slate-700">{t("workspace.targetCountry")}<input name="target_country" defaultValue={workspace?.target_country || ""} placeholder={t("workspace.countryPlaceholder")} className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm" /><span className="mt-1 block text-xs font-medium leading-5 text-slate-500">{t("workspace.countryHelp")}</span></label>
                  <label className="text-sm font-bold text-slate-700 sm:col-span-2">{t("workspace.targetCustomer")}<input name="target_customer" defaultValue={workspace?.target_customer || ""} placeholder={t("workspace.customerPlaceholder")} className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm" /><span className="mt-1 block text-xs font-medium leading-5 text-slate-500">{t("workspace.customerHelp")}</span></label>
                </div>
                {workspaceNotice && <p className="mt-3 rounded-xl bg-teal-50 p-3 text-sm font-bold text-brand">{workspaceNotice}</p>}
                {workspaceError && <p className="mt-3 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-700">{workspaceError}</p>}
                <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
                  <button type="submit" disabled={workspaceSaving} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-brand px-5 text-sm font-black text-white shadow-sm transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-60">
                    {workspaceSaving ? <Loader2 className="animate-spin" size={17} /> : <CheckCircle2 size={17} />}
                    {t("workspace.save")}
                  </button>
                  <Link href="/dashboard/leads" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-5 text-sm font-black text-ink shadow-sm">
                    {t("nav.leads")} <ArrowRight size={17} />
                  </Link>
                </div>
              </form>
            </div>
          </section>}
          <DashboardContentBoundary pathname={pathname}>{children}</DashboardContentBoundary>
        </main>
      </div>
      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-slate-200 bg-white/95 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 shadow-[0_-6px_20px_rgba(15,23,42,0.08)] backdrop-blur lg:hidden">
        {primaryMobileNav.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.href;
          const label = t(item.labelKey);
          return (
            <Link key={item.href} href={item.href} className={`flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-md px-1 text-[11px] font-semibold ${active ? "bg-teal-50 text-brand" : "text-slate-600"}`}>
              <Icon size={18} aria-hidden="true" />
              <span className="max-w-full truncate">{item.href === "/dashboard/leads" ? t("nav.leadsShort") : label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
