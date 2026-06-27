import { Loader2 } from "lucide-react";

export default function Loading() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <section className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-6 text-center shadow-soft">
        <Loader2 className="mx-auto animate-spin text-brand" size={28} />
        <h1 className="mt-4 text-lg font-bold text-ink">Loading OutreachAI</h1>
        <p className="mt-2 text-sm text-slate-600">Preparing your workspace.</p>
      </section>
    </main>
  );
}

