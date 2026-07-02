const PRODUCTION_APP_URL = "https://outreachaiaiai.com";
const PRODUCTION_BACKEND_URL = "https://outreachai-api-production.up.railway.app";

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
export const publicBackendApiUrl = normalizeUrl(process.env.NEXT_PUBLIC_API_URL, PRODUCTION_BACKEND_URL);
export const clerkPublishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || process.env.CLERK_PUBLISHABLE_KEY;
export const clerkSecretKey = process.env.CLERK_SECRET_KEY;
export const stripePublishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
export const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY || "";
export const posthogHost = normalizeUrl(process.env.NEXT_PUBLIC_POSTHOG_HOST, "https://app.posthog.com");
export const logRocketAppId = process.env.NEXT_PUBLIC_LOGROCKET_APP_ID || "";
export const runtimeEnvironment = process.env.NEXT_PUBLIC_APP_ENV || process.env.NODE_ENV || "development";
export const isProductionRuntime = process.env.NODE_ENV === "production" || runtimeEnvironment === "production";
export const isClerkE2EBypass = !isProductionRuntime && (process.env.CLERK_E2E_BYPASS === "true" || process.env.NEXT_PUBLIC_CLERK_E2E_BYPASS === "true");
export const ownerEmail = "romaniukvadym10@gmail.com";
export const e2eUserEmail = process.env.NEXT_PUBLIC_E2E_USER_EMAIL || "";

function isUsableClerkPublishableKey(value: string | undefined) {
  if (!value) return false;
  if (value.includes("replace_me")) return false;
  return /^pk_(test|live)_[A-Za-z0-9+/_=$-]{16,}$/.test(value);
}

export const hasClerkPublishableKey = isUsableClerkPublishableKey(clerkPublishableKey);
export const hasClerkRuntimeConfig = Boolean(hasClerkPublishableKey && clerkSecretKey);
export const hasPostHog = Boolean(posthogKey);
export const hasLogRocket = Boolean(logRocketAppId);
