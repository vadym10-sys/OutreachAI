import Link from 'next/link';
import { CheckCircle2 } from 'lucide-react';

export default function BillingSuccessPage({ searchParams }: { searchParams: Promise<{ session_id?: string }> }) {
  void searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <section className="w-full max-w-lg rounded-lg border border-slate-200 bg-white p-6 text-center shadow-soft">
        <CheckCircle2 className="mx-auto text-brand" size={42} />
        <h1 className="mt-4 text-2xl font-bold text-ink">Subscription checkout complete</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">Stripe is activating your monthly subscription. Your billing status will update from the webhook.</p>
        <Link href="/dashboard/billing" className="focus-ring mt-6 inline-flex min-h-11 items-center justify-center rounded-md bg-ink px-5 py-3 text-sm font-semibold text-white">Open billing</Link>
      </section>
    </main>
  );
}
