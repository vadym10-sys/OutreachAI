import { afterEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...process.env };

async function loadEnv() {
  vi.resetModules();
  return import("../../lib/env");
}

afterEach(() => {
  process.env = { ...originalEnv };
  vi.resetModules();
});

describe("environment safety", () => {
  it("never enables the Clerk E2E bypass in production", async () => {
    process.env.NEXT_PUBLIC_APP_ENV = "production";
    process.env.CLERK_E2E_BYPASS = "true";
    process.env.NEXT_PUBLIC_CLERK_E2E_BYPASS = "true";

    const env = await loadEnv();

    expect(env.isProductionRuntime).toBe(true);
    expect(env.isClerkE2EBypass).toBe(false);
  });

  it("keeps the Clerk E2E bypass available for local automated tests", async () => {
    process.env.NEXT_PUBLIC_APP_ENV = "test";
    process.env.CLERK_E2E_BYPASS = "true";

    const env = await loadEnv();

    expect(env.isProductionRuntime).toBe(false);
    expect(env.isClerkE2EBypass).toBe(true);
  });
});
