"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import {
  ArrowRight,
  BarChart3,
  Building2,
  CheckCircle2,
  ClipboardCheck,
  Globe2,
  Inbox,
  Mail,
  Search,
  UserRoundSearch,
  Workflow
} from "lucide-react";
import { PricingCheckoutButton } from "@/components/billing-client";
import { LanguageSwitcher } from "@/components/language-switcher";
import { useI18n } from "@/lib/i18n/provider";

const tools = [
  ["Lead Finder", "Find companies by industry, country, city, size, website, niche and business type.", Search],
  ["Decision Maker Finder", "Find CEOs, founders, owners, sales managers, marketing managers and other key contacts.", UserRoundSearch],
  ["AI Website Analyzer", "Analyze every prospect website and detect services, weak points, offers, competitors and personalization angles.", Globe2],
  ["AI Email Generator", "Generate personal cold emails and follow-ups based on real company research.", Mail],
  ["Campaign Manager", "Create outreach sequences, approve emails, schedule sending and track performance.", Workflow],
  ["CRM Pipeline", "Manage leads from New to Researched to Contacted to Replied to Meeting to Client.", ClipboardCheck]
] as const;

const workflow = [
  "Describe your offer",
  "Choose target market",
  "Find companies",
  "Analyze websites",
  "Generate personalized emails",
  "Approve and launch campaign",
  "Track replies and meetings"
] as const;

const painSolutions = [
  ["Manual prospecting is slow", "OutreachAI finds companies automatically"],
  ["Generic emails get ignored", "AI writes personal messages based on website research"],
  ["Replies are lost", "Inbox and CRM keep everything in one place"],
  ["Sales teams use too many tools", "OutreachAI combines lead search, AI research, email, CRM and analytics"]
] as const;

const previewItems = [
  ["Found leads", "248 qualified companies", "Berlin construction market"],
  ["Website analyzed", "Strong fit, weak CTA, clear services", "AI score 87%"],
  ["Email prepared", "Personalized opening + offer", "Ready for approval"],
  ["Reply detected", "Interested: asked for pricing", "AI suggested next step"],
  ["Meeting booked", "Thursday 10:30", "Pipeline updated"]
] as const;

const plans = [
  {
    name: "Starter",
    price: "€49",
    audience: "For freelancers and small businesses",
    cta: "Start free trial",
    items: ["500 leads/month", "1,000 AI emails/month", "Lead Finder", "Website Analyzer", "CRM", "Review mode"]
  },
  {
    name: "Pro",
    price: "€149",
    audience: "For sales teams",
    cta: "Start Pro trial",
    featured: true,
    items: ["5,000 leads/month", "10,000 AI emails/month", "AI Reply Assistant", "Campaign Manager", "Advanced Analytics", "Multiple campaigns"]
  },
  {
    name: "Agency",
    price: "€499",
    audience: "For agencies and SaaS companies",
    cta: "Start Agency trial",
    items: ["50,000 leads/month", "100,000 AI emails/month", "Client workspaces", "Team members", "AI Lead Qualification", "Meeting booking", "Agency controls"]
  }
] as const;

