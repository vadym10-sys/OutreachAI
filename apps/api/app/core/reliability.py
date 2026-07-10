from __future__ import annotations

import logging
import os
import time
from collections.abc import Callable
from typing import TypeVar

import httpx

from app.core.config import Settings

logger = logging.getLogger("outreachai.reliability")

T = TypeVar("T")
TRANSIENT_HTTP_STATUS = {408, 409, 425, 429, 500, 502, 503, 504}


def is_transient_http_error(exc: BaseException) -> bool:
    if isinstance(exc, httpx.TimeoutException):
        return True
    if isinstance(exc, httpx.HTTPStatusError):
        return exc.response.status_code in TRANSIENT_HTTP_STATUS
    return isinstance(exc, httpx.TransportError)


def retry_operation(
    operation: Callable[[], T],
    *,
    attempts: int = 3,
    base_delay_seconds: float = 0.25,
    retry_if: Callable[[BaseException], bool] = is_transient_http_error,
    operation_name: str = "operation",
) -> T:
    last_error: BaseException | None = None
    for attempt in range(1, max(1, attempts) + 1):
        try:
            return operation()
        except BaseException as exc:
            last_error = exc
            if attempt >= attempts or not retry_if(exc):
                raise
            delay = base_delay_seconds * attempt
            logger.warning("%s transient failure attempt=%s retry_in_seconds=%.2f", operation_name, attempt, delay)
            time.sleep(delay)
    raise RuntimeError(f"{operation_name} failed") from last_error


def required_environment_status(settings: Settings) -> dict[str, bool]:
    return {name: bool(os.getenv(name)) for name in settings.required_runtime_envs_list}


def validate_required_environment(settings: Settings) -> list[str]:
    status = required_environment_status(settings)
    missing = [name for name, loaded in status.items() if not loaded]
    if missing:
        logger.warning("Required runtime environment variables missing: %s", ", ".join(missing))
        if settings.strict_startup_env_validation:
            raise RuntimeError(f"Missing required runtime environment variables: {', '.join(missing)}")
    return missing


def database_backup_configured(settings: Settings) -> bool:
    return str(settings.database_backups_enabled).strip().lower() == "true"
