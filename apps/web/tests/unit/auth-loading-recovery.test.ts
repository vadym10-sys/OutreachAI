import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("auth loading recovery", () => {
  it("does not leave secure sign-in loading without a recovery action", () => {
    const source = readFileSync(new URL("../../components/auth-page-client.tsx", import.meta.url), "utf8");

    expect(source).toContain("Secure sign in is taking longer than expected.");
    expect(source).toContain("Restart sign in");
    expect(source).toContain("window.setTimeout(() => setShowRecovery(true), 12000)");
  });
});
