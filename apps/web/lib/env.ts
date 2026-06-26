const DEFAULT_APP_URL = "https://outreachai.example";
const DEFAULT_API_URL = "http://localhost:8000";

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
export const apiUrl = normalizeUrl(process.env.NEXT_PUBLIC_API_URL, DEFAULT_API_URL);
export const clerkPublishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || process.env.CLERK_PUBLISHABLE_KEY;
export const clerkSecretKey = process.env.CLERK_SECRET_KEY;
export const isClerkE2EBypass = process.env.CLERK_E2E_BYPASS === "true" || process.env.NEXT_PUBLIC_CLERK_E2E_BYPASS === "true";

export const hasClerkPublishableKey = Boolean(clerkPublishableKey);
export const hasClerkRuntimeConfig = Boolean(clerkPublishableKey && clerkSecretKey);
