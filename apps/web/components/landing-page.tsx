"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import {
  ArrowRight,
  BarChart3,
  Building2,
  CheckCircle2,
  FileSearch,
  Inbox,
  MailCheck,
  MessageSquareText,
  Search,
  ShieldCheck,
  Sparkles,
  Target,
  UsersRound,
  Workflow,
} from "lucide-react";
import { AppBadge, SurfaceCard } from "@/components/design-system";
import { LanguageSwitcher } from "@/components/language-switcher";
import { useI18n } from "@/lib/i18n/provider";

const plans = [
  {
    name: "Starter",
    price: 49,
    audience: "For founders and small outbound teams",
    limits: ["500 leads/month", "1,000 AI generations/month", "1,000 email sends/month", "3 campaigns", "1 workspace", "Review mode"],
  },
  {
    name: "Pro",
    price: 149,
    audience: "For teams running repeatable outbound",
    featured: true,
    limits: ["5,000 leads/month", "10,000 AI generations/month", "10,000 email sends/month", "25 campaigns", "3 workspaces", "Reply AI"],
  },
  {
    name: "Agency",
    price: 499,
    audience: "For agencies and multi-client sales teams",
    limits: ["50,000 leads/month", "100,000 AI generations/month", "100,000 email sends/month", "Autonomous mode", "API access", "White label"],
  },
] as const;

const workflow = [
  ["Define ICP", "Describe the market, customer and offer before search starts.", Target],
  ["Find companies", "Search real company sources and save qualified accounts.", Search],
  ["AI research", "Analyze websites, contacts, risks, signals and message angles.", FileSearch],
  ["Prioritize", "Rank opportunities by readiness, fit and next best action.", BarChart3],
  ["Generate outreach", "Create review-ready emails and follow-ups from research.", MailCheck],
  ["Launch campaign", "Approve messages before any outbound action moves forward.", Workflow],
  ["Track replies", "Route responses into Inbox and CRM next steps.", Inbox],
] as const;

const showcase = [
  ["Dashboard", "A decision center with next best action, blockers and active pipeline state.", BarChart3],
  ["Company Research", "A focused workspace for signals, people, risks, technologies and findings.", Building2],
  ["AI Analysis", "Transparent scoring with rationale, confidence, history and regeneration controls.", Sparkles],
  ["Lead Prioritization", "Hot, warm and cold opportunities with status, reason and next action.", Target],
  ["Campaigns", "Review-first creation, status, progress and safe launch controls.", Workflow],
  ["Inbox", "Reply tracking with company context and next recommended action.", MessageSquareText],
] as const;

const useCases = [
  ["SaaS", "Find accounts with a sharper problem and tailor outreach by company context."],
  ["Agencies", "Turn one ICP into repeatable research, outreach and review workflows."],
  ["Recruiting", "Research target companies and decision makers before starting contact."],
  ["B2B services", "Move from manual prospect lists to verified, prioritized opportunities."],
  ["Sales teams", "Keep research, messaging, campaigns and replies in one operating system."],
] as const;

const benefits = [
  ["Less manual research", "Research moves into one guided workflow instead of scattered tabs."],
  ["Better personalization", "Messages use company-specific findings, risks and signals."],
  ["One workflow", "Search, CRM, AI analysis, drafts, campaigns and replies stay connected."],
  ["Clear next actions", "Every core screen explains the highest leverage action to take now."],
  ["Faster campaigns", "Teams can move from market idea to reviewed campaign without rebuilding context."],
] as const;

const faqs = [
  ["Where does the data come from?", "OutreachAI uses the configured backend data providers and saved CRM data. The UI does not invent company records."],
  ["Does AI send emails automatically?", "No. The product is review-first: generated messages stay in review until a user approves supported sending actions."],
  ["Can I regenerate analysis?", "Yes. Company Workspace exposes generate and regenerate controls when the existing AI analysis endpoints support the action."],
  ["What happens when a provider is unavailable?", "The app shows unavailable, error or retry states and keeps saved CRM data visible where possible."],
  ["Are prices real?", "The plans shown here use the Starter, Pro and Agency limits defined by the backend billing model."],
  ["Is this a CRM replacement?", "OutreachAI is an AI outbound workspace with CRM-style pipeline context for prospecting, research, outreach and replies."],
] as const;

const previewRows = [
  ["Next best action", "Review Linesight opportunity", "Why now: AI score 83, email draft ready"],
  ["AI analysis", "Berlin construction office", "Signals, risks, decision maker and angle"],
  ["Campaign state", "3 need review", "Nothing sends until approved"],
  ["Inbox", "0 replies waiting", "Reply tracking appears when real responses arrive"],
] as const;

