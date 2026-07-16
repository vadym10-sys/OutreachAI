import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Privacy",
  description: "OutreachAI privacy overview for workspace data, CRM records, AI-generated content and billing information.",
  alternates: { canonical: "/privacy" }
};

export default function PrivacyPage() {
  return (
    <LegalPage
      eyebrow="Privacy"
      title="Privacy overview"
      description="This page summarizes how the product interface treats workspace and outbound data. It should be reviewed by counsel before being used as a full legal policy."
      sections={[
        {
          title: "Workspace information",
          copy: "OutreachAI stores workspace identity, company profile, target market settings and user-managed CRM records so the product can guide lead search and outreach workflows."
        },
        {
          title: "Prospect and campaign data",
          copy: "Company, contact, email draft, campaign and reply data are used to present prioritization, AI analysis and next actions inside the authenticated workspace."
        },
        {
          title: "AI-generated content",
          copy: "AI analysis and outreach drafts are generated from saved company context and configured research data. The UI labels unavailable or incomplete states rather than fabricating missing facts."
        },
        {
          title: "Billing information",
          copy: "Subscription state, limits, usage and invoices are shown through the existing billing endpoints and payment provider integration."
        }
      ]}
    />
  );
}
