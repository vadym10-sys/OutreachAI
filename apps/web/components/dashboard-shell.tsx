"use client";

import { Component, useCallback, useEffect, useMemo, useState, type ErrorInfo, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserButton, useAuth, useUser } from "@clerk/nextjs";
import * as Sentry from "@sentry/nextjs";
import { ArrowRight, Building2, CheckCircle2, Command, CreditCard, Crown, Home, Inbox, Loader2, Menu, Search, Settings, Shield, Sparkles, User } from "lucide-react";
import { e2eUserEmail, isProductionRuntime, ownerEmail } from "@/lib/env";
import { CheckoutContinuation } from "@/components/billing-client";
import { LanguageSwitcher } from "@/components/language-switcher";
import { NetworkStatusBanner } from "@/components/network-status-banner";
import { useAuthRuntime } from "@/components/app-providers";
import { useI18n } from "@/lib/i18n/provider";
import { clientApi, friendlyErrorMessage } from "@/lib/client-api";
import type { Workspace } from "@/lib/types";
import { captureLogRocketException } from "@/lib/logrocket";
import { capturePostHogException, trackEvent } from "@/lib/posthog";
import { Breadcrumbs, CommandDialog, CommandItem, Kbd } from "@/components/design-system";

const primaryNav = [
  { href: "/dashboard", labelKey: "nav.dashboard", icon: Home },
  { href: "/dashboard/leads", labelKey: "nav.aiCustomerFinder", icon: Search, aliases: ["/dashboard/ai-customer-finder"] },
  { href: "/dashboard/crm", labelKey: "nav.crm", icon: Building2, aliases: ["/dashboard/companies"] },
  { href: "/dashboard/inbox", labelKey: "nav.inbox", icon: Inbox, aliases: ["/dashboard/campaigns"] }
] as const;

const utilityNav = [
  { href: "/dashboard/billing", labelKey: "nav.billing", icon: CreditCard },
  { href: "/dashboard/profile", labelKey: "nav.profile", icon: User },
  { href: "/dashboard/settings", labelKey: "nav.settings", icon: Settings },
  { href: "/dashboard/owner", labelKey: "nav.owner", icon: Crown, ownerOnly: true },
  { href: "/admin", labelKey: "nav.admin", icon: Shield, featureFlag: "NEXT_PUBLIC_SHOW_ADMIN_NAV" }
] as const;

const featureFlags = {
  NEXT_PUBLIC_SHOW_ADMIN_NAV: process.env.NEXT_PUBLIC_SHOW_ADMIN_NAV === "true"
};

const navDescriptions: Record<string, string> = {
  "/dashboard": "Start the customer workflow",
  "/dashboard/leads": "Find companies, verified contacts and first emails",
  "/dashboard/crm": "Saved leads, statuses and next company action",
  "/dashboard/inbox": "Drafts, sent emails, replies and follow-up",
  "/dashboard/billing": "Plan, usage and invoices",
  "/dashboard/profile": "Workspace identity",
  "/dashboard/settings": "Integrations and readiness",
  "/dashboard/owner": "Owner controls",
  "/admin": "Administration"
};

const qaAuthEnabled = process.env.NEXT_PUBLIC_APP_ENV === "test"
  && process.env.NEXT_PUBLIC_CLERK_E2E_BYPASS === "true"
  && (process.env.NEXT_PUBLIC_API_URL === "http://127.0.0.1:8000" || process.env.NEXT_PUBLIC_API_URL === "http://localhost:8000");
const e2eSignedOutKey = qaAuthEnabled ? "outreachai.e2eSignedOut" : "";

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

