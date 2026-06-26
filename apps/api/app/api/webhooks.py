from __future__ import annotations

import stripe
import base64
import hashlib
import hmac
import json
import time
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


def _verify_resend_signature(payload: bytes, request: Request, secret: str) -> None:
    svix_id = request.headers.get("svix-id")
    svix_timestamp = request.headers.get("svix-timestamp")
    svix_signature = request.headers.get("svix-signature")
    if not svix_id or not svix_timestamp or not svix_signature:
        raise HTTPException(status_code=400, detail="Missing Resend webhook signature headers")

    try:
        timestamp = int(svix_timestamp)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid Resend webhook timestamp") from exc
    if abs(time.time() - timestamp) > 300:
        raise HTTPException(status_code=400, detail="Expired Resend webhook timestamp")

    raw_secret = secret.removeprefix("whsec_")
    try:
        secret_bytes = base64.b64decode(raw_secret)
    except Exception:
        secret_bytes = secret.encode()
    signed = f"{svix_id}.{svix_timestamp}.".encode() + payload
    expected = base64.b64encode(hmac.new(secret_bytes, signed, hashlib.sha256).digest()).decode()

    signatures = [part.strip() for part in svix_signature.split(" ") if part.strip()]
    for signature in signatures:
        candidate = signature.split(",", 1)[1] if signature.startswith("v1,") else signature
        if hmac.compare_digest(candidate, expected):
            return
    raise HTTPException(status_code=400, detail="Invalid Resend webhook signature")


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


def _event_message_id(data: dict) -> str:
    return str(data.get("email_id") or data.get("message_id") or data.get("id") or "")


def _event_reply_body(data: dict) -> str:
    return str(data.get("text") or data.get("html") or data.get("reply") or data.get("message") or "")


@router.post("/resend")
async def resend_webhook(request: Request, db: Session = Depends(get_db)) -> dict:
    settings = get_settings()
    raw_payload = await request.body()
    if settings.resend_webhook_secret:
        _verify_resend_signature(raw_payload, request, settings.resend_webhook_secret)
    try:
        payload = json.loads(raw_payload.decode() or "{}")
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="Invalid Resend webhook JSON") from exc
    event_type = str(payload.get("type") or payload.get("event") or "")
    data = payload.get("data") or {}
    if not isinstance(data, dict):
        raise HTTPException(status_code=400, detail="Invalid Resend webhook data")
    message_id = _event_message_id(data)
    if not message_id:
        return {"received": True, "matched": False}

    message = db.scalar(select(EmailMessage).where(EmailMessage.provider_message_id == message_id))
    if message is None:
        return {"received": True, "matched": False}

    now = datetime.utcnow()
    if event_type == "email.delivered":
        message.delivered_at = message.delivered_at or now
        message.delivery_status = "delivered"
    elif event_type == "email.opened":
        message.opened_at = message.opened_at or now
        message.delivery_status = "opened"
        lead = db.get(Lead, message.lead_id) if message.lead_id else None
        if lead:
            lead.status = LeadStatus.opened
    elif event_type == "email.bounced":
        message.bounced_at = message.bounced_at or now
        message.delivery_status = "bounced"
    elif event_type == "email.complained":
        message.delivery_status = "complained"
    elif event_type in {"email.replied", "email.received"}:
        reply_body = _event_reply_body(data)
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
    else:
        return {"received": True, "matched": True, "type": event_type, "ignored": True}
    db.commit()
    return {"received": True, "matched": True, "type": event_type}
