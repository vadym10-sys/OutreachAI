# Landing To Backend Alignment

Date: 2026-07-18
Scope: current Preview customer workflow. No backend contracts are changed by this audit.

| Landing promise | App screen | User action | API contract | Database tables | Production note |
| --- | --- | --- | --- | --- | --- |
| Enter a product website and target market to find customers. | Search: `/dashboard/leads` | Submit the search wizard. | `POST /api/workspace-app/leads/first-customers/search` with `product_site`, `target_customer`, `country`, `industry`, `company_size`, `criteria`, `results`. | `ai_customer_finder_jobs`, `ai_customer_finder_results`, `ai_customer_finder_sources`, `audit_logs`. | Supported when `GOOGLE_MAPS_API_KEY`, `HUNTER_API_KEY` and `OPENAI_API_KEY` are configured. |
| Results come from public sources with evidence. | Search results: `/dashboard/leads` | Review result cards before any CRM save. | Response `CustomerFinderJobOut` exposes result fields including source URL, source title/type, publication date, evidence summary, fit explanation and verification status. | `ai_customer_finder_results`, `ai_customer_finder_sources`. | Unknown source dates remain visible as unknown; search results are not silently treated as CRM records. |
| Save only selected companies to CRM. | Search and CRM: `/dashboard/leads`, `/dashboard/crm` | Click `Save to CRM` on one result. | `POST /api/workspace-app/leads/first-customers/results/{result_id}/save`. | `companies`, `contacts`, `leads`, `deals`, `notes`, `email_messages`, `audit_logs`. | Manual approval is required before CRM persistence. Search itself does not create CRM records. |
| Work saved companies by stage, contacts, notes and history. | CRM: `/dashboard/crm` | Filter, open a company, update stage, add notes. | `GET /api/workspace-app/companies`, `PATCH /api/crm/companies/{company_id}/stage`, `POST /api/crm/companies/{company_id}/notes`. | `companies`, `contacts`, `deals`, `notes`, `audit_logs`. | Existing backend stages are displayed as the simpler user-facing stages: New, Under review, Ready to email, Contacted, Replied, Closed. |
| Prepare a short personalized first email. | CRM and Mail: `/dashboard/crm`, `/dashboard/inbox` | Generate/regenerate or review the draft. | `POST /api/workspace-app/companies/{company_id}/email-draft`, `PATCH /api/emails/{email_id}`. | `email_messages`, `companies`, `leads`, `audit_logs`. | Drafts remain draft-only until explicit approval and send confirmation. |
| Send is always manual. | Mail: `/dashboard/inbox` | Save draft, approve, click send, then confirm send. | `POST /api/workspace-app/emails/{email_id}/approve`, `POST /api/workspace-app/emails/{email_id}/send`. | `email_messages`, `companies`, `leads`, `audit_logs`. | Send requires an approved draft, recipient email and configured sender; no automatic sending is exposed in the primary UI. |
| Track sent status and replies. | Mail and CRM: `/dashboard/inbox`, `/dashboard/crm` | Review sent/replies tabs and CRM history. | `GET /api/inbox`, `GET /api/workspace-app/companies`. | `email_messages`, `companies`, `audit_logs`. | Reply and delivery data appear only when provider/webhook infrastructure is connected. |
| Show service readiness clearly. | Home, Search, Mail: `/dashboard`, `/dashboard/leads`, `/dashboard/inbox` | Review connection status before trying an unavailable action. | `GET /api/workspace-app/integrations/status`, `GET /api/outreach/sender/status`. | `app_settings`, workspace configuration, provider env-backed runtime state. | Missing external keys are shown as setup work instead of hidden failed buttons. |
| Keep workspace and language settings isolated per account. | Onboarding/account menu: dashboard shell, `/dashboard/profile`, `/dashboard/settings`. | Complete onboarding or update profile/settings. | `GET/PUT /api/workspace`, `GET/PATCH /api/profile`, settings endpoints used by the existing app. | `workspaces`, `workspace_members`, `workspace_profiles`, `app_settings`. | UI reads through authenticated API calls and keeps settings/profile out of the main workflow navigation. |
| Billing is real and not invented. | Public pricing, account menu Billing: `/dashboard/billing`. | Review plan, usage, invoices and upgrade controls. | `GET /api/billing/status`, `GET /api/billing/usage`, `GET /api/billing/invoices`, `GET /api/billing/plans`. | `subscriptions`, `usage_counters`. | Public pricing follows existing Billing configuration; exact limits remain inside Billing when they depend on runtime setup. |

## Removed Or De-Emphasized Claims

- No fake customer logos, fake production metrics or decorative zero dashboards are used as proof.
- The primary app no longer exposes separate duplicate CRM sections for Leads, Companies and Deals in the main navigation.
- Executive Dashboard, Revenue Intelligence and broad campaign automation are not part of the primary Preview workflow.
- Search does not automatically save companies, send email, create campaigns or take LinkedIn actions.

## Required External Configuration

These secrets must stay in Vercel/Railway or the backend runtime and must never be committed:

- `GOOGLE_MAPS_API_KEY`: company discovery.
- `HUNTER_API_KEY`: public business email discovery and verification.
- `OPENAI_API_KEY`: fit explanation and email draft generation.
- Resend or SMTP sender settings: manual email sending after review.
