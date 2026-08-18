from __future__ import annotations

import logging
import os
import signal
import threading
import uuid
from datetime import datetime

import sentry_sdk

from app.core.config import Settings, get_settings
from app.core.database import get_sessionmaker
from app.core.observability import init_sentry
from app.models.entities import AgentRunJob
from app.services.agent_runtime.errors import AgentRunJobClaimLost
from app.services.agent_runtime.jobs import (
    claim_next_agent_run_job,
    fail_or_retry_agent_run_job,
    heartbeat_agent_run_job,
    mark_agent_run_job_cancelled,
    mark_agent_run_job_succeeded,
)
from app.services.agent_runtime.orchestrator import AgentRuntimeOrchestrator
from app.services.agent_runtime.staging_fake import (
    DeterministicStagingPlanner,
    StagingFakeAgentToolAdapters,
)

logger = logging.getLogger("outreachai.agent_runtime_worker")


class AgentRuntimeWorkerConfigurationError(RuntimeError):
    """Raised when the AI Tasks worker is not in an explicitly safe mode."""


def _worker_id() -> str:
    return f"agent-runtime-{os.getpid()}-{uuid.uuid4().hex[:8]}"


def validate_ai_tasks_worker_configuration(settings: Settings | None = None) -> None:
    resolved = settings or get_settings()
    if resolved.ai_tasks_worker_mode != "staging_fake":
        raise AgentRuntimeWorkerConfigurationError(
            "AI Tasks worker requires AI_TASKS_WORKER_MODE=staging_fake."
        )
    if resolved.app_env != "staging":
        raise AgentRuntimeWorkerConfigurationError(
            "AI Tasks staging fake worker requires APP_ENV=staging."
        )
    if not resolved.ai_control_plane_enabled:
        raise AgentRuntimeWorkerConfigurationError(
            "AI Tasks staging fake worker requires AI_CONTROL_PLANE_ENABLED=true."
        )
    if not resolved.ai_control_plane_force_dry_run:
        raise AgentRuntimeWorkerConfigurationError(
            "AI Tasks staging fake worker requires AI_CONTROL_PLANE_FORCE_DRY_RUN=true."
        )


def build_worker_orchestrator(settings: Settings | None = None) -> AgentRuntimeOrchestrator:
    validate_ai_tasks_worker_configuration(settings)
    adapters = StagingFakeAgentToolAdapters()
    return AgentRuntimeOrchestrator(
        registry=adapters.registry(),
        planner=DeterministicStagingPlanner(),
        feature_enabled=True,
        force_dry_run=True,
    )


def _heartbeat_job_until_stopped(
    job_id,
    claim_token: str,
    interval_seconds: float,
    lease_seconds: int,
    stop_event: threading.Event,
) -> None:  # type: ignore[no-untyped-def]
    while not stop_event.wait(timeout=interval_seconds):
        db = get_sessionmaker()()
        try:
            if not heartbeat_agent_run_job(
                db,
                job_id=job_id,
                claim_token=claim_token,
                lease_seconds=lease_seconds,
            ):
                return
        finally:
            db.close()


def _finalize_job_for_run_state(
    db,
    *,
    job: AgentRunJob,
    claim_token: str,
    run_status: str,
    run_error_category: str,
) -> bool:  # type: ignore[no-untyped-def]
    if run_status == "cancelled":
        return mark_agent_run_job_cancelled(
            db,
            job=job,
            claim_token=claim_token,
            reason="Agent run was cancelled.",
        )
    if run_status == "failed":
        return fail_or_retry_agent_run_job(
            db,
            job=job,
            claim_token=claim_token,
            exc=RuntimeError(run_error_category or "agent_run_failed"),
            retryable=False,
        )
    return mark_agent_run_job_succeeded(db, job=job, claim_token=claim_token)


