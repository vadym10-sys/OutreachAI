"use client";

import { Component, useEffect, type ErrorInfo, type ReactNode } from "react";
import { ClerkFailed, ClerkProvider, useUser } from "@clerk/nextjs";
import * as Sentry from "@sentry/nextjs";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { I18nProvider } from "@/lib/i18n/provider";
import { bootPostHog, capturePostHogException, identifyPostHogUser, resetPostHogUser, trackPageView } from "@/lib/posthog";

function StabilityFallback({ title = "Something went wrong. Please refresh or sign in again." }: { title?: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <section className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 text-center shadow-soft">
        <h1 className="text-xl font-bold text-ink">{title}</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          If this keeps happening, sign out and sign in again. Your workspace data is safe.
        </p>
        <div className="mt-5 flex flex-col gap-2 min-[390px]:flex-row min-[390px]:justify-center">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="focus-ring inline-flex min-h-11 items-center justify-center rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white"
          >
            Refresh
          </button>
          <Link
            href="/sign-in"
            className="focus-ring inline-flex min-h-11 items-center justify-center rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold"
          >
            Sign in
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
    console.error("OutreachAI client render failed", error, info);
    Sentry.captureException(error, {
      tags: { area: "react-error-boundary" },
      extra: { componentStack: info.componentStack }
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

function PostHogIdentityContext() {
  const { isLoaded, isSignedIn, user } = useUser();
  const workspaceMetadata = user?.publicMetadata as { workspace_id?: unknown; workspaceId?: unknown } | undefined;

  useEffect(() => {
    if (!isLoaded) {
      return;
    }

    if (!isSignedIn || !user) {
      resetPostHogUser();
      return;
    }

    identifyPostHogUser({
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
  clerkEnabled
}: {
  children: ReactNode;
  clerkPublishableKey?: string;
  clerkEnabled: boolean;
}) {
  if (!clerkEnabled || !clerkPublishableKey) {
    return <ClientErrorBoundary><SentryPageContext /><PostHogPageContext /><I18nProvider>{children}</I18nProvider></ClientErrorBoundary>;
  }

  return (
    <ClerkProvider publishableKey={clerkPublishableKey}>
      <ClientErrorBoundary>
        <SentryPageContext />
        <PostHogPageContext />
        <PostHogIdentityContext />
        <ClerkFailed>
          <StabilityFallback title="Authentication could not load. Please refresh or sign in again." />
        </ClerkFailed>
        <I18nProvider>{children}</I18nProvider>
      </ClientErrorBoundary>
    </ClerkProvider>
  );
}
