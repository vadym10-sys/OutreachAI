# Deployment Guide

## Vercel Web

1. Create a Vercel project from this repository.
2. Set root directory to `apps/web`.
3. Add all `NEXT_PUBLIC_*`, Clerk, and API URL environment variables.
4. Deploy with `npm run build`.

## Railway API

1. Create PostgreSQL on Railway.
2. Create a Railway service for `apps/api`.
3. Set Root Directory to `apps/api`.
4. Use Dockerfile builder with Dockerfile Path `Dockerfile`.
5. Leave Build Command empty.
6. Leave Start Command empty so Railway uses the Dockerfile `CMD`.
7. Add `DATABASE_URL`, Clerk, OpenAI, Resend, Stripe, and encryption environment variables.
8. Run `db/schema.sql` against the production database.

## Stripe

1. Create Starter, Pro, and Agency monthly products.
2. Copy price IDs into `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_AGENCY`.
3. Configure webhook URL: `https://<api-domain>/webhooks/stripe`.
4. Subscribe to `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, and `invoice.payment_succeeded`.

## Resend

1. Verify a sending domain.
2. Add SPF, DKIM, and DMARC DNS records.
3. Set `RESEND_FROM_EMAIL` to a verified sender.
4. Configure the Resend webhook endpoint:
   `https://outreachai-api-production.up.railway.app/webhooks/resend`
5. Subscribe to:
   `email.delivered`, `email.opened`, `email.bounced`, `email.complained`, and `email.received`.
6. Copy the Resend webhook signing secret into `RESEND_WEBHOOK_SECRET`.

Required Railway variables for the API service:

```env
RESEND_API_KEY=...
RESEND_FROM_EMAIL=...
RESEND_REPLY_TO=...
RESEND_WEBHOOK_SECRET=...
```

## Clerk

1. Enable email/password login.
2. Enable Google OAuth.
3. Configure allowed redirect URLs for Vercel domains.
4. Set JWT issuer and frontend publishable key.
