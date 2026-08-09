from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.entities import Subscription, TestEntitlement, Workspace
from app.schemas.dto import PLAN_LIMITS


@dataclass(frozen=True)
class BillingEntitlement:
    plan: str
    status: str
    limits: dict[str, Any]
    active: bool
    source: str
    subscription: Subscription | None = None
    test_entitlement: TestEntitlement | None = None
    trial_end: datetime | None = None
    current_period_end: datetime | None = None


def workspace_trial_end(workspace: Workspace) -> datetime:
    return (workspace.created_at or datetime.utcnow()) + timedelta(days=14)


def workspace_trial_is_active(workspace: Workspace) -> bool:
    return workspace_trial_end(workspace) > datetime.utcnow()


def latest_subscription(db: Session, workspace: Workspace) -> Subscription | None:
    return db.scalar(select(Subscription).where(Subscription.workspace_id == workspace.id).order_by(Subscription.current_period_end.desc().nullslast()))


def subscription_is_expired(subscription: Subscription) -> bool:
    now = datetime.utcnow()
    if subscription.current_period_end and subscription.current_period_end <= now:
        return True
    if subscription.status == "trialing" and subscription.trial_end and subscription.trial_end <= now:
        return True
    return False


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
    subscription = latest_subscription(db, workspace)
    if subscription and subscription.status in {"active", "trialing"} and not subscription_is_expired(subscription):
        plan = subscription.plan if subscription.plan in PLAN_LIMITS else "Starter"
        return BillingEntitlement(
            plan=plan,
            status=subscription.status,
            limits=PLAN_LIMITS[plan],
            active=True,
            source="stripe",
            subscription=subscription,
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
            subscription=subscription,
            test_entitlement=test_entitlement,
            trial_end=test_entitlement.expires_at,
            current_period_end=test_entitlement.expires_at,
        )

    if subscription:
        plan = subscription.plan if subscription.plan in PLAN_LIMITS else "Starter"
        status = "expired" if subscription_is_expired(subscription) else subscription.status
        return BillingEntitlement(
            plan=plan,
            status=status,
            limits=PLAN_LIMITS[plan],
            active=False,
            source="stripe",
            subscription=subscription,
            trial_end=subscription.trial_end,
            current_period_end=subscription.current_period_end,
        )

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
