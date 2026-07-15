# Changelog

## 2026-07-16

### feat(frontend)
- Added a direct `Jump to workflow` CTA in the company AI Sales Intelligence panel so reps can move from recommendations to execution in one click.
- Anchored the AI SDR Workflow section for fast analysis-to-action navigation without hunting through the page.

### test(frontend)
- Extended the company workspace Playwright regression to verify the new workflow jump CTA and anchor navigation.

### validation
- `npm run e2e -- tests/dashboard/routes.spec.ts -g "company workspace shows AI recommendations and version history" --project=laptop` passed in `apps/web`.
- `python3 -m pytest -q tests/test_api.py` passed in `apps/api` (188 passed).
- `npm run test -- --run` passed in `apps/web` (31 tests).
- `npm run build` passed in `apps/web`.

## 2026-07-15

- Preserved backward compatibility by auto-normalizing cached analyses with missing workflow structures.

- Added visible stage rail and progress bar for SDR lifecycle progression and a workflow timeline feed in the same panel.

- Updated analysis refresh content-stability handling to keep version reuse behavior correct when workflow/audit timestamps change.

- Expanded company workspace Playwright regression to validate AI SDR workflow rendering and progression interaction.

- `npm run build` passed in `apps/web`.
- `npm run e2e -- tests/dashboard/routes.spec.ts -g "company workspace shows AI recommendations and version history" --project=laptop` passed in `apps/web`.

- Each task now carries priority, estimated impact, confidence score, reasoning, expected outcome, and rank.
- Added Action Center task-state endpoint: `POST /api/workspace-app/companies/{company_id}/ai-sales-analysis/action-center` with `complete`, `postpone`, and `dismiss` actions.

### feat(frontend)
- Added backend regression coverage for Action Center versioned state transitions and audit history persistence.

### test(frontend)
- Expanded company workspace Playwright regression to validate AI Action Center rendering and task state updates.

### validation
- `PYTHONPATH=apps/api python3 -m pytest apps/api/tests -q` passed.
- `npm run lint` passed in `apps/web`.
- `npm run test -- --run` passed in `apps/web`.
- `npm run build` passed in `apps/web`.
- `npm run e2e -- tests/dashboard/routes.spec.ts -g "company workspace shows AI recommendations and version history" --project=laptop` passed in `apps/web`.

### feat(api)
- Phase 6 autonomous AI Sales Copilot now auto-generates analysis on first read for companies that do not yet have a sales analysis snapshot.
- Auto-generated analyses are persisted with the existing versioning, cache, regeneration, recommendation-action, and history mechanisms.
- The automatic read-path keeps provider-failure safety by returning `provider_unavailable` without breaking company workflows.

### test(api)
- Added regression coverage for:
	- automatic AI sales analysis generation on read when missing
	- provider-failure fallback behavior for automatic read generation

### validation
- `PYTHONPATH=apps/api python3 -m pytest apps/api/tests -q` passed.
- `npm run lint` passed in `apps/web`.
- `npm run test -- --run` passed in `apps/web`.
- `npm run build` passed in `apps/web`.
- `npm run e2e -- tests/dashboard/routes.spec.ts -g "company workspace shows AI recommendations and version history" --project=laptop` passed in `apps/web`.

### feat(frontend)
- Phase 6 started on `phase6` with the first lead-prioritization UX improvement in Leads workspace.
- Opportunity cards now show an explicit priority tier badge (`Hot`, `Warm`, `Cold`) with the calculated opportunity score.
- Lead cards in the primary Leads list now render in deterministic descending opportunity-priority order.

### validation
- `npm run lint` passed in `apps/web`.
- `npm run test -- --run` passed in `apps/web`.
- `npm run build` passed in `apps/web`.

### fix(api)
- Fixed default AI sales analysis reads to resolve and return the latest persisted version when stale metadata cache versions are present.

### release
- Completed final production hardening validation gate for `phase5-hardening`.
- Confirmed no unresolved Critical or High customer-facing issues remain in this release scope.

### validation
- Final frontend validation gate passed:
	- `npm run lint`
	- `npm run typecheck`
	- `npm run test -- --run`
	- `npm run build`
	- `npx playwright test` in `apps/web` (`430 passed`)

### fix(frontend)
- Hardened the shared customer API client with automatic retry defaults for transient idempotent reads and status-aware retry handling for `408/409/425/429/5xx` responses.

