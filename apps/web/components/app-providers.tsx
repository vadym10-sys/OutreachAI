"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { ClerkFailed, ClerkProvider } from "@clerk/nextjs";
import Link from "next/link";

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
  }

  render() {
    if (this.state.failed) {
      return <StabilityFallback />;
    }

    return this.props.children;
  }
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
    return <ClientErrorBoundary>{children}</ClientErrorBoundary>;
  }

  return (
    <ClerkProvider publishableKey={clerkPublishableKey}>
      <ClientErrorBoundary>
        <ClerkFailed>
          <StabilityFallback title="Authentication could not load. Please refresh or sign in again." />
        </ClerkFailed>
        {children}
      </ClientErrorBoundary>
    </ClerkProvider>
  );
}
