import type { Metadata } from "next";
import { PublicLegalPage } from "@/components/public-legal-page";

export const metadata: Metadata = {
  title: "Terms of Service | OutreachAI",
  description: "Terms for using OutreachAI accounts, AI-assisted sales research, CRM handoff, billing, and reviewed outreach features.",
};

const sections = [
  {
    title: "Use of the service",
    body: [
      "OutreachAI provides software for AI-assisted lead research, explainable sales intelligence, CRM handoff, billing flows, and reviewed outreach workflows. Users are responsible for using the service lawfully and for reviewing outputs before acting on them.",
    ],
  },
  {
    title: "Accounts and access",
    body: [
      "Users are responsible for maintaining access to their account and for activity performed through their workspace. Access to paid or restricted features may depend on authentication, plan status, usage limits, and connected services.",
    ],
  },
  {
    title: "AI-assisted output",
    body: [
      "AI output can be incomplete, inaccurate, or unsuitable for a specific sales situation. Users should verify company information, contact details, outreach copy, and CRM updates before relying on them.",
      "The product is intended to keep generated outreach in a review flow so users can approve, edit, or reject work before sending.",
    ],
  },
  {
    title: "Acceptable use",
    body: [
      "Users must not use OutreachAI to violate law, platform rules, privacy rights, intellectual property rights, anti-spam obligations, or the security of any person, system, or service.",
    ],
  },
  {
    title: "Billing",
    body: [
      "Paid access, trials, plan limits, renewals, cancellations, and payment handling are managed through the billing flow shown in the product. Users should review the displayed plan details before starting or changing paid access.",
      "The billing implementation uses monthly subscription checkout with a 14-day trial. Subscription changes are managed securely in the billing portal according to the active portal configuration.",
    ],
  },
  {
    title: "Availability and changes",
    body: [
      "OutreachAI may change, suspend, or discontinue parts of the service as the product evolves. These terms may also be updated, and the date on this page shows the latest revision.",
    ],
  },
];

export default function TermsPage() {
  return (
    <PublicLegalPage
      activePath="/terms"
      eyebrow="Terms"
      title="Terms of Service"
      summary="Practical terms for using OutreachAI responsibly, including account access, AI-assisted output, reviewed outreach, acceptable use, and billing flows."
      updated="July 31, 2026"
      sections={sections}
    />
  );
}
