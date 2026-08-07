"use client";

import { SignIn, SignUp, useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Loader2, Mail } from "lucide-react";
import { useEffect } from "react";
import { AppBadge, SurfaceCard } from "@/components/design-system";
import { safeAuthRedirectUrl } from "@/lib/auth-redirect";
import { useI18n } from "@/lib/i18n/provider";
import { e2eUserEmail } from "@/lib/env";
import { planByName, selectedPlanFromQuery } from "@/lib/plan-catalog";
import { publicSupportEmail } from "@/lib/public-contact";

type AuthMode = "sign-in" | "sign-up";
const pendingPlanKey = "outreachai.pendingPlan";
const qaAuthEnabled = process.env.NEXT_PUBLIC_APP_ENV === "test"
  && process.env.NEXT_PUBLIC_CLERK_E2E_BYPASS === "true"
  && (process.env.NEXT_PUBLIC_API_URL === "http://127.0.0.1:8000" || process.env.NEXT_PUBLIC_API_URL === "http://localhost:8000");

function PlanSummary({ selectedPlan, unknownPlan }: { selectedPlan: ReturnType<typeof selectedPlanFromQuery>; unknownPlan?: string | null }) {
  const { t, formatNumber, formatCurrency } = useI18n();
  if (!selectedPlan && !unknownPlan) return null;
  const plan = selectedPlan ?? planByName("Starter");

  return (
    <div className="mb-5 rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-surface)] p-4 text-left text-sm shadow-sm" data-testid="selected-plan-summary">
      <p className="font-black text-[var(--ui-text)]">
        {selectedPlan ? `${t("Selected plan")}: ${t(plan.name)}` : t("Unknown plan selected")}
      </p>
      {unknownPlan ? <p className="mt-1 text-xs font-semibold text-danger">{t("We could not recognize that plan, so registration will continue with Starter.")}</p> : null}
      <p className="mt-2 text-[var(--ui-text-soft)]">
        {formatCurrency(plan.monthlyPrice, plan.currency)}/{t("month")} · {plan.trialDays} {t("day trial")} · {formatNumber(plan.limits.leads)} {t("leads per month")} · {formatNumber(plan.limits.aiGenerations)} {t("AI generations per month")}
      </p>
    </div>
  );
}

function SupportLink() {
  const { t } = useI18n();
  return (
    <a href={`mailto:${publicSupportEmail}`} className="focus-ring mt-4 inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-[var(--ui-border)] bg-white px-4 text-sm font-black text-[var(--ui-text)]">
      <Mail size={16} aria-hidden="true" />
      {t("Support")}
    </a>
  );
}

function MissingClerkConfig({ mode }: { mode: AuthMode }) {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const rawPlan = mode === "sign-up" ? searchParams.get("plan") : null;
  const selectedPlan = selectedPlanFromQuery(rawPlan);
  const unknownPlan = rawPlan && !selectedPlan ? rawPlan : null;
  const title = mode === "sign-up" ? t("Sign up is temporarily unavailable") : t("Sign in is temporarily unavailable");
  const copy = mode === "sign-up"
    ? t("Secure account creation is temporarily unavailable. Please try again shortly.")
    : t("Secure sign in is temporarily unavailable. Please try again shortly.");

  return (
    <SurfaceCard className="w-full max-w-md rounded-[1.75rem] p-6 text-center shadow-raised">
      <h1 className="text-xl font-bold text-ink">{title}</h1>
      <p className="mt-3 text-sm leading-6 text-[var(--ui-text-soft)]">{copy}</p>
      {mode === "sign-up" ? <PlanSummary selectedPlan={selectedPlan} unknownPlan={unknownPlan} /> : null}
      <SupportLink />
    </SurfaceCard>
  );
}

