# Continuous QA and AI Bug Fixing

This runbook defines production monitoring and safe maintenance for OutreachAI.

## Existing Coverage

- Pull request CI runs web lint, typecheck, unit tests, production build, full Playwright E2E, API Ruff, and API pytest.
- Playwright already stores HTML reports, JSON/JUnit reports, traces, screenshots, and videos on failures.
- The web app has Sentry entrypoints and the API initializes Sentry when `SENTRY_DSN` is configured.
- The API exposes `/api/health`, `/api/live`, `/api/ready`, and `/api/admin/queue/health`.
- Railway service configs exist for the API and worker.

## Added Coverage

- Scheduled production health checks for `outreachaiaiai.com`, API health, API readiness, and worker queue health when the bearer secret is configured.
- Production Playwright smoke tests for desktop and mobile using `apps/web/playwright.production.config.ts`.
- Authenticated production smoke support through either `PRODUCTION_AUTH_STORAGE_STATE` or `PRODUCTION_E2E_EMAIL` and `PRODUCTION_E2E_PASSWORD`.
- Mutation smoke is opt-in and limited to `E2E_TEST` data through `PRODUCTION_SMOKE_MUTATION_ENABLED=true`.
- Safe cleanup hook refuses to run unless the run id and prefix start with `E2E_TEST`.
- Dependency audit, Python dependency audit, CodeQL, Dependabot config, and safe patch auto-merge guard.
- Sentry PII scrubbing for frontend and backend telemetry.
- Scheduled production failures create GitHub Issues with sanitized evidence links.

## Schedule

- Pull request CI: every pull request and push.
- Production smoke: every 30 minutes and manual dispatch.
- Security checks: every pull request, pushes to `main`, daily at 03:17 UTC, and manual dispatch.
- Dependabot patch checks: daily, with auto-merge enabled only when all repository branch protection checks are green.

## Production Smoke Scenarios

- Public web: `/`, `/sign-in`, `/sign-up`, `/pricing`.
- Protected route while signed out: `/dashboard` must not expose workspace data.
- Authenticated web: dashboard, Settings, CRM companies, Email Approval, and Inbox surfaces must render without 5xx API responses or secret leaks.
- Gmail OAuth: Settings must expose sender/OAuth status; set `PRODUCTION_REQUIRE_GMAIL_CONNECTED=true` to fail when the test mailbox is not connected.
- Customer Finder and draft generation: opt-in mutation smoke submits an `E2E_TEST_*` command and verifies a draft-oriented flow without clicking send.
- Manual Approval and Reply Tracking: smoke verifies approval/send separation and inbox/status visibility. Real send actions are never clicked by the test.
- Stripe test flow: CI covers billing/pricing routes and secret leakage. Production Stripe mutation is manual-only unless a dedicated test-mode billing sandbox is explicitly provided.

## AI Bug Fixing Rules

When a production smoke or CI failure is confirmed:

1. Reproduce the failure locally or with the failed Playwright trace.
2. Create or use the sanitized GitHub Issue from the failed scheduled run.
3. Create a separate branch.
4. Make the minimal fix.
5. Add a focused regression test.
6. Run lint, typecheck, unit tests, API tests, Playwright, and production build.
7. Open a pull request containing root cause, changed files, risks, and test results.

No automatic merge to `main` is allowed for application fixes.

## Manual Approval Required

Explicit human confirmation is required before:

- Merging non-Dependabot application changes.
- Deploying production changes.
- Changing Stripe live settings, Gmail OAuth credentials, production secrets, or DB schema.
- Sending real email.
- Deleting real user data.
- Running mutation smoke against production without an isolated test account.

## Dependabot Auto-Merge

Automatic merge is allowed only for Dependabot semver patch updates when branch protection checks are green and the change does not touch auth, billing, database, email, security, Stripe, Gmail/OAuth, Sentry, webhooks, models, migrations, or sensitive dependency names.

## Required GitHub Secrets and Variables

Secrets:

- `PRODUCTION_AUTH_STORAGE_STATE`
- `PRODUCTION_E2E_EMAIL`
- `PRODUCTION_E2E_PASSWORD`
- `PRODUCTION_QUEUE_HEALTH_BEARER`
- `PRODUCTION_E2E_CLEANUP_URL`
- `PRODUCTION_E2E_CLEANUP_TOKEN`
- `SENTRY_DSN`
- `NEXT_PUBLIC_SENTRY_DSN`

Variables:

- `PRODUCTION_WEB_URL`
- `PRODUCTION_API_URL`
- `PRODUCTION_SMOKE_MUTATION_ENABLED`
- `PRODUCTION_REQUIRE_GMAIL_CONNECTED`

Do not print secret values, tokens, cookies, email bodies, customer payloads, or personal data in workflow logs.