const darkMetrics = [
  [Building2, "Companies", "248 found"],
  [Globe2, "Websites analyzed", "193 researched"],
  [Inbox, "Replies", "27 classified"],
  [BarChart3, "Meetings", "8 booked"]
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

export function LandingPage() {
  const { t } = useI18n();
  const schema = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "OutreachAI",
    applicationCategory: "SalesApplication",
    description: "AI Sales Workspace for B2B lead generation, website analysis, personalized outreach, email campaigns and CRM.",
    offers: plans.map((plan) => ({ "@type": "Offer", name: `OutreachAI ${plan.name}`, price: plan.price.replace("€", ""), priceCurrency: "EUR" }))
  };

  return (
    <main className="landing-safe min-w-0 max-w-[100vw] overflow-x-clip bg-white text-ink">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }} />
      <section className="relative border-b border-slate-200 bg-[radial-gradient(circle_at_top_left,#e6fffb_0,#ffffff_34rem)]">
        <nav className="mx-auto flex max-w-7xl items-center justify-between gap-3 overflow-hidden px-4 py-5 min-[360px]:px-5">
          <Link href="/" className="shrink-0 text-xl font-bold tracking-tight text-ink">OutreachAI</Link>
          <div className="hidden items-center gap-7 text-sm font-semibold text-slate-600 md:flex">
            <a href="#tools" className="hover:text-ink">{t("Tools")}</a>
            <a href="#workflow" className="hover:text-ink">{t("Workflow")}</a>
            <a href="#pricing" className="hover:text-ink">{t("Pricing")}</a>
          </div>
          <div className="flex min-w-0 shrink-0 items-center gap-2">
            <LanguageSwitcher compact />
            <AuthNavigationLink href="/sign-in" className="hidden min-h-11 items-center rounded-md px-3 text-sm font-semibold text-slate-700 hover:bg-slate-100 sm:inline-flex">{t("Login")}</AuthNavigationLink>
            <AuthNavigationLink href="/sign-up?plan=Starter" className="hidden min-h-11 items-center rounded-md bg-ink px-4 text-sm font-semibold text-white shadow-soft hover:bg-slate-800 sm:inline-flex">{t("Start free trial")}</AuthNavigationLink>
          </div>
        </nav>

        <div className="mx-auto grid max-w-7xl items-center gap-10 overflow-hidden px-4 pb-14 pt-8 min-[360px]:px-5 sm:pb-20 sm:pt-12 lg:grid-cols-[1.02fr_0.98fr]">
          <div className="min-w-0 max-w-full">
            <p className="inline-flex rounded-full border border-teal-200 bg-teal-50 px-3 py-1 text-sm font-bold text-brand">{t("AI Sales Workspace for outbound growth")}</p>
            <h1 className="mt-5 max-w-full text-[clamp(2.35rem,10vw,4.5rem)] font-bold leading-[0.98] tracking-normal text-ink md:text-6xl md:leading-[0.95] lg:text-7xl">{t("AI Sales Employee for B2B Lead Generation")}</h1>
            <p className="mt-6 max-w-2xl text-base leading-7 text-slate-600 min-[390px]:text-lg sm:text-xl sm:leading-8">
              {t("Find qualified companies, analyze their websites, generate personalized outreach, launch campaigns, and turn replies into meetings — from one workspace.")}
            </p>
            <div className="mt-8 flex flex-col gap-3 min-[430px]:flex-row">
              <AuthNavigationLink href="/sign-up?plan=Starter" className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-md bg-brand px-5 text-sm font-bold text-white shadow-soft hover:bg-teal-700 min-[430px]:w-auto" testId="hero-start-free-trial">
                {t("Start free trial")} <ArrowRight size={18} aria-hidden="true" />
              </AuthNavigationLink>
              <AuthNavigationLink href="/sign-in" className="inline-flex min-h-12 w-full items-center justify-center rounded-md border border-slate-300 bg-white px-5 text-sm font-bold text-ink hover:border-slate-400 min-[430px]:w-auto">{t("Login")}</AuthNavigationLink>
            </div>
            <div className="mt-8 grid gap-3 text-sm text-slate-600 sm:grid-cols-3">
              {["Replace 5-6 sales tools", "Review before send", "Built for meetings"].map((item) => (
                <span key={item} className="inline-flex items-center gap-2"><CheckCircle2 size={17} className="text-brand" />{t(item)}</span>
              ))}
            </div>
          </div>

          <div className="min-w-0 rounded-[1.75rem] border border-slate-200 bg-slate-950 p-3 shadow-2xl">
            <div className="rounded-[1.25rem] bg-white p-4 min-[390px]:p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-bold text-brand">{t("Live campaign workspace")}</p>
                  <h2 className="mt-1 text-xl font-bold text-ink">{t("German Builders Outreach")}</h2>
                </div>
                <span className="rounded-full bg-teal-50 px-3 py-1 text-xs font-bold text-brand">{t("Review mode")}</span>
              </div>
              <div className="mt-5 grid gap-3">
                {previewItems.map(([title, value, detail]) => (
                  <article key={title} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{t(title)}</p>
                        <p className="mt-1 text-sm font-bold text-ink min-[390px]:text-base">{t(value)}</p>
                        <p className="mt-1 text-sm text-slate-600">{t(detail)}</p>
                      </div>
                      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-white text-brand shadow-sm"><CheckCircle2 size={18} /></span>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="tools" className="mx-auto max-w-7xl px-4 py-14 min-[360px]:px-5 sm:py-20">
        <div className="max-w-3xl">
          <p className="text-sm font-bold uppercase tracking-wide text-brand">{t("What OutreachAI does")}</p>
          <h2 className="mt-3 text-3xl font-bold text-ink min-[390px]:text-4xl">{t("One AI workspace for lead search, research, outreach and CRM.")}</h2>
        </div>
        <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {tools.map(([title, copy, Icon]) => (
            <article key={title} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-1 hover:shadow-soft">
              <div className="grid size-11 place-items-center rounded-xl bg-teal-50 text-brand"><Icon size={22} /></div>
              <h3 className="mt-5 text-lg font-bold text-ink">{t(title)}</h3>
              <p className="mt-2 text-sm leading-6 text-slate-600">{t(copy)}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="workflow" className="bg-slate-50 py-14 sm:py-20">
        <div className="mx-auto max-w-7xl px-4 min-[360px]:px-5">
          <div className="grid gap-8 lg:grid-cols-[0.85fr_1.15fr]">
            <div>
              <p className="text-sm font-bold uppercase tracking-wide text-brand">{t("Workflow")}</p>
              <h2 className="mt-3 text-3xl font-bold text-ink min-[390px]:text-4xl">{t("From market idea to approved campaign in minutes.")}</h2>
              <p className="mt-4 text-slate-600">{t("The product always guides the user to the next action: find companies, research them, review AI work, approve, and measure results.")}</p>
            </div>
            <ol className="grid gap-3 sm:grid-cols-2">
              {workflow.map((step, index) => (
                <li key={step} className="flex gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <span className="grid size-8 shrink-0 place-items-center rounded-full bg-ink text-sm font-bold text-white">{index + 1}</span>
                  <span className="pt-1 font-semibold text-ink">{t(step)}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-14 min-[360px]:px-5 sm:py-20">
        <div className="max-w-3xl">
          <p className="text-sm font-bold uppercase tracking-wide text-brand">{t("Pain to solution")}</p>
          <h2 className="mt-3 text-3xl font-bold text-ink min-[390px]:text-4xl">{t("Stop stitching together spreadsheets, inboxes and AI prompts.")}</h2>
        </div>
        <div className="mt-10 grid gap-4 lg:grid-cols-2">
          {painSolutions.map(([pain, solution]) => (
            <article key={pain} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-xl bg-red-50 p-4">
                  <p className="text-xs font-bold uppercase text-red-600">{t("Pain")}</p>
                  <p className="mt-2 font-bold text-ink">{t(pain)}</p>
                </div>
                <div className="rounded-xl bg-teal-50 p-4">
                  <p className="text-xs font-bold uppercase text-brand">{t("Solution")}</p>
                  <p className="mt-2 font-bold text-ink">{t(solution)}</p>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="bg-slate-950 py-14 text-white sm:py-20">
        <div className="mx-auto grid max-w-7xl gap-6 px-4 min-[360px]:px-5 lg:grid-cols-4">
          {darkMetrics.map(([Icon, label, value]) => (
            <article key={label} className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <Icon size={22} className="text-teal-200" />
              <p className="mt-5 text-sm text-slate-300">{t(label)}</p>
              <p className="mt-1 text-2xl font-bold">{t(value)}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="pricing" className="mx-auto max-w-7xl px-4 py-14 min-[360px]:px-5 sm:py-20">
        <div className="max-w-3xl">
          <p className="text-sm font-bold uppercase tracking-wide text-brand">{t("Pricing")}</p>
          <h2 className="mt-3 text-3xl font-bold text-ink min-[390px]:text-4xl">{t("Simple plans for teams that want more qualified meetings.")}</h2>
        </div>
        <div className="mt-10 grid gap-5 lg:grid-cols-3">
          {plans.map((plan) => {
            const featured = "featured" in plan && plan.featured;
            return (
              <article key={plan.name} className={`rounded-2xl border p-6 shadow-sm ${featured ? "border-brand bg-teal-50" : "border-slate-200 bg-white"}`}>
                {featured && <p className="mb-4 w-fit rounded-full bg-brand px-3 py-1 text-xs font-bold text-white">{t("Most popular")}</p>}
                <h3 className="text-2xl font-bold text-ink">{t(plan.name)}</h3>
                <p className="mt-2 text-sm text-slate-600">{t(plan.audience)}</p>
                <p className="mt-5 text-4xl font-bold text-ink">{plan.price}<span className="text-base font-semibold text-slate-500">{t("/month")}</span></p>
                <p className="mt-2 text-sm font-bold text-brand">{t("14-day free trial")}</p>
                <ul className="mt-6 space-y-3 text-sm text-slate-700">
                  {plan.items.map((item) => <li key={item} className="flex gap-2"><CheckCircle2 size={18} className="mt-0.5 shrink-0 text-brand" />{t(item)}</li>)}
                </ul>
                <div className="mt-7">
                  <PricingCheckoutButton plan={plan.name}>{t(plan.cta)}</PricingCheckoutButton>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="bg-ink px-4 py-14 text-white min-[360px]:px-5 sm:py-20">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-3xl font-bold min-[390px]:text-4xl">{t("Find customers faster than manual outbound.")}</h2>
            <p className="mt-3 max-w-2xl text-slate-300">{t("Start with a target market. OutreachAI prepares leads, research, emails and campaign review from one workspace.")}</p>
          </div>
          <AuthNavigationLink href="/sign-up?plan=Starter" className="inline-flex min-h-12 w-fit items-center justify-center gap-2 rounded-md bg-white px-5 text-sm font-bold text-ink hover:bg-slate-100">
            {t("Start free trial")} <ArrowRight size={18} />
          </AuthNavigationLink>
        </div>
      </section>

      <footer className="border-t border-slate-200 bg-white px-4 py-8 text-sm text-slate-500 min-[360px]:px-5">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="font-semibold text-ink">OutreachAI</p>
          <p>{t("Lead generation, AI research, outbound campaigns and CRM in one workspace.")}</p>
        </div>
      </footer>
    </main>
  );
}
