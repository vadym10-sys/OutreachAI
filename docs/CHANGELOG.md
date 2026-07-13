# Changelog

## 2026-07-13

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
