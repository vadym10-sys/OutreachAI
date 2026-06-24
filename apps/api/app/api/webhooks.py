from __future__ import annotations

import stripe
from fastapi import APIRouter, Header, HTTPException, Request
from typing import Optional

from app.core.config import get_settings

router = APIRouter(prefix="/webhooks", tags=["webhooks"])


@router.post("/stripe")
async def stripe_webhook(request: Request, stripe_signature: Optional[str] = Header(default=None)) -> dict:
    settings = get_settings()
    payload = await request.body()
    if settings.stripe_webhook_secret and stripe_signature:
        try:
            event = stripe.Webhook.construct_event(payload, stripe_signature, settings.stripe_webhook_secret)
        except (ValueError, stripe.SignatureVerificationError) as exc:
            raise HTTPException(status_code=400, detail="Invalid Stripe signature") from exc
    else:
        event = {"type": "dev.event"}
    return {"received": True, "type": event["type"]}
