"use client";

import { useState } from "react";
import { useSignIn, useSignUp } from "@clerk/nextjs/legacy";
import { Loader2 } from "lucide-react";
import { hasClerkPublishableKey, isClerkE2EBypass } from "@/lib/env";
import { useI18n } from "@/lib/i18n/provider";

type AuthMode = "sign-in" | "sign-up";
type OAuthProvider = "google" | "apple";

const providers: Array<{ id: OAuthProvider; label: string }> = [
  { id: "google", label: "Continue with Google" },
  { id: "apple", label: "Continue with Apple" }
];

function OAuthButtonShell({
  embedded,
  children,
  error
}: {
  embedded: boolean;
  children: React.ReactNode;
  error?: string | null;
}) {
  return (
    <section aria-label="Social authentication" className={embedded ? "w-full" : "mb-4 rounded-lg border border-slate-200 bg-white p-3 shadow-soft"}>
      <div className="grid gap-2">{children}</div>
      {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    </section>
  );
}

export function OAuthProviderButtons({ mode, embedded = false, redirectUrlComplete = "/dashboard" }: { mode: AuthMode; embedded?: boolean; redirectUrlComplete?: string }) {
  const { t } = useI18n();

  if (!hasClerkPublishableKey || isClerkE2EBypass) {
    return (
      <OAuthButtonShell embedded={embedded}>
        {providers.map((provider) => (
          <button
            key={provider.id}
            type="button"
            disabled
            className="focus-ring inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-ink opacity-60"
          >
            <span className="text-base">{provider.id === "apple" ? "A" : "G"}</span>
            <span>{t(provider.label)}</span>
          </button>
        ))}
      </OAuthButtonShell>
    );
  }

  return <LiveOAuthProviderButtons mode={mode} embedded={embedded} redirectUrlComplete={redirectUrlComplete} />;
}

function LiveOAuthProviderButtons({ mode, embedded = false, redirectUrlComplete = "/dashboard" }: { mode: AuthMode; embedded?: boolean; redirectUrlComplete?: string }) {
  const { t } = useI18n();
  const signInState = useSignIn();
  const signUpState = useSignUp();
  const [busyProvider, setBusyProvider] = useState<OAuthProvider | null>(null);
  const [error, setError] = useState<string | null>(null);

  const resource = mode === "sign-up" ? signUpState.signUp : signInState.signIn;
  const isLoaded = mode === "sign-up" ? signUpState.isLoaded : signInState.isLoaded;

  async function authenticate(provider: OAuthProvider) {
    if (!isLoaded || !resource) {
      return;
    }

    setError(null);
    setBusyProvider(provider);

    try {
      await resource.authenticateWithRedirect({
        strategy: `oauth_${provider}`,
        redirectUrl: "/sso-callback",
        redirectUrlComplete
      });
    } catch (event) {
      if (process.env.NODE_ENV !== "production") {
        console.error("OAuth redirect failed", event);
      }
      setBusyProvider(null);
      setError(t("Sign in could not start. Please try again."));
    }
  }

  return (
    <OAuthButtonShell embedded={embedded} error={error}>
      {providers.map((provider) => {
        const isBusy = busyProvider === provider.id;
        return (
          <button
            key={provider.id}
            type="button"
            onClick={() => authenticate(provider.id)}
            disabled={!isLoaded || busyProvider !== null}
            className="focus-ring inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-ink transition hover:border-slate-400 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isBusy ? <Loader2 className="animate-spin" size={17} /> : <span className="text-base">{provider.id === "apple" ? "A" : "G"}</span>}
            <span>{t(provider.label)}</span>
          </button>
        );
      })}
    </OAuthButtonShell>
  );
}
