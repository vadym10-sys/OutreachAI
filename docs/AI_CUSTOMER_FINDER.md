# AI Customer Finder

AI Customer Finder is an evidence-first prospect discovery workflow for OutreachAI. It adapts the local Codex `first-customer-finder` skill into a native product feature while keeping fact gathering, verification, scoring, and CRM persistence inside the OutreachAI backend.

## Architecture

The feature follows the existing OutreachAI app shape:

```text
Web UI
  -> FastAPI workspace API
  -> ai_customer_finder_jobs
  -> enrichment worker
  -> search provider
  -> website verification
  -> deterministic scoring
  -> existing Lead and Company CRM records
```

The production integration is modular:

- `search providers`: source adapters that return public candidate companies.
- `verification layer`: fetches original public source pages and rejects candidates without a working source URL.
- `AI scoring`: deterministic scoring and explanation based on verified public evidence.
- `deduplication`: normalizes domains, company names, canonical URLs, and signal fingerprints.
- `CRM persistence`: reuses existing `Lead` and `Company` models instead of creating a parallel CRM.
- `job orchestration`: reuses the enrichment worker loop and stores partial progress.

## Skill Installation

The source repository was installed as a local Codex skill:

```text
~/.codex/skills/first-customer-finder
```

The original skill instructions remain intact. OutreachAI-specific guidance was added in:

```text
~/.codex/skills/first-customer-finder/references/outreachai-adaptation.md
```

That adaptation documents the OutreachAI CRM field mapping, truth rules, signal policy, and draft-only outreach behavior.

## Database Schema

Migration:

```text
db/migrations/010_ai_customer_finder.sql
```

New tables:

- `ai_customer_finder_jobs`: criteria, status, progress, retries, cancellation, and completion metadata.
- `ai_customer_finder_results`: verified companies, signal evidence, scoring, confidence, and CRM links.
- `ai_customer_finder_sources`: source audit trail, retrieval metadata, content hash, and verification status.

The feature preserves workspace isolation by storing `workspace_id` on every job, result, and source record.

## Environment Variables

Optional variables:

```bash
AI_CUSTOMER_FINDER_PROVIDER=google_places
AI_CUSTOMER_FINDER_MAX_RESULTS_PER_JOB=10
AI_CUSTOMER_FINDER_MAX_CANDIDATES_PER_JOB=25
AI_CUSTOMER_FINDER_AI_CLASSIFICATION_ENABLED=false
```

The current provider reuses the existing Google Maps/Places configuration already used by OutreachAI:

```bash
GOOGLE_MAPS_API_KEY=
```

No secrets are required in code. Provider credentials must be set only through environment variables.

## Worker Lifecycle

The existing enrichment worker claims AI Customer Finder jobs when no enrichment job is pending.

Job statuses:

- `queued`
- `searching`
- `verifying`
- `enriching`
- `completed`
- `partially_completed`
- `failed`

The worker supports bounded retries with exponential backoff, job locking, cancellation requests, partial result persistence, and structured audit logs.

## Running Locally

1. Apply migrations in the normal project migration flow.
2. Set the optional AI Customer Finder environment variables if defaults are not desired.
3. Start the API, web app, and worker.
4. Open the app and go to:

```text
/dashboard/ai-customer-finder
```

5. Enter a company description, product/service, country, industry, company size, contact roles, and optional criteria.
6. Start the search and let the worker process it asynchronously.

## Result Verification

A result is accepted only when it has:

- company name
- official website
- working public source URL
- source title or type
- retrieved evidence summary
- signal type and explanation
- relevance and confidence scores

If a field cannot be confirmed, it is left empty or marked as `unverified`. AI output is not treated as a source of facts.

## CRM Persistence

Verified and partially verified results are saved into the existing CRM:

- A matching `Company` is reused when the domain, URL, or normalized name matches.
- A matching `Lead` is reused when an existing duplicate is found.
- Evidence and source metadata are stored in CRM metadata and the AI Customer Finder audit tables.
- No email is sent and no campaign is started automatically.

## Intent Score Timeline and Notifications

AI Customer Finder is designed to support repeated monitoring of the same company. When a new verified signal is found for an existing CRM company, the backend compares the previous company intent score with the new score.

Example:

```text
Microsoft
Intent Score: 62

2 days later: Hiring SDR
Intent Score: 74

1 week later: Funding
Intent Score: 86
Notification created
```

The score movement is stored in `Company.metadata_json.ai_live_buying_signals`:

- `current_score`
- `previous_score`
- `score_delta`
- `latest_changes`
- `change_timeline`
- `snapshot.latest_signal`
- `snapshot.latest_source_url`

A notification is created only when the score movement is meaningful. The current rule is:

- previous score exists;
- the signal is new;
- score reaches at least `80` with a delta of at least `8`, or the delta is at least `15`.

This prevents small repeated source changes from becoming noisy alerts.

## Deduplication

Company deduplication uses:

- normalized domain
- canonical website URL
- normalized company name plus country

Evidence deduplication uses:

- canonical source URL
- normalized title
- evidence content hash
- signal fingerprint

The database enforces one signal fingerprint per workspace/job pair.

## Adding a Search Provider

Add a provider implementing `CustomerSearchProvider` in:

```text
apps/api/app/services/ai_customer_finder/providers.py
```

A provider must return `PublicCustomerCandidate` objects and must not bypass paywalls, authentication, CAPTCHA, robots restrictions, access controls, or rate limits.

Provider API keys must be added through environment variables and documented in `.env.example`.

## Limits and Costs

The feature is intentionally bounded:

- default maximum results per job: 10
- default maximum candidates per job: 25
- retries are bounded
- providers should enforce rate limits and timeouts
- LLM-based classification is disabled by default

The MVP uses deterministic scoring from verified source content. Future LLM classification must use structured JSON and validation before persistence.

## Privacy Rules

AI Customer Finder uses public business information only. It must not use leaked data, private communities, personal email scraping, phone-number enrichment, sensitive personal data, or automated outreach.

## Rollback

Rollback is safe because the integration adds isolated tables and one dashboard route. To roll back:

1. Remove the dashboard route and navigation item.
2. Stop processing AI Customer Finder jobs in the worker.
3. Leave historical tables in place for audit retention or drop them through a planned migration if no longer needed.
