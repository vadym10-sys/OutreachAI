# Deployment Guide

## Vercel Web

1. Create a Vercel project from this repository.
2. Set root directory to `apps/web`.
3. Add all `NEXT_PUBLIC_*`, Clerk, and API URL environment variables.
4. Deploy with `npm run build`.

## Railway API

1. Create PostgreSQL on Railway.
2. Create a Railway service for `apps/api`.
3. Set the build command to install `apps/api/requirements.txt`.
4. Set the start command:

```bash
uvicorn app.main:app --host 0.0.0.0 --port $PORT
```

5. Add `DATABASE_URL`, Clerk, OpenAI, Resend, Stripe, and encryption environment variables.
6. Run `db/schema.sql` against the production database.

## Stripe

1. Create Starter, Pro, and Agency monthly products.
2. Copy price IDs into `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_AGENCY`.
3. Configure webhook URL: `https://<api-domain>/webhooks/stripe`.
4. Subscribe to `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, and `invoice.payment_succeeded`.

## Resend

1. Verify a sending domain.
2. Add SPF, DKIM, and DMARC DNS records.
3. Set `RESEND_FROM_EMAIL` to a verified sender.

## Clerk

1. Enable email/password login.
2. Enable Google OAuth.
3. Configure allowed redirect URLs for Vercel domains.
4. Set JWT issuer and frontend publishable key.
