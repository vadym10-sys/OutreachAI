# AI Tasks Staging Readiness

Last updated: 2026-08-18

This document records the isolated `ai-tasks-staging` infrastructure created for AI Tasks. Production and the pre-existing mixed `staging` Railway environment were not intentionally changed.

## Git Baseline

- Branch: `codex/ai-tasks-staging-infrastructure-v1`
- Base SHA: `eee0eda17a741a3b46932afa6169798441a5702f`
- Railway API/worker deployment source SHA: `eee0eda17a741a3b46932afa6169798441a5702f`
- Final clean Vercel Preview source SHA: `eee0eda17a741a3b46932afa6169798441a5702f`
- Repository: `vadym10-sys/OutreachAI`

## Railway Topology

Project: `respectful-presence`

Environment: `ai-tasks-staging`

Resources:

- Postgres: `Postgres-ai-tasks-staging`
  - Service ID: `5c81f497-1dc3-484e-8302-05eafdbb9c13`
  - Volume: `postgres-volume-TDln`
  - Volume size: 5000 MB
  - Restore/copy: none
  - Production data: not copied
- API: `outreachai-ai-tasks-api-staging`
  - Service ID: `e3adf588-4362-46b0-a7ea-78165648fb38`
  - Root: `apps/api`
  - Config: `/apps/api/railway.toml`
  - Public URL: `https://outreachai-ai-tasks-api-staging-ai-tasks-staging.up.railway.app`
  - Latest successful deployment: `22cb0f6a-34d2-4101-94a4-12fa3c3ad3c9`
  - Replicas: running `1`
- Worker: `outreachai-ai-tasks-worker-staging`
  - Service ID: `2c7cce87-0387-48c8-bad7-0bf8ebfbc916`
  - Root: `apps/api`
  - Config: `/apps/api/railway.worker.toml`
  - Public URL: none
  - Final state: no active deployment, no replicas

Worker note: Railway auto-deployed the worker after source connection. It was stopped with `railway down`. Runtime logs showed the enrichment worker process attempted to read `enrichment_jobs`, failed because that table is not present in the new DB, and then received SIGTERM. DNS logs showed only internal Postgres lookups and no provider domains. Keep this worker stopped until its startup path is made explicitly AI Tasks-safe.

## Railway Variables

Verified states for both API and worker:

- `APP_ENV`: `staging`
- `AI_CONTROL_PLANE_ENABLED`: `true`
- `AI_CONTROL_PLANE_FORCE_DRY_RUN`: `true`
- `AI_RATE_LIMIT_PER_MINUTE`: `3`
- `DATABASE_URL`: set, points to `Postgres-ai-tasks-staging`
- `ENCRYPTION_KEY`: set
- `AUTOMATION_SECRET`: set
- `OUTBOUND_PROVIDER_SENDS_DISABLED`: `true`
- `ENRICHMENT_WORKER_ENABLED`: `false`
- `AI_MEMORY_EMBEDDINGS_ENABLED`: `false`
- `AI_CUSTOMER_FINDER_AI_CLASSIFICATION_ENABLED`: `false`
- `DATABASE_BACKUPS_ENABLED`: `false`

Verified unset for both API and worker:

- `OPENAI_API_KEY`
- `CLERK_SECRET_KEY`
- `RESEND_API_KEY`
- `SMTP_HOST`
- `SMTP_USERNAME`
- `SMTP_PASSWORD`
- `GMAIL_CLIENT_ID`
- `GMAIL_CLIENT_SECRET`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `APOLLO_API_KEY`
- `HUNTER_API_KEY`
- `CLAY_API_KEY`
- `BUILTWITH_API_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`

## Migrations And Readiness

API readiness:

- `/api/live`: `200`, `{"status":"alive"}`
- `/api/ready`: `200`, `status=ready`
- Pending migrations: none
- Missing tables: none
- pgvector: available and installed
- Warning: `database_backups_not_confirmed` because backups are intentionally disabled for this isolated staging run

Packaged migrations confirmed applied:

- `022_agent_runtime_control_plane`
- `023_action_policy_enforcements`

Required tables confirmed present:

