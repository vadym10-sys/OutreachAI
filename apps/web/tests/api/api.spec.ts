import { expect, test } from "@playwright/test";
import { installQaGuards } from "../helpers/qa-guards";

test("client config endpoint returns safe public configuration only", async ({ page }, testInfo) => {
  const guards = installQaGuards(page, testInfo);
  const response = await page.request.get("/api/client-config");
  expect(response.ok()).toBe(true);
  const body = await response.json();
  expect(body.app.release).toBeTruthy();
  expect(body.app.environment).toBeTruthy();
  expect(JSON.stringify(body)).not.toMatch(/sk_live_|sk_test_|DATABASE_URL|SECRET|PRIVATE|API_KEY/i);
  await guards.assertClean();
});

test("runtime diagnostics endpoint does not leak secret values", async ({ page }, testInfo) => {
  const guards = installQaGuards(page, testInfo);
  const response = await page.request.get("/api/runtime-diagnostics");
  expect(response.ok()).toBe(true);
  const text = await response.text();
  expect(text).not.toMatch(/sk_live_|sk_test_|DATABASE_URL|OPENAI_API_KEY|RESEND_API_KEY|HUNTER_API_KEY/i);
  await guards.assertClean();
});

test("customer route HTML is not cached as stale app state", async ({ page }, testInfo) => {
  const guards = installQaGuards(page, testInfo);
  const response = await page.request.get("/");
  expect(response.ok()).toBe(true);
  expect(response.headers()["cache-control"] || "").not.toMatch(/s-maxage=31536000/);
  await guards.assertClean();
});

test("backend proxy outage returns a safe customer message", async ({ page }, testInfo) => {
  const guards = installQaGuards(page, testInfo);
  const response = await page.request.get("/api/backend/api/health");
  expect(response.status()).toBe(503);
  const text = await response.text();
  expect(text).toContain("workspace data");
  expect(text).not.toMatch(/ECONNREFUSED|127\.0\.0\.1|localhost|fetch failed|stack|Traceback|DATABASE_URL/i);
  await guards.assertClean();
});
