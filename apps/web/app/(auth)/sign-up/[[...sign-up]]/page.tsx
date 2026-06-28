import { SignUp } from "@clerk/nextjs";
import { hasClerkPublishableKey } from "@/lib/env";
import { OAuthProviderButtons } from "@/components/oauth-provider-buttons";

function MissingClerkConfig() {
  return (
    <div className="max-w-md rounded-lg border border-slate-200 bg-white p-6 text-center shadow-soft">
      <h1 className="text-xl font-bold text-ink">Sign up is temporarily unavailable</h1>
      <p className="mt-3 text-sm leading-6 text-slate-600">
        We could not load secure account creation for this session. Please try again shortly.
      </p>
    </div>
  );
}

export default function Page() {
  return (
    <main className="flex min-h-screen items-center justify-center overflow-x-hidden bg-slate-50 px-4 py-6 min-[360px]:px-5">
      {hasClerkPublishableKey ? (
        <div className="w-full max-w-[min(100%,28rem)] overflow-x-auto">
          <OAuthProviderButtons mode="sign-up" />
          <SignUp routing="path" path="/sign-up" signInUrl="/sign-in" fallbackRedirectUrl="/dashboard" />
        </div>
      ) : (
        <MissingClerkConfig />
      )}
    </main>
  );
}
