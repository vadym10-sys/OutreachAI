"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import {
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Mail,
  MailCheck,
  Search,
  ShieldCheck,
  Sparkles,
  Wand2,
} from "lucide-react";
import { AppBadge, SurfaceCard } from "@/components/design-system";
import { LanguageSwitcher } from "@/components/language-switcher";
import { useI18n } from "@/lib/i18n/provider";
import { publicPlans } from "@/lib/plan-catalog";
import { publicSupportEmail } from "@/lib/public-contact";

const workflow = [
  "Describe the business",
  "Find a company with evidence",
  "Save to CRM",
  "Prepare a personal draft",
  "Approve manually",
  "Track the reply",
] as const;

const features = [
  ["AI Lead Intelligence", "Scores ICP match, buying intent, growth, hiring, funding, expansion, website quality and outreach readiness."],
  ["Explainable AI", "Shows facts, evidence, missing evidence, positive and negative signals before action."],
  ["Research Profile", "Summarises business model, ICP, digital maturity, AI readiness, momentum and risks."],
  ["Outreach Strategy", "Recommends decision maker, channel, CTA, timing, priority and manual review status."],
  ["Email approval safety", "AI creates drafts only. Real sending requires explicit user confirmation."],
  ["CRM handoff", "Qualified companies can be saved into the existing CRM without turning discovery into a complex pipeline."],
] as const;

const faq = [
  ["Does OutreachAI send automatically?", "No. AI prepares drafts only, and every real send requires manual approval."],
  ["Where do scores come from?", "AI Lead Intelligence fields and available evidence in the production lead record."],
  ["Can Gmail be skipped?", "Yes. Users can start discovery first and connect Gmail later from settings."],
  ["What happens with insufficient data?", "Insufficient data stays visible and should be routed to review instead of being treated as a fact."],
  ["How do I get support?", "Email the confirmed support contact listed on this page."],
] as const;

const legalLinks = [
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
  { href: "/security", label: "Security" },
  { href: `mailto:${publicSupportEmail}`, label: "Support" },
] as const;

function AuthNavigationLink({
  href,
  className,
  testId,
  children,
}: {
  href: string;
  className: string;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      prefetch={false}
      onClick={(event) => {
        event.preventDefault();
        window.location.assign(href);
      }}
      data-testid={testId}
      className={className}
    >
      {children}
    </Link>
  );
}

