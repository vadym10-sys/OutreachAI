# OutreachAI UI/UX Redesign Plan

## Audit Summary

OutreachAI already has the right core product loop: define a market, find real companies, research them, generate review-first outreach, create campaigns, and track replies. The production backend exposes the required product contracts through existing workspace, lead, company, AI analysis, campaign, inbox, billing, settings, and profile endpoints. The redesign must therefore improve clarity, hierarchy, trust, responsiveness, and conversion without adding invented product features or changing backend contracts.

Current issues to correct:

- Public site uses broad SaaS claims and non-obvious demo numbers that can read as real social proof.
- Pricing exists in backend plan limits, but the landing presentation should clearly use those real plan limits.
- Dashboard has useful workflow data, but the visual hierarchy should put one decision above all supporting metrics.
- Companies and Company Workspace contain the strongest product value, but the UI still feels like assembled cards rather than a focused workbench.
- Auth pages work but need a more premium sign-in/sign-up frame and clearer product context.
- Dashboard shell has correct routes, but desktop and mobile navigation need a more polished, app-like structure.
- Several screen-level components use duplicate card/button/input styling instead of shared primitives.
- The main SaaS component is too large, so the redesign should gradually move shared UI into reusable primitives while preserving behavior.

## New Information Architecture

Public site:

1. Header: Product, How it works, Use cases, Pricing, Sign in, Start finding leads.
2. Hero: what OutreachAI does, who it is for, what workflow it replaces, primary CTA, secondary CTA, and a labeled demo product preview.
3. Proof: neutral product facts and demo-state disclosure, no fabricated customers or testimonials.
4. How it works: Define ICP, Find companies, AI research, Prioritize opportunities, Generate outreach, Launch campaign, Track replies.
5. Product showcase: Dashboard, Company Research, AI Analysis, Lead Prioritization, Campaigns, Inbox.
6. Use cases: SaaS, agencies, recruiting, B2B services, sales teams.
7. Benefits: less manual research, better personalization, one workflow, clearer next action, faster campaigns.
8. Pricing: real Starter, Pro, Agency limits from backend constants.
9. FAQ: data sourcing, AI analysis, email review, safety, billing, privacy.
10. Final CTA and footer with real legal/security links where pages exist.

SaaS app:

- Dashboard: Next Best Action first, then Priority Opportunities, Buying Signals, Campaign Health, Replies Requiring Attention, Research in Progress, Recent Activity.
- Leads: prioritized list with score, reason, company, role, email readiness, status, next action, filters, and search.
- Companies: CRM list/workspace entry point with enrichment status, ICP fit, buying signals, AI readiness, CRM stage, last activity, and next action.
- Company Workspace: overview, status, score rationale, reason to contact, people, technologies, signals, findings, risks, message angle, next action, and analysis history.
- Campaigns: status, recipients, progress, sent/replies/errors, next action, and safe review-first creation.
- Inbox: reply list, context, status, next action, and honest empty state.
- Billing: plan, usage, limits, invoices, payment status, and supported upgrade/portal actions.
- Settings: workspace, company profile, sender configuration, integrations, notifications, privacy/security only where backed by existing APIs.
- Profile: name/workspace identity, email context, avatar, language, timezone, account management.

## Preserve, Rework, Remove

Preserve:

- Existing backend endpoints and auth model.
- Clerk sign-in/sign-up and QA auth gating rules.
- Review-before-send safety model.
- Real plan names and limits: Starter, Pro, Agency.
- Existing dashboard, leads, CRM/company, AI analysis, campaign, inbox, billing, settings, and profile data flows.

Rework:

- Public landing page copy, hierarchy, pricing, demo disclosure, and product preview.
- Auth page layout and Clerk appearance.
- Dashboard shell navigation, workspace header, active states, mobile bottom navigation, and drawer.
- Shared surface, button, input, badge, table, state, modal, drawer, dropdown, command, toast, and skeleton primitives.
- Page-level card density, typography, spacing, and status presentation.

Remove or hide:

- Fabricated social proof, customer logos, testimonials, or unverified metrics.
- JSON-like or technical backend fields from user-facing settings.
- Duplicate styling patterns where a shared primitive exists.
- Internal/legacy routes from primary navigation unless deliberately owner/admin-gated.
- Controls that imply unsupported bulk actions or external sending without review.

## Design Language

- Clean enterprise SaaS, AI-native, light theme first.
- Neutral surfaces with one strong teal accent.
- Dense but readable app screens; marketing pages can be more editorial but must show real product UI.
- 8px to 16px radius depending on component role; repeated cards stay modest.
- Precise type scale with no viewport-width font scaling inside app controls.
- Strong focus states, contrast-aware text, reduced-motion support.
- Useful motion only: transitions, skeleton loading, progress, success feedback.

## Primary User Scenarios

1. Visitor understands OutreachAI in five seconds and starts sign-up.
2. User signs in and immediately sees the next best action.
3. User searches or reviews leads, then opens a company.
4. User runs or reviews AI analysis and understands score, rationale, risks, and next step.
5. User generates/regenerates outreach safely and sees version/history context.
6. User creates or reviews a campaign without accidental sending.
7. User checks replies and follows the next action.
8. User reviews billing/usage and updates workspace/profile settings.
9. User refreshes, changes viewport, logs out, and logs back in without losing state.

## Completion Criteria

- Public site and app shell feel like one coherent product.
- No invented production data, mock customers, or fake testimonials.
- Existing backend contracts remain unchanged.
- All primary pages use shared design primitives or the new token system.
- Desktop, tablet, and mobile layouts avoid horizontal overflow.
- Loading, empty, error, and success states are visible where the backend can produce them.
- Keyboard focus, contrast, and touch targets meet practical WCAG expectations.
- `npm run lint`, `npm run test`, `npx next build --webpack`, and `npm --prefix apps/web run e2e` pass or any blocker is documented honestly.
- Preview deployment exists for review before any merge or production deploy.
