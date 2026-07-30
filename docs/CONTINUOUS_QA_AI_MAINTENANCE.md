# Continuous QA and AI Maintenance

This branch keeps the useful production QA pieces from PR #15 without restoring older dependencies, cleanup endpoints, or mutating production smoke tests.

## Production Checks

- Production smoke is read-only. It may load public pages, protected routes, health endpoints, and authenticated dashboard views.
- It must not send email, mutate CRM records, write database rows, update Railway, change settings, delete customer data, or deploy.
- Any future production mutation test must use a separate explicit approval flow and must not be scheduled by default.

## Workflows

- `CI` remains the full pull request gate for lint, typecheck, unit tests, build, and Playwright E2E.
- `Security` adds npm production audit, Python dependency audit, and CodeQL.
- `Production Smoke Read-Only` runs scheduled health and Playwright smoke checks against production URLs.

## Dependabot Policy

- Dependabot opens grouped patch and minor update PRs for web npm and API pip dependencies.
- Major updates are never auto-merged.
- Sensitive areas such as auth, billing, security, database, email, Stripe, Clerk, Sentry, webhooks, migrations, and models are excluded from auto-merge.
- Auto-merge is only enabled after successful `CI` and `Security` checks for the Dependabot PR head SHA.

## Handling Failures

1. Reproduce failures from the uploaded artifacts and read-only logs.
2. Fix on a separate branch.
3. Add or update a regression test.
4. Do not merge, deploy, change production secrets, or alter production data without explicit approval.
