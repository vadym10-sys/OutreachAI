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
from uuid import UUID
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db
from app.models.entities import AppSettings, AuditLog, EmailMessage, Lead, LeadStatus, Subscription, User, Workspace
from app.schemas.dto import PLAN_LIMITS, ReplyAssistantRequest
from app.services.ai import ProviderConfigurationError, ProviderRequestError, suggest_reply
from app.services.billing import plan_from_price_id

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


def _timestamp(value: int | None) -> datetime | None:
    return datetime.utcfromtimestamp(value) if value else None


def _metadata_value(metadata: object, key: str) -> str:
    if isinstance(metadata, dict):
        return str(metadata.get(key) or "")
    return str(getattr(metadata, key, "") or "")


def _subscription_price_id(subscription: object) -> str:
    try:
        return str(subscription["items"]["data"][0]["price"]["id"])
    except (KeyError, IndexError, TypeError):
        return ""


def _user_for_clerk(db: Session, clerk_user_id: str) -> User:
    user = db.scalar(select(User).where(User.clerk_user_id == clerk_user_id))
    if user is None:
        user = User(clerk_user_id=clerk_user_id, email=f"{clerk_user_id}@outreachai.local")
        db.add(user)
        db.flush()
    return user


def _workspace_uuid(workspace_id: str) -> UUID | None:
    try:
        return UUID(workspace_id)
    except (TypeError, ValueError):
        return None


def _settings_for_workspace(db: Session, workspace_id: str) -> AppSettings | None:
    parsed = _workspace_uuid(workspace_id)
    if parsed is None:
        return None
    return db.scalar(select(AppSettings).where(AppSettings.workspace_id == parsed))


def _sync_subscription(
    db: Session,
    *,
    user_id: str,
    workspace_id: str,
    customer_id: str,
    subscription_id: str,
    plan: str,
    status: str,
    trial_end: datetime | None,
    current_period_end: datetime | None,
) -> None:
    parsed_workspace_id = _workspace_uuid(workspace_id)
    if parsed_workspace_id is None or db.get(Workspace, parsed_workspace_id) is None:
        return
    user = _user_for_clerk(db, user_id or f"stripe_customer_{customer_id}")
    subscription = db.scalar(select(Subscription).where(Subscription.stripe_subscription_id == subscription_id))
    if subscription is None:
        subscription = Subscription(user_id=user.id, workspace_id=parsed_workspace_id)
        db.add(subscription)
    subscription.user_id = user.id
    subscription.workspace_id = parsed_workspace_id
    subscription.stripe_customer_id = customer_id
    subscription.stripe_subscription_id = subscription_id
    subscription.plan = plan
    subscription.status = status
    subscription.trial_end = trial_end
    subscription.current_period_end = current_period_end
    subscription.plan_limits = PLAN_LIMITS.get(plan, PLAN_LIMITS["Starter"])

    settings = _settings_for_workspace(db, workspace_id)
    if settings:
        settings.billing = {
            **(settings.billing or {}),
            "plan": plan,
            "status": status,
            "stripeCustomerId": customer_id,
            "stripeSubscriptionId": subscription_id,
            "trialEnd": trial_end.isoformat() if trial_end else None,
            "currentPeriodEnd": current_period_end.isoformat() if current_period_end else None,
            "planLimits": PLAN_LIMITS.get(plan, PLAN_LIMITS["Starter"]),
        }


