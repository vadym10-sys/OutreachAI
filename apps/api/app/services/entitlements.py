from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.core.config import get_settings
from app.models.entities import AppSettings, AuditLog, Subscription, TestEntitlement, Workspace
from app.services.plan_catalog import PLAN_LIMITS, is_plan_name, plan_limits

ACTIVE_STRIPE_STATUSES = {"active", "trialing"}
DEGRADED_DUPLICATE_STATUS = "degraded_duplicate_subscription"
UNKNOWN_PRICE_STATUS = "degraded_unknown_price"


@dataclass(frozen=True)
class BillingEntitlement:
    plan: str
    status: str
    limits: dict[str, Any]
    active: bool
    source: str
    subscription: Subscription | None = None
    test_entitlement: TestEntitlement | None = None
    duplicate_subscriptions: tuple[Subscription, ...] = ()
    inactive_subscription: Subscription | None = None
    trial_end: datetime | None = None
    current_period_end: datetime | None = None


def workspace_trial_end(workspace: Workspace) -> datetime:
    return (workspace.created_at or datetime.utcnow()) + timedelta(days=14)


def workspace_trial_is_active(workspace: Workspace) -> bool:
    return workspace_trial_end(workspace) > datetime.utcnow()


def latest_subscription(db: Session, workspace: Workspace) -> Subscription | None:
    return canonical_subscription_for_workspace(db, workspace)


def subscription_is_expired(subscription: Subscription) -> bool:
    now = datetime.utcnow()
    if subscription.current_period_end and subscription.current_period_end <= now:
        return True
    if subscription.status == "trialing" and subscription.trial_end and subscription.trial_end <= now:
        return True
    return False


def _timestamp(value: datetime | None) -> float:
    if value is None:
        return float("-inf")
    return value.timestamp()


def _stable_id(subscription: Subscription) -> str:
    return subscription.stripe_subscription_id or str(subscription.id)


def _canonical_sort_key(subscription: Subscription) -> tuple[int, float, float, float, str]:
    return (
        1 if subscription.status in ACTIVE_STRIPE_STATUSES else 0,
        _timestamp(getattr(subscription, "stripe_event_created_at", None)),
        _timestamp(getattr(subscription, "updated_at", None)),
        _timestamp(getattr(subscription, "created_at", None)),
        _stable_id(subscription),
    )


def _valid_active_stripe_subscription(subscription: Subscription, workspace: Workspace) -> bool:
    return (
        subscription.workspace_id == workspace.id
        and subscription.status in ACTIVE_STRIPE_STATUSES
        and bool(subscription.stripe_subscription_id)
        and is_plan_name(subscription.plan)
        and not subscription_is_expired(subscription)
    )


def _canonicalize_unique_stripe_rows(subscriptions: list[Subscription]) -> list[Subscription]:
    by_subscription_id: dict[str, Subscription] = {}
    for subscription in subscriptions:
        key = subscription.stripe_subscription_id or str(subscription.id)
        current = by_subscription_id.get(key)
        if current is None or _canonical_sort_key(subscription) > _canonical_sort_key(current):
            by_subscription_id[key] = subscription
    return sorted(by_subscription_id.values(), key=_canonical_sort_key, reverse=True)


def workspace_subscriptions(db: Session, workspace: Workspace) -> list[Subscription]:
    return list(db.scalars(select(Subscription).where(Subscription.workspace_id == workspace.id)).all())


def canonical_subscription_for_workspace(db: Session, workspace: Workspace) -> Subscription | None:
    subscriptions = workspace_subscriptions(db, workspace)
    active = _canonicalize_unique_stripe_rows([row for row in subscriptions if _valid_active_stripe_subscription(row, workspace)])
    if len(active) == 1:
        return active[0]
    inactive = [row for row in subscriptions if row.status not in ACTIVE_STRIPE_STATUSES or not _valid_active_stripe_subscription(row, workspace)]
    return sorted(inactive, key=_canonical_sort_key, reverse=True)[0] if inactive else None


