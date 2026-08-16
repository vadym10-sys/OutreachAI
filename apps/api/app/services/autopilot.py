from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.entities import (
    AppSettings,
    AuditLog,
    Campaign,
    CampaignStatus,
    EmailMessage,
    EnrichmentJob,
    Lead,
    LeadStatus,
    Workspace,
)
from app.services.agent_runtime.action_gateway import ActionPolicyGateway
from app.services.agent_runtime.errors import AgentRuntimeError
from app.services.entitlements import BillingEntitlement, resolve_billing_entitlement
from app.services.enrichment_queue import (
    complete_job,
    mark_cancelled,
    update_job_progress,
)
from app.services.secret_box import decrypt_secret

logger = logging.getLogger("outreachai.autopilot")
PRODUCTION_SMOKE_TEST_SOURCE = "production_smoke_test"
_action_policy_gateway = ActionPolicyGateway()


class AutopilotDeferred(RuntimeError):
    def __init__(self, message: str, *, delay_seconds: int = 900) -> None:
        super().__init__(message)
        self.delay_seconds = delay_seconds


def _metadata(lead: Lead | None) -> dict[str, Any]:
    if not lead or not lead.notes:
        return {}
    try:
        data = __import__("json").loads(lead.notes)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _email_tags(email: EmailMessage | None) -> dict[str, Any]:
    return email.tags if email and isinstance(email.tags, dict) else {}


def _email_approval_version(email: EmailMessage) -> int:
    version = int(_email_tags(email).get("approval_version") or 0)
    return max(1, version)


def _settings_for_workspace(
    db: Session, user_id: str, workspace_id
) -> AppSettings | None:  # type: ignore[no-untyped-def]
    return db.scalar(
        select(AppSettings).where(
            AppSettings.user_id == user_id, AppSettings.workspace_id == workspace_id
        )
    )


def _sender(settings: AppSettings | None) -> dict[str, Any]:
    email_settings = (
        settings.email if settings and isinstance(settings.email, dict) else {}
    )
    sender = (
        email_settings.get("sender")
        if isinstance(email_settings.get("sender"), dict)
        else {}
    )
    return sender if isinstance(sender, dict) else {}


def _suppression(settings: AppSettings | None) -> dict[str, set[str]]:
    email_settings = (
        settings.email if settings and isinstance(settings.email, dict) else {}
    )
    raw = (
        email_settings.get("suppression")
        if isinstance(email_settings.get("suppression"), dict)
        else {}
    )
    return {
        "emails": {
            str(item).strip().lower()
            for item in raw.get("emails", [])
            if str(item).strip()
        },
        "domains": {
            str(item).strip().lower()
            for item in raw.get("domains", [])
            if str(item).strip()
        },
        "bounced": {
            str(item).strip().lower()
            for item in raw.get("bounced", [])
            if str(item).strip()
        },
        "unsubscribed": {
            str(item).strip().lower()
            for item in raw.get("unsubscribed", [])
            if str(item).strip()
        },
    }


def _sender_runtime_config(
    settings: AppSettings | None,
) -> tuple[dict[str, Any], dict[str, Any] | None]:
    app_settings = get_settings()
    sender = _sender(settings)
    provider = str(sender.get("provider") or "").strip().lower()
    if provider != "gmail":
        raise RuntimeError("Connect Gmail before running Autopilot.")
    oauth = sender.get("oauth") if isinstance(sender.get("oauth"), dict) else {}
    encrypted = str(oauth.get("refresh_token_encrypted") or "").strip()
    if not encrypted or not oauth.get("verified_at"):
        raise RuntimeError("Gmail OAuth sender is not verified.")
    refresh_token = decrypt_secret(encrypted, app_settings.encryption_key)
    sender_email = str(sender.get("sender_email") or "").strip().lower()
    if not sender_email:
        raise RuntimeError("Gmail sender email is missing.")
    return (
        {
            "provider": "gmail",
            "sender_name": str(sender.get("sender_name") or "").strip(),
            "sender_email": sender_email,
            "reply_to": str(sender.get("reply_to") or sender_email).strip().lower(),
            "daily_send_limit": max(
                1, min(int(sender.get("daily_send_limit") or 25), 200)
            ),
        },
        {
            "refresh_token": refresh_token,
            "client_id": app_settings.google_oauth_client_id,
            "client_secret": app_settings.google_oauth_client_secret,
        },
    )


