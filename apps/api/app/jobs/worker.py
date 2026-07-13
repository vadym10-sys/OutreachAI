from __future__ import annotations

import logging
import os
import signal
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, wait
from datetime import datetime

import sentry_sdk

from app.api.usage import mark_enrichment_job_failed, process_enrichment_job, run_continuous_company_monitoring_once, run_nightly_lead_prioritization_once
from app.core.config import get_settings
from app.core.database import get_sessionmaker
from app.core.observability import init_sentry
from app.models.entities import EnrichmentJob
from app.services.enrichment_queue import claim_next_enrichment_job, fail_or_retry_job, heartbeat_job_lock

logger = logging.getLogger("outreachai.enrichment_worker")

_EMBEDDED_WORKER_THREAD: threading.Thread | None = None
_EMBEDDED_STOP_EVENT: threading.Event | None = None
_PRIORITIZATION_THREAD: threading.Thread | None = None
_PRIORITIZATION_STOP_EVENT: threading.Event | None = None
_MONITORING_THREAD: threading.Thread | None = None
_MONITORING_STOP_EVENT: threading.Event | None = None


def _worker_id(prefix: str = "worker") -> str:
    return f"{prefix}-{os.getpid()}-{uuid.uuid4().hex[:8]}"


def _claim_token(worker_id: str) -> str:
    return f"{worker_id}:{uuid.uuid4().hex[:8]}"


def _heartbeat_job_until_stopped(job_id, claim_token: str, interval_seconds: float, stop_event: threading.Event) -> None:  # type: ignore[no-untyped-def]
    while not stop_event.wait(timeout=interval_seconds):
        db = get_sessionmaker()()
        try:
            if not heartbeat_job_lock(db, job_id=job_id, claim_token=claim_token):
                return
        finally:
            db.close()


def run_enrichment_worker_once(worker_id: str | None = None) -> bool:
    settings = get_settings()
    db = get_sessionmaker()()
    job: EnrichmentJob | None = None
    worker = worker_id or _worker_id()
    claim_token = _claim_token(worker)
    try:
        job = claim_next_enrichment_job(db, worker_id=claim_token, stale_after_seconds=settings.enrichment_worker_claim_timeout_seconds)
        if job is None:
            return False
        job_id = job.id
        logger.info("Enrichment worker claimed job_id=%s lead_id=%s request_id=%s attempt=%s", job.id, job.lead_id, job.request_id, job.attempts)
    finally:
        db.close()

    heartbeat_stop = threading.Event()
    heartbeat_interval = max(1.0, min(30.0, float(settings.enrichment_worker_claim_timeout_seconds or 900) / 3.0))
    heartbeat_thread = threading.Thread(
        target=_heartbeat_job_until_stopped,
        args=(job_id, claim_token, heartbeat_interval, heartbeat_stop),
        name=f"outreachai-enrichment-heartbeat-{str(job_id)[:8]}",
        daemon=True,
    )
    heartbeat_thread.start()
    try:
        completed = process_enrichment_job(job_id, claim_token=claim_token)
        if completed:
            logger.info("Enrichment worker completed job_id=%s", job_id)
        else:
            logger.info("Enrichment worker ignored stale claim job_id=%s claim_token=%s", job_id, claim_token)
        return True
    except Exception as exc:
        sentry_sdk.capture_exception(exc)
        retry_db = get_sessionmaker()()
        final = False
        try:
            retry_job = retry_db.get(EnrichmentJob, job_id)
            if retry_job is not None:
                transitioned = fail_or_retry_job(retry_db, retry_job, exc, claim_token=claim_token)
                final = transitioned and retry_job.status == "failed"
                if transitioned:
                    logger.warning(
                        "Enrichment worker job failed job_id=%s status=%s attempts=%s reason=%s",
                        job_id,
                        retry_job.status,
                        retry_job.attempts,
                        str(exc)[:300],
                    )
                else:
                    logger.info("Enrichment worker skipped stale failure transition job_id=%s claim_token=%s", job_id, claim_token)
        finally:
            retry_db.close()
        if final:
            mark_enrichment_job_failed(job_id, exc, final=final)
        return True
    finally:
        heartbeat_stop.set()
        heartbeat_thread.join(timeout=max(1.0, heartbeat_interval))


def run_enrichment_worker_forever(stop_event: threading.Event | None = None) -> None:
    settings = get_settings()
    init_sentry(settings)
    worker_id = _worker_id("enrichment")
    concurrency = max(1, min(8, int(settings.enrichment_worker_concurrency or 2)))
    poll_seconds = max(0.5, float(settings.enrichment_worker_poll_seconds or 2.0))
    logger.info("Starting OutreachAI enrichment worker worker_id=%s concurrency=%s", worker_id, concurrency)
    stop = stop_event or threading.Event()
    with ThreadPoolExecutor(max_workers=concurrency, thread_name_prefix="outreachai-enrichment-job") as executor:
        active = set()
        while not stop.is_set():
            finished = {future for future in active if future.done()}
            active = active - finished
            did_work = False
            for future in finished:
                try:
                    did_work = bool(future.result()) or did_work
                except Exception as exc:
                    logger.warning("Enrichment worker future failed reason=%s", str(exc)[:300])
            capacity = concurrency - len(active)
            for _ in range(max(0, capacity)):
                future = executor.submit(run_enrichment_worker_once, worker_id)
                active.add(future)
            if active:
                wait(active, timeout=poll_seconds)
                if all(future.done() for future in active):
                    time.sleep(poll_seconds)
            elif not did_work:
                time.sleep(poll_seconds)
            else:
                time.sleep(poll_seconds)
    logger.info("OutreachAI enrichment worker stopped worker_id=%s", worker_id)


