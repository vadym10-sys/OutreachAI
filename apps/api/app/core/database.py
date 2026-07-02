from __future__ import annotations

from collections.abc import Generator
from functools import lru_cache

import logging

from sqlalchemy import Engine, create_engine, inspect, text
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
    return create_engine(settings.database_url, pool_pre_ping=True, connect_args=connect_args)


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
