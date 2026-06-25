from __future__ import annotations

import importlib
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
    raw_port = os.getenv("PORT")
    if raw_port is None:
        raise RuntimeError("PORT environment variable is required")
    port = int(raw_port)
    logger.info("Startup diagnostics: python=%s", sys.version.replace("\n", " "))
    logger.info("Startup diagnostics: cwd=%s", os.getcwd())
    logger.info("Startup diagnostics: PORT=%s", raw_port)
    logger.info("Startup diagnostics: DATABASE_URL present=%s", bool(os.getenv("DATABASE_URL")))

    try:
        main_module = importlib.import_module("app.main")
        fastapi_app = getattr(main_module, "app")
        logger.info("Startup diagnostics: app.main:app import=ok")
        logger.info(
            "Startup diagnostics: registered routes=%s",
            ", ".join(f"{route.path}:{','.join(sorted(route.methods or []))}" for route in fastapi_app.routes)
        )
    except BaseException as exc:
        logger.critical("Startup diagnostics: app.main:app import=failed: %s", exc)
        traceback.print_exc(file=sys.stdout)
        raise

    logger.info("Starting uvicorn app.main:app on host=0.0.0.0 port=%s", port)

    try:
        uvicorn.run("app.main:app", host="0.0.0.0", port=port, log_level="info")
    except KeyboardInterrupt:
        logger.info("Backend server shutdown requested")
    except BaseException as exc:
        logger.critical("Fatal backend startup exception: %s", exc)
        traceback.print_exc(file=sys.stdout)
        raise


if __name__ == "__main__":
    main()
