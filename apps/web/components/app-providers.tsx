"use client";

import { Component, createContext, useContext, useEffect, type ErrorInfo, type ReactNode } from "react";
import { ClerkFailed, ClerkProvider, useUser } from "@clerk/nextjs";
import * as Sentry from "@sentry/nextjs";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { getClerkLocalization } from "@/lib/i18n/clerk";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import type { Locale } from "@/lib/i18n/translations";
import { bootLogRocket, captureLogRocketException, identifyLogRocketUser, trackLogRocketEvent, trackLogRocketPage } from "@/lib/logrocket";
import { bootPostHog, capturePostHogException, identifyPostHogUser, trackPageView } from "@/lib/posthog";

type AuthRuntime = {
  clerkEnabled: boolean;
};

const AuthRuntimeContext = createContext<AuthRuntime>({ clerkEnabled: false });

export function useAuthRuntime() {
  return useContext(AuthRuntimeContext);
}

function StabilityFallback({
  title = "Something went wrong. Please refresh or sign in again.",
  copy = "common.recoveryCopy"
}: {
  title?: string;
  copy?: string;
}) {
  const { t } = useI18n();

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <section className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 text-center shadow-soft">
        <h1 className="text-xl font-bold text-ink">{t(title)}</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          {t(copy)}
        </p>
        <div className="mt-5 flex flex-col gap-2 min-[390px]:flex-row min-[390px]:justify-center">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="focus-ring inline-flex min-h-11 items-center justify-center rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white"
          >
            {t("common.refresh")}
          </button>
          <Link
            href="/sign-in"
            className="focus-ring inline-flex min-h-11 items-center justify-center rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold"
          >
            {t("common.signIn")}
          </Link>
        </div>
      </section>
    </main>
  );
}

class ClientErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (process.env.NODE_ENV !== "production") {
      console.error("OutreachAI client render failed", error, info);
    }
    Sentry.captureException(error, {
      tags: { area: "react-error-boundary" },
      extra: { componentStack: info.componentStack }
    });
    captureLogRocketException(error, {
      area: "react-error-boundary"
    });
    capturePostHogException(error, {
      area: "react-error-boundary",
      component_stack: info.componentStack
    });
  }

  render() {
    if (this.state.failed) {
      return <StabilityFallback />;
    }

    return this.props.children;
  }
}

class SilentIntegrationBoundary extends Component<{ area: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (process.env.NODE_ENV !== "production") {
      console.error("OutreachAI integration failed", this.props.area, error, info);
    }
    Sentry.captureException(error, {
      tags: { area: "integration-boundary", integration: this.props.area },
      extra: { componentStack: info.componentStack }
    });
    captureLogRocketException(error, {
      area: "integration-boundary",
      integration: this.props.area
    });
    capturePostHogException(error, {
      area: "integration-boundary",
      integration: this.props.area,
      component_stack: info.componentStack
    });
  }

  render() {
    if (this.state.failed) {
      return null;
    }

    return this.props.children;
  }
}

function SentryPageContext() {
  const pathname = usePathname();

  useEffect(() => {
    Sentry.setTag("current_route", pathname);
    Sentry.setTag("release", process.env.NEXT_PUBLIC_RELEASE || "outreachai-web@1.0.0");
    Sentry.setTag("environment", process.env.NEXT_PUBLIC_APP_ENV || process.env.NODE_ENV || "development");
    Sentry.setContext("outreachai_page", { current_route: pathname });
  }, [pathname]);

  return null;
}

function PostHogPageContext() {
  const pathname = usePathname();

  useEffect(() => {
    void bootPostHog();
  }, []);

  useEffect(() => {
    trackPageView(pathname);
  }, [pathname]);

  useEffect(() => {
    function handleError(event: ErrorEvent) {
      capturePostHogException(event.error || event.message, {
        area: "window-error",
        filename: event.filename,
        line: event.lineno,
        column: event.colno
      });
    }

    function handleUnhandledRejection(event: PromiseRejectionEvent) {
      capturePostHogException(event.reason, {
        area: "unhandled-promise-rejection"
      });
    }

    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleUnhandledRejection);
    return () => {
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
    };
  }, []);

  return null;
}

