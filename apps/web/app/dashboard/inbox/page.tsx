export default function InboxPage() {
  const replies = ["Interested in a demo next week", "Send pricing for our agency", "Not now, follow up in Q3"];
  return (
    <div className="min-w-0">
      <h1 className="text-2xl font-bold min-[390px]:text-3xl">Unified Inbox</h1>
      <div className="mt-6 rounded-lg border border-slate-200 bg-white p-4 min-[360px]:p-5">
        <div className="flex flex-col gap-3 min-[390px]:flex-row">
          <input className="min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-2" placeholder="Search replies" />
          <button className="focus-ring min-h-11 rounded-md border border-slate-300 px-4 py-2 font-semibold">Filter</button>
        </div>
        <div className="mt-5 divide-y divide-slate-200">
          {replies.map((reply) => (
            <article key={reply} className="py-4">
              <div className="flex flex-col gap-2 min-[390px]:flex-row min-[390px]:items-center min-[390px]:justify-between">
                <p className="font-semibold">{reply}</p>
                <span className="w-fit rounded-full bg-orange-50 px-3 py-1 text-xs font-semibold text-coral">Hot lead</span>
              </div>
              <p className="mt-2 text-sm text-slate-500">Tagged, searchable, and synced to CRM status automatically.</p>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
