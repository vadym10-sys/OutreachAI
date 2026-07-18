"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import {
  ArrowRight,
  BarChart3,
  Building2,
  CheckCircle2,
  ChevronRight,
  Globe2,
  Inbox,
  Mail,
  Radar,
  Search,
  ShieldCheck,
  Sparkles,
  UserRoundSearch,
  Workflow,
  Zap
} from "lucide-react";
import { LanguageSwitcher } from "@/components/language-switcher";
import { useI18n } from "@/lib/i18n/provider";

const tools = [
  ["Customer Search", "Find B2B companies from a product site, target country, industry and criteria.", Search],
  ["Public Evidence", "Show the source URL, date when available and the reason each company matches.", Globe2],
  ["Contact Route", "Save only public business contact routes. Missing emails stay clearly unavailable.", UserRoundSearch],
  ["Manual CRM Save", "Selected companies are saved to your private CRM only after approval.", Building2],
  ["Draft Email", "Create a short personalized first email from saved company context.", Mail],
  ["Manual Send", "Approve and confirm before one email is sent. No automatic campaigns.", ShieldCheck]
] as const;

const workflow = [
  "Enter your product site",
  "Describe target customers",
  "Search public sources",
  "Review evidence",
  "Save selected leads to CRM",
  "Review and send one email manually"
] as const;

const aiDemo = [
  ["Search", "Product site + market", "The user defines the target customer.", 25],
  ["Verify", "Public source checked", "Unverified fields stay unknown.", 52],
  ["CRM", "Manual save only", "No CRM record is created without approval.", 76],
  ["Mail", "Draft ready", "Sending requires approve and confirm.", 90]
] as const;

const productMoments = [
  ["Search Workspace", "Start from one product website and one target market instead of a blank CRM table.", Sparkles],
  ["Simple CRM", "Saved companies show stage, contacts, notes, source, history and next manual action.", Building2],
  ["Mail Review", "Drafts, approvals, sends and replies stay connected to the saved lead.", Inbox]
] as const;

const plans = [
  {
    name: "Starter",
    price: "Billing",
    audience: "For the first customer workflow",
    cta: "Start free trial",
    items: ["Customer search", "Manual CRM save", "Draft email", "Review mode"]
  },
  {
    name: "Pro",
    price: "Billing",
    audience: "For teams with higher usage",
    cta: "Start Pro trial",
    featured: true,
    items: ["Higher usage limits", "CRM stages and notes", "Manual sending", "Reply status"]
  },
  {
    name: "Agency",
    price: "Billing",
    audience: "For multi-workspace outbound teams",
    cta: "Start Agency trial",
    items: ["Workspace controls", "Team setup", "Billing management", "Manual review workflow"]
  }
] as const;

