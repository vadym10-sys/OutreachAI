# Roadmap

## 2026-07-16 - Frontend Rebuild Program (Started)
- Completed contract-first audit baseline in `FRONTEND_BACKEND_AUDIT.md`.
- Completed execution block 1 for core surfaces:
  - dashboard decision-first queue and recommendation panel
  - leads Hot/Warm/Cold prioritization flow
  - companies triage with operational sorting/status
  - company workspace explicit state/next-step/blocker panel.
- Completed execution block 2 for account and outreach continuation surfaces:
  - campaigns readiness and safe launch/pause/resume decision panel
  - inbox real reply loading from `/api/inbox`
  - settings setup cleanup with profile identity separated
  - billing status/usage/invoice state from existing billing endpoints
  - profile editor backed by existing `/api/profile`.
- Next execution block: product-owner review on preview, then decide whether Analytics/CRM/Deals/Contacts should remain secondary routes or be removed from primary customer workflow.
- Expose backend-supported capabilities missing in primary workflow where they provide direct user value, without adding mock or speculative features.
- Validate on preview only, then run full real-user journey before merge consideration.

## 2026-07-16 - Production QA Follow-Up
- Verify live rollout completion for both web and API fixes from the 2026-07-16 remediation loop in all production regions.
- Add a focused production smoke check that flags empty-body `200` responses on CRM endpoints before customer sessions degrade.
- Add explicit health telemetry for AI sales analysis provider availability and fallback usage rate.
- Expand auth-flow QA automation for signed-out prefetch scenarios to prevent regressions in logout/login transitions.

## 2026-07-15 - Deferred Hardening Backlog (Medium and Low)
- Medium: add richer production health dashboards that correlate queue depth, provider degradation, and customer-visible workflow latency in one operator view.
- Medium: reduce remaining backend deprecation warnings (`on_event`, Pydantic class config) before the next framework upgrade window.
- Medium: expand explicit retry and fallback coverage for non-critical secondary integrations beyond the current customer-path API client and CRM sync loop.
- Low: refine non-blocking localization inconsistencies inside dynamic AI-generated content where English terms intentionally remain evidence-backed raw values.
- Low: streamline remaining test-only assertion noise and npm CLI warning usage (`npm test -- --run`) in CI scripts.

## 2026-07-15 - Phase 5 (Autonomous AI SDR) Execution Started
- Started Phase 5 delivery on the dedicated `phase5` branch from `phase4`.
- Added recommendation-level control loops (approve, edit, regenerate) backed by versioned analysis updates and audit history.
- Added an AI Copilot panel that explains recommendation confidence and reasoning for autonomous SDR decisions.
- Preserved previous-phase compatibility for caching, regeneration, version history, and metadata fallback.
- Next execution checkpoint: deploy `phase5` preview and complete end-to-end live verification on the real company workflow.

## 2026-07-15 - Phase 4 (AI Recommendation Engine) Execution Started
- Started the Company-page recommendation layer on the existing AI Sales Intelligence engine.
- Added a high-signal visual recommendations panel for buying intent, reply probability, lead priority, ICP fit, recommended decision maker, outreach channel, timing, buying signals, risks, opening message, follow-up sequence, next action, and confidence explanation.
- Preserved version history, regeneration, and cached-analysis compatibility so the recommendation layer works across historical snapshots.
- Next execution checkpoint: verify production deployment on the phase4 branch preview or release target and complete multi-company end-to-end checks before merge to `main`.

## 2026-07-15 - Phase 3 (v1.2) Execution Started
- Started the AI Sales Copilot layer on the Company page using the existing enrichment, monitoring, and metadata pipeline.
- Completed automatic sales-analysis refresh after company-intelligence updates and cache reuse.
- Completed Company-page rendering for lead priority, growth indicators, estimated revenue/size, ICP fit/watchouts, and follow-up sequencing.
- Next execution checkpoint: production deployment verification and a real-company end-to-end Sales Copilot walkthrough.

## 2026-07-15 - Phase 2 (v1.1) Execution Started
- Started implementation of AI Sales Intelligence in production workflow surfaces.
- Delivered required schema and UI field coverage for structured target-fit analysis and regeneration history.
- Next execution checkpoint: production deployment verification and real-company walkthrough.

## 2026-07-15 - Next Phase Planning Published
- Published a ranked implementation roadmap for the next development phase in `docs/NEXT_PHASE_ROADMAP.md`.
- Prioritized top-10 improvements across scalability, performance, AI capabilities, security, reliability, UX, and sales workflow by business impact and effort.
- Sequenced delivery into 3 execution phases (stabilization foundation, revenue and trust expansion, intelligent scale).

## Immediate Next Milestone
- Complete product-owner acceptance review of New Customer Onboarding and Workspace Setup after passing frontend validation.

## Product Direction
- Stop redesigning isolated pages.
- Redesign complete product workflows one at a time.
- Keep the sales representative inside one workspace whenever the backend already supports the flow.
- Use the existing design system only where it supports customer-value workflow improvements.

## Completed This Iteration
- New customer onboarding and workspace setup workflow completed on `/onboarding` with dedicated setup UX.
- Onboarding route is now covered by protected-route middleware rules.
- Setup flow now provides clear progress, error recovery, and direct continuation to first operational routes.
- Autonomous AI Sales Workspace completed inside the embedded Leads workspace.
- Workflow rail now mirrors the full one-screen sequence from Open Lead through Next Lead.
- Decision-critical AI context (summary, decision maker, intent, score, competitor snapshot, email draft) is visible before deeper interaction.
- Email review and send controls are always visible in the workspace flow to avoid extra reveal clicks.
- Follow-up and next-lead actions remain in the same screen context with no modal chains.
- AI Outreach Workspace completed on top of the embedded company workspace in Leads.
- Inline draft editing added without backend changes by reusing the existing email update endpoint.
- Follow-up scheduling separated from CRM stage movement so the user can plan next actions before changing pipeline status.
- Next-lead continuation added directly inside the embedded workspace shell.
- Reusable design-system layer created for shared surfaces, states, buttons, badges, and typography.
- Global tokens added for color, spacing, dark mode, surface styling, and motion.
- Core workspace surfaces moved onto shared primitives instead of duplicated helper styling.
- AI Sales Workspace workflow embedded into Leads so the rep can complete end-to-end sales work without leaving the workspace.
- Existing company workflow actions were reused inline instead of rebuilt:
  - AI summary review
  - decision-maker review
  - opportunity scoring
  - buying-intent review
  - ready-email review
  - follow-up scheduling
  - CRM stage movement
  - next-lead continuation

## Near-Term Follow-Up (Approval Required)
- Track time-to-decision from workspace open to first action on real customer sessions.
- Expand e2e coverage for the autonomous sequence ordering and always-visible email review controls.
- Validate conversion impact of inline draft editing versus the previous review-only flow.
- Expand e2e coverage for editing, approving, sending, scheduling follow-up, and opening the next embedded lead.
- Evaluate whether inbox reply handling should become the next embedded continuation of the outreach workspace.
- Run acceptance review on real customer accounts before any wider rollout.

## Constraints
- Frontend-only scope maintained.
- Existing backend endpoints and data contracts reused.
- No backend or data model changes included in this iteration.
