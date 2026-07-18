# Landing To Backend Alignment

This document records the production-facing promises that the public site can safely make after the product-flow repair.

| Landing promise | Backend/API that supports it | Frontend surface | Status |
| --- | --- | --- | --- |
| User enters a product website, target customer, country, industry and criteria. | `POST /api/workspace-app/leads/first-customers/search` accepts `product_site`, `target_customer`, `country`, `industry`, `company_size`, `criteria`, `results`. | `/dashboard/leads` search form. | Supported. |
| OutreachAI searches approved public sources for matching companies. | `search_first_customer_candidates` uses the configured customer finder provider and stores an evidence ledger without CRM writes. | `/dashboard/leads` progress and results. | Supported when search provider keys are configured. |
| Each result keeps a source URL, source date when available, evidence and reason. | `CustomerFinderResultOut` returns `source_url`, `source_title`, `source_type`, `publication_date`, `evidence_summary`, `fit_explanation`, `verified_status`. | `/dashboard/leads` result cards. | Supported. Unknown values are displayed as unavailable. |
| Companies are saved to CRM only after user approval. | `POST /api/workspace-app/leads/first-customers/results/{result_id}/save` creates/reuses CRM records and draft email. Search itself records `crm_write=false`. | `/dashboard/leads` `Save to CRM` button. | Supported. |
| Saved companies show stage, contact route, notes and history. | `GET /api/workspace-app/companies`, `PATCH /api/crm/companies/{id}/stage`, `POST /api/crm/companies/{id}/notes`. | `/dashboard/crm`. | Supported. |
| AI prepares a short personalized draft email. | `POST /api/workspace-app/companies/{company_id}/email-draft` and first-customer save create `EmailMessage` with `delivery_status=draft`. | `/dashboard/crm`, `/dashboard/inbox`. | Supported when AI key is configured. |
| Email is never sent automatically. | `POST /api/workspace-app/emails/{email_id}/approve` only approves. `POST /api/workspace-app/emails/{email_id}/send` requires approved draft, recipient email and sender setup. | `/dashboard/inbox` separate Save, Approve, Send and Confirm Send buttons. | Supported. |
| Replies and send status update the workspace. | `GET /api/inbox`, Resend webhook processing and CRM company email status fields. | `/dashboard/inbox`, `/dashboard/crm`. | Supported when sender/webhook configuration is connected. |
| Service readiness is visible. | `GET /api/workspace-app/integrations/status`, `GET /api/outreach/sender/status`. | `/dashboard`, `/dashboard/leads`, `/dashboard/inbox`. | Supported. |
| Billing is real, not invented static quota claims. | `GET /api/billing/status`, `GET /api/billing/usage`, `GET /api/billing/plans`. | Account menu `/dashboard/billing`; public landing now avoids unverified quotas. | Supported inside app. |

## Corrected Public Claims

- Removed "AI Sales Employee", "launch campaigns", "meetings booked" and large usage quota claims from the primary landing message.
- Replaced fake-looking volume metrics with a process preview: search, verify, manual CRM save, draft review.
- Kept campaign and advanced surfaces out of the primary navigation because the production customer workflow is Search -> CRM -> Mail.
- Pricing copy now points to real Billing state instead of hardcoded public quotas.

## External Configuration Needed For Full Production Value

- `GOOGLE_MAPS_API_KEY`: company search provider.
- `HUNTER_API_KEY`: public business email discovery and verification.
- `OPENAI_API_KEY`: company fit analysis and draft email generation.
- Sender configuration: Resend or SMTP sender settings before manual sends.
