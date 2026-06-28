from __future__ import annotations

from collections.abc import Generator
from functools import lru_cache

from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import get_settings
from app.core.observability import capture_provider_exception


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
