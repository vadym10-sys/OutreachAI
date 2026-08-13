from __future__ import annotations

import os
import threading
from datetime import datetime, timedelta
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, func, select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker
from starlette.requests import Request

from app.api.routes import _create_sales_employee_with_database_limit
from app.core.database import Base
from app.models.entities import (
    AISalesEmployee,
    AppSettings,
    PlanUsageReservation,
    SalesEmployeeMode,
    Subscription,
    UsageCounter,
    User,
    Workspace,
)
from app.schemas.dto import AISalesEmployeeCreate
from app.services.plan_catalog import PLAN_LIMITS
from app.services.plan_enforcement import (
    RESERVATION_STATUS_EXPIRED,
    RESERVATION_STATUS_FINALIZED,
    RESERVATION_STATUS_RELEASED,
    finalize_usage_reservation,
    month_period,
    release_usage_reservation,
    renew_usage_reservation,
    reserve_usage_capacity,
    usage_for_workspace,
)

POSTGRES_TEST_URL = os.getenv("OUTREACHAI_POSTGRES_TEST_URL")

pytestmark = pytest.mark.skipif(
    not POSTGRES_TEST_URL,
    reason="OUTREACHAI_POSTGRES_TEST_URL is required for PostgreSQL concurrency tests.",
)


@pytest.fixture()
def pg_engine() -> Engine:
    engine = create_engine(str(POSTGRES_TEST_URL), pool_size=5, max_overflow=5)
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    try:
        yield engine
    finally:
        Base.metadata.drop_all(engine)
        engine.dispose()


@pytest.fixture()
def session_factory(pg_engine: Engine) -> sessionmaker[Session]:
    return sessionmaker(bind=pg_engine, autocommit=False, autoflush=False)


def _seed_workspace(
    session_factory: sessionmaker[Session],
    *,
    plan: str = "Starter",
    status: str = "active",
    metric: str = "email_sends",
    current: int = 0,
    period: str | None = None,
) -> tuple[UUID, str]:
    user_id = f"pg-user-{uuid4()}"
    with session_factory() as db:
        user = User(clerk_user_id=user_id, email=f"{user_id}@example.com")
        workspace = Workspace(owner_user_id=user_id, name="PG plan test")
        db.add_all([user, workspace])
        db.flush()
        db.add(
            Subscription(
                user_id=user.id,
                workspace_id=workspace.id,
                stripe_customer_id=f"cus_{uuid4().hex}",
                stripe_subscription_id=f"sub_{uuid4().hex}",
                plan=plan,
                status=status,
                trial_end=datetime.utcnow() + timedelta(days=7),
                current_period_end=datetime.utcnow() + timedelta(days=30),
                plan_limits=PLAN_LIMITS[plan],
            )
        )
        usage = usage_for_workspace(db, workspace, period=period or month_period())
        setattr(usage, metric, current)
        db.add(
            AppSettings(
                user_id=user_id,
                workspace_id=workspace.id,
                billing={"plan": plan, "status": status},
            )
        )
        db.add(usage)
        db.commit()
        return workspace.id, user_id


def _workspace(db: Session, workspace_id: UUID) -> Workspace:
    row = db.get(Workspace, workspace_id)
    assert row is not None
    return row


def _usage_value(
    session_factory: sessionmaker[Session],
    workspace_id: UUID,
    metric: str = "email_sends",
    period: str | None = None,
) -> int:
    with session_factory() as db:
        usage = db.scalar(
            select(UsageCounter).where(
                UsageCounter.workspace_id == workspace_id,
                UsageCounter.period == (period or month_period()),
            )
        )
        assert usage is not None
        return int(getattr(usage, metric))


def _reservation_statuses(
    session_factory: sessionmaker[Session], workspace_id: UUID
) -> list[str]:
    with session_factory() as db:
        return list(
            db.scalars(
                select(PlanUsageReservation.status)
                .where(PlanUsageReservation.workspace_id == workspace_id)
                .order_by(PlanUsageReservation.created_at, PlanUsageReservation.id)
            )
        )


def _request() -> Request:
    return Request({"type": "http", "method": "POST", "path": "/", "headers": []})


def test_provider_operation_completes_before_lease_expiry(
    session_factory: sessionmaker[Session],
) -> None:
    started = datetime(2026, 1, 15, 12, 0, 0)
    period = month_period(started)
    workspace_id, user_id = _seed_workspace(session_factory, period=period)
    with session_factory() as db:
        workspace = _workspace(db, workspace_id)
        reservation = reserve_usage_capacity(
            db,
            user_id,
            workspace,
            "email_sends",
            idempotency_key="before-expiry",
            expires_in_seconds=60,
            now=started,
        )
        db.commit()
        finalize_usage_reservation(
            db,
            reservation.id,
            user_id=user_id,
            now=started + timedelta(seconds=30),
        )
        db.commit()

    assert _usage_value(session_factory, workspace_id, period=period) == 1
    assert _reservation_statuses(session_factory, workspace_id) == [
        RESERVATION_STATUS_FINALIZED
    ]


