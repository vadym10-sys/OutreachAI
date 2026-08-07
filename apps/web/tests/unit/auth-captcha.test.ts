import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Clerk CAPTCHA ownership", () => {
  it("does not add a manual clerk-captcha target around the prebuilt SignUp component", () => {
    const source = readFileSync(resolve(process.cwd(), "components/auth-page-client.tsx"), "utf8");

    expect(source).toContain("<SignUp");
    expect(source).not.toContain("id=\"clerk-captcha\"");
    expect(source).not.toContain("data-testid=\"clerk-captcha-render-target\"");
    expect(source).not.toContain("signUp.create");
  });
});
