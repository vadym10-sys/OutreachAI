from __future__ import annotations

from collections.abc import Generator
from functools import lru_cache
from pathlib import Path

import logging
import time

from sqlalchemy import Engine, create_engine, inspect, text
from sqlalchemy import event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import get_settings
from app.core.observability import capture_provider_exception

logger = logging.getLogger("outreachai.database")


def _resolve_repo_root() -> Path:
    current = Path(__file__).resolve()
    for candidate in current.parents:
        if (candidate / "db" / "schema.sql").exists() and (candidate / "db" / "migrations").exists():
            return candidate
    # Fallback keeps the app bootable even if schema files are missing in a custom runtime image.
    return current.parents[-1]


REPO_ROOT = _resolve_repo_root()
SCHEMA_PATH = REPO_ROOT / "db" / "schema.sql"
MIGRATIONS_DIR = REPO_ROOT / "db" / "migrations"


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


def _execute_sql_script(engine: Engine, script_path: Path) -> None:
    sql_text = script_path.read_text(encoding="utf-8")
    if not sql_text.strip():
        return

    logger.info("Applying database script %s", script_path.relative_to(REPO_ROOT))
    with engine.begin() as connection:
        connection.execute(text(sql_text))


def _ensure_schema_migrations_table(engine: Engine) -> None:
    if engine.dialect.name != "postgresql":
        return

    with engine.begin() as connection:
        connection.execute(text("""
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version VARCHAR(255) PRIMARY KEY,
                applied_at TIMESTAMP NOT NULL DEFAULT now()
            )
        """))


def _applied_migration_versions(engine: Engine) -> set[str]:
    if engine.dialect.name != "postgresql":
        return set()

    with engine.connect() as connection:
        try:
            rows = connection.execute(text("SELECT version FROM schema_migrations")).fetchall()
        except Exception:
            return set()
    return {row[0] for row in rows}


def initialize_database_schema(engine: Engine) -> None:
    # Import models before metadata creation so local/test SQLite schemas include every mapped table.
    import app.models.entities  # noqa: F401

    if engine.dialect.name != "postgresql":
        Base.metadata.create_all(bind=engine)
        return

    _ensure_schema_migrations_table(engine)
    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())

    if not existing_tables:
        _execute_sql_script(engine, SCHEMA_PATH)

    applied_versions = _applied_migration_versions(engine)
    for migration_path in sorted(MIGRATIONS_DIR.glob("*.sql")):
        version = migration_path.stem
        if version in applied_versions:
            continue
        _execute_sql_script(engine, migration_path)
        with engine.begin() as connection:
            connection.execute(text("INSERT INTO schema_migrations (version) VALUES (:version)"), {"version": version})


def ensure_runtime_schema(engine: Engine) -> None:
    """Apply the authoritative schema and migration scripts for the current engine."""
    initialize_database_schema(engine)