def test_lease_renewal_prevents_premature_reclamation(
    session_factory: sessionmaker[Session],
) -> None:
    started = datetime(2026, 1, 15, 12, 0, 0)
    period = month_period(started)
    metric = "email_sends"
    limit = int(PLAN_LIMITS["Starter"][metric])
    workspace_id, user_id = _seed_workspace(
        session_factory, metric=metric, current=limit - 1, period=period
    )
    with session_factory() as db:
        workspace = _workspace(db, workspace_id)
        reservation = reserve_usage_capacity(
            db,
            user_id,
            workspace,
            metric,
            idempotency_key="renew",
            expires_in_seconds=10,
            now=started,
        )
        reservation_id = reservation.id
        db.commit()
        renew_usage_reservation(
            db,
            reservation_id,
            extend_seconds=30,
            now=started + timedelta(seconds=9),
        )
        db.commit()

    with session_factory() as contender_db:
        contender_workspace = _workspace(contender_db, workspace_id)
        with pytest.raises(HTTPException) as exc_info:
            reserve_usage_capacity(
                contender_db,
                user_id,
                contender_workspace,
                metric,
                idempotency_key="contender",
                now=started + timedelta(seconds=11),
            )
        assert exc_info.value.status_code == 402
        contender_db.rollback()

    with session_factory() as db:
        finalize_usage_reservation(
            db,
            reservation_id,
            user_id=user_id,
            now=started + timedelta(seconds=12),
        )
        db.commit()

    assert _usage_value(session_factory, workspace_id, metric, period=period) == limit


def test_stale_abandoned_reservation_becomes_reclaimable(
    session_factory: sessionmaker[Session],
) -> None:
    started = datetime(2026, 1, 15, 12, 0, 0)
    period = month_period(started)
    metric = "email_sends"
    limit = int(PLAN_LIMITS["Starter"][metric])
    workspace_id, user_id = _seed_workspace(
        session_factory, metric=metric, current=limit - 1, period=period
    )
    with session_factory() as db:
        workspace = _workspace(db, workspace_id)
        abandoned = reserve_usage_capacity(
            db,
            user_id,
            workspace,
            metric,
            idempotency_key="abandoned",
            expires_in_seconds=10,
            now=started,
        )
        abandoned_id = abandoned.id
        db.commit()

    with session_factory() as db:
        workspace = _workspace(db, workspace_id)
        replacement = reserve_usage_capacity(
            db,
            user_id,
            workspace,
            metric,
            idempotency_key="replacement",
            now=started + timedelta(seconds=11),
        )
        replacement_id = replacement.id
        db.commit()

    assert abandoned_id != replacement_id
    assert (
        _reservation_statuses(session_factory, workspace_id).count(
            RESERVATION_STATUS_EXPIRED
        )
        == 1
    )


def test_expired_reservation_cannot_finalize_after_capacity_is_reclaimed(
    session_factory: sessionmaker[Session],
) -> None:
    started = datetime(2026, 1, 15, 12, 0, 0)
    period = month_period(started)
    metric = "email_sends"
    limit = int(PLAN_LIMITS["Starter"][metric])
    workspace_id, user_id = _seed_workspace(
        session_factory, metric=metric, current=limit - 1, period=period
    )
    with session_factory() as db:
        workspace = _workspace(db, workspace_id)
        stale = reserve_usage_capacity(
            db,
            user_id,
            workspace,
            metric,
            idempotency_key="stale",
            expires_in_seconds=10,
            now=started,
        )
        stale_id = stale.id
        db.commit()

    with session_factory() as db:
        workspace = _workspace(db, workspace_id)
        replacement = reserve_usage_capacity(
            db,
            user_id,
            workspace,
            metric,
            idempotency_key="replacement",
            now=started + timedelta(seconds=11),
        )
        finalize_usage_reservation(
            db,
            replacement.id,
            user_id=user_id,
            now=started + timedelta(seconds=12),
        )
        db.commit()

    with session_factory() as db:
        with pytest.raises(HTTPException) as exc_info:
            finalize_usage_reservation(
                db,
                stale_id,
                user_id=user_id,
                now=started + timedelta(seconds=13),
            )
        assert exc_info.value.status_code == 409
        db.rollback()

    assert _usage_value(session_factory, workspace_id, metric, period=period) == limit