function QaAuthPage({ mode }: { mode: AuthMode }) {
  const { t } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawPlan = mode === "sign-up" ? searchParams.get("plan") : null;
  const selectedPlan = selectedPlanFromQuery(rawPlan);
  const unknownPlan = rawPlan && !selectedPlan ? rawPlan : null;
  const isSignUp = mode === "sign-up";
  const completeUrl = safeAuthRedirectUrl(searchParams.get("redirect_url"));

  useEffect(() => {
    if (window.localStorage.getItem("outreachai.e2eSignedOut") === "false") {
      router.replace(completeUrl);
    }
  }, [completeUrl, router]);

  function continueAsQaUser() {
    window.localStorage.setItem("outreachai.e2eSignedOut", "false");
    window.localStorage.setItem("outreachai.e2eUserEmail", e2eUserEmail);
    window.location.assign(completeUrl);
  }

  return (
    <main className="flex min-h-screen items-center justify-center overflow-x-hidden bg-[var(--ui-bg)] px-4 py-6 text-[var(--ui-text)] min-[360px]:px-5">
      <SurfaceCard className="w-full max-w-md rounded-[1.75rem] p-6 text-center shadow-raised">
        <AppBadge tone="brand">{t("QA authentication")}</AppBadge>
        <h1 className="mt-4 text-3xl font-black tracking-normal text-[var(--ui-text)]">{isSignUp ? t("Create your account") : t("Welcome back")}</h1>
        <p className="mt-3 text-sm leading-6 text-[var(--ui-text-soft)]">
          {t("This test-only flow is enabled only when the app runs in the isolated Playwright environment.")}
        </p>
        {isSignUp ? <PlanSummary selectedPlan={selectedPlan} unknownPlan={unknownPlan} /> : null}
        {isSignUp ? <div id="clerk-captcha" className="mb-4 min-h-0 w-full" data-testid="clerk-captcha-render-target" /> : null}
        <button type="button" onClick={continueAsQaUser} className="focus-ring mt-6 inline-flex min-h-12 w-full items-center justify-center rounded-full bg-[var(--ui-brand)] px-4 py-2 text-sm font-black text-white shadow-soft">
          {isSignUp ? t("Create account") : t("Continue to workspace")}
        </button>
        <Link href="/" className="focus-ring mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full border border-[var(--ui-border)] bg-white px-4 text-sm font-black text-[var(--ui-text)]">
          <ArrowLeft size={16} aria-hidden="true" /> {t("Back to home")}
        </Link>
        <SupportLink />
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
  const router = useRouter();
  const searchParams = useSearchParams();
  const isSignUp = mode === "sign-up";
  const rawPlan = searchParams.get("plan");
  const selectedPlanDetails = selectedPlanFromQuery(rawPlan);
  const selectedPlan = selectedPlanDetails?.name ?? null;
  const unknownPlan = rawPlan && !selectedPlanDetails ? rawPlan : null;
  const authCompleteUrl = safeAuthRedirectUrl(searchParams.get("redirect_url"));

  useEffect(() => {
    if (!selectedPlan) return;
    try {
      window.localStorage.setItem(pendingPlanKey, selectedPlan);
    } catch {
      // Some private mobile browsers block storage. Registration should still work.
    }
  }, [selectedPlan]);

  useEffect(() => {
    if (isLoaded && isSignedIn) {
      router.replace(authCompleteUrl);
    }
  }, [authCompleteUrl, isLoaded, isSignedIn, router]);

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
        <AuthLoadingState />
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
        {isSignUp ? <PlanSummary selectedPlan={selectedPlanDetails} unknownPlan={unknownPlan} /> : null}
        {isSignUp ? (
          <>
            <div id="clerk-captcha" className="mb-4 min-h-0 w-full" data-testid="clerk-captcha-render-target" />
            <SignUp
              routing="path"
              path="/sign-up"
              signInUrl="/sign-in"
              fallbackRedirectUrl={authCompleteUrl}
              forceRedirectUrl={authCompleteUrl}
              appearance={clerkAppearance}
            />
          </>
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
        <div className="mt-4 text-center">
          <Link href="/" className="focus-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-[var(--ui-border)] bg-white px-4 text-sm font-black text-[var(--ui-text)]">
            <ArrowLeft size={16} aria-hidden="true" /> {t("Back to home")}
          </Link>
          <SupportLink />
        </div>
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
