import { expect, test, type Page, type Route } from "@playwright/test";
import { mockWorkspaceApi, qaCompany } from "../../mocks/workspace-api";
import { installQaGuards } from "../helpers/qa-guards";

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ page }) => {
  await mockWorkspaceApi(page);
});

const finderResult = {
  id: "finder-result-1",
  company_name: "EuroScale CRM Co",
  official_website: "https://euroscale-crm.co",
  industry: "B2B SaaS",
  country: "Germany",
  company_size: "20-200",
  contact_name: "Sarah Meyer",
  contact_title: "Head of Sales",
  public_work_contact: "sarah.meyer@euroscale-crm.co",
  signal_type: "hiring_related_workflow",
  signal_description: "Hiring SDRs while replacing manual spreadsheet CRM workflows.",
  signal_date: "Unknown",
  source_url: "https://euroscale-crm.co/careers",
  source_title: "Careers",
  source_type: "careers_page",
  evidence_summary: "Public careers page shows active SDR hiring.",
  fit_explanation: "B2B SaaS company in Germany with a sales hiring signal.",
  ai_relevance_score: 91,
  confidence_score: 88,
  verified_status: "Verified",
  checked_at: "2026-07-18T12:00:00.000Z",
  canonical_source_url: "https://euroscale-crm.co/careers",
  publication_date: "Unknown",
  first_line_opener: "Saw you are hiring SDRs while scaling outbound.",
  draft_email: "Hi Sarah, saw EuroScale is hiring SDRs while improving CRM workflows. Worth a quick look at a faster research-to-email flow?",
  email_body: "Hi Sarah, saw EuroScale is hiring SDRs while improving CRM workflows. Worth a quick look at a faster research-to-email flow?"
};

function finderJob(overrides: Record<string, unknown> = {}) {
  return {
    id: "finder-job-1",
    status: "completed",
    progress: { stage: "completed", message: "Verified results are ready.", percent: 100, verified: 1, partially_verified: 0, unknown: 0, rejected: 0, saved: 0, candidates: 1 },
    summary: { verified: 1, partially_verified: 0, unknown: 0, rejected: 0, saved_to_crm: 0, candidates: 1 },
    results: [finderResult],
    created_at: "2026-07-18T12:00:00.000Z",
    completed_at: "2026-07-18T12:00:05.000Z",
    ...overrides
  };
}

async function submitCustomerSearch(page: Page) {
  const form = page.getByRole("form", { name: "Customer search" });
  await form.getByLabel("Product website").fill("https://outreachaiaiai.com");
  await form.getByLabel("Target customer").fill("B2B SaaS companies hiring sales teams in Europe.");
  await form.getByLabel("Country").fill("Germany");
  await form.getByLabel("Industry").fill("B2B SaaS");
  await form.getByRole("button", { name: "Find customers" }).click();
}

async function routeFinderSearch(page: Page, handler: (route: Route) => Promise<void>) {
  await page.route("**/api/workspace-app/leads/first-customers/search", handler);
}

test("customer search has loading, success, manual CRM save, and no global crash", async ({ page }, testInfo) => {
  const guards = installQaGuards(page, testInfo);
  let searchRequests = 0;
  await routeFinderSearch(page, async (route) => {
    searchRequests += 1;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(finderJob()) });
  });

  await page.goto("/dashboard/leads");
  await submitCustomerSearch(page);
  await expect(page.getByText("Verified results are ready. Save only the companies you want in CRM.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "EuroScale CRM Co" })).toBeVisible();
  await expect(page.getByText("sarah.meyer@euroscale-crm.co")).toBeVisible();
  await page.getByRole("button", { name: "Save to CRM" }).click();
  await expect(page.getByText("Lead saved to CRM. Outreach draft is ready for manual review.")).toBeVisible();
  expect(searchRequests).toBe(1);
  await guards.assertClean();
});

test("customer search empty result finishes with guidance and keeps the form usable", async ({ page }, testInfo) => {
  const guards = installQaGuards(page, testInfo);
  await routeFinderSearch(page, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(finderJob({ results: [], summary: { verified: 0, partially_verified: 0, unknown: 0, rejected: 0, saved_to_crm: 0, candidates: 0 }, error_message: "No verified companies were found. Broaden the criteria and try again." })) });
  });

  await page.goto("/dashboard/leads");
  await submitCustomerSearch(page);
  await expect(page.getByText("No verified companies were found. Broaden the criteria and try again.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Find customers" })).toBeEnabled();
  await expect(page.getByText("Searching public sources and verifying every result before showing it.")).not.toBeVisible();
  await guards.assertClean();
});

