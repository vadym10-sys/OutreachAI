# Deep Contact Search

Deep Contact Search turns a saved company into a richer sales opportunity without sending anything automatically.

## Server-only environment variables

Set these only on the backend service. Never expose them with `NEXT_PUBLIC_`.

- `APOLLO_API_KEY` - company profile, company enrichment and up to 10 decision-maker candidates.
- `HUNTER_API_KEY` - fallback domain search, email finder and email verifier.
- `BUILTWITH_API_KEY` - website technology stack.

The feature returns partial results when one provider is missing or rate-limited. It must not mark email discovery as complete unless a usable verified email is saved.

## Flow

1. Normalize the company domain.
2. Check the company-level enrichment cache in `companies.metadata_json.deep_contact_search`.
3. If the cache is fresh, return the saved result without charging providers again.
4. Enrich company profile through Apollo when configured.
5. Search up to 10 decision makers by revenue and growth roles:
   Founder, CEO, Owner, Head of Sales, Sales Director, CRO, CMO, Head of Marketing, CTO.
6. If Apollo returns no candidates, use Hunter Domain Search as fallback.
7. Select the best decision maker by role relevance, confidence, verified email availability and LinkedIn presence.
8. Run Hunter Email Finder and Hunter Email Verifier.
9. Run BuiltWith technographics when configured.
10. Save candidates, selected decision maker, verified email, confidence, lead score, technologies, stages, errors and `last_enriched_at`.

## Cache policy

The backend caches successful and partial enrichment results for 24 hours per company. Use the UI action "Retry search" to force a new provider run.

## Safety

- API keys stay on the backend.
- Full provider payloads are not logged.
- Email is not sent automatically.
- The user must review and approve generated email before sending.
- Partial provider failures are saved as stage errors and surfaced as user-friendly messages.
