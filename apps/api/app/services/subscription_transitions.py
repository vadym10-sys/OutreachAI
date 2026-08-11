from __future__ import annotations

import hashlib
from datetime import datetime
from typing import Any
from uuid import UUID

import stripe
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.observability import capture_provider_exception
from app.models.entities import BillingSubscriptionTransition, Subscription, Workspace
from app.services.billing import price_for_plan, require_plan_for_price_id, subscription_price_id
from app.services.plan_catalog import PLAN_CATALOG, PLAN_ORDER

OPEN_TRANSITION_STATUSES = {"pending", "scheduled"}
TERMINAL_TRANSITION_STATUSES = {"applied", "canceled", "failed"}


class SubscriptionTransitionError(ValueError):
    pass


def plan_direction(from_plan: str, to_plan: str) -> str:
    if from_plan not in PLAN_CATALOG or to_plan not in PLAN_CATALOG:
        raise SubscriptionTransitionError("Unknown subscription plan")
    if from_plan == to_plan:
        raise SubscriptionTransitionError("Choose a different monthly plan")
    from_index = PLAN_ORDER.index(from_plan)
    to_index = PLAN_ORDER.index(to_plan)
    return "upgrade" if to_index > from_index else "downgrade"


def transition_idempotency_key(workspace_id: UUID, subscription_id: str, from_plan: str, to_plan: str, direction: str) -> str:
    raw = f"{workspace_id}:{subscription_id}:{from_plan}:{to_plan}:monthly:{direction}"
    return "sub_change_" + hashlib.sha256(raw.encode("utf-8")).hexdigest()[:48]


def cancellation_idempotency_key(workspace_id: UUID, subscription_id: str, action: str) -> str:
    raw = f"{workspace_id}:{subscription_id}:cancel:{action}"
    return "sub_cancel_" + hashlib.sha256(raw.encode("utf-8")).hexdigest()[:48]


def open_transition(db: Session, *, workspace_id: UUID, subscription_id: str) -> BillingSubscriptionTransition | None:
    return db.scalar(
        select(BillingSubscriptionTransition)
        .where(
            BillingSubscriptionTransition.workspace_id == workspace_id,
            BillingSubscriptionTransition.stripe_subscription_id == subscription_id,
            BillingSubscriptionTransition.status.in_(OPEN_TRANSITION_STATUSES),
        )
        .order_by(BillingSubscriptionTransition.created_at.desc())
    )


def active_or_trialing_subscription_rows(db: Session, workspace: Workspace) -> list[Subscription]:
    return list(
        db.scalars(
            select(Subscription).where(
                Subscription.workspace_id == workspace.id,
                Subscription.status.in_(("active", "trialing")),
                Subscription.stripe_subscription_id.is_not(None),
                Subscription.stripe_subscription_id != "",
            )
        ).all()
    )


def require_single_app_controlled_subscription(db: Session, workspace: Workspace) -> Subscription:
    rows = active_or_trialing_subscription_rows(db, workspace)
    if len(rows) != 1:
        raise SubscriptionTransitionError("Exactly one active or trialing Stripe subscription is required before changing plans.")
    subscription = rows[0]
    if subscription.plan not in PLAN_CATALOG:
        raise SubscriptionTransitionError("Current subscription plan requires owner review before changing plans.")
    if not subscription.stripe_customer_id or not subscription.stripe_subscription_id:
        raise SubscriptionTransitionError("Stripe subscription is not connected.")
    return subscription


def _object_get(value: object, key: str, default: object = None) -> object:
    if isinstance(value, dict):
        return value.get(key, default)
    getter = getattr(value, "get", None)
    if callable(getter):
        return getter(key, default)
    return getattr(value, key, default)


def _metadata_dict(value: object) -> dict[str, Any]:
    metadata = _object_get(value, "metadata", {}) or {}
    return dict(metadata) if isinstance(metadata, dict) else {}


def _subscription_item_id(stripe_subscription: object) -> str:
    try:
        return str(stripe_subscription["items"]["data"][0]["id"])
    except (KeyError, IndexError, TypeError):
        pass
    items = _object_get(stripe_subscription, "items", {}) or {}
    data = _object_get(items, "data", []) or []
    if data:
        return str(_object_get(data[0], "id", "") or "")
    return ""


def _timestamp(value: object) -> int | None:
    if value in (None, ""):
        return None
    try:
        return int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None


