import type { Metadata } from "next";
import { PublicLegalPage } from "@/components/public-legal-page";

export const metadata: Metadata = {
  title: "Privacy Policy | OutreachAI",
  description: "How OutreachAI describes collection, use, and handling of information for the public website and application.",
};

const sections = [
  {
    title: "Information we collect",
    body: (
      <>
        <p>OutreachAI may collect account information that users provide, workspace settings, billing-related status, application activity, and information needed to run lead research, CRM handoff, and reviewed outreach workflows.</p>
        <p>When users connect third-party services, the application may receive information required to provide the requested integration. Users control whether to connect those services.</p>
      </>
    ),
  },
  {
    title: "How information is used",
    body: (
      <>
        <p>Information is used to operate the product, authenticate users, maintain workspace state, prepare AI-assisted sales research, support billing flows, diagnose reliability issues, and improve product quality.</p>
        <p>OutreachAI is designed around human review. AI-generated outreach remains draft-oriented until a user approves the relevant action in the application.</p>
      </>
    ),
  },
  {
    title: "Service providers",
    body: (
      <p>OutreachAI may rely on service providers for hosting, authentication, payments, analytics, observability, email connectivity, AI functionality, and similar operational needs. Those providers process information as needed for the configured service.</p>
    ),
  },
  {
    title: "Data choices",
    body: (
      <p>Users can update account and workspace information in the application where controls are available. Connected services can be managed through the product settings or through the provider account used to connect them.</p>
    ),
  },
  {
    title: "Retention and deletion",
    body: (
      <p>OutreachAI keeps information for as long as it is needed to provide the service, meet operational requirements, resolve disputes, enforce terms, or comply with applicable obligations. Deletion requests are handled through the support or account channel available to the user.</p>
    ),
  },
  {
    title: "Changes",
    body: (
      <p>This page may be updated as the product changes. The date on the page indicates when the current version was last revised.</p>
    ),
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
