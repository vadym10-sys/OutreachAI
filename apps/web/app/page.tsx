import { CheckCircle2, Globe2, Mail, Search, ShieldCheck, TrendingUp, Users } from "lucide-react";
import { SecondaryLink } from "@/components/button";
import { PricingCheckoutButton } from "@/components/billing-client";
import { LanguageSwitcher } from "@/components/language-switcher";

const features = [
  { title: "Lead Finder", copy: "Find companies by niche, country, and city with verified enrichment fields.", Icon: Search },
  { title: "AI Website Analyzer", copy: "Detect services, strengths, weak points, and outreach angles from prospect websites.", Icon: Globe2 },
  { title: "Personalization Engine", copy: "Generate cold emails, follow-ups, and A/B variants using company context.", Icon: Mail },
  { title: "Campaign Manager", copy: "Prepare, approve, schedule, and monitor outbound sequences with clear safety controls.", Icon: TrendingUp },
  { title: "CRM", copy: "Track every lead from New to Closed with notes, filters, and search.", Icon: Users },
  { title: "Trust and control", copy: "Your team approves every external action, with safe access controls and protected customer data.", Icon: ShieldCheck }
];

const pricing = [
  {
    name: "Starter",
    price: "€49",
    desc: "Best for freelancers, consultants and small businesses.",
    cta: "Start Starter Trial",
    items: ["1 AI Sales Employee", "500 leads/month", "1,000 AI emails/month", "AI Website Analysis", "AI Email Generator", "AI Follow-up Generator", "Lead Finder", "CRM", "Inbox", "Campaigns", "Basic Analytics", "1 Workspace", "Review Mode only", "14-day free trial"]
  },
  {
    name: "Pro",
    price: "€149",
    desc: "Best for growing companies and sales teams.",
    cta: "Start Pro Trial",
    items: ["Everything in Starter", "3 AI Sales Employees", "5,000 leads/month", "10,000 AI emails/month", "AI Reply Assistant", "Semi-Automatic Campaigns", "AI Campaign Optimization", "Full AI Website Audit", "AI Sales Copilot", "AI Meeting Preparation", "AI Follow-up Optimization", "Advanced Analytics", "Revenue Dashboard", "Multiple Campaigns", "3 Workspaces", "Priority Processing", "14-day free trial"]
  },
  {
    name: "Agency",
    price: "€499",
    desc: "Best for agencies, SaaS companies and larger teams.",
    cta: "Start Agency Trial",
    items: ["Everything in Pro", "10 AI Sales Employees", "50,000 leads/month", "100,000 AI emails/month", "Approval-gated automation", "AI Lead Qualification", "AI Reply Automation", "AI Meeting Booking", "AI Sales Forecasting", "Unlimited Campaigns", "Unlimited Workspaces", "Team Members", "Agency-ready controls", "Priority Support", "14-day free trial"]
  }
] as const;

const everyPlanIncludes = ["Secure billing", "Cancel anytime", "Automatic monthly billing", "Protected data", "GDPR-ready", "Email tracking", "Open tracking", "Reply tracking", "Reliable production hosting", "Continuous updates", "Automatic backups", "AI improvements"];