def _validate_stripe_subscription_binding(
    *,
    stripe_subscription: object,
    local_subscription: Subscription,
    workspace_id: UUID,
    user_id: str,
) -> None:
    if str(_object_get(stripe_subscription, "id", "") or "") != str(local_subscription.stripe_subscription_id):
        raise SubscriptionTransitionError("Stripe subscription binding mismatch.")
    if str(_object_get(stripe_subscription, "customer", "") or "") != str(local_subscription.stripe_customer_id):
        raise SubscriptionTransitionError("Stripe customer binding mismatch.")
    metadata = _metadata_dict(stripe_subscription)
    if str(metadata.get("workspace_id") or "") != str(workspace_id):
        raise SubscriptionTransitionError("Stripe subscription workspace binding mismatch.")
    if str(metadata.get("user_id") or "") != user_id:
        raise SubscriptionTransitionError("Stripe subscription user binding mismatch.")
    price_id = subscription_price_id(stripe_subscription)
    plan, billing_period = require_plan_for_price_id(price_id)
    if plan != local_subscription.plan or billing_period != "monthly":
        raise SubscriptionTransitionError("Stripe subscription price does not match the local monthly entitlement.")


def retrieve_bound_stripe_subscription(*, local_subscription: Subscription, workspace_id: UUID, user_id: str) -> object:
    settings = get_settings()
    stripe.api_key = settings.stripe_secret_key
    if not settings.stripe_secret_key:
        raise SubscriptionTransitionError("STRIPE_SECRET_KEY is required for subscription changes.")
    try:
        stripe_subscription = stripe.Subscription.retrieve(str(local_subscription.stripe_subscription_id))
    except stripe.StripeError as exc:
        capture_provider_exception(exc, provider="stripe", endpoint="stripe.subscription.retrieve", workspace_id=str(workspace_id))
        raise
    _validate_stripe_subscription_binding(stripe_subscription=stripe_subscription, local_subscription=local_subscription, workspace_id=workspace_id, user_id=user_id)
    return stripe_subscription


def create_transition_row(
    db: Session,
    *,
    workspace_id: UUID,
    user_id: str,
    subscription: Subscription,
    to_plan: str,
    direction: str,
    idempotency_key: str,
    effective_at: datetime | None,
) -> BillingSubscriptionTransition:
    transition = BillingSubscriptionTransition(
        workspace_id=workspace_id,
        user_id=user_id,
        stripe_customer_id=str(subscription.stripe_customer_id or ""),
        stripe_subscription_id=str(subscription.stripe_subscription_id or ""),
        from_plan=subscription.plan,
        to_plan=to_plan,
        billing_period="monthly",
        direction=direction,
        status="pending",
        idempotency_key=idempotency_key,
        effective_at=effective_at,
        metadata_json={},
    )
    db.add(transition)
    db.flush()
    return transition


def apply_upgrade_now(
    *,
    transition: BillingSubscriptionTransition,
    stripe_subscription: object,
    to_plan: str,
) -> object:
    item_id = _subscription_item_id(stripe_subscription)
    if not item_id:
        raise SubscriptionTransitionError("Stripe subscription item is missing.")
    price_id = price_for_plan(to_plan, "monthly")
    metadata = {
        **_metadata_dict(stripe_subscription),
        "workspace_id": str(transition.workspace_id),
        "user_id": transition.user_id,
        "plan": to_plan,
        "billing_period": "monthly",
        "transition_id": str(transition.id),
    }
    try:
        return stripe.Subscription.modify(
            transition.stripe_subscription_id,
            items=[{"id": item_id, "price": price_id}],
            proration_behavior="always_invoice",
            payment_behavior="pending_if_incomplete",
            metadata=metadata,
            idempotency_key=transition.idempotency_key,
        )
    except stripe.StripeError as exc:
        capture_provider_exception(exc, provider="stripe", endpoint="stripe.subscription.modify.upgrade", workspace_id=str(transition.workspace_id))
        raise


def schedule_downgrade(
    *,
    transition: BillingSubscriptionTransition,
    stripe_subscription: object,
    to_plan: str,
) -> object:
    current_price_id = subscription_price_id(stripe_subscription)
    target_price_id = price_for_plan(to_plan, "monthly")
    current_period_start = _timestamp(_object_get(stripe_subscription, "current_period_start"))
    current_period_end = _timestamp(_object_get(stripe_subscription, "current_period_end"))
    if not current_period_end:
        raise SubscriptionTransitionError("Stripe subscription current_period_end is required for downgrade scheduling.")
    metadata = {
        **_metadata_dict(stripe_subscription),
        "workspace_id": str(transition.workspace_id),
        "user_id": transition.user_id,
        "plan": transition.from_plan,
        "billing_period": "monthly",
        "pending_plan": to_plan,
        "transition_id": str(transition.id),
    }
    try:
        schedule = stripe.SubscriptionSchedule.create(
            from_subscription=transition.stripe_subscription_id,
            metadata=metadata,
            idempotency_key=transition.idempotency_key,
        )
        schedule_id = str(_object_get(schedule, "id", "") or "")
        if schedule_id:
            schedule = stripe.SubscriptionSchedule.modify(
                schedule_id,
                end_behavior="release",
                phases=[
                    {**({"start_date": current_period_start} if current_period_start else {}), "items": [{"price": current_price_id}], "end_date": current_period_end, "metadata": metadata},
                    {"items": [{"price": target_price_id}], "metadata": {**metadata, "plan": to_plan}},
                ],
                metadata=metadata,
            )
        return schedule
    except stripe.StripeError as exc:
        capture_provider_exception(exc, provider="stripe", endpoint="stripe.subscription_schedule.downgrade", workspace_id=str(transition.workspace_id))
        raise


