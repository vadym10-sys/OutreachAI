import { Search } from "lucide-react";
import { leads } from "@/lib/fixtures";

export default function LeadsPage() {
  return (
    <div className="min-w-0">
      <h1 className="text-2xl font-bold min-[390px]:text-3xl">Lead Finder</h1>
      <p className="mt-2 text-slate-600">Choose a niche, country, and city to collect company leads.</p>
      <form className="mt-6 grid gap-3 rounded-lg border border-slate-200 bg-white p-4 min-[360px]:p-5 md:grid-cols-4">
        <input className="min-w-0 rounded-md border border-slate-300 px-3 py-2" placeholder="Niche" defaultValue="Real estate" />
        <input className="min-w-0 rounded-md border border-slate-300 px-3 py-2" placeholder="Country" defaultValue="United States" />
        <input className="min-w-0 rounded-md border border-slate-300 px-3 py-2" placeholder="City" defaultValue="Austin" />
        <button className="focus-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-brand px-4 py-2 font-semibold text-white"><Search size={18} />Find leads</button>
      </form>
      <div className="mt-6 hidden overflow-hidden rounded-lg border border-slate-200 bg-white lg:block">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-500"><tr><th className="p-3">Company</th><th>Website</th><th>Email</th><th>Phone</th><th>LinkedIn</th><th>Status</th></tr></thead>
          <tbody>
            {leads.map((lead) => (
              <tr key={lead.company} className="border-t border-slate-200">
                <td className="p-3 font-medium">{lead.company}</td><td>{lead.site}</td><td>{lead.email}</td><td>{lead.phone}</td><td>{lead.linkedin}</td><td>{lead.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-6 space-y-3 lg:hidden">
        {leads.map((lead) => (
          <article key={lead.company} className="rounded-lg border border-slate-200 bg-white p-4 text-sm">
            <div className="flex items-start justify-between gap-3">
              <h2 className="font-semibold text-ink">{lead.company}</h2>
              <span className="shrink-0 rounded-full bg-teal-50 px-2.5 py-1 text-xs font-semibold text-brand">{lead.status}</span>
            </div>
            <dl className="mt-3 space-y-2 text-slate-600">
              <div className="min-w-0"><dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">Website</dt><dd className="break-all">{lead.site}</dd></div>
              <div className="min-w-0"><dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">Email</dt><dd className="break-all">{lead.email}</dd></div>
              <div><dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">Phone</dt><dd>{lead.phone}</dd></div>
              <div className="min-w-0"><dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">LinkedIn</dt><dd className="break-all">{lead.linkedin}</dd></div>
            </dl>
          </article>
        ))}
      </div>
    </div>
  );
}
