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
  /preloaded with link preload was not used/i,
  /LogRocket: script could not load/i,
  /OutreachAI API request failed/i,
  /Dashboard supporting data could not be loaded/i
];

const ignoredFailedRequestPatterns = [
  /\/sign-in\?redirect_url=.*\/dashboard/,
  /cdn\.logr-in\.com\/logger-1\.min\.js/
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
    if (!ignoredFailedRequestPatterns.some((pattern) => pattern.test(url))) {
      failures.push({ type: "requestfailed", message: `${url} ${request.failure()?.errorText || ""}`.trim() });
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
