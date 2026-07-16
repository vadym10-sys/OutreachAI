import { AuthPageClient } from "@/components/auth-page-client";
import { hasClerkPublishableKey, isClerkE2EBypass } from "@/lib/env";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Create account",
  description: "Create an OutreachAI workspace for B2B lead search, AI company research, review-ready outreach and campaign tracking.",
  alternates: { canonical: "/sign-up" }
};

export default function Page() {
  return <AuthPageClient mode="sign-up" clerkEnabled={hasClerkPublishableKey && !isClerkE2EBypass} />;
}
