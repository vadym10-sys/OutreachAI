from __future__ import annotations

import logging
import os
import sys
import traceback

import uvicorn


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        stream=sys.stdout,
        format="%(levelname)s:%(name)s:%(message)s",
        force=True
    )
    logger = logging.getLogger("outreachai.api.serve")
    port = int(os.getenv("PORT", "8000"))
    logger.info("Starting uvicorn app.main:app on 0.0.0.0:%s", port)

    try:
        uvicorn.run("app.main:app", host="0.0.0.0", port=port, log_level="info")
    except KeyboardInterrupt:
        logger.info("Backend server shutdown requested")
    except BaseException as exc:
        logger.critical("Fatal backend startup exception: %s", exc)
        traceback.print_exc()
        raise


if __name__ == "__main__":
    main()
