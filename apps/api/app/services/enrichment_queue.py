from __future__ import annotations

import logging
import socket
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.models.entities import EnrichmentJob, Lead

logger = logging.getLogger("outreachai.enrichment_queue")

TERMINAL_JOB_STATUSES = {"succeeded", "failed", "cancelled"}
ACTIVE_JOB_STATUSES = {"pending", "running", "retrying"}


def _worker_id() -> str:
    return f"{socket.gethostname()}:{id(object())}"


def enqueue_company_enrichment_job(
    db: Session,
    *,
    user_id: str,
    workspace_id: UUID,
    lead: Lead,
    request_id: str,
    language: str,
    max_attempts: int,
    force: bool = False,
    priority: int = 0,
) -> EnrichmentJob | None:
    if not force:
        existing = db.scalar(
            select(EnrichmentJob)
            .where(
                EnrichmentJob.workspace_id == workspace_id,
                EnrichmentJob.lead_id == lead.id,
                EnrichmentJob.job_type == "company_enrichment",
                EnrichmentJob.status.in_(tuple(ACTIVE_JOB_STATUSES)),
                EnrichmentJob.cancel_requested.is_(False),
            )
            .order_by(EnrichmentJob.created_at.desc())
        )
        if existing:
            return existing
    else:
        active_jobs = db.scalars(
            select(EnrichmentJob).where(
                EnrichmentJob.workspace_id == workspace_id,
                EnrichmentJob.lead_id == lead.id,
                EnrichmentJob.job_type == "company_enrichment",
                EnrichmentJob.status.in_(tuple(ACTIVE_JOB_STATUSES)),
            )
        ).all()
        for job in active_jobs:
            job.cancel_requested = True
            job.status = "cancelled" if job.status != "running" else job.status
            job.updated_at = datetime.utcnow()

    job = EnrichmentJob(
        workspace_id=workspace_id,
        user_id=user_id,
        lead_id=lead.id,
        job_type="company_enrichment",
        status="pending",
        priority=priority,
        max_attempts=max_attempts,
        request_id=request_id,
        language=language,
        payload_json={"company": lead.company, "website": lead.website or "", "source": "automatic"},
        progress_json={"stage": "queued", "message": "Waiting for an enrichment worker.", "percent": 5},
        run_after=datetime.utcnow(),
    )
    db.add(job)
    return job


def claim_next_enrichment_job(db: Session, *, worker_id: str | None = None, stale_after_seconds: int = 900) -> EnrichmentJob | None:
    now = datetime.utcnow()
    stale_before = now - timedelta(seconds=stale_after_seconds)
    stmt = (
        select(EnrichmentJob)
        .where(
            EnrichmentJob.job_type == "company_enrichment",
            EnrichmentJob.cancel_requested.is_(False),
            or_(
                EnrichmentJob.status.in_(("pending", "retrying")),
                (EnrichmentJob.status == "running") & (EnrichmentJob.locked_at.is_not(None)) & (EnrichmentJob.locked_at < stale_before),
            ),
            EnrichmentJob.run_after <= now,
        )
        .order_by(EnrichmentJob.priority.desc(), EnrichmentJob.run_after.asc(), EnrichmentJob.created_at.asc())
        .limit(1)
    )
    if db.bind and db.bind.dialect.name == "postgresql":
        stmt = stmt.with_for_update(skip_locked=True)
    job = db.scalar(stmt)
    if not job:
        return None
    job.status = "running"
    job.locked_by = worker_id or _worker_id()
    job.locked_at = now
    job.started_at = job.started_at or now
    job.attempts = int(job.attempts or 0) + 1
    job.progress_json = {**(job.progress_json or {}), "stage": "running", "message": "AI enrichment is running.", "percent": max(10, int((job.progress_json or {}).get("percent") or 10))}
    job.updated_at = now
    db.commit()
    db.refresh(job)
    return job


