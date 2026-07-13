import Link from "next/link";
import { ArrowRight } from "lucide-react";

export function PrimaryLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="focus-ring ui-button ui-button-primary min-h-11 w-full px-5 py-3 text-center text-sm min-[360px]:w-auto">
      {children}
      <ArrowRight size={18} aria-hidden="true" />
    </Link>
  );
}

export function SecondaryLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="focus-ring ui-button ui-button-secondary min-h-11 w-full px-5 py-3 text-center text-sm min-[360px]:w-auto">
      {children}
    </Link>
  );
}
