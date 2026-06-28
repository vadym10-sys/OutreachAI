# OutreachAI v1 UX Audit

## Product Principle

OutreachAI should help a non-technical business owner reach one outcome quickly: find the right companies, review AI work, and approve a campaign. Pages that do not directly improve that path should be merged, hidden, or postponed.

## New User Flow

1. Register.
2. Save company and workspace details.
3. Let AI use that context for analysis.
4. Find leads by country, city, and industry.
5. Generate outreach for one lead and one campaign.
6. Review the AI draft.
7. Approve only when it is correct.
8. Run the campaign.
9. Track replies, meetings, and revenue.

## Page Audit

| Page | Purpose | User | Decision |
| --- | --- | --- | --- |
| Landing | Explain the product and convert visitors. | Visitor | Keep. Must stay focused on business outcome, not feature count. |
| Sign in / Sign up / Forgot password | Let users access or recover accounts. | Visitor, customer | Keep. Must remain simple and mobile-safe. |
| Dashboard | Show what to do today and core business health. | Customer | Keep as command center. Reduced to today's priority, next action, campaign health, AI result, revenue, and subscription. |
| Leads | Find and review companies. | Customer | Keep as primary work page. Use a three-step finder: country, industry, company size. |
| CRM | Same underlying lead workflow. | Power user | Hide from primary navigation. Merge into Leads unless a distinct use case emerges. |
| Campaigns | Create the first campaign and review AI email. | Customer | Keep. Use wizard and hide advanced fields. |
| AI Employees | Give work to AI safely. | Customer | Keep. Default to one clear command and approval-first execution. |
| Inbox | Review replies after campaigns run. | Customer | Hide from primary navigation until campaigns are active. Keep deep link with helpful empty state. |
| Analytics | Duplicate of dashboard metrics today. | Manager | Keep hidden. Merge into Dashboard until it provides a distinct paid value. |
| Billing | Manage plan, usage, and payment. | Customer | Keep. Customer page should not show diagnostics; diagnostics stay admin-only. |
| Settings / Profile | Configure company, language, and workspace. | Customer | Merge profile into Settings. Default to company setup only. |
| Admin | Internal operations. | Operator | Hide by feature flag. |
| Owner Console | Owner-only company control plane. | Owner | Keep hidden and backend-protected. Use customer-quality language even for internal controls. |
| Error / Empty states | Recover and guide next action. | Everyone | Keep improving. Never show raw technical failures. |

## Prioritized Improvements

1. Make the dashboard answer only what the user should do today.
2. Hide duplicate CRM and Inbox navigation by default.
3. Reduce Settings to company setup, language, and one next action.
4. Convert reply empty states into campaign guidance.
5. Keep Campaign Builder as a three-step wizard.
6. Convert Lead Finder to country, industry, company size steps with advanced filters hidden.
7. Keep AI Employees approval-first and task-result oriented.
8. Move analytics into Dashboard until it has a clearly different job.
9. Keep admin and experimental pages behind feature flags.
10. Continue translation QA for every legacy and hidden page before exposing them again.

## Screens To Merge Or Hide

- Merge CRM into Leads for normal users.
- Merge Analytics into Dashboard for normal users.
- Merge Profile into Settings.
- Hide Inbox from main navigation until the user has an active campaign or replies.
- Keep Admin and experimental modules hidden behind feature flags.
- Keep AI CEO voice optional, not permanent navigation, until voice playback is proven end-to-end.

## UI Redesign Direction

- Every page begins with title, one-sentence purpose, and one primary CTA.
- Long forms become guided steps.
- Advanced fields stay inside `Advanced settings`.
- Empty states explain what the object is, why it is empty, how to fix it, and one button.
- Primary navigation should mirror the customer journey: Dashboard, AI Employees, Leads, Campaigns, Billing, Settings.
- Mobile bottom navigation should show only the four core actions.

## Implemented In This Pass

- Dashboard now focuses on today's priority, suggested next action, campaign health, latest AI result, revenue summary, and subscription status.
- Lead Finder now uses a guided three-step search flow instead of showing all fields at once.
- Billing diagnostics are hidden from the normal customer billing page and remain available only through the diagnostics surface.
- Owner Console audit logs show readable metadata instead of raw JSON.
- E2E tests now cover the executive dashboard sections, language persistence, mobile widths, and owner-only access.
- Standalone admin and billing diagnostics pages now redirect to the Owner Console instead of exposing operational UI.
- Onboarding now explains why each step exists, what happens next, and expected time.
- AI task result pages now include useful empty-result guidance, examples, and CTAs instead of bare “not found” states.
- New copy introduced in this pass was added to the visible phrase translation map for all supported locales.

## Performance Improvements

- Primary dashboard presents fewer visible sections and avoids rendering the full metric wall in the default experience.
- Billing no longer renders diagnostic rows for normal customers.
- Hidden navigation keeps lower-value pages out of the primary journey, reducing customer decision cost.

## Accessibility Improvements

- Step controls remain native buttons with clear labels.
- Primary actions keep minimum 44px tap targets.
- Owner feature flags retain `aria-pressed`.
- Empty and error states use readable text instead of technical data dumps.
- Empty task-result states include explanatory headings, help text, examples, and two keyboard-accessible actions.

## Conversion Improvements

- The dashboard points to one action instead of presenting many equal choices.
- Billing copy now focuses on secure subscription management instead of diagnostics.
- Lead Finder guides a non-technical user through one decision at a time.
- Onboarding now frames setup as a short path to the first reviewed campaign, not a settings checklist.

## Remaining Blockers

- Legacy advanced screens still rely on DOM phrase translation rather than translation keys throughout every component.
- Full authenticated production QA still requires a controlled test account and production-safe test workspace.
- Dedicated accessibility tooling such as axe is not yet wired into CI.
- Performance budgets are documented but not enforced automatically in CI.

## v2 Roadmap

1. Replace DOM phrase translation with typed translation keys across every visible component.
2. Add CI accessibility checks with axe and keyboard traversal tests.
3. Add route-level performance budgets and bundle analysis gates.
4. Merge CRM, Inbox, and Analytics into a single workflow-aware “Results” area once real usage data supports it.
5. Build a production-safe QA tenant with seeded Stripe, Clerk, Resend, and OpenAI test fixtures.

## QA Focus

- No horizontal scrolling from 320px to desktop.
- One primary action per page.
- No raw `Load failed`, stack traces, JSON errors, or technical messages.
- Protected routes redirect cleanly.
- Russian and other locales must not expose mixed-language primary UI before public release.
- Hidden pages must not reappear without full translation, mobile, and empty-state QA.