def run_agent_runtime_worker_once(
    worker_id: str | None = None,
    *,
    orchestrator: AgentRuntimeOrchestrator | None = None,
) -> bool:
    settings = get_settings()
    validate_ai_tasks_worker_configuration(settings)
    worker = worker_id or _worker_id()
    lease_seconds = max(1, int(settings.ai_tasks_worker_claim_timeout_seconds or 900))
    db = get_sessionmaker()()
    try:
        job = claim_next_agent_run_job(
            db,
            worker_id=worker,
            lease_seconds=lease_seconds,
        )
        if job is None:
            return False
        job_id = job.id
        claim_token = job.claim_token
        logger.info(
            "AI Tasks worker claimed job_id=%s run_id=%s operation=%s attempt=%s",
            job.id,
            job.run_id,
            job.operation,
            job.attempts,
        )
    finally:
        db.close()

    heartbeat_stop = threading.Event()
    heartbeat_interval = max(1.0, min(30.0, lease_seconds / 3.0))
    heartbeat_thread = threading.Thread(
        target=_heartbeat_job_until_stopped,
        args=(job_id, claim_token, heartbeat_interval, lease_seconds, heartbeat_stop),
        name=f"outreachai-agent-runtime-heartbeat-{str(job_id)[:8]}",
        daemon=True,
    )
    heartbeat_thread.start()
    process_db = get_sessionmaker()()
    try:
        process_job = process_db.get(AgentRunJob, job_id)
        if process_job is None:
            return True
        runtime = orchestrator or build_worker_orchestrator(settings)
        run = runtime.execute_claimed_job(
            process_db,
            job=process_job,
            claim_token=claim_token,
        )
        finalized = _finalize_job_for_run_state(
            process_db,
            job=process_job,
            claim_token=claim_token,
            run_status=run.status,
            run_error_category=run.error_category or "",
        )
        if not finalized:
            logger.info("AI Tasks worker skipped stale finalize job_id=%s", job_id)
        return True
    except AgentRunJobClaimLost:
        process_db.rollback()
        logger.info("AI Tasks worker lost claim before finalize job_id=%s", job_id)
        return True
    except Exception as exc:
        sentry_sdk.capture_exception(exc)
        process_db.rollback()
        retry_db = get_sessionmaker()()
        try:
            retry_job = retry_db.get(AgentRunJob, job_id)
            if retry_job is not None:
                fail_or_retry_agent_run_job(
                    retry_db,
                    job=retry_job,
                    claim_token=claim_token,
                    exc=exc,
                )
        finally:
            retry_db.close()
        logger.warning(
            "AI Tasks worker job failed job_id=%s reason=%s",
            job_id,
            str(exc)[:240],
        )
        return True
    finally:
        heartbeat_stop.set()
        heartbeat_thread.join(timeout=max(1.0, heartbeat_interval))
        process_db.close()


def run_agent_runtime_worker_forever(stop_event: threading.Event | None = None) -> None:
    settings = get_settings()
    validate_ai_tasks_worker_configuration(settings)
    init_sentry(settings)
    worker = _worker_id()
    poll_seconds = max(0.5, float(settings.ai_tasks_worker_poll_seconds or 2.0))
    stop = stop_event or threading.Event()
    logger.info("Starting AI Tasks worker worker_id=%s concurrency=1", worker)
    while not stop.is_set():
        did_work = run_agent_runtime_worker_once(worker_id=worker)
        if not did_work and stop.wait(timeout=poll_seconds):
            break
    logger.info("AI Tasks worker stopped worker_id=%s", worker)


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(levelname)s:%(name)s:%(message)s",
        force=True,
    )
    stop = threading.Event()

    def _handle_signal(signum, frame):  # type: ignore[no-untyped-def]
        logger.info(
            "Received shutdown signal=%s at=%s",
            signum,
            datetime.utcnow().isoformat(),
        )
        stop.set()

    signal.signal(signal.SIGTERM, _handle_signal)
    signal.signal(signal.SIGINT, _handle_signal)
    run_agent_runtime_worker_forever(stop)


if __name__ == "__main__":
    main()
