import { AuthPageClient } from "@/components/auth-page-client";
import { hasClerkPublishableKey, isClerkE2EBypass } from "@/lib/env";

export default function Page() {
  return <AuthPageClient mode="sign-up" clerkEnabled={hasClerkPublishableKey && !isClerkE2EBypass} />;
}
