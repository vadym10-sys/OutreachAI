const plans = [
  ["Starter", "$49/mo", "For solo operators"],
  ["Pro", "$99/mo", "For growing teams"],
  ["Agency", "$299/mo", "For agencies"]
];

export default function BillingPage() {
  return (
    <div className="min-w-0">
      <h1 className="text-2xl font-bold min-[390px]:text-3xl">Billing</h1>
      <p className="mt-2 text-slate-600">Manage subscriptions, plan changes, cancellation, and invoices through Stripe.</p>
      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        {plans.map(([name, price, desc]) => (
          <article key={name} className="min-w-0 rounded-lg border border-slate-200 bg-white p-4 min-[360px]:p-5">
            <h2 className="text-xl font-bold">{name}</h2>
            <p className="mt-3 text-2xl font-bold min-[390px]:text-3xl">{price}</p>
            <p className="mt-2 text-slate-500">{desc}</p>
            <button className="focus-ring mt-5 min-h-11 w-full rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white min-[390px]:w-auto">Choose plan</button>
          </article>
        ))}
      </div>
      <section className="mt-6 min-w-0 rounded-lg border border-slate-200 bg-white p-4 min-[360px]:p-5">
        <h2 className="font-bold">Payment history</h2>
        <div className="mt-4 text-sm text-slate-600">Invoices are loaded from Stripe customer portal in production.</div>
      </section>
    </div>
  );
}