function redirectToSignIn() {
  if (typeof window === "undefined" || qaAuthEnabled) return;
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

function currentE2ESignedOut() {
  try {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(e2eSignedOutKey) === "true";
  } catch {
    return false;
  }
}

async function getE2EAuthToken() {
  return qaAuthEnabled ? "dev" : null;
}

function useDashboardIdentity() {
  const [testEmail, setTestEmail] = useState(e2eUserEmail);
  const [testSignedOut, setTestSignedOut] = useState(false);
  const [testAuthChecked, setTestAuthChecked] = useState(!qaAuthEnabled);
  const { clerkEnabled } = useAuthRuntime();

  useEffect(() => {
    if (qaAuthEnabled || !clerkEnabled) {
      const timer = window.setTimeout(() => {
        setTestEmail(currentE2EUserEmail());
        setTestSignedOut(currentE2ESignedOut());
        setTestAuthChecked(true);
      }, 0);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [clerkEnabled]);

  if (qaAuthEnabled && (!testAuthChecked || testSignedOut)) {
    return {
      isOwner: false,
      userId: testAuthChecked ? "e2e-signed-out" : "e2e-auth-checking",
      email: "",
      workspaceId: "e2e-workspace",
      ready: false,
      getAuthToken: async () => null
    };
  }

  if ((!clerkEnabled && !isProductionRuntime) || qaAuthEnabled) {
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
    let token = await getToken({ skipCache: true });
    for (let attempt = 0; !token && attempt < 20; attempt += 1) {
      await delay(100);
      token = await getToken({ skipCache: true });
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

type ShellNavItem = (typeof primaryNav)[number] | (typeof utilityNav)[number];

function isNavItemActive(item: ShellNavItem, pathname: string) {
  if (item.href === "/dashboard") return pathname === "/dashboard";
  if (pathname === item.href || pathname.startsWith(`${item.href}/`)) return true;
  const aliases = "aliases" in item ? item.aliases || [] : [];
  return aliases.some((alias) => pathname === alias || pathname.startsWith(`${alias}/`));
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { t } = useI18n();
  const { clerkEnabled } = useAuthRuntime();
  const { isOwner, userId, email, workspaceId, ready, getAuthToken } = useDashboardIdentity();
  const visiblePrimaryNav = useMemo(() => primaryNav, []);
  const visibleUtilityNav = useMemo(
    () => utilityNav.filter((item) => {
      const featureFlag = "featureFlag" in item ? item.featureFlag : undefined;
      const ownerOnly = "ownerOnly" in item ? item.ownerOnly : false;
      return (!featureFlag || featureFlags[featureFlag]) && (!ownerOnly || isOwner);
    }),
    [isOwner]
  );
  const visibleNav = useMemo(() => [...visiblePrimaryNav, ...visibleUtilityNav], [visiblePrimaryNav, visibleUtilityNav]);
  const primaryMobileNav = visiblePrimaryNav;
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [workspaceLoadFailed, setWorkspaceLoadFailed] = useState(false);
  const [workspaceSaving, setWorkspaceSaving] = useState(false);
  const [workspaceNotice, setWorkspaceNotice] = useState("");
  const [workspaceError, setWorkspaceError] = useState("");

  useEffect(() => {
    if (qaAuthEnabled && !ready && userId !== "e2e-auth-checking") {
      window.location.assign("/sign-in");
    }
  }, [ready, userId]);

  function signOutQaUser() {
    if (!qaAuthEnabled) return;
    window.localStorage.setItem(e2eSignedOutKey, "true");
    window.location.assign("/sign-in");
  }

  const loadWorkspace = useCallback(async () => {
    if (!ready) return null;
    try {
      const token = await resolveWorkspaceToken(getAuthToken);
      if (!token) {
        setWorkspaceLoadFailed(true);
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
  const fallbackWorkspaceLabel = qaAuthEnabled ? "QA Private Workspace" : t("shell.privateWorkspace");
  const workspaceLabel = rawWorkspaceLabel
    ? rawWorkspaceLabel
    : workspace
      ? t("shell.privateWorkspace")
      : fallbackWorkspaceLabel;
  const workspaceOwnerEmail = workspace?.members?.find((member) => member.role === "owner" && member.email)?.email || workspace?.members?.find((member) => member.email)?.email || email;
  const accountLabel = workspaceOwnerEmail ? `${t("shell.account")}: ${workspaceOwnerEmail}` : t("shell.privateWorkspace");
  const accountInitials = profileInitials(workspaceOwnerEmail || email, workspaceLabel);
  const activeNavItem = visibleNav.find((item) => isNavItemActive(item, pathname));
  const activeLabel = activeNavItem ? t(activeNavItem.labelKey) : t("Workspace");
  const commandItems = useMemo(() => {
    const normalized = commandQuery.trim().toLowerCase();
    return visibleNav.filter((item) => {
      if (!normalized) return true;
      const label = t(item.labelKey).toLowerCase();
      const detail = (navDescriptions[item.href] || "").toLowerCase();
      return label.includes(normalized) || detail.includes(normalized);
    });
  }, [commandQuery, t, visibleNav]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const isTyping = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen(true);
      }
      if (event.key === "Escape") {
        setCommandOpen(false);
      }
      if (commandOpen && !isTyping && /^[1-9]$/.test(event.key)) {
        const item = commandItems[Number(event.key) - 1];
        if (item) {
          window.location.assign(item.href);
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [commandItems, commandOpen]);

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
      const token = await resolveWorkspaceToken(getAuthToken);
      if (!token) {
        setWorkspaceError(t("Your session has expired. Please sign in again."));
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

  if (qaAuthEnabled && !ready) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-6">
        <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-soft">
          <Loader2 className="mx-auto animate-spin text-brand" size={28} />
          <h1 className="mt-4 text-xl font-bold text-ink">{t("Preparing secure sign in")}</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">{t("Redirecting to sign in.")}</p>
        </section>
      </main>
    );
  }

  return (
    <div className="dashboard-safe ai-os-bg min-h-screen min-w-0 max-w-[100vw] overflow-x-clip">
      <CheckoutContinuation />
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-72 border-r border-[var(--ui-border)] bg-white px-4 py-5 shadow-[12px_0_44px_rgba(16,17,20,0.05)] lg:block">
        <Link href="/dashboard" className="mb-6 flex min-h-12 items-center gap-3 rounded-2xl px-2 text-xl font-black tracking-tight text-ink">
          <span className="grid size-10 place-items-center rounded-xl bg-brand text-sm text-white shadow-sm">OA</span>
          <span>
            OutreachAI
            <span className="block text-[11px] font-black uppercase tracking-[0.14em] text-[var(--ui-text-soft)]">{t("Find → CRM → Mail")}</span>
          </span>
        </Link>
        <div className="mb-4 rounded-[1.4rem] border border-[var(--ui-border)] bg-white p-3 shadow-sm">
          <p className="truncate text-sm font-black text-[var(--ui-text)]">{workspaceLabel}</p>
          <p className="mt-1 truncate text-xs font-semibold text-[var(--ui-text-soft)]">{workspaceOwnerEmail || email || t("shell.account")}</p>
        </div>
        <button
          type="button"
          onClick={() => setCommandOpen(true)}
          className="mb-4 flex min-h-11 w-full items-center gap-2 rounded-2xl border border-[var(--ui-border)] bg-white px-3 text-left text-sm font-bold text-[var(--ui-text-soft)] shadow-sm"
        >
          <Search size={16} />
          <span className="min-w-0 flex-1 truncate">{t("Search workspace")}</span>
          <Kbd>⌘K</Kbd>
        </button>
        <nav className="space-y-1">
          {visiblePrimaryNav.map((item) => {
            const Icon = item.icon;
            const active = isNavItemActive(item, pathname);
            const label = t(item.labelKey);
            return (
              <Link key={item.href} href={item.href} className={`group flex min-h-12 items-center gap-3 rounded-2xl px-3 py-2 text-sm font-bold ${active ? "border border-blue-100 bg-blue-50 text-brand shadow-sm" : "text-[var(--ui-text-soft)] hover:bg-slate-50 hover:text-[var(--ui-text)]"}`}>
                <span className={`grid size-8 place-items-center rounded-xl ${active ? "bg-white text-brand" : "bg-[var(--ui-surface-subtle)] text-[var(--ui-text-soft)] group-hover:text-[var(--ui-text)]"}`}>
                  <Icon size={17} aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1 truncate">{label}</span>
              </Link>
            );
          })}
        </nav>
        {visibleUtilityNav.length ? (
          <details className="mt-5 rounded-2xl border border-[var(--ui-border)] bg-slate-50 p-2" open={visibleUtilityNav.some((item) => isNavItemActive(item, pathname))}>
            <summary className="cursor-pointer rounded-xl px-3 py-2 text-[11px] font-black uppercase tracking-[0.14em] text-[var(--ui-text-soft)]">{t("Account")}</summary>
            <nav className="mt-1 space-y-1" aria-label={t("Account")}>
              {visibleUtilityNav.map((item) => {
                const Icon = item.icon;
                const active = isNavItemActive(item, pathname);
                const label = t(item.labelKey);
                return (
                  <Link key={item.href} href={item.href} className={`group flex min-h-11 items-center gap-3 rounded-xl px-3 py-2 text-sm font-bold ${active ? "border border-blue-100 bg-blue-50 text-brand shadow-sm" : "text-[var(--ui-text-soft)] hover:bg-white hover:text-[var(--ui-text)]"}`}>
                    <span className={`grid size-8 place-items-center rounded-xl ${active ? "bg-white text-brand" : "bg-[var(--ui-surface-subtle)] text-[var(--ui-text-soft)] group-hover:text-[var(--ui-text)]"}`}>
                      <Icon size={16} aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1 truncate">{label}</span>
                  </Link>
                );
              })}
            </nav>
          </details>
        ) : null}
      </aside>
      <div className="min-w-0 max-w-[100vw] overflow-x-clip lg:pl-72">
        <NetworkStatusBanner />
        <header className="sticky top-0 z-30 flex min-h-16 max-w-full items-center justify-between gap-2 overflow-visible border-b border-[var(--ui-border)] bg-white/95 px-4 backdrop-blur-xl min-[360px]:px-5">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <div className="group relative lg:hidden">
              <button
                type="button"
                onFocus={() => setMobileMenuOpen(true)}
                onMouseDown={() => setMobileMenuOpen(true)}
                onPointerDown={() => setMobileMenuOpen(true)}
                onTouchStart={() => setMobileMenuOpen(true)}
                onClick={() => setMobileMenuOpen(true)}
                className="focus-ring grid size-11 place-items-center rounded-2xl border border-[var(--ui-border)] bg-white/75 text-[var(--ui-text)] shadow-sm"
                aria-label={t("nav.open")}
                aria-expanded={mobileMenuOpen}
              >
                <Menu size={20} aria-hidden="true" />
              </button>
              <div className={`${mobileMenuOpen ? "block" : "hidden"} fixed inset-0 z-50 lg:hidden`}>
                <button type="button" aria-label={t("nav.close")} className="absolute inset-0 z-0 bg-slate-500/20" onClick={closeMobileMenu} />
                <div role="dialog" aria-label={t("nav.open")} className="absolute left-3 top-[4.25rem] z-10 max-h-[calc(100dvh-5rem)] w-[min(calc(100vw-1.5rem),22rem)] overflow-y-auto rounded-[1.6rem] border border-[var(--ui-border)] bg-white p-3 shadow-2xl">
                  <div className="mb-3 rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-surface-subtle)] p-3">
                    <p className="truncate text-sm font-bold text-ink">{workspaceLabel}</p>
                    <p className="mt-1 truncate text-xs font-semibold text-slate-500">{accountLabel}</p>
                    <div className="mt-3 min-[430px]:hidden">
                      <LanguageSwitcher compact />
                    </div>
                  </div>
                  <nav className="space-y-1" aria-label={t("Account")}>
                    {visibleUtilityNav.length ? (
                      <div>
                        <p className="mb-2 px-3 text-[11px] font-black uppercase tracking-[0.14em] text-[var(--ui-text-soft)]">{t("Account")}</p>
                        {visibleUtilityNav.map((item) => {
                          const Icon = item.icon;
                          const active = isNavItemActive(item, pathname);
                          const label = t(item.labelKey);
                          return (
                            <Link key={item.href} href={item.href} onClick={closeMobileMenu} className={`flex min-h-12 items-center gap-3 rounded-2xl px-3 py-2 text-sm font-bold ${active ? "border border-blue-100 bg-blue-50 text-brand" : "text-[var(--ui-text-soft)] hover:bg-white"}`}>
                              <Icon size={18} aria-hidden="true" />
                              {label}
                            </Link>
                          );
                        })}
                      </div>
                    ) : null}
                  </nav>
                </div>
              </div>
            </div>
            <div className="min-w-0">
              <Breadcrumbs items={[{ label: "OutreachAI", href: "/dashboard" }, { label: activeLabel }]} />
              <span className="mt-1 block max-w-[58vw] truncate text-xs font-semibold text-[var(--ui-text-soft)] sm:max-w-none">{workspaceLabel}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setCommandOpen(true)}
            className="hidden min-h-11 min-w-[16rem] items-center gap-2 rounded-2xl border border-[var(--ui-border)] bg-white px-3 text-left text-sm font-bold text-[var(--ui-text-soft)] shadow-sm md:flex"
          >
            <Command size={16} />
            <span className="min-w-0 flex-1 truncate">{t("Search workspace")}</span>
            <Kbd>⌘K</Kbd>
          </button>
          <div className="hidden shrink-0 md:block">
            <LanguageSwitcher compact />
          </div>
          <div className="hidden min-w-0 shrink-0 text-right md:block">
            <p className="truncate text-xs font-bold uppercase text-brand">{t("workspace.privateAccount")}</p>
            <p className="max-w-52 truncate text-sm font-semibold text-slate-700">{workspaceOwnerEmail || email || t("shell.account")}</p>
          </div>
          <button type="button" onClick={() => setCommandOpen(true)} className="grid size-10 shrink-0 place-items-center rounded-2xl border border-[var(--ui-border)] bg-white/70 text-[var(--ui-text)] shadow-sm md:hidden" aria-label={t("Open command menu")}>
            <Sparkles size={18} />
          </button>
          <div className="dashboard-user-button grid size-10 shrink-0 place-items-center overflow-hidden rounded-full ring-2 ring-indigo-100" aria-label={t("shell.account")}>
            {clerkEnabled ? (
              <UserButton
                appearance={{
                  elements: {
                    avatarBox: "size-10",
                    userButtonTrigger: "size-10",
                    userButtonPopoverCard: "shadow-soft border border-slate-200"
                  }
                }}
              />
            ) : qaAuthEnabled ? (
              <button type="button" data-testid="qa-sign-out" onClick={signOutQaUser} className="grid size-10 place-items-center rounded-full bg-blue-50 text-xs font-black text-brand" aria-label={t("Sign out")} title={t("Sign out")}>
                {accountInitials}
              </button>
            ) : (
              <span className="grid size-10 place-items-center rounded-full bg-blue-50 text-xs font-black text-brand" aria-hidden="true">
                {accountInitials}
              </span>
            )}
          </div>
        </header>
        <main className="min-w-0 max-w-[100vw] overflow-x-clip px-4 py-5 pb-[calc(9rem+env(safe-area-inset-bottom))] min-[360px]:px-5 lg:p-8">
          {showWorkspaceSetupPanel && <section className="mb-6 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="grid gap-5 lg:grid-cols-[1.1fr_1.4fr] lg:items-start">
              <div className="min-w-0">
                <p className="text-sm font-bold uppercase text-brand">{t("workspace.privateAccount")}</p>
                <h1 className="mt-2 text-2xl font-black tracking-tight text-ink sm:text-3xl">{workspaceLabel}</h1>
                <p className="mt-2 text-sm leading-6 text-slate-600">{t("workspace.privateCopy")}</p>
                <div className="mt-4 grid gap-2 text-sm">
                  <div className="flex items-center gap-2 rounded-xl bg-blue-50 p-3 font-semibold text-brand"><CheckCircle2 size={16} />{t("workspace.owner")}: {workspaceOwnerEmail || email || t("shell.account")}</div>
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
                <div className="mt-4 rounded-2xl border border-blue-100 bg-white p-3">
                  <p className="text-xs font-black uppercase tracking-wide text-brand">{t("workspace.howItWorksTitle")}</p>
                  <ol className="mt-2 grid gap-2 text-sm font-semibold text-slate-700">
                    <li>{t("workspace.stepCompany")}</li>
                    <li>{t("workspace.stepMarket")}</li>
                    <li>{t("workspace.stepEmail")}</li>
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
                {workspaceNotice && <p className="mt-3 rounded-xl bg-blue-50 p-3 text-sm font-bold text-brand">{workspaceNotice}</p>}
                {workspaceError && <p className="mt-3 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-700">{workspaceError}</p>}
                <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
                  <button type="submit" disabled={workspaceSaving} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-brand px-5 text-sm font-black text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60">
                    {workspaceSaving ? <Loader2 className="animate-spin" size={17} /> : <CheckCircle2 size={17} />}
                    {t("workspace.save")}
                  </button>
                  <Link href="/dashboard/leads" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-5 text-sm font-black text-ink shadow-sm">
                    {t("nav.aiCustomerFinder")} <ArrowRight size={17} />
                  </Link>
                </div>
              </form>
            </div>
          </section>}
          <DashboardContentBoundary pathname={pathname}>{children}</DashboardContentBoundary>
        </main>
      </div>
      <nav className="fixed inset-x-3 bottom-3 z-30 grid grid-cols-4 rounded-[1.6rem] border border-[var(--ui-border)] bg-white px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 shadow-[0_18px_45px_rgba(15,23,42,0.12)] lg:hidden">
        {primaryMobileNav.map((item) => {
          const Icon = item.icon;
          const active = isNavItemActive(item, pathname);
          const label = t(item.labelKey);
          return (
            <Link key={item.href} href={item.href} className={`flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-2xl px-1 text-[11px] font-black ${active ? "bg-brand text-white shadow-sm" : "text-[var(--ui-text-soft)]"}`}>
              <Icon size={18} aria-hidden="true" />
              <span className="max-w-full truncate">{label}</span>
            </Link>
          );
        })}
      </nav>
      <CommandDialog open={commandOpen} query={commandQuery} onQueryChange={setCommandQuery} onClose={() => setCommandOpen(false)}>
        {commandItems.length ? commandItems.map((item, index) => {
          const Icon = item.icon;
          return (
            <CommandItem
              key={item.href}
              href={item.href}
              icon={<Icon size={17} />}
              title={t(item.labelKey)}
              detail={t(navDescriptions[item.href] || "")}
              shortcut={index < 9 ? <Kbd>{index + 1}</Kbd> : undefined}
              onSelect={() => setCommandOpen(false)}
            />
          );
        }) : (
          <div className="rounded-2xl px-3 py-8 text-center text-sm font-semibold text-slate-500">No matching workspace action.</div>
        )}
      </CommandDialog>
    </div>
  );
}
