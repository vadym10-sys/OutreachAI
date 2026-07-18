"use client";

import { useEffect } from "react";
import Link from "next/link";
import * as Sentry from "@sentry/nextjs";
import { useI18n } from "@/lib/i18n/provider";

export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { t } = useI18n();

  useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      console.error("OutreachAI dashboard render failed", error);
    }
    Sentry.captureException(error, {
      tags: { area: "dashboard-route-error" },
      extra: { digest: error.digest }
    });
  }, [error]);

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8">
      <section className="mx-auto w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 text-center shadow-soft">
        <h1 className="text-xl font-bold text-ink">{t("Something went wrong. Please refresh or sign in again.")}</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">{t("This dashboard view could not load. Other OutreachAI pages are still available.")}</p>
        <div className="mt-5 flex flex-col gap-2 min-[390px]:flex-row min-[390px]:justify-center">
          <button onClick={reset} className="focus-ring min-h-11 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white">{t("common.tryAgain")}</button>
          <Link href="/sign-in" className="focus-ring inline-flex min-h-11 items-center justify-center rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold">{t("common.signIn")}</Link>
        </div>
      </section>
    </main>
  );
}
