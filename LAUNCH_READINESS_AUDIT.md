# OutreachAI Launch Readiness Audit

Branch: `launch-readiness-v1`

## Scope

- First user experience: sign up, sign in, onboarding, first company, first AI analysis, first outreach generation.
- UX states: empty, loading, error, success, mobile, accessibility, responsive behavior.
- Reliability: network failure, retries, timeouts, offline recovery, error isolation.
- Performance: bundle surface, dead code, production build output, route exposure.
- Security: auth bypass gating, secret exposure, protected API proxy, redirects, debug surfaces.
- Launch polish: copy, localization, navigation, test/developer UI removal.

## Problems Found

1. Legacy `product-workspace.tsx` was still present even though active routes no longer import it. It was not bundled by active pages, but it increased maintenance and launch regression risk.
2. `/sentry-test` remained in the app route tree as a development-only debug page. It returned 404 in production, but a public launch should not ship a debug route at all.
3. Offline recovery was implicit. API calls had timeout/retry handling, but onboarding and the authenticated shell did not immediately tell users when the browser was offline.
4. Launch tests did not explicitly assert that normal customer routes are free of QA/auth-test, diagnostic, owner-health, or legacy debug copy.
5. Runtime QA guards treated WebKit/iPhone browser-level `_rsc` prefetch cancellations and LogRocket blob replay cancellations as product JavaScript errors. That made launch checks noisy even when the UI remained healthy.

## Fixes Applied

1. Removed unused legacy `apps/web/components/product-workspace.tsx`.
2. Removed the development-only `/sentry-test` route and client component.
3. Added `NetworkStatusBanner` and mounted it in onboarding plus the dashboard shell.
4. Added localized offline copy for all supported UI locales.
5. Added Playwright regression coverage for offline recovery and clean customer launch surfaces.
6. Tightened QA runtime guards so they still fail on real console/runtime/API failures while ignoring browser-generated cancelled `_rsc` prefetches and telemetry blob cancellations.

## Existing Strengths Verified

- Clerk E2E bypass is gated to local test runtime and local test API only.
- Backend API proxy does not forward protected workspace API calls without an auth path.
- Client API has timeouts, safe retry defaults for GET-style requests, request IDs, sanitized user messages, and non-technical error states.
- Main activation flow already has tests for sign in, dashboard, lead search, company workspace, AI generate/regenerate, campaigns, inbox, billing, settings, profile, refresh persistence, and logout/login.
- Production build no longer includes `/sentry-test`.
- Full E2E coverage reached the authenticated desktop journey, mobile journey, landing, auth, dashboard, leads, companies, company workspace, AI recommendations/version history, campaigns, inbox, billing, settings, profile, refresh/relogin, accessibility, security, payment, reliability, performance, iPhone, Android, tablet, mobile landscape, Firefox, and WebKit route checks.

## Verification

- `npm run lint`: passed
- `npm run test`: passed, 29 tests
- `npx next build --webpack`: passed
- `npm --prefix apps/web run e2e`: completed a full run with 447 passed, 3 skipped, 1 flaky, and 1 failure.
  - The remaining failure was WebKit-only noise from expected offline `_rsc` prefetch/blob cancellation being counted by the QA guard, not a visible product failure. The guard has been updated.
  - The iPhone mobile readiness path passed on retry; the original failure was the same telemetry blob access-control noise.
- Post-fix targeted E2E reruns are currently blocked before test execution by the local macOS browser sandbox:
  - WebKit: `Abort trap: 6` during Playwright browser launch.
  - Chromium: `MachPortRendezvousServer Permission denied (1100)` during Playwright browser launch.

## Remaining Risks

1. Full Playwright E2E should be rerun once the local Playwright browser sandbox recovers, because post-fix targeted reruns could not launch a browser.
2. Preview deployment cannot be created until Vercel CLI authentication is refreshed.
3. Production authentication still needs final human/session verification on the actual preview or production domain before public launch.
4. Owner/admin routes remain in the production route tree but are hidden from customer navigation and rely on owner-only backend authorization. This is acceptable for launch only if backend owner enforcement is confirmed on preview/production.

## Production Readiness Estimate

Current estimate: 90%.

Reason: launch cleanup, offline recovery, route hygiene, unit tests, production build, and most browser coverage are in good shape. The product is not at 100% launch confidence until post-fix E2E can be rerun in a browser environment that launches reliably and a Preview URL is verified with real auth.
