import Link from "next/link";

export const metadata = {
  title: "Security | OutreachAI",
  description: "Security controls for OutreachAI authentication, workspaces, emails and integrations."
};

export default function SecurityPage() {
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10 text-ink">
      <article className="mx-auto max-w-3xl rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <Link href="/" className="text-sm font-black text-brand">OutreachAI</Link>
        <h1 className="mt-4 text-3xl font-black tracking-tight">Security</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">OutreachAI is designed around authenticated access, workspace isolation and manual approval for external actions.</p>
        <div className="mt-8 space-y-6 text-sm leading-7 text-slate-700">
          <section>
            <h2 className="text-lg font-black text-ink">Authentication</h2>
            <p className="mt-2">Customer routes require an authenticated session. Test-only bypasses are limited to local test environments.</p>
          </section>
          <section>
            <h2 className="text-lg font-black text-ink">Workspace Isolation</h2>
            <p className="mt-2">CRM records, email drafts, search results, settings and billing state are scoped to the active workspace on the server.</p>
          </section>
          <section>
            <h2 className="text-lg font-black text-ink">External Services</h2>
            <p className="mt-2">Provider keys are configured as server-side environment variables and are not exposed in the browser, exports, logs or source code.</p>
          </section>
          <section>
            <h2 className="text-lg font-black text-ink">Headers And Backups</h2>
            <p className="mt-2">Production deployments include security headers. Database backups and restore verification must be configured in production infrastructure before final launch.</p>
          </section>
        </div>
      </article>
    </main>
  );
}
