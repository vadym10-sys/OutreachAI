"use client";

import { useEffect } from "react";
import Link from "next/link";
import * as Sentry from "@sentry/nextjs";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      console.error("OutreachAI route render failed", error);
    }
    Sentry.captureException(error, {
      tags: { area: "app-route-error" },
      extra: { digest: error.digest }
    });
  }, [error]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <section className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 text-center shadow-soft">
        <h1 className="text-xl font-bold text-ink">Something went wrong. Please refresh or sign in again.</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">The page failed to render, but the rest of OutreachAI is still available.</p>
        <div className="mt-5 flex flex-col gap-2 min-[390px]:flex-row min-[390px]:justify-center">
          <button onClick={reset} className="focus-ring min-h-11 rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white">Try again</button>
          <Link href="/sign-in" className="focus-ring inline-flex min-h-11 items-center justify-center rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold">Sign in</Link>
        </div>
      </section>
    </main>
  );
}
