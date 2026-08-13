from __future__ import annotations

import threading
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID, uuid4

from fastapi import HTTPException
from sqlalchemy import func, select, text, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.entities import PlanUsageReservation, UsageCounter, Workspace
from app.services.entitlements import BillingEntitlement, resolve_billing_entitlement

PLAN_USAGE_METRICS = {"leads", "ai_generations", "email_sends"}
_non_postgres_usage_locks: defaultdict[str, threading.RLock] = defaultdict(threading.RLock)
RESERVATION_STATUS_RESERVED = "reserved"
RESERVATION_STATUS_FINALIZED = "finalized"
RESERVATION_STATUS_RELEASED = "released"
RESERVATION_STATUS_EXPIRED = "expired"
DEFAULT_RESERVATION_TTL_SECONDS = 15 * 60


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
    if db.bind is not None and db.bind.dialect.name == "postgresql":
        now = datetime.utcnow()
        db.execute(
            text(
                """
                INSERT INTO usage_counters (
                    id, workspace_id, period, leads, ai_generations, email_sends,
                    created_at, updated_at
                )
                VALUES (
                    :id, :workspace_id, :period, 0, 0, 0, :created_at, :updated_at
                )
                ON CONFLICT (workspace_id, period) DO NOTHING
                """
            ),
            {
                "id": uuid4(),
                "workspace_id": workspace.id,
                "period": target_period,
                "created_at": now,
                "updated_at": now,
            },
        )
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


def expire_stale_reservations(
    db: Session, workspace: Workspace, *, period: str | None = None, now: datetime | None = None
) -> int:
    target_period = period or month_period(now)
    timestamp = now or datetime.utcnow()
    result = db.execute(
        update(PlanUsageReservation)
        .where(
            PlanUsageReservation.workspace_id == workspace.id,
            PlanUsageReservation.period == target_period,
            PlanUsageReservation.status == RESERVATION_STATUS_RESERVED,
            PlanUsageReservation.expires_at <= timestamp,
        )
        .values(
            status=RESERVATION_STATUS_EXPIRED,
            released_at=timestamp,
            release_reason="stale_reservation_expired",
            updated_at=timestamp,
        )
    )
    return int(result.rowcount or 0)


def _active_reserved_amount(
    db: Session, workspace: Workspace, *, period: str, metric: str, now: datetime
) -> int:
    return int(
        db.scalar(
            select(func.coalesce(func.sum(PlanUsageReservation.amount), 0)).where(
                PlanUsageReservation.workspace_id == workspace.id,
                PlanUsageReservation.period == period,
                PlanUsageReservation.metric == metric,
                PlanUsageReservation.status == RESERVATION_STATUS_RESERVED,
                PlanUsageReservation.expires_at > now,
            )
        )
        or 0
    )


def check_usage_available(
    db: Session, user_id: str, workspace: Workspace, metric: str, amount: int = 1
) -> BillingEntitlement:
    entitlement = resolve_billing_entitlement(db, user_id, workspace)
    limit = _metric_limit(entitlement, metric)
    if limit <= 0:
        return entitlement
    now = datetime.utcnow()
    period = month_period(now)
    expire_stale_reservations(db, workspace, period=period, now=now)
    usage = usage_for_workspace(db, workspace, period=period)
    current = int(getattr(usage, metric) or 0)
    reserved = _active_reserved_amount(db, workspace, period=period, metric=metric, now=now)
    if current + reserved + amount > limit:
        raise plan_limit_error(
            plan=entitlement.plan,
            metric=metric,
            limit=limit,
            current=current + reserved,
            requested=amount,
        )
    return entitlement


def reserve_usage_capacity(
    db: Session,
    user_id: str,
    workspace: Workspace,
    metric: str,
    amount: int = 1,
    *,
    idempotency_key: str | None = None,
    expires_in_seconds: int = DEFAULT_RESERVATION_TTL_SECONDS,
    now: datetime | None = None,
) -> PlanUsageReservation | None:
    if db.bind is not None and db.bind.dialect.name != "postgresql":
        lock_period = month_period(now)
        with _non_postgres_usage_locks[f"{workspace.id}:{lock_period}:{metric}"]:
            return _reserve_usage_capacity_locked(
                db,
                user_id,
                workspace,
                metric,
                amount,
                idempotency_key=idempotency_key,
                expires_in_seconds=expires_in_seconds,
                now=now,
            )
    return _reserve_usage_capacity_locked(
        db,
        user_id,
        workspace,
        metric,
        amount,
        idempotency_key=idempotency_key,
        expires_in_seconds=expires_in_seconds,
        now=now,
    )


