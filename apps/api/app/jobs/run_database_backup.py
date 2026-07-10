from __future__ import annotations

import logging
import sys

from app.core.database import Base, ensure_runtime_schema, get_engine, get_sessionmaker
from app.services.backups import run_database_backup

logging.basicConfig(level=logging.INFO, stream=sys.stdout, format="%(levelname)s:%(name)s:%(message)s", force=True)
logger = logging.getLogger("outreachai.backup_job")


def main() -> int:
    engine = get_engine()
    Base.metadata.create_all(bind=engine)
    ensure_runtime_schema(engine)
    with get_sessionmaker()() as db:
        run = run_database_backup(db, triggered_by="scheduled-job")
        logger.info("Database backup finished id=%s status=%s restore_verified=%s", run.id, run.status, run.restore_verified)
        return 0 if run.status == "success" and run.restore_verified else 1


if __name__ == "__main__":
    raise SystemExit(main())
