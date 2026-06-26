from __future__ import annotations

import json
import logging
import sys

from app.core.database import get_sessionmaker
from app.services.acquisition import run_daily_acquisition


def main() -> None:
    logging.basicConfig(level=logging.INFO, stream=sys.stdout, format="%(levelname)s:%(name)s:%(message)s", force=True)
    session = get_sessionmaker()()
    try:
        result = run_daily_acquisition(session)
        print(json.dumps(result.as_dict(), default=str))
    finally:
        session.close()


if __name__ == "__main__":
    main()
