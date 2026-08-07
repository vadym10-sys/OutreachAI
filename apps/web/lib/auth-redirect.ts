const authRoutePattern = /^\/(?:sign-in|sign-up|sso-callback)(?:\/|\?|$)/;

export function safeAuthRedirectUrl(value: string | null | undefined, fallback = "/dashboard") {
  if (!value) return fallback;
  const trimmed = value.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return fallback;
  if (authRoutePattern.test(trimmed)) return fallback;
  try {
    const parsed = new URL(trimmed, "https://outreachaiaiai.com");
    if (parsed.origin !== "https://outreachaiaiai.com") return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}` || fallback;
  } catch {
    return fallback;
  }
}
