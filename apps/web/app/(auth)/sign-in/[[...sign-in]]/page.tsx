import { SignIn } from "@clerk/nextjs";
import Link from "next/link";
import { hasClerkPublishableKey } from "@/lib/env";

function MissingClerkConfig() {
  return (
    <div className="max-w-md rounded-lg border border-slate-200 bg-white p-6 text-center shadow-soft">
      <h1 className="text-xl font-bold text-ink">Authentication is not configured</h1>
      <p className="mt-3 text-sm leading-6 text-slate-600">
        Add Clerk environment variables to enable sign in for this deployment.
      </p>
    </div>
  );
}

export default function Page() {
  return (
    <main className="flex min-h-screen items-center justify-center overflow-x-hidden bg-slate-50 px-4 py-6 min-[360px]:px-5">
      {hasClerkPublishableKey ? (
        <div className="w-full max-w-[min(100%,28rem)] overflow-x-auto">
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
