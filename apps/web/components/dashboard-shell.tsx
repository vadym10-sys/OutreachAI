"use client";

import { Component, useEffect, useState, type ErrorInfo, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserButton, useUser } from "@clerk/nextjs";
import * as Sentry from "@sentry/nextjs";
import { BarChart3, Bot, Building2, CreditCard, Crown, Globe2, Handshake, Inbox, LayoutDashboard, MailSearch, Megaphone, Menu, Search, Settings, Shield, UserRoundSearch, Users } from "lucide-react";
import { e2eUserEmail, hasClerkPublishableKey, isClerkE2EBypass, ownerEmail } from "@/lib/env";
import { CheckoutContinuation } from "@/components/billing-client";
import { LanguageSwitcher } from "@/components/language-switcher";
import { useI18n } from "@/lib/i18n/provider";
import { captureLogRocketException } from "@/lib/logrocket";
import { capturePostHogException, trackEvent } from "@/lib/posthog";

const nav = [
  { href: "/dashboard", labelKey: "nav.dashboard", icon: LayoutDashboard },
  { href: "/dashboard/leads", labelKey: "nav.leads", icon: Search },
  { href: "/dashboard/companies", labelKey: "nav.companies", icon: Building2 },
  { href: "/dashboard/campaigns", labelKey: "nav.campaigns", icon: Megaphone },
  { href: "/dashboard/crm", labelKey: "nav.crm", icon: Users },
  { href: "/dashboard/billing", labelKey: "nav.billing", icon: CreditCard },
  { href: "/dashboard/settings", labelKey: "nav.settings", icon: Settings },
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

function useDashboardIdentity() {
  const [testEmail, setTestEmail] = useState(e2eUserEmail);

  useEffect(() => {
    if (isClerkE2EBypass || !hasClerkPublishableKey) {
      const timer = window.setTimeout(() => setTestEmail(currentE2EUserEmail()), 0);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, []);

  if (!hasClerkPublishableKey || isClerkE2EBypass) {
    return {
      isOwner: testEmail.trim().toLowerCase() === ownerEmail,
      userId: testEmail ? `e2e:${testEmail}` : "e2e-user",
      email: testEmail,
      workspaceId: "e2e-workspace"
    };
  }

  // The no-Clerk branch is required for local/E2E builds where ClerkProvider is intentionally not mounted.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const { user } = useUser();
  const currentEmail = user?.primaryEmailAddress?.emailAddress || user?.emailAddresses?.[0]?.emailAddress || "";
  const publicMetadata = user?.publicMetadata as { workspace_id?: unknown; workspaceId?: unknown } | undefined;
  return {
    isOwner: currentEmail.trim().toLowerCase() === ownerEmail,
    userId: user?.id || "unknown-user",
    email: currentEmail,
    workspaceId: String(publicMetadata?.workspace_id || publicMetadata?.workspaceId || "unknown-workspace")
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
          <p className="text-lg font-bold text-amber-950">This workspace section is temporarily unavailable.</p>
          <p className="mt-2 text-sm leading-6 text-amber-800">Use the navigation to continue working, or retry this section. Your saved CRM data is not affected.</p>
          <button type="button" onClick={() => this.setState({ failed: false })} className="mt-4 inline-flex min-h-11 items-center justify-center rounded-md bg-white px-4 text-sm font-bold text-amber-950 shadow-sm">
            Retry section
          </button>
        </section>
      );
    }

    return this.props.children;
  }
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { t } = useI18n();
  const { isOwner, userId, email, workspaceId } = useDashboardIdentity();
  const visibleNav = nav.filter((item) => (!item.featureFlag || featureFlags[item.featureFlag as keyof typeof featureFlags]) && (!item.ownerOnly || isOwner));
  const primaryMobileNav = visibleNav.slice(0, 4);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    Sentry.setUser({ id: userId, email: email || undefined });
    Sentry.setTag("current_route", pathname);
    Sentry.setTag("workspace_id", workspaceId);
    Sentry.setTag("release", process.env.NEXT_PUBLIC_RELEASE || "outreachai-web@1.0.0");
    Sentry.setTag("environment", process.env.NEXT_PUBLIC_APP_ENV || process.env.NODE_ENV || "development");
    Sentry.setContext("outreachai", {
      workspace_id: workspaceId,
      user_id: userId,
      current_route: pathname
    });
  }, [email, pathname, userId, workspaceId]);

  return (
    <div className="min-h-screen min-w-0 overflow-x-hidden bg-slate-50">
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
      <div className="lg:pl-64">
        <header className="sticky top-0 z-30 flex min-h-16 items-center justify-between gap-3 border-b border-slate-200 bg-white/95 px-4 backdrop-blur min-[360px]:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="relative lg:hidden">
              <button type="button" onClick={() => setMobileMenuOpen((open) => !open)} className="focus-ring grid size-11 place-items-center rounded-md border border-slate-300 bg-white text-slate-700" aria-label={t("nav.open")} aria-expanded={mobileMenuOpen}>
                <Menu size={20} aria-hidden="true" />
              </button>
              {mobileMenuOpen && <div className="absolute left-0 top-12 z-40 w-[min(82vw,19rem)] rounded-lg border border-slate-200 bg-white p-2 shadow-soft">
                {visibleNav.map((item) => {
                  const Icon = item.icon;
                  const active = pathname === item.href;
                  const label = t(item.labelKey);
                  return (
                    <Link key={item.href} href={item.href} onClick={() => setMobileMenuOpen(false)} className={`flex min-h-11 items-center gap-3 rounded-md px-3 py-2 text-sm font-medium ${active ? "bg-teal-50 text-brand" : "text-slate-700 hover:bg-slate-100"}`}>
                      <Icon size={18} aria-hidden="true" />
                      {label}
                    </Link>
                  );
                })}
              </div>}
            </div>
            <span className="truncate text-sm font-semibold text-slate-600">{t("shell.workspace")}</span>
          </div>
          <LanguageSwitcher compact />
          {hasClerkPublishableKey && !isClerkE2EBypass ? (
            <UserButton />
          ) : (
            <div className="grid size-8 place-items-center rounded-full bg-slate-200 text-xs font-bold text-slate-600" aria-label="User profile">
              AI
            </div>
          )}
        </header>
        <main className="min-w-0 px-4 py-5 pb-28 min-[360px]:px-5 lg:p-8">
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
