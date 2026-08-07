import { describe, expect, it } from "vitest";
import { safeAuthRedirectUrl } from "../../lib/auth-redirect";

describe("auth redirect safety", () => {
  it("keeps safe internal redirect URLs", () => {
    expect(safeAuthRedirectUrl("/dashboard/leads?source=pricing")).toBe("/dashboard/leads?source=pricing");
    expect(safeAuthRedirectUrl("/dashboard#workspace")).toBe("/dashboard#workspace");
  });

  it("falls back for external, protocol-relative, and auth-loop URLs", () => {
    expect(safeAuthRedirectUrl("https://evil.example/dashboard")).toBe("/dashboard");
    expect(safeAuthRedirectUrl("//evil.example/dashboard")).toBe("/dashboard");
    expect(safeAuthRedirectUrl("/sign-in?redirect_url=/dashboard")).toBe("/dashboard");
    expect(safeAuthRedirectUrl("/sign-up")).toBe("/dashboard");
    expect(safeAuthRedirectUrl("/sso-callback")).toBe("/dashboard");
  });
});
