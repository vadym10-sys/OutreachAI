import type { Metadata } from "next";
import { PublicLegalPage } from "@/components/public-legal-page";

export const metadata: Metadata = {
  title: "Security | OutreachAI",
  description: "Security practices and user responsibilities for OutreachAI public website and application workflows.",
};

const sections = [
  {
    title: "Security approach",
    body: [
      "OutreachAI is built to separate public pages from authenticated workspace features and to keep sensitive workflow actions behind application access controls. Security work is treated as an ongoing operational responsibility.",
    ],
  },
  {
    title: "Authentication and access",
    body: [
      "Protected product areas require authentication. Users should keep account credentials, connected provider accounts, and workspace access limited to people who need them.",
    ],
  },
  {
    title: "Human approval boundaries",
    body: [
      "AI-assisted sales work is intended to remain reviewable before sensitive actions. Users should verify generated content, recipients, CRM changes, and campaign details before approval.",
      "Generated emails are drafts first. Sending requires an approved email and a verified recipient path in the application.",
    ],
  },
  {
    title: "Data handling",
    body: [
      "Application data may be processed by the systems required to run OutreachAI, including hosting, authentication, payments, observability, connected integrations, and AI functionality. Access should be limited to operational need.",
    ],
  },
  {
    title: "Reporting concerns",
    body: [
      "If you believe you have found a security issue, report it through the confirmed support email listed on this site. Please avoid accessing, changing, deleting, or sharing data that does not belong to you.",
    ],
  },
  {
    title: "No absolute guarantee",
    body: [
      "No internet service can promise perfect security. OutreachAI aims to use reasonable safeguards and improve them as the product changes.",
    ],
  },
];

export default function SecurityPage() {
  return (
    <PublicLegalPage
      activePath="/security"
      eyebrow="Security"
      title="Security"
      summary="A plain-language overview of OutreachAI security boundaries, authenticated access, human approval, data handling, and responsible reporting."
      updated="July 31, 2026"
      sections={sections}
    />
  );
}
