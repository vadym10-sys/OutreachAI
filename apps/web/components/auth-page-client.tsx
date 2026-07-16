"use client";

import { SignIn, SignUp, useAuth, useClerk } from "@clerk/nextjs";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowRight, CheckCircle2, Loader2, ShieldCheck, Sparkles } from "lucide-react";
import { useEffect } from "react";
import { AppBadge } from "@/components/design-system";
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

function AuthProductPanel({ mode }: { mode: AuthMode }) {
  const { t } = useI18n();
  const isSignUp = mode === "sign-up";
  return (
    <section className="hidden min-h-[42rem] rounded-[1.5rem] bg-ink p-6 text-white shadow-2xl lg:flex lg:flex-col lg:justify-between">
      <div>
        <Link href="/" className="inline-flex min-h-11 items-center gap-2 text-lg font-black">
          <span className="grid size-9 place-items-center rounded-xl bg-white text-sm text-ink">OA</span>
          OutreachAI
        </Link>
        <div className="mt-12">
          <AppBadge tone="dark">{t(isSignUp ? "Start review-first outbound" : "Welcome back")}</AppBadge>
          <h1 className="mt-5 text-4xl font-black leading-tight">
            {t(isSignUp ? "Create a workspace that turns research into reviewed outreach." : "Return to your AI outbound control room.")}
          </h1>
          <p className="mt-4 text-base leading-7 text-slate-300">
            {t("Find companies, analyze opportunities, generate safe drafts, review campaigns and track replies without switching tools.")}
          </p>
        </div>
      </div>
      <div className="grid gap-3">
        {[
          ["Real workspace data", "Protected routes require authenticated access."],
          ["Review-first safety", "Generated outreach waits for approval before supported sends."],
          ["Clear next action", "Dashboard starts with the highest leverage workflow."],
        ].map(([title, copy]) => (
          <article key={title} className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="flex gap-3">
              <CheckCircle2 size={19} className="mt-1 shrink-0 text-teal-200" />
              <div>
                <p className="font-black text-white">{t(title)}</p>
                <p className="mt-1 text-sm leading-6 text-slate-300">{t(copy)}</p>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
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
    socialButtonsBlockButton: "min-h-12 rounded-xl border border-slate-300 text-sm font-bold text-ink shadow-sm",
    socialButtonsProviderIcon: "size-5",
    dividerRow: "my-6",
    form: "w-full",
    formField: "w-full",
    formFieldInput: "min-h-12 w-full rounded-xl border-slate-300 text-sm font-semibold",
    formButtonPrimary: "min-h-12 w-full rounded-xl bg-brand text-sm font-black text-white hover:bg-teal-700",
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
    <main className="min-h-screen overflow-x-hidden bg-slate-50 px-4 py-6 min-[360px]:px-5 lg:py-8">
      <div className="mx-auto grid min-h-[calc(100dvh-3rem)] w-full max-w-6xl gap-6 lg:grid-cols-[1fr_28rem] lg:items-stretch">
        <AuthProductPanel mode={mode} />
        <section className="flex min-h-full items-center justify-center">
          <div className={`${isSignUp ? "signup" : "signin"}-auth-card w-full max-w-[min(100%,28rem)] overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-soft sm:p-7`}>
            <Link href="/" className="mb-6 inline-flex min-h-11 items-center gap-2 font-black text-ink lg:hidden">
              <span className="grid size-9 place-items-center rounded-xl bg-ink text-sm text-white">OA</span>
              OutreachAI
            </Link>
            <div className="mb-6">
              <AppBadge tone="brand">{isSignUp ? t("Start finding leads") : t("Secure sign in")}</AppBadge>
              <h1 className="mt-4 text-3xl font-black tracking-tight text-ink">{isSignUp ? t("Create your OutreachAI workspace") : t("Welcome back")}</h1>
              <p className="mt-3 text-sm leading-6 text-slate-600">
                {isSignUp ? t("Start with Google, Apple, or your work email. You will review every outreach action before it moves forward.") : t("Continue with Google, Apple, or your work email to open your workspace.")}
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
                <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm">
                  <Link href="/forgot-password" className="inline-flex min-h-11 items-center justify-between rounded-xl bg-white px-4 font-black text-brand shadow-sm">
                    {t("Forgot password?")} <ArrowRight size={16} />
                  </Link>
                  <div className="flex gap-2 text-slate-600">
                    <ShieldCheck size={17} className="mt-0.5 shrink-0 text-brand" />
                    <span>{t("Protected workspace routes require an active authenticated session.")}</span>
                  </div>
                </div>
              </>
            )}
            <div className="mt-6 flex gap-2 rounded-2xl border border-teal-100 bg-teal-50 p-4 text-sm leading-6 text-teal-950">
              <Sparkles size={18} className="mt-0.5 shrink-0 text-brand" />
              <p>{t("OutreachAI keeps AI generation, campaign review and sending controls explicit so customer-facing actions stay intentional.")}</p>
            </div>
          </div>
        </section>
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
