import { leads } from "@/lib/fixtures";

const stages = ["New", "Contacted", "Replied", "Interested", "Meeting Booked", "Closed"];

export default function CrmPage() {
  return (
    <div className="min-w-0">
      <h1 className="text-2xl font-bold min-[390px]:text-3xl">CRM</h1>
      <div className="mt-6 grid gap-4 xl:grid-cols-6">
        {stages.map((stage) => (
          <section key={stage} className="min-w-0 rounded-lg border border-slate-200 bg-white p-3">
            <h2 className="text-sm font-bold text-slate-700">{stage}</h2>
            <div className="mt-3 space-y-3">
              {leads.filter((lead) => lead.status === stage || stage === "New").slice(0, stage === "New" ? 2 : 1).map((lead) => (
                <article key={`${stage}-${lead.company}`} className="min-w-0 rounded-md border border-slate-200 p-3 text-sm">
                  <p className="font-semibold">{lead.company}</p>
                  <p className="mt-1 break-all text-slate-500">{lead.email}</p>
                  <textarea className="mt-3 min-h-24 w-full rounded-md border border-slate-300 p-2" placeholder="Notes" />
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
