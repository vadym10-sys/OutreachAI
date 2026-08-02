import type { Metadata } from "next";
import { PublicLegalPage } from "@/components/public-legal-page";

export const metadata: Metadata = {
  title: "Privacy Policy | OutreachAI",
  description: "How OutreachAI describes collection, use, and handling of information for the public website and application.",
};

const sections = [
  {
    title: "Information we collect",
    body: [
      "OutreachAI may collect account information that users provide, workspace settings, billing-related status, application activity, and information needed to run lead research, CRM handoff, and reviewed outreach workflows.",
      "When users connect third-party services, the application may receive information required to provide the requested integration. Users control whether to connect those services.",
    ],
  },
  {
    title: "How information is used",
    body: [
      "Information is used to operate the product, authenticate users, maintain workspace state, prepare AI-assisted sales research, support billing flows, diagnose reliability issues, and improve product quality.",
      "OutreachAI is designed around human review. AI-generated outreach remains draft-oriented until a user approves the relevant action in the application.",
    ],
  },
  {
    title: "Service providers",
    body: [
      "OutreachAI may rely on service providers for hosting, authentication, payments, analytics, observability, email connectivity, AI functionality, and similar operational needs. Those providers process information as needed for the configured service.",
      "Current provider categories represented in the codebase include hosting, authentication, payments, email connectivity, observability, product analytics, AI providers, CRM/workspace storage and backup operations.",
    ],
  },
  {
    title: "Data choices",
    body: [
      "Users can update account and workspace information in the application where controls are available. Connected services can be managed through the product settings or through the provider account used to connect them.",
    ],
  },
  {
    title: "Retention and deletion",
    body: [
      "OutreachAI keeps information for as long as it is needed to provide the service, meet operational requirements, resolve disputes, enforce terms, or comply with applicable obligations.",
      "To request deletion or privacy help, contact the support email listed on this site. The request should identify the account or workspace so the owner can verify access before deleting data.",
    ],
  },
  {
    title: "Privacy and security contact",
    body: [
      "Privacy and security requests should be sent to the confirmed support email listed in the public footer and contact section.",
    ],
  },
  {
    title: "Changes",
    body: [
      "This page may be updated as the product changes. The date on the page indicates when the current version was last revised.",
    ],
  },
];

export default function PrivacyPage() {
  return (
    <PublicLegalPage
      activePath="/privacy"
      eyebrow="Privacy"
      title="Privacy Policy"
      summary="A clear overview of the information OutreachAI may process to run accounts, lead intelligence, CRM handoff, billing, and reviewed outreach."
      updated="July 31, 2026"
      sections={sections}
    />
  );
}