function LogRocketPageContext() {
  const pathname = usePathname();

  useEffect(() => {
    void bootLogRocket();
  }, []);

  useEffect(() => {
    trackLogRocketPage(pathname);
  }, [pathname]);

  useEffect(() => {
    const startedAt = performance.now();
    const timer = window.setTimeout(() => {
      const elapsed = Math.round(performance.now() - startedAt);
      if (elapsed > 2500) {
        trackLogRocketEvent("slow_loading_state", {
          duration_ms: elapsed,
          current_route: pathname
        });
      }
    }, 2600);
    return () => window.clearTimeout(timer);
  }, [pathname]);

  useEffect(() => {
    function reportMobileOverflow() {
      const overflow = Math.max(0, document.documentElement.scrollWidth - window.innerWidth);
      if (window.innerWidth <= 768 && overflow > 4) {
        trackLogRocketEvent("mobile_horizontal_overflow", {
          viewport_width: window.innerWidth,
          scroll_width: document.documentElement.scrollWidth,
          overflow_px: overflow,
          current_route: window.location.pathname
        });
      }
    }

    const timer = window.setTimeout(reportMobileOverflow, 500);
    window.addEventListener("resize", reportMobileOverflow);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("resize", reportMobileOverflow);
    };
  }, [pathname]);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      const target = event.target instanceof Element ? event.target.closest("button,a") : null;
      if (!target) return;
      if (target instanceof HTMLButtonElement && target.disabled) {
        trackLogRocketEvent("disabled_button_tapped", {
          label: target.textContent?.trim().slice(0, 120) || target.getAttribute("aria-label") || "button",
          current_route: window.location.pathname
        });
      }
      if (target instanceof HTMLAnchorElement && !target.getAttribute("href")) {
        trackLogRocketEvent("broken_link_tapped", {
          label: target.textContent?.trim().slice(0, 120) || target.getAttribute("aria-label") || "link",
          current_route: window.location.pathname
        });
      }
    }

    function handleError(event: ErrorEvent) {
      captureLogRocketException(event.error || event.message, {
        area: "window-error",
        filename: event.filename,
        line: event.lineno,
        column: event.colno
      });
    }

    function handleUnhandledRejection(event: PromiseRejectionEvent) {
      captureLogRocketException(event.reason, {
        area: "unhandled-promise-rejection"
      });
    }

    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleUnhandledRejection);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
    };
  }, []);

  return null;
}

function WebVitalsContext() {
  const pathname = usePathname();

  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof PerformanceObserver === "undefined") return;

    const report = (name: string, value: number, rating: "good" | "needs-improvement" | "poor") => {
      const payload = {
        metric: name,
        value: Math.round(value * 100) / 100,
        rating,
        current_route: window.location.pathname,
        viewport_width: window.innerWidth,
        release: process.env.NEXT_PUBLIC_RELEASE || "outreachai-web@1.0.0",
        environment: process.env.NEXT_PUBLIC_APP_ENV || process.env.NODE_ENV || "development"
      };
      trackLogRocketEvent("web_vital_recorded", payload);
      import("@/lib/posthog").then(({ trackEvent }) => trackEvent("web_vital_recorded", payload)).catch(() => {});
      if (rating === "poor") {
        Sentry.captureMessage("Poor web vital", {
          level: "warning",
          tags: { area: "web-vitals", metric: name },
          extra: payload
        });
      }
    };

    const ratingFor = (name: string, value: number): "good" | "needs-improvement" | "poor" => {
      if (name === "LCP") return value <= 2500 ? "good" : value <= 4000 ? "needs-improvement" : "poor";
      if (name === "CLS") return value <= 0.1 ? "good" : value <= 0.25 ? "needs-improvement" : "poor";
      if (name === "INP") return value <= 200 ? "good" : value <= 500 ? "needs-improvement" : "poor";
      if (name === "TTFB") return value <= 800 ? "good" : value <= 1800 ? "needs-improvement" : "poor";
      return "good";
    };

    const observers: PerformanceObserver[] = [];
    try {
      const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
      if (navigation) {
        const ttfb = navigation.responseStart - navigation.requestStart;
        report("TTFB", ttfb, ratingFor("TTFB", ttfb));
      }

      let cls = 0;
      const clsObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as Array<PerformanceEntry & { value?: number; hadRecentInput?: boolean }>) {
          if (!entry.hadRecentInput && typeof entry.value === "number") cls += entry.value;
        }
        report("CLS", cls, ratingFor("CLS", cls));
      });
      clsObserver.observe({ type: "layout-shift", buffered: true });
      observers.push(clsObserver);

      const lcpObserver = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        const last = entries[entries.length - 1] as PerformanceEntry | undefined;
        if (last) report("LCP", last.startTime, ratingFor("LCP", last.startTime));
      });
      lcpObserver.observe({ type: "largest-contentful-paint", buffered: true });
      observers.push(lcpObserver);

      const inpObserver = new PerformanceObserver((list) => {
        const slowest = Math.max(...list.getEntries().map((entry) => {
          const event = entry as PerformanceEventTiming;
          return event.processingStart && event.startTime ? event.processingStart - event.startTime : 0;
        }));
        if (Number.isFinite(slowest) && slowest > 0) report("INP", slowest, ratingFor("INP", slowest));
      });
      inpObserver.observe({ type: "event", buffered: true, durationThreshold: 40 } as PerformanceObserverInit);
      observers.push(inpObserver);
    } catch (error) {
      captureLogRocketException(error, { area: "web-vitals" });
      capturePostHogException(error, { area: "web-vitals" });
    }

    return () => observers.forEach((observer) => observer.disconnect());
  }, [pathname]);

  return null;
}

