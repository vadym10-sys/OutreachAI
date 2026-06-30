"use client";

import { SignIn, SignUp } from "@clerk/nextjs";
import Link from "next/link";
import { OAuthProviderButtons } from "@/components/oauth-provider-buttons";
import { useI18n } from "@/lib/i18n/provider";

type AuthMode = "sign-in" | "sign-up";

function MissingClerkConfig({ mode }: { mode: AuthMode }) {
  const { t } = useI18n();
  const title = mode === "sign-up" ? t("Sign up is temporarily unavailable") : t("Sign in is temporarily unavailable");
  const copy = mode === "sign-up"
    ? t("Secure account creation is temporarily unavailable. Please try again shortly.")
    : t("Secure sign in is temporarily unavailable. Please try again shortly.");

  return (
    <div className="max-w-md rounded-lg border border-slate-200 bg-white p-6 text-center shadow-soft">
      <h1 className="text-xl font-bold text-ink">{title}</h1>
      <p className="mt-3 text-sm leading-6 text-slate-600">{copy}</p>
    </div>
  );
}

const clerkAppearance = {
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
    footer: "hidden"
  }
};

export function AuthPageClient({ mode, clerkEnabled }: { mode: AuthMode; clerkEnabled: boolean }) {
  const { t } = useI18n();
  const isSignUp = mode === "sign-up";

  return (
    <main className="flex min-h-screen items-center justify-center overflow-x-hidden bg-slate-50 px-4 py-6 min-[360px]:px-5">
      {clerkEnabled ? (
        <div className={`${isSignUp ? "signup" : "signin"}-auth-card w-full max-w-[min(100%,28rem)] overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-soft sm:p-6`}>
          <div className="mb-6 text-center">
            <h1 className="text-2xl font-bold tracking-tight text-ink">{isSignUp ? t("Create your account") : t("Welcome back")}</h1>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              {isSignUp ? t("Start with Google, Apple, or your work email.") : t("Continue with Google, Apple, or your work email.")}
            </p>
          </div>
          <OAuthProviderButtons mode={mode} embedded />
          <div className="my-6 flex items-center gap-4 text-sm text-slate-500" aria-hidden="true">
            <span className="h-px flex-1 bg-slate-200" />
            <span>{t("or")}</span>
            <span className="h-px flex-1 bg-slate-200" />
          </div>
          {isSignUp ? (
            <SignUp
              routing="path"
              path="/sign-up"
              signInUrl="/sign-in"
              fallbackRedirectUrl="/dashboard"
              appearance={clerkAppearance}
            />
          ) : (
            <>
              <SignIn
                routing="path"
                path="/sign-in"
                signUpUrl="/sign-up"
                fallbackRedirectUrl="/dashboard"
                appearance={clerkAppearance}
              />
              <div className="mt-4 rounded-lg border border-slate-200 bg-white px-4 py-3 text-center text-sm shadow-soft">
                <Link href="/forgot-password" className="font-semibold text-brand">
                  {t("Forgot password?")}
                </Link>
              </div>
            </>
          )}
        </div>
      ) : (
        <MissingClerkConfig mode={mode} />
      )}
    </main>
  );
}