def _seconds_until_next_utc_midnight() -> float:
    now = datetime.utcnow()
    tomorrow = now.date().toordinal() + 1
    next_midnight = datetime.fromordinal(tomorrow)
    return max(60.0, (next_midnight - now).total_seconds())


def run_nightly_lead_prioritization_forever(stop_event: threading.Event | None = None) -> None:
    stop = stop_event or threading.Event()
    logger.info("Starting nightly CRM lead prioritization scheduler")
    while not stop.is_set():
        try:
            updated = run_nightly_lead_prioritization_once()
            logger.info("Nightly CRM lead prioritization completed updated=%s", updated)
        except Exception as exc:
            sentry_sdk.capture_exception(exc)
            logger.warning("Nightly CRM lead prioritization failed reason=%s", str(exc)[:300])
            if stop.wait(timeout=600):
                break
            continue
        sleep_seconds = _seconds_until_next_utc_midnight()
        if stop.wait(timeout=sleep_seconds):
            break
    logger.info("Nightly CRM lead prioritization scheduler stopped")


def run_continuous_company_monitoring_forever(stop_event: threading.Event | None = None) -> None:
    stop = stop_event or threading.Event()
    logger.info("Starting continuous company monitoring scheduler")
    while not stop.is_set():
        try:
            changes = run_continuous_company_monitoring_once()
            logger.info("Continuous company monitoring completed changed_companies=%s", len(changes))
        except Exception as exc:
            sentry_sdk.capture_exception(exc)
            logger.warning("Continuous company monitoring failed reason=%s", str(exc)[:300])
            if stop.wait(timeout=600):
                break
            continue
        sleep_seconds = _seconds_until_next_utc_midnight()
        if stop.wait(timeout=sleep_seconds):
            break
    logger.info("Continuous company monitoring scheduler stopped")


def start_embedded_enrichment_worker() -> None:
    global _EMBEDDED_STOP_EVENT, _EMBEDDED_WORKER_THREAD, _PRIORITIZATION_STOP_EVENT, _PRIORITIZATION_THREAD, _MONITORING_STOP_EVENT, _MONITORING_THREAD
    settings = get_settings()
    if not settings.enrichment_worker_enabled:
        logger.info("Embedded enrichment worker disabled by configuration")
        return
    if os.getenv("PYTEST_CURRENT_TEST"):
        return
    if _EMBEDDED_WORKER_THREAD and _EMBEDDED_WORKER_THREAD.is_alive():
        return
    _EMBEDDED_STOP_EVENT = threading.Event()
    _EMBEDDED_WORKER_THREAD = threading.Thread(target=run_enrichment_worker_forever, args=(_EMBEDDED_STOP_EVENT,), name="outreachai-embedded-enrichment-worker", daemon=True)
    _EMBEDDED_WORKER_THREAD.start()
    _PRIORITIZATION_STOP_EVENT = threading.Event()
    _PRIORITIZATION_THREAD = threading.Thread(
        target=run_nightly_lead_prioritization_forever,
        args=(_PRIORITIZATION_STOP_EVENT,),
        name="outreachai-nightly-lead-prioritization",
        daemon=True,
    )
    _PRIORITIZATION_THREAD.start()
    _MONITORING_STOP_EVENT = threading.Event()
    _MONITORING_THREAD = threading.Thread(
        target=run_continuous_company_monitoring_forever,
        args=(_MONITORING_STOP_EVENT,),
        name="outreachai-continuous-company-monitoring",
        daemon=True,
    )
    _MONITORING_THREAD.start()
    logger.info("Embedded enrichment worker started")


def stop_embedded_enrichment_worker() -> None:
    global _EMBEDDED_STOP_EVENT, _EMBEDDED_WORKER_THREAD, _PRIORITIZATION_STOP_EVENT, _PRIORITIZATION_THREAD, _MONITORING_STOP_EVENT, _MONITORING_THREAD
    if _EMBEDDED_STOP_EVENT:
        _EMBEDDED_STOP_EVENT.set()
    if _PRIORITIZATION_STOP_EVENT:
        _PRIORITIZATION_STOP_EVENT.set()
    if _MONITORING_STOP_EVENT:
        _MONITORING_STOP_EVENT.set()
    if _EMBEDDED_WORKER_THREAD and _EMBEDDED_WORKER_THREAD.is_alive():
        _EMBEDDED_WORKER_THREAD.join(timeout=5)
    if _PRIORITIZATION_THREAD and _PRIORITIZATION_THREAD.is_alive():
        _PRIORITIZATION_THREAD.join(timeout=5)
    if _MONITORING_THREAD and _MONITORING_THREAD.is_alive():
        _MONITORING_THREAD.join(timeout=5)
    _EMBEDDED_WORKER_THREAD = None
    _EMBEDDED_STOP_EVENT = None
    _PRIORITIZATION_THREAD = None
    _PRIORITIZATION_STOP_EVENT = None
    _MONITORING_THREAD = None
    _MONITORING_STOP_EVENT = None


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s:%(name)s:%(message)s", force=True)
    stop = threading.Event()

    def _handle_signal(signum, frame):  # type: ignore[no-untyped-def]
        logger.info("Received shutdown signal=%s at=%s", signum, datetime.utcnow().isoformat())
        stop.set()

    signal.signal(signal.SIGTERM, _handle_signal)
    signal.signal(signal.SIGINT, _handle_signal)
    run_enrichment_worker_forever(stop)


if __name__ == "__main__":
    main()