function ProductPreview() {
  const { t } = useI18n();
  const previewSteps = [
    ["Business description", "Demo business: logistics software for mid-market operators in Germany."],
    ["Company with evidence", "Demo candidate shows website context, hiring signal and fit notes before any CRM save."],
    ["Saved CRM record", "The company is saved as a reviewable opportunity, not as a fake customer result."],
    ["Personal draft", "AI prepares a draft using available evidence and flags missing proof."],
    ["Manual confirmation", "The user reviews the draft and approves before any send action is available."],
    ["Reply tracking", "Replies are tracked only after an approved email is sent through the workspace."],
  ] as const;

  return (
    <SurfaceCard className="relative overflow-hidden rounded-[1.875rem] p-5 shadow-raised sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-black text-[var(--ui-text)]">{t("AI Customer Finder")}</p>
          <p className="mt-1 text-xs font-bold text-[var(--ui-text-soft)]">{t("Demonstration fixture")}</p>
        </div>
        <AppBadge tone="brand">{t("Draft-only")}</AppBadge>
      </div>

      <div className="mt-5 rounded-[1.25rem] border border-[var(--ui-border)] bg-[var(--ui-surface)] p-4">
        <div className="flex items-start gap-3">
          <Search className="mt-0.5 shrink-0 text-[var(--ui-brand)]" size={18} aria-hidden="true" />
          <div>
            <p className="text-xs font-black uppercase tracking-[0.08em] text-[var(--ui-text-muted)]">{t("Describe the business")}</p>
            <p className="mt-1 text-sm leading-6 text-[var(--ui-text)]">{t("Find logistics companies in Germany with outdated websites.")}</p>
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-2">
        {previewSteps.map(([label, copy], index) => (
          <div key={label} className="flex items-start gap-3 rounded-[1.125rem] border border-[var(--ui-border)] bg-white px-3 py-3 shadow-sm">
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-[var(--ui-brand-soft)] text-xs font-black text-[var(--ui-brand)]">{index + 1}</span>
            <div className="min-w-0">
              <p className="text-xs font-black text-[var(--ui-text)]">{t(label)}</p>
              <p className="mt-1 text-xs leading-5 text-[var(--ui-text-soft)]">{t(copy)}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 grid gap-4 min-[520px]:grid-cols-2">
        <article className="rounded-[1.25rem] border border-[var(--ui-border)] bg-white p-4 shadow-sm">
          <p className="text-xs font-bold text-[var(--ui-text-soft)]">{t("Company candidate")}</p>
          <h3 className="mt-2 text-base font-black text-[var(--ui-text)]">{t("Evidence shown before action")}</h3>
          <div className="mt-4 flex flex-wrap gap-2">
            <AppBadge tone="success">{t("Overall Lead Score")}</AppBadge>
            <AppBadge tone="brand">{t("Quality Gate")}</AppBadge>
          </div>
          <p className="mt-3 text-sm leading-6 text-[var(--ui-text-soft)]">{t("Demo evidence uses safe fixture data, not customer production records.")}</p>
        </article>
        <article className="rounded-[1.25rem] border border-[var(--ui-border)] bg-[var(--ui-brand-soft)] p-4 shadow-sm">
          <p className="text-xs font-bold text-[var(--ui-text-soft)]">{t("AI reasoning")}</p>
          <h3 className="mt-2 text-base font-black text-[var(--ui-text)]">{t("Why this lead")}</h3>
          <p className="mt-4 text-sm leading-6 text-[var(--ui-text-soft)]">{t("Facts, missing evidence and outreach strategy are shown before CRM save or email approval.")}</p>
        </article>
      </div>

      <div className="mt-4 rounded-[1.25rem] border border-[var(--ui-border)] bg-[var(--ui-surface-danger)] p-4">
        <p className="text-sm font-black text-danger">{t("AI prepares drafts only. Users approve before sending.")}</p>
        <p className="mt-1 text-xs font-semibold leading-5 text-[var(--ui-text-soft)]">{t("Insufficient data stays visible and is routed to manual review.")}</p>
      </div>
    </SurfaceCard>
  );
}

export function LandingPage() {
  const { t } = useI18n();
  const schema = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "OutreachAI",
    applicationCategory: "SalesApplication",
    description: "AI-first sales platform for lead intelligence, explainable research, CRM handoff and manually approved outreach.",
    offers: publicPlans.map((plan) => ({
      "@type": "Offer",
      name: `OutreachAI ${plan.name}`,
      price: plan.monthlyPrice,
      priceCurrency: plan.currency,
      availability: "https://schema.org/InStock",
    })),
  };

  return (
    <main className="landing-safe min-w-0 max-w-[100vw] overflow-x-clip bg-[var(--ui-bg)] text-[var(--ui-text)]">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }} />

      <header className="sticky top-0 z-30 border-b border-[var(--ui-border)] bg-[rgba(247,246,242,0.86)] backdrop-blur-xl">
        <nav className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-4 min-[360px]:px-5">
          <Link href="/" className="flex min-h-11 shrink-0 items-center gap-3 text-lg font-black tracking-tight text-[var(--ui-text)]">
            <span className="grid size-9 place-items-center rounded-2xl bg-[var(--ui-text)] text-xs text-white shadow-soft">OA</span>
            <span>OutreachAI</span>
          </Link>
          <div className="hidden items-center gap-8 text-sm font-bold text-[var(--ui-text-soft)] md:flex">
            <a href="#product" className="hover:text-[var(--ui-text)]">{t("Product")}</a>
            <a href="#pricing" className="hover:text-[var(--ui-text)]">{t("Pricing")}</a>
            <a href="#faq" className="hover:text-[var(--ui-text)]">{t("FAQ")}</a>
            <a href="#contact" className="hover:text-[var(--ui-text)]">{t("Support")}</a>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <LanguageSwitcher compact />
            <AuthNavigationLink href="/sign-in" className="inline-flex min-h-11 items-center rounded-full px-3 text-sm font-bold text-[var(--ui-text-soft)] hover:bg-white min-[390px]:px-4">
              {t("Login")}
            </AuthNavigationLink>
            <AuthNavigationLink href="/sign-up?plan=Starter" className="focus-ring hidden min-h-11 items-center rounded-full bg-[var(--ui-brand)] px-5 text-sm font-black text-white shadow-soft transition hover:bg-[var(--ui-brand-strong)] sm:inline-flex">
              {t("Start finding customers")}
            </AuthNavigationLink>
          </div>
        </nav>
      </header>

      <section className="mx-auto grid max-w-7xl items-center gap-12 px-4 pb-20 pt-14 min-[360px]:px-5 sm:pt-20 lg:grid-cols-[0.95fr_1.05fr] lg:pb-24">
        <div className="min-w-0">
          <AppBadge tone="brand" className="mb-5">{t("AI-first sales workflow")}</AppBadge>
          <h1 className="max-w-3xl text-[clamp(2.65rem,10vw,4.9rem)] font-black leading-[0.96] tracking-normal text-[var(--ui-text)]">
            {t("Find the right companies. Understand why they will buy. Reach out with AI.")}
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-8 text-[var(--ui-text-soft)] min-[390px]:text-lg">
            {t("OutreachAI understands your business, finds relevant companies, explains buying signals and prepares personalised outreach.")}
          </p>
          <div className="mt-8 flex flex-col gap-3 min-[430px]:flex-row">
            <AuthNavigationLink href="/sign-up?plan=Starter" testId="hero-start-free-trial" className="focus-ring inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-[var(--ui-brand)] px-5 text-sm font-black text-white shadow-soft transition hover:bg-[var(--ui-brand-strong)] min-[430px]:w-auto">
              {t("Start finding customers")} <ArrowRight size={18} aria-hidden="true" />
            </AuthNavigationLink>
            <a href="#workflow" className="focus-ring inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full border border-[var(--ui-border)] bg-white px-5 text-sm font-black text-[var(--ui-text)] shadow-sm transition hover:border-[var(--ui-border-strong)] min-[430px]:w-auto">
              {t("See how it works")} <ChevronRight size={18} aria-hidden="true" />
            </a>
          </div>
          <div className="mt-8 grid gap-3 text-sm font-bold text-[var(--ui-text-soft)] sm:grid-cols-3">
            {["Manual approval", "Explainable scores", "No fake CRM data"].map((item) => (
              <span key={item} className="inline-flex items-center gap-2">
                <CheckCircle2 size={17} className="text-success" />
                {t(item)}
              </span>
            ))}
          </div>
        </div>
        <ProductPreview />
      </section>

      <section id="workflow" className="mx-auto max-w-7xl px-4 py-16 min-[360px]:px-5">
        <div className="max-w-3xl">
          <p className="ui-eyebrow">{t("How it works")}</p>
          <h2 className="ui-title mt-3 text-4xl">{t("A real workflow, shown as a demo fixture")}</h2>
        </div>
        <ol className="mt-8 grid gap-3 md:grid-cols-4">
          {workflow.map((step, index) => (
            <li key={step} className="rounded-[1.25rem] border border-[var(--ui-border)] bg-white p-4 shadow-sm">
              <span className="grid size-9 place-items-center rounded-full bg-[var(--ui-text)] text-sm font-black text-white">{index + 1}</span>
              <p className="mt-4 text-sm font-black text-[var(--ui-text)]">{t(step)}</p>
            </li>
          ))}
        </ol>
      </section>

      <section id="product" className="mx-auto max-w-7xl px-4 py-16 min-[360px]:px-5">
        <div className="max-w-3xl">
          <p className="ui-eyebrow">{t("Features")}</p>
          <h2 className="ui-title mt-3 text-4xl">{t("Built around the AI decision, then the human approval.")}</h2>
        </div>
        <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {features.map(([title, copy]) => (
            <SurfaceCard key={title} as="article" className="rounded-[1.5rem] p-5">
              <div className="grid size-10 place-items-center rounded-2xl bg-[var(--ui-brand-soft)] text-[var(--ui-brand)]">
                {title === "Email approval safety" ? <ShieldCheck size={20} /> : title === "CRM handoff" ? <CircleDot size={20} /> : <Sparkles size={20} />}
              </div>
              <h3 className="mt-5 text-lg font-black text-[var(--ui-text)]">{t(title)}</h3>
              <p className="mt-2 text-sm leading-6 text-[var(--ui-text-soft)]">{t(copy)}</p>
            </SurfaceCard>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-16 min-[360px]:px-5">
        <SurfaceCard className="grid gap-6 rounded-[2rem] p-6 lg:grid-cols-[0.8fr_1.2fr] lg:items-center">
          <div>
            <p className="ui-eyebrow">{t("Integrations")}</p>
            <h2 className="ui-title mt-3 text-4xl">{t("Works with the systems already in OutreachAI.")}</h2>
            <p className="ui-copy mt-3">{t("Authentication, Gmail OAuth, billing, CRM save and email approval stay connected to production logic.")}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {["Secure authentication", "Gmail OAuth", "Workspace billing", "Existing CRM"].map((item) => (
              <div key={item} className="rounded-[1.25rem] border border-[var(--ui-border)] bg-[var(--ui-surface)] p-4 text-sm font-black text-[var(--ui-text)]">
                <CheckCircle2 className="mb-3 text-success" size={18} />
                {t(item)}
              </div>
            ))}
          </div>
        </SurfaceCard>
      </section>

      <section id="pricing" className="mx-auto max-w-7xl px-4 py-16 min-[360px]:px-5">
        <div className="max-w-3xl">
          <p className="ui-eyebrow">{t("Pricing")}</p>
          <h2 className="ui-title mt-3 text-4xl">{t("Simple monthly pricing")}</h2>
          <p className="ui-copy mt-3">{t("Prices and limits come from the billing catalogue used by the application. Subscription changes are managed securely in the Stripe Billing Portal according to the active portal configuration.")}</p>
        </div>
        <div className="mt-8 grid gap-5 lg:grid-cols-3">
          {publicPlans.map((plan, index) => (
            <SurfaceCard key={plan.name} as="article" className={`rounded-[1.5rem] p-6 ${index === 1 ? "border-[var(--ui-brand)] shadow-glow" : ""}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-xl font-black text-[var(--ui-text)]">{t(plan.name)}</h3>
                  <p className="mt-3 text-4xl font-black text-[var(--ui-text)]">{plan.monthlyPrice} EUR<span className="text-base font-bold text-[var(--ui-text-soft)]">/{t("month")}</span></p>
                </div>
                <AppBadge tone={index === 1 ? "brand" : "neutral"}>{plan.trialDays} {t("day trial")}</AppBadge>
              </div>
              <ul className="mt-6 space-y-2 text-sm leading-6 text-[var(--ui-text-soft)]">
                <li><strong className="text-[var(--ui-text)]">{plan.limits.leads.toLocaleString()}</strong> {t("leads per month")}</li>
                <li><strong className="text-[var(--ui-text)]">{plan.limits.aiGenerations.toLocaleString()}</strong> {t("AI generations per month")}</li>
                <li><strong className="text-[var(--ui-text)]">{plan.limits.emailSends.toLocaleString()}</strong> {t("reviewed email sends per month")}</li>
                <li><strong className="text-[var(--ui-text)]">{plan.limits.salesEmployees}</strong> {t("AI Sales Employees")}</li>
                <li>{plan.limits.workspaces} {t("owner workspace")}</li>
                <li>{t("Team invitations planned")}</li>
                <li>{plan.features.semiAutoMode ? t("Semi-auto mode included") : t("Review mode only")}</li>
                <li>{plan.features.autonomousMode ? t("Autonomous mode included") : t("Autonomous mode not included")}</li>
                <li>{plan.features.advancedAnalytics ? t("Advanced analytics included") : t("Basic analytics included")}</li>
              </ul>
              <AuthNavigationLink href={`/sign-up?plan=${encodeURIComponent(plan.name)}`} className="focus-ring mt-6 inline-flex min-h-11 w-full items-center justify-center rounded-full bg-[var(--ui-text)] px-4 text-sm font-black text-white">
                {t("Choose")} {t(plan.name)}
              </AuthNavigationLink>
            </SurfaceCard>
          ))}
        </div>
      </section>

      <section id="faq" className="mx-auto max-w-5xl px-4 py-16 min-[360px]:px-5">
        <p className="ui-eyebrow">{t("FAQ")}</p>
        <h2 className="ui-title mt-3 text-4xl">{t("Built for trust, not theater.")}</h2>
        <div className="mt-8 grid gap-3">
          {faq.map(([question, answer]) => (
            <SurfaceCard key={question} as="article" className="rounded-[1.125rem] p-5">
              <h3 className="text-sm font-black text-[var(--ui-text)]">{t(question)}</h3>
              <p className="mt-2 text-sm leading-6 text-[var(--ui-text-soft)]">{t(answer)}</p>
            </SurfaceCard>
          ))}
        </div>
      </section>

      <section id="contact" className="mx-auto max-w-7xl px-4 py-16 min-[360px]:px-5">
        <SurfaceCard className="grid gap-5 rounded-[1.5rem] p-6 md:grid-cols-[0.7fr_0.3fr] md:items-center">
          <div>
            <p className="ui-eyebrow">{t("Support")}</p>
            <h2 className="ui-title mt-3 text-3xl">{t("Questions before signing up?")}</h2>
            <p className="ui-copy mt-3">{t("Use the confirmed project contact for support, privacy or security questions.")}</p>
          </div>
          <a href={`mailto:${publicSupportEmail}`} className="focus-ring inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-[var(--ui-text)] px-5 text-sm font-black text-white">
            <Mail size={18} aria-hidden="true" />
            {publicSupportEmail}
          </a>
        </SurfaceCard>
      </section>

      <section className="px-4 py-10 min-[360px]:px-5">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 overflow-hidden rounded-[1.75rem] bg-[var(--ui-text)] p-6 text-white shadow-raised sm:p-8 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <MailCheck className="text-[var(--ui-accent)]" size={24} />
            <h2 className="mt-4 text-3xl font-black leading-tight">{t("Start with one sentence. Let AI find the next customer.")}</h2>
          </div>
          <AuthNavigationLink href="/sign-up?plan=Starter" className="focus-ring inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-white px-5 text-sm font-black text-[var(--ui-text)] sm:w-auto">
            {t("Start finding customers")} <ArrowRight size={18} />
          </AuthNavigationLink>
        </div>
      </section>

      <footer className="border-t border-[var(--ui-border)] bg-white/60 px-4 py-8 text-sm text-[var(--ui-text-soft)] min-[360px]:px-5">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-2">
            <p className="font-black text-[var(--ui-text)]">OutreachAI</p>
            <p>{t("Lead intelligence, explainable AI, CRM handoff and reviewed outreach.")}</p>
          </div>
          <nav aria-label="Legal" className="flex flex-wrap items-center gap-x-4 gap-y-2 font-bold text-[var(--ui-text)]">
            {legalLinks.map((link) => (
              <Link key={link.href} href={link.href} className="focus-ring rounded-sm underline decoration-[var(--ui-border-strong)] underline-offset-4 transition hover:text-[var(--ui-brand)]">
                {t(link.label)}
              </Link>
            ))}
          </nav>
          <Wand2 size={18} className="hidden shrink-0 text-[var(--ui-brand)] lg:block" />
        </div>
      </footer>
    </main>
  );
}
