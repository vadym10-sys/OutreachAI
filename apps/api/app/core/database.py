from __future__ import annotations

from collections.abc import Generator
from dataclasses import dataclass
from datetime import datetime
from functools import lru_cache
from pathlib import Path

import logging
import re
import time

from sqlalchemy import Engine, create_engine, text
from sqlalchemy import event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import get_settings
from app.core.observability import capture_provider_exception

logger = logging.getLogger("outreachai.database")
POSTGRES_MIGRATION_LOCK_KEY = 587349211
REQUIRED_POSTGRES_MIGRATIONS = (
    "011_ai_memory",
    "012_crm_inbox_read_indexes",
    "013_production_hardening_read_paths",
    "014_email_message_recipient_email",
    "015_backup_runs",
    "016_workspace_profile_send_confirmation",
    "017_secure_billing_test_entitlements",
    "018_billing_checkout_idempotency",
    "019_canonical_subscription_resolver",
    "020_billing_subscription_transitions",
    "021_plan_usage_reservations",
    "022_agent_runtime_control_plane",
    "023_action_policy_enforcements",
    "024_agent_run_jobs",
)
REQUIRED_AI_MEMORY_TABLES = ("ai_memory_settings", "ai_memory_entries", "ai_memory_audit_logs")
REQUIRED_AGENT_RUNTIME_TABLES = (
    "agent_runs",
    "agent_steps",
    "agent_tool_calls",
    "agent_approval_requests",
    "agent_trace_events",
    "agent_run_jobs",
)
REQUIRED_ACTION_POLICY_TABLES = ("action_policy_enforcements",)
REQUIRED_RUNTIME_TABLES = (
    *REQUIRED_AI_MEMORY_TABLES,
    *REQUIRED_AGENT_RUNTIME_TABLES,
    *REQUIRED_ACTION_POLICY_TABLES,
)


class RuntimeSchemaError(RuntimeError):
    """Raised when the database schema cannot be migrated or validated."""


@dataclass
class RuntimeSchemaStatus:
    ready: bool
    checked_at: str
    pending_migrations: list[str]
    missing_tables: list[str]
    pgvector_available: bool
    pgvector_installed: bool
    error: str = ""


_LAST_RUNTIME_SCHEMA_STATUS = RuntimeSchemaStatus(
    ready=False,
    checked_at="",
    pending_migrations=list(REQUIRED_POSTGRES_MIGRATIONS),
    missing_tables=list(REQUIRED_RUNTIME_TABLES),
    pgvector_available=False,
    pgvector_installed=False,
    error="schema_not_checked",
)


def _resolve_repo_root() -> Path:
    current = Path(__file__).resolve()
    candidates: list[Path] = []
    for candidate in current.parents:
        if (candidate / "db" / "schema.sql").exists() and (candidate / "db" / "migrations").exists():
            candidates.append(candidate)
    if candidates:
        return max(candidates, key=lambda path: len(list((path / "db" / "migrations").glob("*.sql"))))
    # Fallback keeps the app bootable even if schema files are missing in a custom runtime image.
    return current.parents[-1]


REPO_ROOT = _resolve_repo_root()
SCHEMA_PATH = REPO_ROOT / "db" / "schema.sql"
MIGRATIONS_DIR = REPO_ROOT / "db" / "migrations"
PACKAGED_DB_PATH = Path(__file__).resolve().parents[1] / "db"
PACKAGED_SCHEMA_PATH = PACKAGED_DB_PATH / "schema.sql"
PACKAGED_MIGRATIONS_DIR = PACKAGED_DB_PATH / "migrations"
CONCURRENT_INDEX_CREATE_RE = re.compile(
    r"^\s*CREATE\s+INDEX\s+CONCURRENTLY\s+(?:IF\s+NOT\s+EXISTS\s+)?(?P<name>[a-zA-Z_][a-zA-Z0-9_]*)\b",
    re.IGNORECASE,
)
POSTGRES_IDENTIFIER_RE = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]*$")


class Base(DeclarativeBase):
    pass


@lru_cache
def get_engine() -> Engine:
    settings = get_settings()
    connect_args = {"connect_timeout": 5} if settings.database_url.startswith("postgresql") else {}
    engine = create_engine(settings.database_url, pool_pre_ping=True, connect_args=connect_args)
    _install_query_timing(engine)
    return engine


def _install_query_timing(engine: Engine) -> None:
    settings = get_settings()

    @event.listens_for(engine, "before_cursor_execute")
    def before_cursor_execute(conn, cursor, statement, parameters, context, executemany):  # type: ignore[no-untyped-def]
        context._outreachai_query_started = time.perf_counter()

    @event.listens_for(engine, "after_cursor_execute")
    def after_cursor_execute(conn, cursor, statement, parameters, context, executemany):  # type: ignore[no-untyped-def]
        started = getattr(context, "_outreachai_query_started", None)
        if started is None:
            return
        duration_ms = round((time.perf_counter() - started) * 1000, 2)
        if duration_ms >= settings.slow_db_query_ms:
            logger.warning("Slow database query duration_ms=%s statement=%s", duration_ms, str(statement)[:240])


