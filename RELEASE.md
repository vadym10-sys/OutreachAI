# OutreachAI v1.0.0 Release Summary

## Production State
- Production is deployed and verified from `main` at commit `60e3563` (`60e356358944798b8ee86bcd39d09ecab8c5264c`).
- The active production release is tagged as `v1.0.0`.
- Local `main` matches `origin/main` at the production commit.

## Deployed Services
- Web: Vercel production alias `https://outreach-ai-1g58pbg6x-vadym10-ai-1.vercel.app`
- API: Railway production service `https://outreachai-api-production.up.railway.app`

## Major Features In Release
- Phase 3 AI Sales Copilot on the Company page.
- Automatic AI Sales Intelligence refresh when company intelligence is regenerated or reused from cache.
- Versioned analysis history with selectable snapshots.
- Expanded sales intelligence fields for lead priority, growth indicators, estimated revenue and company size, recommended buyer role, reply probability, follow-up sequencing, and ICP fit.
- Frontend and backend contract alignment for the Company-page AI panel.

## Known Limitations
- Some companies still show explicit unavailable values when enrichment data is missing.
- Clerk production sessions may still show development-key warnings in browser tooling, although live authenticated verification succeeded.
- Production behavior remains dependent on the current deployed web and API aliases staying pointed at the release commit.

## Rollback Instructions
1. Revert the Vercel production alias to the previous successful deployment if a web rollback is needed.
2. Redeploy the Railway API service from the previous stable commit if backend rollback is needed.
3. If a Git rollback is required, move `main` back to the prior stable commit with a revert commit rather than rewriting history.
4. Re-run the production health checks and the Company-page verification flow after rollback.

## Branching Model
- `main` remains the stable production branch.
- `phase4` is the active development branch for all next-phase work until the next production release.# Production Release v1.0 Stable

Date: 2026-07-15 14:35:38 UTC
Release Tag: v1.0-production-stable
Release Commit: ba17a26b4b362704b872b5f5d91e43028d7788d7

## Completed
- Verified production commit alignment to `origin/main` (`ba17a26...`) for API, Railway worker/web service, and Vercel web.
- Redeployed only the lagging Railway service (`beae81a7-02cc-4f33-b967-e43b4e121e7c`) to move active deployment from `feat(workspace): ship ai sales intelligence v1` to `fix(api): return 4xx for lead patch integrity conflicts`.
- Re-verified active deployment states post-redeploy.
- Created production stability release artifacts and next-phase roadmap.

## Health Verification
- Web: `https://outreachaiaiai.com` returned HTTP 200.
- API health: `GET /api/health` returned `{"status":"ok"}`.
- API liveness: `GET /api/live` returned `{"status":"alive"}`.
- API readiness: `GET /api/ready` returned `{"status":"ready","database":true,...}`.
- Worker: Railway worker/web service shows active deployment `fix(api): return 4xx for lead patch integrity conflicts` with deployment successful status.
- PostgreSQL: readiness response confirms active DB connectivity (`"database": true`).

## Notes
- No business logic or application code was modified in this release operation.
- Verification focused on deployment consistency and runtime stability.