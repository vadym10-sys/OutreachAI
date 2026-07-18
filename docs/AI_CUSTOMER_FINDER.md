# AI Customer Finder

AI Customer Finder is intentionally simple. It exists to complete one customer-facing workflow:

```text
Enter website
  -> find B2B companies and public work emails
  -> save leads to the existing CRM without duplicates
  -> prepare a short personalized first email
  -> let the user send it or keep it as a draft
```

It is not a separate AI Sales Platform, dashboard, report engine, or revenue-intelligence module.

## Source Skill

The implementation adapts the useful parts of the local Codex `first-customer-finder` skill:

- understand the user's product from a website or short description;
- search public sources for plausible B2B customers;
- keep a public source URL for every material claim;
- reject unverified or weak matches;
- deduplicate companies and evidence;
- write a short source-grounded outreach draft;
- never send email automatically.

Rejected from the production product:

- standalone HTML reports;
- dozens of score panels;
- revenue/opportunity dashboards;
- raw prompts or provider output;
- speculative facts without a public source.

## Architecture

The feature reuses the existing OutreachAI stack:

```text
Web page
  -> FastAPI workspace API
  -> ai_customer_finder_jobs
  -> existing worker loop
  -> search provider
  -> public source verification
  -> existing Lead / Company / EmailMessage CRM tables
```

Important backend files:

- `apps/api/app/api/ai_customer_finder.py`
- `apps/api/app/services/ai_customer_finder/service.py`
- `apps/api/app/services/ai_customer_finder/providers.py`
- `apps/api/app/services/ai_customer_finder/dedupe.py`
- `apps/api/app/services/ai_customer_finder/schemas.py`

Important frontend files:

- `apps/web/app/dashboard/ai-customer-finder/page.tsx`
- `apps/web/components/ai-customer-finder/ai-customer-finder-page.tsx`

## User Flow

The page asks for only two inputs:

- company website;
- short description of the customers to find.

The backend keeps compatibility with the earlier richer criteria shape, but the UI sends a minimal request and defaults the rest safely.

The worker then:

1. searches approved public sources;
2. opens original public pages instead of trusting snippets;
3. extracts a business signal and a public work email when available;
4. rejects records without a working source URL;
5. saves or updates the CRM lead/company;
6. creates a draft `EmailMessage`;
7. returns progress and partial results to the UI.

## CRM Persistence

AI Customer Finder does not create a parallel CRM.

Saved fields are kept intentionally small:

- company name;
- website;
- industry;
- country;
- contact name and title if found;
- public work email if verified from the source;
- source URL and title;
- short reason why the company fits;
- simple lead status;
- draft email.

Simple statuses:

```text
Найден
Email проверен
Письмо подготовлено
Отправлено
Ответил
Не заинтересован
```

## Deduplication

Company and lead deduplication use the existing CRM duplicate logic plus Customer Finder keys:

- existing CRM lead/company;
- normalized domain;
- canonical website URL;
- normalized company name and country;
- email uniqueness inside the workspace/user scope.

Evidence deduplication uses:

- canonical source URL;
- content hash;
- signal fingerprint.

Repeated searches should update the existing CRM records and reuse the existing draft instead of creating uncontrolled duplicates.

## Email Rules

AI Customer Finder creates drafts only.

It never:

- sends automatically;
- starts a campaign automatically;
- invents a recipient;
- sends to placeholder or missing email addresses;
- bypasses sender setup, limits, or approval checks.

The UI exposes two explicit actions:

- `Сохранить как черновик`;
- `Отправить`.

Sending uses the existing OutreachAI email sender configuration and usage controls.

## Environment Variables

Optional:

```bash
AI_CUSTOMER_FINDER_PROVIDER=google_places
AI_CUSTOMER_FINDER_MAX_RESULTS_PER_JOB=10
AI_CUSTOMER_FINDER_MAX_CANDIDATES_PER_JOB=25
AI_CUSTOMER_FINDER_AI_CLASSIFICATION_ENABLED=false
```

Provider keys are configured through existing environment variables, for example:

```bash
GOOGLE_MAPS_API_KEY=
```

Do not commit real keys.

## Local Setup

1. Apply the project database migrations.
2. Start the API, web app, and worker.
3. Open `/dashboard/ai-customer-finder`.
4. Enter a company website and desired customer description.
5. Start the search.
6. Confirm that the first saved result appears with a source, CRM status, email draft, and draft/send buttons.

## Verification Rules

The product must keep uncertainty visible:

- source URL is required;
- publication date can be `Unknown`;
- company size can be blank;
- contact name can be blank;
- email can be blank when no legal public work email is found;
- AI is used for classification and drafting, not as a source of facts.

Search snippets alone are not treated as verified evidence when an original source is available.

## Limits

The MVP is deliberately bounded:

- small result count per job;
- asynchronous worker processing;
- partial results returned before the full job completes;
- no broad analytics panels;
- no automatic campaigns;
- no personal email scraping;
- no paywall, CAPTCHA, private community, or access-control bypass.

## Manual Test Scenario

Input:

```text
Website: https://outreachaiaiai.com
Customers: B2B SaaS companies in Europe with sales teams that need better outbound research.
```

Expected:

```text
Search starts
  -> first lead appears
  -> source link is visible
  -> lead is saved to CRM
  -> public work email is shown when found
  -> short first email is prepared
  -> Save draft keeps delivery_status=draft
  -> Send uses the existing email sender and updates CRM status
```
