import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const proxySource = readFileSync(resolve(__dirname, "../../proxy.ts"), "utf8");

describe("proxy auth guard", () => {
  it("does not preempt Clerk auth with hard-coded session cookie names", () => {
    expect(proxySource).not.toContain("__session=");
    expect(proxySource).not.toContain("__client_uat=");
    expect(proxySource).not.toContain("hasClerkSessionCookie");
    expect(proxySource.indexOf("const authState = await auth()")).toBeGreaterThan(-1);
    expect(proxySource.indexOf("return signInRedirect(req)")).toBeGreaterThan(proxySource.indexOf("const authState = await auth()"));
  });
});
