# Billing Portal Production Review

Use this checklist before claiming Stripe Billing Portal transition behavior in production copy or launch notes.

- Confirm the active Stripe Billing Portal configuration allows only OutreachAI Starter, Pro and Agency monthly products/prices.
- Confirm no annual prices or annual billing periods are enabled or selectable.
- Confirm upgrade behavior, including whether Stripe applies immediate proration.
- Confirm downgrade behavior, including whether changes apply immediately or at the current period end.
- Confirm cancellation behavior, including whether cancellation applies immediately or at the current period end.
- Confirm unknown, retired or inactive prices cannot be selected in the portal.
- Confirm each active production subscription uses one of the canonical monthly prices before relying on entitlement access.
