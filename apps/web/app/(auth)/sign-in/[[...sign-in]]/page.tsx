import { SignIn } from "@clerk/nextjs";
import Link from "next/link";
import { hasClerkPublishableKey } from "@/lib/env";
import { OAuthProviderButtons } from "@/components/oauth-provider-buttons";

function MissingClerkConfig() {
  return (
    <div className="max-w-md rounded-lg border border-slate-200 bg-white p-6 text-center shadow-soft">
      <h1 className="text-xl font-bold text-ink">Sign in is temporarily unavailable</h1>
      <p className="mt-3 text-sm leading-6 text-slate-600">
        We could not load secure sign in for this session. Please try again shortly.
      </p>
    </div>
  );
}

export default function Page() {
  return (
    <main className="flex min-h-screen items-center justify-center overflow-x-hidden bg-slate-50 px-4 py-6 min-[360px]:px-5">
      {hasClerkPublishableKey ? (
        <div className="w-full max-w-[min(100%,28rem)] overflow-x-auto">
          <OAuthProviderButtons mode="sign-in" />
          <SignIn routing="path" path="/sign-in" signUpUrl="/sign-up" fallbackRedirectUrl="/dashboard" />
          <div className="mt-4 rounded-lg border border-slate-200 bg-white px-4 py-3 text-center text-sm shadow-soft">
            <Link href="/forgot-password" className="font-semibold text-brand">
              Forgot password?
            </Link>
          </div>
        </div>
      ) : (
        <MissingClerkConfig />
      )}
    </main>
  );
}
