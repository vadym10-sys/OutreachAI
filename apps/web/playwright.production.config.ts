import { defineConfig, devices } from "@playwright/test";

const baseURL = (process.env.PRODUCTION_WEB_URL || "https://outreachaiaiai.com").replace(/\/$/, "");
const storageState = process.env.PRODUCTION_AUTH_STORAGE_STATE || undefined;

export default defineConfig({
  testDir: "./tests/production",
  timeout: 45_000,
  expect: {
    timeout: 10_000
  },
  fullyParallel: false,
  retries: 1,
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report-production", open: "never" }],
    ["json", { outputFile: "test-artifacts/production-results.json" }]
  ],
  use: {
    baseURL,
    trace: "retain-on-failure",
    video: "retain-on-failure",
    screenshot: "only-on-failure",
    storageState
  },
  outputDir: "test-results-production",
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    },
    {
      name: "mobile-chrome",
      use: { ...devices["Pixel 5"] }
    }
  ]
});
