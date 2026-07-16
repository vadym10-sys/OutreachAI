"use client";

import { SignIn, SignUp, useAuth, useClerk } from "@clerk/nextjs";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useEffect } from "react";
import { useI18n } from "@/lib/i18n/provider";
import { e2eUserEmail } from "@/lib/env";

type AuthMode = "sign-in" | "sign-up";
const pendingPlanKey = "outreachai.pendingPlan";
const planNames = ["Starter", "Pro", "Agency"] as const;
const qaAuthEnabled = process.env.NEXT_PUBLIC_APP_ENV === "test"
  && process.env.NEXT_PUBLIC_CLERK_E2E_BYPASS === "true"
  && (process.env.NEXT_PUBLIC_API_URL === "http://127.0.0.1:8000" || process.env.NEXT_PUBLIC_API_URL === "http://localhost:8000");

function isPlan(value: string | null): value is typeof planNames[number] {
  return Boolean(value && planNames.includes(value as typeof planNames[number]));
}

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

function QaAuthPage({ mode }: { mode: AuthMode }) {
  const { t } = useI18n();
  const isSignUp = mode === "sign-up";

  function continueAsQaUser() {
    window.localStorage.setItem("outreachai.e2eSignedOut", "false");
    window.localStorage.setItem("outreachai.e2eUserEmail", e2eUserEmail);
    window.location.assign(isSignUp ? "/dashboard/billing" : "/dashboard");
  }

  return (
    <main className="flex min-h-screen items-center justify-center overflow-x-hidden bg-slate-50 px-4 py-6 min-[360px]:px-5">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-soft">
        <p className="text-sm font-bold uppercase tracking-wide text-brand">{t("QA authentication")}</p>
        <h1 className="mt-3 text-2xl font-bold tracking-tight text-ink">{isSignUp ? t("Create your account") : t("Welcome back")}</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          {t("This test-only flow is enabled only when the app runs in the isolated Playwright environment.")}
        </p>
        <button type="button" onClick={continueAsQaUser} className="focus-ring mt-6 inline-flex min-h-11 w-full items-center justify-center rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white">
          {isSignUp ? t("Continue to billing") : t("Continue to workspace")}
        </button>
      </div>
    </main>
  );
}

function AuthLoadingState() {
  const { t } = useI18n();

  return (
    <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-soft">
      <Loader2 className="mx-auto animate-spin text-brand" size={28} />
      <h1 className="mt-4 text-xl font-bold text-ink">{t("Preparing secure sign in")}</h1>
      <p className="mt-2 text-sm leading-6 text-slate-600">{t("This usually takes a few seconds.")}</p>
    </div>
  );
}

function AlreadySignedInState({ mode }: { mode: AuthMode }) {
  const { t } = useI18n();
  const { signOut } = useClerk();
  const isSignUp = mode === "sign-up";

  async function switchAccount() {
    await signOut({ redirectUrl: isSignUp ? "/sign-up" : "/sign-in" });
  }

  return (
    <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-soft">
      <p className="text-sm font-bold uppercase tracking-wide text-brand">{t("Account ready")}</p>
      <h1 className="mt-3 text-2xl font-bold tracking-tight text-ink">
        {isSignUp ? t("You are already signed in") : t("You are already signed in")}
      </h1>
      <p className="mt-3 text-sm leading-6 text-slate-600">
        {isSignUp
          ? t("To create a different account, sign out first. To start your 14-day trial, continue to billing.")
          : t("Continue to your workspace, or sign out if you want to use another account.")}
      </p>
      <div className="mt-6 grid gap-3">
        <Link href={isSignUp ? "/dashboard/billing" : "/dashboard"} className="focus-ring inline-flex min-h-11 items-center justify-center rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white">
          {isSignUp ? t("Start 14-day trial") : t("Open workspace")}
        </Link>
        <button type="button" onClick={switchAccount} className="focus-ring inline-flex min-h-11 items-center justify-center rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-ink">
          {isSignUp ? t("Sign out and create a new account") : t("Sign out and use another account")}
        </button>
      </div>
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
    socialButtonsBlockButton: "min-h-11 rounded-md border border-slate-300 text-sm font-semibold text-ink",
    socialButtonsProviderIcon: "size-5",
    dividerRow: "my-6",
    form: "w-full",
    formField: "w-full",
    formFieldInput: "min-h-11 w-full rounded-md border-slate-300",
    formButtonPrimary: "min-h-11 w-full rounded-md bg-ink text-sm font-semibold text-white hover:bg-slate-900",
    footer: "hidden"
  }
};

function ClerkAuthPage({ mode }: { mode: AuthMode }) {
  const { t } = useI18n();
  const { isLoaded, isSignedIn } = useAuth();
  const searchParams = useSearchParams();
  const isSignUp = mode === "sign-up";
  const selectedPlan = isPlan(searchParams.get("plan")) ? searchParams.get("plan") : null;
  const authCompleteUrl = selectedPlan ? "/dashboard/billing" : "/dashboard";

  useEffect(() => {
    if (!selectedPlan) return;
    try {
      window.localStorage.setItem(pendingPlanKey, selectedPlan);
    } catch {
      // Some private mobile browsers block storage. Registration should still work.
    }
  }, [selectedPlan]);

  if (!isLoaded) {
    return (
      <main className="flex min-h-screen items-center justify-center overflow-x-hidden bg-slate-50 px-4 py-6 min-[360px]:px-5">
        <AuthLoadingState />
      </main>
    );
  }

  if (isSignedIn) {
    return (
      <main className="flex min-h-screen items-center justify-center overflow-x-hidden bg-slate-50 px-4 py-6 min-[360px]:px-5">
        <AlreadySignedInState mode={mode} />
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center overflow-x-hidden bg-slate-50 px-4 py-6 min-[360px]:px-5">
      <div className={`${isSignUp ? "signup" : "signin"}-auth-card w-full max-w-[min(100%,28rem)] overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-soft sm:p-6`}>
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold tracking-tight text-ink">{isSignUp ? t("Create your account") : t("Welcome back")}</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            {isSignUp ? t("Start with Google, Apple, or your work email.") : t("Continue with Google, Apple, or your work email.")}
          </p>
        </div>
        {isSignUp ? (
          <SignUp
            routing="path"
            path="/sign-up"
            signInUrl="/sign-in"
            fallbackRedirectUrl={authCompleteUrl}
            forceRedirectUrl={authCompleteUrl}
            appearance={clerkAppearance}
          />
        ) : (
          <>
            <SignIn
              routing="path"
              path="/sign-in"
              signUpUrl="/sign-up"
              fallbackRedirectUrl={authCompleteUrl}
              forceRedirectUrl={authCompleteUrl}
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
    </main>
  );
}

export function AuthPageClient({ mode, clerkEnabled }: { mode: AuthMode; clerkEnabled: boolean }) {
  if (qaAuthEnabled) {
    return <QaAuthPage mode={mode} />;
  }

  return (
    <>
      {clerkEnabled ? (
        <ClerkAuthPage mode={mode} />
      ) : (
        <main className="flex min-h-screen items-center justify-center overflow-x-hidden bg-slate-50 px-4 py-6 min-[360px]:px-5">
          <MissingClerkConfig mode={mode} />
        </main>
      )}
    </>
  );
}