def test_two_database_sessions_at_final_available_unit(
    session_factory: sessionmaker[Session],
) -> None:
    metric = "email_sends"
    limit = int(PLAN_LIMITS["Starter"][metric])
    workspace_id, user_id = _seed_workspace(
        session_factory, metric=metric, current=limit - 1
    )
    barrier = threading.Barrier(2)
    results: list[str] = []

    def reserve_from_session(key: str) -> None:
        with session_factory() as db:
            workspace = _workspace(db, workspace_id)
            barrier.wait(timeout=5)
            try:
                reservation = reserve_usage_capacity(
                    db, user_id, workspace, metric, idempotency_key=key
                )
                finalize_usage_reservation(db, reservation.id, user_id=user_id)
                db.commit()
                results.append("ok")
            except HTTPException as exc:
                db.rollback()
                results.append(f"http-{exc.status_code}")

    threads = [
        threading.Thread(target=reserve_from_session, args=("final-a",)),
        threading.Thread(target=reserve_from_session, args=("final-b",)),
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=10)

    assert sorted(results) == ["http-402", "ok"]
    assert _usage_value(session_factory, workspace_id, metric) == limit


def test_retry_same_idempotency_key_does_not_double_charge(
    session_factory: sessionmaker[Session],
) -> None:
    workspace_id, user_id = _seed_workspace(session_factory)
    with session_factory() as db:
        workspace = _workspace(db, workspace_id)
        first = reserve_usage_capacity(
            db, user_id, workspace, "email_sends", idempotency_key="same-key"
        )
        second = reserve_usage_capacity(
            db, user_id, workspace, "email_sends", idempotency_key="same-key"
        )
        assert first.id == second.id
        finalize_usage_reservation(db, first.id, user_id=user_id)
        finalize_usage_reservation(db, first.id, user_id=user_id)
        db.commit()

    assert _usage_value(session_factory, workspace_id) == 1


def test_release_after_provider_failure_allows_safe_retry(
    session_factory: sessionmaker[Session],
) -> None:
    workspace_id, user_id = _seed_workspace(session_factory)
    with session_factory() as db:
        workspace = _workspace(db, workspace_id)
        failed = reserve_usage_capacity(
            db, user_id, workspace, "email_sends", idempotency_key="retry-release"
        )
        release_usage_reservation(db, failed.id, reason="provider_failed")
        retry = reserve_usage_capacity(
            db, user_id, workspace, "email_sends", idempotency_key="retry-release"
        )
        assert retry.id != failed.id
        finalize_usage_reservation(db, retry.id, user_id=user_id)
        db.commit()

    assert _usage_value(session_factory, workspace_id) == 1
    assert _reservation_statuses(session_factory, workspace_id) == [
        RESERVATION_STATUS_RELEASED,
        RESERVATION_STATUS_FINALIZED,
    ]


def test_finalized_reservation_is_terminal(
    session_factory: sessionmaker[Session],
) -> None:
    workspace_id, user_id = _seed_workspace(session_factory)
    with session_factory() as db:
        workspace = _workspace(db, workspace_id)
        reservation = reserve_usage_capacity(
            db, user_id, workspace, "email_sends", idempotency_key="terminal"
        )
        finalize_usage_reservation(db, reservation.id, user_id=user_id)
        release_usage_reservation(db, reservation.id, reason="late_failure")
        finalize_usage_reservation(db, reservation.id, user_id=user_id)
        db.commit()

    assert _usage_value(session_factory, workspace_id) == 1
    assert _reservation_statuses(session_factory, workspace_id) == [
        RESERVATION_STATUS_FINALIZED
    ]


def test_ai_sales_employee_concurrent_creation_cannot_exceed_plan_limit_postgres(
    session_factory: sessionmaker[Session],
) -> None:
    workspace_id, user_id = _seed_workspace(session_factory)
    barrier = threading.Barrier(2)
    results: list[str] = []
    payload = AISalesEmployeeCreate(
        name="Concurrent Ava",
        role="AI Sales Employee",
        product_service="AI outbound",
        target_customer="Small businesses",
        target_countries=["Germany"],
        target_industries=["B2B SaaS"],
        offer="book qualified calls",
        cta="Book a call",
        sending_mode="Review Mode",
        daily_limit=10,
        working_hours="09:00-17:00",
        tone="Professional",
        language="English",
        signature="Ava",
    )

    def create_from_session(index: int) -> None:
        with session_factory() as db:
            workspace = _workspace(db, workspace_id)
            barrier.wait(timeout=5)
            try:
                _create_sales_employee_with_database_limit(
                    db,
                    _request(),
                    user_id,
                    workspace,
                    payload.model_copy(update={"name": f"Concurrent Ava {index}"}),
                    SalesEmployeeMode.review,
                )
                db.commit()
                results.append("ok")
            except HTTPException as exc:
                db.rollback()
                results.append(f"http-{exc.status_code}")

    threads = [
        threading.Thread(target=create_from_session, args=(1,)),
        threading.Thread(target=create_from_session, args=(2,)),
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=10)

    assert sorted(results) == ["http-402", "ok"]
    with session_factory() as db:
        employee_count = (
            db.scalar(
                select(func.count())
                .select_from(AISalesEmployee)
                .where(AISalesEmployee.workspace_id == workspace_id)
            )
            or 0
        )
    assert employee_count == PLAN_LIMITS["Starter"]["sales_employees"]
