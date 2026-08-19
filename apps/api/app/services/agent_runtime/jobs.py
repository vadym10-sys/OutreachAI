from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta
from typing import Literal
from uuid import UUID

from sqlalchemy import and_, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.entities import AgentRun, AgentRunJob
from app.services.agent_runtime.errors import AgentRunJobClaimLost
from app.services.agent_runtime.tracing import error_category, safe_trace_message

logger = logging.getLogger("outreachai.agent_runtime.jobs")

AgentRunJobOperation = Literal["start", "resume"]

ACTIVE_JOB_STATUSES = ("queued", "running", "retrying")
CLAIMABLE_JOB_STATUSES = ("queued", "retrying")
TERMINAL_JOB_STATUSES = ("succeeded", "failed", "cancelled")
NON_RETRYABLE_ERROR_CATEGORIES = frozenset(
    {
        "invalid_structured_plan",
        "unknown_tool",
        "invalid_tool_arguments",
        "invalid_tool_output",
        "invalid_approval_state",
        "permission_denied",
        "tool_execution_blocked",
        "feature_disabled",
        "invalid_run_state",
    }
)
MAX_RETRY_BACKOFF_SECONDS = 300


def _worker_id(prefix: str = "agent-runtime") -> str:
    return f"{prefix}-{uuid.uuid4().hex[:12]}"


def _claim_token(worker_id: str) -> str:
    return f"{worker_id}:{uuid.uuid4().hex[:12]}"


def _active_claim_condition(now: datetime):
    return or_(
        and_(
            AgentRunJob.status.in_(CLAIMABLE_JOB_STATUSES),
            AgentRunJob.available_at <= now,
        ),
        and_(
            AgentRunJob.status == "running",
            AgentRunJob.lease_expires_at.is_not(None),
            AgentRunJob.lease_expires_at <= now,
        ),
    )


def enqueue_agent_run_job(
    db: Session,
    *,
    run: AgentRun,
    operation: AgentRunJobOperation,
    request_id: str = "",
    available_at: datetime | None = None,
    max_attempts: int | None = None,
) -> AgentRunJob:
    if operation not in {"start", "resume"}:
        raise ValueError(f"Unsupported agent run job operation: {operation}")
    existing = db.scalar(
        select(AgentRunJob)
        .where(
            AgentRunJob.workspace_id == run.workspace_id,
            AgentRunJob.run_id == run.id,
            AgentRunJob.operation == operation,
            AgentRunJob.status.in_(ACTIVE_JOB_STATUSES),
        )
        .order_by(AgentRunJob.created_at.desc())
    )
    if existing is not None:
        return existing
    settings = get_settings()
    job = AgentRunJob(
        workspace_id=run.workspace_id,
        run_id=run.id,
        operation=operation,
        status="queued",
        attempts=0,
        max_attempts=max(1, int(max_attempts or settings.ai_tasks_worker_max_attempts or 3)),
        available_at=available_at or datetime.utcnow(),
        request_id=request_id,
    )
    db.add(job)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        recovered = db.scalar(
            select(AgentRunJob)
            .where(
                AgentRunJob.workspace_id == run.workspace_id,
                AgentRunJob.run_id == run.id,
                AgentRunJob.operation == operation,
                AgentRunJob.status.in_(ACTIVE_JOB_STATUSES),
            )
            .order_by(AgentRunJob.created_at.desc())
        )
        if recovered is None:
            raise
        return recovered
    return job


def claim_next_agent_run_job(
    db: Session,
    *,
    worker_id: str | None = None,
    lease_seconds: int = 900,
) -> AgentRunJob | None:
    now = datetime.utcnow()
    worker = worker_id or _worker_id()
    token = _claim_token(worker)
    stmt = (
        select(AgentRunJob.id)
        .where(_active_claim_condition(now))
        .order_by(
            AgentRunJob.available_at.asc(),
            AgentRunJob.created_at.asc(),
            AgentRunJob.id.asc(),
        )
        .limit(1)
    )
    if db.bind and db.bind.dialect.name == "postgresql":
        stmt = stmt.with_for_update(skip_locked=True)
    job_id = db.scalar(stmt)
    if job_id is None:
        return None
    updated = db.execute(
        update(AgentRunJob)
        .where(AgentRunJob.id == job_id, _active_claim_condition(now))
        .values(
            status="running",
            attempts=AgentRunJob.attempts + 1,
            locked_by=worker,
            claim_token=token,
            locked_at=now,
            lease_expires_at=now + timedelta(seconds=max(1, int(lease_seconds or 900))),
            error_category="",
            error_message="",
            updated_at=now,
        )
    )
    if updated.rowcount != 1:
        db.rollback()
        return None
    db.commit()
    job = db.get(AgentRunJob, job_id)
    if job is not None:
        db.refresh(job)
    return job


def agent_run_job_claim_is_current(
    db: Session,
    *,
    job_id: UUID,
    claim_token: str,
) -> bool:
    now = datetime.utcnow()
    return bool(
        db.scalar(
            select(AgentRunJob.id).where(
                AgentRunJob.id == job_id,
                AgentRunJob.status == "running",
                AgentRunJob.claim_token == claim_token,
                AgentRunJob.lease_expires_at.is_not(None),
                AgentRunJob.lease_expires_at > now,
            )
        )
    )


