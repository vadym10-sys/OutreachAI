from __future__ import annotations

from collections.abc import Generator
from functools import lru_cache

import logging
import time

from sqlalchemy import Engine, create_engine, inspect, text
from sqlalchemy import event
from sqlalchemy.schema import CreateColumn
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import get_settings
from app.core.observability import capture_provider_exception

logger = logging.getLogger("outreachai.database")


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


def ensure_runtime_schema(engine: Engine) -> None:
    """Add missing ORM columns in production without destructive migrations.

    This is a safety net for the current Railway/PostgreSQL deployment where
    tables may already exist from older builds. SQLAlchemy create_all() creates
    missing tables, but it does not alter existing tables, which can break
    workspace/CRM endpoints after new columns are introduced.
    """
    if engine.dialect.name != "postgresql":
        return

    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())
    with engine.begin() as connection:
        for table in Base.metadata.sorted_tables:
            if table.name not in existing_tables:
                continue
            existing_columns = {column["name"] for column in inspector.get_columns(table.name)}
            for column in table.columns:
                if column.name in existing_columns:
                    continue
                if column.primary_key:
                    continue
                compiled = str(CreateColumn(column).compile(dialect=engine.dialect))
                compiled = compiled.replace(" NOT NULL", "")
                statement = f'ALTER TABLE "{table.name}" ADD COLUMN IF NOT EXISTS {compiled}'
                logger.warning("Adding missing production column table=%s column=%s", table.name, column.name)
                connection.execute(text(statement))