@router.post("/stripe")
async def stripe_webhook(request: Request, stripe_signature: Optional[str] = Header(default=None), db: Session = Depends(get_db)) -> dict:
    settings = get_settings()
    payload = await request.body()
    if not settings.stripe_webhook_secret:
        raise HTTPException(status_code=503, detail="STRIPE_WEBHOOK_SECRET is required")
    if not stripe_signature:
        raise HTTPException(status_code=400, detail="Missing Stripe signature")
    try:
        event = stripe.Webhook.construct_event(payload, stripe_signature, settings.stripe_webhook_secret)
    except (ValueError, stripe.SignatureVerificationError) as exc:
        raise HTTPException(status_code=400, detail="Invalid Stripe signature") from exc

    stripe.api_key = settings.stripe_secret_key
    event_type = event["type"]
    data = event["data"]["object"]
    if event_type == "checkout.session.completed":
        subscription_id = str(data.get("subscription") or "")
        customer_id = str(data.get("customer") or "")
        plan = _metadata_value(data.get("metadata"), "plan") or "Starter"
        workspace_id = _metadata_value(data.get("metadata"), "workspace_id")
        user_id = _metadata_value(data.get("metadata"), "user_id")
        try:
            subscription = stripe.Subscription.retrieve(subscription_id) if subscription_id and settings.stripe_secret_key else None
        except stripe.StripeError:
            subscription = None
        status = str(subscription.get("status") if subscription else "active")
        trial_end = _timestamp(subscription.get("trial_end") if subscription else None)
        current_period_end = _timestamp(subscription.get("current_period_end") if subscription else None)
        _sync_subscription(db, user_id=user_id, workspace_id=workspace_id, customer_id=customer_id, subscription_id=subscription_id, plan=plan, status=status, trial_end=trial_end, current_period_end=current_period_end)
    elif event_type in {"customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"}:
        subscription_id = str(data.get("id") or "")
        customer_id = str(data.get("customer") or "")
        workspace_id = _metadata_value(data.get("metadata"), "workspace_id")
        user_id = _metadata_value(data.get("metadata"), "user_id")
        price_id = _subscription_price_id(data)
        plan = _metadata_value(data.get("metadata"), "plan") or plan_from_price_id(price_id) or "Starter"
        status = "canceled" if event_type == "customer.subscription.deleted" else str(data.get("status") or "active")
        _sync_subscription(db, user_id=user_id, workspace_id=workspace_id, customer_id=customer_id, subscription_id=subscription_id, plan=plan, status=status, trial_end=_timestamp(data.get("trial_end")), current_period_end=_timestamp(data.get("current_period_end")))
    elif event_type == "invoice.payment_succeeded":
        subscription_id = str(data.get("subscription") or "")
        subscription = db.scalar(select(Subscription).where(Subscription.stripe_subscription_id == subscription_id)) if subscription_id else None
        if subscription:
            subscription.status = "active"
            settings_row = db.scalar(select(AppSettings).where(AppSettings.workspace_id == subscription.workspace_id))
            if settings_row:
                settings_row.billing = {**(settings_row.billing or {}), "status": "active", "plan": subscription.plan}
    elif event_type == "invoice.payment_failed":
        subscription_id = str(data.get("subscription") or "")
        subscription = db.scalar(select(Subscription).where(Subscription.stripe_subscription_id == subscription_id)) if subscription_id else None
        if subscription:
            subscription.status = "past_due"
            settings_row = db.scalar(select(AppSettings).where(AppSettings.workspace_id == subscription.workspace_id))
            if settings_row:
                settings_row.billing = {**(settings_row.billing or {}), "status": "past_due", "plan": subscription.plan}
    db.add(AuditLog(user_id=None, action=f"stripe.{event_type}", metadata_json={"event_id": event.get("id")}))
    db.commit()
    return {"received": True, "type": event["type"]}


def _event_message_id(data: dict) -> str:
    return str(data.get("email_id") or data.get("message_id") or data.get("id") or "")


def _event_reply_body(data: dict) -> str:
    return str(data.get("text") or data.get("html") or data.get("reply") or data.get("message") or "")


def _reply_category(reply_body: str, assistant: dict) -> str:
    text = " ".join([reply_body, str(assistant.get("next_step") or ""), str(assistant.get("suggested_response") or "")]).lower()
    if any(term in text for term in ["meeting", "calendar", "book", "call", "demo"]):
        return "Meeting"
    if any(term in text for term in ["not interested", "unsubscribe", "remove me", "stop"]):
        return "Not interested"
    if any(term in text for term in ["interested", "tell me more", "send", "pricing"]):
        return "Interested"
    return "Needs review"


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
            lead.status = LeadStatus.contacted
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
            lead.status = LeadStatus.interested
        try:
            assistant = suggest_reply(ReplyAssistantRequest(company=lead.company if lead else "", reply_body=reply_body, campaign_offer=""))
            message.reply_assistant = assistant.model_dump()
        except (ProviderConfigurationError, ProviderRequestError):
            message.reply_assistant = {}
        category = _reply_category(reply_body, message.reply_assistant or {})
        if category == "Meeting" and lead:
            lead.status = LeadStatus.meeting
        if category == "Not interested" and lead:
            lead.status = LeadStatus.archive
        inbound_exists = db.scalar(
            select(EmailMessage.id).where(
                EmailMessage.provider_message_id == f"reply:{message_id}",
                EmailMessage.direction == "inbound",
            )
        )
        if inbound_exists is None:
            db.add(
                EmailMessage(
                    user_id=message.user_id,
                    workspace_id=message.workspace_id,
                    campaign_id=message.campaign_id,
                    lead_id=message.lead_id,
                    direction="inbound",
                    subject=f"Re: {message.subject}",
                    preview=reply_body[:240],
                    body=reply_body,
                    provider_message_id=f"reply:{message_id}",
                    delivery_status="received",
                    reply_assistant=message.reply_assistant or {},
                    tags={"category": category, "auto_archive": category == "Not interested"},
                )
            )
    else:
        return {"received": True, "matched": True, "type": event_type, "ignored": True}
    db.add(AuditLog(user_id=message.user_id, workspace_id=message.workspace_id, action=f"resend.{event_type}", ip_address=request.client.host if request.client else None, metadata_json={"email_id": str(message.id), "provider_message_id": message.provider_message_id}))
    db.commit()
    return {"received": True, "matched": True, "type": event_type}