- `agent_runs`
- `agent_steps`
- `agent_tool_calls`
- `agent_approval_requests`
- `agent_trace_events`
- `action_policy_enforcements`
- `companies`
- `leads`
- `email_messages`

## Vercel Preview

Final clean Preview:

- URL: `https://outreach-ai-julh6tybo-vadym10-ai-1.vercel.app`
- Deployment ID: `dpl_AgnMhazaLP1hbsrVMonbPAz9xDJZ`
- Target: `preview`
- Ready state: `READY`
- Alias: none
- Production alias: not changed
- `outreachaiaiai.com`: not changed

Preview evidence:

- `githubCommitSha`: `eee0eda17a741a3b46932afa6169798441a5702f`
- `githubCommitRef`: `codex/ai-tasks-staging-infrastructure-v1`
- `gitRootDirectory`: `apps/web`
- `codexAiTasksStaging`: `true`
- `/api/client-config`: `environment=staging`, analytics disabled, session replay disabled
- `/api/backend/api/live`: proxied to staging API and returned `200`
- `/api/backend/api/ready`: proxied to staging API and returned `200`

Branch-scoped Preview variables were set or passed only for this staging branch:

- `NEXT_PUBLIC_ENABLE_AI_TASKS_NAV=true`
- `NEXT_PUBLIC_API_URL=https://outreachai-ai-tasks-api-staging-ai-tasks-staging.up.railway.app`
- `BACKEND_API_URL=https://outreachai-ai-tasks-api-staging-ai-tasks-staging.up.railway.app`
- `NEXT_PUBLIC_APP_ENV=staging`
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_replace_me`
- `CLERK_SECRET_KEY=staging_clerk_blocked`
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=` empty
- `NEXT_PUBLIC_ANALYTICS_ENABLED=false`
- `NEXT_PUBLIC_SESSION_REPLAY_ENABLED=false`

Production Vercel env metadata was checked separately; `NEXT_PUBLIC_ENABLE_AI_TASKS_NAV` was not present in Production scope.

Authenticated UI smoke is blocked until a separate staging Clerk application and test user are connected. Without that, `/dashboard/ai-tasks` redirects to `/sign-in?error=clerk_not_configured`, which is expected for this no-Clerk staging pass.

## Smoke Evidence

Smoke mode:

- Planner: fake/local planner
- Provider adapters: fake/local recorder
- OpenAI calls: `0`
- Estimated OpenAI cost: `$0.00`
- Gmail/SMTP/Resend/provider calls: `0`
- Real email sends: `0`

Runtime status from staging orchestrator:

- `enabled=true`
- `can_create_runs=true`
- `force_dry_run=true`
- registered tools: `9`

DB counts before final fake smoke:

| Table | Count |
| --- | ---: |
| `companies` | 0 |
| `leads` | 0 |
| `email_messages` | 0 |
| `agent_runs` | 1 |
| `agent_steps` | 3 |
| `agent_tool_calls` | 3 |
| `agent_approval_requests` | 1 |
| `agent_trace_events` | 8 |
| `action_policy_enforcements` | 2 |

DB counts after final fake smoke:

| Table | Count |
| --- | ---: |
| `companies` | 0 |
| `leads` | 0 |
| `email_messages` | 0 |
| `agent_runs` | 2 |
| `agent_steps` | 6 |
| `agent_tool_calls` | 6 |
| `agent_approval_requests` | 2 |
| `agent_trace_events` | 16 |
| `action_policy_enforcements` | 4 |

Final counts after worker stop stayed:

| Table | Count |
| --- | ---: |
| `companies` | 0 |
| `leads` | 0 |
| `email_messages` | 0 |
| `agent_runs` | 2 |
| `agent_steps` | 6 |
| `agent_tool_calls` | 6 |
| `agent_approval_requests` | 2 |
| `agent_trace_events` | 16 |
| `action_policy_enforcements` | 4 |

Smoke assertions:

