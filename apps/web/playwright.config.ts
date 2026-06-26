import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: false,
    env: {
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_replace_me",
      CLERK_SECRET_KEY: "sk_test_replace_me",
      CLERK_E2E_BYPASS: "true",
      NEXT_PUBLIC_CLERK_E2E_BYPASS: "true",
      NEXT_PUBLIC_API_URL: "http://127.0.0.1:8000"
    }
  },
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "on-first-retry"
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 5"], browserName: "chromium" } }
  ]
});
