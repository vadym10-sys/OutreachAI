from __future__ import annotations

import logging
import os
import re
import time
from collections.abc import Callable
from typing import TypeVar

import httpx
from sqlalchemy import text

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


def required_environment_issues(settings: Settings) -> list[str]:
    status = required_environment_status(settings)
    issues: list[str] = []
    for name, loaded in status.items():
        if not loaded:
            issues.append(name)
            continue
        if _should_enforce_startup_validation(settings) and _looks_like_placeholder_value(name, os.getenv(name)):
            issues.append(name)
    return issues


def _should_enforce_startup_validation(settings: Settings) -> bool:
    return settings.strict_startup_env_validation or (getattr(settings, "app_env", "") or "").strip().lower() == "production"


def _looks_like_placeholder_value(name: str, value: str | None) -> bool:
    if value is None:
        return True
    normalized = str(value).strip().lower()
    if not normalized:
        return True
    if name == "DATABASE_URL":
        if normalized.startswith("sqlite://"):
            return True
        if normalized in {"postgres", "postgresql"}:
            return True
        if normalized.startswith("postgresql://localhost") or normalized.startswith("postgres://localhost"):
            return True
        if normalized.startswith("postgresql://postgres:postgres@localhost") or normalized.startswith("postgres://postgres:postgres@localhost"):
            return True
        if re.search(r"(example|placeholder|changeme|replace-me|replace_me|your-db-host)", normalized):
            return True
        return False
    if name in {"CLERK_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "AUTOMATION_SECRET"}:
        return normalized in {"dev", "development", "test", "testing", "changeme", "change_me", "replace-me", "replace_me", "placeholder", "example"}
    if name == "CLERK_JWT_ISSUER":
        return normalized in {"https://example.clerk.accounts.dev", "https://example.com", "http://localhost", "localhost", "example", "dev"}
    return False


def validate_required_environment(settings: Settings) -> list[str]:
    invalid = required_environment_issues(settings)
    if invalid:
        logger.warning("Required runtime environment variables missing or invalid: %s", ", ".join(invalid))
        if _should_enforce_startup_validation(settings):
            raise RuntimeError(f"Missing required runtime environment variables: {', '.join(invalid)}")
    return invalid


def validate_database_connectivity(settings: Settings | None = None) -> None:
    from app.core.database import get_engine

    effective_settings = settings or Settings()
    engine = get_engine()
    if _should_enforce_startup_validation(effective_settings) and engine.dialect.name != "postgresql":
        logger.critical("Production startup requires a PostgreSQL database; got %s", engine.dialect.name)
        raise RuntimeError("Production startup requires PostgreSQL")

    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
    except Exception as exc:
        logger.critical("PostgreSQL connectivity check failed: %s", exc)
        raise RuntimeError("PostgreSQL connectivity check failed") from exc


def database_backup_configured(settings: Settings) -> bool:
    return str(settings.database_backups_enabled).strip().lower() == "true"
