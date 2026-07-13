from __future__ import annotations

import importlib
import logging
import os
import sys
import traceback
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread

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


def _start_worker_health_server(port: int, logger: logging.Logger) -> None:
    class WorkerHealthHandler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802
            if self.path in {"/api/health", "/api/live"}:
                body = b'{"status":"ok","service":"outreachai-worker"}'
                self.send_response(HTTPStatus.OK)
                self.send_header("Content-Type", "application/json")
                self.send_header("Cache-Control", "no-store")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            self.send_response(HTTPStatus.NOT_FOUND)
            self.send_header("Content-Length", "0")
            self.end_headers()

        def do_HEAD(self) -> None:  # noqa: N802
            if self.path in {"/api/health", "/api/live"}:
                self.send_response(HTTPStatus.OK)
                self.send_header("Cache-Control", "no-store")
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            self.send_response(HTTPStatus.NOT_FOUND)
            self.send_header("Content-Length", "0")
            self.end_headers()

        def log_message(self, format: str, *args) -> None:  # noqa: A003
            logger.info("Worker healthcheck request: " + format, *args)

    server = ThreadingHTTPServer(("0.0.0.0", port), WorkerHealthHandler)
    thread = Thread(target=server.serve_forever, name="outreachai-worker-health", daemon=True)
    thread.start()
    logger.info("Worker healthcheck server listening on host=0.0.0.0 port=%s path=/api/health", port)


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        stream=sys.stdout,
        format="%(levelname)s:%(name)s:%(message)s",
        force=True
    )
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logger = logging.getLogger("outreachai.api.serve")
    raw_port = os.getenv("PORT", "8000")
    port = int(raw_port)
    process_role = os.getenv("OUTREACHAI_PROCESS_ROLE", "api").strip().lower()
    logger.info("Startup diagnostics: python=%s", sys.version.replace("\n", " "))
    logger.info("Startup diagnostics: cwd=%s", os.getcwd())
    logger.info("Startup diagnostics: PORT=%s", raw_port)
    logger.info("Startup diagnostics: OUTREACHAI_PROCESS_ROLE=%s", process_role)
    logger.info("Startup diagnostics: DATABASE_URL present=%s", bool(os.getenv("DATABASE_URL")))

    if process_role == "worker":
        logger.info("Starting OutreachAI enrichment worker process")
        from app.jobs.worker import main as worker_main

        _start_worker_health_server(port, logger)
        worker_main()
        return

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
