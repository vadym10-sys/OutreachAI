# AI Sales Operating System Changelog

Branch: `ai-sales-operating-system`

## Added

- AI Executive Dashboard layer with Today Brief, KPI Cards, AI Insights and Activity Timeline.
- Priority Queue and Recommended Now blocks focused on the next sales decision.
- Customer Activation path that guides a new user from first market/company to first AI-generated outreach in under 10 minutes.
- AI Lead Workspace inside lead cards with lead score, reply probability, score reasons, recommended next action and interaction history.
- AI Personalization panel with email, LinkedIn message, follow-up, subject line and call opener assets.
- AI Company Intelligence layer inside Company Workspace with company profile, growth signals, technologies, news, vacancies, AI summary and recommendation.

## Preserved

- Existing backend contracts and API endpoints.
- Existing authentication, CRM, lead search, company enrichment, email draft, approval and send flows.
- Existing Campaigns, Inbox, Billing, Settings and Profile surfaces.
- Existing production data safety behavior: no invented contacts, no auto-send without review.

## Simplified

- Technical provider details are not surfaced in the new decision-first blocks.
- Activation language is focused on user actions instead of internal processing.
- Empty states point to the next safe workflow instead of exposing implementation details.

## Real APIs Used

- `/api/dashboard`
- `/api/workspace-app/companies`
- `/api/workspace-app/companies/:id/enrichment/restart`
- `/api/workspace-app/companies/:id/email-draft`
- `/api/workspace-app/companies/:id/contacts`
- `/api/workspace-app/companies/:id/deep-contact-search`
- `/api/workspace-app/sales-analysis/:companyId`
- `/api/workspace-app/emails/:id/approve`
- `/api/workspace-app/emails/:id/send`
- Existing CRM company, note and stage endpoints.

## Notes

- No backend schema, endpoint or authentication contract was changed.
- Preview deployment is still dependent on valid Vercel authentication for this local environment.
