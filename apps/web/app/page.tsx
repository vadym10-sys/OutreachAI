import { CheckCircle2, Globe2, Mail, Search, ShieldCheck, TrendingUp, Users } from "lucide-react";
import { PrimaryLink, SecondaryLink } from "@/components/button";

const features = [
  { title: "Lead Finder", copy: "Find companies by niche, country, and city with verified enrichment fields.", Icon: Search },
  { title: "AI Website Analyzer", copy: "Detect services, strengths, weak points, and outreach angles from prospect websites.", Icon: Globe2 },
  { title: "Personalization Engine", copy: "Generate cold emails, follow-ups, and A/B variants using company context.", Icon: Mail },
  { title: "Campaign Manager", copy: "Launch, pause, schedule, and automate follow-ups across outbound sequences.", Icon: TrendingUp },
  { title: "CRM", copy: "Track every lead from New to Closed with notes, filters, and search.", Icon: Users },
  { title: "Security", copy: "Rate limiting, audit logs, JWT auth, encrypted secrets, and production guardrails.", Icon: ShieldCheck }
];

const pricing = [
  { name: "Starter", price: "$49", desc: "For solo operators", items: ["1,000 leads/month", "2 inboxes", "Basic AI personalization"] },
  { name: "Pro", price: "$99", desc: "For growing teams", items: ["5,000 leads/month", "10 inboxes", "A/B testing", "CRM automation"] },
  { name: "Agency", price: "$299", desc: "For client delivery", items: ["25,000 leads/month", "Unlimited campaigns", "Priority support", "Admin controls"] }
];

