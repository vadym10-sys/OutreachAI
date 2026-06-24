import { leads } from "@/lib/fixtures";

const stages = ["New", "Contacted", "Replied", "Interested", "Meeting Booked", "Closed"];

export default function CrmPage() {
  return (
    <div>
      <h1 className="text-3xl font-bold">CRM</h1>
      <div className="mt-6 grid gap-4 xl:grid-cols-6">
        {stages.map((stage) => (
          <section key={stage} className="rounded-lg border border-slate-200 bg-white p-3">
            <h2 className="text-sm font-bold text-slate-700">{stage}</h2>
            <div className="mt-3 space-y-3">
              {leads.filter((lead) => lead.status === stage || stage === "New").slice(0, stage === "New" ? 2 : 1).map((lead) => (
                <article key={`${stage}-${lead.company}`} className="rounded-md border border-slate-200 p-3 text-sm">
                  <p className="font-semibold">{lead.company}</p>
                  <p className="mt-1 text-slate-500">{lead.email}</p>
                  <textarea className="mt-3 h-20 w-full rounded-md border border-slate-300 p-2" placeholder="Notes" />
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
