# OutreachAI

OutreachAI is a subscription SaaS for lead discovery, AI website analysis, personalized outbound email campaigns, reply tracking, CRM workflows, and analytics.

## Architecture

- Frontend: Next.js App Router, TypeScript, Tailwind, Clerk
- Backend: FastAPI, SQLAlchemy, PostgreSQL, Clerk JWT verification hooks
- AI: OpenAI API
- Email: Resend
- Payments: Stripe subscriptions and webhooks
- Deployment: Vercel for web, Railway for API and PostgreSQL
- Runtime: Docker and docker-compose for local development

## Quick Start

```bash
cp .env.example .env
docker compose up --build
```

Frontend: http://localhost:3000
Backend API: http://localhost:8000/docs

## Local Without Docker

```bash
npm install
npm run dev
python -m venv .venv
source .venv/bin/activate
pip install -r apps/api/requirements.txt
uvicorn app.main:app --reload --app-dir apps/api
```

## Required API Keys

- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`
- `CLERK_JWT_ISSUER`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_STARTER`
- `STRIPE_PRICE_PRO`
- `STRIPE_PRICE_AGENCY`
- `OPENAI_API_KEY`
- `RESEND_API_KEY`
- `DATABASE_URL`
- `ENCRYPTION_KEY`

## Product Launch Checklist

- Configure Clerk production instance and Google OAuth.
- Create Stripe products, prices, customer portal, and webhook endpoint.
- Add verified sending domain in Resend.
- Provision Railway PostgreSQL and run `db/schema.sql`.
- Deploy `apps/api` to Railway and set production env vars.
- Deploy `apps/web` to Vercel and set production env vars.
- Point `NEXT_PUBLIC_API_URL` to the Railway API URL.
- Add custom domain, SSL, and DNS records.
- Run backend, frontend, and E2E tests.
- Verify subscription upgrade, downgrade, cancellation, and invoice history.
- Verify lead finder compliance for target markets before live prospecting.

## Documentation

- SQL schema: `db/schema.sql`
- API documentation: `docs/API.md`
- Deployment guide: `docs/DEPLOYMENT.md`
- Project structure: `docs/PROJECT_STRUCTURE.md`
