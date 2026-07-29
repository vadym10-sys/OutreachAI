import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PRODUCTION_WEB_URL || "https://outreachaiaiai.com";
const storageState = process.env.PRODUCTION_AUTH_STORAGE_STATE || undefined;

export default defineConfig({
  testDir: "tests/production",
  testMatch: ["**/*.spec.ts"],
  fullyParallel: false,
  forbidOnly: true,
  workers: 1,
  retries: 2,
  timeout: 90_000,
  expect: {
    timeout: 15_000
  },
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report-production", open: "never" }],
    ["json", { outputFile: "test-artifacts/production-playwright-results.json" }],
    ["junit", { outputFile: "test-artifacts/production-playwright-junit.xml" }]
  ],
  outputDir: "test-results-production",
  use: {
    baseURL,
    storageState,
    actionTimeout: 20_000,
    navigationTimeout: 45_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    ignoreHTTPSErrors: false
  },
  projects: [
    { name: "production-desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 960 } } },
    { name: "production-mobile", use: { ...devices["iPhone 13"] } }
  ]
});
