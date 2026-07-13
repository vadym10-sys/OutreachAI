# Roadmap

## Immediate Next Milestone
- Review and approve the AI Sales Workspace workflow epic after completed frontend validation.

## Product Direction
- Stop redesigning isolated pages.
- Redesign complete product workflows one at a time.
- Keep the sales representative inside one workspace whenever the backend already supports the flow.

## Completed This Iteration
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
- Validate conversion impact of the embedded one-workspace flow versus page-switching behavior.
- Expand e2e coverage for opening, using, and exiting the embedded workflow.
- Evaluate whether campaigns and inbox should become embedded workflow continuations in future epics.
- Run acceptance review on real customer accounts before any wider rollout.

## Constraints
- Frontend-only scope maintained.
- Existing backend endpoints and data contracts reused.
- No backend or data model changes included in this iteration.