test("customer search timeout and provider errors never leave an infinite spinner", async ({ page }, testInfo) => {
  installQaGuards(page, testInfo);
  await routeFinderSearch(page, async (route) => {
    await route.fulfill({ status: 504, contentType: "application/json", body: JSON.stringify({ detail: "This request took too long. Please try again with narrower criteria." }) });
  });

  await page.goto("/dashboard/leads");
  await submitCustomerSearch(page);
  await expect(page.getByText("This request took too long. Please try again with narrower criteria.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Find customers" })).toBeEnabled();
  await expect(page.getByText("Something went wrong. Please refresh or sign in again.")).not.toBeVisible();
});

test("customer search can recover by rerunning the same criteria", async ({ page }, testInfo) => {
  installQaGuards(page, testInfo);
  let attempts = 0;
  await routeFinderSearch(page, async (route) => {
    attempts += 1;
    if (attempts === 1) {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ detail: "Search is temporarily unavailable. Please try again." }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(finderJob({ results: [{ ...finderResult, company_name: "Retry Build GmbH" }] })) });
  });

  await page.goto("/dashboard/leads");
  await submitCustomerSearch(page);
  await expect(page.getByText("Search is temporarily unavailable. Please try again.")).toBeVisible();
  await page.getByRole("button", { name: "Find customers" }).click();
  await expect(page.getByRole("heading", { name: "Retry Build GmbH" })).toBeVisible();
  expect(attempts).toBe(2);
});

test("CRM stage and note actions provide visible feedback", async ({ page }, testInfo) => {
  const guards = installQaGuards(page, testInfo);
  await page.goto("/dashboard/crm");
  await page.getByRole("main").getByRole("combobox").selectOption("Not Interested");
  await page.getByRole("button", { name: /Update stage/ }).click();
  await expect(page.getByText("CRM stage updated.")).toBeVisible();
  await page.getByLabel("Notes and history").fill("Follow up next week.");
  await page.getByRole("button", { name: /Add note/ }).click();
  await expect(page.getByText("Note saved.")).toBeVisible();
  await expect(page.getByText("Follow up next week.").first()).toBeVisible();
  await guards.assertClean();
});

test("blocked send explains sender setup and keeps send disabled", async ({ page }, testInfo) => {
  const guards = installQaGuards(page, testInfo);
  await page.route("**/api/outreach/sender/status", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ connected: false, status: "needs_setup", next_action: "Connect your sending email in Settings before sending." }) });
  });

  await page.goto("/dashboard/inbox");
  await expect(page.getByText("Connect your sending email in Settings before sending.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Send manually" }).first()).toBeDisabled();
  await guards.assertClean();
});

test("first successful send requires approval and a second explicit confirmation", async ({ page }, testInfo) => {
  const guards = installQaGuards(page, testInfo);
  await page.goto("/dashboard/inbox");
  await page.getByRole("button", { name: "Approve" }).first().click();
  await expect(page.getByText("Email approved. It is ready to send, but nothing was sent automatically.")).toBeVisible();
  await page.getByRole("button", { name: "Send manually" }).first().click();
  await expect(page.getByText("Confirm the recipient and click Confirm send. Nothing has been sent yet.")).toBeVisible();
  await page.getByRole("button", { name: "Confirm send" }).click();
  await expect(page.getByText("Approved email was sent. CRM stage updated.")).toBeVisible();
  await expect(page.locator("body")).not.toContainText("CRM stage updated to Contacted");
  await guards.assertClean();
});

test("saved CRM result still shows the evidence source without provider internals", async ({ page }, testInfo) => {
  const guards = installQaGuards(page, testInfo);
  await page.goto("/dashboard/crm");
  await expect(page.getByRole("heading", { name: qaCompany.name, exact: true })).toBeVisible();
  await expect(page.getByText("Public source recorded")).toBeVisible();
  await expect(page.locator("body")).not.toContainText("google_maps_hunter");
  await expect(page.locator("body")).not.toContainText("source_provider");
  await guards.assertClean();
});
