import Link from "next/link";

export const metadata = {
  title: "Privacy Policy | OutreachAI",
  description: "How OutreachAI handles workspace, CRM, search and email data."
};

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10 text-ink">
      <article className="mx-auto max-w-3xl rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <Link href="/" className="text-sm font-black text-brand">OutreachAI</Link>
        <h1 className="mt-4 text-3xl font-black tracking-tight">Privacy Policy</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">Last updated: July 19, 2026.</p>
        <div className="mt-8 space-y-6 text-sm leading-7 text-slate-700">
          <section>
            <h2 className="text-lg font-black text-ink">What We Store</h2>
            <p className="mt-2">OutreachAI stores account, workspace, CRM, search result, public-source evidence, email draft, sending status and billing metadata needed to operate the product.</p>
          </section>
          <section>
            <h2 className="text-lg font-black text-ink">How AI Is Used</h2>
            <p className="mt-2">AI is used to analyze the user-provided product context, classify public business information, explain fit and prepare draft messages. AI is not treated as a source of facts.</p>
          </section>
          <section>
            <h2 className="text-lg font-black text-ink">Outreach Safety</h2>
            <p className="mt-2">The product does not send messages automatically. CRM saves and email sends require explicit user action.</p>
          </section>
          <section>
            <h2 className="text-lg font-black text-ink">Your Controls</h2>
            <p className="mt-2">Workspace owners can request account deletion and export workspace data from the authenticated application. Secrets and provider credentials are never included in exports.</p>
          </section>
        </div>
      </article>
    </main>
  );
}