@lru_cache
def get_sessionmaker() -> sessionmaker[Session]:
    return sessionmaker(bind=get_engine(), autocommit=False, autoflush=False)


def get_db() -> Generator[Session, None, None]:
    db = get_sessionmaker()()
    try:
        yield db
    except Exception as exc:
        capture_provider_exception(exc, provider="postgresql", endpoint="database.session")
        raise
    finally:
        db.close()


def _safe_schema_error(exc: Exception) -> str:
    return f"{type(exc).__name__}: {str(exc).splitlines()[0][:240]}"


def _set_runtime_schema_status(status: RuntimeSchemaStatus) -> None:
    global _LAST_RUNTIME_SCHEMA_STATUS
    _LAST_RUNTIME_SCHEMA_STATUS = status


def get_runtime_schema_status() -> RuntimeSchemaStatus:
    return _LAST_RUNTIME_SCHEMA_STATUS


def _migration_paths() -> list[Path]:
    paths = sorted(MIGRATIONS_DIR.glob("*.sql"))
    if paths:
        return paths
    return sorted(PACKAGED_MIGRATIONS_DIR.glob("*.sql"))


def _schema_path() -> Path:
    return SCHEMA_PATH if SCHEMA_PATH.exists() else PACKAGED_SCHEMA_PATH


def _execute_sql_script(connection, script_path: Path) -> None:  # type: ignore[no-untyped-def]
    sql_text = script_path.read_text(encoding="utf-8")
    if not sql_text.strip():
        return

    try:
        display_path = script_path.relative_to(REPO_ROOT)
    except ValueError:
        display_path = script_path.name
    logger.info("Applying database script %s", display_path)
    connection.execute(text(sql_text))


def _execute_non_transactional_sql_script(connection, script_path: Path) -> None:  # type: ignore[no-untyped-def]
    sql_text = script_path.read_text(encoding="utf-8")
    try:
        display_path = script_path.relative_to(REPO_ROOT)
    except ValueError:
        display_path = script_path.name
    logger.info("Applying non-transactional database script %s", display_path)
    for statement in [item.strip() for item in sql_text.split(";") if item.strip()]:
        _drop_invalid_index_before_concurrent_create(connection, statement)
        connection.execute(text(statement))


def _requires_non_transactional_migration(script_path: Path) -> bool:
    sql_text = script_path.read_text(encoding="utf-8").upper()
    return "CREATE INDEX CONCURRENTLY" in sql_text or "DROP INDEX CONCURRENTLY" in sql_text


def _drop_invalid_index_before_concurrent_create(connection, statement: str) -> None:  # type: ignore[no-untyped-def]
    match = CONCURRENT_INDEX_CREATE_RE.match(statement)
    if not match:
        return
    index_name = match.group("name")
    if not POSTGRES_IDENTIFIER_RE.match(index_name):
        raise RuntimeSchemaError(f"unsafe concurrent index name in migration: {index_name}")
    is_invalid = bool(
        connection.execute(
            text(
                """
                SELECT EXISTS (
                    SELECT 1
                    FROM pg_class c
                    JOIN pg_namespace n ON n.oid = c.relnamespace
                    JOIN pg_index i ON i.indexrelid = c.oid
                    WHERE n.nspname = 'public'
                      AND c.relname = :index_name
                      AND NOT i.indisvalid
                )
                """
            ),
            {"index_name": index_name},
        ).scalar()
    )
    if is_invalid:
        logger.warning("Dropping invalid PostgreSQL index before retrying concurrent create: %s", index_name)
        connection.execute(text(f'DROP INDEX CONCURRENTLY IF EXISTS public."{index_name}"'))


def _ensure_schema_migrations_table(connection) -> None:  # type: ignore[no-untyped-def]
    connection.execute(text("""
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version VARCHAR(255) PRIMARY KEY,
            applied_at TIMESTAMP NOT NULL DEFAULT now()
        )
    """))


def _applied_migration_versions(connection) -> set[str]:  # type: ignore[no-untyped-def]
    try:
        has_migrations_table = bool(
            connection.execute(text("SELECT to_regclass('public.schema_migrations') IS NOT NULL")).scalar()
        )
        if not has_migrations_table:
            return set()
        rows = connection.execute(text("SELECT version FROM schema_migrations")).fetchall()
    except Exception:
        return set()
    return {row[0] for row in rows}


def _public_table_names(connection) -> set[str]:  # type: ignore[no-untyped-def]
    rows = connection.execute(text("""
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_type = 'BASE TABLE'
          AND table_name <> 'schema_migrations'
    """)).fetchall()
    return {row[0] for row in rows}


def _pg_bool(connection, sql: str) -> bool:  # type: ignore[no-untyped-def]
    return bool(connection.execute(text(sql)).scalar())


