# AI Research Engine V2 Changelog

Branch: `ai-research-engine-v2`

## Added

- AI Research Engine V2 panel in Company Workspace.
- Unified research coverage across website, business description, ICP, industry, technologies, hiring, news, team size, growth, funding, company LinkedIn, similar companies and why-now context.
- Buying Signal Engine with weighted signals that influence Lead Score V2.
- AI Lead Score V2 with reply probability, score reasons, signal impact and improvement guidance.
- Next Best Action engine with recommended action, channel, reason and direct workflow link.
- Outreach Copilot asset matrix for email, LinkedIn, follow-up #1, follow-up #2, subject line, call opener and meeting opener.
- Executive Timeline that combines completed workflow events, discovered signals and the recommended next action.
- AI Daily Brief on Dashboard for new companies, hot leads, buying signals, best action and last-24-hour changes.

## Preserved

- Existing backend endpoints and response contracts.
- Existing enrichment, contact discovery, sales analysis, email draft, approval and send flows.
- Human review before sending outreach.
- Existing public site, auth, billing, campaigns, inbox, settings and profile behavior.

## Technical Notes

- No backend files were changed.
- No API contract was changed.
- V2 is a frontend orchestration layer over existing AI fields:
  - `ai_revenue_engine_report`
  - `ai_sales_workspace`
  - `ai_live_buying_signals`
  - `ai_company_timeline`
  - `company_intelligence`
  - `ai_company_predictions`
  - `ai_outreach_strategy`
  - `ai_sales_timeline`
  - `ai_risk_analyzer`
  - existing CRM, activity and email state.

## Known Limitation

- Preview deployment still depends on a valid Vercel CLI login in the local environment.
