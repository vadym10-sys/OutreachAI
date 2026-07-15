# Changelog

## 2026-07-15

### ops(release)
- Finalized Production Release v1.0 stabilization verification against `origin/main` commit `ba17a26...`.
- Confirmed API, web, and database-ready status from production health checks.
- Redeployed only the lagging Railway worker/web service to align active deployment commit with latest production commit.

### docs
- Added short production release summary in `RELEASE.md`.
- Added ranked next-phase implementation plan in `docs/NEXT_PHASE_ROADMAP.md` with top-10 impact/effort priorities.

### fix(api)
- Verified worker restart recovery by safely reclaiming stale running enrichment jobs and preventing old claims from completing reclaimed work.
- Added owner-only queue observability at `/api/admin/queue/health` with depth, active-job, retry, dead-letter, stale-running, and latency metrics.

### docs
- Added final launch-readiness documentation covering approved release commits, remaining risks, and deployment checklist.

### test(api)
- Added regressions for worker restart recovery and queue health endpoint access/metrics.

### fix(api)
- Hardened enrichment queue claims with unique per-attempt ownership tokens and worker heartbeats so stale workers cannot overwrite reclaimed jobs.
- Switched queue retries to exponential backoff and mark exhausted jobs as explicit dead-lettered failures.

### test(api)
- Added regressions for duplicate enqueue idempotency, stale-job reclaim safety, exponential retry timing, and queue terminal-state handling.

### fix(api)
- Tightened API readiness so production now reports `degraded` when required runtime environment variables or PostgreSQL connectivity are missing.
- Added explicit startup logs for required environment validation and PostgreSQL connectivity checks.

### test(api)
- Added regressions for production readiness failures caused by missing environment variables and non-PostgreSQL database connectivity.
- Added a startup logging regression that confirms validation logs are emitted before fail-fast database errors.

### fix(api)
- Fixed the Railway worker deploy profile so the worker service explicitly starts with `OUTREACHAI_PROCESS_ROLE=worker`.
- Prevented the worker profile from accidentally booting the API process at launch.

### test(api)
- Added a regression that verifies `app.serve.main()` dispatches to the worker entrypoint when the worker role is set.

### fix(api)
- Hardened billing status resolution so ended subscription periods now resolve as `expired` instead of remaining active.
- Added explicit billing lifecycle coverage for renewal, downgrade, cancel, and expiry transitions.

### test(api)
- Added a focused billing regression slice covering subscription lifecycle transitions and adjacent billing endpoints.
- Verified the deployed API health endpoint at `https://outreachai-api-production.up.railway.app/api/health`.

## 2026-07-13

### fix(frontend)
- Fixed a Customer Activation blocker in sender setup provider selection.
- Removed non-actionable Gmail/Outlook OAuth provider options from the sender dropdown.
- Added clear guidance that Gmail/Outlook mailboxes can connect through SMTP app passwords.

### test(frontend)
- Added settings regression assertions that sender provider options include only actionable paths and show SMTP guidance copy:
	- `tests/settings/settings.spec.ts`

### fix(frontend)
- Fixed a Customer Activation blocker in first-send success confirmation.
- After a successful send, messaging now correctly states that CRM stage is updated to `Sent`.
- Removed outdated `Contacted` stage wording from send success surfaces.

### test(frontend)
- Added regression coverage for successful first-send confirmation text:
	- `tests/regression/critical-actions.spec.ts`

### fix(frontend)
- Fixed a Customer Activation blocker in follow-up creation.
- The "Schedule Follow-up" action now clearly tells the user that the template is ready and must be saved with Add note.
- Removed misleading wording that implied follow-up persistence before note save.

### test(frontend)
- Added regression coverage for follow-up save-required behavior:
	- `tests/regression/critical-actions.spec.ts`

### fix(frontend)
- Fixed a Customer Activation blocker in sender setup.
- Sender setup no longer shows a success confirmation when the sender remains disconnected.
- Added client-side sender setup validation for required sender fields and email format before save.
- Added clearer actionable messaging when sender status is still not connected after save.

### test(frontend)
- Added settings regression coverage for sender setup validation and disconnected-save behavior:
	- `tests/settings/settings.spec.ts`

