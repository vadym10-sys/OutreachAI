from __future__ import annotations

import stripe
from datetime import datetime
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from typing import Optional
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db
from app.models.entities import EmailMessage, Lead, LeadStatus
from app.schemas.dto import ReplyAssistantRequest
from app.services.ai import ProviderConfigurationError, ProviderRequestError, suggest_reply

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


@router.post("/resend")
async def resend_webhook(request: Request, db: Session = Depends(get_db)) -> dict:
    payload = await request.json()
    event_type = str(payload.get("type") or payload.get("event") or "")
    data = payload.get("data") or {}
    message_id = str(data.get("email_id") or data.get("id") or data.get("message_id") or "")
    if not message_id:
        return {"received": True, "matched": False}

    message = db.scalar(select(EmailMessage).where(EmailMessage.provider_message_id == message_id))
    if message is None:
        return {"received": True, "matched": False}

    now = datetime.utcnow()
    normalized = event_type.lower()
    if "delivered" in normalized:
        message.delivered_at = message.delivered_at or now
        message.delivery_status = "delivered"
    elif "opened" in normalized or "open" in normalized:
        message.opened_at = message.opened_at or now
        message.delivery_status = "opened"
        lead = db.get(Lead, message.lead_id) if message.lead_id else None
        if lead:
            lead.status = LeadStatus.opened
    elif "bounced" in normalized or "bounce" in normalized:
        message.bounced_at = message.bounced_at or now
        message.delivery_status = "bounced"
    elif "complained" in normalized:
        message.delivery_status = "complained"
    elif "reply" in normalized or "inbound" in normalized:
        reply_body = str(data.get("text") or data.get("html") or data.get("reply") or "")
        message.replied_at = message.replied_at or now
        message.reply_body = reply_body
        message.delivery_status = "replied"
        lead = db.get(Lead, message.lead_id) if message.lead_id else None
        if lead:
            lead.status = LeadStatus.replied
        try:
            assistant = suggest_reply(ReplyAssistantRequest(company=lead.company if lead else "", reply_body=reply_body, campaign_offer=""))
            message.reply_assistant = assistant.model_dump()
        except (ProviderConfigurationError, ProviderRequestError):
            message.reply_assistant = {}
    db.commit()
    return {"received": True, "matched": True, "type": event_type}
