"use client";

import { useEffect } from "react";
import Link from "next/link";
import "./globals.css";

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    console.error("OutreachAI global render failed", error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
          <section className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 text-center shadow-soft">
            <h1 className="text-xl font-bold text-ink">Something went wrong. Please refresh or sign in again.</h1>
            <p className="mt-3 text-sm leading-6 text-slate-600">OutreachAI could not finish loading in this browser session.</p>
            <Link href="/sign-in" className="focus-ring mt-5 inline-flex min-h-11 items-center justify-center rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white">Sign in again</Link>
          </section>
        </main>
      </body>
    </html>
  );
}