def canonical_billing_entitlement(db: Session, user_id: str, workspace: Workspace) -> BillingEntitlement:
    subscriptions = workspace_subscriptions(db, workspace)
    active = _canonicalize_unique_stripe_rows([row for row in subscriptions if _valid_active_stripe_subscription(row, workspace)])
    inactive = sorted(
        [row for row in subscriptions if row.status not in ACTIVE_STRIPE_STATUSES or not _valid_active_stripe_subscription(row, workspace)],
        key=_canonical_sort_key,
        reverse=True,
    )
    inactive_display = inactive[0] if inactive else None
    if len(active) > 1:
        return BillingEntitlement(
            plan="Starter",
            status=DEGRADED_DUPLICATE_STATUS,
            limits=PLAN_LIMITS["Starter"],
            active=False,
            source=DEGRADED_DUPLICATE_STATUS,
            duplicate_subscriptions=tuple(active),
            inactive_subscription=inactive_display,
        )
    if len(active) == 1:
        subscription = active[0]
        plan = subscription.plan
        return BillingEntitlement(
            plan=plan,
            status=subscription.status,
            limits=plan_limits(plan),
            active=True,
            source="stripe",
            subscription=subscription,
            inactive_subscription=inactive_display,
            trial_end=subscription.trial_end,
            current_period_end=subscription.current_period_end,
        )

    test_entitlement = active_test_entitlement(db, user_id, workspace)
    if test_entitlement:
        plan = test_entitlement.plan if test_entitlement.plan in PLAN_LIMITS else "Starter"
        return BillingEntitlement(
            plan=plan,
            status="test_entitlement",
            limits=test_entitlement_limits(plan),
            active=True,
            source="owner_granted_test",
            subscription=None,
            test_entitlement=test_entitlement,
            inactive_subscription=inactive_display,
            trial_end=test_entitlement.expires_at,
            current_period_end=test_entitlement.expires_at,
        )

    if inactive_display:
        known_plan = inactive_display.plan if inactive_display.plan in PLAN_LIMITS else "Starter"
        status = UNKNOWN_PRICE_STATUS if inactive_display.plan not in PLAN_LIMITS else ("expired" if subscription_is_expired(inactive_display) else inactive_display.status)
        return BillingEntitlement(
            plan=known_plan,
            status=status,
            limits=plan_limits(known_plan),
            active=False,
            source="stripe_inactive",
            subscription=inactive_display,
            inactive_subscription=inactive_display,
            trial_end=inactive_display.trial_end,
            current_period_end=inactive_display.current_period_end,
        )
    return BillingEntitlement(
        plan="Starter",
        status="inactive",
        limits=PLAN_LIMITS["Starter"],
        active=False,
        source="none",
    )


def test_entitlement_limits(plan: str) -> dict[str, Any]:
    limits = dict(PLAN_LIMITS.get(plan, PLAN_LIMITS["Starter"]))
    limits["mrr"] = 0
    limits["internal_test_entitlement"] = True
    return limits


def active_test_entitlement(db: Session, user_id: str, workspace: Workspace) -> TestEntitlement | None:
    now = datetime.utcnow()
    return db.scalar(
        select(TestEntitlement)
        .where(
            TestEntitlement.workspace_id == workspace.id,
            TestEntitlement.user_id == user_id,
            TestEntitlement.revoked_at.is_(None),
            TestEntitlement.expires_at > now,
        )
        .order_by(TestEntitlement.expires_at.desc())
    )


