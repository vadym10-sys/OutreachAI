# AI Tasks Staging Readiness

This checklist prepares AI Tasks for a controlled staging launch only. It does not change production environment variables, production feature flags, production data, or provider credentials.

## Required Staging Setup

1. Provision a separate staging database.
2. Create a separate Railway staging service that points only to the staging database.
3. Create a separate Vercel Preview or staging frontend deployment.
4. Set `AI_CONTROL_PLANE_ENABLED=true` only on the staging backend service.
5. Set `AI_CONTROL_PLANE_FORCE_DRY_RUN=true` on the staging backend service.
6. Set `NEXT_PUBLIC_ENABLE_AI_TASKS_NAV=true` only on the staging frontend deployment.
7. Use fake or sandbox providers only. Do not connect production Gmail, SMTP, Resend, enrichment, or paid provider credentials.
8. Use one controlled test workspace with known owner access and synthetic test records.
9. Record staging DB counts before each test run for `companies`, `leads`, `email_messages`, and agent runtime tables.
10. Run the AI Tasks flow without any real sending. Confirm provider call recorders and send logs stay empty.
11. Record staging DB counts after the run and verify no CRM or email side-effect rows were created by forced dry-run agent runs.
12. Roll back flags to false when the staging test window ends:
    - `AI_CONTROL_PLANE_ENABLED=false`
    - `AI_CONTROL_PLANE_FORCE_DRY_RUN=false`
    - `NEXT_PUBLIC_ENABLE_AI_TASKS_NAV=false`

## Validation Before Enabling Staging

- Confirm production still has `AI_CONTROL_PLANE_ENABLED=false` or unset.
- Confirm production still has `NEXT_PUBLIC_ENABLE_AI_TASKS_NAV=false` or unset.
- Confirm direct production AI Tasks route remains fail-closed.
- Confirm staging status API returns `force_dry_run=true`.
- Confirm the UI dry-run checkbox is checked and disabled when `force_dry_run=true`.
- Confirm client payloads cannot disable dry-run, and backend-created runs still persist `dry_run=true`.
- Confirm approve and resume keep effective dry-run enabled.
- Confirm `send_email` remains blocked fail-closed in AI Tasks.
- Confirm read-only tools can run under dry-run.
- Confirm traces redact email bodies, secrets, raw provider errors, and internal stack details.

## Rollback

Disable staging access by setting:

- `NEXT_PUBLIC_ENABLE_AI_TASKS_NAV=false`
- `AI_CONTROL_PLANE_ENABLED=false`
- `AI_CONTROL_PLANE_FORCE_DRY_RUN=false`

Do not use production as staging.