### fix(api)
- Hardened autonomous CRM sync so transient webhook failures no longer abort the whole sync pass and now write explicit `automation.crm_sync_failed` audit events.

### test(api)
- Updated deep-contact-search and stale-worker recovery coverage to match the current async queue contract.

### test(frontend)
- Stabilized dashboard resilience and localized mobile Playwright assertions to keep customer-critical behavior checks strict without failing on non-regression copy variance.

### validation
- `PYTHONPATH=apps/api python3 -m pytest apps/api/tests -q` passed.
- `npm run lint` passed.
- `npm run typecheck` passed.
- `npm run test -- --run` passed.
- `npm run build` passed.
- `npx playwright test` passed in `apps/web` (`430 passed`).

### feat(api)
- Extended AI sales workspace generation to include recommendation action payloads, AI Copilot panel structures, and recommendation audit history.
- Added recommendation control endpoint: `POST /api/workspace-app/companies/{company_id}/ai-sales-analysis/recommendations`.
- Implemented versioned recommendation updates for `approve`, `edit`, and `regenerate` actions while preserving snapshot and metadata history compatibility.

### feat(frontend)
- Added AI Copilot recommendation control panel in the company workspace AI Recommendations section.
- Added per-recommendation user actions (approve, edit, regenerate) with inline editing and confidence/reasoning display.
- Wired recommendation updates to backend versioned analysis lifecycle and preserved existing generation/regeneration workflows.

### test(api)
- Added backend regression coverage for recommendation action updates, version increments, and recommendation audit log persistence.

### test(frontend)
- Expanded company workspace Playwright regression to validate AI Copilot controls rendering alongside version-history behavior.
- Extended workspace API mocks with recommendation action and versioned analysis-update behaviors.

### validation
- `python3 -m pytest -q tests/test_api.py -k "ai_sales_analysis"` passed in `apps/api`.
- `npm run lint` passed in `apps/web`.
- `npm test -- --run` passed in `apps/web`.
- `npm run build` passed in `apps/web`.
- `npm run e2e -- tests/dashboard/routes.spec.ts -g "company workspace shows AI recommendations and version history" --project=laptop` passed in `apps/web`.

### feat(frontend)
- Added a dedicated AI Recommendations panel to the Company page with cards, badges, and priority indicators.
- Surfaced buying intent, reply probability, lead priority, ICP fit, recommended decision maker, best outreach channel, best contact timing, top buying signals, top risks or objections, personalized opening message, personalized follow-up sequence, recommended next action, and confidence explanation.
- Kept analysis version history and regeneration controls fully compatible with the existing AI sales analysis engine.

### test(frontend)
- Added a Playwright regression that verifies the AI Recommendations panel renders and version switching still works for the company workspace.

### validation
- `npm run e2e -- tests/dashboard/routes.spec.ts -g "company workspace shows AI recommendations and version history" --project=laptop` passed in `apps/web`.
- `npm run lint` passed in `apps/web`.
- `npm test -- --run` passed in `apps/web`.
- `npm run build` passed in `apps/web`.

## 2026-07-15

### feat(api)
- Added automatic AI Sales Copilot refresh during company-intelligence regeneration and cache reuse.
- Preserved metadata-backed AI sales version history while avoiding duplicate background versions when the analysis content has not changed.

### feat(frontend)
- Expanded the Company-page AI Sales Intelligence panel with Phase 3 fields for lead priority, growth indicators, estimated revenue/size, ICP fit/watchouts, and personalized follow-up sequencing.
- Hydrated the Company-page AI sales panel from returned company payloads and refreshed it immediately after enrichment updates.

### test(api)
- Added regression coverage for Phase 3 AI sales payload fields and background auto-refresh versioning behavior.

### validation
- `python3 -m pytest -q tests/test_api.py -k 'ai_sales_analysis'` passed in `apps/api`.
- `npm run lint` passed in `apps/web`.
- `npm test -- --run` passed in `apps/web`.
- `npm run build` passed in `apps/web`.

### feat(api)
- Expanded AI Sales Intelligence analysis schema with required outbound fields:
	- `recommended_first_message`
	- `best_timing_to_contact`
- Included new intelligence fields in draft-generation analysis context.

### feat(frontend)
- Updated company workspace to a dedicated AI Sales Intelligence panel.
- Added explicit rendering for buying signals, confidence score, reasoning, recommended first message, and best timing to contact.

### test(api)
- Added regression assertions for required new analysis fields and legacy-cache fallback defaults.

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
