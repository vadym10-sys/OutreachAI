import { describe, expect, it, vi } from "vitest";

vi.mock("@clerk/nextjs/errors", () => ({
  isClerkAPIResponseError: (error: unknown) => Boolean((error as { clerkApiError?: boolean })?.clerkApiError)
}));

describe("password reset error handling", () => {
  it("keeps unknown email responses neutral", async () => {
    const { genericPasswordResetRequestMessage, passwordResetRequestMessage } = await import("../../lib/password-reset-errors");

    expect(passwordResetRequestMessage({
      clerkApiError: true,
      errors: [{ code: "form_identifier_not_found" }]
    })).toBe(genericPasswordResetRequestMessage);
  });

  it("does not pretend reset email was sent when Clerk rejects the request for configuration reasons", async () => {
    const { passwordResetRequestMessage, passwordResetUnavailableMessage } = await import("../../lib/password-reset-errors");

    expect(passwordResetRequestMessage({
      clerkApiError: true,
      errors: [{ code: "strategy_not_enabled" }]
    })).toBe(passwordResetUnavailableMessage);
  });

  it("shows unavailable state for non-Clerk failures", async () => {
    const { passwordResetRequestMessage, passwordResetUnavailableMessage } = await import("../../lib/password-reset-errors");

    expect(passwordResetRequestMessage(new Error("network unavailable"))).toBe(passwordResetUnavailableMessage);
  });
});
