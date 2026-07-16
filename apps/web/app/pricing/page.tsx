import Home from '../page';
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Pricing",
  description: "OutreachAI Starter, Pro and Agency plan limits for lead search, AI generations, email sends, campaigns and workspaces.",
  alternates: {
    canonical: "/pricing"
  }
};

export default function PricingPage() {
  return <Home />;
}
