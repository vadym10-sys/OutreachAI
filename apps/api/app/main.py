from __future__ import annotations

import logging
import sys
import time
import traceback
from uuid import uuid4

import sentry_sdk
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.responses import Response
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.routes import router as api_router
from app.api.usage import router as usage_router
from app.api.webhooks import router as webhook_router
from app.core.config import get_settings
from app.core.database import Base, ensure_runtime_schema, get_engine
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


def _safe_error_message(status_code: int, detail: object) -> str:
    raw = str(detail or "")
    lower = raw.lower()
    if "access denied" in lower:
        return "Access denied."
    if status_code == 402 and raw and len(raw) <= 180 and not any(term in lower for term in ["stripe", "api", "http", "exception", "traceback", "stack", "secret", "key", "_url", "/api/"]):
        return raw
    if raw.startswith("This connection ") and len(raw) <= 140:
        return raw
    if status_code in {401, 403} or "bearer" in lower or "token" in lower or "unauthorized" in lower or "forbidden" in lower:
        return "Your session has expired. Please sign in again."
    if status_code == 402 or "subscription" in lower or "billing" in lower or "payment" in lower:
        return "Your plan needs attention before you can continue."
    if status_code == 429 or "rate limit" in lower or "quota" in lower:
        return "This action is temporarily limited. Please try again later."
    if "no companies" in lower or "no matching" in lower:
        return "No companies were found. Try a broader location, industry, or company size."
    if any(term in lower for term in ["google", "places", "apollo", "hunter", "lead search"]):
        return "Lead search is temporarily unavailable. Please try again later."
    if any(term in lower for term in ["openai", "model", "ai analysis", "website analysis"]):
        return "AI analysis is temporarily unavailable. Please try again in a moment."
    if any(term in lower for term in ["resend", "email send", "smtp"]):
        return "Email sending is temporarily unavailable. Please try again later."
    if any(term in lower for term in ["postgres", "database", "sql", "sqlalchemy"]):
        return "We couldn’t load your data right now. Please refresh the page."
    if status_code == 404:
        return "We couldn’t find what you were looking for."
    if 500 <= status_code:
        return "Something went wrong while processing your request. Please try again."
    if raw and len(raw) <= 140 and not any(term in lower for term in ["api", "http", "exception", "traceback", "stack", "secret", "key", "_url", "/api/"]):
        return raw
    return "Something went wrong while processing your request. Please try again."

app = FastAPI(
    title="OutreachAI API",
    description="FastAPI backend for lead discovery, AI personalization, campaigns, CRM, billing, inbox, analytics, and admin operations.",
    version="1.0.0",
    dependencies=[Depends(rate_limit)],
    docs_url="/docs" if settings.debug else None,
    redoc_url="/redoc" if settings.debug else None,
    openapi_url="/openapi.json" if settings.debug else None
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
    started = time.perf_counter()
    request_id = request.headers.get("x-request-id") or str(uuid4())
    request.state.request_id = request_id
    set_request_context(request)
    sentry_sdk.set_tag("request_id", request_id)
    sentry_sdk.set_tag("endpoint", request.url.path)
    sentry_sdk.set_tag("environment", settings.app_env)
    sentry_sdk.set_tag("release", "outreachai-api@1.0.0")
    sentry_sdk.set_context("transaction", {"name": sentry_transaction_name(request), "request_id": request_id})
    try:
        response = await call_next(request)
    except Exception:
        duration_ms = round((time.perf_counter() - started) * 1000, 2)
        sentry_sdk.set_tag("request_duration_ms", duration_ms)
        sentry_sdk.set_context("request_performance", {"duration_ms": duration_ms, "path": request.url.path, "request_id": request_id})
        logger.exception(
            "Request failed request_id=%s method=%s path=%s duration_ms=%s",
            request_id,
            request.method,
            request.url.path,
            duration_ms
        )
        raise
    duration_ms = round((time.perf_counter() - started) * 1000, 2)
    response.headers["X-Response-Time-Ms"] = str(duration_ms)
    response.headers["X-Request-ID"] = request_id
    sentry_sdk.set_tag("request_duration_ms", duration_ms)
    logger.info(
        "Request completed request_id=%s method=%s path=%s status=%s duration_ms=%s",
        request_id,
        request.method,
        request.url.path,
        response.status_code,
        duration_ms
    )
    if duration_ms >= settings.slow_request_ms:
        logger.warning("Slow request request_id=%s path=%s duration_ms=%s", request_id, request.url.path, duration_ms)
        with sentry_sdk.new_scope() as scope:
            scope.set_tag("request_id", request_id)
            scope.set_tag("endpoint", request.url.path)
            scope.set_tag("kind", "slow_request")
            scope.set_context("request_performance", {"duration_ms": duration_ms, "path": request.url.path, "request_id": request_id})
            sentry_sdk.capture_message("Slow API request", level="warning")
    return response


@app.exception_handler(StarletteHTTPException)
async def sanitized_http_exception_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
    sentry_sdk.set_context("sanitized_http_error", {"path": request.url.path, "status_code": exc.status_code, "detail": str(exc.detail)[:1000]})
    if exc.status_code >= 500:
        sentry_sdk.capture_exception(exc)
    return JSONResponse(status_code=exc.status_code, content={"detail": _safe_error_message(exc.status_code, exc.detail)})


@app.exception_handler(Exception)
async def sanitized_unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("Unhandled request failed path=%s", request.url.path)
    sentry_sdk.capture_exception(exc)
    return JSONResponse(status_code=500, content={"detail": "Something went wrong while processing your request. Please try again."})


@app.get("/")
def root() -> dict[str, str]:
    return {"service": "outreachai-api", "status": "ok"}


@app.get("/api/debug/sentry-error", include_in_schema=False)
def sentry_error_probe() -> dict[str, str]:
    if not settings.debug:
        raise HTTPException(status_code=404, detail="Not found")
    raise RuntimeError("OutreachAI backend development Sentry test error")


app.include_router(api_router, prefix="/api", tags=["api"])
app.include_router(usage_router, prefix="/api/workspace-app", tags=["workspace-app"])
app.include_router(webhook_router)


@app.on_event("startup")
def startup() -> None:
    try:
        logger.info("Starting OutreachAI API app_env=%s", settings.app_env)
        logger.info(
            "Startup diagnostics: registered routes=%s",
            ", ".join(f"{route.path}:{','.join(sorted(route.methods or []))}" for route in app.routes)
        )
        missing = settings.missing_customer_integrations
        if missing:
            logger.warning("Customer-facing integrations not configured: %s", ", ".join(missing))

        if not settings.auto_create_tables:
            logger.info("Database table auto-creation disabled; /api/health is available without database connectivity")
            return

        engine = get_engine()
        Base.metadata.create_all(bind=engine)
        ensure_runtime_schema(engine)
        logger.info("Database tables verified")
    except Exception:
        logger.exception("Startup initialization failed; API will keep running so /api/health remains available")
        traceback.print_exc(file=sys.stdout)
