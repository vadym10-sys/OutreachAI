from __future__ import annotations

import logging
import sys
import traceback

import sentry_sdk
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.responses import Response

from app.api.routes import router as api_router
from app.api.webhooks import router as webhook_router
from app.core.config import get_settings
from app.core.database import Base, get_engine
from app.core.observability import init_sentry, sentry_transaction_name, set_request_context
from app.core.security import rate_limit

logging.basicConfig(
    level=logging.INFO,
    stream=sys.stdout,
    format="%(levelname)s:%(name)s:%(message)s",
    force=True
)
logger = logging.getLogger("outreachai.api")
settings = get_settings()
init_sentry(settings)

app = FastAPI(
    title="OutreachAI API",
    description="FastAPI backend for lead discovery, AI personalization, campaigns, CRM, billing, inbox, analytics, and admin operations.",
    version="1.0.0",
    dependencies=[Depends(rate_limit)]
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)


@app.middleware("http")
async def sentry_request_context(request: Request, call_next) -> Response:
    set_request_context(request)
    sentry_sdk.set_tag("endpoint", request.url.path)
    sentry_sdk.set_tag("environment", settings.app_env)
    sentry_sdk.set_tag("release", "outreachai-api@1.0.0")
    sentry_sdk.set_context("transaction", {"name": sentry_transaction_name(request)})
    return await call_next(request)


@app.get("/")
def root() -> dict[str, str]:
    return {"service": "outreachai-api", "status": "ok"}


@app.get("/api/debug/sentry-error", include_in_schema=False)
def sentry_error_probe() -> dict[str, str]:
    if not settings.debug:
        raise HTTPException(status_code=404, detail="Not found")
    raise RuntimeError("OutreachAI backend development Sentry test error")


app.include_router(api_router, prefix="/api", tags=["api"])
app.include_router(webhook_router)


@app.on_event("startup")
def startup() -> None:
    try:
        logger.info("Starting OutreachAI API app_env=%s", settings.app_env)
        logger.info(
            "Startup diagnostics: registered routes=%s",
            ", ".join(f"{route.path}:{','.join(sorted(route.methods or []))}" for route in app.routes)
        )
        missing = settings.missing_optional_services
        if missing:
            logger.warning("Optional backend integrations not configured: %s", ", ".join(missing))

        if not settings.auto_create_tables:
            logger.info("Database table auto-creation disabled; /api/health is available without database connectivity")
            return

        Base.metadata.create_all(bind=get_engine())
        logger.info("Database tables verified")
    except Exception:
        logger.exception("Startup initialization failed; API will keep running so /api/health remains available")
        traceback.print_exc(file=sys.stdout)
