# Design System V4 Changelog

Branch: `design-system-v4`

## Scope

- Frontend-only visual and UX redesign.
- No backend contracts changed.
- No API endpoints changed.
- No production deployment or merge performed.

## Visual Language

- Reframed OutreachAI from a CRM-like product into an AI Operating System for outbound revenue.
- Introduced a premium dark-to-warm visual system inspired by AI workspaces, command centers and modern productivity tools.
- Added richer gradients where they support hierarchy: hero, executive dashboard, active navigation and primary actions.
- Added glass panels only for navigation, auth and command surfaces where translucency improves spatial context.

## Design System

- Rebuilt tokens in `apps/web/app/globals.css`.
- Mapped Tailwind brand tokens to CSS variables in `apps/web/tailwind.config.ts`.
- Added reusable operating-system components:
  - `OperatingPanel`
  - `AiLiveCard`
  - `AiTimeline`
  - `MiniBarChart`
  - `Breadcrumbs`
  - `Kbd`
  - `CommandDialog`
  - `CommandItem`

## Landing

- Rebuilt the landing page with a premium AI SaaS composition.
- Added interactive-style AI preview, product moments, workflow, pricing and FAQ.
- Kept real pricing from the existing frontend.
- Avoided fake customer logos or fabricated traction claims.

## App Shell

- Added compact AI OS sidebar.
- Added workspace status surface.
- Added breadcrumbs.
- Added `Cmd/Ctrl+K` command palette.
- Redesigned mobile bottom navigation with native-feeling rounded shell.

## Dashboard

- Reworked Dashboard into an executive AI cockpit.
- Added live AI recommendation cards.
- Added AI timeline.
- Added compact opportunity chart using only current workspace data.
- Preserved existing dashboard data loading, caching and routing behavior.

## Auth

- Restyled sign-in, sign-up, loading and already-signed-in states.
- Preserved Clerk integration and QA auth bypass restrictions.

## Known Limits

- Preview deployment was not created in this local step because production deployment was explicitly forbidden and no separate preview instruction was provided in this turn.
- Lighthouse scores require a runnable browser target; official Lighthouse could not be completed in this sandbox in the previous local run.