export default function Home() {
  const schema = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "OutreachAI",
    applicationCategory: "BusinessApplication",
    offers: pricing.map(({ name, price }) => ({ "@type": "Offer", name, price: price.replace("€", ""), priceCurrency: "EUR" }))
  };

  return (
    <main className="min-w-0 overflow-x-hidden bg-slate-50 text-ink">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }} />
      <section className="border-b border-slate-200 bg-white">
        <nav className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-4 min-[360px]:px-5 min-[360px]:py-5">
          <span className="min-w-0 text-lg font-bold min-[360px]:text-xl">OutreachAI</span>
          <div className="hidden items-center gap-6 text-sm font-medium text-slate-600 md:flex">
            <a className="inline-flex min-h-11 min-w-8 items-center" href="#features">Features</a>
            <a className="inline-flex min-h-11 min-w-8 items-center" href="#pricing">Pricing</a>
            <a className="inline-flex min-h-11 min-w-8 items-center" href="#faq">FAQ</a>
          </div>
          <div className="flex w-auto shrink-0 items-center gap-2">
            <LanguageSwitcher compact />
            <SecondaryLink href="/sign-in">Login</SecondaryLink>
          </div>
        </nav>
        <div className="mx-auto grid max-w-7xl gap-8 px-4 pb-12 pt-8 min-[360px]:px-5 sm:gap-10 sm:pb-16 sm:pt-10 lg:grid-cols-[1.05fr_0.95fr] lg:pb-20 lg:pt-16">
          <div className="min-w-0">
            <p className="mb-4 inline-flex max-w-full rounded-full border border-teal-200 bg-teal-50 px-3 py-1 text-xs font-semibold text-brand min-[360px]:text-sm">AI outbound system for B2B revenue teams</p>
            <h1 className="max-w-4xl text-4xl font-bold tracking-normal text-ink min-[360px]:text-5xl md:text-7xl">OutreachAI</h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-slate-600 min-[390px]:text-lg sm:mt-6 sm:text-xl sm:leading-8">Find qualified companies, analyze their websites, generate personal outreach, run campaigns, and manage replies from one production-ready CRM.</p>
            <div className="mt-8 flex flex-col gap-3 min-[360px]:flex-row min-[360px]:flex-wrap">
              <PricingCheckoutButton plan="Starter">Start Starter</PricingCheckoutButton>
              <SecondaryLink href="/dashboard">View dashboard</SecondaryLink>
            </div>
          </div>
          <div className="min-w-0 rounded-lg border border-slate-200 bg-slate-900 p-4 text-white shadow-soft min-[360px]:p-5">
            <p className="text-sm font-semibold text-teal-200">First campaign workflow</p>
            <div className="mt-4 space-y-3">
              {["Describe your offer and ideal customer", "Import or discover qualified companies", "Review AI research and prepared emails", "Approve every external action before sending"].map((label, index) => (
                <div key={label} className="flex gap-3 rounded-md bg-white/10 p-4">
                  <span className="grid size-7 shrink-0 place-items-center rounded-full bg-white text-sm font-bold text-ink">{index + 1}</span>
                  <p className="text-sm leading-6 text-slate-100">{label}</p>
                </div>
              ))}
            </div>
            <div className="mt-4 rounded-md bg-white p-4 text-ink">
              <p className="text-sm font-semibold text-brand">Safety-first automation</p>
              <p className="mt-2 text-sm text-slate-600">OutreachAI prepares the work. You approve campaigns, CRM changes, and email sends before anything leaves the workspace.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-12 min-[360px]:px-5 sm:py-16">
        <div className="grid gap-8 md:grid-cols-3">
          {["Manual prospecting is slow", "Generic emails get ignored", "Replies are scattered"].map((title) => (
            <div key={title} className="min-w-0">
              <h2 className="text-xl font-bold min-[360px]:text-2xl">{title}</h2>
              <p className="mt-3 text-slate-600">Teams lose hours switching between scraping tools, spreadsheets, AI prompts, inboxes, and CRMs.</p>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-white py-12 sm:py-16">
        <div className="mx-auto max-w-7xl px-4 min-[360px]:px-5">
          <h2 className="text-3xl font-bold min-[390px]:text-4xl">A complete outbound operating system</h2>
          <p className="mt-4 max-w-2xl text-slate-600">OutreachAI combines data, AI, email operations, analytics, billing, and administration into a single SaaS workflow.</p>
          <div id="features" className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {features.map(({ title, copy, Icon }) => (
              <div key={title} className="min-w-0 rounded-lg border border-slate-200 p-5">
                <Icon className="text-brand" size={24} aria-hidden="true" />
                <h3 className="mt-4 text-lg font-bold">{title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">{copy}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-12 min-[360px]:px-5 sm:py-16">
        <h2 className="text-3xl font-bold min-[390px]:text-4xl">Built for review-first outbound</h2>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {[
            ["No mystery sends", "Prepared emails stay inside OutreachAI until a user approves them."],
            ["No spreadsheet chaos", "Leads, research, campaigns, replies, and billing live in one workspace."],
            ["No empty dashboard", "New accounts see guided next steps instead of blank metrics."]
          ].map(([title, copy]) => (
            <article key={title} className="min-w-0 rounded-lg border border-slate-200 bg-white p-5">
              <h3 className="font-bold">{title}</h3>
              <p className="mt-2 text-sm leading-6 text-slate-600">{copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="pricing" className="bg-white py-12 sm:py-16">
        <div className="mx-auto max-w-7xl px-4 min-[360px]:px-5">
          <h2 className="text-3xl font-bold min-[390px]:text-4xl">Pricing</h2>
          <p className="mt-3 text-slate-600">All plans include secure Stripe billing, automatic monthly renewal, cancel anytime, and a 14-day free trial.</p>
          <div className="mt-8 grid gap-4 lg:grid-cols-3">
            {pricing.map(({ name, price, desc, cta, items }) => (
              <div key={name} className="min-w-0 rounded-lg border border-slate-200 p-5 min-[360px]:p-6">
                <h3 className="text-xl font-bold">{name}</h3>
                <p className="mt-3 text-3xl font-bold min-[360px]:text-4xl">{price}<span className="text-base font-medium text-slate-500">/mo</span></p>
                <p className="mt-2 text-slate-600">{desc}</p>
                <p className="mt-3 rounded-md bg-teal-50 px-3 py-2 text-sm font-semibold text-brand">14-day free trial included</p>
                <ul className="mt-5 space-y-3 text-sm text-slate-700">
                  {items.map((item) => (
                    <li key={item} className="flex gap-2"><CheckCircle2 className="mt-0.5 shrink-0 text-brand" size={18} />{item}</li>
                  ))}
                </ul>
                <div className="mt-6"><PricingCheckoutButton plan={name}>{cta}</PricingCheckoutButton></div>
              </div>
            ))}
          </div>
          <div className="mt-8 rounded-lg border border-slate-200 bg-slate-50 p-5">
            <h3 className="text-lg font-bold">Every plan includes</h3>
            <div className="mt-4 grid gap-2 text-sm text-slate-700 sm:grid-cols-2 lg:grid-cols-4">
              {everyPlanIncludes.map((item) => <span key={item} className="inline-flex gap-2"><CheckCircle2 className="mt-0.5 shrink-0 text-brand" size={16} />{item}</span>)}
            </div>
          </div>
        </div>
      </section>

      <section id="faq" className="mx-auto max-w-4xl px-4 py-12 min-[360px]:px-5 sm:py-16">
        <h2 className="text-3xl font-bold min-[390px]:text-4xl">FAQ</h2>
        {["Can I cancel anytime?", "Does it support Google login?", "Can agencies manage clients?", "Is billing handled by Stripe?"].map((q) => (
          <details key={q} className="mt-4 rounded-lg border border-slate-200 bg-white p-5">
            <summary className="cursor-pointer font-semibold">{q}</summary>
            <p className="mt-3 text-slate-600">Yes. OutreachAI is built with production SaaS defaults for global customers, subscriptions, and secure access control.</p>
          </details>
        ))}
      </section>

      <section className="bg-ink px-4 py-12 text-white min-[360px]:px-5 sm:py-16">
        <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-6 md:flex-row md:items-center">
          <div className="min-w-0">
            <h2 className="text-3xl font-bold min-[390px]:text-4xl">Turn prospecting into pipeline.</h2>
            <p className="mt-3 text-slate-300">Launch outbound campaigns with AI research, personalization, inbox tracking, and CRM control.</p>
          </div>
          <PricingCheckoutButton plan="Starter">Start Starter</PricingCheckoutButton>
        </div>
      </section>
      <footer className="bg-white px-4 py-8 text-sm text-slate-500 min-[360px]:px-5">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 min-[360px]:flex-row min-[360px]:justify-between">
          <span>OutreachAI</span>
          <span>Privacy | Terms | Security</span>
        </div>
      </footer>
    </main>
  );
}
