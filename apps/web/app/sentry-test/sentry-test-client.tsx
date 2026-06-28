"use client";

import * as Sentry from "@sentry/nextjs";

export function SentryTestClient() {
  function throwSentryError() {
    const error = new Error("OutreachAI development Sentry test error");
    Sentry.captureException(error, {
      tags: { area: "sentry-test-page" },
      extra: { expected: true }
    });
    throw error;
  }

  function rejectPromise() {
    void Promise.reject(new Error("OutreachAI development unhandled rejection test"));
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10">
      <section className="mx-auto max-w-xl rounded-lg border border-slate-200 bg-white p-6 shadow-soft">
        <p className="text-sm font-bold uppercase tracking-wide text-brand">Development only</p>
        <h1 className="mt-2 text-2xl font-bold text-ink">Sentry test page</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Use this page locally with NEXT_PUBLIC_SENTRY_DSN set to verify React error and unhandled rejection capture.
        </p>
        <div className="mt-6 flex flex-col gap-3 min-[390px]:flex-row">
          <button
            type="button"
            onClick={throwSentryError}
            className="focus-ring min-h-11 rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white"
          >
            Throw React error
          </button>
          <button
            type="button"
            onClick={rejectPromise}
            className="focus-ring min-h-11 rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-ink"
          >
            Trigger rejected promise
          </button>
        </div>
      </section>
    </main>
  );
}
