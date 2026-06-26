from __future__ import annotations

import stripe

from app.core.config import get_settings


def price_for_plan(plan: str) -> str:
    settings = get_settings()
    prices = {
        "Starter": settings.stripe_price_starter,
        "Pro": settings.stripe_price_pro,
        "Agency": settings.stripe_price_agency
    }
    if plan not in prices or not prices[plan]:
        raise ValueError("Invalid billing plan")
    return prices[plan]


def create_checkout_session(user_id: str, plan: str, success_url: str, cancel_url: str) -> dict:
    settings = get_settings()
    stripe.api_key = settings.stripe_secret_key
    if not settings.stripe_secret_key:
        raise ValueError("STRIPE_SECRET_KEY is required for billing checkout")
    session = stripe.checkout.Session.create(
        mode="subscription",
        line_items=[{"price": price_for_plan(plan), "quantity": 1}],
        success_url=success_url,
        cancel_url=cancel_url,
        client_reference_id=user_id,
        subscription_data={"trial_period_days": 14},
        metadata={"user_id": user_id, "plan": plan}
    )
    return {"url": session.url, "id": session.id}


def create_billing_portal_session(customer_id: str, return_url: str) -> dict:
    settings = get_settings()
    stripe.api_key = settings.stripe_secret_key
    if not settings.stripe_secret_key:
        raise ValueError("STRIPE_SECRET_KEY is required for the billing portal")
    if not customer_id:
        raise ValueError("Stripe customer is not connected yet")
    session = stripe.billing_portal.Session.create(customer=customer_id, return_url=return_url)
    return {"url": session.url, "id": session.id}


def list_invoices(customer_id: str) -> list[dict]:
    settings = get_settings()
    stripe.api_key = settings.stripe_secret_key
    if not settings.stripe_secret_key or not customer_id:
        return []
    invoices = stripe.Invoice.list(customer=customer_id, limit=20)
    return [
        {
            "id": invoice.id,
            "status": invoice.status or "draft",
            "amount_due": invoice.amount_due or 0,
            "hosted_invoice_url": invoice.hosted_invoice_url,
            "created": invoice.created,
        }
        for invoice in invoices.data
    ]