def _sent_today(db: Session, workspace_id, campaign_id) -> int:  # type: ignore[no-untyped-def]
    today = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    return int(
        db.scalar(
            select(func.count())
            .select_from(EmailMessage)
            .where(
                EmailMessage.workspace_id == workspace_id,
                EmailMessage.campaign_id == campaign_id,
                EmailMessage.sent_at >= today,
            )
        )
        or 0
    )


def _billing_entitlement_for_job(
    db: Session, job: EnrichmentJob
) -> BillingEntitlement | None:
    workspace = db.get(Workspace, job.workspace_id)
    return (
        resolve_billing_entitlement(db, job.user_id, workspace) if workspace else None
    )


def _within_working_hours(campaign: Campaign) -> bool:
    try:
        now = datetime.now(ZoneInfo(campaign.timezone or "UTC"))
    except Exception:
        now = datetime.utcnow()
    return 8 <= now.hour < 18 and now.weekday() < 5


def _mark_requires_review(
    db: Session,
    job: EnrichmentJob,
    lead: Lead | None,
    email: EmailMessage | None,
    reason: str,
    claim_token: str | None,
) -> bool:
    if lead:
        lead.status = LeadStatus.qualified
        lead.notes = __import__("json").dumps(
            {
                **_metadata(lead),
                "autopilot_status": "requires_review",
                "autopilot_reason": reason,
                "email_status": "Requires review",
            }
        )
    already_requires_review = False
    if email:
        current_tags = email.tags if isinstance(email.tags, dict) else {}
        already_requires_review = (
            email.delivery_status == "needs_review"
            and bool(current_tags.get("autopilot_blocked_reason"))
        )
        email.delivery_status = "needs_review"
        email.tags = {
            **current_tags,
            "autopilot_blocked_reason": reason,
        }
    if not already_requires_review:
        db.add(
            AuditLog(
                user_id=job.user_id,
                workspace_id=job.workspace_id,
                action="autopilot.requires_review",
                metadata_json={
                    "job_id": str(job.id),
                    "lead_id": str(job.lead_id),
                    "reason": reason,
                },
            )
        )
    db.commit()
    return complete_job(
        db, job, partial=True, warnings=[reason], claim_token=claim_token
    )


def _recipient_safe(
    db: Session,
    job: EnrichmentJob,
    lead: Lead,
    email: EmailMessage,
    settings: AppSettings | None,
) -> str:
    metadata = _metadata(lead)
    if (
        metadata.get("source") == PRODUCTION_SMOKE_TEST_SOURCE
        and metadata.get("is_test") is True
    ):
        return "Production smoke-test leads are excluded from sales automation."
    email_tags = email.tags if isinstance(email.tags, dict) else {}
    if (
        email_tags.get("source") == PRODUCTION_SMOKE_TEST_SOURCE
        and email_tags.get("is_test") is True
    ):
        return "Production smoke-test drafts are excluded from sales automation."
    recipient = (lead.email or "").strip().lower()
    if not recipient or "@" not in recipient:
        return "No confirmed public business email is available."
    domain = recipient.rsplit("@", 1)[1]
    suppress = _suppression(settings)
    if (
        recipient in suppress["emails"]
        or recipient in suppress["bounced"]
        or recipient in suppress["unsubscribed"]
        or domain in suppress["domains"]
    ):
        return "Recipient is suppressed, bounced, unsubscribed, or blocked."
    if db.scalar(
        select(func.count())
        .select_from(EmailMessage)
        .where(
            EmailMessage.workspace_id == job.workspace_id,
            EmailMessage.lead_id == lead.id,
            EmailMessage.delivery_status == "sent",
            EmailMessage.id != email.id,
        )
    ):
        return "This company or contact was already processed."
    confidence = int(
        metadata.get("confidence_score")
        or metadata.get("decision_maker_confidence_score")
        or 0
    )
    source = str(
        metadata.get("source_url")
        or metadata.get("google_maps_url")
        or metadata.get("public_source")
        or ""
    ).strip()
    if confidence and confidence < 60:
        return "Contact confidence is too low for autonomous sending."
    if not source and not lead.website:
        return "No public source is attached to this lead."
    app_settings = get_settings()
    if app_settings.autopilot_test_mode:
        allowed_domain = app_settings.autopilot_safe_recipient_domain.strip().lower()
        if not allowed_domain or domain != allowed_domain:
            return "Staging test mode blocks real-company recipients."
    return ""