def _reserve_usage_capacity_locked(
    db: Session,
    user_id: str,
    workspace: Workspace,
    metric: str,
    amount: int = 1,
    *,
    idempotency_key: str | None = None,
    expires_in_seconds: int = DEFAULT_RESERVATION_TTL_SECONDS,
    now: datetime | None = None,
) -> PlanUsageReservation | None:
    if amount <= 0:
        raise ValueError("Usage reservation amount must be positive.")
    entitlement = resolve_billing_entitlement(db, user_id, workspace)
    limit = _metric_limit(entitlement, metric)
    if limit <= 0:
        return None

    timestamp = now or datetime.utcnow()
    period = month_period(timestamp)
    usage = usage_for_workspace(db, workspace, period=period, for_update=True)
    expire_stale_reservations(db, workspace, period=period, now=timestamp)

    key = (idempotency_key or "").strip()
    if key:
        existing = db.scalar(
            select(PlanUsageReservation)
            .where(
                PlanUsageReservation.workspace_id == workspace.id,
                PlanUsageReservation.period == period,
                PlanUsageReservation.metric == metric,
                PlanUsageReservation.idempotency_key == key,
            )
            .with_for_update()
        )
        if existing is not None:
            if existing.status == RESERVATION_STATUS_FINALIZED:
                return existing
            if existing.status == RESERVATION_STATUS_RESERVED and existing.expires_at > timestamp:
                return existing
            if existing.status in {
                RESERVATION_STATUS_RESERVED,
                RESERVATION_STATUS_RELEASED,
                RESERVATION_STATUS_EXPIRED,
            }:
                current = int(getattr(usage, metric) or 0)
                reserved = _active_reserved_amount(db, workspace, period=period, metric=metric, now=timestamp)
                if current + reserved + amount > limit:
                    raise plan_limit_error(
                        plan=entitlement.plan,
                        metric=metric,
                        limit=limit,
                        current=current + reserved,
                        requested=amount,
                    )
                existing.status = RESERVATION_STATUS_RESERVED
                existing.amount = amount
                existing.expires_at = timestamp + timedelta(seconds=expires_in_seconds)
                existing.released_at = None
                existing.release_reason = ""
                existing.updated_at = timestamp
                db.add(existing)
                db.flush()
                return existing

    current = int(getattr(usage, metric) or 0)
    reserved = _active_reserved_amount(db, workspace, period=period, metric=metric, now=timestamp)
    if current + reserved + amount > limit:
        raise plan_limit_error(
            plan=entitlement.plan,
            metric=metric,
            limit=limit,
            current=current + reserved,
            requested=amount,
        )

    reservation = PlanUsageReservation(
        workspace_id=workspace.id,
        period=period,
        metric=metric,
        amount=amount,
        status=RESERVATION_STATUS_RESERVED,
        idempotency_key=key or f"{workspace.id}:{period}:{metric}:{timestamp.timestamp()}",
        expires_at=timestamp + timedelta(seconds=expires_in_seconds),
    )
    db.add(reservation)
    db.flush()
    return reservation


def finalize_usage_reservation(
    db: Session, reservation: PlanUsageReservation | UUID | None
) -> UsageCounter | None:
    if reservation is None:
        return None
    reservation_id = reservation if isinstance(reservation, UUID) else reservation.id
    row = db.scalar(
        select(PlanUsageReservation)
        .where(PlanUsageReservation.id == reservation_id)
        .with_for_update()
    )
    if row is None:
        raise ValueError("Usage reservation was not found.")
    usage = usage_for_workspace(db, row.workspace, period=row.period, for_update=True)
    if row.status == RESERVATION_STATUS_FINALIZED:
        return usage
    if row.status != RESERVATION_STATUS_RESERVED:
        raise ValueError(f"Cannot finalize {row.status} usage reservation.")
    current = int(getattr(usage, row.metric) or 0)
    setattr(usage, row.metric, current + row.amount)
    usage.updated_at = datetime.utcnow()
    row.status = RESERVATION_STATUS_FINALIZED
    row.finalized_at = datetime.utcnow()
    row.updated_at = row.finalized_at
    db.add_all([usage, row])
    db.flush()
    return usage


def release_usage_reservation(
    db: Session,
    reservation: PlanUsageReservation | UUID | None,
    *,
    reason: str = "operation_failed",
) -> None:
    if reservation is None:
        return
    reservation_id = reservation if isinstance(reservation, UUID) else reservation.id
    row = db.scalar(
        select(PlanUsageReservation)
        .where(PlanUsageReservation.id == reservation_id)
        .with_for_update()
    )
    if row is None or row.status != RESERVATION_STATUS_RESERVED:
        return
    now = datetime.utcnow()
    row.status = RESERVATION_STATUS_RELEASED
    row.released_at = now
    row.release_reason = reason[:240]
    row.updated_at = now
    db.add(row)
    db.flush()


def increment_usage_after_success(
    db: Session, user_id: str, workspace: Workspace, metric: str, amount: int = 1
) -> UsageCounter:
    if db.bind is not None and db.bind.dialect.name != "postgresql":
        lock_key = f"{workspace.id}:{month_period()}:{metric}"
        with _non_postgres_usage_locks[lock_key]:
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
    reservation = reserve_usage_capacity(db, user_id, workspace, metric, amount)
    usage = finalize_usage_reservation(db, reservation)
    if usage is None:
        usage = usage_for_workspace(db, workspace)
    return usage


def usage_payload(usage: UsageCounter) -> dict[str, Any]:
    return {
        "leads": usage.leads,
        "ai_generations": usage.ai_generations,
        "email_sends": usage.email_sends,
    }