def resolve_billing_entitlement(db: Session, user_id: str, workspace: Workspace) -> BillingEntitlement:
    entitlement = canonical_billing_entitlement(db, user_id, workspace)
    if entitlement.source != "none":
        return entitlement

    if get_settings().app_env != "production" and workspace_trial_is_active(workspace):
        trial_end = workspace_trial_end(workspace)
        return BillingEntitlement(
            plan="Starter",
            status="trialing",
            limits=PLAN_LIMITS["Starter"],
            active=True,
            source="development_workspace_trial",
            trial_end=trial_end,
            current_period_end=trial_end,
        )

    return BillingEntitlement(
        plan="Starter",
        status="inactive",
        limits=PLAN_LIMITS["Starter"],
        active=False,
        source="none",
    )


def _stripe_id_suffix(value: str | None) -> str:
    text = str(value or "")
    return text[-8:] if text else ""


def billing_cache_payload(entitlement: BillingEntitlement) -> dict[str, Any]:
    subscription = entitlement.subscription
    billing = {
        "plan": entitlement.plan,
        "status": entitlement.status,
        "entitlementSource": entitlement.source,
        "active": entitlement.active,
        "testEntitlement": entitlement.source == "owner_granted_test",
        "trialEnd": entitlement.trial_end.isoformat() if entitlement.trial_end else None,
        "currentPeriodEnd": entitlement.current_period_end.isoformat() if entitlement.current_period_end else None,
        "planLimits": entitlement.limits,
    }
    if entitlement.source == "stripe" and subscription is not None:
        billing.update(
            {
                "stripeCustomerId": subscription.stripe_customer_id or "",
                "stripeSubscriptionId": subscription.stripe_subscription_id or "",
            }
        )
    else:
        billing.update({"stripeCustomerId": "", "stripeSubscriptionId": ""})
    if entitlement.source == DEGRADED_DUPLICATE_STATUS:
        billing.update(
            {
                "duplicateSubscriptionCount": len(entitlement.duplicate_subscriptions),
                "duplicateSubscriptionSuffixes": [_stripe_id_suffix(item.stripe_subscription_id) for item in entitlement.duplicate_subscriptions],
                "requiresOwnerBillingReview": True,
            }
        )
    return billing


def reconcile_app_settings_billing_cache(
    db: Session,
    *,
    user_id: str,
    workspace: Workspace,
    settings: AppSettings,
    dry_run: bool = False,
    actor_user_id: str | None = None,
    reason: str = "canonical_billing_reconciliation",
) -> dict[str, Any]:
    entitlement = resolve_billing_entitlement(db, user_id, workspace)
    current = dict(settings.billing or {})
    derived = billing_cache_payload(entitlement)
    for key in (
        "lastPaymentError",
        "lastDeclineCode",
        "lastFailureMessage",
        "lastPaymentFailedAt",
        "lastFailedInvoiceId",
        "lastFailedPaymentIntentId",
        "pendingPlan",
        "pendingPlanDirection",
        "pendingPlanEffectiveAt",
        "subscriptionTransitionId",
        "cancelAtPeriodEnd",
    ):
        if key in current and key not in derived:
            derived[key] = current[key]
    changed = current != derived
    evidence = {
        "workspace_id": str(workspace.id),
        "user_id": user_id,
        "dry_run": dry_run,
        "changed": changed,
        "status": derived["status"],
        "entitlement_source": derived["entitlementSource"],
        "active": derived["active"],
        "subscription_suffix": _stripe_id_suffix(derived.get("stripeSubscriptionId")),
        "duplicate_subscription_count": derived.get("duplicateSubscriptionCount", 0),
        "inactive_subscription_suffix": _stripe_id_suffix(entitlement.inactive_subscription.stripe_subscription_id if entitlement.inactive_subscription else ""),
        "reason": reason,
    }
    if not dry_run and changed:
        settings.billing = derived
        db.add(settings)
        flag_modified(settings, "billing")
        db.add(AuditLog(user_id=actor_user_id, workspace_id=workspace.id, action="billing.cache_reconciled", metadata_json=evidence))
    return {"entitlement": entitlement, "billing": derived, "changed": changed, "audit": evidence}
