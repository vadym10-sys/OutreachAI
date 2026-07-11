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

from app.api.usage import mark_enrichment_job_failed, process_enrichment_job
from app.core.config import get_settings
from app.core.database import get_sessionmaker
from app.core.observability import init_sentry
from app.models.entities import EnrichmentJob
from app.services.enrichment_queue import claim_next_enrichment_job, fail_or_retry_job

logger = logging.getLogger("outreachai.enrichment_worker")

_EMBEDDED_WORKER_THREAD: threading.Thread | None = None
_EMBEDDED_STOP_EVENT: threading.Event | None = None


def _worker_id(prefix: str = "worker") -> str:
    return f"{prefix}-{os.getpid()}-{uuid.uuid4().hex[:8]}"


def run_enrichment_worker_once(worker_id: str | None = None) -> bool:
    settings = get_settings()
    db = get_sessionmaker()()
    job: EnrichmentJob | None = None
    worker = worker_id or _worker_id()
    try:
        job = claim_next_enrichment_job(db, worker_id=worker, stale_after_seconds=settings.enrichment_worker_claim_timeout_seconds)
        if job is None:
            return False
        job_id = job.id
        logger.info("Enrichment worker claimed job_id=%s lead_id=%s request_id=%s attempt=%s", job.id, job.lead_id, job.request_id, job.attempts)
    finally:
        db.close()

    try:
        process_enrichment_job(job_id)
        logger.info("Enrichment worker completed job_id=%s", job_id)
        return True
    except Exception as exc:
        sentry_sdk.capture_exception(exc)
        retry_db = get_sessionmaker()()
        final = False
        try:
            retry_job = retry_db.get(EnrichmentJob, job_id)
            if retry_job is not None:
                fail_or_retry_job(retry_db, retry_job, exc)
                final = retry_job.status == "failed"
                logger.warning(
                    "Enrichment worker job failed job_id=%s status=%s attempts=%s reason=%s",
                    job_id,
                    retry_job.status,
                    retry_job.attempts,
                    str(exc)[:300],
                )
        finally:
            retry_db.close()
        mark_enrichment_job_failed(job_id, exc, final=final)
        return True


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


def start_embedded_enrichment_worker() -> None:
    global _EMBEDDED_STOP_EVENT, _EMBEDDED_WORKER_THREAD
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
    logger.info("Embedded enrichment worker started")


def stop_embedded_enrichment_worker() -> None:
    global _EMBEDDED_STOP_EVENT, _EMBEDDED_WORKER_THREAD
    if _EMBEDDED_STOP_EVENT:
        _EMBEDDED_STOP_EVENT.set()
    if _EMBEDDED_WORKER_THREAD and _EMBEDDED_WORKER_THREAD.is_alive():
        _EMBEDDED_WORKER_THREAD.join(timeout=5)
    _EMBEDDED_WORKER_THREAD = None
    _EMBEDDED_STOP_EVENT = None


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
