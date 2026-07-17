# Railway PostgreSQL Backups Runbook

OutreachAI readiness reports `database_backups_configured=true` only when the backend service has `DATABASE_BACKUPS_ENABLED=true`, a backup provider is configured, the latest backup finished successfully, and restore verification passed.

Do not set this variable until Railway PostgreSQL backups or the external `pg_dump` fallback are actually configured and a restore path has been verified.

## Current production status

Last checked: 2026-07-17.

Production Postgres volume:

- service: `Postgres`
- volume: `postgres-volume`
- mount path: `/var/lib/postgresql/data`
- state: `READY`
- size: 5000 MB

Railway backup API result:

- backup schedules: none
- existing backups: none
- creating a manual backup with the current CLI/API credentials returned `Not Authorized`
- enabling a `DAILY` backup schedule with the current CLI/API credentials returned `Not Authorized`

Operational conclusion:

- `database_backups_configured` must remain `false` until a successful backup and restore verification are recorded.
- Production `/api/ready` is a release gate and returns degraded when backups are not confirmed.
- Do not add `DATABASE_BACKUPS_ENABLED=true` yet.
- Railway CLI is authenticated for the project, but the current shell cannot reach Railway GraphQL backup-management endpoints directly. Use Railway Dashboard or Railway agent tooling to apply backup settings.
- There is no confirmed external `pg_dump` target in production variables. Do not claim backups are configured unless either Railway backups are enabled or a tested external backup target is added.

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
9. Redeploy `outreachai-api`.
10. Verify `/api/ready` returns `"database_backups_configured": true`.

## Automatic external backup service

If Railway managed backups are unavailable or insufficient, OutreachAI includes a config-as-code cron service:

- config: `apps/api/railway.backup.toml`
- schedule: `0 2 * * *` (daily at 02:00 UTC)
- command: `python -m app.jobs.run_database_backup`
- expected behavior: run `pg_dump`, upload the archive, verify restore against `BACKUP_RESTORE_TEST_DATABASE_URL`, record the run, then exit
- retention defaults: at least 30 days and 30 retained backups

Required production variables for the backup cron service and backend:

- `DATABASE_BACKUPS_ENABLED=true`
- `BACKUP_PROVIDER=aws_s3`, `cloudflare_r2`, `backblaze_b2`, or `gcs`
- `BACKUP_BUCKET`
- `BACKUP_PREFIX=outreachai/postgres`
- `BACKUP_RETENTION_DAYS=30` or higher
- `BACKUP_RETENTION_COUNT=30` or higher
- `BACKUP_RESTORE_TEST_DATABASE_URL`
- provider credentials (`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_REGION` / `S3_ENDPOINT_URL`, or `GOOGLE_APPLICATION_CREDENTIALS`)

After deploying the cron service, trigger one manual run from Railway or the owner-only `POST /api/backups/run` endpoint. Keep `DATABASE_BACKUPS_ENABLED=false` until that run succeeds and `restore_verified=true`.

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
7. Confirm `/api/backups/status` reports `backups_enabled=true` and `restore_verified=true`.
8. Confirm `/api/ready` reports `status=ready`, `database_backups_configured=true`, and no `database_backups_not_confirmed` warning.

## Ownership

The owner or CTO is responsible for:

- weekly backup status checks,
- monthly restore drill in a safe environment,
- documenting the latest successful restore test date,
- removing `DATABASE_BACKUPS_ENABLED=true` if backups are disabled, stale, or restore verification fails.

## External fallback if Railway backups are unavailable

Only use this path if Railway backups cannot be enabled on the current plan.

OutreachAI includes an owner-only backup control plane:

- `GET /api/backups/status`
- `POST /api/backups/run`

Both endpoints require the owner account.

`/api/ready` reports `database_backups_configured=true` only when all of these are true:

1. `DATABASE_BACKUPS_ENABLED=true`
2. a backup provider is configured
3. the latest backup finished successfully
4. restore verification passed

Required production variables for an external `pg_dump` strategy:

- `BACKUP_STORAGE_PROVIDER`
- `BACKUP_BUCKET`
- provider-specific access key/secret or service account
- `BACKUP_RETENTION_DAYS`

Supported providers:

- `aws_s3`
- `cloudflare_r2`
- `google_cloud_storage`
- `backblaze_b2`
- `local` for development only

Environment variables:

- `BACKUP_PROVIDER`: `aws_s3`, `cloudflare_r2`, `backblaze_b2`, `gcs`, or `local`
- `BACKUP_BUCKET`: target bucket for cloud providers
- `BACKUP_PREFIX`: object prefix, default `outreachai/postgres`
- `BACKUP_RETENTION_DAYS`: minimum 30 for production
- `BACKUP_RETENTION_COUNT`: minimum 30 for production
- `BACKUP_RESTORE_TEST_DATABASE_URL`: staging database used to verify restore
- `AWS_ACCESS_KEY_ID`: S3-compatible access key
- `AWS_SECRET_ACCESS_KEY`: S3-compatible secret
- `AWS_REGION`: AWS region or provider-compatible region
- `S3_ENDPOINT_URL`: required for Cloudflare R2 and Backblaze B2
- `GOOGLE_APPLICATION_CREDENTIALS`: required for GCS

Minimum acceptable fallback:

1. Scheduled job runs `pg_dump` against production PostgreSQL.
2. Dump is compressed and encrypted.
3. Dump is uploaded to S3, Cloudflare R2, Google Cloud Storage, or another durable object store.
4. Job logs success/failure and alerts on failure.
5. Restore drill is completed against a staging database.
6. Only after a successful restore drill may `DATABASE_BACKUPS_ENABLED=true` be set.

Do not store production backups only inside the same Railway project or container filesystem.

## Scheduling external backups

Use a Railway cron service or external scheduler to run:

```bash
python -m app.jobs.run_database_backup
```

Recommended schedule:

- daily at 02:00 UTC
- keep at least 30 successful backups
- alert immediately on failure

## RPO and RTO

- RPO target: 24 hours with daily backups.
- RTO target: 30-60 minutes for a normal restore into a fresh PostgreSQL database.
- RTO may be longer if the latest backup must be downloaded from external storage or if DNS/service cutover is required.
