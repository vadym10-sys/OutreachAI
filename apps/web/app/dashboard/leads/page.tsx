import { Search } from "lucide-react";
import { leads } from "@/lib/fixtures";

export default function LeadsPage() {
  return (
    <div>
      <h1 className="text-3xl font-bold">Lead Finder</h1>
      <p className="mt-2 text-slate-600">Choose a niche, country, and city to collect company leads.</p>
      <form className="mt-6 grid gap-3 rounded-lg border border-slate-200 bg-white p-5 md:grid-cols-4">
        <input className="rounded-md border border-slate-300 px-3 py-2" placeholder="Niche" defaultValue="Real estate" />
        <input className="rounded-md border border-slate-300 px-3 py-2" placeholder="Country" defaultValue="United States" />
        <input className="rounded-md border border-slate-300 px-3 py-2" placeholder="City" defaultValue="Austin" />
        <button className="focus-ring inline-flex items-center justify-center gap-2 rounded-md bg-brand px-4 py-2 font-semibold text-white"><Search size={18} />Find leads</button>
      </form>
      <div className="mt-6 overflow-hidden rounded-lg border border-slate-200 bg-white">
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
    </div>
  );
}
