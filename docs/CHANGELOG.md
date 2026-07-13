# Changelog

## 2026-07-13

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

### scope safety
- No backend, API, database, worker, or migration files modified as part of this task.