def process_autopilot_email_job(
    db: Session, job: EnrichmentJob, *, claim_token: str | None = None
) -> bool:
    payload = job.payload_json if isinstance(job.payload_json, dict) else {}
    campaign_id = UUID(str(payload.get("campaign_id")))
    email_id = UUID(str(payload.get("email_id")))
    campaign = db.scalar(
        select(Campaign).where(
            Campaign.id == campaign_id,
            Campaign.workspace_id == job.workspace_id,
        )
    )
    lead = db.scalar(
        select(Lead).where(
            Lead.id == job.lead_id,
            Lead.workspace_id == job.workspace_id,
        )
    )
    email = db.scalar(
        select(EmailMessage).where(
            EmailMessage.id == email_id,
            EmailMessage.workspace_id == job.workspace_id,
        )
    )
    settings = _settings_for_workspace(db, job.user_id, job.workspace_id)
    if campaign is None or email is None or lead is None:
        return mark_cancelled(
            db,
            job,
            message="Autopilot target no longer exists.",
            claim_token=claim_token,
        )
    if campaign.status == CampaignStatus.stopped:
        return mark_cancelled(
            db, job, message="Campaign was stopped.", claim_token=claim_token
        )
    if campaign.status == CampaignStatus.paused:
        job.status = "pending"
        job.locked_by = ""
        job.locked_at = None
        job.run_after = datetime.utcnow() + timedelta(minutes=15)
        job.progress_json = {
            **(job.progress_json or {}),
            "stage": "paused",
            "message": "Campaign is paused.",
            "percent": 10,
        }
        db.commit()
        return True
    if campaign.status != CampaignStatus.running:
        raise AutopilotDeferred("Campaign is not running yet.", delay_seconds=900)
    if not _within_working_hours(campaign):
        raise AutopilotDeferred("Outside campaign working hours.", delay_seconds=1800)
    update_job_progress(
        db,
        job,
        stage="checking",
        message="Checking suppression, duplicate and confidence rules.",
        percent=30,
        claim_token=claim_token,
    )
    block_reason = _recipient_safe(db, job, lead, email, settings)
    if block_reason:
        return _mark_requires_review(db, job, lead, email, block_reason, claim_token)
    sender, _oauth_config = _sender_runtime_config(settings)
    if _sent_today(db, job.workspace_id, campaign.id) >= int(
        sender["daily_send_limit"] or 25
    ):
        raise AutopilotDeferred(
            "Daily campaign send limit reached.", delay_seconds=3600
        )
    entitlement = _billing_entitlement_for_job(db, job)
    if get_settings().app_env == "production" and (
        entitlement is None or not entitlement.active
    ):
        raise AutopilotDeferred("Active subscription required.", delay_seconds=3600)
    workspace = db.get(Workspace, job.workspace_id)
    if workspace is None:
        return mark_cancelled(
            db, job, message="Workspace no longer exists.", claim_token=claim_token
        )
    if email.delivery_status == "sent":
        return complete_job(db, job, partial=False, claim_token=claim_token)
    update_job_progress(
        db,
        job,
        stage="policy_check",
        message="Checking manual approval and Send confirmation.",
        percent=70,
        claim_token=claim_token,
    )
    try:
        _action_policy_gateway.enforce(
            db,
            workspace=workspace,
            actor_type="worker",
            actor_id=job.user_id,
            action_name="autonomous.email.send",
            input_payload={
                "route": "autopilot.worker",
                "job_id": str(job.id),
                "campaign_id": str(campaign.id),
                "lead_id": str(lead.id),
                "email_id": str(email.id),
                "recipient_email": lead.email or "",
                "subject": email.subject,
                "body": email.body,
            },
            idempotency_key=(
                f"autopilot-email-send:{workspace.id}:"
                f"{email.id}:v{_email_approval_version(email)}"
            ),
            resource_workspace_id=email.workspace_id,
            resource_id=email.id,
        )
    except AgentRuntimeError as exc:
        return _mark_requires_review(db, job, lead, email, str(exc), claim_token)
    return _mark_requires_review(
        db,
        job,
        lead,
        email,
        "Autopilot provider sending is disabled until a human sends the draft.",
        claim_token,
    )
