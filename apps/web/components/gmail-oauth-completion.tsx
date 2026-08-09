"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAiFirstApi } from "@/lib/ai-first-api";
import { friendlyErrorMessage } from "@/lib/client-api";

type CompletionState = "working" | "success" | "failed";

function safeMailStatus(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("user_mismatch")) return "user_mismatch";
  if (message.includes("handoff_expired")) return "handoff_expired";
  if (message.includes("handoff_replayed")) return "handoff_replayed";
  if (message.includes("workspace_mismatch")) return "workspace_error";
  if (message.includes("oauth_failed")) return "oauth_failed";
  if (message.includes("missing_refresh")) return "missing_refresh";
  if (message.includes("test_user_required")) return "test_user_required";
  return "oauth_failed";
}

export function GmailOAuthCompletion() {
  const router = useRouter();
  const params = useSearchParams();
  const handoff = useMemo(() => params.get("handoff") || "", [params]);
  const api = useAiFirstApi();
  const [state, setState] = useState<CompletionState>("working");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!api.ready || !handoff) return;
      try {
        await api.finalizeGmailOAuth(handoff);
        if (cancelled) return;
        setState("success");
        router.replace("/dashboard/settings?mail=connected");
      } catch (err) {
        if (cancelled) return;
        const status = safeMailStatus(err);
        setError(friendlyErrorMessage(err, "Gmail could not be connected. Please try again."));
        setState("failed");
        router.replace(`/dashboard/settings?mail=${encodeURIComponent(status)}`);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [api, api.ready, handoff, router]);

  if (!handoff) {
    return (
      <section className="mx-auto flex min-h-[60vh] max-w-lg flex-col justify-center px-4 py-12">
        <h1 className="text-2xl font-semibold text-ink">Gmail connection could not be completed</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">Start Gmail connection again from settings.</p>
        <Link href="/dashboard/settings" className="focus-ring mt-6 inline-flex w-fit items-center rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white">
          Back to settings
        </Link>
      </section>
    );
  }

  return (
    <section className="mx-auto flex min-h-[60vh] max-w-lg flex-col justify-center px-4 py-12">
      <h1 className="text-2xl font-semibold text-ink">
        {state === "failed" ? "Gmail connection could not be completed" : "Finishing Gmail connection"}
      </h1>
      <p className="mt-3 text-sm leading-6 text-slate-600">
        {state === "success"
          ? "Gmail is connected."
          : state === "failed"
            ? error
            : "Verifying your signed-in workspace before saving Gmail."}
      </p>
      {state === "failed" ? (
        <Link href="/dashboard/settings" className="focus-ring mt-6 inline-flex w-fit items-center rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white">
          Back to settings
        </Link>
      ) : null}
    </section>
  );
}
