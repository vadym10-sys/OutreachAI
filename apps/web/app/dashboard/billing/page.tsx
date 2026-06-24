const plans = [
  ["Starter", "$49/mo", "For solo operators"],
  ["Pro", "$99/mo", "For growing teams"],
  ["Agency", "$299/mo", "For agencies"]
];

export default function BillingPage() {
  return (
    <div>
      <h1 className="text-3xl font-bold">Billing</h1>
      <p className="mt-2 text-slate-600">Manage subscriptions, plan changes, cancellation, and invoices through Stripe.</p>
      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        {plans.map(([name, price, desc]) => (
          <article key={name} className="rounded-lg border border-slate-200 bg-white p-5">
            <h2 className="text-xl font-bold">{name}</h2>
            <p className="mt-3 text-3xl font-bold">{price}</p>
            <p className="mt-2 text-slate-500">{desc}</p>
            <button className="mt-5 rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white">Choose plan</button>
          </article>
        ))}
      </div>
      <section className="mt-6 rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="font-bold">Payment history</h2>
        <div className="mt-4 text-sm text-slate-600">Invoices are loaded from Stripe customer portal in production.</div>
      </section>
    </div>
  );
}
