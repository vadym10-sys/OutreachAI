from __future__ import annotations

import stripe
import base64
import hashlib
import hmac
import json
import logging
import time
from datetime import datetime
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from typing import Any, Optional
from uuid import UUID
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db
from app.core.observability import capture_provider_exception
from app.models.entities import AppSettings, AuditLog, Company, Deal, EmailMessage, Lead, LeadStatus, Subscription, User, Workspace
from app.schemas.dto import PLAN_LIMITS, ReplyAssistantRequest
from app.services.ai import ProviderConfigurationError, ProviderRequestError, suggest_reply
from app.services.billing import plan_from_price_id, subscription_payload, subscription_price_id, timestamp_to_datetime

router = APIRouter(prefix="/webhooks", tags=["webhooks"])
logger = logging.getLogger("outreachai.stripe")
PAID_SUBSCRIPTION_STATUSES = {"active", "trialing"}


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


def _metadata_value(metadata: object, key: str) -> str:
    if isinstance(metadata, dict):
        return str(metadata.get(key) or "")
    return str(getattr(metadata, key, "") or "")


def _stripe_get(obj: object, key: str, default: object = None) -> object:
    if isinstance(obj, dict):
        return obj.get(key, default)
    getter = getattr(obj, "get", None)
    if callable(getter):
        return getter(key, default)
    return getattr(obj, key, default)


