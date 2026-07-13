# Roadmap

## Immediate Next Milestone
- Review and approve the new reusable OutreachAI design system after completed frontend validation.

## Product Direction
- Stop redesigning isolated pages.
- Redesign complete product workflows one at a time.
- Keep the sales representative inside one workspace whenever the backend already supports the flow.
- Standardize all workflow surfaces through reusable design-system primitives instead of page-specific UI definitions.

## Completed This Iteration
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
- Continue replacing remaining repeated tables, panels, and route-specific cards with design-system primitives.
- Add explicit shared table and timeline adoption in secondary pages beyond the core workspace.
- Validate conversion impact of the embedded one-workspace flow versus page-switching behavior.
- Expand e2e coverage for opening, using, and exiting the embedded workflow.
- Evaluate whether campaigns and inbox should become embedded workflow continuations in future epics.
- Run acceptance review on real customer accounts before any wider rollout.

## Constraints
- Frontend-only scope maintained.
- Existing backend endpoints and data contracts reused.
- No backend or data model changes included in this iteration.
