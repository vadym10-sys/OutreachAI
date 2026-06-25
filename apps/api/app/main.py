from __future__ import annotations

import logging

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router as api_router
from app.api.webhooks import router as webhook_router
from app.core.config import get_settings
from app.core.database import Base, engine
from app.core.security import rate_limit

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

app.include_router(api_router, prefix="/api", tags=["api"])
app.include_router(webhook_router)


@app.on_event("startup")
def startup() -> None:
    settings = get_settings()
    missing = settings.missing_optional_services
    if missing:
        logger.warning("Optional backend integrations not configured: %s", ", ".join(missing))

    try:
        Base.metadata.create_all(bind=engine)
    except Exception:
        logger.exception("Database initialization failed; API will keep running so /api/health remains available")
