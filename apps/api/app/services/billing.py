from __future__ import annotations

import stripe

from app.core.config import get_settings

PLAN_CATALOG = {
    "Starter": {
        "amount": 4900,
        "currency": "eur",
        "lookup_key": "outreachai_starter_monthly",
        "name": "OutreachAI Starter",
        "description": "OutreachAI Starter monthly subscription with a 14-day free trial.",
    },
    "Pro": {
        "amount": 14900,
        "currency": "eur",
        "lookup_key": "outreachai_pro_monthly",
        "name": "OutreachAI Pro",
        "description": "OutreachAI Pro monthly subscription with a 14-day free trial.",
    },
    "Agency": {
        "amount": 49900,
        "currency": "eur",
        "lookup_key": "outreachai_agency_monthly",
        "name": "OutreachAI Agency",
        "description": "OutreachAI Agency monthly subscription with a 14-day free trial.",
    },
}


def _validate_monthly_price(plan: str, price: object) -> None:
    spec = PLAN_CATALOG[plan]
    if not getattr(price, "recurring", None) or price.recurring.get("interval") != "month":
        raise ValueError(f"{plan} Stripe price must be a recurring monthly price")
    if int(getattr(price, "unit_amount", 0) or 0) != int(spec["amount"]) or str(getattr(price, "currency", "")).lower() != spec["currency"]:
        raise ValueError(f"{plan} Stripe price must be €{spec['amount'] // 100}/month")


def price_for_plan(plan: str) -> str:
    settings = get_settings()
    stripe.api_key = settings.stripe_secret_key
    prices = {
        "Starter": settings.stripe_starter_price_id,
        "Pro": settings.stripe_pro_price_id,
        "Agency": settings.stripe_agency_price_id
    }
    if plan not in prices:
        raise ValueError("Invalid billing plan")
    if not settings.stripe_secret_key:
        raise ValueError("STRIPE_SECRET_KEY is required to resolve billing prices")
    if prices[plan]:
        price = stripe.Price.retrieve(prices[plan])
        _validate_monthly_price(plan, price)
        return prices[plan]
    found = stripe.Price.list(lookup_keys=[PLAN_CATALOG[plan]["lookup_key"]], active=True, limit=1)
    if found.data:
        price = found.data[0]
        _validate_monthly_price(plan, price)
        return price.id
    raise ValueError(f"STRIPE_{plan.upper()}_PRICE_ID is required for {plan} checkout")


def create_checkout_session(user_id: str, workspace_id: str, plan: str, customer_id: str = "") -> dict:
    settings = get_settings()
    stripe.api_key = settings.stripe_secret_key
    if not settings.stripe_secret_key:
        raise ValueError("STRIPE_SECRET_KEY is required for billing checkout")
    if not settings.stripe_webhook_secret:
        raise ValueError("STRIPE_WEBHOOK_SECRET is required before subscriptions can be activated")
    if not customer_id:
        customer = stripe.Customer.create(metadata={"user_id": user_id, "workspace_id": workspace_id})
        customer_id = customer.id
    session = stripe.checkout.Session.create(
        mode="subscription",
        submit_type="pay",
        customer=customer_id,
        line_items=[{"price": price_for_plan(plan), "quantity": 1}],
        success_url=f"{settings.public_app_url.rstrip('/')}/billing/success?session_id={{CHECKOUT_SESSION_ID}}",
        cancel_url=f"{settings.public_app_url.rstrip('/')}/pricing",
        allow_promotion_codes=True,
        client_reference_id=user_id,
        subscription_data={"trial_period_days": 14, "metadata": {"user_id": user_id, "workspace_id": workspace_id, "plan": plan}},
        metadata={"user_id": user_id, "workspace_id": workspace_id, "plan": plan, "product": f"OutreachAI {plan}"},
        custom_text={
            "submit": {"message": "Start your OutreachAI subscription. Your plan renews monthly after the 14-day free trial unless canceled."},
            "after_submit": {"message": "Your OutreachAI workspace will activate after Stripe confirms your subscription."},
        },
    )
    return {"url": session.url, "id": session.id, "customer_id": customer_id}


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
        products = stripe.Product.search(query=f"name:'{spec['name']}' AND active:'true'", limit=1)
        product = products.data[0] if products.data else stripe.Product.create(name=spec["name"], description=spec["description"], metadata={"plan": plan, "brand": "OutreachAI"})
        if getattr(product, "name", "") != spec["name"] or getattr(product, "description", "") != spec["description"] or getattr(product, "metadata", {}).get("brand") != "OutreachAI":
            product = stripe.Product.modify(product.id, name=spec["name"], description=spec["description"], metadata={"plan": plan, "brand": "OutreachAI"})
        prices = stripe.Price.list(lookup_keys=[spec["lookup_key"]], active=True, limit=10)
        price = next((item for item in prices.data if int(getattr(item, "unit_amount", 0) or 0) == spec["amount"] and str(getattr(item, "currency", "")).lower() == spec["currency"] and getattr(item, "recurring", None) and item.recurring.get("interval") == "month"), None)
        if price is None:
            price_payload = {
                "product": product.id,
                "unit_amount": spec["amount"],
                "currency": spec["currency"],
                "recurring": {"interval": "month"},
                "metadata": {"plan": plan},
            }
            if not prices.data:
                price_payload["lookup_key"] = spec["lookup_key"]
            price = stripe.Price.create(
                **price_payload,
            )
        created.append({"plan": plan, "product_id": product.id, "price_id": price.id, "lookup_key": spec["lookup_key"]})
    return created


def plan_from_price_id(price_id: str) -> str | None:
    settings = get_settings()
    configured = {
        settings.stripe_starter_price_id: "Starter",
        settings.stripe_pro_price_id: "Pro",
        settings.stripe_agency_price_id: "Agency",
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
