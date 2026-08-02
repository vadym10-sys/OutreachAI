"use client";

import Link from "next/link";
import { ArrowRight, FileText, LockKeyhole, Mail, Scale, ShieldCheck, Wand2 } from "lucide-react";
import { AppBadge, SurfaceCard } from "@/components/design-system";
import { LanguageSwitcher } from "@/components/language-switcher";
import { useI18n } from "@/lib/i18n/provider";
import { publicSupportEmail } from "@/lib/public-contact";

type LegalPageSection = {
  title: string;
  body: string[];
};

type LegalPageProps = {
  eyebrow: string;
  title: string;
  summary: string;
  updated: string;
  sections: LegalPageSection[];
  activePath: "/privacy" | "/terms" | "/security";
};

const legalLinks = [
  { href: "/privacy", label: "Privacy Policy", icon: FileText },
  { href: "/terms", label: "Terms of Service", icon: Scale },
  { href: "/security", label: "Security", icon: ShieldCheck },
  { href: `mailto:${publicSupportEmail}`, label: "Support", icon: Mail },
] as const;

function PublicHeader() {
  const { t } = useI18n();

  return (
    <header className="sticky top-0 z-30 border-b border-[var(--ui-border)] bg-[rgba(247,246,242,0.86)] backdrop-blur-xl">
      <nav className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-4 min-[360px]:px-5">
        <Link href="/" className="flex min-h-11 shrink-0 items-center gap-3 text-lg font-black tracking-tight text-[var(--ui-text)]">
          <span className="grid size-9 place-items-center rounded-2xl bg-[var(--ui-text)] text-xs text-white shadow-soft">OA</span>
          <span>OutreachAI</span>
        </Link>
        <div className="flex shrink-0 items-center gap-2">
          <LanguageSwitcher compact />
          <Link href="/sign-in" className="inline-flex min-h-11 items-center rounded-full px-3 text-sm font-bold text-[var(--ui-text-soft)] hover:bg-white min-[390px]:px-4">
            {t("Login")}
          </Link>
          <Link href="/sign-up?plan=Starter" className="focus-ring hidden min-h-11 items-center rounded-full bg-[var(--ui-brand)] px-5 text-sm font-black text-white shadow-soft transition hover:bg-[var(--ui-brand-strong)] sm:inline-flex">
            {t("Start finding customers")}
          </Link>
        </div>
      </nav>
    </header>
  );
}

function PublicFooter({ activePath }: { activePath: LegalPageProps["activePath"] }) {
  const { t } = useI18n();

  return (
    <footer className="border-t border-[var(--ui-border)] bg-white/60 px-4 py-8 text-sm text-[var(--ui-text-soft)] min-[360px]:px-5">
      <div className="mx-auto flex max-w-7xl flex-col gap-5 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="font-black text-[var(--ui-text)]">OutreachAI</p>
          <p className="mt-1">{t("Lead intelligence, explainable AI, CRM handoff and reviewed outreach.")}</p>
        </div>
        <nav aria-label="Legal pages" className="flex flex-wrap items-center gap-2">
          {legalLinks.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              aria-current={href === activePath ? "page" : undefined}
              className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-full border border-[var(--ui-border)] bg-white px-4 text-sm font-bold text-[var(--ui-text)] transition hover:border-[var(--ui-border-strong)]"
            >
              <Icon size={16} aria-hidden="true" />
              {t(label)}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}

export function PublicLegalPage({ eyebrow, title, summary, updated, sections, activePath }: LegalPageProps) {
  const { t } = useI18n();

  return (
    <main className="landing-safe min-w-0 max-w-[100vw] overflow-x-clip bg-[var(--ui-bg)] text-[var(--ui-text)]">
      <PublicHeader />

      <section className="mx-auto grid max-w-7xl gap-8 px-4 pb-12 pt-12 min-[360px]:px-5 md:pb-16 lg:grid-cols-[0.7fr_0.3fr] lg:pt-16">
        <div className="min-w-0">
          <AppBadge tone="brand" className="mb-5">{t(eyebrow)}</AppBadge>
          <h1 className="max-w-4xl text-[clamp(2.25rem,8vw,4.5rem)] font-black leading-[0.98] tracking-normal text-[var(--ui-text)]">
            {t(title)}
          </h1>
          <p className="mt-6 max-w-3xl text-base leading-8 text-[var(--ui-text-soft)] min-[390px]:text-lg">{t(summary)}</p>
        </div>
        <SurfaceCard as="div" className="h-fit rounded-[1.5rem] p-5" role="note" aria-label="Page revision note">
          <div className="grid size-11 place-items-center rounded-2xl bg-[var(--ui-brand-soft)] text-[var(--ui-brand)]">
            <LockKeyhole size={21} aria-hidden="true" />
          </div>
          <p className="mt-4 text-xs font-bold uppercase text-[var(--ui-text-soft)]">{t("Last updated")}</p>
          <p className="mt-1 text-lg font-black text-[var(--ui-text)]">{t(updated)}</p>
          <p className="mt-4 text-sm leading-6 text-[var(--ui-text-soft)]">
            {t("These pages describe the public website and application terms at a product level. They do not add certifications, guarantees, or company details that are not represented elsewhere in the product.")}
          </p>
        </SurfaceCard>
      </section>

      <section className="mx-auto max-w-5xl px-4 pb-16 min-[360px]:px-5">
        <div className="grid gap-4">
          {sections.map((section) => (
            <SurfaceCard key={section.title} as="article" className="rounded-[1.25rem] p-5 sm:p-6">
              <h2 className="text-xl font-black text-[var(--ui-text)]">{t(section.title)}</h2>
              <div className="mt-3 space-y-3 text-sm leading-7 text-[var(--ui-text-soft)]">
                {section.body.map((paragraph) => <p key={paragraph}>{t(paragraph)}</p>)}
              </div>
            </SurfaceCard>
          ))}
        </div>
      </section>

      <section className="px-4 py-10 min-[360px]:px-5">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 overflow-hidden rounded-[1.75rem] bg-[var(--ui-text)] p-6 text-white shadow-raised sm:p-8 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <Wand2 className="text-[var(--ui-accent)]" size={24} aria-hidden="true" />
            <h2 className="mt-4 text-3xl font-black leading-tight">{t("Use OutreachAI with clear human approval.")}</h2>
          </div>
          <Link href="/sign-up?plan=Starter" className="focus-ring inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-white px-5 text-sm font-black text-[var(--ui-text)] sm:w-auto">
            {t("Start finding customers")} <ArrowRight size={18} aria-hidden="true" />
          </Link>
        </div>
      </section>

      <PublicFooter activePath={activePath} />
    </main>
  );
}
