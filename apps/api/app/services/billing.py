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
        return {"url": success_url, "id": "dev_checkout"}
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
