# FRONTEND_BACKEND_AUDIT

Date: 2026-07-16
Branch: frontend-rebuild
Scope: apps/web + apps/api contract audit (runtime only, no mock assumptions)

## Implementation Status Update (2026-07-16)

- Completed core UX rebuild blocks without backend contract changes:
  - Dashboard
  - Leads
  - Companies
  - Company Workspace
  - Campaigns
  - Inbox
  - Settings
  - Billing
  - Profile
- Implemented practical decision-first shaping:
  - priority queue surfaces over decorative cards
  - explicit next step and blocker messaging
  - explicit unavailable/retry patterns on companies list.
  - real `/api/inbox`, `/api/profile`, `/api/billing/status`, `/api/billing/usage`, and `/api/billing/invoices` frontend reads.
- Validation after implementation:
  - `npm run lint` passed
  - `npm run test` passed
  - `npx next build --webpack` passed in `apps/web`
  - `npm --prefix apps/web run e2e` passed (430 passed)
  - Default Turbopack `npm run build` is blocked in this local sandbox by a Next/Turbopack port-binding panic, not by compile/type errors.

## Method

- Mapped frontend routes to page components and user actions.
- Extracted frontend API usage from:
  - apps/web/components/outbound-workspace.tsx
  - apps/web/components/product-workspace.tsx
  - apps/web/components/dashboard-shell.tsx
  - apps/web/app/api/backend/[...path]/route.ts
- Mapped backend API coverage from:
  - apps/api/app/api/routes.py (main /api router)
  - apps/api/app/api/usage.py (workspace-app router)
  - apps/api/app/main.py include_router wiring
- Classified each flow as: working, partial, visual-only, duplicated, or remove.

## Router Reality

