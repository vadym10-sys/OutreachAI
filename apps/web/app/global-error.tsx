"use client";

import { useEffect } from "react";
import Link from "next/link";
import * as Sentry from "@sentry/nextjs";
import { isLocale, translate, type Locale } from "@/lib/i18n/translations";
import "./globals.css";

function browserLocale(): Locale {
  if (typeof window === "undefined") return "en";
  try {
    const stored = window.localStorage.getItem("outreachai.locale");
    if (isLocale(stored)) return stored;
    const cookie = document.cookie.split("; ").find((item) => item.startsWith("outreachai_locale="))?.split("=")[1];
    if (isLocale(cookie)) return cookie;
    const browser = window.navigator.language;
    if (isLocale(browser)) return browser;
    const base = browser.split("-")[0];
    if (isLocale(base)) return base;
  } catch {
    return "en";
  }
  return "en";
}

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  const locale = browserLocale();
  const t = (key: string) => translate(key, locale);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      console.error("OutreachAI global render failed", error);
    }
    Sentry.captureException(error, {
      tags: { area: "global-error" },
      extra: { digest: error.digest }
    });
  }, [error]);

  return (
    <html lang={locale}>
      <body>
        <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
          <section className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 text-center shadow-soft">
            <h1 className="text-xl font-bold text-ink">{t("Something went wrong. Please refresh or sign in again.")}</h1>
            <p className="mt-3 text-sm leading-6 text-slate-600">{t("common.globalLoadCopy")}</p>
            <Link href="/sign-in" className="focus-ring mt-5 inline-flex min-h-11 items-center justify-center rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white">{t("common.signInAgain")}</Link>
          </section>
        </main>
      </body>
    </html>
  );
}
