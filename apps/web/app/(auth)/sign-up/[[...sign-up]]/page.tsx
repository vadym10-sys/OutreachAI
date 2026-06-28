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
        <div className="signup-auth-card w-full max-w-[min(100%,28rem)] overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-soft sm:p-6">
          <div className="mb-6 text-center">
            <h1 className="text-2xl font-bold tracking-tight text-ink">Create your account</h1>
            <p className="mt-2 text-sm leading-6 text-slate-600">Start with Google, Apple, or your work email.</p>
          </div>
          <OAuthProviderButtons mode="sign-up" embedded />
          <div className="my-6 flex items-center gap-4 text-sm text-slate-500" aria-hidden="true">
            <span className="h-px flex-1 bg-slate-200" />
            <span>or</span>
            <span className="h-px flex-1 bg-slate-200" />
          </div>
          <div>
            <SignUp
              routing="path"
              path="/sign-up"
              signInUrl="/sign-in"
              fallbackRedirectUrl="/dashboard"
              appearance={{
                elements: {
                  rootBox: "w-full",
                  cardBox: "w-full border-0 bg-transparent p-0 shadow-none",
                  card: "w-full border-0 bg-transparent p-0 shadow-none",
                  main: "w-full",
                  header: "hidden",
                  headerTitle: "hidden",
                  headerSubtitle: "hidden",
                  socialButtons: "hidden",
                  socialButtonsBlockButton: "hidden",
                  socialButtonsProviderIcon: "hidden",
                  dividerRow: "hidden",
                  form: "w-full",
                  formField: "w-full",
                  formFieldInput: "min-h-11 w-full rounded-md border-slate-300",
                  formButtonPrimary: "min-h-11 w-full rounded-md bg-ink text-sm font-semibold text-white hover:bg-slate-900",
                  footer: "bg-transparent"
                }
              }}
            />
          </div>
        </div>
      ) : (
        <MissingClerkConfig />
      )}
    </main>
  );
}
