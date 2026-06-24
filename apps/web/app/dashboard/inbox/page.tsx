export default function InboxPage() {
  const replies = ["Interested in a demo next week", "Send pricing for our agency", "Not now, follow up in Q3"];
  return (
    <div>
      <h1 className="text-3xl font-bold">Unified Inbox</h1>
      <div className="mt-6 rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex gap-3">
          <input className="w-full rounded-md border border-slate-300 px-3 py-2" placeholder="Search replies" />
          <button className="rounded-md border border-slate-300 px-4 py-2 font-semibold">Filter</button>
        </div>
        <div className="mt-5 divide-y divide-slate-200">
          {replies.map((reply) => (
            <article key={reply} className="py-4">
              <div className="flex items-center justify-between">
                <p className="font-semibold">{reply}</p>
                <span className="rounded-full bg-orange-50 px-3 py-1 text-xs font-semibold text-coral">Hot lead</span>
              </div>
              <p className="mt-2 text-sm text-slate-500">Tagged, searchable, and synced to CRM status automatically.</p>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
