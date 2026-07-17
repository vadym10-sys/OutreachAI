"use client";

export function isRestrictedWebView() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const vendor = navigator.vendor || "";
  const isIos = /iPad|iPhone|iPod/i.test(ua);
  const isAppleWebKit = /AppleWebKit/i.test(ua);
  const hasSafariToken = /Safari/i.test(ua);
  const embeddedApp = /Telegram|FBAN|FBAV|Instagram|Line\/|MicroMessenger|WhatsApp|CriOS|FxiOS|EdgiOS|Codex/i.test(ua);
  const iosWebView = isIos && isAppleWebKit && !hasSafariToken;
  const automationWebView = /Codex/i.test(vendor) || /Codex/i.test(ua);

  return embeddedApp || iosWebView || automationWebView;
}

export function shouldUseHeavyClientTelemetry() {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  if (process.env.NEXT_PUBLIC_APP_ENV === "test") return false;
  if (isRestrictedWebView()) return false;

  const nav = navigator as Navigator & {
    deviceMemory?: number;
    connection?: { saveData?: boolean; effectiveType?: string };
  };

  if (nav.connection?.saveData) return false;
  if (typeof nav.deviceMemory === "number" && nav.deviceMemory > 0 && nav.deviceMemory <= 2) return false;
  if (nav.connection?.effectiveType && /2g|slow-2g/i.test(nav.connection.effectiveType)) return false;

  return true;
}