def request_cancel_at_period_end(*, subscription: Subscription, workspace_id: UUID, user_id: str) -> object:
    stripe_subscription = retrieve_bound_stripe_subscription(local_subscription=subscription, workspace_id=workspace_id, user_id=user_id)
    metadata = {**_metadata_dict(stripe_subscription), "workspace_id": str(workspace_id), "user_id": user_id, "billing_period": "monthly"}
    try:
        return stripe.Subscription.modify(
            str(subscription.stripe_subscription_id),
            cancel_at_period_end=True,
            metadata=metadata,
            idempotency_key=cancellation_idempotency_key(workspace_id, str(subscription.stripe_subscription_id), "request"),
        )
    except stripe.StripeError as exc:
        capture_provider_exception(exc, provider="stripe", endpoint="stripe.subscription.modify.cancel_at_period_end", workspace_id=str(workspace_id))
        raise


def undo_cancel_at_period_end(*, subscription: Subscription, workspace_id: UUID, user_id: str) -> object:
    stripe_subscription = retrieve_bound_stripe_subscription(local_subscription=subscription, workspace_id=workspace_id, user_id=user_id)
    metadata = {**_metadata_dict(stripe_subscription), "workspace_id": str(workspace_id), "user_id": user_id, "billing_period": "monthly"}
    try:
        return stripe.Subscription.modify(
            str(subscription.stripe_subscription_id),
            cancel_at_period_end=False,
            metadata=metadata,
            idempotency_key=cancellation_idempotency_key(workspace_id, str(subscription.stripe_subscription_id), "undo"),
        )
    except stripe.StripeError as exc:
        capture_provider_exception(exc, provider="stripe", endpoint="stripe.subscription.modify.cancel_undo", workspace_id=str(workspace_id))
        raise


def cancel_scheduled_transition(*, transition: BillingSubscriptionTransition) -> None:
    if transition.direction == "downgrade" and transition.stripe_schedule_id:
        settings = get_settings()
        stripe.api_key = settings.stripe_secret_key
        if not settings.stripe_secret_key:
            raise SubscriptionTransitionError("STRIPE_SECRET_KEY is required for subscription changes.")
        try:
            stripe.SubscriptionSchedule.cancel(
                transition.stripe_schedule_id,
                idempotency_key=f"{transition.idempotency_key}_cancel",
            )
        except stripe.StripeError as exc:
            capture_provider_exception(exc, provider="stripe", endpoint="stripe.subscription_schedule.cancel", workspace_id=str(transition.workspace_id))
            raise


def transition_out(transition: BillingSubscriptionTransition | None) -> dict[str, Any]:
    if transition is None:
        return {"pending": False}
    return {
        "pending": transition.status in OPEN_TRANSITION_STATUSES,
        "id": str(transition.id),
        "from_plan": transition.from_plan,
        "to_plan": transition.to_plan,
        "billing_period": transition.billing_period,
        "direction": transition.direction,
        "status": transition.status,
        "effective_at": transition.effective_at,
        "stripe_subscription_id": transition.stripe_subscription_id,
        "stripe_schedule_id": transition.stripe_schedule_id,
        "created_at": transition.created_at,
        "completed_at": transition.completed_at,
        "canceled_at": transition.canceled_at,
        "error_message": transition.error_message or "",
    }


def mark_transition_from_subscription_event(
    db: Session,
    *,
    subscription_id: str,
    plan: str,
    event_created_at: datetime | None,
) -> BillingSubscriptionTransition | None:
    transition = db.scalar(
        select(BillingSubscriptionTransition)
        .where(
            BillingSubscriptionTransition.stripe_subscription_id == subscription_id,
            BillingSubscriptionTransition.status.in_(OPEN_TRANSITION_STATUSES),
        )
        .order_by(BillingSubscriptionTransition.created_at.desc())
    )
    if transition is None:
        return None
    if event_created_at and transition.stripe_event_created_at and event_created_at < transition.stripe_event_created_at:
        return transition
    transition.stripe_event_created_at = event_created_at or transition.stripe_event_created_at
    transition.updated_at = datetime.utcnow()
    if plan == transition.to_plan:
        transition.status = "applied"
        transition.completed_at = datetime.utcnow()
    db.add(transition)
    return transition
