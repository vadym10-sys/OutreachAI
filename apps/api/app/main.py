from __future__ import annotations

import logging
import sys
import traceback

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router as api_router
from app.api.webhooks import router as webhook_router
from app.core.config import get_settings
from app.core.database import Base, get_engine
from app.core.security import rate_limit

logging.basicConfig(
    level=logging.INFO,
    stream=sys.stdout,
    format="%(levelname)s:%(name)s:%(message)s",
    force=True
)
logger = logging.getLogger("outreachai.api")

app = FastAPI(
    title="OutreachAI API",
    description="FastAPI backend for lead discovery, AI personalization, campaigns, CRM, billing, inbox, analytics, and admin operations.",
    version="1.0.0",
    dependencies=[Depends(rate_limit)]
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "https://outreachai.example"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)


@app.get("/")
def root() -> dict[str, str]:
    return {"service": "outreachai-api", "status": "ok"}


app.include_router(api_router, prefix="/api", tags=["api"])
app.include_router(webhook_router)


@app.on_event("startup")
def startup() -> None:
    try:
        settings = get_settings()
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