def _stripe_id(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    return str(_stripe_get(value, "id", "") or "")


def _safe_text(value: object, *, max_length: int = 500) -> str:
    text = str(value or "").strip()
    return text[:max_length]


def _billing_clear_failure(billing: dict[str, Any]) -> dict[str, Any]:
    cleaned = dict(billing or {})
    for key in (
        "lastPaymentError",
        "lastDeclineCode",
        "lastFailureMessage",
        "lastPaymentFailedAt",
        "lastFailedInvoiceId",
        "lastFailedPaymentIntentId",
    ):
        cleaned.pop(key, None)
    return cleaned


def _billing_with_failure(billing: dict[str, Any], failure: dict[str, str]) -> dict[str, Any]:
    return {
        **dict(billing or {}),
        "lastPaymentError": failure.get("last_payment_error") or "",
        "lastDeclineCode": failure.get("decline_code") or "",
        "lastFailureMessage": failure.get("failure_message") or "",
        "lastPaymentFailedAt": failure.get("failed_at") or datetime.utcnow().isoformat(),
        "lastFailedInvoiceId": failure.get("invoice_id") or "",
        "lastFailedPaymentIntentId": failure.get("payment_intent_id") or "",
    }


def _payment_failure_details(invoice: object, payment_intent: object | None = None) -> dict[str, str]:
    last_payment_error = _stripe_get(invoice, "last_payment_error") or _stripe_get(payment_intent or {}, "last_payment_error") or {}
    charge = _stripe_get(invoice, "charge") or _stripe_get(payment_intent or {}, "latest_charge")
    failure_message = (
        _stripe_get(last_payment_error, "message")
        or _stripe_get(invoice, "failure_message")
        or _stripe_get(charge or {}, "failure_message")
        or "Payment was declined. Please update the payment method and try again."
    )
    decline_code = (
        _stripe_get(last_payment_error, "decline_code")
        or _stripe_get(charge or {}, "failure_code")
        or _stripe_get(invoice, "failure_code")
        or ""
    )
    error_type = _stripe_get(last_payment_error, "type") or _stripe_get(invoice, "status") or "payment_failed"
    return {
        "last_payment_error": _safe_text(error_type, max_length=500),
        "decline_code": _safe_text(decline_code, max_length=120),
        "failure_message": _safe_text(failure_message, max_length=1000),
        "invoice_id": _stripe_id(_stripe_get(invoice, "id")),
        "payment_intent_id": _stripe_id(_stripe_get(invoice, "payment_intent") or payment_intent),
        "failed_at": datetime.utcnow().isoformat(),
    }


def _stripe_event_metadata(event: object, data: object, *, workspace_id: str = "") -> dict[str, Any]:
    event_type = str(_stripe_get(event, "type", "") or "")
    payment_intent = _stripe_get(data, "payment_intent")
    return {
        "event_id": str(_stripe_get(event, "id", "") or ""),
        "event_type": event_type,
        "object_id": _stripe_id(_stripe_get(data, "id")),
        "customer_id": _stripe_id(_stripe_get(data, "customer")),
        "subscription_id": _stripe_id(_stripe_get(data, "subscription")),
        "payment_intent_id": _stripe_id(payment_intent),
        "invoice_id": _stripe_id(_stripe_get(data, "invoice")),
        "status": str(_stripe_get(data, "status", "") or ""),
        "workspace_id": workspace_id,
    }


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


def _settings_for_workspace(db: Session, workspace_id: str, user_id: str = "") -> AppSettings | None:
    parsed = _workspace_uuid(workspace_id)
    if parsed is None:
        return None
    settings = db.scalar(select(AppSettings).where(AppSettings.workspace_id == parsed))
    if settings is not None:
        return settings
    if not user_id:
        return None
    settings = db.scalar(select(AppSettings).where(AppSettings.user_id == user_id))
    if settings is not None:
        settings.workspace_id = parsed
        return settings
    settings = AppSettings(user_id=user_id, workspace_id=parsed, general={}, ai={}, email={}, billing={}, security={}, api={})
    db.add(settings)
    db.flush()
    return settings


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
    price_id: str = "",
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
    if status in PAID_SUBSCRIPTION_STATUSES:
        subscription.last_payment_error = None
        subscription.last_decline_code = None
        subscription.last_failure_message = None
        subscription.last_payment_failed_at = None

    settings = _settings_for_workspace(db, workspace_id, user_id=user_id)
    if settings:
        billing = dict(settings.billing or {})
        if status in PAID_SUBSCRIPTION_STATUSES:
            billing = _billing_clear_failure(billing)
        settings.billing = {
            **billing,
            "plan": plan,
            "status": status,
            "stripeCustomerId": customer_id,
            "stripeSubscriptionId": subscription_id,
            "trialEnd": trial_end.isoformat() if trial_end else None,
            "currentPeriodEnd": current_period_end.isoformat() if current_period_end else None,
            "stripePriceId": price_id,
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
    event_workspace_id = _metadata_value(_stripe_get(data, "metadata", {}), "workspace_id")
    logger.info("Stripe webhook received", extra=_stripe_event_metadata(event, data, workspace_id=event_workspace_id))
    if event_type == "checkout.session.completed":
        subscription_id = str(data.get("subscription") or "")
        customer_id = str(data.get("customer") or "")
        plan = _metadata_value(data.get("metadata"), "plan") or "Starter"
        workspace_id = _metadata_value(data.get("metadata"), "workspace_id")
        user_id = _metadata_value(data.get("metadata"), "user_id")
        try:
            subscription = stripe.Subscription.retrieve(subscription_id) if subscription_id and settings.stripe_secret_key else None
        except stripe.StripeError as exc:
            capture_provider_exception(exc, provider="stripe", endpoint="stripe.subscription.retrieve", workspace_id=workspace_id)
            subscription = None
        payload = subscription_payload(subscription) if subscription else {}
        status = str(payload.get("status") or "active")
        trial_end = payload.get("trial_end") if subscription else None
        current_period_end = payload.get("current_period_end") if subscription else None
        price_id = str(payload.get("price_id") or "")
        resolved_plan = str(payload.get("plan") or plan)
        _sync_subscription(db, user_id=user_id, workspace_id=workspace_id, customer_id=customer_id, subscription_id=subscription_id, plan=resolved_plan, status=status, trial_end=trial_end, current_period_end=current_period_end, price_id=price_id)
    elif event_type in {"customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"}:
        subscription_id = str(data.get("id") or "")
        customer_id = str(data.get("customer") or "")
        workspace_id = _metadata_value(data.get("metadata"), "workspace_id")
        user_id = _metadata_value(data.get("metadata"), "user_id")
        price_id = subscription_price_id(data)
        plan = _metadata_value(data.get("metadata"), "plan") or plan_from_price_id(price_id) or "Starter"
        status = "canceled" if event_type == "customer.subscription.deleted" else str(data.get("status") or "active")
        _sync_subscription(db, user_id=user_id, workspace_id=workspace_id, customer_id=customer_id, subscription_id=subscription_id, plan=plan, status=status, trial_end=timestamp_to_datetime(data.get("trial_end")), current_period_end=timestamp_to_datetime(data.get("current_period_end")), price_id=price_id)
    elif event_type in {"invoice.paid", "invoice.payment_succeeded"}:
        subscription_id = str(data.get("subscription") or "")
        subscription = db.scalar(select(Subscription).where(Subscription.stripe_subscription_id == subscription_id)) if subscription_id else None
        if subscription:
            subscription.status = "active"
            subscription.last_payment_error = None
            subscription.last_decline_code = None
            subscription.last_failure_message = None
            subscription.last_payment_failed_at = None
            settings_row = db.scalar(select(AppSettings).where(AppSettings.workspace_id == subscription.workspace_id))
            if settings_row:
                settings_row.billing = {**_billing_clear_failure(settings_row.billing or {}), "status": "active", "plan": subscription.plan}
    elif event_type == "invoice.payment_failed":
        subscription_id = str(data.get("subscription") or "")
        subscription = db.scalar(select(Subscription).where(Subscription.stripe_subscription_id == subscription_id)) if subscription_id else None
        if subscription:
            raw_payment_intent = _stripe_get(data, "payment_intent")
            payment_intent: object | None = raw_payment_intent if raw_payment_intent and not isinstance(raw_payment_intent, str) else None
            payment_intent_id = _stripe_id(raw_payment_intent)
            if payment_intent is None and payment_intent_id and settings.stripe_secret_key:
                try:
                    payment_intent = stripe.PaymentIntent.retrieve(payment_intent_id)
                except stripe.StripeError as exc:
                    capture_provider_exception(exc, provider="stripe", endpoint="stripe.payment_intent.retrieve", workspace_id=str(subscription.workspace_id))
            failure = _payment_failure_details(data, payment_intent)
            subscription.status = "past_due"
            subscription.last_payment_error = failure["last_payment_error"]
            subscription.last_decline_code = failure["decline_code"]
            subscription.last_failure_message = failure["failure_message"]
            subscription.last_payment_failed_at = datetime.utcnow()
            settings_row = db.scalar(select(AppSettings).where(AppSettings.workspace_id == subscription.workspace_id))
            if settings_row:
                settings_row.billing = {**_billing_with_failure(settings_row.billing or {}, failure), "status": "past_due", "plan": subscription.plan}
            logger.warning("Stripe payment failed", extra={**_stripe_event_metadata(event, data, workspace_id=str(subscription.workspace_id)), "decline_code": failure["decline_code"]})
    elif event_type.startswith("payment_intent."):
        invoice_id = _stripe_id(_stripe_get(data, "invoice"))
        customer_id = _stripe_id(_stripe_get(data, "customer"))
        if event_type == "payment_intent.payment_failed":
            subscription = db.scalar(select(Subscription).where(Subscription.stripe_customer_id == customer_id).order_by(Subscription.current_period_end.desc().nullslast())) if customer_id else None
            if subscription:
                failure = _payment_failure_details({"id": invoice_id, "payment_intent": data, "status": _stripe_get(data, "status")}, data)
                subscription.last_payment_error = failure["last_payment_error"]
                subscription.last_decline_code = failure["decline_code"]
                subscription.last_failure_message = failure["failure_message"]
                subscription.last_payment_failed_at = datetime.utcnow()
                settings_row = db.scalar(select(AppSettings).where(AppSettings.workspace_id == subscription.workspace_id))
                if settings_row:
                    settings_row.billing = {**_billing_with_failure(settings_row.billing or {}, failure), "status": subscription.status, "plan": subscription.plan}
        logger.info("Stripe payment intent event processed", extra=_stripe_event_metadata(event, data, workspace_id=str(subscription.workspace_id) if "subscription" in locals() and subscription else event_workspace_id))
    audit_metadata = _stripe_event_metadata(event, data, workspace_id=event_workspace_id)
    db.add(AuditLog(user_id=None, action=f"stripe.{event_type}", metadata_json=audit_metadata))
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


def _sync_crm_email_status(db: Session, message: EmailMessage, stage: str, email_status: str) -> None:
    if not message.lead_id:
        return
    company = db.scalar(select(Company).where(Company.lead_id == message.lead_id).order_by(Company.updated_at.desc()))
    if company is None:
        return
    company.email_status = email_status
    company.crm_stage = stage
    company.updated_at = datetime.utcnow()
    deal = db.scalar(select(Deal).where(Deal.lead_id == message.lead_id).order_by(Deal.updated_at.desc()))
    if deal:
        deal.stage = stage
        deal.next_step = "Reply received. Review and book the next step." if stage == "Replied" else deal.next_step
        deal.updated_at = datetime.utcnow()


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
        _sync_crm_email_status(db, message, "Sent", "Delivered")
    elif event_type == "email.opened":
        message.opened_at = message.opened_at or now
        message.delivery_status = "opened"
        _sync_crm_email_status(db, message, "Sent", "Opened")
        lead = db.get(Lead, message.lead_id) if message.lead_id else None
        if lead:
            lead.status = LeadStatus.contacted
    elif event_type == "email.bounced":
        message.bounced_at = message.bounced_at or now
        message.delivery_status = "bounced"
        _sync_crm_email_status(db, message, "Sent", "Bounced")
    elif event_type == "email.complained":
        message.delivery_status = "complained"
        _sync_crm_email_status(db, message, "Sent", "Complained")
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
            _sync_crm_email_status(db, message, "Meeting Scheduled", "Replied")
        if category == "Not interested" and lead:
            lead.status = LeadStatus.archive
            _sync_crm_email_status(db, message, "Lost", "Replied")
        if category not in {"Meeting", "Not interested"}:
            _sync_crm_email_status(db, message, "Replied", "Replied")
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