function PostHogIdentityContext() {
  const { isLoaded, isSignedIn, user } = useUser();
  const workspaceMetadata = user?.publicMetadata as { workspace_id?: unknown; workspaceId?: unknown } | undefined;

  useEffect(() => {
    if (!isLoaded) {
      return;
    }

    if (!isSignedIn || !user) {
      return;
    }

    identifyPostHogUser({
      userId: user.id,
      email: user.primaryEmailAddress?.emailAddress || user.emailAddresses?.[0]?.emailAddress,
      workspaceId: String(workspaceMetadata?.workspace_id || workspaceMetadata?.workspaceId || "unknown-workspace")
    });
    identifyLogRocketUser({
      userId: user.id,
      email: user.primaryEmailAddress?.emailAddress || user.emailAddresses?.[0]?.emailAddress,
      workspaceId: String(workspaceMetadata?.workspace_id || workspaceMetadata?.workspaceId || "unknown-workspace")
    });
  }, [isLoaded, isSignedIn, user, workspaceMetadata?.workspace_id, workspaceMetadata?.workspaceId]);

  return null;
}

export function AppProviders({
  children,
  clerkPublishableKey,
  clerkEnabled,
  initialLocale = "en"
}: {
  children: ReactNode;
  clerkPublishableKey?: string;
  clerkEnabled: boolean;
  initialLocale?: Locale;
}) {
  const pathname = usePathname();
  const isPublicLanding = pathname === "/";

  if (isPublicLanding) {
    return (
      <AuthRuntimeContext.Provider value={{ clerkEnabled: false }}>
        <I18nProvider initialLocale={initialLocale}>
          <ClientErrorBoundary>
            {children}
          </ClientErrorBoundary>
        </I18nProvider>
      </AuthRuntimeContext.Provider>
    );
  }

  if (!clerkEnabled || !clerkPublishableKey) {
    return (
      <AuthRuntimeContext.Provider value={{ clerkEnabled: false }}>
        <SilentIntegrationBoundary area="sentry-page-context"><SentryPageContext /></SilentIntegrationBoundary>
        <SilentIntegrationBoundary area="posthog-page-context"><PostHogPageContext /></SilentIntegrationBoundary>
        <SilentIntegrationBoundary area="logrocket-page-context"><LogRocketPageContext /></SilentIntegrationBoundary>
        <SilentIntegrationBoundary area="web-vitals-context"><WebVitalsContext /></SilentIntegrationBoundary>
        <ClientErrorBoundary>
          <I18nProvider initialLocale={initialLocale}>{children}</I18nProvider>
        </ClientErrorBoundary>
      </AuthRuntimeContext.Provider>
    );
  }

  return (
    <AuthRuntimeContext.Provider value={{ clerkEnabled: true }}>
      <I18nProvider initialLocale={initialLocale}>
        <LocaleAwareClerkProvider clerkPublishableKey={clerkPublishableKey}>
          {children}
        </LocaleAwareClerkProvider>
      </I18nProvider>
    </AuthRuntimeContext.Provider>
  );
}

function LocaleAwareClerkProvider({
  children,
  clerkPublishableKey
}: {
  children: ReactNode;
  clerkPublishableKey: string;
}) {
  const { locale } = useI18n();

  return (
    <ClerkProvider publishableKey={clerkPublishableKey} localization={getClerkLocalization(locale)}>
      <SilentIntegrationBoundary area="sentry-page-context">
        <SentryPageContext />
      </SilentIntegrationBoundary>
      <SilentIntegrationBoundary area="posthog-page-context">
        <PostHogPageContext />
      </SilentIntegrationBoundary>
      <SilentIntegrationBoundary area="logrocket-page-context">
        <LogRocketPageContext />
      </SilentIntegrationBoundary>
      <SilentIntegrationBoundary area="web-vitals-context">
        <WebVitalsContext />
      </SilentIntegrationBoundary>
      <SilentIntegrationBoundary area="posthog-identity-context">
        <PostHogIdentityContext />
      </SilentIntegrationBoundary>
      <ClerkFailed>
        <StabilityFallback title="Authentication could not load. Please refresh or sign in again." />
      </ClerkFailed>
      <ClientErrorBoundary>
        {children}
      </ClientErrorBoundary>
    </ClerkProvider>
  );
}
