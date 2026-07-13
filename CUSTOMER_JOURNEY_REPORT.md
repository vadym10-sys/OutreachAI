# CUSTOMER JOURNEY REPORT

Date: 2026-07-13
Environment: Production
Test mode: Real customer path in authenticated session
Account target: romaniukvadym10@gmail.com

## Current Run Summary

Authenticated customer navigation is working across dashboard routes.
Confirmed production issue: company auto-enrichment restart action returned HTTP 500 for multiple companies.
Two hardening fixes implemented in API and covered with regression tests; second deployment verification is in progress.

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
- Unhandled exception path in enrichment enqueue flow bubbled from restart endpoint as 500.

Fix:
- `restart_company_auto_enrichment` now catches enqueue exceptions and returns `partial_success` with warning instead of 500.
- Saved company data remains available and workflow state is preserved.

## Validation

- Targeted tests: PASS
	- `test_workspace_app_company_enrichment_restart_and_cancel`
	- `test_workspace_app_company_enrichment_restart_handles_enqueue_failure`
	- `test_workspace_app_company_enrichment_restart_handles_sync_failure`
- Full backend suite: PASS (148 passed)

## Status

IN PROGRESS

Reason:
- High-severity bug was fixed and tested locally.
- Production deployment verification of the exact restart action is the next step.
