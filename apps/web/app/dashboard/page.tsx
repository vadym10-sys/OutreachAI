import { Activity, MousePointerClick, Reply, Send } from "lucide-react";
import { StatCard } from "@/components/stat-card";
import { campaigns, metrics } from "@/lib/fixtures";

export default function DashboardPage() {
  const activity = [
    { Icon: Send, label: "286 scheduled emails" },
    { Icon: MousePointerClick, label: "41 tracked clicks" },
    { Icon: Reply, label: "19 new replies" },
    { Icon: Activity, label: "7 leads moved stage" }
  ];

  return (
    <div className="min-w-0">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-ink min-[390px]:text-3xl">Dashboard</h1>
          <p className="mt-2 text-slate-600">Pipeline health across leads, campaigns, replies, and conversion.</p>
        </div>
        <button className="focus-ring min-h-11 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white">Create campaign</button>
      </div>
      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Leads" value={metrics.leads.toLocaleString()} detail="+18% this month" />
        <StatCard label="Sent emails" value={metrics.emails_sent.toLocaleString()} detail="Across 14 campaigns" />
        <StatCard label="Open rate" value={`${metrics.open_rate}%`} detail="Benchmark +12%" />
        <StatCard label="Replies" value={metrics.replies} detail="42 positive" />
        <StatCard label="Conversions" value={metrics.conversions} detail={`ROI ${metrics.roi}x`} />
      </div>
      <div className="mt-8 grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <section className="min-w-0 rounded-lg border border-slate-200 bg-white p-4 min-[360px]:p-5">
          <h2 className="text-lg font-bold">Active campaigns</h2>
          <div className="mt-4 hidden overflow-hidden rounded-md border border-slate-200 md:block">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-500">
                <tr><th className="p-3">Name</th><th>Status</th><th>Leads</th><th>Sent</th><th>Replies</th></tr>
              </thead>
              <tbody>
                {campaigns.map((campaign) => (
                  <tr key={campaign.name} className="border-t border-slate-200">
                    <td className="p-3 font-medium">{campaign.name}</td><td>{campaign.status}</td><td>{campaign.leads}</td><td>{campaign.sent}</td><td>{campaign.replies}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 space-y-3 md:hidden">
            {campaigns.map((campaign) => (
              <article key={campaign.name} className="rounded-md border border-slate-200 p-3 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <p className="font-semibold">{campaign.name}</p>
                  <span className="shrink-0 rounded-full bg-teal-50 px-2.5 py-1 text-xs font-semibold text-brand">{campaign.status}</span>
                </div>
                <dl className="mt-3 grid grid-cols-3 gap-2 text-slate-600">
                  <div><dt className="text-xs">Leads</dt><dd className="font-semibold text-ink">{campaign.leads}</dd></div>
                  <div><dt className="text-xs">Sent</dt><dd className="font-semibold text-ink">{campaign.sent}</dd></div>
                  <div><dt className="text-xs">Replies</dt><dd className="font-semibold text-ink">{campaign.replies}</dd></div>
                </dl>
              </article>
            ))}
          </div>
        </section>
        <section className="min-w-0 rounded-lg border border-slate-200 bg-white p-4 min-[360px]:p-5">
          <h2 className="text-lg font-bold">Today</h2>
          <div className="mt-4 space-y-3">
            {activity.map(({ Icon, label }) => (
              <div key={label} className="flex items-center gap-3 rounded-md bg-slate-50 p-3 text-sm">
                <Icon className="text-brand" size={18} />
                <span>{label}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
