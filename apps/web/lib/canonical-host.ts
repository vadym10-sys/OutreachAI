const productionHost = "outreachaiaiai.com";

function previewCanonicalOrigin(value: string | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    if (!url.hostname.endsWith(".vercel.app")) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function canonicalPreviewRedirectUrl(requestUrl: string, configuredAppUrl = process.env.NEXT_PUBLIC_APP_URL) {
  const canonicalOrigin = previewCanonicalOrigin(configuredAppUrl);
  if (!canonicalOrigin) return null;

  const current = new URL(requestUrl);
  if (!current.hostname.endsWith(".vercel.app")) return null;
  if (current.hostname === productionHost) return null;
  if (current.origin === canonicalOrigin) return null;

  return new URL(`${current.pathname}${current.search}${current.hash}`, canonicalOrigin);
}
