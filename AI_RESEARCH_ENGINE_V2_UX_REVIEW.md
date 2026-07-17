# AI Research Engine V2 UX Review

## Product Objective

Make OutreachAI feel like an AI Sales Operating System that explains why an account matters, what changed, and what the seller should do next.

## User Journey

1. User opens Dashboard.
2. AI Daily Brief summarizes new companies, hot leads, new buying signals, best actions and recent changes.
3. User opens a company.
4. AI Research Engine V2 shows which research inputs are available and what is missing.
5. Buying Signal Engine explains which signals are active and how much each signal contributes.
6. Lead Score V2 explains the score, reply probability, reasons and improvements.
7. Next Best Action recommends the safest next workflow.
8. Outreach Copilot generates or shows channel-specific assets.
9. Executive Timeline shows what happened, what AI found and what should happen next.

## UX Improvements

- The company page now starts with decision logic instead of CRM fields.
- Signals are weighted and visible, so the user can trust why a lead is hot.
- Score explanation is written for a seller, not for an engineer.
- Next Best Action uses business choices: research, find decision maker, email, LinkedIn, wait, follow up or call.
- Outreach Copilot groups all generated assets in one place.
- Timeline clarifies completed work and recommended next work.
- Dashboard Daily Brief gives the user a reason to return every day.

## Safety And Trust

- No fake production data is introduced.
- Unknown data stays explicit as missing or not detected.
- Outreach still requires review/approval before sending.
- Provider names and internal API details are not shown in the primary workflow.
- V2 uses existing data and degrades gracefully when a company has partial enrichment.

## Quality Criteria

- Lint passes.
- Unit tests pass.
- Production build passes.
- E2E passes across desktop, tablet and mobile profiles.
- Screenshots are captured for Dashboard and Company Workspace on desktop and mobile.

## Remaining Infrastructure Limitation

- Vercel Preview cannot be created until the local Vercel CLI session is refreshed. The branch can be pushed to GitHub independently.