- Main backend router is mounted at /api from apps/api/app/api/routes.py.
- Workspace workflow router is mounted at /api/workspace-app from apps/api/app/api/usage.py.
- Proxy route apps/web/app/api/backend/[...path]/route.ts enforces bearer token forwarding for protected /api/* paths.

## Screen/Action -> API -> Backend -> Integration -> Status

| Screen / Action | Endpoint(s) | Backend Service / Module | DB / Worker / External | Status | Problem | Decision |
|---|---|---|---|---|---|---|
| Dashboard summary load | GET /api/workspace-app/bootstrap, GET /api/dashboard, GET /api/campaigns, GET /api/activity | usage.py bootstrap + routes.py dashboard/campaigns/activity | Postgres | Working | Too much mixed data on one load path | Improve |
| Dashboard quick links | Client navigation only | web routes | N/A | Working | Includes low-value links under advanced nav | Improve |
| Leads natural language search | POST /api/workspace-app/leads/search | usage.py leads search | Postgres + providers | Working | UX can overload with secondary blocks | Improve |
| Leads command actions | POST /api/workspace-app/leads/command | usage.py leads command | Postgres + AI provider | Working | Errors not unified per action card | Improve |
| Manual company create | POST /api/workspace-app/companies | usage.py company create | Postgres | Working | Form too long for primary flow | Improve |
| Leads legacy search | POST /api/leads/find | routes.py leads find | External enrichers + Postgres | Partial | Duplicates workspace-app flow | Remove from primary UX |
| Companies list | GET /api/workspace-app/companies, GET /api/crm/contacts, GET /api/crm/deals, GET /api/crm/pipeline | usage.py + routes.py CRM | Postgres | Working | Mixed dual API namespace (workspace-app + crm) | Improve |
| Company stage update | PATCH /api/crm/companies/{id}/stage | routes.py CRM | Postgres | Working | Buried in dense card UI | Improve |
| Company notes | POST /api/crm/companies/{id}/notes | routes.py CRM | Postgres | Working | Not surfaced as first-class timeline | Improve |
| Enrichment restart/cancel | POST /api/workspace-app/companies/{id}/enrichment/restart, /cancel | usage.py enrichment actions | Workers + Postgres | Working | Messaging inconsistent between cards | Improve |
| Deep contact search start/poll | POST /api/workspace-app/companies/{id}/deep-contact-search, GET job status | usage.py deep-contact-search | Worker queue + Postgres | Working | Polling UI noisy; needs explicit state model | Improve |
| AI Sales Analysis generate/get | GET/POST /api/workspace-app/companies/{id}/ai-sales-analysis | usage.py ai-sales-analysis | AI provider + Postgres snapshots | Working | Version/recommendation actions not obvious | Improve |
| AI Recommendations update | POST /api/workspace-app/companies/{id}/ai-sales-analysis/recommendations | usage.py recommendations | Postgres | Working | Hidden behind dense controls | Improve |
| Email draft generation (company) | POST /api/workspace-app/companies/{id}/email-draft | usage.py email-draft | AI provider + Postgres | Working | Button placement duplicated | Improve |
| Draft approve/send (workspace) | POST /api/workspace-app/emails/{id}/approve, /send | usage.py email actions | Postgres + sender provider | Working | Success/error state not uniform | Improve |
| Draft edit (legacy path) | PATCH /api/emails/{id} | routes.py emails | Postgres | Working | Lives beside workspace-app flow (dup) | Improve |
| Campaign create/list/update | POST/GET/PUT /api/campaigns | routes.py campaigns | Postgres | Working | Creation UX mixed with lead workspace | Improve |
| Campaign launch/pause/complete | POST /api/campaigns/{id}/{action} | routes.py campaigns | Worker scheduler + Postgres | Working | Action confirmations weak | Improve |
| Inbox load | GET /api/inbox | routes.py inbox | Postgres | Working | Logout edge previously produced noisy errors | Improve (already partially fixed) |
| Profile/settings/workspace | GET/PUT /api/profile, /api/settings, /api/workspace | routes.py profile/settings/workspace | Postgres | Working | Too many technical fields exposed | Improve |
| Billing status and plans | GET /api/billing/status, /plans, /usage, invoices | routes.py billing | Stripe + Postgres | Working | Scattered billing surfaces | Improve |
| Sender settings | GET /api/outreach/sender/status, PUT /api/outreach/sender | routes.py outreach sender | Provider config + encrypted secrets | Working | Form complexity should be progressive disclosure | Improve |
| Integrations status/test | /api/integrations/apollo|hunter/status + test | routes.py integrations | Apollo/Hunter | Working | Utility controls mixed with core flow | Improve |
| Admin summary/logs | GET /api/admin/summary, /api/admin/logs | routes.py admin | Postgres logs | Working | Not in core customer workflow | Keep (admin scope) |
| Owner console/feature flags | GET /api/owner/console, PATCH /api/owner/feature-flags | routes.py owner | Postgres | Working | Hidden/owner-only, minimal UX | Improve (owner screen only) |
| Analytics route page | /dashboard/analytics currently fed by generic dashboard data | outbound-workspace page composition | N/A | Visual-only / low value | Duplicative with dashboard summary | Remove from primary nav |
| Website analyzer route | POST /api/ai/analyze | routes.py AI analyze | AI provider | Partial | Standalone route not central to main sales workflow | De-emphasize |
| Deals/Contacts standalone routes | GET /api/crm/deals, GET /api/crm/contacts | routes.py CRM | Postgres | Partial | Read-only pages duplicate Companies context | Remove from primary nav |
| Sentry test route | local test purpose only | web test page | N/A | Visual-only | Production user value none | Remove from production nav |

## What Is Real vs. Visual Debt

### Real and healthy backend-backed capabilities

- Workspace bootstrap and decision-driven dashboard data
- Leads discovery and commands (workspace-app)
- Company lifecycle: enrichment, contact search, analysis, recommendations, draft generation
- Campaign lifecycle actions
- Inbox and sender configuration
- Billing status/usage and checkout/portal

### Partially represented or duplicated

- CRM data split across /api/workspace-app/* and /api/crm/* in the same screens
- Legacy leads/email paths coexisting with workspace-app company flows
- Multiple route-level pages that duplicate the same underlying workspace data

### Visual-only / low-value runtime surfaces

- Advanced nav entries that are not primary user decisions (analytics/deals/contacts/website analyzer as top-level)
- Test/dev utility pages exposed in production nav patterns

## Backend Features Missing or Underexposed in Frontend

- Owner console/feature flags are backend-ready but low-visibility in UI.
- Team router, growth engine, and AI CEO endpoints exist in backend and product-workspace legacy UI, but not in the modern core workflow shell.
- Workspace-app action states (provider unavailable, partial data) are not consistently surfaced with retry affordances in every card.

## Backend Fields Returned but Not Reliably Surfaced

Observed in company workflows: workflow stages/state, warnings, confidence/evidence style analysis payload parts, next_action guidance. These fields are available but are inconsistently prioritized in layout and often buried below secondary blocks.

## Information Architecture Proposal (for approval before full UI rewrite)

1. Dashboard
- Keep only: critical summary, priority leads/companies, explicit next actions, quick jumps to Leads/Companies/Campaigns/Inbox.
- Remove from top level: decorative metrics without action.

2. Leads/Search
- Single primary path: search -> review -> save to CRM.
- Keep Hot/Warm/Cold and practical filters tied to actual payload fields.
- Collapse advanced options by default.

3. Companies
- Primary saved companies queue with status chips and next action.
- Secondary data in expandable sections only.

4. Company Workspace (single decision cockpit)
- Sections in this order:
  - Core profile and enrichment status
  - Priority + intent + ICP/growth indicators
  - Decision maker/contact evidence
  - AI Sales Intelligence (generate/regenerate)
  - Recommendations + first message + follow-up
  - Version history + approve/edit/reject
- Every action must have: loading/success/empty/partial/provider unavailable/retry/validation/permission/session/network handling.

5. Campaigns
- Only create, launch, pause/stop, and outcome view actions.
- Remove decorative cards not tied to backend state.

6. Inbox
- Real message states and links back to company/campaign context.
- No silent failures and no fake send success.

7. Settings/Profile/Billing
- Keep only user-meaningful controls backed by working endpoints.
- Hide technical/internal fields behind advanced details where needed.

## Immediate Cleanup Targets for Rebuild

- Reduce top-level nav to core workflow pages.
- Remove route-level duplication where same actions already exist in Companies workspace.
- Unify error-state rendering primitives and retry controls across all primary actions.
- Keep protected API calls routed through tokenized client API; do not allow direct unauthed protected fetches.

## Change Strategy

- Phase 1: audit + IA baseline (this document).
- Phase 2: navigation and layout simplification.
- Phase 3: company workspace restructuring around real backend actions.
- Phase 4: campaign/inbox/settings cleanup.
- Phase 5: tests (unit/integration/playwright), build, preview validation, full user journey validation.

## Notes

- No backend contract changes were made in this audit phase.
- No production deployment is part of this phase.
