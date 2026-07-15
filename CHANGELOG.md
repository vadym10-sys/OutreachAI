# CHANGELOG

## 2026-07-13

### Fixed

- API: Prevented 500 crash in workspace company enrichment restart endpoint.
  - Endpoint: `POST /api/workspace-app/companies/{company_id}/enrichment/restart`
  - Previous behavior: unhandled enqueue exceptions returned 500 and broke `Run all missing steps` flow.
  - New behavior: returns `partial_success` with warning while preserving saved company/workflow state.
- API: Added fail-safe handling for pre-enqueue restart setup failures.
  - Previous behavior: setup/sync exceptions could still return 500.
  - New behavior: setup/sync failures now also return `partial_success` with warning and current company state.
- API: Added fail-safe handling for company response serialization failures in restart flow.
  - Previous behavior: failures in `_crm_company_out` could still surface as 500.
  - New behavior: endpoint now returns `partial_success` with warning even when company payload serialization fails.
- API: Added final top-level fallback for unexpected restart errors.
  - Previous behavior: unhandled exceptions outside localized guards could still return 500.
  - New behavior: endpoint now returns `partial_success` with warning and logs tagged as `workspace_app.enrichment_restart_unhandled`.
- API: Added global 5xx downgrade for enrichment restart path in exception handlers.
  - Previous behavior: failures outside endpoint-local handling (for example dependency or late-stage unhandled 5xx) could still surface as HTTP 500.
  - New behavior: restart-path 5xx now return HTTP 200 `partial_success` with a safe fallback payload to keep customer workflow moving.

### Tests

- Added: `test_workspace_app_company_enrichment_restart_handles_enqueue_failure`
- Added: `test_workspace_app_company_enrichment_restart_handles_sync_failure`
- Added: `test_workspace_app_company_enrichment_restart_handles_company_out_failure`
- Added: `test_workspace_app_company_enrichment_restart_handles_unexpected_failure`
- Added: `test_workspace_app_company_enrichment_restart_downgrades_dependency_runtime_error`
- Added: `test_workspace_app_company_enrichment_restart_downgrades_dependency_http_500`
- Verified: `test_workspace_app_company_enrichment_restart_and_cancel`
- Full backend regression suite: PASS (153 tests)

### Customer Impact

- High-severity workflow unblock: customers can continue company workflow even when enrichment queue enqueue fails temporarily.

### Validation Notes

- Production re-check after latest deployment still returns HTTP 500 for `Run all missing steps` in authenticated customer flow.
- Latest observed failing request ids: `c892f49e-d7b8-4820-8c0a-2c10a6ec252c`, `3ba81abf-5f24-4f96-b0c5-d4f9f9985da4`, `ba438720-01c6-467a-8249-fd764a2e93ea`.
