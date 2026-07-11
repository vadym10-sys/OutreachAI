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
from sqlalchemy import select, text

from app.api.routes import router as api_router
from app.api.usage import router as usage_router
from app.api.webhooks import router as webhook_router
from app.core.config import get_settings
from app.core.database import Base, ensure_runtime_schema, get_engine, get_sessionmaker
from app.core.observability import init_sentry, sentry_transaction_name, set_request_context
from app.core.reliability import required_environment_status, validate_required_environment
from app.core.security import authenticated_user_id_from_authorization, rate_limit
from app.models.entities import AuditLog, Workspace
from app.services.backups import database_backups_operational

logging.basicConfig(
    level=logging.INFO,
    stream=sys.stdout,
    format="%(levelname)s:%(name)s:%(message)s",
    force=True
)
logging.getLogger("httpx").setLevel(logging.WARNING)
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
    if any(term in lower for term in ["email sending is disabled", "sender email", "daily sending limit", "daily safe sending limit", "safe daily sending limit", "smtp setup", "custom encryption key", "mailbox credential"]):
        return "Connect email sending or adjust the daily sending limit before sending."
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


@app.middleware("http")
async def audit_user_actions(request: Request, call_next) -> Response:
    response = await call_next(request)
    if not settings.request_audit_enabled:
        return response
    if request.method not in {"POST", "PUT", "PATCH", "DELETE"}:
        return response
    if request.url.path.startswith(("/api/health", "/api/live", "/api/ready", "/docs", "/openapi", "/webhooks")):
        return response

    user_id = authenticated_user_id_from_authorization(request.headers.get("authorization"))
    if not user_id:
        return response

    try:
        db = get_sessionmaker()()
        try:
            workspace_id = db.scalar(select(Workspace.id).where(Workspace.owner_user_id == user_id).order_by(Workspace.created_at.asc()))
            ip = request.headers.get("x-forwarded-for", "").split(",")[0] or (request.client.host if request.client else None)
            db.add(
                AuditLog(
                    user_id=user_id,
                    workspace_id=workspace_id,
                    action=f"api.{request.method.lower()}",
                    ip_address=ip,
                    metadata_json={
                        "path": request.url.path,
                        "status": response.status_code,
                        "request_id": getattr(request.state, "request_id", ""),
                    },
                )
            )
            db.commit()
        finally:
            db.close()
    except Exception as exc:
        logger.warning("User action audit failed request_id=%s path=%s reason=%s", getattr(request.state, "request_id", ""), request.url.path, exc)
        sentry_sdk.capture_exception(exc)

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


@app.get("/api/health")
def api_health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/live")
def api_liveness() -> dict[str, str]:
    return {"status": "alive"}


@app.get("/api/ready")
def api_readiness() -> JSONResponse:
    env_status = required_environment_status(settings)
    missing_env = [name for name, loaded in env_status.items() if not loaded]
    database_ready = False
    database_backups_configured = False
    warnings: list[str] = []
    try:
        with get_engine().connect() as connection:
            connection.execute(text("SELECT 1"))
        database_ready = True
        with get_sessionmaker()() as db:
            database_backups_configured = database_backups_operational(db, settings)
    except Exception as exc:
        logger.exception("Readiness database check failed")
        sentry_sdk.capture_exception(exc)

    ready = database_ready and (not missing_env or not settings.strict_startup_env_validation)
    if not database_backups_configured:
        warnings.append("database_backups_not_confirmed")
    status_code = 200 if ready else 503
    return JSONResponse(
        status_code=status_code,
        content={
            "status": "ready" if ready else "degraded",
            "database": database_ready,
            "required_environment": env_status,
            "database_backups_configured": database_backups_configured,
            "warnings": warnings,
        },
    )


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
        validate_required_environment(settings)
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
        with get_sessionmaker()() as db:
            backup_ready = database_backups_operational(db, settings)
        if not backup_ready:
            logger.warning("Database backup policy is not confirmed by runtime configuration.")
        from app.jobs.worker import start_embedded_enrichment_worker

        start_embedded_enrichment_worker()
    except Exception:
        logger.exception("Startup initialization failed; API will keep running so /api/health remains available")
        traceback.print_exc(file=sys.stdout)


@app.on_event("shutdown")
def shutdown() -> None:
    try:
        from app.jobs.worker import stop_embedded_enrichment_worker

        stop_embedded_enrichment_worker()
        get_engine().dispose()
        logger.info("Database engine disposed during graceful shutdown")
    except Exception:
        logger.exception("Graceful shutdown failed while disposing database engine")
