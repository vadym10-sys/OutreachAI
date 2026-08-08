import { describe, expect, it } from "vitest";
import { canonicalPreviewRedirectUrl } from "../../lib/canonical-host";

describe("canonical Preview host", () => {
  const canonical = "https://outreach-ai-web-git-codex-client-onboarding-a21ce1-vadym10-ai-1.vercel.app";

  it("redirects Vercel deployment hosts to the configured Preview alias and preserves the destination", () => {
    const redirect = canonicalPreviewRedirectUrl(
      "https://outreach-ai-d5t7mttl4-vadym10-ai-1.vercel.app/sign-in?redirect_url=/dashboard",
      canonical
    );

    expect(redirect?.toString()).toBe(`${canonical}/sign-in?redirect_url=/dashboard`);
  });

  it("does not redirect the canonical Preview alias", () => {
    expect(canonicalPreviewRedirectUrl(`${canonical}/dashboard`, canonical)).toBeNull();
  });

  it("ignores production and non-Vercel app URLs", () => {
    expect(canonicalPreviewRedirectUrl("https://outreachaiaiai.com/sign-in", canonical)).toBeNull();
    expect(canonicalPreviewRedirectUrl("https://outreach-ai-d5t7mttl4-vadym10-ai-1.vercel.app/sign-in", "https://outreachaiaiai.com")).toBeNull();
  });
});
