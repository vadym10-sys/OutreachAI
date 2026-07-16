import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Security",
  description: "How OutreachAI approaches authentication, review-first sending, workspace isolation and provider availability.",
  alternates: { canonical: "/security" }
};

export default function SecurityPage() {
  return (
    <LegalPage
      eyebrow="Security"
      title="Security and safety controls"
      description="OutreachAI is designed around authenticated workspaces, review-first outreach and transparent operational states."
      sections={[
        {
          title: "Authentication",
          copy: "Production access uses Clerk authentication. Protected dashboard routes redirect signed-out visitors to sign in before workspace data is shown."
        },
        {
          title: "Review-first outreach",
          copy: "AI can generate recommendations and drafts, but sending and campaign actions remain explicit user actions in the supported workflows."
        },
        {
          title: "Workspace data",
          copy: "The app requests workspace-scoped data through existing backend endpoints. The UI does not use production mock data for customer workspaces."
        },
        {
          title: "Provider availability",
          copy: "When a configured data, billing or email provider is unavailable, the interface should show an unavailable, loading, empty or error state instead of inventing results."
        }
      ]}
    />
  );
}
