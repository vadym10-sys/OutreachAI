# OutreachAI Production QA

This folder contains customer-facing Playwright QA suites. The goal is to block regressions that would hurt activation, trust, billing, CRM persistence, mobile usability, or production reliability.

## Structure

- `auth/` - sign-in, sign-up, password recovery, protected-route redirects.
- `dashboard/` - every core dashboard/workspace route.
- `settings/` - workspace readiness and advanced settings UX.
- `api/` - public Next.js API safety checks.
- `payments/` - pricing and billing surface smoke tests.
- `accessibility/` - keyboard, landmarks, mobile navigation.
- `performance/` - browser performance smoke checks.
- `security/` - technical-data leak and injection smoke checks.
- `regression/` - critical customer workflow regressions.
- `users/`, `mobile/` - reserved suites for deeper role and device-specific coverage.

## Local commands

```bash
npm run lint
npm run typecheck
npm test -- --run
npm run build
npm run e2e
npm run qa:diagnose
```

## Reports

Playwright generates:

- `playwright-report/` - HTML report.
- `test-results/` - traces, screenshots, videos.
- `test-artifacts/playwright-results.json` - machine-readable results.
- `test-artifacts/qa-diagnosis.md` - failure diagnosis summary.

GitHub Actions uploads these folders as artifacts on every push and pull request.
