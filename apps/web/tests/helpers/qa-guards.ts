import { expect, type Page, type TestInfo } from "@playwright/test";

type Failure = {
  type: string;
  message: string;
};

const allowedConsolePatterns = [
  /NO_COLOR env is ignored/i,
  /Fast Refresh/i,
  /Deprecated API for given entry type/i,
  /Ignoring unsupported entryTypes: layout-shift/i,
  /Layout was forced before the page was fully loaded/i,
  /preloaded (with|using) link preload but not used/i,
  /LogRocket: script could not load/i,
  /OutreachAI API request failed/i,
  /Dashboard supporting data could not be loaded/i,
  /Loading failed for the <script> with source .*cdn\.logr-in\.com\/logger-1\.min\.js/i,
  /Loading failed for the <script> with source .*\/_next\/static\/chunks\//i
];

const ignoredFailedRequestPatterns = [
  /\/sign-in\?redirect_url=.*\/dashboard/,
  /cdn\.logr-in\.com\/logger-1\.min\.js/,
  /\/__nextjs_font\/.*\.woff2/,
  /\/_next\/static\/webpack\/.*\.hot-update\.json/
];

export function installQaGuards(page: Page, testInfo: TestInfo) {
  const failures: Failure[] = [];

  page.on("console", (message) => {
    const text = message.text();
    if (["error", "warning"].includes(message.type()) && !allowedConsolePatterns.some((pattern) => pattern.test(text))) {
      failures.push({ type: `console:${message.type()}`, message: text });
    }
  });

  page.on("pageerror", (error) => {
    failures.push({ type: "pageerror", message: error.stack || error.message });
  });

  page.on("requestfailed", (request) => {
    const url = request.url();
    const failure = request.failure()?.errorText || "";
    if (/\/api\/client-config/.test(url) && /cancelled|abort/i.test(failure)) {
      return;
    }
    if (/\/_next\/static\/chunks\//.test(url) && /abort/i.test(failure)) {
      return;
    }
    if (!ignoredFailedRequestPatterns.some((pattern) => pattern.test(url))) {
      failures.push({ type: "requestfailed", message: `${url} ${failure}`.trim() });
    }
  });

  page.on("response", (response) => {
    const url = response.url();
    if (response.status() >= 500) {
      failures.push({ type: "response", message: `${response.status()} ${url}` });
    }
  });

  return {
    async assertClean() {
      if (failures.length) {
        await testInfo.attach("qa-failures.json", {
          body: JSON.stringify(failures, null, 2),
          contentType: "application/json"
        });
      }
      expect(failures).toEqual([]);
    }
  };
}

export async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
}

export async function expectNoBrokenImages(page: Page) {
  const broken = await page.evaluate(() =>
    Array.from(document.images)
      .filter((image) => image.complete && image.naturalWidth === 0)
      .map((image) => image.currentSrc || image.src || image.alt)
  );
  expect(broken).toEqual([]);
}

export async function expectNoSensitiveCustomerText(page: Page) {
  const text = await page.locator("body").innerText();
  expect(text).not.toMatch(/OpenAI|Google Maps|Hunter|Resend|Clerk|PostgreSQL|Railway|Sentry|LogRocket|PostHog|HTTP 4\d\d|HTTP 5\d\d|DATABASE_URL|API key|Bearer token|Traceback|SQLAlchemy/i);
}

export async function expectKeyboardCanReachPrimaryAction(page: Page, label: RegExp | string) {
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: label }).or(page.getByRole("button", { name: label })).first()).toBeVisible();
}