- Input requested `dry_run=false`
- Persisted run had `dry_run=true`
- CRM step input had `dry_run=true`
- Draft step input had `dry_run=true`
- Approval state after create: `pending`
- Status after approval: `waiting_approval`
- Status after separate resume: `completed`
- Approve and resume were separate actions
- No automatic continuation after approval
- Company created: false
- Lead created: false
- EmailMessage created: false
- Provider message ID present: false
- Workspace B could not see Workspace A run
- Trace/API-like response redaction checks passed for email body, fake bearer marker, DB URL marker, OpenAI key shape, and raw provider error text

## Production And Old Staging State

Production Railway was checked read-only before and after. The same production services remained present after this work:

- `@outreachai/web`
- `outreachai-api`
- `outreachai-api-staging`
- `outreachai-db-backup`
- `outreachai-enrichment-worker`
- `Postgres`
- `Postgres-kPvA`

Production API after work:

- `/api/live`: `200`
- `/api/ready`: `200`, `status=ready`, no pending migrations

Production Vercel after work:

- Latest production deployment: `outreach-ai-ryjgwxf67-vadym10-ai-1.vercel.app`
- Target: `production`
- SHA: `eee0eda17a741a3b46932afa6169798441a5702f`
- Ref: `main`
- Domain `outreachaiaiai.com`: still attached to project `outreach-ai-web`

Pre-existing Railway `staging` was checked read-only after this work. Its service list was not modified by this task, and the new `ai-tasks-staging` services are not present there.

## Cost Controls

Railway usage guardrails:

- Workspace soft limit: `$25`
- Workspace hard limit: `$30`
- Workspace usage after work: about `$10.33`
- Workspace usage at start of staging provisioning: about `$10.28`
- Observed incremental usage during this task: about `$0.05`

Additional cost controls:

- Worker final state: no active deployment/replicas
- API uses minimal configured resource override: `0.5 vCPU`, `0.5 GB`
- Worker configured resource override: `0.5 vCPU`, `0.5 GB`, but stopped
- Postgres volume: 5000 MB Railway template minimum observed from CLI
- OpenAI budget used: `$0.00`
- Vercel Preview: created under existing plan, no production alias

Projected incremental Railway spend should remain under the owner-approved `$20` cap with worker stopped and no OpenAI/provider usage. The workspace hard limit also prevents unbounded Railway spend in the current billing period.

## Blocked Follow-ups

Live OpenAI smoke is blocked until a separate staging OpenAI project/key is connected safely:

- Create separate OpenAI staging project
- Set initial smoke budget to `$5`
- Keep max OpenAI spend to `$10` without fresh owner approval
- Add only the staging key to `ai-tasks-staging`, never production
- Run the minimum live planner calls

Authorized Clerk smoke is blocked until a separate staging Clerk application/test user is connected safely:

- Create a Clerk development/staging application
- Configure Preview-only `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- Configure backend-only staging `CLERK_SECRET_KEY` and issuer values
- Create a synthetic staging user
- Re-run authenticated Preview UI smoke

Worker startup is blocked until its command is made safe for this environment:

- Current `apps/api/railway.worker.toml` starts `python -m app.jobs.worker`
- That process starts the enrichment worker loop and does not stay inert even when `ENRICHMENT_WORKER_ENABLED=false`
- Keep worker stopped until the worker entrypoint or deployment config is changed to an AI Tasks-safe stopped/queue worker path

## Rollback

Safe rollback steps:

1. Keep worker stopped:
   - Confirm `outreachai-ai-tasks-worker-staging` has no active deployment.
   - If needed, run `railway down --environment ai-tasks-staging --service outreachai-ai-tasks-worker-staging --yes`.
2. Stop the staging API if this staging stack should go fully idle:
   - Run `railway down --environment ai-tasks-staging --service outreachai-ai-tasks-api-staging --yes`.
3. Disable or delete the Vercel Preview deployment from Vercel if it is no longer needed.
4. Remove branch-scoped Vercel Preview env variables for `codex/ai-tasks-staging-infrastructure-v1` if the branch is abandoned.
5. Delete the Railway `ai-tasks-staging` environment only after confirming no further staging evidence is needed. This destroys the empty staging Postgres and synthetic smoke rows.

Do not use production as staging, do not copy production data, and do not copy production provider credentials.
