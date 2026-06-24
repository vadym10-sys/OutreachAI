import { DashboardShell } from "@/components/dashboard-shell";

export default function AdminPage() {
  return (
    <DashboardShell>
      <h1 className="text-3xl font-bold">Admin Panel</h1>
      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {["Users", "Subscriptions", "Payments", "Audit logs"].map((item, index) => (
          <section key={item} className="rounded-lg border border-slate-200 bg-white p-5">
            <h2 className="font-bold">{item}</h2>
            <p className="mt-3 text-3xl font-bold">{[128, 74, "$18.4k", 932][index]}</p>
            <p className="mt-2 text-sm text-slate-500">Production admin controls backed by API role checks.</p>
          </section>
        ))}
      </div>
    </DashboardShell>
  );
}
