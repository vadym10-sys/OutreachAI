import { LandingPage } from "@/components/landing-page";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "OutreachAI - AI outbound workspace for B2B teams",
  description: "Find B2B companies, research opportunities with AI, generate review-ready outreach, manage campaigns and track replies from one workspace.",
  alternates: {
    canonical: "/"
  },
  openGraph: {
    title: "OutreachAI - AI outbound workspace",
    description: "AI outbound workflow for lead search, company research, personalized outreach, campaigns and replies.",
    url: "/"
  }
};

export default function Home() {
  return <LandingPage />;
}