def assert_agent_run_job_claim_current(
    db: Session,
    *,
    job_id: UUID,
    claim_token: str,
) -> None:
    if not agent_run_job_claim_is_current(db, job_id=job_id, claim_token=claim_token):
        raise AgentRunJobClaimLost("Agent run job claim is no longer current.")


def heartbeat_agent_run_job(
    db: Session,
    *,
    job_id: UUID,
    claim_token: str,
    lease_seconds: int = 900,
) -> bool:
    now = datetime.utcnow()
    updated = db.execute(
        update(AgentRunJob)
        .where(
            AgentRunJob.id == job_id,
            AgentRunJob.status == "running",
            AgentRunJob.claim_token == claim_token,
            AgentRunJob.lease_expires_at.is_not(None),
            AgentRunJob.lease_expires_at > now,
        )
        .values(
            locked_at=now,
            lease_expires_at=now + timedelta(seconds=max(1, int(lease_seconds or 900))),
            updated_at=now,
        )
    )
    if updated.rowcount != 1:
        db.rollback()
        return False
    db.commit()
    return True


def mark_agent_run_job_succeeded(
    db: Session,
    *,
    job: AgentRunJob,
    claim_token: str,
) -> bool:
    now = datetime.utcnow()
    updated = db.execute(
        update(AgentRunJob)
        .where(
            AgentRunJob.id == job.id,
            AgentRunJob.status == "running",
            AgentRunJob.claim_token == claim_token,
            AgentRunJob.lease_expires_at.is_not(None),
            AgentRunJob.lease_expires_at > now,
        )
        .values(
            status="succeeded",
            locked_by="",
            claim_token="",
            locked_at=None,
            lease_expires_at=None,
            error_category="",
            error_message="",
            completed_at=now,
            updated_at=now,
        )
    )
    if updated.rowcount != 1:
        db.rollback()
        return False
    db.commit()
    return True


def mark_agent_run_job_cancelled(
    db: Session,
    *,
    job: AgentRunJob,
    claim_token: str,
    reason: str = "Agent run was cancelled.",
) -> bool:
    now = datetime.utcnow()
    updated = db.execute(
        update(AgentRunJob)
        .where(
            AgentRunJob.id == job.id,
            AgentRunJob.status == "running",
            AgentRunJob.claim_token == claim_token,
            AgentRunJob.lease_expires_at.is_not(None),
            AgentRunJob.lease_expires_at > now,
        )
        .values(
            status="cancelled",
            locked_by="",
            claim_token="",
            locked_at=None,
            lease_expires_at=None,
            error_category="cancelled",
            error_message=safe_trace_message(reason, error_category_value="cancelled"),
            completed_at=now,
            updated_at=now,
        )
    )
    if updated.rowcount != 1:
        db.rollback()
        return False
    db.commit()
    return True


def fail_or_retry_agent_run_job(
    db: Session,
    *,
    job: AgentRunJob,
    claim_token: str,
    exc: Exception,
    retry_delay_seconds: int = 10,
    retryable: bool = True,
) -> bool:
    now = datetime.utcnow()
    attempts = int(job.attempts or 0)
    max_attempts = max(1, int(job.max_attempts or 1))
    category = error_category(exc)
    should_retry = (
        retryable
        and category not in NON_RETRYABLE_ERROR_CATEGORIES
        and attempts < max_attempts
    )
    retry_delay = min(
        MAX_RETRY_BACKOFF_SECONDS,
        max(1, int(retry_delay_seconds or 10)) * (2 ** max(0, attempts - 1)),
    )
    values = {
        "status": "retrying" if should_retry else "failed",
        "locked_by": "",
        "claim_token": "",
        "locked_at": None,
        "lease_expires_at": None,
        "error_category": category[:80],
        "error_message": safe_trace_message(str(exc), error_category_value=category),
        "updated_at": now,
    }
    if should_retry:
        values["available_at"] = now + timedelta(seconds=retry_delay)
    else:
        values["completed_at"] = now
    updated = db.execute(
        update(AgentRunJob)
        .where(
            AgentRunJob.id == job.id,
            AgentRunJob.status == "running",
            AgentRunJob.claim_token == claim_token,
            AgentRunJob.lease_expires_at.is_not(None),
            AgentRunJob.lease_expires_at > now,
        )
        .values(**values)
    )
    if updated.rowcount != 1:
        db.rollback()
        return False
    db.commit()
    return True


def cancel_active_agent_run_jobs(
    db: Session,
    *,
    workspace_id: UUID,
    run_id: UUID,
    reason: str = "Agent run was cancelled.",
) -> int:
    now = datetime.utcnow()
    updated = db.execute(
        update(AgentRunJob)
        .where(
            AgentRunJob.workspace_id == workspace_id,
            AgentRunJob.run_id == run_id,
            AgentRunJob.status.in_(("queued", "retrying")),
        )
        .values(
            status="cancelled",
            locked_by="",
            claim_token="",
            locked_at=None,
            lease_expires_at=None,
            error_category="cancelled",
            error_message=safe_trace_message(reason, error_category_value="cancelled"),
            completed_at=now,
            updated_at=now,
        )
    )
    db.flush()
    return int(updated.rowcount or 0)
