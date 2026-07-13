# Roadmap

## Immediate Next Milestone
- Review the Autonomous AI Sales Workspace on real customer scenarios after completed frontend validation.

## Product Direction
- Stop redesigning isolated pages.
- Redesign complete product workflows one at a time.
- Keep the sales representative inside one workspace whenever the backend already supports the flow.
- Use the existing design system only where it supports customer-value workflow improvements.

## Completed This Iteration
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
