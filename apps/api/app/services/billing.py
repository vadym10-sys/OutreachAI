from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

import stripe

from app.core.config import get_settings
from app.core.observability import capture_provider_exception
from app.services.plan_catalog import PLAN_CATALOG, TRIAL_DAYS, configured_price_id, normalize_billing_period, plan_from_configured_price_id

ACTIVE_STRIPE_STATUSES = {"active", "trialing"}


class UnknownStripePriceError(ValueError):
    pass


def _object_status(value: object) -> str:
    if isinstance(value, dict):
        return str(value.get("status") or "").lower()
    return str(getattr(value, "status", "") or "").lower()


@dataclass(frozen=True)
class CustomerSubscriptionDiagnostics:
    customer: object | None
    subscriptions: tuple[object, ...] = ()

    @property
    def active_or_trialing(self) -> tuple[object, ...]:
        return tuple(subscription for subscription in self.subscriptions if _object_status(subscription) in ACTIVE_STRIPE_STATUSES)

    @property
    def duplicate_active_or_trialing(self) -> bool:
        return len(self.active_or_trialing) > 1


def _capture_stripe_error(exc: BaseException, endpoint: str, *, workspace_id: str = "") -> None:
    capture_provider_exception(exc, provider="stripe", endpoint=endpoint, workspace_id=workspace_id)


def _validate_monthly_price(plan: str, price: object) -> None:
    spec = PLAN_CATALOG[plan].stripe_monthly
    if not getattr(price, "recurring", None) or price.recurring.get("interval") != "month":
        raise ValueError(f"{plan} Stripe price must be a recurring monthly price")
    if int(getattr(price, "unit_amount", 0) or 0) != int(spec.amount) or str(getattr(price, "currency", "")).lower() != spec.currency:
        raise ValueError(f"{plan} Stripe price must be €{spec.amount // 100}/month")


def price_for_plan(plan: str, billing_period: str = "monthly") -> str:
    normalize_billing_period(billing_period)
    settings = get_settings()
    stripe.api_key = settings.stripe_secret_key
    if plan not in PLAN_CATALOG:
        raise ValueError("Invalid billing plan")
    if not settings.stripe_secret_key:
        raise ValueError("STRIPE_SECRET_KEY is required to resolve billing prices")
    price_id = configured_price_id(plan, "monthly")
    if price_id:
        try:
            price = stripe.Price.retrieve(price_id)
        except stripe.StripeError as exc:
            _capture_stripe_error(exc, "stripe.price.retrieve")
            raise
        _validate_monthly_price(plan, price)
        return price_id
    try:
        found = stripe.Price.list(lookup_keys=[PLAN_CATALOG[plan].stripe_monthly.lookup_key], active=True, limit=1)
    except stripe.StripeError as exc:
        _capture_stripe_error(exc, "stripe.price.list")
        raise
    if found.data:
        price = found.data[0]
        _validate_monthly_price(plan, price)
        return price.id
    raise ValueError(f"STRIPE_{plan.upper()}_PRICE_ID is required for {plan} checkout")


def create_checkout_session(user_id: str, workspace_id: str, plan: str, customer_id: str = "", idempotency_key: str = "", billing_period: str = "monthly") -> dict:
    normalize_billing_period(billing_period)
    settings = get_settings()
    stripe.api_key = settings.stripe_secret_key
    if not settings.stripe_secret_key:
        raise ValueError("STRIPE_SECRET_KEY is required for billing checkout")
    if not settings.stripe_webhook_secret:
        raise ValueError("STRIPE_WEBHOOK_SECRET is required before subscriptions can be activated")
    if not customer_id:
        try:
            customer = stripe.Customer.create(metadata={"user_id": user_id, "workspace_id": workspace_id})
        except stripe.StripeError as exc:
            _capture_stripe_error(exc, "stripe.customer.create", workspace_id=workspace_id)
            raise
        customer_id = customer.id
    request_options = {"idempotency_key": idempotency_key} if idempotency_key else {}
    try:
        session = stripe.checkout.Session.create(
            mode="subscription",
            customer=customer_id,
            line_items=[{"price": price_for_plan(plan, "monthly"), "quantity": 1}],
            success_url=f"{settings.public_app_url.rstrip('/')}/billing/success?session_id={{CHECKOUT_SESSION_ID}}",
            cancel_url=f"{settings.public_app_url.rstrip('/')}/pricing",
            allow_promotion_codes=True,
            client_reference_id=user_id,
            subscription_data={"trial_period_days": TRIAL_DAYS, "metadata": {"user_id": user_id, "workspace_id": workspace_id, "plan": plan, "billing_period": "monthly"}},
            metadata={"user_id": user_id, "workspace_id": workspace_id, "plan": plan, "billing_period": "monthly", "product": f"OutreachAI {plan}"},
            custom_text={
                "submit": {"message": "Start your OutreachAI subscription. Your plan renews monthly after the 14-day free trial unless canceled."},
                "after_submit": {"message": "Your OutreachAI workspace will activate after Stripe confirms your subscription."},
            },
            **request_options,
        )
    except stripe.StripeError as exc:
        _capture_stripe_error(exc, "stripe.checkout.session.create", workspace_id=workspace_id)
        raise
    return {"url": session.url, "id": session.id, "customer_id": customer_id, "expires_at": getattr(session, "expires_at", None), "status": getattr(session, "status", "open")}


