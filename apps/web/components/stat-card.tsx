export function StatCard({ label, value, detail }: { label: string; value: string | number; detail: string }) {
  return (
    <div className="ui-card rounded-[1.5rem] p-5">
      <p className="text-sm font-semibold text-slate-500 dark:text-slate-300">{label}</p>
      <p className="mt-2 text-3xl font-black tracking-tight text-ink dark:text-white">{value}</p>
      <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{detail}</p>
    </div>
  );
}
