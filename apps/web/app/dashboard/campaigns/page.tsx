import { Pause, Play, Square } from "lucide-react";
import { campaigns } from "@/lib/fixtures";

export default function CampaignsPage() {
  return (
    <div>
      <h1 className="text-3xl font-bold">Campaign Manager</h1>
      <p className="mt-2 text-slate-600">Create, launch, pause, stop, schedule, and automate follow-ups.</p>
      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        {campaigns.map((campaign) => (
          <article key={campaign.name} className="rounded-lg border border-slate-200 bg-white p-5">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="font-bold">{campaign.name}</h2>
                <p className="mt-1 text-sm text-slate-500">{campaign.status}</p>
              </div>
              <span className="rounded-full bg-teal-50 px-3 py-1 text-xs font-semibold text-brand">{campaign.replies} replies</span>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-md bg-slate-50 p-3"><b>{campaign.leads}</b><br />Leads</div>
              <div className="rounded-md bg-slate-50 p-3"><b>{campaign.sent}</b><br />Sent</div>
            </div>
            <div className="mt-5 flex gap-2">
              <button title="Launch" className="rounded-md border border-slate-300 p-2"><Play size={18} /></button>
              <button title="Pause" className="rounded-md border border-slate-300 p-2"><Pause size={18} /></button>
              <button title="Stop" className="rounded-md border border-slate-300 p-2"><Square size={18} /></button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
