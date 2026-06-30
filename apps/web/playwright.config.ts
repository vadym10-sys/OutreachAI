import { defineConfig, devices } from "@playwright/test";

const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: ".",
  testMatch: ["e2e/**/*.spec.ts", "tests/**/*.spec.ts"],
  fullyParallel: true,
  forbidOnly: isCI,
  workers: isCI ? 4 : undefined,
  retries: isCI ? 2 : 1,
  timeout: 45_000,
  expect: {
    timeout: 7_500
  },
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report", open: "never" }],
    ["json", { outputFile: "test-artifacts/playwright-results.json" }],
    ["junit", { outputFile: "test-artifacts/playwright-junit.xml" }]
  ],
  outputDir: "test-results",
  webServer: {
    command: "npm run dev -- --webpack",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: !isCI,
    timeout: 120_000,
    env: {
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "",
      CLERK_SECRET_KEY: "",
      CLERK_E2E_BYPASS: "true",
      NEXT_PUBLIC_CLERK_E2E_BYPASS: "true",
      NEXT_PUBLIC_API_URL: "http://127.0.0.1:8000",
      NEXT_PUBLIC_LOGROCKET_APP_ID: "",
      NEXT_PUBLIC_POSTHOG_KEY: "",
      NEXT_PUBLIC_SENTRY_DSN: "",
      NODE_OPTIONS: "--max-old-space-size=4096"
    }
  },
  use: {
    baseURL: "http://127.0.0.1:3000",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure"
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] }, testMatch: ["tests/**/*.spec.ts"] },
    { name: "webkit", use: { ...devices["Desktop Safari"] }, testMatch: ["tests/**/*.spec.ts"] },
    { name: "laptop", use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 768 } }, testMatch: ["tests/dashboard/**/*.spec.ts", "tests/auth/**/*.spec.ts"] },
    { name: "tablet", use: { ...devices["iPad Pro 11"] }, testMatch: ["tests/dashboard/**/*.spec.ts", "tests/accessibility/**/*.spec.ts"] },
    { name: "iphone", use: { ...devices["iPhone 13"] }, testMatch: ["e2e/**/*.spec.ts", "tests/**/*.spec.ts"] },
    { name: "android", use: { ...devices["Pixel 5"], browserName: "chromium" }, testMatch: ["e2e/**/*.spec.ts", "tests/**/*.spec.ts"] },
    { name: "mobile-landscape", use: { ...devices["Pixel 5 landscape"], browserName: "chromium" }, testMatch: ["tests/dashboard/**/*.spec.ts", "tests/mobile/**/*.spec.ts", "tests/accessibility/**/*.spec.ts"] }
  ]
});