function AuthNavigationLink({
  href,
  className,
  testId,
  children
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

function SectionHeading({ eyebrow, title, copy, inverted = false }: { eyebrow: string; title: string; copy: string; inverted?: boolean }) {
  const { t } = useI18n();
  return (
    <div className="max-w-3xl">
      <p className="ui-eyebrow">{t(eyebrow)}</p>
      <h2 className={`mt-3 text-3xl font-black leading-tight sm:text-4xl ${inverted ? "text-white" : "text-ink"}`}>{t(title)}</h2>
      <p className={`mt-4 text-base leading-7 ${inverted ? "text-slate-300" : "text-slate-600"}`}>{t(copy)}</p>
    </div>
  );
}

function ProductPreview() {
  const { t } = useI18n();
  return (
    <SurfaceCard className="overflow-hidden rounded-[1.5rem] border-slate-200 bg-white p-0 shadow-2xl">
      <div className="border-b border-slate-200 bg-slate-950 px-4 py-3 text-white">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-teal-200">{t("Demo product preview")}</p>
            <p className="mt-1 text-sm font-bold">{t("AI outbound control room")}</p>
          </div>
          <AppBadge tone="dark">{t("Review-first")}</AppBadge>
        </div>
      </div>
      <div className="grid gap-0 lg:grid-cols-[13rem_1fr]">
        <aside className="hidden border-r border-slate-200 bg-slate-50 p-4 lg:block">
          {["Dashboard", "Companies", "Campaigns", "Inbox"].map((item, index) => (
            <div key={item} className={`mb-2 rounded-xl px-3 py-2 text-sm font-bold ${index === 0 ? "bg-white text-ink shadow-sm" : "text-slate-500"}`}>
              {t(item)}
            </div>
          ))}
        </aside>
        <div className="p-4 sm:p-5">
          <div className="rounded-2xl border border-teal-100 bg-teal-50 p-4">
            <p className="text-xs font-black uppercase tracking-[0.14em] text-brand">{t("Next Best Action")}</p>
            <h3 className="mt-2 text-2xl font-black text-ink">{t("Review the strongest opportunity")}</h3>
            <p className="mt-2 text-sm leading-6 text-slate-700">{t("The workspace explains who to contact, why now, and what safe action unlocks momentum.")}</p>
            <div className="mt-4 flex flex-col gap-2 min-[430px]:flex-row">
              <span className="inline-flex min-h-10 items-center justify-center rounded-xl bg-brand px-4 text-sm font-black text-white">{t("Open Company Workspace")}</span>
              <span className="inline-flex min-h-10 items-center justify-center rounded-xl border border-teal-200 bg-white px-4 text-sm font-black text-brand">{t("View AI rationale")}</span>
            </div>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {previewRows.map(([label, value, detail]) => (
              <article key={label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">{t(label)}</p>
                <p className="mt-2 text-base font-black text-ink">{t(value)}</p>
                <p className="mt-1 text-sm leading-6 text-slate-600">{t(detail)}</p>
              </article>
            ))}
          </div>
        </div>
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
    description: "AI outbound workspace for finding B2B companies, researching opportunities, generating review-ready outreach, managing campaigns and tracking replies.",
    offers: plans.map((plan) => ({ "@type": "Offer", name: `OutreachAI ${plan.name}`, price: plan.price, priceCurrency: "EUR" }))
  };

  return (
    <main className="landing-safe min-w-0 max-w-[100vw] overflow-x-clip bg-white text-ink">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }} />
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
        <nav className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-4 min-[360px]:px-5">
          <Link href="/" className="flex min-h-11 items-center gap-2 text-lg font-black tracking-tight text-ink">
            <span className="grid size-9 place-items-center rounded-xl bg-ink text-sm text-white">OA</span>
            OutreachAI
          </Link>
          <div className="hidden items-center gap-7 text-sm font-bold text-slate-600 lg:flex">
            <a href="#product" className="hover:text-ink">{t("Product")}</a>
            <a href="#how" className="hover:text-ink">{t("How it works")}</a>
            <a href="#use-cases" className="hover:text-ink">{t("Use cases")}</a>
            <a href="#pricing" className="hover:text-ink">{t("Pricing")}</a>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <LanguageSwitcher compact />
            <AuthNavigationLink href="/sign-in" className="hidden min-h-11 items-center rounded-xl px-3 text-sm font-bold text-slate-700 hover:bg-slate-100 sm:inline-flex">{t("Sign in")}</AuthNavigationLink>
            <AuthNavigationLink href="/sign-up?plan=Starter" className="inline-flex min-h-11 items-center rounded-xl bg-brand px-4 text-sm font-black text-white shadow-soft hover:bg-teal-700" testId="header-start-finding-leads">{t("Start finding leads")}</AuthNavigationLink>
          </div>
        </nav>
      </header>

      <section className="border-b border-slate-200 bg-slate-50">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 min-[360px]:px-5 sm:py-20 lg:grid-cols-[0.86fr_1.14fr] lg:items-center">
          <div>
            <AppBadge tone="brand">{t("AI outbound workspace for B2B teams")}</AppBadge>
            <h1 className="mt-5 max-w-4xl text-4xl font-black leading-[1.02] text-ink sm:text-5xl lg:text-6xl">
              {t("Find the right B2B accounts, research them, and ship reviewed outreach from one workspace.")}
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-600">
              {t("OutreachAI turns company search, AI research, prioritization, personalized email drafts, campaigns and reply tracking into one guided workflow for teams that need qualified meetings.")}
            </p>
            <div className="mt-8 flex flex-col gap-3 min-[430px]:flex-row">
              <AuthNavigationLink href="/sign-up?plan=Starter" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-brand px-5 text-sm font-black text-white shadow-soft hover:bg-teal-700" testId="hero-start-finding-leads">
                {t("Start finding leads")} <ArrowRight size={18} />
              </AuthNavigationLink>
              <a href="#product" className="inline-flex min-h-12 items-center justify-center rounded-xl border border-slate-300 bg-white px-5 text-sm font-black text-ink hover:border-slate-400">
                {t("See product workflow")}
              </a>
            </div>
            <div className="mt-8 grid gap-3 text-sm font-semibold text-slate-600 sm:grid-cols-3">
              {["No automatic sends", "Real backend workflows", "Built around next actions"].map((item) => (
                <span key={item} className="inline-flex items-center gap-2"><CheckCircle2 size={17} className="text-brand" />{t(item)}</span>
              ))}
            </div>
          </div>
          <ProductPreview />
        </div>
      </section>

      <section className="border-b border-slate-200 bg-white">
        <div className="mx-auto grid max-w-7xl gap-4 px-4 py-8 min-[360px]:px-5 md:grid-cols-3">
          {[
            ["Social proof status", "No fabricated customer logos, testimonials or unverifiable metrics are shown."],
            ["Data policy", "The public preview is demo-labeled. Production workspace data comes from configured backend APIs."],
            ["Safety model", "Outreach remains review-first before sending or campaign launch actions."],
          ].map(([title, copy]) => (
            <article key={title} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-sm font-black text-ink">{t(title)}</p>
              <p className="mt-2 text-sm leading-6 text-slate-600">{t(copy)}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="how" className="mx-auto max-w-7xl px-4 py-14 min-[360px]:px-5 sm:py-20">
        <SectionHeading eyebrow="How it works" title="From ICP to reply tracking without rebuilding context." copy="Every step maps to an existing OutreachAI workflow: search, CRM, AI research, outreach review, campaigns and inbox." />
        <div className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {workflow.map(([title, copy, Icon], index) => (
            <SurfaceCard key={title} as="article" className="p-5">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-black text-brand">{String(index + 1).padStart(2, "0")}</span>
                <Icon size={20} className="text-brand" />
              </div>
              <h3 className="mt-5 text-lg font-black text-ink">{t(title)}</h3>
              <p className="mt-2 text-sm leading-6 text-slate-600">{t(copy)}</p>
            </SurfaceCard>
          ))}
        </div>
      </section>

      <section id="product" className="bg-slate-50 py-14 sm:py-20">
        <div className="mx-auto max-w-7xl px-4 min-[360px]:px-5">
          <SectionHeading eyebrow="Product showcase" title="A focused AI workspace, not another disconnected tool stack." copy="The core screens are designed around operational decisions rather than vanity dashboards." />
          <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {showcase.map(([title, copy, Icon]) => (
              <SurfaceCard key={title} as="article" className="p-5">
                <div className="grid size-11 place-items-center rounded-xl bg-teal-50 text-brand"><Icon size={22} /></div>
                <h3 className="mt-5 text-lg font-black text-ink">{t(title)}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">{t(copy)}</p>
              </SurfaceCard>
            ))}
          </div>
        </div>
      </section>

      <section id="use-cases" className="mx-auto max-w-7xl px-4 py-14 min-[360px]:px-5 sm:py-20">
        <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr]">
          <SectionHeading eyebrow="Use cases" title="For teams that need researched outreach, not bigger spreadsheets." copy="OutreachAI fits workflows where company context and safe review matter before campaign volume." />
          <div className="grid gap-3">
            {useCases.map(([title, copy]) => (
              <article key={title} className="flex gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <UsersRound size={22} className="mt-1 shrink-0 text-brand" />
                <div>
                  <h3 className="font-black text-ink">{t(title)}</h3>
                  <p className="mt-1 text-sm leading-6 text-slate-600">{t(copy)}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-slate-950 py-14 text-white sm:py-20">
        <div className="mx-auto max-w-7xl px-4 min-[360px]:px-5">
          <SectionHeading inverted eyebrow="Benefits" title="Replace manual outbound assembly with one decision workflow." copy="Less switching, clearer status, better personalization and safer campaign execution." />
          <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-5">
            {benefits.map(([title, copy]) => (
              <article key={title} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <ShieldCheck size={20} className="text-teal-200" />
                <h3 className="mt-4 font-black text-white">{t(title)}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-300">{t(copy)}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="pricing" className="mx-auto max-w-7xl px-4 py-14 min-[360px]:px-5 sm:py-20">
        <SectionHeading eyebrow="Pricing" title="Real plan limits from the OutreachAI billing model." copy="Prices and limits are taken from the current backend plan definitions. Upgrade actions continue through existing billing flows." />
        <div className="mt-10 grid gap-5 lg:grid-cols-3">
          {plans.map((plan) => (
            <SurfaceCard key={plan.name} as="article" className={`p-6 ${plan.featured ? "border-brand bg-teal-50" : ""}`}>
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-2xl font-black text-ink">{plan.name}</h3>
                {plan.featured ? <AppBadge tone="brand">{t("Most useful")}</AppBadge> : null}
              </div>
              <p className="mt-2 text-sm leading-6 text-slate-600">{t(plan.audience)}</p>
              <p className="mt-6 text-4xl font-black text-ink">€{plan.price}<span className="text-base font-bold text-slate-500">/{t("month")}</span></p>
              <ul className="mt-6 grid gap-3 text-sm text-slate-700">
                {plan.limits.map((item) => <li key={item} className="flex gap-2"><CheckCircle2 size={18} className="mt-0.5 shrink-0 text-brand" />{t(item)}</li>)}
              </ul>
              <AuthNavigationLink href={`/sign-up?plan=${encodeURIComponent(plan.name)}`} className="mt-7 inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-ink px-5 text-sm font-black text-white hover:bg-slate-800">
                {t("Start finding leads")}
              </AuthNavigationLink>
            </SurfaceCard>
          ))}
        </div>
      </section>

      <section className="bg-slate-50 py-14 sm:py-20">
        <div className="mx-auto max-w-7xl px-4 min-[360px]:px-5">
          <SectionHeading eyebrow="FAQ" title="Practical answers before you start outbound." copy="The product is built for real data, AI transparency, review-first safety and subscription billing." />
          <div className="mt-10 grid gap-4 lg:grid-cols-2">
            {faqs.map(([question, answer]) => (
              <SurfaceCard key={question} as="article" className="p-5">
                <h3 className="font-black text-ink">{t(question)}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">{t(answer)}</p>
              </SurfaceCard>
            ))}
          </div>
        </div>
      </section>

      <section className="border-y border-slate-200 bg-white px-4 py-14 min-[360px]:px-5 sm:py-20">
        <div className="mx-auto grid max-w-7xl gap-6 rounded-[1.5rem] bg-ink p-6 text-white sm:p-8 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <AppBadge tone="dark">{t("Ready when your team is")}</AppBadge>
            <h2 className="mt-4 text-3xl font-black leading-tight sm:text-4xl">{t("Start with one market. Leave with a prioritized outreach workflow.")}</h2>
            <p className="mt-3 max-w-2xl text-slate-300">{t("Search real companies, review AI research, generate outreach and keep every campaign action under control.")}</p>
          </div>
          <AuthNavigationLink href="/sign-up?plan=Starter" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-white px-5 text-sm font-black text-ink hover:bg-slate-100">
            {t("Start finding leads")} <ArrowRight size={18} />
          </AuthNavigationLink>
        </div>
      </section>

      <footer className="bg-white px-4 py-8 text-sm text-slate-600 min-[360px]:px-5">
        <div className="mx-auto grid max-w-7xl gap-6 md:grid-cols-[1fr_auto] md:items-center">
          <div>
            <p className="text-base font-black text-ink">OutreachAI</p>
            <p className="mt-2 max-w-xl">{t("AI outbound workspace for lead search, company research, review-ready outreach, campaigns and replies.")}</p>
          </div>
          <div className="flex flex-wrap gap-4 font-bold">
            <Link href="/pricing">{t("Pricing")}</Link>
            <Link href="/security">{t("Security")}</Link>
            <Link href="/privacy">{t("Privacy")}</Link>
            <Link href="/terms">{t("Terms")}</Link>
          </div>
        </div>
      </footer>
    </main>
  );
}
