const PRODUCTION_APP_URL = "https://outreachaiaiai.com";

const DEFAULT_APP_URL = process.env.NODE_ENV === "production" ? PRODUCTION_APP_URL : "https://outreachai.example";

function normalizeUrl(value: string | undefined, fallback: string) {
  if (!value) {
    return fallback;
  }

  try {
    return new URL(value).origin;
  } catch {
    try {
      return new URL(`https://${value}`).origin;
    } catch {
      return fallback;
    }
  }
}

export const appUrl = normalizeUrl(process.env.NEXT_PUBLIC_APP_URL, DEFAULT_APP_URL);
export const apiProxyUrl = "/api/backend";
export const clerkPublishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || process.env.CLERK_PUBLISHABLE_KEY;
export const clerkSecretKey = process.env.CLERK_SECRET_KEY;
export const stripePublishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
export const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY || "";
export const posthogHost = normalizeUrl(process.env.NEXT_PUBLIC_POSTHOG_HOST, "https://app.posthog.com");
export const logRocketAppId = process.env.NEXT_PUBLIC_LOGROCKET_APP_ID || "";
export const isClerkE2EBypass = process.env.CLERK_E2E_BYPASS === "true" || process.env.NEXT_PUBLIC_CLERK_E2E_BYPASS === "true";
export const ownerEmail = "romaniukvadym10@gmail.com";
export const e2eUserEmail = process.env.NEXT_PUBLIC_E2E_USER_EMAIL || "";

export const hasClerkPublishableKey = Boolean(clerkPublishableKey);
export const hasClerkRuntimeConfig = Boolean(clerkPublishableKey && clerkSecretKey);
export const hasPostHog = Boolean(posthogKey);
export const hasLogRocket = Boolean(logRocketAppId);
