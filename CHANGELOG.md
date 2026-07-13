# CHANGELOG

## 2026-07-13

### Fixed

- API: Prevented 500 crash in workspace company enrichment restart endpoint.
  - Endpoint: `POST /api/workspace-app/companies/{company_id}/enrichment/restart`
  - Previous behavior: unhandled enqueue exceptions returned 500 and broke `Run all missing steps` flow.
  - New behavior: returns `partial_success` with warning while preserving saved company/workflow state.

### Tests

- Added: `test_workspace_app_company_enrichment_restart_handles_enqueue_failure`
- Verified: `test_workspace_app_company_enrichment_restart_and_cancel`
- Full backend regression suite: PASS (148 tests)

### Customer Impact

- High-severity workflow unblock: customers can continue company workflow even when enrichment queue enqueue fails temporarily.
