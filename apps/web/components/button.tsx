import Link from "next/link";
import { ArrowRight } from "lucide-react";

export function PrimaryLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="focus-ring inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-ink px-5 py-3 text-center text-sm font-semibold text-white shadow-soft transition hover:bg-slate-800 min-[360px]:w-auto">
      {children}
      <ArrowRight size={18} aria-hidden="true" />
    </Link>
  );
}

export function SecondaryLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="focus-ring inline-flex min-h-11 w-full items-center justify-center rounded-md border border-slate-300 bg-white px-5 py-3 text-center text-sm font-semibold text-ink transition hover:border-slate-400 min-[360px]:w-auto">
      {children}
    </Link>
  );
}
