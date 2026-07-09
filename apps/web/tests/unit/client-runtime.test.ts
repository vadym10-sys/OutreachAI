import { afterEach, describe, expect, it, vi } from "vitest";
import { isRestrictedWebView, shouldUseHeavyClientTelemetry } from "@/lib/client-runtime";

function setNavigator(values: Partial<Navigator & { deviceMemory?: number; connection?: { saveData?: boolean; effectiveType?: string } }>) {
  const original = globalThis.navigator;
  vi.stubGlobal("window", {});
  vi.stubGlobal("navigator", {
    ...original,
    ...values
  });
}

describe("client runtime safety", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("disables heavy telemetry inside embedded mobile browsers", () => {
    setNavigator({
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Telegram",
      vendor: "Apple Computer, Inc."
    });

    expect(isRestrictedWebView()).toBe(true);
    expect(shouldUseHeavyClientTelemetry()).toBe(false);
  });

  it("disables heavy telemetry for low memory devices", () => {
    setNavigator({
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36",
      vendor: "Google Inc.",
      deviceMemory: 2
    });

    expect(isRestrictedWebView()).toBe(false);
    expect(shouldUseHeavyClientTelemetry()).toBe(false);
  });

  it("keeps heavy telemetry available for normal desktop browsers", () => {
    setNavigator({
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36",
      vendor: "Google Inc.",
      deviceMemory: 8
    });

    expect(isRestrictedWebView()).toBe(false);
    expect(shouldUseHeavyClientTelemetry()).toBe(true);
  });
});
