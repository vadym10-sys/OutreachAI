import { AuthPageClient } from "@/components/auth-page-client";
import { hasClerkPublishableKey, isClerkE2EBypass } from "@/lib/env";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to OutreachAI to review leads, company research, AI analysis, campaigns, inbox, billing and workspace settings.",
  alternates: { canonical: "/sign-in" }
};

export default function Page() {
  return <AuthPageClient mode="sign-in" clerkEnabled={hasClerkPublishableKey && !isClerkE2EBypass} />;
}