const faq = [
  ["Does OutreachAI send emails automatically?", "No. The interface is built around review and approval before sending."],
  ["Where does the personalization come from?", "From saved company context, public source evidence, contact route and the product description in your workspace."],
  ["Can I use it without a complete CRM setup?", "Yes. Start from one search, review the evidence, and save only the companies you want to work."],
  ["Are the customer logos on this page real?", "No public customer logos are shown until they are approved. Demo placeholders are clearly labeled."]
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

function ProgressLine({ value }: { value: number }) {
  return (
    <span className="mt-3 block h-2 overflow-hidden rounded-full bg-slate-100">
      <span className="block h-full rounded-full bg-brand" style={{ width: `${value}%` }} />
    </span>
  );
}

export function LandingPage() {
  const { t } = useI18n();
  const schema = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "OutreachAI",
    applicationCategory: "SalesApplication",
    description: "AI customer finder for B2B teams: find public-source leads, save selected companies to CRM, draft email, and send only after review.",
    offers: plans.map((plan) => ({ "@type": "Offer", name: `OutreachAI ${plan.name}` }))
  };

  return (
    <main className="landing-safe min-w-0 max-w-[100vw] overflow-x-clip bg-slate-50 text-ink">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }} />

      <section className="relative overflow-hidden bg-white text-ink">
        <div className="absolute inset-x-0 bottom-0 h-px bg-slate-200" />
        <nav className="relative z-10 mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-5 min-[360px]:px-5">
          <Link href="/" className="flex min-h-11 shrink-0 items-center gap-3 text-xl font-black tracking-tight">
            <span className="grid size-10 place-items-center rounded-xl bg-brand text-sm text-white shadow-sm">OA</span>
            <span>OutreachAI</span>
          </Link>
          <div className="hidden items-center gap-7 text-sm font-bold text-slate-600 md:flex">
            <a href="#product" className="hover:text-ink">{t("Product")}</a>
            <a href="#workflow" className="hover:text-ink">{t("Workflow")}</a>
            <a href="#pricing" className="hover:text-ink">{t("Pricing")}</a>
          </div>
          <div className="flex min-w-0 shrink-0 items-center gap-2">
            <LanguageSwitcher compact />
            <AuthNavigationLink href="/sign-in" className="hidden min-h-11 items-center rounded-xl px-4 text-sm font-bold text-slate-600 hover:bg-slate-100 hover:text-ink sm:inline-flex">{t("Login")}</AuthNavigationLink>
            <AuthNavigationLink href="/sign-up?plan=Starter" className="hidden min-h-11 items-center rounded-xl bg-brand px-4 text-sm font-black text-white shadow-sm hover:bg-blue-700 sm:inline-flex">{t("Start free trial")}</AuthNavigationLink>
          </div>
        </nav>

        <div className="relative z-10 mx-auto grid max-w-7xl items-center gap-10 px-4 pb-20 pt-10 min-[360px]:px-5 sm:pb-24 sm:pt-16 lg:grid-cols-[0.92fr_1.08fr]">
          <div className="min-w-0">
            <p className="inline-flex min-h-9 items-center gap-2 rounded-full border border-blue-100 bg-blue-50 px-3 text-sm font-black text-brand">
              <Sparkles size={16} /> {t("Find customers, save CRM, write email")}
            </p>
            <h1 className="mt-6 max-w-full text-4xl font-black leading-tight text-ink min-[390px]:text-5xl lg:text-6xl">
              {t("Find your first B2B customers and write the first email.")}
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-7 text-slate-600 min-[390px]:text-lg sm:text-xl sm:leading-8">
              {t("OutreachAI turns a product website and target market into verified company leads, CRM records and short draft emails. You decide what gets saved and what gets sent.")}
            </p>
            <div className="mt-8 flex flex-col gap-3 min-[430px]:flex-row">
              <AuthNavigationLink href="/sign-up?plan=Starter" className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand px-5 text-sm font-black text-white shadow-sm hover:bg-blue-700 min-[430px]:w-auto" testId="hero-start-free-trial">
                {t("Start free trial")} <ArrowRight size={18} aria-hidden="true" />
              </AuthNavigationLink>
              <AuthNavigationLink href="/sign-in" className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-5 text-sm font-black text-ink shadow-sm hover:bg-slate-50 min-[430px]:w-auto">
                {t("Login")} <ChevronRight size={18} aria-hidden="true" />
              </AuthNavigationLink>
            </div>
            <div className="mt-8 grid gap-3 text-sm font-bold text-slate-600 sm:grid-cols-3">
              {["Public source required", "Manual CRM save", "Review before send"].map((item) => (
                <span key={item} className="inline-flex items-center gap-2"><CheckCircle2 size={17} className="text-brand" />{t(item)}</span>
              ))}
            </div>
          </div>

          <div className="relative min-w-0">
            <div className="relative overflow-hidden rounded-3xl border border-slate-200 bg-white p-3 shadow-soft">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 min-[390px]:p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.16em] text-brand">{t("Live workflow preview")}</p>
                    <h2 className="mt-2 text-2xl font-black text-ink">{t("German Builders Outreach")}</h2>
                  </div>
                  <span className="rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-xs font-black text-brand">{t("Review mode")}</span>
                </div>

                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  {aiDemo.map(([title, value, detail, progress]) => (
                    <article key={title} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">{t(title)}</p>
                          <p className="mt-2 text-base font-black text-ink">{t(value)}</p>
                          <p className="mt-1 text-sm leading-5 text-slate-600">{t(detail)}</p>
                        </div>
                        <Radar size={19} className="shrink-0 text-brand" />
                      </div>
                      <ProgressLine value={progress} />
                    </article>
                  ))}
                </div>

                <div className="mt-4 rounded-2xl border border-blue-100 bg-blue-50 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.12em] text-brand">{t("AI recommendation")}</p>
                    <p className="mt-2 text-sm font-bold leading-6 text-blue-950">{t("Save the companies that have real source evidence, then review the prepared email before sending.")}</p>
                    </div>
                    <Zap className="shrink-0 text-brand" size={22} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="border-y border-slate-200 bg-slate-50 py-8">
        <div className="mx-auto grid max-w-7xl gap-3 px-4 min-[360px]:px-5 md:grid-cols-[0.75fr_1.25fr] md:items-center">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.14em] text-brand">{t("Social proof")}</p>
            <p className="mt-1 text-sm font-semibold text-[var(--ui-text-soft)]">{t("Customer logos are shown only after approval. These are demo categories, not client claims.")}</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-4">
            {["Demo SaaS", "Demo Agency", "Demo Recruiting", "Demo B2B Services"].map((label) => (
              <div key={label} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-center text-xs font-black uppercase tracking-[0.12em] text-[var(--ui-text-soft)] shadow-sm">
                {t(label)}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="product" className="mx-auto max-w-7xl px-4 py-16 min-[360px]:px-5 sm:py-24">
        <div className="max-w-3xl">
          <p className="text-sm font-black uppercase tracking-[0.14em] text-brand">{t("What OutreachAI does")}</p>
          <h2 className="mt-3 text-4xl font-black leading-tight text-ink min-[390px]:text-5xl">{t("One focused workflow for first customer outreach.")}</h2>
          <p className="mt-4 text-base leading-7 text-[var(--ui-text-soft)]">{t("It replaces the messy handoff between manual research, spreadsheets, CRM entry and first email drafting.")}</p>
        </div>
        <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {tools.map(([title, copy, Icon]) => (
            <article key={title} className="ui-card ui-orbit-card rounded-[2rem] p-5">
              <div className="grid size-11 place-items-center rounded-2xl bg-blue-50 text-brand"><Icon size={22} /></div>
              <h3 className="mt-5 text-lg font-black text-ink">{t(title)}</h3>
              <p className="mt-2 text-sm leading-6 text-[var(--ui-text-soft)]">{t(copy)}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="workflow" className="mx-auto max-w-7xl px-4 pb-16 min-[360px]:px-5 sm:pb-24">
        <div className="grid gap-5 lg:grid-cols-[0.8fr_1.2fr]">
          <div className="ui-card rounded-[2rem] p-6">
            <p className="text-sm font-black uppercase tracking-[0.14em] text-brand">{t("Workflow")}</p>
            <h2 className="mt-3 text-4xl font-black leading-none text-ink">{t("From product site to reviewed first email.")}</h2>
            <p className="mt-4 text-sm leading-7 text-[var(--ui-text-soft)]">{t("The product always guides the user to the next real action: search, review evidence, save to CRM, review the email and send manually.")}</p>
          </div>
          <ol className="grid gap-3 sm:grid-cols-2">
            {workflow.map((step, index) => (
              <li key={step} className="ui-card rounded-[1.5rem] p-4">
                <span className="grid size-9 place-items-center rounded-full bg-brand text-sm font-black text-white">{index + 1}</span>
                <p className="mt-4 font-black text-ink">{t(step)}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="border-y border-slate-200 bg-white px-4 py-16 text-ink min-[360px]:px-5 sm:py-24">
        <div className="mx-auto max-w-7xl">
          <div className="max-w-3xl">
            <p className="text-sm font-black uppercase tracking-[0.14em] text-brand">{t("Product moments")}</p>
            <h2 className="mt-3 text-4xl font-black leading-tight text-ink min-[390px]:text-5xl">{t("Every screen is tied to the same customer workflow.")}</h2>
          </div>
          <div className="mt-10 grid gap-4 lg:grid-cols-3">
            {productMoments.map(([title, copy, Icon]) => (
              <article key={title} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <Icon className="text-brand" size={24} />
                <h3 className="mt-8 text-2xl font-black text-ink">{t(title)}</h3>
                <p className="mt-3 text-sm leading-7 text-slate-600">{t(copy)}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="pricing" className="mx-auto max-w-7xl px-4 py-16 min-[360px]:px-5 sm:py-24">
        <div className="max-w-3xl">
          <p className="text-sm font-black uppercase tracking-[0.14em] text-brand">{t("Pricing")}</p>
          <h2 className="mt-3 text-4xl font-black leading-tight text-ink min-[390px]:text-5xl">{t("Plans are managed by the real billing setup.")}</h2>
          <p className="mt-4 text-sm font-semibold leading-6 text-[var(--ui-text-soft)]">{t("The app shows the current plan and usage from Billing after sign in. This page does not invent quotas or customer claims.")}</p>
        </div>
        <div className="mt-10 grid gap-5 lg:grid-cols-3">
          {plans.map((plan) => {
            const featured = "featured" in plan && plan.featured;
            return (
              <article key={plan.name} className={`rounded-[2rem] border bg-white p-6 shadow-sm ${featured ? "border-blue-200 ring-4 ring-blue-50" : "border-slate-200"}`}>
                {featured && <p className="mb-4 w-fit rounded-full bg-blue-50 px-3 py-1 text-xs font-black text-brand">{t("Most popular")}</p>}
                <h3 className="text-2xl font-black text-ink">{t(plan.name)}</h3>
                <p className="mt-2 text-sm text-[var(--ui-text-soft)]">{t(plan.audience)}</p>
                <p className="mt-5 text-3xl font-black text-ink">{t(plan.price)}</p>
                <p className="mt-2 text-sm font-black text-brand">{t("Exact limits appear inside Billing.")}</p>
                <ul className="mt-6 space-y-3 text-sm text-[var(--ui-text-soft)]">
                  {plan.items.map((item) => <li key={item} className="flex gap-2"><CheckCircle2 size={18} className="mt-0.5 shrink-0 text-brand" />{t(item)}</li>)}
                </ul>
                <div className="mt-7">
                  <AuthNavigationLink href={`/sign-up?plan=${encodeURIComponent(plan.name)}`} className="focus-ring inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand px-5 py-3 text-center text-sm font-black text-white shadow-sm transition hover:bg-blue-700">
                    {t(plan.cta)}
                  </AuthNavigationLink>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 pb-16 min-[360px]:px-5 sm:pb-24">
        <div className="grid gap-4 lg:grid-cols-[0.72fr_1.28fr]">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.14em] text-brand">FAQ</p>
            <h2 className="mt-3 text-4xl font-black leading-none text-ink">{t("Built for trust, not theater.")}</h2>
          </div>
          <div className="grid gap-3">
            {faq.map(([question, answer]) => (
              <article key={question} className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="font-black text-ink">{t(question)}</h3>
                <p className="mt-2 text-sm leading-6 text-[var(--ui-text-soft)]">{t(answer)}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="px-4 pb-8 min-[360px]:px-5">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 overflow-hidden rounded-[2rem] border border-blue-100 bg-blue-50 p-6 text-blue-950 shadow-sm sm:p-8 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.14em] text-brand">{t("Final CTA")}</p>
            <h2 className="mt-3 text-3xl font-black leading-tight text-ink min-[390px]:text-4xl">{t("Find customers faster than manual outbound.")}</h2>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-600">{t("Start with a target market. OutreachAI prepares verified leads, CRM records and draft emails for manual review.")}</p>
          </div>
          <AuthNavigationLink href="/sign-up?plan=Starter" className="inline-flex min-h-12 w-fit items-center justify-center gap-2 rounded-xl bg-brand px-5 text-sm font-black text-white hover:bg-blue-700">
            {t("Start free trial")} <ArrowRight size={18} />
          </AuthNavigationLink>
        </div>
      </section>

      <footer className="border-t border-slate-200 bg-white px-4 py-8 text-sm text-[var(--ui-text-soft)] min-[360px]:px-5">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="font-black text-ink">OutreachAI</p>
          <div className="flex flex-wrap gap-4">
            <Link href="/privacy" className="font-bold hover:text-ink">{t("Privacy")}</Link>
            <Link href="/terms" className="font-bold hover:text-ink">{t("Terms")}</Link>
            <Link href="/security" className="font-bold hover:text-ink">{t("Security")}</Link>
          </div>
          <p>{t("Find customers, save CRM leads, review draft emails and send manually.")}</p>
          <ShieldCheck size={18} className="hidden text-brand sm:block" />
        </div>
      </footer>
    </main>
  );
}