export default function Home() {
  const schema = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "OutreachAI",
    applicationCategory: "BusinessApplication",
    offers: pricing.map(({ name, price }) => ({ "@type": "Offer", name, price: price.replace("$", ""), priceCurrency: "USD" }))
  };

  return (
    <main className="bg-slate-50 text-ink">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }} />
      <section className="border-b border-slate-200 bg-white">
        <nav className="mx-auto flex max-w-7xl items-center justify-between px-5 py-5">
          <span className="text-xl font-bold">OutreachAI</span>
          <div className="hidden items-center gap-6 text-sm font-medium text-slate-600 md:flex">
            <a href="#features">Features</a>
            <a href="#pricing">Pricing</a>
            <a href="#faq">FAQ</a>
          </div>
          <SecondaryLink href="/sign-in">Login</SecondaryLink>
        </nav>
        <div className="mx-auto grid max-w-7xl gap-10 px-5 pb-16 pt-10 lg:grid-cols-[1.05fr_0.95fr] lg:pb-20 lg:pt-16">
          <div>
            <p className="mb-4 inline-flex rounded-full border border-teal-200 bg-teal-50 px-3 py-1 text-sm font-semibold text-brand">AI outbound system for B2B revenue teams</p>
            <h1 className="max-w-4xl text-5xl font-bold tracking-normal text-ink md:text-7xl">OutreachAI</h1>
            <p className="mt-6 max-w-2xl text-xl leading-8 text-slate-600">Find qualified companies, analyze their websites, generate personal outreach, run campaigns, and manage replies from one production-ready CRM.</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <PrimaryLink href="/sign-up">Start 14-day trial</PrimaryLink>
              <SecondaryLink href="/dashboard">View dashboard</SecondaryLink>
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-900 p-5 text-white shadow-soft">
            <div className="grid grid-cols-2 gap-3">
              {["Leads found", "Emails sent", "Open rate", "Replies"].map((label, index) => (
                <div key={label} className="rounded-md bg-white/10 p-4">
                  <p className="text-sm text-slate-300">{label}</p>
                  <p className="mt-3 text-3xl font-bold">{["12,480", "48,210", "64%", "2,136"][index]}</p>
                </div>
              ))}
            </div>
            <div className="mt-4 rounded-md bg-white p-4 text-ink">
              <p className="text-sm font-semibold text-brand">AI recommendation</p>
              <p className="mt-2 text-sm text-slate-600">Construction firms in Austin with outdated project pages convert 2.4x better with a website audit angle.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-5 py-16">
        <div className="grid gap-8 md:grid-cols-3">
          {["Manual prospecting is slow", "Generic emails get ignored", "Replies are scattered"].map((title) => (
            <div key={title}>
              <h2 className="text-2xl font-bold">{title}</h2>
              <p className="mt-3 text-slate-600">Teams lose hours switching between scraping tools, spreadsheets, AI prompts, inboxes, and CRMs.</p>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-white py-16">
        <div className="mx-auto max-w-7xl px-5">
          <h2 className="text-4xl font-bold">A complete outbound operating system</h2>
          <p className="mt-4 max-w-2xl text-slate-600">OutreachAI combines data, AI, email operations, analytics, billing, and administration into a single SaaS workflow.</p>
          <div id="features" className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {features.map(({ title, copy, Icon }) => (
              <div key={title} className="rounded-lg border border-slate-200 p-5">
                <Icon className="text-brand" size={24} aria-hidden="true" />
                <h3 className="mt-4 text-lg font-bold">{title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">{copy}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-5 py-16">
        <h2 className="text-4xl font-bold">Trusted by outbound teams</h2>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {["We booked 31 qualified real estate calls in month one.", "The website analyzer writes better first lines than our SDRs.", "Agency reporting finally matches what clients ask for."].map((quote) => (
            <blockquote key={quote} className="rounded-lg border border-slate-200 bg-white p-5 text-slate-700">{quote}</blockquote>
          ))}
        </div>
      </section>

      <section id="pricing" className="bg-white py-16">
        <div className="mx-auto max-w-7xl px-5">
          <h2 className="text-4xl font-bold">Pricing</h2>
          <p className="mt-3 text-slate-600">All plans include a 14-day free trial.</p>
          <div className="mt-8 grid gap-4 lg:grid-cols-3">
            {pricing.map(({ name, price, desc, items }) => (
              <div key={name} className="rounded-lg border border-slate-200 p-6">
                <h3 className="text-xl font-bold">{name}</h3>
                <p className="mt-3 text-4xl font-bold">{price}<span className="text-base font-medium text-slate-500">/mo</span></p>
                <p className="mt-2 text-slate-600">{desc}</p>
                <ul className="mt-5 space-y-3 text-sm text-slate-700">
                  {items.map((item) => (
                    <li key={item} className="flex gap-2"><CheckCircle2 className="text-brand" size={18} />{item}</li>
                  ))}
                </ul>
                <div className="mt-6"><PrimaryLink href="/sign-up">Start trial</PrimaryLink></div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="faq" className="mx-auto max-w-4xl px-5 py-16">
        <h2 className="text-4xl font-bold">FAQ</h2>
        {["Can I cancel anytime?", "Does it support Google login?", "Can agencies manage clients?", "Is billing handled by Stripe?"].map((q) => (
          <details key={q} className="mt-4 rounded-lg border border-slate-200 bg-white p-5">
            <summary className="cursor-pointer font-semibold">{q}</summary>
            <p className="mt-3 text-slate-600">Yes. OutreachAI is built with production SaaS defaults for global customers, subscriptions, and secure access control.</p>
          </details>
        ))}
      </section>

      <section className="bg-ink px-5 py-16 text-white">
        <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-6 md:flex-row md:items-center">
          <div>
            <h2 className="text-4xl font-bold">Turn prospecting into pipeline.</h2>
            <p className="mt-3 text-slate-300">Launch outbound campaigns with AI research, personalization, inbox tracking, and CRM control.</p>
          </div>
          <PrimaryLink href="/sign-up">Start free trial</PrimaryLink>
        </div>
      </section>
      <footer className="bg-white px-5 py-8 text-sm text-slate-500">
        <div className="mx-auto flex max-w-7xl justify-between">
          <span>OutreachAI</span>
          <span>Privacy | Terms | Security</span>
        </div>
      </footer>
    </main>
  );
}
