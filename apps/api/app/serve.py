from __future__ import annotations

import importlib
import logging
import os
import sys
import traceback

import uvicorn


UVICORN_LOG_CONFIG = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "default": {
            "()": "uvicorn.logging.DefaultFormatter",
            "fmt": "%(levelprefix)s %(message)s",
            "use_colors": None,
        },
        "access": {
            "()": "uvicorn.logging.AccessFormatter",
            "fmt": '%(levelprefix)s %(client_addr)s - "%(request_line)s" %(status_code)s',
        },
    },
    "handlers": {
        "default": {
            "formatter": "default",
            "class": "logging.StreamHandler",
            "stream": "ext://sys.stdout",
        },
        "access": {
            "formatter": "access",
            "class": "logging.StreamHandler",
            "stream": "ext://sys.stdout",
        },
    },
    "loggers": {
        "uvicorn": {"handlers": ["default"], "level": "INFO", "propagate": False},
        "uvicorn.error": {"handlers": ["default"], "level": "INFO", "propagate": False},
        "uvicorn.access": {"handlers": ["access"], "level": "INFO", "propagate": False},
    },
}


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        stream=sys.stdout,
        format="%(levelname)s:%(name)s:%(message)s",
        force=True
    )
    logger = logging.getLogger("outreachai.api.serve")
    raw_port = os.getenv("PORT", "8000")
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
        uvicorn.run(
            "app.main:app",
            host="0.0.0.0",
            port=port,
            log_level="info",
            log_config=UVICORN_LOG_CONFIG,
        )
    except KeyboardInterrupt:
        logger.info("Backend server shutdown requested")
    except BaseException as exc:
        logger.critical("Fatal backend startup exception: %s", exc)
        traceback.print_exc(file=sys.stdout)
        raise


if __name__ == "__main__":
    main()
