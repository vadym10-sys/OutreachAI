import { afterEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...process.env };

async function loadEnv() {
  vi.resetModules();
  return import("../../lib/env");
}

afterEach(() => {
  vi.unstubAllEnvs();
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
    process.env.NEXT_PUBLIC_CLERK_E2E_BYPASS = "true";
    process.env.NEXT_PUBLIC_API_URL = "http://127.0.0.1:8000";

    const env = await loadEnv();

    expect(env.isProductionRuntime).toBe(false);
    expect(env.isClerkE2EBypass).toBe(true);
  });

  it("allows the Clerk E2E bypass for production-like Playwright builds only against a local test API", async () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.NEXT_PUBLIC_APP_ENV = "test";
    process.env.NEXT_PUBLIC_CLERK_E2E_BYPASS = "true";
    process.env.NEXT_PUBLIC_API_URL = "http://localhost:8000";

    const env = await loadEnv();

    expect(env.isProductionRuntime).toBe(true);
    expect(env.isClerkE2EBypass).toBe(true);
  });

  it("keeps the Clerk E2E bypass disabled when test flags point at the production API", async () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.NEXT_PUBLIC_APP_ENV = "test";
    process.env.NEXT_PUBLIC_CLERK_E2E_BYPASS = "true";
    process.env.NEXT_PUBLIC_API_URL = "https://outreachai-api-production.up.railway.app";

    const env = await loadEnv();

    expect(env.isProductionRuntime).toBe(true);
    expect(env.isClerkE2EBypass).toBe(false);
  });

  it("does not enable Clerk for placeholder publishable keys", async () => {
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = "pk_test_replace_me";
    process.env.CLERK_SECRET_KEY = "sk_test_replace_me";

    const env = await loadEnv();

    expect(env.hasClerkPublishableKey).toBe(false);
    expect(env.hasClerkRuntimeConfig).toBe(false);
  });

  it("accepts real Clerk publishable keys with the Clerk terminator suffix", async () => {
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = "pk_live_Y2xlcmsuZXhhbXBsZS5jbGVyay5hY2NvdW50cy5kZXYk";
    process.env.CLERK_SECRET_KEY = "sk_live_example_secret";

    const env = await loadEnv();

    expect(env.hasClerkPublishableKey).toBe(true);
    expect(env.hasClerkRuntimeConfig).toBe(true);
  });
});
