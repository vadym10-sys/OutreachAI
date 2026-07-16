import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Terms",
  description: "OutreachAI terms overview for subscription access, acceptable use, review-first outreach and service availability.",
  alternates: { canonical: "/terms" }
};

export default function TermsPage() {
  return (
    <LegalPage
      eyebrow="Terms"
      title="Terms overview"
      description="This page is a product-facing terms overview, not a substitute for a final legal agreement reviewed by counsel."
      sections={[
        {
          title: "Subscription access",
          copy: "Plans and usage limits are based on the current billing model. Access to paid functionality may depend on payment status and configured provider availability."
        },
        {
          title: "User responsibility",
          copy: "Users are responsible for reviewing generated outreach, confirming compliance requirements and approving supported sending actions before contacting prospects."
        },
        {
          title: "Acceptable use",
          copy: "The product should be used for lawful B2B prospecting and customer development workflows, with respect for email, privacy and data-source rules that apply to the user."
        },
        {
          title: "Service changes",
          copy: "Provider availability, plan limits and supported workflow capabilities can change as integrations and backend services evolve."
        }
      ]}
    />
  );
}
