from __future__ import annotations

import stripe

from app.core.config import get_settings

PLAN_CATALOG = {
    "Starter": {"amount": 4900, "currency": "eur", "lookup_key": "outreachai_starter_monthly"},
    "Pro": {"amount": 14900, "currency": "eur", "lookup_key": "outreachai_pro_monthly"},
    "Agency": {"amount": 49900, "currency": "eur", "lookup_key": "outreachai_agency_monthly"},
}


def price_for_plan(plan: str) -> str:
    settings = get_settings()
    stripe.api_key = settings.stripe_secret_key
    prices = {
        "Starter": settings.stripe_price_starter,
        "Pro": settings.stripe_price_pro,
        "Agency": settings.stripe_price_agency
    }
    if plan not in prices:
        raise ValueError("Invalid billing plan")
    if prices[plan]:
        return prices[plan]
    if not settings.stripe_secret_key:
        raise ValueError("STRIPE_SECRET_KEY is required to resolve billing prices")
    found = stripe.Price.list(lookup_keys=[PLAN_CATALOG[plan]["lookup_key"]], active=True, limit=1)
    if found.data:
        return found.data[0].id
    raise ValueError(f"Stripe price is not configured for {plan}")


def create_checkout_session(user_id: str, workspace_id: str, plan: str, success_url: str, cancel_url: str) -> dict:
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
        subscription_data={"trial_period_days": 14, "metadata": {"user_id": user_id, "workspace_id": workspace_id, "plan": plan}},
        metadata={"user_id": user_id, "workspace_id": workspace_id, "plan": plan}
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


def ensure_subscription_catalog() -> list[dict]:
    settings = get_settings()
    stripe.api_key = settings.stripe_secret_key
    if not settings.stripe_secret_key:
        raise ValueError("STRIPE_SECRET_KEY is required to create Stripe products and prices")

    created: list[dict] = []
    for plan, spec in PLAN_CATALOG.items():
        products = stripe.Product.search(query=f"name:'OutreachAI {plan}' AND active:'true'", limit=1)
        product = products.data[0] if products.data else stripe.Product.create(name=f"OutreachAI {plan}", metadata={"plan": plan})
        prices = stripe.Price.list(lookup_keys=[spec["lookup_key"]], active=True, limit=1)
        price = prices.data[0] if prices.data else stripe.Price.create(
            product=product.id,
            unit_amount=spec["amount"],
            currency=spec["currency"],
            recurring={"interval": "month"},
            lookup_key=spec["lookup_key"],
            metadata={"plan": plan},
        )
        created.append({"plan": plan, "product_id": product.id, "price_id": price.id, "lookup_key": spec["lookup_key"]})
    return created


def plan_from_price_id(price_id: str) -> str | None:
    settings = get_settings()
    configured = {
        settings.stripe_price_starter: "Starter",
        settings.stripe_price_pro: "Pro",
        settings.stripe_price_agency: "Agency",
    }
    if price_id in configured:
        return configured[price_id]
    if not settings.stripe_secret_key:
        return None
    stripe.api_key = settings.stripe_secret_key
    try:
        price = stripe.Price.retrieve(price_id)
    except stripe.StripeError:
        return None
    lookup_key = getattr(price, "lookup_key", None)
    for plan, spec in PLAN_CATALOG.items():
        if lookup_key == spec["lookup_key"]:
            return plan
    return None
