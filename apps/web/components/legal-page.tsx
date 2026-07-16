import Link from "next/link";
import { ArrowLeft, ShieldCheck } from "lucide-react";

type LegalPageProps = {
  eyebrow: string;
  title: string;
  description: string;
  sections: Array<{ title: string; copy: string }>;
};

export function LegalPage({ eyebrow, title, description, sections }: LegalPageProps) {
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-ink min-[360px]:px-5 sm:py-12">
      <div className="mx-auto max-w-4xl">
        <Link href="/" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-black text-ink shadow-sm">
          <ArrowLeft size={17} /> Back to OutreachAI
        </Link>
        <header className="mt-8 rounded-[1.5rem] border border-slate-200 bg-white p-6 shadow-soft sm:p-8">
          <p className="ui-eyebrow">{eyebrow}</p>
          <h1 className="mt-3 text-4xl font-black leading-tight text-ink sm:text-5xl">{title}</h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600">{description}</p>
        </header>
        <div className="mt-6 grid gap-4">
          {sections.map((section) => (
            <section key={section.title} className="rounded-[1.25rem] border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex gap-3">
                <ShieldCheck size={20} className="mt-1 shrink-0 text-brand" />
                <div>
                  <h2 className="text-xl font-black text-ink">{section.title}</h2>
                  <p className="mt-2 text-sm leading-7 text-slate-600">{section.copy}</p>
                </div>
              </div>
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}