### fix(frontend)
- Fixed a Customer Activation blocker in the first-send flow.
- When an approved email cannot be sent because sender setup is missing, the opportunity card now shows direct actions to open sender setup.
- Added direct routing from blocked-send state to `/dashboard/settings#email-sending`.

### test(frontend)
- Added regression coverage for blocked-send sender setup recovery:
	- `tests/regression/critical-actions.spec.ts` validates that the direct sender setup action appears and links to `/dashboard/settings#email-sending`.

### feat(frontend)
- Delivered a dedicated New Customer Onboarding and Workspace Setup page component for `/onboarding`.
- Replaced the legacy onboarding render path with a focused workspace setup flow.
- Added setup progress signaling, clear private-workspace guidance, and explicit retry behavior for load/save failures.

### security(frontend)
- Added `/onboarding` to protected-route middleware enforcement to keep setup behind authenticated access controls.

### validation
- `npm run lint` passed.
- `npm test` passed.
- `npx playwright test tests/dashboard/routes.spec.ts` passed.
- `npm run build` passed.

### feat(frontend)
- Completed the Autonomous AI Sales Workspace epic in the embedded Leads workflow.
- Aligned the visible workflow rail to the single-screen sequence: Open Lead, AI Summary, Decision Maker, Buying Intent, Opportunity Score, Competitor Snapshot, Email Draft, Review, Send, Schedule Follow-up, Next Lead.
- Added a compact autonomous decision strip so users can identify the next action quickly from AI context.
- Kept email review, editing, approval, and send controls visible in one screen context to reduce extra clicks.
- Updated workspace copy from AI Outreach Workspace to Autonomous AI Sales Workspace.

### feat(frontend)
- Completed the AI Outreach Workspace epic inside the existing embedded Leads workflow.
- Added inline draft editing in the outreach workspace using the existing `PATCH /api/emails/{email_id}` endpoint.
- Kept the existing approve-before-send safety flow while reducing clicks between review, edit, approve, and send.
- Separated follow-up scheduling from CRM stage movement so both actions can happen independently inside one workspace.
- Added direct next-lead continuation from the embedded company workspace.
- Added a compact outbound workflow rail to the top of the company workspace and updated visible workspace copy to AI Outreach Workspace.

### feat(frontend)
- Built a reusable OutreachAI design system layer in `apps/web/components/design-system.tsx`.
- Added standardized primitives for surfaces, buttons, badges, page heroes, metrics, section panels, AI panels, timeline rails, loading states, empty states, and error states.
- Added reusable opportunity, company, and decision-maker card shells.
- Introduced shared global design tokens and utility classes in `apps/web/app/globals.css` for color, typography, spacing, surfaces, animations, dark mode, and mobile-friendly behavior.
- Refactored core workspace helpers and buttons to use the shared design vocabulary instead of duplicated local UI definitions.

### feat(frontend)
- Completed the AI Sales Workspace workflow epic by embedding the existing company workspace directly into Leads.
- Enabled a sales rep to stay in one workspace for company review, AI review, outreach review, follow-up planning, CRM stage movement, and next-lead continuation.
- Added explicit inline workflow opening from Leads cards instead of forcing route switching.
- Added embedded workflow shell actions including hide workflow and return to next lead.
- Preserved stable default Leads route behavior by not auto-opening the embedded company workspace.

### feat(frontend)
- Redesigned Leads page into an AI Sales Workspace using existing frontend data and existing backend endpoints.
- Added top summary metrics for lead prioritization and action readiness.
- Added AI filter chips for opportunity, intent, confidence, readiness, and missing-data workflows.
- Enhanced lead cards to show decision-critical sales context and quick actions.
- Added right sidebar with Today's Best Lead, urgency rationale, first action, expected reply probability, and AI recommendation.
- Preserved localization and loading/empty/error states.
- Fixed a Leads e2e strict-mode selector regression by removing duplicate heading semantics for the same company name.

### docs
- Added project task documentation files for progress, roadmap, and changelog tracking.

### validation
- `npm run lint` passed.
- `npm run build` passed.
- `npm test -- --run` passed.
- Relevant Leads e2e command passed after final UI fix.
- Embedded workflow e2e slices passed for actionable lead flow and stable default route behavior.
- Design-system validation slice passed across dashboard, leads, companies, and CRM workspace routes.

### scope safety
- No backend, API, database, worker, or migration files modified as part of this task.
