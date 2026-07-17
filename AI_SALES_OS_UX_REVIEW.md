# AI Sales Operating System UX Review

## Product Goal

Turn OutreachAI from a CRM-like workspace into an AI Sales Operating System that tells the user what is happening, what matters, and what to do next.

## Primary User Journey

1. Sign up or sign in.
2. Open Dashboard and read Today Brief.
3. Start activation from Leads.
4. Define ICP or add one real company.
5. Save the company to the workspace.
6. Let AI research prepare the opportunity.
7. Open Company Workspace.
8. Review AI Company Intelligence.
9. Generate outreach.
10. Review and approve before sending.

## Dashboard UX

- The Dashboard now opens with a decision-first executive briefing.
- KPI cards show only metrics that affect the next sales action.
- AI Insights summarize bottlenecks and opportunities from current workspace data.
- Activity Timeline shows recent meaningful changes.
- Customer Activation gives new users a five-step path to first outreach.

## Company Workspace UX

- The Company Workspace now starts with business context, not raw CRM data.
- AI Company Intelligence summarizes profile, growth, technologies, news and vacancies.
- AI Recommendation makes the next action explicit.
- The existing detailed workspace remains available below for deeper review.

## Lead Workspace UX

- Each lead now exposes score, reply probability, scoring reasons and interaction history.
- AI Personalization groups the generated/saved assets by channel.
- The Generate action continues to use the existing sales-analysis flow.

## Activation Improvements

- New users are not sent into a blank CRM.
- The activation path uses real supported workflows: lead search, manual company save, AI enrichment, email generation and review.
- The product avoids fake sample data and keeps unknown values explicit.

## Quality Criteria

- No backend contract changes.
- No provider or internal API details in the primary user-facing workflow.
- No invented production data.
- Every new decision block links to an existing workflow.
- Mobile and desktop layouts must avoid horizontal overflow and preserve readable actions.

## Known Limitation

Preview deployment requires a valid Vercel CLI session in this environment. The frontend work is local until Preview can be created from the branch.
