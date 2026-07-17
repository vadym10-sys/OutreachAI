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
  ["Lead Finder", "Find companies by industry, country, city, size, website, niche and business type.", Search],
  ["Decision Maker Finder", "Find CEOs, founders, owners, sales managers, marketing managers and other key contacts.", UserRoundSearch],
  ["AI Website Analyzer", "Analyze every prospect website and detect services, weak points, offers, competitors and personalization angles.", Globe2],
  ["AI Email Generator", "Generate personal cold emails and follow-ups based on real company research.", Mail],
  ["Campaign Manager", "Create outreach sequences, approve emails, schedule sending and track performance.", Workflow],
  ["CRM Pipeline", "Manage leads from New to Researched to Contacted to Replied to Meeting to Client.", BarChart3]
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

const aiDemo = [
  ["Market scan", "248 companies found", "Berlin construction market", 82],
  ["Research", "193 websites analyzed", "Pain, offer, tech and buying triggers", 76],
  ["Prioritize", "27 accounts need attention", "AI ranked by fit and urgency", 68],
  ["Outreach", "41 messages ready", "Review mode, no blind sending", 88]
] as const;

const productMoments = [
  ["AI Command Center", "Know what happened, what matters and what to do next before opening a CRM table.", Sparkles],
  ["Company Workspace", "Every account becomes a live brief: fit, signals, people, risks, message angle and next action.", Building2],
  ["Outreach Control Room", "Campaigns and replies stay connected to the research that created them.", Inbox]
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

const faq = [
  ["Does OutreachAI send emails automatically?", "No. The interface is built around review and approval before sending."],
  ["Where does the personalization come from?", "From the company data, website analysis, contacts and AI research available in your workspace."],
  ["Can I use it without a complete CRM setup?", "Yes. Start from one target market or one company, then enrich the account from the workspace."],
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
    <span className="mt-3 block h-2 overflow-hidden rounded-full bg-white/10">
      <span className="block h-full rounded-full bg-[linear-gradient(90deg,#8b7cff,#65d9ff,#f5c16c)]" style={{ width: `${value}%` }} />
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
    description: "AI Sales Workspace for B2B lead generation, website analysis, personalized outreach, email campaigns and CRM.",
    offers: plans.map((plan) => ({ "@type": "Offer", name: `OutreachAI ${plan.name}`, price: plan.price.replace("€", ""), priceCurrency: "EUR" }))
  };

  return (
    <main className="landing-safe min-w-0 max-w-[100vw] overflow-x-clip bg-[#f7f5ef] text-ink">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }} />

      <section className="ai-os-dark relative overflow-hidden text-white">
        <div className="absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.45),transparent)]" />
        <nav className="relative z-10 mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-5 min-[360px]:px-5">
          <Link href="/" className="flex min-h-11 shrink-0 items-center gap-3 text-xl font-black tracking-tight">
            <span className="grid size-10 place-items-center rounded-2xl bg-white text-sm text-[#101114] shadow-glow">OA</span>
            <span>OutreachAI</span>
          </Link>
          <div className="hidden items-center gap-7 text-sm font-bold text-white/60 md:flex">
            <a href="#product" className="hover:text-white">{t("Tools")}</a>
            <a href="#workflow" className="hover:text-white">{t("Workflow")}</a>
            <a href="#pricing" className="hover:text-white">{t("Pricing")}</a>
          </div>
          <div className="flex min-w-0 shrink-0 items-center gap-2">
            <LanguageSwitcher compact />
            <AuthNavigationLink href="/sign-in" className="hidden min-h-11 items-center rounded-full px-4 text-sm font-bold text-white/75 hover:bg-white/10 hover:text-white sm:inline-flex">{t("Login")}</AuthNavigationLink>
            <AuthNavigationLink href="/sign-up?plan=Starter" className="hidden min-h-11 items-center rounded-full bg-white px-4 text-sm font-black text-[#101114] shadow-glow hover:bg-white/90 sm:inline-flex">{t("Start free trial")}</AuthNavigationLink>
          </div>
        </nav>

        <div className="relative z-10 mx-auto grid max-w-7xl items-center gap-10 px-4 pb-20 pt-10 min-[360px]:px-5 sm:pb-24 sm:pt-16 lg:grid-cols-[0.92fr_1.08fr]">
          <div className="min-w-0">
            <p className="inline-flex min-h-9 items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3 text-sm font-black text-white/80 backdrop-blur">
              <Sparkles size={16} /> {t("AI Sales Workspace for outbound growth")}
            </p>
            <h1 className="mt-6 max-w-full text-[clamp(2.7rem,10vw,6.4rem)] font-black leading-[0.88] tracking-[-0.04em] text-white">
              {t("AI Sales Employee for B2B Lead Generation")}
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-7 text-white/70 min-[390px]:text-lg sm:text-xl sm:leading-8">
              {t("Find qualified companies, analyze their websites, generate personalized outreach, launch campaigns, and turn replies into meetings — from one workspace.")}
            </p>
            <div className="mt-8 flex flex-col gap-3 min-[430px]:flex-row">
              <AuthNavigationLink href="/sign-up?plan=Starter" className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-white px-5 text-sm font-black text-[#101114] shadow-glow hover:bg-white/90 min-[430px]:w-auto" testId="hero-start-free-trial">
                {t("Start free trial")} <ArrowRight size={18} aria-hidden="true" />
              </AuthNavigationLink>
              <AuthNavigationLink href="/sign-in" className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full border border-white/15 bg-white/10 px-5 text-sm font-black text-white backdrop-blur hover:bg-white/15 min-[430px]:w-auto">
                {t("Login")} <ChevronRight size={18} aria-hidden="true" />
              </AuthNavigationLink>
            </div>
            <div className="mt-8 grid gap-3 text-sm font-bold text-white/60 sm:grid-cols-3">
              {["Review before send", "No fake demo CRM", "Built for meetings"].map((item) => (
                <span key={item} className="inline-flex items-center gap-2"><CheckCircle2 size={17} className="text-[#65d9ff]" />{t(item)}</span>
              ))}
            </div>
          </div>

          <div className="relative min-w-0">
            <div className="absolute -inset-4 rounded-[2.5rem] bg-[linear-gradient(135deg,rgba(139,124,255,0.28),rgba(101,217,255,0.18),rgba(245,193,108,0.16))] blur-2xl" />
            <div className="relative overflow-hidden rounded-[2rem] border border-white/15 bg-white/10 p-3 shadow-2xl backdrop-blur-2xl">
              <div className="rounded-[1.5rem] border border-white/10 bg-[#0d0f16]/95 p-4 min-[390px]:p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.16em] text-[#65d9ff]">{t("Live AI operating layer")}</p>
                    <h2 className="mt-2 text-2xl font-black tracking-tight text-white">{t("German Builders Outreach")}</h2>
                  </div>
                  <span className="rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs font-black text-white/70">{t("Review mode")}</span>
                </div>

                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  {aiDemo.map(([title, value, detail, progress]) => (
                    <article key={title} className="rounded-2xl border border-white/10 bg-white/[0.06] p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-black uppercase tracking-[0.12em] text-white/50">{t(title)}</p>
                          <p className="mt-2 text-base font-black text-white">{t(value)}</p>
                          <p className="mt-1 text-sm leading-5 text-white/60">{t(detail)}</p>
                        </div>
                        <Radar size={19} className="shrink-0 text-[#65d9ff]" />
                      </div>
                      <ProgressLine value={progress} />
                    </article>
                  ))}
                </div>

                <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.06] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.12em] text-white/50">{t("AI recommendation")}</p>
                      <p className="mt-2 text-sm font-bold leading-6 text-white/80">{t("Prioritize accounts with recent hiring signals, weak conversion pages and verified decision makers.")}</p>
                    </div>
                    <Zap className="shrink-0 text-[#f5c16c]" size={22} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="border-y border-black/5 bg-white/60 py-8 backdrop-blur">
        <div className="mx-auto grid max-w-7xl gap-3 px-4 min-[360px]:px-5 md:grid-cols-[0.75fr_1.25fr] md:items-center">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.14em] text-brand">{t("Social proof")}</p>
            <p className="mt-1 text-sm font-semibold text-[var(--ui-text-soft)]">{t("Customer logos are shown only after approval. These are demo categories, not client claims.")}</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-4">
            {["Demo SaaS", "Demo Agency", "Demo Recruiting", "Demo B2B Services"].map((label) => (
              <div key={label} className="rounded-2xl border border-black/5 bg-white/70 px-4 py-3 text-center text-xs font-black uppercase tracking-[0.12em] text-[var(--ui-text-soft)] shadow-sm">
                {t(label)}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="product" className="mx-auto max-w-7xl px-4 py-16 min-[360px]:px-5 sm:py-24">
        <div className="max-w-3xl">
          <p className="text-sm font-black uppercase tracking-[0.14em] text-brand">{t("What OutreachAI does")}</p>
          <h2 className="mt-3 text-4xl font-black leading-[0.96] tracking-[-0.03em] text-ink min-[390px]:text-5xl">{t("One AI operating system for outbound revenue.")}</h2>
          <p className="mt-4 text-base leading-7 text-[var(--ui-text-soft)]">{t("It replaces the messy handoff between lead search, research, prompting, spreadsheets, email drafts, campaigns and replies.")}</p>
        </div>
        <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {tools.map(([title, copy, Icon]) => (
            <article key={title} className="ui-card ui-orbit-card rounded-[2rem] p-5">
              <div className="grid size-11 place-items-center rounded-2xl bg-[linear-gradient(135deg,rgba(79,70,229,0.14),rgba(0,163,255,0.12))] text-brand"><Icon size={22} /></div>
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
            <h2 className="mt-3 text-4xl font-black leading-none text-ink">{t("From market idea to approved campaign in minutes.")}</h2>
            <p className="mt-4 text-sm leading-7 text-[var(--ui-text-soft)]">{t("The product always guides the user to the next action: find companies, research them, review AI work, approve, and measure results.")}</p>
          </div>
          <ol className="grid gap-3 sm:grid-cols-2">
            {workflow.map((step, index) => (
              <li key={step} className="ui-card rounded-[1.5rem] p-4">
                <span className="grid size-9 place-items-center rounded-full bg-[#101114] text-sm font-black text-white">{index + 1}</span>
                <p className="mt-4 font-black text-ink">{t(step)}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="bg-[#0a0b10] px-4 py-16 text-white min-[360px]:px-5 sm:py-24">
        <div className="mx-auto max-w-7xl">
          <div className="max-w-3xl">
            <p className="text-sm font-black uppercase tracking-[0.14em] text-[#65d9ff]">{t("Product moments")}</p>
            <h2 className="mt-3 text-4xl font-black leading-none tracking-[-0.03em] min-[390px]:text-5xl">{t("Every screen should feel like a finished commercial product.")}</h2>
          </div>
          <div className="mt-10 grid gap-4 lg:grid-cols-3">
            {productMoments.map(([title, copy, Icon]) => (
              <article key={title} className="rounded-[2rem] border border-white/10 bg-white/[0.06] p-6 backdrop-blur">
                <Icon className="text-[#65d9ff]" size={24} />
                <h3 className="mt-8 text-2xl font-black">{t(title)}</h3>
                <p className="mt-3 text-sm leading-7 text-white/60">{t(copy)}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="pricing" className="mx-auto max-w-7xl px-4 py-16 min-[360px]:px-5 sm:py-24">
        <div className="max-w-3xl">
          <p className="text-sm font-black uppercase tracking-[0.14em] text-brand">{t("Pricing")}</p>
          <h2 className="mt-3 text-4xl font-black leading-[0.96] tracking-[-0.03em] text-ink min-[390px]:text-5xl">{t("Simple plans for teams that want more qualified meetings.")}</h2>
        </div>
        <div className="mt-10 grid gap-5 lg:grid-cols-3">
          {plans.map((plan) => {
            const featured = "featured" in plan && plan.featured;
            return (
              <article key={plan.name} className={`rounded-[2rem] border p-6 shadow-soft ${featured ? "border-indigo-300 bg-[linear-gradient(180deg,#ffffff,#eef1ff)]" : "border-black/5 bg-white/75"}`}>
                {featured && <p className="mb-4 w-fit rounded-full bg-[#101114] px-3 py-1 text-xs font-black text-white">{t("Most popular")}</p>}
                <h3 className="text-2xl font-black text-ink">{t(plan.name)}</h3>
                <p className="mt-2 text-sm text-[var(--ui-text-soft)]">{t(plan.audience)}</p>
                <p className="mt-5 text-4xl font-black text-ink">{plan.price}<span className="text-base font-semibold text-[var(--ui-text-soft)]">{t("/month")}</span></p>
                <p className="mt-2 text-sm font-black text-brand">{t("14-day free trial")}</p>
                <ul className="mt-6 space-y-3 text-sm text-[var(--ui-text-soft)]">
                  {plan.items.map((item) => <li key={item} className="flex gap-2"><CheckCircle2 size={18} className="mt-0.5 shrink-0 text-brand" />{t(item)}</li>)}
                </ul>
                <div className="mt-7">
                  <AuthNavigationLink href={`/sign-up?plan=${encodeURIComponent(plan.name)}`} className="focus-ring inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-[#101114] px-5 py-3 text-center text-sm font-black text-white shadow-glow transition hover:bg-black">
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
              <article key={question} className="rounded-[1.5rem] border border-black/5 bg-white/75 p-5 shadow-sm">
                <h3 className="font-black text-ink">{t(question)}</h3>
                <p className="mt-2 text-sm leading-6 text-[var(--ui-text-soft)]">{t(answer)}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="px-4 pb-8 min-[360px]:px-5">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 overflow-hidden rounded-[2rem] bg-[#101114] p-6 text-white shadow-2xl sm:p-8 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.14em] text-[#65d9ff]">{t("Final CTA")}</p>
            <h2 className="mt-3 text-3xl font-black leading-none min-[390px]:text-4xl">{t("Find customers faster than manual outbound.")}</h2>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-white/60">{t("Start with a target market. OutreachAI prepares leads, research, emails and campaign review from one workspace.")}</p>
          </div>
          <AuthNavigationLink href="/sign-up?plan=Starter" className="inline-flex min-h-12 w-fit items-center justify-center gap-2 rounded-full bg-white px-5 text-sm font-black text-[#101114] hover:bg-white/90">
            {t("Start free trial")} <ArrowRight size={18} />
          </AuthNavigationLink>
        </div>
      </section>

      <footer className="border-t border-black/5 bg-white/60 px-4 py-8 text-sm text-[var(--ui-text-soft)] min-[360px]:px-5">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="font-black text-ink">OutreachAI</p>
          <div className="flex flex-wrap gap-4">
            <Link href="/privacy" className="font-bold hover:text-ink">{t("Privacy")}</Link>
            <Link href="/terms" className="font-bold hover:text-ink">{t("Terms")}</Link>
            <Link href="/security" className="font-bold hover:text-ink">{t("Security")}</Link>
          </div>
          <p>{t("Lead generation, AI research, outbound campaigns and CRM in one workspace.")}</p>
          <ShieldCheck size={18} className="hidden text-brand sm:block" />
        </div>
      </footer>
    </main>
  );
}
