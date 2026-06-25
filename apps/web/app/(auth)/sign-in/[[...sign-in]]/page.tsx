import { SignIn } from "@clerk/nextjs";
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
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-5">
      {hasClerkPublishableKey ? (
        <SignIn routing="path" path="/sign-in" signUpUrl="/sign-up" fallbackRedirectUrl="/dashboard" />
      ) : (
        <MissingClerkConfig />
      )}
    </main>
  );
}
