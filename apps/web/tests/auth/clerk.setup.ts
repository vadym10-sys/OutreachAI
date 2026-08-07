import { clerkSetup } from "@clerk/testing/playwright";
import { test as setup } from "@playwright/test";

setup.describe.configure({ mode: "serial" });

setup("clerk testing token setup", async () => {
  if (process.env.CLERK_E2E_ENABLED !== "true") {
    setup.skip(true, "Clerk E2E is opt-in and requires real Clerk test keys.");
  }
  await clerkSetup();
});
