import { AuthenticateWithRedirectCallback } from "@clerk/nextjs";
import { hasClerkPublishableKey } from "@/lib/env";

function SignInUnavailable() {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
      Secure sign in is temporarily unavailable. Please try again shortly.
    </div>
  );
}

export default function SSOCallbackPage() {
  return (
    <main className="flex min-h-screen items-center justify-center overflow-x-hidden bg-slate-50 px-4 py-6">
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 text-center shadow-soft">
        <h1 className="text-xl font-bold text-ink">Completing sign in</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">Securely finishing your sign in.</p>
        <div className="mt-5">
          {hasClerkPublishableKey ? <AuthenticateWithRedirectCallback /> : <SignInUnavailable />}
        </div>
      </div>
    </main>
  );
}
