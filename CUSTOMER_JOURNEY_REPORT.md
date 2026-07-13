# CUSTOMER JOURNEY REPORT

Date: 2026-07-13
Environment: Production
Test mode: Real customer path in authenticated session
Account target: romaniukvadym10@gmail.com

## Current Run Summary

Authenticated customer navigation is working across dashboard routes.
Confirmed production issue: company auto-enrichment restart action returned HTTP 500 for multiple companies.
Four hardening fixes implemented in API and covered with regression tests; latest deployment verification is in progress.

## Journey Coverage (Current)

1. Dashboard: PASS
2. Companies list and company workspace: PASS
3. Leads: PASS
4. Campaigns: PASS
5. Inbox: PASS
6. Billing page load: PASS
7. Settings page load: PASS
8. Enrichment restart action: FAIL (fixed in code, pending production verification)

## Confirmed Production Bug

Issue: `Run all missing steps` in company cards triggers API 500.

Reproduction:
1. Open `/dashboard/companies`
2. Click `Run all missing steps` on any company card
3. Observe request to `/api/backend/api/workspace-app/companies/{id}/enrichment/restart`
4. Response status is 500

Observed evidence in browser session:
- 500 for company `da4ed1eb-5aed-4253-9269-6b89e9d1ea08`
- 500 for company `74abcfd0-7c4c-4a00-a534-d9c912fa4e8f`
- 500 for company `8dfdde50-b232-4d5d-ac46-14949567472a`

Severity: High

Customer impact:
- Core AI enrichment recovery path fails for active opportunities.
- Users cannot reliably restart missing-step completion.

Root cause:
- Previously identified unhandled paths in restart setup/enqueue/serialization were guarded.
- Production still has at least one remaining unhandled exception path returning 500; latest patch adds a top-level unexpected-exception fallback.

Fix:
- `restart_company_auto_enrichment` now catches enqueue exceptions and returns `partial_success` with warning instead of 500.
- Saved company data remains available and workflow state is preserved.
- Added setup and response-serialization fallback handling in the same endpoint.
- Added top-level fallback for any unexpected restart exception and tagged observability endpoint `workspace_app.enrichment_restart_unhandled`.

## Validation

- Targeted tests: PASS
	- `test_workspace_app_company_enrichment_restart_and_cancel`
	- `test_workspace_app_company_enrichment_restart_handles_enqueue_failure`
	- `test_workspace_app_company_enrichment_restart_handles_sync_failure`
	- `test_workspace_app_company_enrichment_restart_handles_company_out_failure`
	- `test_workspace_app_company_enrichment_restart_handles_unexpected_failure`
- Full backend suite: PASS (151 passed)

## Status

IN PROGRESS

Reason:
- High-severity bug was fixed and tested locally across enqueue/setup/serialization failure paths.
- Production still returns 500 for the same restart request (`x-request-id: c892f49e-d7b8-4820-8c0a-2c10a6ec252c`), so the blocker remains active and requires production log-level root cause confirmation.
