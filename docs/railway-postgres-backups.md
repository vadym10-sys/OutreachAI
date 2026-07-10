# Railway PostgreSQL Backups Runbook

OutreachAI readiness reports `database_backups_configured=true` only when the backend service has `DATABASE_BACKUPS_ENABLED=true`.

Do not set this variable until Railway PostgreSQL backups are actually configured and a restore path has been reviewed.

## Enable backups

1. Open Railway Dashboard.
2. Open the OutreachAI production project.
3. Open the `Postgres` database service.
4. Open the `Backups` tab for the attached `postgres-volume`.
5. Enable at least one scheduled backup:
   - Daily for operational recovery.
   - Weekly or monthly for longer retention if required.
6. Trigger one manual backup after enabling the schedule.
7. Confirm the backup appears as successful in the Backups tab.
8. Add `DATABASE_BACKUPS_ENABLED=true` only to the backend service (`outreachai-api`).

## Verify latest backup

1. Open Railway Dashboard.
2. Open `Postgres` -> `Backups`.
3. Confirm the latest successful backup timestamp is within the expected schedule.
4. Confirm the backup belongs to the production environment and the active `postgres-volume`.
5. Check `https://outreachai-api-production.up.railway.app/api/ready`.
6. The response should include `"database_backups_configured": true`.

## Restore drill

1. Pick a non-critical backup in Railway `Postgres` -> `Backups`.
2. Use `Restore` from the backup row.
3. Railway stages a restored volume for review.
4. Review the staged changes before deploying.
5. Prefer restoring to a staging/sandbox database for drills. Do not overwrite production unless there is an approved incident recovery decision.
6. After restore, verify:
   - application starts,
   - `/api/health` returns 200,
   - `/api/live` returns 200,
   - `/api/ready` returns 200,
   - key CRM tables have expected record counts.

## Ownership

The owner or CTO is responsible for:

- weekly backup status checks,
- monthly restore drill in a safe environment,
- documenting the latest successful restore test date,
- removing `DATABASE_BACKUPS_ENABLED=true` if backups are disabled, stale, or restore verification fails.