def create_billing_portal_session(customer_id: str, return_url: str) -> dict:
    settings = get_settings()
    stripe.api_key = settings.stripe_secret_key
    if not settings.stripe_secret_key:
        raise ValueError("STRIPE_SECRET_KEY is required for the billing portal")
    if not customer_id:
        raise ValueError("Stripe customer is not connected yet")
    try:
        session = stripe.billing_portal.Session.create(customer=customer_id, return_url=return_url)
    except stripe.StripeError as exc:
        _capture_stripe_error(exc, "stripe.billing_portal.session.create")
        raise
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
        stripe_spec = spec.stripe_monthly
        products = stripe.Product.search(query=f"name:'{spec.display_name}' AND active:'true'", limit=1)
        product = products.data[0] if products.data else stripe.Product.create(name=spec.display_name, description=spec.description, metadata={"plan": plan, "brand": "OutreachAI"})
        if getattr(product, "name", "") != spec.display_name or getattr(product, "description", "") != spec.description or getattr(product, "metadata", {}).get("brand") != "OutreachAI":
            product = stripe.Product.modify(product.id, name=spec.display_name, description=spec.description, metadata={"plan": plan, "brand": "OutreachAI"})
        prices = stripe.Price.list(lookup_keys=[stripe_spec.lookup_key], active=True, limit=10)
        price = next((item for item in prices.data if int(getattr(item, "unit_amount", 0) or 0) == stripe_spec.amount and str(getattr(item, "currency", "")).lower() == stripe_spec.currency and getattr(item, "recurring", None) and item.recurring.get("interval") == "month"), None)
        if price is None:
            price_payload = {
                "product": product.id,
                "unit_amount": stripe_spec.amount,
                "currency": stripe_spec.currency,
                "recurring": {"interval": "month"},
                "metadata": {"plan": plan, "billing_period": "monthly"},
            }
            if not prices.data:
                price_payload["lookup_key"] = stripe_spec.lookup_key
            price = stripe.Price.create(
                **price_payload,
            )
        created.append({"plan": plan, "billing_period": "monthly", "product_id": product.id, "price_id": price.id, "lookup_key": stripe_spec.lookup_key})
    return created


def plan_from_price_id(price_id: str) -> tuple[str, str] | None:
    settings = get_settings()
    configured = plan_from_configured_price_id(price_id)
    if configured:
        return configured
    if not settings.stripe_secret_key:
        return None
    stripe.api_key = settings.stripe_secret_key
    try:
        price = stripe.Price.retrieve(price_id)
    except stripe.StripeError:
        return None
    lookup_key = getattr(price, "lookup_key", None)
    for plan, spec in PLAN_CATALOG.items():
        if lookup_key == spec.stripe_monthly.lookup_key:
            return plan, "monthly"
    return None


def require_plan_for_price_id(price_id: str) -> tuple[str, str]:
    resolved = plan_from_price_id(price_id)
    if not resolved:
        raise UnknownStripePriceError("Unknown or retired Stripe price")
    return resolved


def timestamp_to_datetime(value: int | None) -> datetime | None:
    return datetime.utcfromtimestamp(value) if value else None


def _stripe_get(obj: object, key: str, default: object = None) -> object:
    if isinstance(obj, dict):
        return obj.get(key, default)
    getter = getattr(obj, "get", None)
    if callable(getter):
        return getter(key, default)
    return getattr(obj, key, default)


def subscription_price_id(subscription: object) -> str:
    try:
        return str(subscription["items"]["data"][0]["price"]["id"])
    except (KeyError, IndexError, TypeError):
        return ""


def subscription_payload(subscription: object) -> dict:
    price_id = subscription_price_id(subscription)
    metadata = _stripe_get(subscription, "metadata", {}) or {}
    if not isinstance(metadata, dict):
        metadata = {}
    resolved_plan: str | None = None
    billing_period = "monthly"
    if price_id:
        resolved_plan, billing_period = require_plan_for_price_id(price_id)
    elif metadata.get("plan") in PLAN_CATALOG:
        resolved_plan = str(metadata.get("plan"))
    if not resolved_plan:
        raise UnknownStripePriceError("Stripe subscription is missing an allowlisted monthly price")
    return {
        "subscription_id": str(_stripe_get(subscription, "id", "") or ""),
        "customer_id": str(_stripe_get(subscription, "customer", "") or ""),
        "price_id": price_id,
        "plan": resolved_plan,
        "billing_period": billing_period,
        "status": str(_stripe_get(subscription, "status", "") or "active"),
        "trial_end": timestamp_to_datetime(_stripe_get(subscription, "trial_end")),
        "current_period_end": timestamp_to_datetime(_stripe_get(subscription, "current_period_end")),
        "created": timestamp_to_datetime(_stripe_get(subscription, "created")),
        "workspace_id": str(metadata.get("workspace_id") or ""),
        "user_id": str(metadata.get("user_id") or ""),
    }


def subscription_diagnostics_for_customer(*, customer_id: str = "", customer_email: str = "") -> CustomerSubscriptionDiagnostics:
    settings = get_settings()
    stripe.api_key = settings.stripe_secret_key
    if not settings.stripe_secret_key:
        raise ValueError("STRIPE_SECRET_KEY is required to sync billing")
    customer = None
    if customer_id:
        customer = stripe.Customer.retrieve(customer_id)
    elif customer_email:
        customers = stripe.Customer.list(email=customer_email, limit=1)
        customer = customers.data[0] if customers.data else None
    if not customer:
        return CustomerSubscriptionDiagnostics(customer=None)
    subscriptions = stripe.Subscription.list(customer=customer.id, status="all", limit=10)
    return CustomerSubscriptionDiagnostics(customer=customer, subscriptions=tuple(subscriptions.data))
