import { expect, test } from "@playwright/test";
import { mockWorkspaceApi } from "../../mocks/workspace-api";
import { expectNoBrokenImages, expectNoHorizontalOverflow, installQaGuards } from "../helpers/qa-guards";

const supportHref = "mailto:outreachaiaiai@gmail.com";

test.describe("authentication UX", () => {
  for (const route of ["/sign-in", "/sign-up", "/forgot-password"]) {
    test(`${route} renders without duplicate or broken auth UI`, async ({ page }, testInfo) => {
      const guards = installQaGuards(page, testInfo);
      await page.goto(route, { waitUntil: "domcontentloaded" });
      await expect(page.locator("main")).toBeVisible();
      await expectNoBrokenImages(page);
      await guards.assertClean();
    });
  }

  test("dashboard is available in QA bypass mode for authenticated-flow tests", async ({ page }) => {
    await mockWorkspaceApi(page);
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "AI Поиск" })).toBeVisible();
  });

  test("new user registration fallback reaches dashboard and creates one workspace", async ({ page }) => {
    const workspaceRequests: string[] = [];
    await mockWorkspaceApi(page);
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname === "/api/backend/api/workspace/me") workspaceRequests.push(request.method());
    });

    await page.goto("/sign-up", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Create account" }).click();
    await page.waitForURL("**/dashboard");
    await expect(page.getByRole("heading", { name: "AI Поиск" })).toBeVisible();
    expect(workspaceRequests.filter((method) => method === "GET").length).toBeLessThanOrEqual(1);
  });

  test("existing user signs in and returns to dashboard", async ({ page }) => {
    await mockWorkspaceApi(page);
    await page.goto("/sign-in", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Continue to workspace" }).click();
    await page.waitForURL("**/dashboard");
    await expect(page.getByRole("heading", { name: "AI Поиск" })).toBeVisible();
  });

  test("auth callback recovery does not render a blank screen", async ({ page }) => {
    await page.goto("/sso-callback", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Completing sign in" })).toBeVisible();
    await expect(page.locator("main")).not.toBeEmpty();
  });

  test("sign-up lets Clerk own CAPTCHA rendering without duplicate manual target", async ({ page }, testInfo) => {
    const guards = installQaGuards(page, testInfo);
    await page.goto("/sign-up?redirect_url=/dashboard", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#clerk-captcha")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Create account" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to home" })).toHaveAttribute("href", "/");
    await guards.assertClean();
  });

  test("auth CSP allows Clerk bot protection and Turnstile resources", async ({ page }) => {
    const response = await page.goto("/sign-up", { waitUntil: "domcontentloaded" });
    const csp = response?.headers()["content-security-policy"] || "";
    const scriptSrc = csp.split("; ").find((directive) => directive.startsWith("script-src")) || "";
    const connectSrc = csp.split("; ").find((directive) => directive.startsWith("connect-src")) || "";
    const frameSrc = csp.split("; ").find((directive) => directive.startsWith("frame-src")) || "";
    expect(scriptSrc).toContain("https://challenges.cloudflare.com");
    expect(scriptSrc).toContain("https://*.protect.clerk.com");
    expect(connectSrc).toContain("https://challenges.cloudflare.com");
    expect(connectSrc).toContain("https://*.protect.clerk.com");
    expect(frameSrc).toContain("https://challenges.cloudflare.com");
    expect(frameSrc).toContain("https://*.protect.clerk.com");
    expect(csp).toContain("https://img.clerk.com");
  });

  test("signed-in user does not remain on auth pages and redirect loop is absent", async ({ page }) => {
    await mockWorkspaceApi(page);
    await page.goto("/sign-in", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Continue to workspace" }).click();
    await page.waitForURL("**/dashboard");
    await page.goto("/sign-up?redirect_url=/sign-in", { waitUntil: "domcontentloaded" });
    await page.waitForURL("**/dashboard");
    await expect(page).not.toHaveURL(/\/sign-(in|up)/);
  });

  test("mobile sign-up page is usable without overflow", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const guards = installQaGuards(page, testInfo);
    await page.goto("/sign-up", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Create account" })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await guards.assertClean();
  });

  test("selected Russian language also localizes auth fallbacks", async ({ page }, testInfo) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("outreachai.locale", "ru");
    });
    await page.context().addCookies([{
      name: "outreachai_locale",
      value: "ru",
      domain: "127.0.0.1",
      path: "/",
      sameSite: "Lax"
    }]);

    const guards = installQaGuards(page, testInfo);
    await page.goto("/sign-up?plan=Pro", { waitUntil: "domcontentloaded" });
    await expect(page.locator("main")).toContainText(/Регистрация временно недоступна|Создайте аккаунт/);
    await expect(page.getByTestId("selected-plan-summary")).toContainText("Выбранный тариф");
    await expect(page.getByTestId("selected-plan-summary")).toContainText("149");
    await expect(page.locator("main")).not.toContainText("Sign up is temporarily unavailable");
    await expect(page.getByRole("link", { name: "Поддержка" })).toHaveAttribute("href", supportHref);

    await page.goto("/sign-in", { waitUntil: "domcontentloaded" });
    await expect(page.locator("main")).toContainText(/Вход временно недоступен|С возвращением/);
    await expect(page.locator("main")).not.toContainText("Welcome back");
    await expect(page.locator("main")).not.toContainText("Sign in is temporarily unavailable");
    await guards.assertClean();
  });

  test("sign-up validates unknown plan query safely", async ({ page }, testInfo) => {
    const guards = installQaGuards(page, testInfo);
    await page.goto("/sign-up?plan=Enterprise<script>", { waitUntil: "domcontentloaded" });

    await expect(page.getByTestId("selected-plan-summary")).toContainText("Unknown plan selected");
    await expect(page.getByTestId("selected-plan-summary")).toContainText("registration will continue with Starter");
    await expect(page.getByTestId("selected-plan-summary")).toContainText("€49.00/month");
    await expect(page.locator("main")).not.toContainText("<script>");
    await expect(page.getByRole("link", { name: "Support" })).toHaveAttribute("href", supportHref);
    await guards.assertClean();
  });
});