def _build_runtime_schema_status(connection, *, error: str = "") -> RuntimeSchemaStatus:  # type: ignore[no-untyped-def]
    applied = _applied_migration_versions(connection)
    pending = [version for version in REQUIRED_POSTGRES_MIGRATIONS if version not in applied]
    missing_tables = [
        table_name
        for table_name in REQUIRED_RUNTIME_TABLES
        if not bool(connection.execute(text("SELECT to_regclass(:name) IS NOT NULL"), {"name": f"public.{table_name}"}).scalar())
    ]
    pgvector_available = _pg_bool(connection, "SELECT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'vector')")
    pgvector_installed = _pg_bool(connection, "SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector')")
    return RuntimeSchemaStatus(
        ready=not pending and not missing_tables and not error,
        checked_at=datetime.utcnow().isoformat(),
        pending_migrations=pending,
        missing_tables=missing_tables,
        pgvector_available=pgvector_available,
        pgvector_installed=pgvector_installed,
        error=error,
    )


def validate_runtime_schema(engine: Engine) -> RuntimeSchemaStatus:
    if engine.dialect.name != "postgresql":
        status = RuntimeSchemaStatus(
            ready=True,
            checked_at=datetime.utcnow().isoformat(),
            pending_migrations=[],
            missing_tables=[],
            pgvector_available=False,
            pgvector_installed=False,
        )
        _set_runtime_schema_status(status)
        return status

    try:
        with engine.connect() as connection:
            status = _build_runtime_schema_status(connection)
    except Exception as exc:
        status = RuntimeSchemaStatus(
            ready=False,
            checked_at=datetime.utcnow().isoformat(),
            pending_migrations=list(REQUIRED_POSTGRES_MIGRATIONS),
            missing_tables=list(REQUIRED_RUNTIME_TABLES),
            pgvector_available=False,
            pgvector_installed=False,
            error=_safe_schema_error(exc),
        )
    _set_runtime_schema_status(status)
    return status


def initialize_database_schema(engine: Engine) -> None:
    # Import models before metadata creation so local/test SQLite schemas include every mapped table.
    import app.models.entities  # noqa: F401

    if engine.dialect.name != "postgresql":
        Base.metadata.create_all(bind=engine)
        validate_runtime_schema(engine)
        return

    migration_paths = _migration_paths()
    if not migration_paths:
        raise RuntimeSchemaError("database migration assets are missing from the runtime image")

    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT pg_advisory_lock(:lock_key)"), {"lock_key": POSTGRES_MIGRATION_LOCK_KEY})
            connection.commit()
            try:
                with connection.begin():
                    _ensure_schema_migrations_table(connection)
                    existing_tables = _public_table_names(connection)
                    applied_versions = _applied_migration_versions(connection)

                    if not existing_tables:
                        schema_path = _schema_path()
                        if not schema_path.exists():
                            raise RuntimeSchemaError("database schema asset is missing from the runtime image")
                        _execute_sql_script(connection, schema_path)
                        applied_versions = _applied_migration_versions(connection)

                for migration_path in migration_paths:
                    version = migration_path.stem
                    with connection.begin():
                        applied_versions = _applied_migration_versions(connection)
                        if version in applied_versions:
                            continue
                    if _requires_non_transactional_migration(migration_path):
                        _execute_non_transactional_sql_script(connection.execution_options(isolation_level="AUTOCOMMIT"), migration_path)
                        connection.commit()
                    else:
                        with connection.begin():
                            _execute_sql_script(connection, migration_path)
                    with connection.begin():
                        connection.execute(
                            text("INSERT INTO schema_migrations (version) VALUES (:version) ON CONFLICT (version) DO NOTHING"),
                            {"version": version},
                        )
                    applied_versions.add(version)

                with connection.begin():
                    status = _build_runtime_schema_status(connection)
                    if not status.ready:
                        raise RuntimeSchemaError(
                            "database schema is incomplete "
                            f"pending_migrations={status.pending_migrations} missing_tables={status.missing_tables}"
                        )
                    _set_runtime_schema_status(status)
            finally:
                connection.execute(text("SELECT pg_advisory_unlock(:lock_key)"), {"lock_key": POSTGRES_MIGRATION_LOCK_KEY})
                connection.commit()
    except Exception as exc:
        safe_error = _safe_schema_error(exc)
        logger.exception("Database migration failed: %s", safe_error)
        try:
            with engine.connect() as connection:
                status = _build_runtime_schema_status(connection, error=safe_error)
        except Exception:
            status = RuntimeSchemaStatus(
                ready=False,
                checked_at=datetime.utcnow().isoformat(),
                pending_migrations=list(REQUIRED_POSTGRES_MIGRATIONS),
                missing_tables=list(REQUIRED_RUNTIME_TABLES),
                pgvector_available=False,
                pgvector_installed=False,
                error=safe_error,
        )
        _set_runtime_schema_status(status)
        if isinstance(exc, RuntimeSchemaError):
            raise
        raise RuntimeSchemaError(safe_error) from exc


def ensure_runtime_schema(engine: Engine) -> None:
    """Apply the authoritative schema and migration scripts for the current engine."""
    initialize_database_schema(engine)
