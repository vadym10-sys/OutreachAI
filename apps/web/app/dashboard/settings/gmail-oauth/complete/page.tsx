import { Suspense } from "react";
import { GmailOAuthCompletion } from "@/components/gmail-oauth-completion";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function GmailOAuthCompletePage() {
  return (
    <Suspense fallback={<div className="px-4 py-12 text-sm text-slate-600">Finishing Gmail connection...</div>}>
      <GmailOAuthCompletion />
    </Suspense>
  );
}
