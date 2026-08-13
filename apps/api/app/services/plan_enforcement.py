from __future__ import annotations

import threading
from collections import defaultdict
from datetime import datetime
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.entities import UsageCounter, Workspace
from app.services.entitlements import BillingEntitlement, resolve_billing_entitlement

PLAN_USAGE_METRICS = {"leads", "ai_generations", "email_sends"}
_usage_locks: defaultdict[str, threading.RLock] = defaultdict(threading.RLock)


def month_period(now: datetime | None = None) -> str:
    return (now or datetime.utcnow()).strftime("%Y-%m")


def plan_limit_error(
    *, plan: str, metric: str, limit: int, current: int, requested: int
) -> HTTPException:
    return HTTPException(
        status_code=402,
        detail={
            "code": "plan_limit_exceeded",
            "metric": metric,
            "plan": plan,
            "limit": limit,
            "current": current,
            "requested": requested,
            "message": f"{metric.replace('_', ' ').title()} limit reached for the {plan} plan. Upgrade in Billing to continue.",
        },
    )


def _metric_limit(entitlement: BillingEntitlement, metric: str) -> int:
    if metric not in PLAN_USAGE_METRICS:
        raise ValueError(f"Unsupported plan usage metric: {metric}")
    return int(entitlement.limits[metric])


def usage_for_workspace(
    db: Session,
    workspace: Workspace,
    *,
    period: str | None = None,
    for_update: bool = False,
) -> UsageCounter:
    target_period = period or month_period()
    stmt = select(UsageCounter).where(
        UsageCounter.workspace_id == workspace.id, UsageCounter.period == target_period
    )
    if for_update:
        stmt = stmt.with_for_update()
    usage = db.scalar(stmt)
    if usage is not None:
        return usage
    usage = UsageCounter(workspace_id=workspace.id, period=target_period)
    db.add(usage)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        stmt = select(UsageCounter).where(
            UsageCounter.workspace_id == workspace.id,
            UsageCounter.period == target_period,
        )
        if for_update:
            stmt = stmt.with_for_update()
        usage = db.scalar(stmt)
        if usage is None:
            raise
    return usage


def check_usage_available(
    db: Session, user_id: str, workspace: Workspace, metric: str, amount: int = 1
) -> BillingEntitlement:
    entitlement = resolve_billing_entitlement(db, user_id, workspace)
    limit = _metric_limit(entitlement, metric)
    if limit <= 0:
        return entitlement
    usage = usage_for_workspace(db, workspace)
    current = int(getattr(usage, metric) or 0)
    if current + amount > limit:
        raise plan_limit_error(
            plan=entitlement.plan,
            metric=metric,
            limit=limit,
            current=current,
            requested=amount,
        )
    return entitlement


def increment_usage_after_success(
    db: Session, user_id: str, workspace: Workspace, metric: str, amount: int = 1
) -> UsageCounter:
    lock_key = f"{workspace.id}:{month_period()}:{metric}"
    with _usage_locks[lock_key]:
        entitlement = resolve_billing_entitlement(db, user_id, workspace)
        limit = _metric_limit(entitlement, metric)
        usage = usage_for_workspace(db, workspace, for_update=True)
        current = int(getattr(usage, metric) or 0)
        if limit > 0 and current + amount > limit:
            raise plan_limit_error(
                plan=entitlement.plan,
                metric=metric,
                limit=limit,
                current=current,
                requested=amount,
            )
        setattr(usage, metric, current + amount)
        usage.updated_at = datetime.utcnow()
        db.add(usage)
        db.flush()
        return usage


def usage_payload(usage: UsageCounter) -> dict[str, Any]:
    return {
        "leads": usage.leads,
        "ai_generations": usage.ai_generations,
        "email_sends": usage.email_sends,
    }