def update_job_progress(db: Session, job: EnrichmentJob, *, stage: str, message: str, percent: int) -> None:
    job.progress_json = {**(job.progress_json or {}), "stage": stage, "message": message, "percent": max(0, min(100, percent))}
    job.updated_at = datetime.utcnow()
    db.commit()


def complete_job(db: Session, job: EnrichmentJob, *, partial: bool = False, warnings: list[str] | None = None) -> None:
    now = datetime.utcnow()
    job.status = "succeeded"
    job.progress_json = {
        **(job.progress_json or {}),
        "stage": "completed",
        "message": "AI enrichment finished with missing fields." if partial else "AI enrichment completed.",
        "percent": 100,
        "partial": partial,
        "warnings": (warnings or [])[:5],
    }
    job.locked_by = ""
    job.locked_at = None
    job.completed_at = now
    job.updated_at = now
    db.commit()


def cancel_jobs_for_lead(db: Session, *, workspace_id: UUID, lead_id: UUID, reason: str = "Cancelled by user.") -> int:
    jobs = db.scalars(
        select(EnrichmentJob).where(
            EnrichmentJob.workspace_id == workspace_id,
            EnrichmentJob.lead_id == lead_id,
            EnrichmentJob.job_type == "company_enrichment",
            EnrichmentJob.status.in_(tuple(ACTIVE_JOB_STATUSES)),
        )
    ).all()
    now = datetime.utcnow()
    for job in jobs:
        job.cancel_requested = True
        if job.status != "running":
            job.status = "cancelled"
            job.completed_at = now
        job.progress_json = {**(job.progress_json or {}), "stage": "cancelled", "message": reason, "percent": int((job.progress_json or {}).get("percent") or 0)}
        job.updated_at = now
    db.commit()
    return len(jobs)


def mark_cancelled(db: Session, job: EnrichmentJob, *, message: str = "AI enrichment was stopped.") -> None:
    now = datetime.utcnow()
    job.status = "cancelled"
    job.cancel_requested = True
    job.locked_by = ""
    job.locked_at = None
    job.completed_at = now
    job.progress_json = {**(job.progress_json or {}), "stage": "cancelled", "message": message}
    job.updated_at = now
    db.commit()


def fail_or_retry_job(db: Session, job: EnrichmentJob, exc: Exception, *, retry_delay_seconds: int = 60) -> None:
    now = datetime.utcnow()
    attempts = int(job.attempts or 0)
    max_attempts = max(1, int(job.max_attempts or 1))
    job.error_message = str(exc)[:2000]
    job.locked_by = ""
    job.locked_at = None
    if attempts < max_attempts and not job.cancel_requested:
        job.status = "retrying"
        job.run_after = now + timedelta(seconds=retry_delay_seconds * attempts)
        job.progress_json = {
            **(job.progress_json or {}),
            "stage": "retrying",
            "message": "Temporary issue. AI enrichment will retry automatically.",
            "percent": int((job.progress_json or {}).get("percent") or 25),
            "attempts": attempts,
            "max_attempts": max_attempts,
        }
    else:
        job.status = "failed"
        job.completed_at = now
        job.progress_json = {
            **(job.progress_json or {}),
            "stage": "failed",
            "message": "AI enrichment could not finish. You can retry from the company card.",
            "percent": int((job.progress_json or {}).get("percent") or 25),
            "attempts": attempts,
            "max_attempts": max_attempts,
        }
    job.updated_at = now
    db.commit()


def queue_status(db: Session, *, workspace_id: UUID | None = None) -> dict[str, Any]:
    stmt = select(EnrichmentJob.status, func.count()).group_by(EnrichmentJob.status)
    if workspace_id:
        stmt = stmt.where(EnrichmentJob.workspace_id == workspace_id)
    counts = {status: int(count) for status, count in db.execute(stmt).all()}
    return {
        "pending": counts.get("pending", 0) + counts.get("retrying", 0),
        "running": counts.get("running", 0),
        "succeeded": counts.get("succeeded", 0),
        "failed": counts.get("failed", 0),
        "cancelled": counts.get("cancelled", 0),
    }
