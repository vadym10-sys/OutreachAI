"use client";

import { SignIn, SignUp, useAuth, useClerk } from "@clerk/nextjs";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useEffect } from "react";
import { AppBadge, SurfaceCard } from "@/components/design-system";
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
    <SurfaceCard className="w-full max-w-md rounded-[1.75rem] p-6 text-center shadow-raised">
      <h1 className="text-xl font-bold text-ink">{title}</h1>
      <p className="mt-3 text-sm leading-6 text-[var(--ui-text-soft)]">{copy}</p>
    </SurfaceCard>
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
    <main className="flex min-h-screen items-center justify-center overflow-x-hidden bg-[var(--ui-bg)] px-4 py-6 text-[var(--ui-text)] min-[360px]:px-5">
      <SurfaceCard className="w-full max-w-md rounded-[1.75rem] p-6 text-center shadow-raised">
        <AppBadge tone="brand">{t("QA authentication")}</AppBadge>
        <h1 className="mt-4 text-3xl font-black tracking-normal text-[var(--ui-text)]">{isSignUp ? t("Create your account") : t("Welcome back")}</h1>
        <p className="mt-3 text-sm leading-6 text-[var(--ui-text-soft)]">
          {t("This test-only flow is enabled only when the app runs in the isolated Playwright environment.")}
        </p>
        <button type="button" onClick={continueAsQaUser} className="focus-ring mt-6 inline-flex min-h-12 w-full items-center justify-center rounded-full bg-[var(--ui-brand)] px-4 py-2 text-sm font-black text-white shadow-soft">
          {isSignUp ? t("Continue to billing") : t("Continue to workspace")}
        </button>
      </SurfaceCard>
    </main>
  );
}

function AuthLoadingState() {
  const { t } = useI18n();

  return (
    <SurfaceCard className="w-full max-w-md rounded-[1.75rem] p-6 text-center shadow-raised">
      <Loader2 className="mx-auto animate-spin text-brand" size={28} />
      <h1 className="mt-4 text-xl font-black text-[var(--ui-text)]">{t("Preparing secure sign in")}</h1>
      <p className="mt-2 text-sm leading-6 text-[var(--ui-text-soft)]">{t("This usually takes a few seconds.")}</p>
    </SurfaceCard>
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
    <SurfaceCard className="w-full max-w-md rounded-[1.75rem] p-6 text-center shadow-raised">
      <AppBadge tone="success">{t("Account ready")}</AppBadge>
      <h1 className="mt-4 text-3xl font-black tracking-normal text-[var(--ui-text)]">
        {isSignUp ? t("You are already signed in") : t("You are already signed in")}
      </h1>
      <p className="mt-3 text-sm leading-6 text-[var(--ui-text-soft)]">
        {isSignUp
          ? t("To create a different account, sign out first. To start your 14-day trial, continue to billing.")
          : t("Continue to your workspace, or sign out if you want to use another account.")}
      </p>
      <div className="mt-6 grid gap-3">
        <Link href={isSignUp ? "/dashboard/billing" : "/dashboard"} className="focus-ring inline-flex min-h-12 items-center justify-center rounded-full bg-[var(--ui-brand)] px-4 py-2 text-sm font-black text-white shadow-soft">
          {isSignUp ? t("Start 14-day trial") : t("Open workspace")}
        </Link>
        <button type="button" onClick={switchAccount} className="focus-ring inline-flex min-h-12 items-center justify-center rounded-full border border-[var(--ui-border)] bg-white px-4 py-2 text-sm font-black text-[var(--ui-text)] shadow-sm">
          {isSignUp ? t("Sign out and create a new account") : t("Sign out and use another account")}
        </button>
      </div>
    </SurfaceCard>
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
    socialButtonsBlockButton: "min-h-12 rounded-xl border border-[var(--ui-border)] bg-white text-sm font-bold text-[var(--ui-text)] shadow-sm",
    socialButtonsProviderIcon: "size-5",
    dividerRow: "my-6",
    form: "w-full",
    formField: "w-full",
    formFieldLabel: "text-sm font-bold text-[var(--ui-text)]",
    formFieldInput: "min-h-12 w-full rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface)] text-base text-[var(--ui-text)] focus:border-[var(--ui-brand)] focus:ring-2 focus:ring-[var(--ui-focus-ring)]",
    formButtonPrimary: "min-h-12 w-full rounded-full bg-[var(--ui-brand)] text-sm font-black text-white shadow-soft hover:bg-[var(--ui-brand-strong)]",
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
      <main className="flex min-h-screen items-center justify-center overflow-x-hidden bg-[var(--ui-bg)] px-4 py-6 min-[360px]:px-5">
        <AuthLoadingState />
      </main>
    );
  }

  if (isSignedIn) {
    return (
      <main className="flex min-h-screen items-center justify-center overflow-x-hidden bg-[var(--ui-bg)] px-4 py-6 min-[360px]:px-5">
        <AlreadySignedInState mode={mode} />
      </main>
    );
  }

  return (
    <main className="grid min-h-screen items-center overflow-x-hidden bg-[var(--ui-bg)] px-4 py-6 text-[var(--ui-text)] min-[360px]:px-5 lg:grid-cols-[1fr_minmax(25rem,30rem)_1fr]">
      <section className="hidden max-w-xl lg:block">
        <Link href="/" className="text-lg font-black text-[var(--ui-brand)]">OutreachAI</Link>
        <h2 className="mt-8 text-5xl font-black leading-[0.96] tracking-normal text-[var(--ui-text)]">{t("Find the right companies. Understand why they will buy. Reach out with AI.")}</h2>
        <p className="mt-5 max-w-lg text-base leading-7 text-[var(--ui-text-soft)]">{t("Your workspace keeps lead search, AI research, generated outreach, CRM handoff and replies in one guided flow.")}</p>
        <div className="mt-6 rounded-[1.25rem] border border-[var(--ui-border)] bg-white p-4 text-sm font-bold text-danger shadow-sm">
          {t("AI prepares drafts only. Users approve before sending.")}
        </div>
      </section>
      <div className={`${isSignUp ? "signup" : "signin"}-auth-card w-full max-w-[min(100%,30rem)] overflow-hidden rounded-[1.75rem] border border-[var(--ui-border)] bg-white p-5 text-[var(--ui-text)] shadow-raised sm:p-6 lg:col-start-2`}>
        <div className="mb-6 text-center">
          <p className="text-base font-black text-[var(--ui-brand)]">OutreachAI</p>
          <h1 className="mt-6 text-3xl font-black tracking-normal text-[var(--ui-text)]">{isSignUp ? t("Create your account") : t("Welcome back")}</h1>
          <p className="mt-2 text-sm leading-6 text-[var(--ui-text-soft)]">
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
            <div className="mt-4 rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-surface)] px-4 py-3 text-center text-sm shadow-sm">
              <Link href="/forgot-password" className="font-black text-[var(--ui-brand)]">
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
        <main className="flex min-h-screen items-center justify-center overflow-x-hidden bg-[var(--ui-bg)] px-4 py-6 min-[360px]:px-5">
          <MissingClerkConfig mode={mode} />
        </main>
      )}
    </>
  );
}
