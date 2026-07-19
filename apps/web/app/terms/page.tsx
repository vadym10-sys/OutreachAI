import Link from "next/link";

export const metadata = {
  title: "Terms of Service | OutreachAI",
  description: "Terms for using OutreachAI customer search, CRM and email drafting."
};

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10 text-ink">
      <article className="mx-auto max-w-3xl rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <Link href="/" className="text-sm font-black text-brand">OutreachAI</Link>
        <h1 className="mt-4 text-3xl font-black tracking-tight">Terms of Service</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">Last updated: July 19, 2026.</p>
        <div className="mt-8 space-y-6 text-sm leading-7 text-slate-700">
          <section>
            <h2 className="text-lg font-black text-ink">Permitted Use</h2>
            <p className="mt-2">Use OutreachAI for lawful B2B prospect research, CRM management and reviewed business email drafting.</p>
          </section>
          <section>
            <h2 className="text-lg font-black text-ink">Public Sources</h2>
            <p className="mt-2">Users must not use the service to bypass paywalls, access controls, rate limits, private communities or restrictions set by source websites.</p>
          </section>
          <section>
            <h2 className="text-lg font-black text-ink">Manual Approval</h2>
            <p className="mt-2">OutreachAI prepares drafts and CRM records for review. Users remain responsible for approving any save, send or external outreach action.</p>
          </section>
          <section>
            <h2 className="text-lg font-black text-ink">Billing</h2>
            <p className="mt-2">Paid usage, trials, upgrades, downgrades and cancellations are managed through the Billing page and Stripe customer portal when configured.</p>
          </section>
        </div>
      </article>
    </main>
  );
}
