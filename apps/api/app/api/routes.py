from __future__ import annotations

import csv
import concurrent.futures
import io
import json
import logging
import time
from datetime import datetime, timedelta
from email.utils import parseaddr
from typing import Any, Optional
from uuid import UUID
from uuid import uuid4

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy import and_, asc, desc, func, or_, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.core.cache import cache_key, get_json, set_json
from app.core.database import get_db
from app.core.config import get_settings as get_app_settings
from app.core.observability import capture_provider_exception, set_lead_context, set_workspace_context
from app.core.security import CurrentUser, CurrentUserContext, OwnerUser, WorkspaceUserContext
from app.models.entities import (
    AISalesEmployee,
    AICEOBriefing,
    AppSettings,
    AuditLog,
    BackupRun,
    Campaign,
    CampaignSequence,
    CampaignStatus,
    Company,
    Contact,
    Deal,
    EmailMessage,
    Lead,
    LeadStatus,
    Note,
    Notification,
    NotificationKind,
    QualityCheckRun,
    QualityIssue,
    QualityRepairTask,
    SalesEmployeeLeadInsight,
    SalesEmployeeMode,
    SalesEmployeeTaskResult,
    Subscription,
    UsageCounter,
    User,
    Workspace,
    WorkspaceMember,
    WebsiteAnalysis,
    WorkspaceRole,
    WorkspaceProfile,
)
from app.schemas.dto import (
    ActivityOut,
    AICEOAnswerOut,
    AICEOBriefingOut,
    AICEOBriefingRequest,
    AICEOQuestionIn,
    AISalesEmployeeCreate,
    AISalesEmployeeOut,
    AISalesEmployeeUpdate,
    AdminSummaryOut,
    AnalysisOut,
    AnalyzeRequest,
    ApolloConnectionTestOut,
    ApolloIntegrationStatusOut,
    AutomationRunOut,
    BulkLeadAction,
    BillingPlanOut,
    BillingDiagnosticsOut,
    BillingPortalRequest,
    BillingStatusOut,
    BillingSyncOut,
    BillingSyncRequest,
    CampaignCreate,
    CampaignAnalyticsOut,
    CampaignOut,
    CampaignSequenceIn,
    CampaignUpdate,
    CheckoutRequest,
    CrmCompanyOut,
    CrmContactOut,
    CrmDealOut,
    CrmNoteCreate,
    CrmNoteOut,
    CrmPipelineOut,
    CrmStageUpdate,
    CRM_STAGES,
    DashboardMetrics,
    EmailOut,
    EmailUpdate,
    EmailVariantOut,
    FollowUpSequenceOut,
    GenerateEmailRequest,
    GoogleMapsImport,
    GrowthBriefingOut,
    GrowthEngineOut,
    GrowthGoalIn,
    GrowthGoalOut,
    HunterConnectionTestOut,
    HunterIntegrationStatusOut,
    IntegrationStatusOut,
    LeadCreate,
    LeadFinderRequest,
    LeadOut,
    LeadUpdate,
    MeetingPrepOut,
    MemberInvite,
    NotificationOut,
    OnboardingUpdate,
    OutreachSenderStatusOut,
    OutreachSenderUpdate,
    OwnerConsoleOut,
    OwnerFeatureFlagsOut,
    OwnerFeatureFlagsUpdate,
    PaginatedLeads,
    PersonalizeRequest,
    PLAN_LIMITS,
    ProfileOut,
    ProfileUpdate,
    QualityCheckOut,
    QualityDashboardOut,
    QualityRepairTaskCreate,
    QualityRepairTaskOut,
    ReplyAssistantOut,
    ReplyAssistantRequest,
    RewriteEmailRequest,
    SalesCopilotOut,
    SalesEmployeeLeadImport,
    SalesEmployeeLeadInsightOut,
    SalesEmployeeMemoryOut,
    SalesEmployeePerformanceOut,
    SalesEmployeeRunOut,
    SalesEmployeeTaskDecision,
    SalesEmployeeTaskActionOut,
    SalesEmployeeTaskPlanOut,
    SalesEmployeeTaskRequest,
    SalesEmployeeTaskResultOut,
    SettingsOut,
    SettingsUpdate,
    TeamEmployeeDashboardOut,
    TeamRouterDashboardOut,
    TeamRouterDecision,
    TeamRouterPlanOut,
    TeamRouterRequest,
    UsageOut,
    WebsiteAuditOut,
    WebsiteListImport,
    WorkspaceMemberOut,
    WorkspaceOut,
    WorkspaceUpdate,
)
from app.services.acquisition import run_daily_acquisition
from app.services.ai import (
    ProviderConfigurationError,
    ProviderRequestError,
    analyze_company_website,
    adaptive_follow_ups,
    campaign_analytics,
    meeting_preparation,
    personalize_email,
    qualify_for_sales_employee,
    plan_sales_employee_task,
    route_ai_team_task,
    rewrite_email,
    sales_copilot,
    stream_email_generation,
    suggest_reply,
    website_audit,
)
from app.services.continuous_learning import apply_continuous_learning_event
from app.services.workflow_engine import build_company_workflow_engine
from app.services.audit import log_event
from app.services.backups import backup_summary, run_database_backup
from app.services.billing import create_billing_portal_session, create_checkout_session, ensure_subscription_catalog, latest_subscription_for_customer, list_invoices, price_for_plan, subscription_payload
from app.services.emailer import EmailProviderConfigurationError, EmailProviderRequestError, send_email, verify_smtp_connection
from app.services.secret_box import SecretBoxError, decrypt_secret, encrypt_secret
from app.services.lead_finder import LeadSourceConfigurationError, LeadSourceRequestError
from app.services.apollo import (
    ApolloConfigurationError,
    ApolloRequestError,
    apollo_key_loaded,
    search_apollo_companies,
    search_apollo_contacts,
    test_apollo_connection,
)
from app.services.hunter import (
    HunterConfigurationError,
    HunterRequestError,
    enrich_leads_with_hunter,
    hunter_key_loaded,
    test_hunter_connection,
)
from app.services.google_maps import (
    GoogleMapsConfigurationError,
    GoogleMapsRequestError,
    google_maps_key_loaded,
    search_google_places,
)
from app.services.website import WEBSITE_UNREACHABLE_MESSAGE, WebsiteFetchError, collect_website, normalize_website_url

router = APIRouter()
logger = logging.getLogger("outreachai.api.routes")
LEAD_PROVIDER_TIMEOUT_SECONDS = 10


LEGACY_STATUS_MAP = {
    "Email Generated": LeadStatus.qualified,
    "Sent": LeadStatus.contacted,
    "Opened": LeadStatus.contacted,
    "Replied": LeadStatus.interested,
}


def _status(value: str) -> LeadStatus:
    if value in LEGACY_STATUS_MAP:
        return LEGACY_STATUS_MAP[value]
    for item in LeadStatus:
        if item.value == value:
            return item
    raise HTTPException(status_code=400, detail="Unsupported pipeline status")


def _display_status(status: LeadStatus) -> str:
    if status == LeadStatus.email_generated:
        return LeadStatus.qualified.value
    if status in {LeadStatus.sent, LeadStatus.opened}:
        return LeadStatus.contacted.value
    if status == LeadStatus.replied:
        return LeadStatus.interested.value
    return status.value


def _month_period() -> str:
    return datetime.utcnow().strftime("%Y-%m")


def _private_workspace_name(email: str = "") -> str:
    if email:
        return f"{email.split('@')[0]}'s workspace"
    return "Private workspace"


def _current_workspace(db: Session, user_id: str, email: str = "") -> Workspace:
    workspace = db.scalar(select(Workspace).where(Workspace.owner_user_id == user_id).order_by(Workspace.created_at.asc()))
    if workspace is not None:
        if workspace.name in {"Outreach workspace", "Private workspace"}:
            workspace.name = _private_workspace_name(email)
            db.add(workspace)
            db.flush()
        existing_member = db.scalar(select(WorkspaceMember).where(WorkspaceMember.workspace_id == workspace.id, WorkspaceMember.user_id == user_id))
        if existing_member:
            existing_member.email = email or existing_member.email
            existing_member.role = WorkspaceRole.owner
            existing_member.status = "active"
            db.add(existing_member)
        else:
            db.add(WorkspaceMember(workspace_id=workspace.id, user_id=user_id, email=email, role=WorkspaceRole.owner, status="active"))
        db.commit()
        db.refresh(workspace)
        set_workspace_context(workspace.id)
        return workspace

    workspace = Workspace(owner_user_id=user_id, name=_private_workspace_name(email))
    db.add(workspace)
    db.flush()
    existing_member = db.scalar(select(WorkspaceMember).where(WorkspaceMember.workspace_id == workspace.id, WorkspaceMember.user_id == user_id))
    if existing_member:
        existing_member.email = email or existing_member.email
        existing_member.role = WorkspaceRole.owner
        existing_member.status = "active"
        db.add(existing_member)
    else:
        db.add(WorkspaceMember(workspace_id=workspace.id, user_id=user_id, email=email, role=WorkspaceRole.owner, status="active"))
    db.commit()
    db.refresh(workspace)
    set_workspace_context(workspace.id)
    return workspace


def _workspace_members(db: Session, workspace_id: UUID) -> list[WorkspaceMember]:
    workspace = db.get(Workspace, workspace_id)
    if workspace is None:
        return []
    return list(
        db.scalars(
            select(WorkspaceMember)
            .where(
                WorkspaceMember.workspace_id == workspace_id,
                WorkspaceMember.user_id == workspace.owner_user_id,
                WorkspaceMember.role == WorkspaceRole.owner,
                WorkspaceMember.status == "active",
            )
            .order_by(WorkspaceMember.created_at.asc())
        ).all()
    )


def _workspace_out(db: Session, workspace: Workspace) -> WorkspaceOut:
    return WorkspaceOut(
        id=workspace.id,
        name=workspace.name,
        company=workspace.company,
        industry=workspace.industry,
        target_country=workspace.target_country,
        target_customer=workspace.target_customer,
        timezone=workspace.timezone,
        language=workspace.language,
        onboarding_step=workspace.onboarding_step,
        onboarding_completed=workspace.onboarding_completed,
        members=_workspace_members(db, workspace.id),
    )


def _workspace_stmt(model, workspace: Workspace, user_id: str):
    workspace_scope = model.workspace_id == workspace.id
    if hasattr(model, "user_id"):
        return and_(workspace_scope, model.user_id == user_id)
    return workspace_scope


INTERNAL_TEST_DOMAINS = {"example.com", "example.net", "example.org", "test.com", "invalid.test"}
INTERNAL_TEST_NAME_PREFIXES = ("qa ", "qa-", "qa_", "premium test", "test ", "demo ")


def _domain_from_company_value(value: str | None) -> str:
    if not value:
        return ""
    clean = value.strip().lower()
    clean = clean.removeprefix("https://").removeprefix("http://").removeprefix("www.")
    return clean.split("/", 1)[0].strip()


def _is_placeholder_email(value: str | None) -> bool:
    if not value or "@" not in value:
        return False
    domain = value.rsplit("@", 1)[1].strip().lower()
    return domain in INTERNAL_TEST_DOMAINS


def _is_customer_visible_company(company: Company) -> bool:
    domain = _domain_from_company_value(company.domain or company.website)
    name = (company.name or "").strip().lower()
    if domain in INTERNAL_TEST_DOMAINS:
        return False
    return not any(name.startswith(prefix) for prefix in INTERNAL_TEST_NAME_PREFIXES)


def _is_customer_visible_contact(contact: Contact) -> bool:
    name = (contact.name or "").strip().lower()
    if _is_placeholder_email(contact.email):
        return False
    return not any(name.startswith(prefix) for prefix in INTERNAL_TEST_NAME_PREFIXES)


def _is_customer_visible_email(message: EmailMessage) -> bool:
    tags = message.tags or {}
    for key in ("to_email", "recipient_email", "email"):
        if _is_placeholder_email(str(tags.get(key) or "")):
            return False
    return True


def _is_customer_visible_campaign(campaign: Campaign) -> bool:
    name = (campaign.name or "").strip().lower()
    return not any(name.startswith(prefix) for prefix in ("qa campaign", "test campaign", "demo campaign"))


def _ensure_default_trial(settings: AppSettings, workspace: Workspace) -> bool:
    billing = dict(settings.billing or {})
    if billing.get("status") or billing.get("stripeSubscriptionId"):
        return False
    trial_started = workspace.created_at or datetime.utcnow()
    trial_end = _workspace_trial_end(workspace)
    billing.update(
        {
            "plan": billing.get("plan") or "Starter",
            "renewal": billing.get("renewal") or "monthly",
            "status": "trialing" if trial_end > datetime.utcnow() else "inactive",
            "trialStartedAt": trial_started.isoformat(),
            "trialEnd": trial_end.isoformat(),
        }
    )
    settings.billing = billing
    return True


def _workspace_trial_end(workspace: Workspace) -> datetime:
    return (workspace.created_at or datetime.utcnow()) + timedelta(days=14)


def _workspace_trial_is_active(workspace: Workspace) -> bool:
    return _workspace_trial_end(workspace) > datetime.utcnow()


def _parse_billing_datetime(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
        return None


def _fit_db_text(value: str | None, max_length: int) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if len(text) <= max_length:
        return text
    return text[: max_length - 1].rstrip() + "…"


def _settings_for_workspace(db: Session, user_id: str, workspace: Workspace) -> AppSettings:
    settings = db.scalar(select(AppSettings).where(AppSettings.workspace_id == workspace.id))
    if settings is None:
        settings = db.scalar(select(AppSettings).where(AppSettings.user_id == user_id, AppSettings.workspace_id.is_(None)))
    if settings is None:
        settings = AppSettings(user_id=user_id, workspace_id=workspace.id, **_default_settings())
        _ensure_default_trial(settings, workspace)
        db.add(settings)
        db.commit()
        db.refresh(settings)
    elif settings.workspace_id is None:
        settings.workspace_id = workspace.id
        _ensure_default_trial(settings, workspace)
        db.add(settings)
        db.commit()
    elif _ensure_default_trial(settings, workspace):
        db.add(settings)
        db.commit()
        db.refresh(settings)
    return settings


SUPPORTED_OUTREACH_PROVIDERS = {"resend", "smtp", "gmail", "outlook"}


def _extract_email(value: str | None) -> str:
    if not value:
        return ""
    parsed = parseaddr(str(value))[1] or str(value).strip()
    return parsed.strip().lower()


def _email_domain(value: str | None) -> str:
    email = _extract_email(value)
    if "@" not in email:
        return ""
    return email.rsplit("@", 1)[1].strip().lower()


def _sender_settings(settings: AppSettings) -> dict[str, Any]:
    email_settings = settings.email if isinstance(settings.email, dict) else {}
    sender = email_settings.get("sender") if isinstance(email_settings.get("sender"), dict) else {}
    smtp = sender.get("smtp") if isinstance(sender.get("smtp"), dict) else {}
    try:
        daily_send_limit = int(sender.get("daily_send_limit") or email_settings.get("dailyLimit") or 25)
    except (TypeError, ValueError):
        daily_send_limit = 25
    try:
        smtp_port = int(smtp.get("port") or 587)
    except (TypeError, ValueError):
        smtp_port = 587
    enabled_value = sender.get("enabled", True)
    enabled = enabled_value if isinstance(enabled_value, bool) else str(enabled_value).strip().lower() not in {"false", "0", "no", "off"}
    return {
        "provider": str(sender.get("provider") or email_settings.get("provider") or "resend").strip().lower(),
        "sender_name": str(sender.get("sender_name") or sender.get("name") or "").strip(),
        "sender_email": _extract_email(str(sender.get("sender_email") or sender.get("email") or "")),
        "reply_to": _extract_email(str(sender.get("reply_to") or "")),
        "daily_send_limit": daily_send_limit,
        "enabled": enabled,
        "smtp": {
            "host": str(smtp.get("host") or "").strip(),
            "port": max(1, min(smtp_port, 65535)),
            "username": str(smtp.get("username") or "").strip(),
            "password_encrypted": str(smtp.get("password_encrypted") or "").strip(),
            "use_tls": bool(smtp.get("use_tls", True)),
            "verified_at": str(smtp.get("verified_at") or "").strip(),
        },
    }


def _sent_today_count(db: Session, workspace: Workspace) -> int:
    today = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    return int(
        db.scalar(
            select(func.count())
            .select_from(EmailMessage)
            .where(EmailMessage.workspace_id == workspace.id, EmailMessage.sent_at >= today)
        )
        or 0
    )


def _domain_auth_status(domain: str) -> dict[str, str]:
    if not domain:
        return {"spf_status": "not_checked", "dkim_status": "not_checked", "dmarc_status": "not_checked"}
    try:
        import dns.resolver  # type: ignore
    except Exception:
        return {"spf_status": "not_checked", "dkim_status": "not_checked", "dmarc_status": "not_checked"}

    def txt_records(name: str) -> list[str]:
        try:
            answers = dns.resolver.resolve(name, "TXT", lifetime=3.0)
            return ["".join(part.decode("utf-8", "ignore") if isinstance(part, bytes) else str(part) for part in answer.strings) for answer in answers]
        except Exception:
            return []

    spf = "verified" if any("v=spf1" in item.lower() for item in txt_records(domain)) else "missing"
    dmarc = "verified" if any("v=dmarc1" in item.lower() for item in txt_records(f"_dmarc.{domain}")) else "missing"
    dkim = "not_checked"
    for selector in ("resend", "default", "google", "selector1", "selector2"):
        if txt_records(f"{selector}._domainkey.{domain}"):
            dkim = "verified"
            break
    return {"spf_status": spf, "dkim_status": dkim, "dmarc_status": dmarc}


def _outreach_sender_status(db: Session, user_id: str, workspace: Workspace) -> OutreachSenderStatusOut:
    settings = _settings_for_workspace(db, user_id, workspace)
    sender = _sender_settings(settings)
    app_settings = get_app_settings()
    provider = sender["provider"] if sender["provider"] in SUPPORTED_OUTREACH_PROVIDERS else "resend"
    configured_sender = sender["sender_email"] or (_extract_email(app_settings.resend_from_email) if provider == "resend" else "")
    daily_limit = max(1, min(int(sender["daily_send_limit"] or 25), 200))
    sent_today = _sent_today_count(db, workspace)
    remaining_today = max(0, daily_limit - sent_today)
    domain_checks = _domain_auth_status(_email_domain(configured_sender))
    smtp = sender["smtp"]
    smtp_configured = bool(smtp["host"] and smtp["username"] and smtp["password_encrypted"] and smtp["verified_at"])

    reason = ""
    connected = True
    status = "connected"
    next_action = "Ready to send approved emails."
    if not sender["enabled"]:
        connected = False
        status = "needs_setup"
        reason = "Email sending is disabled for this workspace."
        next_action = "Enable sending when your mailbox is ready."
    elif provider == "resend" and (not app_settings.resend_api_key or not app_settings.resend_from_email.strip()):
        connected = False
        status = "missing_key"
        reason = "Production email sending is not configured on the server."
        next_action = "Ask the workspace owner to connect email sending."
    elif provider == "smtp" and not configured_sender:
        connected = False
        status = "needs_setup"
        reason = "Add the sender email that should appear on outbound messages."
        next_action = "Add your sender email."
    elif provider == "smtp" and not smtp_configured:
        connected = False
        status = "needs_setup"
        reason = "SMTP setup must be saved and verified before sending."
        next_action = "Save SMTP settings to verify the mailbox connection."
    elif provider == "smtp" and app_settings.encryption_key == "replace-with-32-byte-url-safe-key":
        connected = False
        status = "needs_setup"
        reason = "A custom encryption key is required before storing mailbox credentials."
        next_action = "Finish secure SMTP setup before sending."
    elif provider in {"gmail", "outlook"}:
        connected = False
        status = "needs_setup"
        reason = "Gmail and Outlook need secure OAuth setup before sending."
        next_action = "Use the connected API sender now, or finish mailbox setup before sending."
    elif not configured_sender:
        connected = False
        status = "needs_setup"
        reason = "Add the sender email that should appear on outbound messages."
        next_action = "Add your sender email."
    elif remaining_today <= 0:
        connected = False
        status = "error"
        reason = "The safe daily sending limit has been reached."
        next_action = "Wait until tomorrow or lower campaign volume."

    return OutreachSenderStatusOut(
        provider=provider,
        connected=connected,
        status=status,
        sender_name=sender["sender_name"],
        sender_email=configured_sender or None,
        reply_to=sender["reply_to"] or _extract_email(app_settings.resend_reply_to) or None,
        daily_send_limit=daily_limit,
        sent_today=sent_today,
        remaining_today=remaining_today,
        next_action=next_action,
        reason=reason,
        smtp_host=smtp["host"],
        smtp_port=smtp["port"],
        smtp_username=smtp["username"],
        smtp_configured=smtp_configured,
        smtp_verified_at=smtp["verified_at"] if smtp_configured else "",
        **domain_checks,
    )


def _require_outreach_sender_ready(db: Session, user_id: str, workspace: Workspace) -> OutreachSenderStatusOut:
    status = _outreach_sender_status(db, user_id, workspace)
    if not status.connected:
        raise HTTPException(status_code=409, detail=status.reason or status.next_action)
    return status


def _outreach_sender_runtime_config(db: Session, user_id: str, workspace: Workspace) -> tuple[OutreachSenderStatusOut, dict[str, Any] | None]:
    status = _require_outreach_sender_ready(db, user_id, workspace)
    if status.provider != "smtp":
        return status, None
    settings = _settings_for_workspace(db, user_id, workspace)
    smtp = _sender_settings(settings)["smtp"]
    try:
        password = decrypt_secret(smtp["password_encrypted"], get_app_settings().encryption_key)
    except SecretBoxError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return status, {
        "host": smtp["host"],
        "port": smtp["port"],
        "username": smtp["username"],
        "password": password,
        "use_tls": smtp["use_tls"],
        "sender_email": status.sender_email,
    }


def _plan_for_workspace(db: Session, user_id: str, workspace: Workspace) -> str:
    settings = _settings_for_workspace(db, user_id, workspace)
    plan = str((settings.billing or {}).get("plan") or "Starter")
    return plan if plan in PLAN_LIMITS else "Starter"


def _subscription_status_for_workspace(db: Session, workspace: Workspace) -> str:
    settings = db.scalar(select(AppSettings).where(AppSettings.workspace_id == workspace.id))
    billing: dict[str, Any] = {}
    if settings is None:
        settings = AppSettings(user_id=workspace.owner_user_id, workspace_id=workspace.id, **_default_settings())
        _ensure_default_trial(settings, workspace)
        db.add(settings)
        db.commit()
        db.refresh(settings)
    if settings:
        if _ensure_default_trial(settings, workspace):
            db.add(settings)
            db.commit()
            db.refresh(settings)
        billing = settings.billing or {}

    subscription = db.scalar(select(Subscription).where(Subscription.workspace_id == workspace.id).order_by(Subscription.current_period_end.desc().nullslast()))
    if subscription and subscription.status in {"active", "trialing"}:
        return "expired" if _subscription_is_expired(subscription) else subscription.status
    if _workspace_trial_is_active(workspace):
        return "trialing"

    billing_status = str(billing.get("status") or "inactive")
    billing_trial_end = _parse_billing_datetime(billing.get("trialEnd"))
    has_stripe_subscription = bool(billing.get("stripeSubscriptionId"))
    if billing_status == "trialing" and not has_stripe_subscription:
        if billing_trial_end is None or billing_trial_end > datetime.utcnow():
            return "trialing"
    if billing_status == "active" and not has_stripe_subscription:
        return "active"
    if subscription:
        return "expired" if _subscription_is_expired(subscription) else subscription.status
    return billing_status


def _has_active_subscription(db: Session, workspace: Workspace) -> bool:
    return _subscription_status_for_workspace(db, workspace) in {"active", "trialing"}


def _latest_subscription(db: Session, workspace: Workspace) -> Subscription | None:
    return db.scalar(select(Subscription).where(Subscription.workspace_id == workspace.id).order_by(Subscription.current_period_end.desc().nullslast()))


def _subscription_is_expired(subscription: Subscription) -> bool:
    now = datetime.utcnow()
    if subscription.current_period_end and subscription.current_period_end <= now:
        return True
    if subscription.status == "trialing" and subscription.trial_end and subscription.trial_end <= now:
        return True
    return False


def _user_for_subscription(db: Session, user_id: str) -> User:
    user = db.scalar(select(User).where(User.clerk_user_id == user_id))
    if user is None:
        user = User(clerk_user_id=user_id, email=f"{user_id}@outreachai.local")
        db.add(user)
        db.flush()
    return user


def _sync_workspace_subscription(
    db: Session,
    *,
    user_id: str,
    workspace: Workspace,
    settings: AppSettings,
    stripe_customer_id: str,
    stripe_subscription_id: str,
    stripe_price_id: str,
    plan: str,
    status: str,
    trial_end: datetime | None,
    current_period_end: datetime | None,
) -> Subscription:
    user = _user_for_subscription(db, user_id)
    subscription = db.scalar(select(Subscription).where(Subscription.stripe_subscription_id == stripe_subscription_id))
    if subscription is None:
        subscription = db.scalar(select(Subscription).where(Subscription.workspace_id == workspace.id, Subscription.stripe_customer_id == stripe_customer_id))
    if subscription is None:
        subscription = Subscription(user_id=user.id, workspace_id=workspace.id)
        db.add(subscription)
    subscription.user_id = user.id
    subscription.workspace_id = workspace.id
    subscription.stripe_customer_id = stripe_customer_id
    subscription.stripe_subscription_id = stripe_subscription_id
    subscription.plan = plan
    subscription.status = status
    subscription.trial_end = trial_end
    subscription.current_period_end = current_period_end
    subscription.plan_limits = PLAN_LIMITS.get(plan, PLAN_LIMITS["Starter"])
    if status in {"active", "trialing"}:
        subscription.last_payment_error = None
        subscription.last_decline_code = None
        subscription.last_failure_message = None
        subscription.last_payment_failed_at = None
    billing = dict(settings.billing or {})
    if status in {"active", "trialing"}:
        for key in ("lastPaymentError", "lastDeclineCode", "lastFailureMessage", "lastPaymentFailedAt", "lastFailedInvoiceId", "lastFailedPaymentIntentId"):
            billing.pop(key, None)
    settings.billing = {
        **billing,
        "plan": plan,
        "status": status,
        "stripeCustomerId": stripe_customer_id,
        "stripeSubscriptionId": stripe_subscription_id,
        "stripePriceId": stripe_price_id,
        "trialEnd": trial_end.isoformat() if trial_end else None,
        "currentPeriodEnd": current_period_end.isoformat() if current_period_end else None,
        "planLimits": PLAN_LIMITS.get(plan, PLAN_LIMITS["Starter"]),
    }
    return subscription


def _upgrade_message(plan: str, feature: str) -> str:
    return f"{feature} is not available on the {plan} plan. Upgrade in Billing to continue."


def _require_active_subscription(db: Session, workspace: Workspace) -> None:
    if get_app_settings().app_env != "production":
        return
    if not _has_active_subscription(db, workspace):
        raise HTTPException(status_code=402, detail="Active subscription required. Choose a plan to continue.")


def _usage_for_workspace(db: Session, workspace: Workspace) -> UsageCounter:
    usage = db.scalar(select(UsageCounter).where(UsageCounter.workspace_id == workspace.id, UsageCounter.period == _month_period()))
    if usage is None:
        usage = UsageCounter(workspace_id=workspace.id, period=_month_period())
        db.add(usage)
        db.flush()
    return usage


def _enforce_usage(db: Session, user_id: str, workspace: Workspace, metric: str, amount: int = 1) -> UsageCounter:
    plan = _plan_for_workspace(db, user_id, workspace)
    limits = PLAN_LIMITS[plan]
    usage = _usage_for_workspace(db, workspace)
    current = int(getattr(usage, metric))
    limit = int(limits[metric])
    if limit and current + amount > limit:
        raise HTTPException(status_code=402, detail=f"{metric.replace('_', ' ').title()} limit reached for the {plan} plan. Upgrade in Billing to continue.")
    setattr(usage, metric, current + amount)
    db.add(usage)
    return usage


def _team_limit(db: Session, user_id: str, workspace: Workspace) -> int:
    limit = int(PLAN_LIMITS[_plan_for_workspace(db, user_id, workspace)]["team_members"])
    return limit or 1000000


def _enforce_count_limit(db: Session, user_id: str, workspace: Workspace, metric: str, current: int) -> None:
    plan = _plan_for_workspace(db, user_id, workspace)
    limit = int(PLAN_LIMITS[plan][metric])
    if limit and current >= limit:
        raise HTTPException(status_code=402, detail=f"{metric.replace('_', ' ').title()} limit reached for the {plan} plan. Upgrade in Billing to continue.")


def _enforce_sales_employee_mode(db: Session, user_id: str, workspace: Workspace, mode: SalesEmployeeMode) -> None:
    plan = _plan_for_workspace(db, user_id, workspace)
    limits = PLAN_LIMITS[plan]
    if mode == SalesEmployeeMode.semi_auto and not limits["semi_auto_mode"]:
        raise HTTPException(status_code=402, detail=_upgrade_message(plan, "Semi-Automatic Campaigns"))
    if mode == SalesEmployeeMode.autonomous and not limits["autonomous_mode"]:
        raise HTTPException(status_code=402, detail=_upgrade_message(plan, "Autonomous Mode"))


def _sequence_defaults(campaign: Campaign) -> list[CampaignSequenceIn]:
    return [
        CampaignSequenceIn(step_order=1, name="Email #1", subject="", body=campaign.offer, delay_days=0),
        CampaignSequenceIn(step_order=2, name="Follow-up #1", subject="", body="", delay_days=campaign.follow_up_days),
        CampaignSequenceIn(step_order=3, name="Follow-up #2", subject="", body="", delay_days=campaign.follow_up_days * 2),
        CampaignSequenceIn(step_order=4, name="Follow-up #3", subject="", body="", delay_days=campaign.follow_up_days * 3),
    ]


def _automation_marker(key: str, value: object) -> str:
    return f"automation:{key}={value}"


def _automation_value(campaign: Campaign, key: str, default: str) -> str:
    prefix = f"automation:{key}="
    for item in campaign.website_filters or []:
        if isinstance(item, str) and item.startswith(prefix):
            return item.removeprefix(prefix)
    return default


def _clean_website_filters(filters: list[str]) -> list[str]:
    return [item for item in filters if not str(item).startswith("automation:")]


def _campaign_payload(data: dict, *, include_defaults: bool = False) -> dict:
    has_automation = include_defaults or "working_hours" in data or "daily_send_limit" in data or "website_filters" in data
    working_hours = data.pop("working_hours", "09:00-17:00")
    daily_send_limit = data.pop("daily_send_limit", 50)
    if has_automation:
        filters = _clean_website_filters(list(data.get("website_filters") or []))
        data["website_filters"] = [*filters, _automation_marker("working_hours", working_hours), _automation_marker("daily_send_limit", daily_send_limit)]
    return data


def _replace_sequence(db: Session, campaign: Campaign, sequence: list[CampaignSequenceIn]) -> None:
    for existing in db.scalars(select(CampaignSequence).where(CampaignSequence.campaign_id == campaign.id)).all():
        db.delete(existing)
    items = sequence or _sequence_defaults(campaign)
    for item in sorted(items, key=lambda step: step.step_order):
        db.add(CampaignSequence(campaign_id=campaign.id, **item.model_dump()))


def _campaign_out(db: Session, campaign: Campaign) -> CampaignOut:
    lead_count = db.scalar(select(func.count()).select_from(Lead).where(Lead.campaign_id == campaign.id)) or 0
    sent = db.scalar(select(func.count()).select_from(EmailMessage).where(EmailMessage.campaign_id == campaign.id, EmailMessage.sent_at.is_not(None))) or 0
    replies = db.scalar(select(func.count()).select_from(Lead).where(Lead.campaign_id == campaign.id, Lead.status.in_([LeadStatus.interested, LeadStatus.replied]))) or 0
    sequence = list(db.scalars(select(CampaignSequence).where(CampaignSequence.campaign_id == campaign.id).order_by(CampaignSequence.step_order.asc())).all())
    return CampaignOut.model_validate(campaign, from_attributes=True).model_copy(
        update={
            "leads": lead_count,
            "sent": sent,
            "replies": replies,
            "sequence": sequence,
            "website_filters": _clean_website_filters(campaign.website_filters or []),
            "working_hours": _automation_value(campaign, "working_hours", "09:00-17:00"),
            "daily_send_limit": int(_automation_value(campaign, "daily_send_limit", "50")),
        }
    )


def _lead_out(lead: Lead) -> LeadOut:
    metadata = _lead_metadata(lead)
    last_activity_at = max([value for value in [lead.updated_at, lead.created_at] if value], default=None)
    return LeadOut(
        id=lead.id,
        company=lead.company,
        website=lead.website,
        industry=lead.industry,
        country=lead.country,
        city=lead.city,
        contact=lead.contact,
        email=lead.email,
        phone=lead.phone,
        linkedin=lead.linkedin,
        niche=lead.niche,
        status=_display_status(lead.status),
        campaign_id=lead.campaign_id,
        sales_employee_id=lead.sales_employee_id,
        campaign=lead.campaign.name if lead.campaign else None,
        notes=lead.notes,
        revenue=float(lead.revenue or 0),
        created_at=lead.created_at,
        domain=str(metadata.get("domain") or "") or None,
        employee_count=int(metadata["employee_count"]) if isinstance(metadata.get("employee_count"), int) else None,
        revenue_range=str(metadata.get("revenue") or "") or None,
        title=str(metadata.get("title") or "") or None,
        confidence=str(metadata.get("confidence") or "") or None,
        address=str(metadata.get("address") or "") or None,
        google_rating=float(metadata["google_rating"]) if isinstance(metadata.get("google_rating"), (int, float)) else None,
        business_category=str(metadata.get("business_category") or "") or None,
        place_id=str(metadata.get("place_id") or "") or None,
        latitude=float(metadata["latitude"]) if isinstance(metadata.get("latitude"), (int, float)) else None,
        longitude=float(metadata["longitude"]) if isinstance(metadata.get("longitude"), (int, float)) else None,
        apollo_company_id=str(metadata.get("apollo_company_id") or "") or None,
        apollo_contact_id=str(metadata.get("apollo_contact_id") or "") or None,
        hunter_contact_id=str(metadata.get("hunter_contact_id") or "") or None,
        hunter_verified=bool(metadata.get("hunter_verified")),
        hunter_status=str(metadata.get("hunter_status") or "") or None,
        source=str(metadata.get("source") or "") or None,
        ai_summary=str(metadata.get("ai_summary") or "") or None,
        suggested_offer=str(metadata.get("suggested_offer") or "") or None,
        outreach_strategy=str(metadata.get("outreach_strategy") or "") or None,
        sales_angle=str(metadata.get("sales_angle") or "") or None,
        expected_reply_rate=str(metadata.get("expected_reply_rate") or "") or None,
        buying_signals=[str(item) for item in metadata.get("buying_signals", [])] if isinstance(metadata.get("buying_signals"), list) else [],
        risks=[str(item) for item in metadata.get("risks", [])] if isinstance(metadata.get("risks"), list) else [],
        opportunity_analysis=str(metadata.get("opportunity_analysis") or ""),
        partnership_fit=str(metadata.get("partnership_fit") or ""),
        priority_score=int(metadata["priority_score"]) if str(metadata.get("priority_score") or "").isdigit() else None,
        confidence_score=int(metadata["confidence_score"]) if str(metadata.get("confidence_score") or "").isdigit() else None,
        next_recommended_action=str(metadata.get("next_recommended_action") or ""),
        found_at=lead.created_at,
        saved_to_crm_at=metadata.get("saved_to_crm_at"),
        website_analyzed_at=metadata.get("website_analyzed_at"),
        contact_found_at=metadata.get("contact_found_at"),
        email_generated_at=metadata.get("email_generated_at"),
        email_approved_at=metadata.get("email_approved_at"),
        email_sent_at=metadata.get("email_sent_at"),
        delivered_at=metadata.get("delivered_at"),
        opened_at=metadata.get("opened_at"),
        replied_at=metadata.get("replied_at"),
        last_activity_at=last_activity_at,
        stage_changed_at=lead.updated_at,
    )


def _lead_metadata(lead: Lead | LeadOut) -> dict[str, Any]:
    notes = getattr(lead, "notes", None) or ""
    if not notes:
        return {}
    lines = notes.splitlines() if isinstance(notes, str) else []
    candidate = lines[0] if lines else notes
    try:
        parsed = json.loads(candidate)
        return parsed if isinstance(parsed, dict) else {}
    except (TypeError, ValueError):
        return {}


def _crm_stage_for_lead(lead: Lead) -> str:
    metadata = _lead_metadata(lead)
    email_status = str(metadata.get("email_status") or "")
    if _display_status(lead.status) == "Won":
        return "Won"
    if _display_status(lead.status) == "Lost":
        return "Lost"
    if _display_status(lead.status) == "Interested":
        return "Replied"
    if email_status == "Sent":
        return "Sent"
    if email_status == "Approved":
        return "Approved"
    if _display_status(lead.status) == "Contacted":
        return "Sent"
    if email_status in {"Draft Ready", "draft"}:
        return "Email Draft Ready"
    if lead.email or metadata.get("hunter_verified"):
        return "Contact Found"
    if metadata.get("website_analysis_status") != "skipped" and (metadata.get("ai_summary") or metadata.get("suggested_offer") or metadata.get("outreach_strategy")):
        return "Website Analyzed"
    if _display_status(lead.status) == "Qualified":
        return "Qualified"
    return "New Lead"


def _email_status_for_lead(lead: Lead) -> str:
    metadata = _lead_metadata(lead)
    email_status = str(metadata.get("email_status") or "")
    if email_status in {"Sent", "Approved", "Draft Ready", "Needs review"}:
        return email_status
    if _display_status(lead.status) == "Contacted":
        return "Sent"
    if lead.email:
        return "Verified" if metadata.get("hunter_verified") else "Found"
    if metadata.get("hunter_status") == "no_verified_email":
        return "No verified email"
    return email_status or "Not prepared"


def _company_duplicate_stmt(workspace: Workspace, user_id: str, lead: Lead):
    metadata = _lead_metadata(lead)
    place_id = str(metadata.get("place_id") or "")
    domain = str(metadata.get("domain") or "")
    criteria = []
    if place_id:
        criteria.append(Company.place_id == place_id)
    if lead.website:
        criteria.append(Company.website == lead.website)
    if domain:
        criteria.append(Company.domain == domain)
    if lead.company and lead.city:
        criteria.append((Company.name == lead.company) & (Company.city == lead.city))
    if not criteria:
        criteria.append(Company.lead_id == lead.id)
    return select(Company).where(_workspace_stmt(Company, workspace, user_id), or_(*criteria)).order_by(Company.updated_at.desc())


def _sync_lead_to_crm(db: Session, user_id: str, workspace: Workspace, lead: Lead) -> Company:
    metadata = _lead_metadata(lead)
    company = db.scalar(_company_duplicate_stmt(workspace, user_id, lead))
    now = datetime.utcnow()
    if company is None:
        company = Company(user_id=user_id, workspace_id=workspace.id, lead_id=lead.id, name=lead.company)
        db.add(company)
    company.lead_id = company.lead_id or lead.id
    company.name = lead.company or company.name
    company.website = lead.website or company.website
    company.domain = str(metadata.get("domain") or company.domain or "") or None
    company.phone = lead.phone or company.phone
    company.email = lead.email or company.email
    company.address = str(metadata.get("address") or company.address or "") or None
    company.city = lead.city or company.city
    company.country = lead.country or company.country
    company.industry = lead.industry or lead.niche or company.industry
    company.google_rating = metadata.get("google_rating") if isinstance(metadata.get("google_rating"), (int, float)) else company.google_rating
    company.place_id = str(metadata.get("place_id") or company.place_id or "") or None
    company.source = str(metadata.get("source") or company.source or "manual")
    company.ai_summary = str(metadata.get("ai_summary") or company.ai_summary or "")
    company.suggested_offer = str(metadata.get("suggested_offer") or company.suggested_offer or "")
    company.outreach_strategy = str(metadata.get("outreach_strategy") or company.outreach_strategy or "")
    company.sales_angle = str(metadata.get("sales_angle") or company.sales_angle or "")
    company.expected_reply_rate = str(metadata.get("expected_reply_rate") or company.expected_reply_rate or "")
    company.email_status = _email_status_for_lead(lead)
    company.crm_stage = _crm_stage_for_lead(lead)
    company.metadata_json = {**(company.metadata_json or {}), **metadata}
    company.updated_at = now
    db.flush()

    if lead.email or lead.contact or lead.phone or lead.linkedin:
        contact = db.scalar(
            select(Contact)
            .where(
                _workspace_stmt(Contact, workspace, user_id),
                or_(
                    Contact.lead_id == lead.id,
                    Contact.email == lead.email if lead.email else Contact.id.is_(None),
                ),
            )
            .order_by(Contact.updated_at.desc())
        )
        if contact is None:
            contact = Contact(user_id=user_id, workspace_id=workspace.id, company_id=company.id, lead_id=lead.id)
            db.add(contact)
        contact.company_id = company.id
        contact.lead_id = contact.lead_id or lead.id
        contact.name = lead.contact or contact.name or ""
        contact.title = str(metadata.get("title") or contact.title or "")
        contact.email = lead.email or contact.email
        contact.phone = lead.phone or contact.phone
        contact.linkedin = lead.linkedin or contact.linkedin
        contact.confidence = str(metadata.get("confidence") or contact.confidence or "")
        contact.source = "hunter" if metadata.get("hunter_verified") else str(metadata.get("source") or contact.source or "manual")
        contact.email_status = "Verified" if metadata.get("hunter_verified") else ("Found" if lead.email else "Unknown")
        contact.metadata_json = {**(contact.metadata_json or {}), **metadata}
        contact.updated_at = now

    deal = db.scalar(select(Deal).where(_workspace_stmt(Deal, workspace, user_id), Deal.lead_id == lead.id).order_by(Deal.updated_at.desc()))
    if deal is None:
        deal = Deal(user_id=user_id, workspace_id=workspace.id, company_id=company.id, lead_id=lead.id, name=f"{lead.company} opportunity")
        db.add(deal)
    deal.company_id = company.id
    deal.stage = company.crm_stage
    deal.source = company.source
    deal.value = lead.revenue or deal.value or 0
    deal.probability = 70 if company.crm_stage in {"Email Draft Ready", "Approved", "Sent", "Replied"} else 35
    deal.next_step = "Review AI email and approve campaign." if company.crm_stage in {"Website Analyzed", "Contact Found", "Email Draft Ready"} else "Find contact details and complete research."
    deal.updated_at = now

    if company.ai_summary and not db.scalar(select(Note.id).where(_workspace_stmt(Note, workspace, user_id), Note.company_id == company.id, Note.kind == "ai_summary").limit(1)):
        db.add(Note(user_id=user_id, workspace_id=workspace.id, company_id=company.id, lead_id=lead.id, kind="ai_summary", body=company.ai_summary))

    contacts_for_workflow = list(
        db.scalars(
            select(Contact)
            .where(_workspace_stmt(Contact, workspace, user_id), Contact.company_id == company.id)
            .order_by(Contact.created_at.desc())
        ).all()
    )
    emails_for_workflow = (
        list(
            db.scalars(
                select(EmailMessage)
                .where(_workspace_stmt(EmailMessage, workspace, user_id), EmailMessage.lead_id == company.lead_id)
                .order_by(EmailMessage.created_at.desc())
                .limit(20)
            ).all()
        )
        if company.lead_id
        else []
    )
    workflow_stages = metadata.get("workflow_stages") if isinstance(metadata.get("workflow_stages"), dict) else {}
    workflow_state = build_company_workflow_engine(
        company=company,
        metadata=company.metadata_json if isinstance(company.metadata_json, dict) else {},
        contacts=contacts_for_workflow,
        emails=emails_for_workflow,
        workflow_stages=workflow_stages,
    )
    company.metadata_json = {
        **(company.metadata_json or {}),
        "ai_workflow_engine": workflow_state,
    }
    return company


def _existing_duplicate_lead(db: Session, workspace: Workspace, user_id: str, item: LeadOut) -> Lead | None:
    metadata = _lead_metadata(item)
    place_id = str(metadata.get("place_id") or item.place_id or "")
    apollo_company_id = str(metadata.get("apollo_company_id") or item.apollo_company_id or "")
    apollo_contact_id = str(metadata.get("apollo_contact_id") or item.apollo_contact_id or "")
    hunter_contact_id = str(metadata.get("hunter_contact_id") or item.hunter_contact_id or "")
    domain = str(metadata.get("domain") or item.domain or "")
    criteria = []
    if item.email:
        criteria.append(Lead.email == str(item.email))
    if item.website:
        criteria.append(Lead.website == item.website)
    if place_id:
        criteria.append(Lead.notes.ilike(f"%{place_id}%"))
    if apollo_company_id:
        criteria.append(Lead.notes.ilike(f"%{apollo_company_id}%"))
    if apollo_contact_id:
        criteria.append(Lead.notes.ilike(f"%{apollo_contact_id}%"))
    if hunter_contact_id:
        criteria.append(Lead.notes.ilike(f"%{hunter_contact_id}%"))
    if domain:
        criteria.append(Lead.website.ilike(f"%{domain}%"))
        criteria.append(Lead.notes.ilike(f"%{domain}%"))
    if item.company and item.city:
        criteria.append((Lead.company == item.company) & (Lead.city == item.city))
    elif not criteria and item.company:
        criteria.append(Lead.company == item.company)
    if not criteria:
        return None
    return db.scalar(select(Lead).where(_workspace_stmt(Lead, workspace, user_id), or_(*criteria)).order_by(Lead.updated_at.desc()).limit(1))


def _crm_contact_out(contact: Contact, company_name: str = "") -> CrmContactOut:
    metadata = contact.metadata_json or {}
    return CrmContactOut(
        id=contact.id,
        company_id=contact.company_id,
        lead_id=contact.lead_id,
        company=company_name or (contact.company.name if contact.company else ""),
        name=contact.name,
        title=contact.title,
        email=contact.email,
        phone=contact.phone,
        linkedin=contact.linkedin,
        confidence=contact.confidence,
        source=contact.source,
        email_status=contact.email_status,
        decision_maker_intelligence=metadata.get("decision_maker_intelligence") if isinstance(metadata.get("decision_maker_intelligence"), dict) else {},
        created_at=contact.created_at,
    )


def _crm_deal_out(deal: Deal, company_name: str = "") -> CrmDealOut:
    return CrmDealOut(
        id=deal.id,
        company_id=deal.company_id,
        lead_id=deal.lead_id,
        company=company_name or (deal.company.name if deal.company else ""),
        name=deal.name,
        stage=deal.stage,
        value=float(deal.value or 0),
        probability=deal.probability,
        source=deal.source,
        next_step=deal.next_step,
        created_at=deal.created_at,
    )


def _crm_note_out(note: Note) -> CrmNoteOut:
    return CrmNoteOut(id=note.id, company_id=note.company_id, lead_id=note.lead_id, body=note.body, kind=note.kind, created_at=note.created_at)


def _audit_log_lead_id_clause(lead_id: UUID):
    return AuditLog.metadata_json["lead_id"].as_string() == str(lead_id)


def _add_lead_activity(
    db: Session,
    request: Request,
    user_id: str,
    workspace: Workspace,
    action: str,
    lead: Lead,
    extra: dict[str, Any] | None = None,
) -> None:
    ip = request.headers.get("x-forwarded-for", "").split(",")[0] or (request.client.host if request.client else None)
    db.add(
        AuditLog(
            user_id=user_id,
            workspace_id=workspace.id,
            action=action,
            ip_address=ip,
            metadata_json={
                "lead_id": str(lead.id),
                "company": lead.company,
                "website": lead.website or "",
                "stage": _crm_stage_for_lead(lead),
                **(extra or {}),
            },
        )
    )


def _first_audit_time(db: Session, workspace: Workspace, user_id: str, lead_id: UUID | None, actions: set[str]) -> datetime | None:
    if not lead_id:
        return None
    return db.scalar(
        select(AuditLog.created_at)
        .where(
            AuditLog.workspace_id == workspace.id,
            _audit_log_lead_id_clause(lead_id),
            AuditLog.action.in_(actions),
        )
        .order_by(AuditLog.created_at.asc())
        .limit(1)
    )


def _latest_audit_time(db: Session, workspace: Workspace, user_id: str, lead_id: UUID | None) -> datetime | None:
    if not lead_id:
        return None
    return db.scalar(
        select(AuditLog.created_at)
        .where(AuditLog.workspace_id == workspace.id, _audit_log_lead_id_clause(lead_id))
        .order_by(AuditLog.created_at.desc())
        .limit(1)
    )


def _crm_company_out(db: Session, workspace: Workspace, user_id: str, company: Company) -> CrmCompanyOut:
    contacts = [contact for contact in db.scalars(select(Contact).where(_workspace_stmt(Contact, workspace, user_id), Contact.company_id == company.id).order_by(Contact.created_at.desc())).all() if _is_customer_visible_contact(contact)]
    deals = list(db.scalars(select(Deal).where(_workspace_stmt(Deal, workspace, user_id), Deal.company_id == company.id).order_by(Deal.created_at.desc())).all())
    notes = list(db.scalars(select(Note).where(_workspace_stmt(Note, workspace, user_id), Note.company_id == company.id).order_by(Note.created_at.desc()).limit(20)).all())
    emails = [email for email in db.scalars(select(EmailMessage).where(_workspace_stmt(EmailMessage, workspace, user_id), EmailMessage.lead_id == company.lead_id).order_by(EmailMessage.created_at.desc()).limit(20)).all() if _is_customer_visible_email(email)][:10] if company.lead_id else []
    activity = list(db.scalars(select(AuditLog).where(AuditLog.workspace_id == workspace.id, _audit_log_lead_id_clause(company.lead_id)).order_by(AuditLog.created_at.desc()).limit(10)).all()) if company.lead_id else []
    lead = db.get(Lead, company.lead_id) if company.lead_id else None
    found_at = _first_audit_time(db, workspace, user_id, company.lead_id, {"lead.found", "lead.imported", "google_maps.company_search", "apollo.company_search", "apollo.contact_search"}) or (lead.created_at if lead else company.created_at)
    saved_to_crm_at = _first_audit_time(db, workspace, user_id, company.lead_id, {"lead.saved_to_crm"}) or company.created_at
    website_analyzed_at = db.scalar(select(WebsiteAnalysis.created_at).where(_workspace_stmt(WebsiteAnalysis, workspace, user_id), WebsiteAnalysis.lead_id == company.lead_id).order_by(WebsiteAnalysis.created_at.desc()).limit(1)) if company.lead_id else None
    contact_found_at = min([contact.created_at for contact in contacts], default=None)
    email_generated_at = min([email.created_at for email in emails], default=None)
    email_approved_at = _first_audit_time(db, workspace, user_id, company.lead_id, {"email.approved"})
    email_sent_at = max([email.sent_at for email in emails if email.sent_at], default=None)
    delivered_at = max([email.delivered_at for email in emails if email.delivered_at], default=None)
    opened_at = max([email.opened_at for email in emails if email.opened_at], default=None)
    replied_at = max([email.replied_at for email in emails if email.replied_at], default=None)
    latest_activity_at = _latest_audit_time(db, workspace, user_id, company.lead_id)
    last_activity_at = max([value for value in [company.updated_at, found_at, saved_to_crm_at, website_analyzed_at, contact_found_at, email_generated_at, email_approved_at, email_sent_at, delivered_at, opened_at, replied_at, latest_activity_at] if value], default=company.updated_at)
    company_metadata = company.metadata_json or {}
    deep_contact_search = company_metadata.get("deep_contact_search") if isinstance(company_metadata.get("deep_contact_search"), dict) else {}
    decision_maker_intelligence = company_metadata.get("decision_maker_intelligence") if isinstance(company_metadata.get("decision_maker_intelligence"), dict) else {}
    opportunity_ranking = company_metadata.get("opportunity_ranking") if isinstance(company_metadata.get("opportunity_ranking"), dict) else {}
    ai_outreach_strategy = company_metadata.get("ai_outreach_strategy") if isinstance(company_metadata.get("ai_outreach_strategy"), dict) else {}
    ai_competitor_intelligence = company_metadata.get("ai_competitor_intelligence") if isinstance(company_metadata.get("ai_competitor_intelligence"), dict) else {}
    ai_company_timeline = company_metadata.get("ai_company_timeline") if isinstance(company_metadata.get("ai_company_timeline"), dict) else {}
    ai_company_predictions = company_metadata.get("ai_company_predictions") if isinstance(company_metadata.get("ai_company_predictions"), dict) else {}
    ai_sales_timeline = company_metadata.get("ai_sales_timeline") if isinstance(company_metadata.get("ai_sales_timeline"), dict) else {}
    ai_risk_analyzer = company_metadata.get("ai_risk_analyzer") if isinstance(company_metadata.get("ai_risk_analyzer"), dict) else {}
    ai_sales_coach = company_metadata.get("ai_sales_coach") if isinstance(company_metadata.get("ai_sales_coach"), dict) else {}
    ai_specialized_agents = company_metadata.get("ai_specialized_agents") if isinstance(company_metadata.get("ai_specialized_agents"), dict) else {}
    ai_agent_intermediate_reasoning = company_metadata.get("ai_agent_intermediate_reasoning") if isinstance(company_metadata.get("ai_agent_intermediate_reasoning"), dict) else {}
    ai_final_orchestrator = company_metadata.get("ai_final_orchestrator") if isinstance(company_metadata.get("ai_final_orchestrator"), dict) else {}
    ai_evidence_engine = company_metadata.get("ai_evidence_engine") if isinstance(company_metadata.get("ai_evidence_engine"), dict) else {}
    ai_executive_dashboard = company_metadata.get("ai_executive_dashboard") if isinstance(company_metadata.get("ai_executive_dashboard"), dict) else {}
    ai_revenue_engine_report = company_metadata.get("ai_revenue_engine_report") if isinstance(company_metadata.get("ai_revenue_engine_report"), dict) else {}
    ai_crm = company_metadata.get("ai_crm") if isinstance(company_metadata.get("ai_crm"), dict) else {}
    ai_ceo_dashboard = company_metadata.get("ai_ceo_dashboard") if isinstance(company_metadata.get("ai_ceo_dashboard"), dict) else {}
    ai_sales_os = company_metadata.get("ai_sales_os") if isinstance(company_metadata.get("ai_sales_os"), dict) else {}
    ai_live_buying_signals = company_metadata.get("ai_live_buying_signals") if isinstance(company_metadata.get("ai_live_buying_signals"), dict) else {}
    ai_lead_prioritization = company_metadata.get("ai_lead_prioritization") if isinstance(company_metadata.get("ai_lead_prioritization"), dict) else {}
    ai_sales_inbox_latest = company_metadata.get("ai_sales_inbox_latest") if isinstance(company_metadata.get("ai_sales_inbox_latest"), dict) else {}
    ai_sales_inbox_history = [item for item in company_metadata.get("ai_sales_inbox_history", []) if isinstance(item, dict)] if isinstance(company_metadata.get("ai_sales_inbox_history"), list) else []
    if not ai_executive_dashboard:
        ai_final_orchestrator = company_metadata.get("ai_final_orchestrator") if isinstance(company_metadata.get("ai_final_orchestrator"), dict) else {}
        ai_agent_intermediate_reasoning = company_metadata.get("ai_agent_intermediate_reasoning") if isinstance(company_metadata.get("ai_agent_intermediate_reasoning"), dict) else {}
        opportunity_ranking_cache = company_metadata.get("opportunity_ranking") if isinstance(company_metadata.get("opportunity_ranking"), dict) else {}
        buying_signal_score = int(company_metadata["buying_signal_score"]) if str(company_metadata.get("buying_signal_score") or "").isdigit() else 0
        buying_intent_cache = {
            "buying_signal_score": buying_signal_score,
            "urgency": str(company_metadata.get("buying_signal_urgency") or ""),
            "explanation": str(company_metadata.get("buying_signal_explanation") or ""),
        }
        risk_cache = company_metadata.get("ai_risk_analyzer") if isinstance(company_metadata.get("ai_risk_analyzer"), dict) else {}
        outreach_cache = company_metadata.get("ai_outreach_strategy") if isinstance(company_metadata.get("ai_outreach_strategy"), dict) else {}
        competitor_cache = company_metadata.get("ai_competitor_intelligence") if isinstance(company_metadata.get("ai_competitor_intelligence"), dict) else {}

        orchestrator_output = ai_final_orchestrator.get("output") if isinstance(ai_final_orchestrator.get("output"), dict) else {}
        decision_maker = orchestrator_output.get("decision_maker") if isinstance(orchestrator_output.get("decision_maker"), dict) else {}
        email_plan = orchestrator_output.get("email_plan") if isinstance(orchestrator_output.get("email_plan"), dict) else {}
        competitor_view = orchestrator_output.get("competitor_view") if isinstance(orchestrator_output.get("competitor_view"), dict) else {}
        final_recommendation = orchestrator_output.get("final_recommendation") if isinstance(orchestrator_output.get("final_recommendation"), dict) else {}

        top_risks = risk_cache.get("reasons") if isinstance(risk_cache.get("reasons"), list) else []
        top_opportunities = [str(item) for item in opportunity_ranking_cache.get("top_positive_signals", []) if str(item or "").strip()] if isinstance(opportunity_ranking_cache.get("top_positive_signals"), list) else []
        opportunity_to_sell = str(competitor_view.get("opportunity_to_sell") or competitor_cache.get("opportunity_to_sell") or "").strip()
        if opportunity_to_sell:
            top_opportunities = [opportunity_to_sell, *top_opportunities]

        follow_up_schedule = outreach_cache.get("follow_up_schedule") if isinstance(outreach_cache.get("follow_up_schedule"), list) else []
        recommended_follow_up = str(follow_up_schedule[0] or "").strip() if follow_up_schedule else ""

        evidence: list[dict[str, Any]] = []
        for section in ai_agent_intermediate_reasoning.values():
            if not isinstance(section, dict) or not isinstance(section.get("evidence"), list):
                continue
            for item in section.get("evidence", []):
                if not isinstance(item, dict):
                    continue
                source_field = str(item.get("source_field") or "").strip()
                value = str(item.get("value") or "").strip()
                if not source_field or not value:
                    continue
                evidence.append(
                    {
                        "source_field": source_field,
                        "value": value,
                        "confidence": max(0, min(100, int(item.get("confidence") if str(item.get("confidence") or "").isdigit() else 70))),
                    }
                )

        seen: set[tuple[str, str]] = set()
        deduped_evidence: list[dict[str, Any]] = []
        for item in evidence:
            key = (str(item.get("source_field") or "").lower(), str(item.get("value") or "").lower())
            if key in seen:
                continue
            seen.add(key)
            deduped_evidence.append(item)
        ai_executive_dashboard = {
            "generated_at": datetime.utcnow().isoformat(),
            "source": "cached_orchestrator",
            "overall_opportunity_score": {
                "score": int(opportunity_ranking_cache["overall_score"]) if str(opportunity_ranking_cache.get("overall_score") or "").isdigit() else 0,
                "reasoning": str(opportunity_ranking_cache.get("reasoning") or ""),
            },
            "buying_intent": {
                "score": buying_signal_score,
                "urgency": str(buying_intent_cache.get("urgency") or ""),
                "reasoning": str(buying_intent_cache.get("explanation") or ""),
            },
            "decision_maker": {
                "contact_id": decision_maker.get("top_contact_id"),
                "name": decision_maker.get("name"),
                "title": decision_maker.get("title"),
                "authority_level": decision_maker.get("authority_level"),
                "is_verified_contact": bool(decision_maker.get("is_verified_contact")),
            },
            "top_risks": [str(item) for item in top_risks if str(item or "").strip()][:5],
            "top_opportunities": top_opportunities[:5],
            "recommended_next_action": str(final_recommendation.get("next_action") or opportunity_ranking_cache.get("recommended_next_action") or ""),
            "recommended_email": {
                "subject": str(email_plan.get("subject") or ""),
                "first_sentence": str(email_plan.get("first_sentence") or ""),
                "cta": str(email_plan.get("cta") or ""),
                "channel": str(email_plan.get("best_channel") or ""),
            },
            "recommended_follow_up": recommended_follow_up,
            "competitor_summary": {
                "competitors": competitor_view.get("competitors") if isinstance(competitor_view.get("competitors"), list) else (competitor_cache.get("competitors") if isinstance(competitor_cache.get("competitors"), list) else []),
                "market_gaps": competitor_view.get("market_gaps") if isinstance(competitor_view.get("market_gaps"), list) else (competitor_cache.get("market_gaps") if isinstance(competitor_cache.get("market_gaps"), list) else []),
                "opportunity_to_sell": opportunity_to_sell,
            },
            "evidence": deduped_evidence[:12],
            "confidence": int(ai_final_orchestrator["confidence"]) if str(ai_final_orchestrator.get("confidence") or "").isdigit() else 0,
        }
    if not ai_revenue_engine_report:
        top_profile = {}
        if isinstance(decision_maker_intelligence.get("profiles"), list) and decision_maker_intelligence.get("profiles"):
            first_profile = decision_maker_intelligence.get("profiles")[0]
            top_profile = first_profile if isinstance(first_profile, dict) else {}
        buying_signal_score = int(company_metadata["buying_signal_score"]) if str(company_metadata.get("buying_signal_score") or "").isdigit() else 0
        opportunity_score_cache = int(company_metadata["overall_score"]) if str(company_metadata.get("overall_score") or "").isdigit() else 0
        top_pain_points = [str(item) for item in company_metadata.get("pain_points", []) if str(item or "").strip()] if isinstance(company_metadata.get("pain_points"), list) else []
        top_opportunities = [str(item) for item in company_metadata.get("top_positive_signals", []) if str(item or "").strip()] if isinstance(company_metadata.get("top_positive_signals"), list) else []
        top_risks = [str(item) for item in company_metadata.get("top_negative_signals", []) if str(item or "").strip()] if isinstance(company_metadata.get("top_negative_signals"), list) else []
        ai_revenue_engine_report = {
            "generated_at": datetime.utcnow().isoformat(),
            "source": "cached_company_metadata",
            "executive_summary": str(company_metadata.get("reasoning") or company_metadata.get("ai_summary") or ""),
            "overall_opportunity_score": {
                "score": opportunity_score_cache,
                "reasoning": str(company_metadata.get("reasoning") or ""),
            },
            "buying_intent": {
                "score": buying_signal_score,
                "urgency": str(company_metadata.get("buying_signal_urgency") or ""),
                "reasoning": str(company_metadata.get("buying_signal_explanation") or ""),
            },
            "decision_maker": {
                "contact_id": top_profile.get("contact_id"),
                "name": top_profile.get("name"),
                "title": top_profile.get("title"),
                "authority_level": top_profile.get("estimated_authority_level"),
                "is_verified_contact": bool(top_profile.get("is_verified_contact")),
            },
            "best_contact_reason": str(top_profile.get("why_best_decision_maker") or ""),
            "top_pain_points": top_pain_points[:5],
            "top_opportunities": top_opportunities[:5],
            "top_risks": top_risks[:5],
            "competitor_position": {
                "positioning": str(ai_competitor_intelligence.get("positioning") or ""),
                "competitors": [str(item) for item in ai_competitor_intelligence.get("competitors", []) if str(item or "").strip()] if isinstance(ai_competitor_intelligence.get("competitors"), list) else [],
                "market_gaps": [str(item) for item in ai_competitor_intelligence.get("market_gaps", []) if str(item or "").strip()] if isinstance(ai_competitor_intelligence.get("market_gaps"), list) else [],
                "opportunity_to_sell": str(ai_competitor_intelligence.get("opportunity_to_sell") or ""),
            },
            "technology_summary": {
                "products": [str(item) for item in company_metadata.get("company_intelligence", {}).get("report", {}).get("products", {}).get("value", []) if str(item or "").strip()] if isinstance(company_metadata.get("company_intelligence"), dict) and isinstance(company_metadata.get("company_intelligence", {}).get("report"), dict) and isinstance(company_metadata.get("company_intelligence", {}).get("report", {}).get("products"), dict) and isinstance(company_metadata.get("company_intelligence", {}).get("report", {}).get("products", {}).get("value"), list) else [],
                "technology_stack": [str(item) for item in company_metadata.get("company_intelligence", {}).get("report", {}).get("technology_stack", {}).get("value", []) if str(item or "").strip()] if isinstance(company_metadata.get("company_intelligence"), dict) and isinstance(company_metadata.get("company_intelligence", {}).get("report"), dict) and isinstance(company_metadata.get("company_intelligence", {}).get("report", {}).get("technology_stack"), dict) and isinstance(company_metadata.get("company_intelligence", {}).get("report", {}).get("technology_stack", {}).get("value"), list) else [],
            },
            "recommended_outreach_strategy": {
                "why_contact_now": str(ai_outreach_strategy.get("why_contact_now") or ""),
                "best_timing": str(ai_outreach_strategy.get("best_timing") or ""),
                "best_channel": str(ai_outreach_strategy.get("best_communication_channel") or ai_outreach_strategy.get("best_channel") or ""),
                "strongest_value_proposition": str(ai_outreach_strategy.get("strongest_value_proposition") or ""),
            },
            "recommended_first_email": {
                "subject": str(ai_outreach_strategy.get("best_subject_line") or ""),
                "first_sentence": str(ai_outreach_strategy.get("first_sentence") or ""),
                "cta": str(ai_outreach_strategy.get("cta") or ""),
            },
            "recommended_follow_up_strategy": {
                "schedule": [str(item) for item in ai_outreach_strategy.get("follow_up_schedule", []) if str(item or "").strip()] if isinstance(ai_outreach_strategy.get("follow_up_schedule"), list) else [],
                "strategy": str(ai_sales_coach.get("alternative_strategy") or ""),
            },
            "recommended_cta": str(ai_outreach_strategy.get("cta") or ""),
            "confidence": int(company_metadata["confidence"]) if str(company_metadata.get("confidence") or "").isdigit() else 0,
            "evidence": [item for item in ai_executive_dashboard.get("evidence", []) if isinstance(item, dict)] if isinstance(ai_executive_dashboard.get("evidence"), list) else [],
        }
    technologies = deep_contact_search.get("technologies") if isinstance(deep_contact_search.get("technologies"), list) else []
    if not technologies and isinstance(company_metadata.get("technologies"), list):
        technologies = company_metadata.get("technologies") or []
    last_enriched_at = _datetime_or_none(deep_contact_search.get("last_enriched_at")) if deep_contact_search else None
    if last_enriched_at is None:
        last_enriched_at = _datetime_or_none(company_metadata.get("last_enriched_at"))
    contact_search_checked_at = _datetime_or_none(company_metadata.get("contact_search_checked_at"))
    roles_searched = company_metadata.get("decision_maker_roles_searched")
    intelligence_quality = company_metadata.get("intelligence_quality") if isinstance(company_metadata.get("intelligence_quality"), dict) else {}
    company_intelligence = company_metadata.get("company_intelligence") if isinstance(company_metadata.get("company_intelligence"), dict) else {}
    workflow_stages, workflow_stage_messages = _company_workflow_statuses(
        company=company,
        metadata=company_metadata,
        contacts=contacts,
        emails=emails,
        website_analyzed_at=website_analyzed_at,
        contact_found_at=contact_found_at,
        email_generated_at=email_generated_at,
        email_approved_at=email_approved_at,
    )
    ai_workflow_engine = build_company_workflow_engine(
        company=company,
        metadata=company_metadata,
        contacts=contacts,
        emails=emails,
        workflow_stages=workflow_stages,
    )
    return CrmCompanyOut(
        id=company.id,
        lead_id=company.lead_id,
        name=company.name,
        website=company.website,
        domain=company.domain,
        phone=company.phone,
        email=None if _is_placeholder_email(company.email) else company.email,
        address=company.address,
        city=company.city,
        country=company.country,
        industry=company.industry,
        google_rating=float(company.google_rating) if company.google_rating is not None else None,
        place_id=company.place_id,
        source=company.source,
        ai_summary=company.ai_summary,
        pain_points=[str(item) for item in company_metadata.get("pain_points", [])] if isinstance(company_metadata.get("pain_points"), list) else [],
        services=[str(item) for item in company_metadata.get("services", [])] if isinstance(company_metadata.get("services"), list) else [],
        weaknesses=[str(item) for item in company_metadata.get("weaknesses", [])] if isinstance(company_metadata.get("weaknesses"), list) else [],
        icp_score=int(company_metadata["icp_score"]) if str(company_metadata.get("icp_score") or "").isdigit() else None,
        value_proposition=str(company_metadata.get("value_proposition") or ""),
        suggested_offer=company.suggested_offer,
        outreach_strategy=company.outreach_strategy,
        sales_angle=company.sales_angle,
        recommended_cta=str(company_metadata.get("recommended_cta") or ""),
        follow_up_strategy=str(company_metadata.get("follow_up_strategy") or ""),
        expected_reply_rate=company.expected_reply_rate,
        buying_signals=[str(item) for item in company_metadata.get("buying_signals", [])] if isinstance(company_metadata.get("buying_signals"), list) else [],
        risks=[str(item) for item in company_metadata.get("risks", [])] if isinstance(company_metadata.get("risks"), list) else [],
        opportunity_analysis=str(company_metadata.get("opportunity_analysis") or ""),
        partnership_fit=str(company_metadata.get("partnership_fit") or ""),
        buying_signal_score=int(company_metadata["buying_signal_score"]) if str(company_metadata.get("buying_signal_score") or "").isdigit() else None,
        buying_signal_urgency=str(company_metadata.get("buying_signal_urgency") or ""),
        buying_signal_explanation=str(company_metadata.get("buying_signal_explanation") or ""),
        buying_signal_evidence=[item for item in company_metadata.get("buying_signal_evidence", []) if isinstance(item, dict)] if isinstance(company_metadata.get("buying_signal_evidence"), list) else [],
        buying_signal_confidence=int(company_metadata["buying_signal_confidence"]) if str(company_metadata.get("buying_signal_confidence") or "").isdigit() else None,
        recommended_outreach_timing=str(company_metadata.get("recommended_outreach_timing") or ""),
        overall_score=int(company_metadata["overall_score"]) if str(company_metadata.get("overall_score") or "").isdigit() else None,
        reasoning=str(company_metadata.get("reasoning") or ""),
        top_positive_signals=[str(item) for item in company_metadata.get("top_positive_signals", [])] if isinstance(company_metadata.get("top_positive_signals"), list) else [],
        top_negative_signals=[str(item) for item in company_metadata.get("top_negative_signals", [])] if isinstance(company_metadata.get("top_negative_signals"), list) else [],
        recommended_next_action=str(company_metadata.get("recommended_next_action") or ""),
        confidence=int(company_metadata["confidence"]) if str(company_metadata.get("confidence") or "").isdigit() else None,
        priority_score=int(company_metadata["priority_score"]) if str(company_metadata.get("priority_score") or "").isdigit() else None,
        confidence_score=int(company_metadata["confidence_score"]) if str(company_metadata.get("confidence_score") or "").isdigit() else None,
        next_recommended_action=str(company_metadata.get("next_recommended_action") or ""),
        email_status=company.email_status,
        crm_stage=company.crm_stage,
        contacts=[_crm_contact_out(contact, company.name) for contact in contacts],
        deals=[_crm_deal_out(deal, company.name) for deal in deals],
        notes=[_crm_note_out(note) for note in notes],
        activity=[ActivityOut.model_validate(item, from_attributes=True) for item in activity],
        generated_emails=[EmailOut.model_validate(item, from_attributes=True) for item in emails],
        created_at=company.created_at,
        updated_at=company.updated_at,
        found_at=found_at,
        saved_to_crm_at=saved_to_crm_at,
        website_analyzed_at=website_analyzed_at,
        contact_found_at=contact_found_at,
        email_generated_at=email_generated_at,
        email_approved_at=email_approved_at,
        email_sent_at=email_sent_at,
        delivered_at=delivered_at,
        opened_at=opened_at,
        replied_at=replied_at,
        last_activity_at=last_activity_at,
        stage_changed_at=company.updated_at,
        contact_search_checked_at=contact_search_checked_at,
        contact_search_status=str(company_metadata.get("contact_search_status") or "") or None,
        contact_search_message=str(company_metadata.get("contact_search_message") or "") or None,
        decision_maker_roles_searched=[str(role) for role in roles_searched] if isinstance(roles_searched, list) else [],
        workflow_stages=workflow_stages,
        workflow_stage_messages=workflow_stage_messages,
        ai_workflow_engine=ai_workflow_engine,
        deep_contact_search=deep_contact_search,
        decision_maker_intelligence=decision_maker_intelligence,
        opportunity_ranking=opportunity_ranking,
        ai_outreach_strategy=ai_outreach_strategy,
        ai_competitor_intelligence=ai_competitor_intelligence,
        ai_company_timeline=ai_company_timeline,
        ai_company_predictions=ai_company_predictions,
        ai_sales_timeline=ai_sales_timeline,
        ai_risk_analyzer=ai_risk_analyzer,
        ai_sales_coach=ai_sales_coach,
        ai_specialized_agents=ai_specialized_agents,
        ai_agent_intermediate_reasoning=ai_agent_intermediate_reasoning,
        ai_final_orchestrator=ai_final_orchestrator,
        ai_executive_dashboard=ai_executive_dashboard,
        ai_revenue_engine_report=ai_revenue_engine_report,
        ai_crm=ai_crm,
        ai_ceo_dashboard=ai_ceo_dashboard,
        ai_sales_os=ai_sales_os,
        ai_live_buying_signals=ai_live_buying_signals,
        ai_lead_prioritization=ai_lead_prioritization,
        ai_sales_inbox_latest=ai_sales_inbox_latest,
        ai_sales_inbox_history=ai_sales_inbox_history,
        ai_evidence_engine=ai_evidence_engine,
        intelligence_quality=intelligence_quality,
        company_intelligence=company_intelligence,
        technologies=[str(item) for item in technologies if item],
        last_enriched_at=last_enriched_at,
    )


def _company_workflow_statuses(
    *,
    company: Company,
    metadata: dict[str, Any],
    contacts: list[Contact],
    emails: list[EmailMessage],
    website_analyzed_at: datetime | None,
    contact_found_at: datetime | None,
    email_generated_at: datetime | None,
    email_approved_at: datetime | None,
) -> tuple[dict[str, str], dict[str, str]]:
    explicit = metadata.get("workflow_stages") if isinstance(metadata.get("workflow_stages"), dict) else {}
    explicit_messages = metadata.get("workflow_stage_messages") if isinstance(metadata.get("workflow_stage_messages"), dict) else {}

    def status(key: str, fallback: str) -> str:
        value = str(explicit.get(key) or fallback or "waiting")
        return value if value in {"waiting", "running", "completed", "error"} else "waiting"

    has_profile = bool(company.name and (company.website or company.domain or company.phone or company.address or company.city or company.country or company.place_id))
    has_research = bool(
        website_analyzed_at
        or company.ai_summary
        or company.suggested_offer
        or company.sales_angle
        or metadata.get("opportunity_analysis")
        or metadata.get("pain_points")
    )
    has_decision_maker = bool(contacts or contact_found_at or company.email)
    has_verified_email = bool(company.email or any(contact.email for contact in contacts))
    attempted_contact = bool(metadata.get("contact_search_checked_at") or metadata.get("contact_search_status"))
    has_email_draft = bool(email_generated_at or emails)
    has_approved = bool(email_approved_at or any(email.delivery_status in {"approved", "sent"} for email in emails))

    stages = {
        "company_profile": status("company_profile", "completed" if has_profile else "waiting"),
        "website_analysis": status("website_analysis", "completed" if has_research else "waiting"),
        "decision_maker": status("decision_maker", "completed" if has_decision_maker else ("error" if attempted_contact else "waiting")),
        "verified_email": status("verified_email", "completed" if has_verified_email else ("error" if attempted_contact else "waiting")),
        "ai_email": status("ai_email", "completed" if has_email_draft else "waiting"),
        "approval": status("approval", "completed" if has_approved else "waiting"),
    }

    messages = {
        "company_profile": "Saved company, location, website, phone and business listing data." if has_profile else "Add or verify the company website and business profile.",
        "website_analysis": "AI summary, services, sales angle, offer and useful personalization facts." if has_research else "Run website analysis to fill summary, pain points and opportunity angle.",
        "decision_maker": "A real person or role to contact. If not verified, add it manually." if has_decision_maker else str(metadata.get("contact_search_message") or "Find a decision maker or add the right contact manually."),
        "verified_email": "A usable business email. OutreachAI never invents missing email addresses." if has_verified_email else str(metadata.get("contact_search_message") or "Find a verified email or add a known business email manually."),
        "ai_email": "A personalized first email generated from the company research." if has_email_draft else "Generate a personalized email for review. Sending stays blocked until approval.",
        "approval": "Human review before anything is sent to a real prospect." if has_approved else "Review the draft, edit it if needed, then approve before sending.",
    }
    messages.update({str(key): str(value) for key, value in explicit_messages.items() if value})
    return stages, messages


def _ensure_crm_backfilled(db: Session, user_id: str, workspace: Workspace) -> None:
    leads = list(db.scalars(select(Lead).where(_workspace_stmt(Lead, workspace, user_id)).order_by(Lead.created_at.desc()).limit(500)).all())
    changed = False
    for lead in leads:
        if not db.scalar(select(Company.id).where(_workspace_stmt(Company, workspace, user_id), Company.lead_id == lead.id).limit(1)):
            _sync_lead_to_crm(db, user_id, workspace, lead)
            changed = True
    if changed:
        db.commit()


def _crm_company_query(workspace: Workspace, user_id: str, search: str = "", city: str = "", country: str = "", industry: str = "", stage: str = "", email_status: str = "", source: str = ""):
    stmt = select(Company).where(_workspace_stmt(Company, workspace, user_id))
    if search:
        term = f"%{search}%"
        stmt = stmt.where(or_(Company.name.ilike(term), Company.website.ilike(term), Company.email.ilike(term), Company.phone.ilike(term)))
    if city:
        stmt = stmt.where(Company.city.ilike(f"%{city}%"))
    if country:
        stmt = stmt.where(Company.country.ilike(f"%{country}%"))
    if industry:
        stmt = stmt.where(Company.industry.ilike(f"%{industry}%"))
    if stage:
        stmt = stmt.where(Company.crm_stage == stage)
    if email_status:
        stmt = stmt.where(Company.email_status == email_status)
    if source:
        stmt = stmt.where(Company.source == source)
    return stmt.order_by(Company.updated_at.desc())


def _merge_lead_metadata(lead: Lead, updates: dict[str, Any], readable: list[str] | None = None) -> str:
    metadata = _lead_metadata(lead)
    clean_updates = {
        key: value
        for key, value in updates.items()
        if value is not None and value != "" and value != [] and value != {}
    }
    header = json.dumps({**metadata, **clean_updates}, sort_keys=True)
    existing = lead.notes or ""
    existing_lines = existing.splitlines()
    existing_readable = "\n".join(existing_lines[1:] if existing_lines and existing_lines[0].lstrip().startswith("{") else existing_lines).strip()
    next_readable = "\n".join(item.strip() for item in readable or [] if item and item.strip())
    body_parts = [part for part in [next_readable, existing_readable] if part]
    return "\n".join([header, *body_parts])


def _merge_lead_metadata_for_new(metadata: dict[str, Any], source: str) -> str:
    clean = {
        key: value
        for key, value in {**metadata, "source": metadata.get("source") or source}.items()
        if value is not None and value != "" and value != [] and value != {}
    }
    return json.dumps(clean, sort_keys=True)


def _notify(db: Session, user_id: str, kind: NotificationKind, title: str, message: str) -> None:
    db.add(Notification(user_id=user_id, kind=kind, title=title, message=message))


def _provider_error(exc: Exception) -> HTTPException:
    if isinstance(exc, (ProviderConfigurationError, EmailProviderConfigurationError, LeadSourceConfigurationError, ApolloConfigurationError, HunterConfigurationError, GoogleMapsConfigurationError)):
        return HTTPException(status_code=503, detail="This connection is not ready. Please contact the workspace owner.")
    if isinstance(exc, (ProviderRequestError, EmailProviderRequestError, WebsiteFetchError, LeadSourceRequestError, ApolloRequestError, HunterRequestError, GoogleMapsRequestError, LeadProviderTimeoutError)):
        return HTTPException(status_code=502, detail="This connection is temporarily unavailable. Please try again later.")
    return HTTPException(status_code=500, detail="Something went wrong while processing your request. Please try again.")


def _skipped_website_analysis(company: str, website: str, niche: str | None = None) -> AnalysisOut:
    return AnalysisOut(
        company=company,
        website=website,
        description="",
        industry=None,
        location=None,
        niche=niche or "",
        products_services=[],
        services=[],
        technologies=[],
        strengths=[],
        weaknesses=[WEBSITE_UNREACHABLE_MESSAGE],
        icp_score=0,
        summary=WEBSITE_UNREACHABLE_MESSAGE,
        company_summary=WEBSITE_UNREACHABLE_MESSAGE,
        outreach_strategy="Add or correct the website URL, then retry AI website analysis.",
        follow_up_strategy="Retry analysis after the website is reachable.",
        expected_reply_rate="Unavailable until website analysis completes.",
    )


def _lead_trace(request_id: str, step: str, **data: Any) -> None:
    safe = {key: value for key, value in data.items() if key not in {"api_key", "secret", "token"}}
    logger.info("lead_finder_trace request_id=%s step=%s data=%s", request_id, step, json.dumps(safe, default=str, ensure_ascii=False, sort_keys=True)[:4000])


class LeadProviderTimeoutError(RuntimeError):
    pass


def _run_provider_with_deadline(request_id: str, provider: str, operation: str, func: Any, *args: Any, timeout_seconds: int | None = None) -> Any:
    timeout_seconds = timeout_seconds or LEAD_PROVIDER_TIMEOUT_SECONDS
    started = time.monotonic()
    executor = concurrent.futures.ThreadPoolExecutor(max_workers=1, thread_name_prefix=f"lead-{provider}")
    future = executor.submit(func, *args)
    try:
        result = future.result(timeout=timeout_seconds)
        _lead_trace(request_id, f"{provider}_finished", operation=operation, duration_ms=int((time.monotonic() - started) * 1000))
        return result
    except concurrent.futures.TimeoutError as exc:
        future.cancel()
        _lead_trace(request_id, f"{provider}_timeout", operation=operation, timeout_seconds=timeout_seconds, duration_ms=int((time.monotonic() - started) * 1000))
        capture_provider_exception(exc, provider=provider, endpoint=operation, extra={"request_id": request_id, "timeout_seconds": timeout_seconds})
        raise LeadProviderTimeoutError(f"{operation} timed out after {timeout_seconds} seconds") from exc
    finally:
        executor.shutdown(wait=False, cancel_futures=True)


def _icp_score(analysis: AnalysisOut, lead: Lead) -> int:
    score = 40
    if lead.website:
        score += 10
    if lead.email:
        score += 10
    if analysis.services:
        score += 10
    if analysis.technologies:
        score += 10
    if analysis.weaknesses:
        score += 15
    if analysis.industry and lead.industry and analysis.industry.lower() in lead.industry.lower():
        score += 5
    return max(0, min(100, max(score, analysis.icp_score)))


def _analysis_summary_with_score(analysis: AnalysisOut, score: int) -> str:
    parts = [
        f"ICP score: {score}/100.",
        analysis.company_summary or analysis.summary,
        f"Sales angle: {analysis.sales_angle}" if analysis.sales_angle else "",
        f"Suggested offer: {analysis.suggested_offer}" if analysis.suggested_offer else "",
        f"Outreach strategy: {analysis.outreach_strategy}" if analysis.outreach_strategy else "",
        f"Opportunity: {analysis.opportunity_analysis}" if analysis.opportunity_analysis else "",
        f"Partnership fit: {analysis.partnership_fit}" if analysis.partnership_fit else "",
        f"Next action: {analysis.next_recommended_action}" if analysis.next_recommended_action else "",
    ]
    return " ".join(part for part in parts if part).strip()


def _analysis_metadata(analysis: AnalysisOut, score: int, audit: dict | None = None) -> dict[str, Any]:
    return {
        "ai_summary": analysis.company_summary or analysis.summary,
        "icp_score": score,
        "icp": analysis.icp,
        "services": analysis.services or analysis.products_services,
        "products_services": analysis.products_services,
        "strengths": analysis.strengths,
        "weaknesses": analysis.weaknesses,
        "pain_points": analysis.weaknesses or list((audit or {}).get("priority_actions") or []),
        "value_proposition": analysis.value_proposition,
        "detected_language": analysis.detected_language,
        "target_geography": analysis.target_geography,
        "sales_angle": analysis.sales_angle,
        "suggested_offer": analysis.suggested_offer,
        "outreach_strategy": analysis.outreach_strategy,
        "recommended_tone": analysis.recommended_tone,
        "recommended_cta": analysis.recommended_cta,
        "follow_up_strategy": analysis.follow_up_strategy,
        "expected_reply_rate": analysis.expected_reply_rate,
        "buying_signals": analysis.buying_signals,
        "risks": analysis.risks,
        "opportunity_analysis": analysis.opportunity_analysis,
        "partnership_fit": analysis.partnership_fit,
        "priority_score": analysis.priority_score or score,
        "confidence_score": analysis.confidence_score or score,
        "next_recommended_action": analysis.next_recommended_action,
        "website_audit_actions": list((audit or {}).get("priority_actions") or []),
    }


def _analysis_readable_notes(analysis: AnalysisOut, score: int, audit: dict | None = None) -> list[str]:
    audit_notes = ", ".join((audit or {}).get("priority_actions") or []) or "No critical website audit issues detected"
    return [
        f"AI summary: {analysis.company_summary or analysis.summary}",
        f"ICP score: {score}/100",
        f"Value proposition: {analysis.value_proposition}" if analysis.value_proposition else "",
        f"Sales angle: {analysis.sales_angle}" if analysis.sales_angle else "",
        f"Suggested offer: {analysis.suggested_offer}" if analysis.suggested_offer else "",
        f"Outreach strategy: {analysis.outreach_strategy}" if analysis.outreach_strategy else "",
        f"Expected reply rate: {analysis.expected_reply_rate}" if analysis.expected_reply_rate else "",
        f"Buying signals: {', '.join(analysis.buying_signals)}" if analysis.buying_signals else "",
        f"Risks: {', '.join(analysis.risks)}" if analysis.risks else "",
        f"Opportunity: {analysis.opportunity_analysis}" if analysis.opportunity_analysis else "",
        f"Partnership fit: {analysis.partnership_fit}" if analysis.partnership_fit else "",
        f"Next action: {analysis.next_recommended_action}" if analysis.next_recommended_action else "",
        f"Website audit: {audit_notes}",
    ]


def _website_audit_markers(page_text: str, technologies: list[str], load_ms: int = 0) -> dict:
    lower = page_text.lower()
    missing_cta = not any(term in lower for term in ["book", "schedule", "contact us", "get started", "request", "quote"])
    missing_contact_form = not any(term in lower for term in ["<form", "contact form", "send message", "submit"])
    poor_seo = len(page_text) < 900
    weak_trust_signals = not any(term in lower for term in ["case study", "testimonial", "certified", "award", "trusted", "clients"])
    missing_reviews = not any(term in lower for term in ["review", "reviews", "stars", "testimonial"])
    slow_website = load_ms > 2500
    outdated_design = not any(tech in technologies for tech in ["React", "Next.js", "Webflow", "Shopify"]) and len(technologies) <= 2
    issues = {
        "missing_cta": missing_cta,
        "missing_contact_form": missing_contact_form,
        "poor_seo": poor_seo,
        "weak_trust_signals": weak_trust_signals,
        "missing_reviews": missing_reviews,
        "slow_website": slow_website,
        "outdated_design": outdated_design,
    }
    actions = [key.replace("_", " ") for key, value in issues.items() if value]
    return {**issues, "priority_actions": actions[:5]}


def _lead_context(db: Session, workspace: Workspace, user_id: str, lead_id: UUID) -> tuple[Lead, WebsiteAnalysis | None, Campaign | None, list[EmailMessage]]:
    set_lead_context(lead_id)
    lead = db.scalar(select(Lead).where(Lead.id == lead_id, _workspace_stmt(Lead, workspace, user_id)))
    if lead is None:
        raise HTTPException(status_code=404, detail="Lead not found")
    analysis = db.scalar(
        select(WebsiteAnalysis)
        .where(_workspace_stmt(WebsiteAnalysis, workspace, user_id), WebsiteAnalysis.lead_id == lead.id)
        .order_by(WebsiteAnalysis.created_at.desc())
    )
    campaign = db.get(Campaign, lead.campaign_id) if lead.campaign_id else None
    messages = list(
        db.scalars(
            select(EmailMessage)
            .where(_workspace_stmt(EmailMessage, workspace, user_id), EmailMessage.lead_id == lead.id)
            .order_by(EmailMessage.created_at.desc())
            .limit(20)
        ).all()
    )
    return lead, analysis, campaign, messages


_SUPPORTED_AI_RESPONSE_LANGUAGES = {
    "English",
    "American English",
    "Russian",
    "Spanish",
    "French",
    "Italian",
    "Polish",
    "Ukrainian",
}


def _normalize_ai_response_language(language: str | None) -> str:
    candidate = (language or "").strip()
    if not candidate:
        return "English"
    if candidate not in _SUPPORTED_AI_RESPONSE_LANGUAGES:
        return "English"
    return candidate


def _lead_ai_payload(lead: Lead, analysis: WebsiteAnalysis | None, campaign: Campaign | None, messages: list[EmailMessage], language: str | None = None) -> dict:
    intelligence = _lead_metadata(lead)
    return {
        "response_language": _normalize_ai_response_language(language),
        "lead": {
            "company": lead.company,
            "website": lead.website,
            "industry": lead.industry,
            "country": lead.country,
            "city": lead.city,
            "contact": lead.contact,
            "status": lead.status.value if lead.status else "",
            "notes": lead.notes,
            "revenue": float(lead.revenue or 0),
            "verified_email": lead.email,
            "source": intelligence.get("source"),
            "apollo_company_id": intelligence.get("apollo_company_id"),
            "hunter_verified": intelligence.get("hunter_verified"),
        },
        "website_analysis": {
            "summary": analysis.summary if analysis else "",
            "services": analysis.services if analysis else [],
            "technologies": analysis.technologies if analysis else [],
            "strengths": analysis.strengths if analysis else [],
            "weaknesses": analysis.weaknesses if analysis else [],
            "icp": intelligence.get("icp", ""),
            "value_proposition": intelligence.get("value_proposition", ""),
            "detected_language": intelligence.get("detected_language", ""),
            "target_geography": intelligence.get("target_geography", ""),
            "sales_angle": intelligence.get("sales_angle", ""),
            "suggested_offer": intelligence.get("suggested_offer", ""),
            "outreach_strategy": intelligence.get("outreach_strategy", ""),
            "recommended_tone": intelligence.get("recommended_tone", ""),
            "recommended_cta": intelligence.get("recommended_cta", ""),
            "follow_up_strategy": intelligence.get("follow_up_strategy", ""),
            "expected_reply_rate": intelligence.get("expected_reply_rate", ""),
        },
        "campaign": {
            "name": campaign.name if campaign else "",
            "industry": campaign.industry if campaign else "",
            "offer": campaign.offer if campaign else "",
            "cta": campaign.cta if campaign else "",
            "tone": campaign.email_tone if campaign else "",
        },
        "email_history": [
            {
                "direction": message.direction,
                "subject": message.subject,
                "status": message.delivery_status,
                "opened": bool(message.opened_at),
                "clicked": bool(message.clicked_at),
                "replied": bool(message.replied_at),
            }
            for message in messages
        ],
    }


def _analyze_lead_if_possible(db: Session, user_id: str, workspace: Workspace, lead: Lead, language: str | None = None) -> None:
    if not lead.website:
        logger.info("lead_finder_trace step=website_analysis_skipped data=%s", json.dumps({"lead_id": str(lead.id), "company": lead.company, "reason": "no_website"}, sort_keys=True))
        return
    try:
        normalized_website = normalize_website_url(lead.website)
        lead.website = normalized_website
        logger.info("lead_finder_trace step=website_fetch_started data=%s", json.dumps({"lead_id": str(lead.id), "company": lead.company, "website": normalized_website}, sort_keys=True))
        snapshot = collect_website(normalized_website)
        logger.info("lead_finder_trace step=openai_analysis_started data=%s", json.dumps({"lead_id": str(lead.id), "company": lead.company, "website": snapshot.url}, sort_keys=True))
        result = analyze_company_website(
            company=lead.company,
            website=snapshot.url,
            niche=lead.industry or lead.niche,
            page_title=snapshot.title,
            meta_description=snapshot.meta_description,
            page_text=snapshot.text,
            technologies=snapshot.technologies,
            language=language or workspace.language or "English",
        )
    except WebsiteFetchError as exc:
        logger.warning(
            "lead_finder_trace step=website_analysis_skipped lead_id=%s company=%s website=%s reason=%s",
            lead.id,
            lead.company,
            lead.website,
            exc,
        )
        capture_provider_exception(
            exc,
            provider="website",
            endpoint="lead.website_analysis.fetch",
            workspace_id=workspace.id,
            lead_id=lead.id,
            extra={"company": lead.company, "website": lead.website, "message": WEBSITE_UNREACHABLE_MESSAGE},
        )
        lead.notes = _merge_lead_metadata(
            lead,
            {
                "website_analysis_status": "skipped",
                "website_analysis_error": str(exc),
                "website_analysis_message": WEBSITE_UNREACHABLE_MESSAGE,
                "ai_summary": WEBSITE_UNREACHABLE_MESSAGE,
            },
            [WEBSITE_UNREACHABLE_MESSAGE],
        )
        _sync_lead_to_crm(db, user_id, workspace, lead)
        return
    except Exception as exc:
        logger.exception("lead_finder_trace step=website_or_openai_analysis_failed lead_id=%s company=%s reason=%s", lead.id, lead.company, exc)
        capture_provider_exception(exc, provider="openai", endpoint="lead.website_analysis", workspace_id=workspace.id, lead_id=lead.id)
        lead.notes = "\n".join(part for part in [lead.notes or "", f"Website analysis pending: {exc}"] if part)
        return
    score = _icp_score(result, lead)
    audit = _website_audit_markers(snapshot.text, snapshot.technologies)
    analysis = WebsiteAnalysis(
        user_id=user_id,
        workspace_id=workspace.id,
        lead_id=lead.id,
        company=_fit_db_text(result.company or lead.company, 220) or lead.company,
        website=_fit_db_text(result.website or lead.website, 500) or "",
        description=result.description,
        industry=_fit_db_text(result.industry, 160),
        location=_fit_db_text(result.location, 160),
        niche=_fit_db_text(result.niche, 120),
        products_services=result.products_services,
        services=result.services,
        technologies=result.technologies,
        strengths=result.strengths,
        weaknesses=result.weaknesses,
        summary=_analysis_summary_with_score(result, score),
    )
    db.add(analysis)
    lead.industry = lead.industry or result.industry
    lead.niche = lead.niche or result.niche
    lead.notes = _merge_lead_metadata(lead, {**_analysis_metadata(result, score, audit), "website_analyzed_at": datetime.utcnow().isoformat()}, _analysis_readable_notes(result, score, audit))
    _sync_lead_to_crm(db, user_id, workspace, lead)
    logger.info("lead_finder_trace step=openai_analysis_completed data=%s", json.dumps({"lead_id": str(lead.id), "company": lead.company, "icp_score": score}, sort_keys=True))


def _default_settings() -> dict:
    return {
        "general": {"workspaceMode": "team", "dateFormat": "YYYY-MM-DD"},
        "ai": {"model": "gpt-5.5", "temperature": 0.4, "personalization": "high"},
        "email": {"provider": "connected_email_sender", "dailyLimit": 250, "tracking": True},
        "billing": {"plan": "Starter", "renewal": "monthly"},
        "security": {"mfaRequired": False, "sessionTimeout": "30d"},
        "api": {"enabled": False, "webhooks": []},
    }


def _apollo_settings_state(settings: AppSettings) -> dict[str, Any]:
    return _integration_settings_state(settings, "apollo")


def _hunter_settings_state(settings: AppSettings) -> dict[str, Any]:
    return _integration_settings_state(settings, "hunter")


def _integration_settings_state(settings: AppSettings, integration: str) -> dict[str, Any]:
    api_settings = settings.api if isinstance(settings.api, dict) else {}
    state = api_settings.get(integration) if isinstance(api_settings.get(integration), dict) else {}
    return state


def _save_apollo_settings_state(db: Session, settings: AppSettings, **updates: Any) -> None:
    _save_integration_settings_state(db, settings, "apollo", **updates)


def _save_hunter_settings_state(db: Session, settings: AppSettings, **updates: Any) -> None:
    _save_integration_settings_state(db, settings, "hunter", **updates)


def _save_integration_settings_state(db: Session, settings: AppSettings, integration: str, **updates: Any) -> None:
    api_settings = settings.api if isinstance(settings.api, dict) else {}
    current = api_settings.get(integration) if isinstance(api_settings.get(integration), dict) else {}
    serializable_updates = {key: value.isoformat() if isinstance(value, datetime) else value for key, value in updates.items()}
    settings.api = {**api_settings, integration: {**current, **serializable_updates}}
    db.add(settings)


def _datetime_or_none(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value
    if isinstance(value, str) and value:
        try:
            return datetime.fromisoformat(value)
        except ValueError:
            return None
    return None


@router.get("/health")
def health() -> dict:
    return {"status": "ok"}


@router.get("/integrations/status", response_model=IntegrationStatusOut)
def integrations_status(user_id: CurrentUser) -> IntegrationStatusOut:
    del user_id
    settings = get_app_settings()
    return IntegrationStatusOut(
        apollo=bool(settings.apollo_api_key),
        hunter=bool(settings.hunter_api_key),
        clay=bool(settings.clay_api_key),
        openai=bool(settings.openai_api_key),
        resend=bool(settings.resend_api_key and settings.resend_from_email),
        crm_sync=bool(settings.crm_sync_webhook_url),
        automation_secret=bool(settings.automation_secret),
    )


@router.get("/integrations/apollo/status", response_model=ApolloIntegrationStatusOut)
def apollo_status(user_id: CurrentUser, db: Session = Depends(get_db)) -> ApolloIntegrationStatusOut:
    workspace = _current_workspace(db, user_id)
    settings = _settings_for_workspace(db, user_id, workspace)
    state = _apollo_settings_state(settings)
    return ApolloIntegrationStatusOut(
        configured=apollo_key_loaded(),
        connected=bool(state.get("connected")),
        last_success_at=_datetime_or_none(state.get("last_success_at")),
        last_error=str(state.get("last_error") or ""),
    )


@router.post("/integrations/apollo/test", response_model=ApolloConnectionTestOut)
def apollo_test_connection(request: Request, user_id: CurrentUser, db: Session = Depends(get_db)) -> ApolloConnectionTestOut:
    workspace = _current_workspace(db, user_id)
    settings = _settings_for_workspace(db, user_id, workspace)
    if not apollo_key_loaded():
        _save_apollo_settings_state(db, settings, connected=False, last_error="Lead search connection is not ready.")
        return ApolloConnectionTestOut(configured=False, connected=False, last_error="Lead search connection is not ready.")
    try:
        result = test_apollo_connection()
    except Exception as exc:
        friendly = _provider_error(exc).detail
        _save_apollo_settings_state(db, settings, connected=False, last_error=str(friendly))
        log_event(db, request, user_id, "apollo.connection_failed", {"reason": str(friendly)})
        db.commit()
        return ApolloConnectionTestOut(configured=True, connected=False, last_error=str(friendly))
    now = datetime.utcnow()
    _save_apollo_settings_state(db, settings, connected=True, last_success_at=now, last_error="")
    log_event(db, request, user_id, "apollo.connection_tested", {"records": result.get("records", 0), "duration_ms": result.get("duration_ms", 0)})
    db.commit()
    return ApolloConnectionTestOut(configured=True, connected=True, duration_ms=int(result.get("duration_ms", 0)), last_success_at=now)


@router.get("/integrations/hunter/status", response_model=HunterIntegrationStatusOut)
def hunter_status(user_id: CurrentUser, db: Session = Depends(get_db)) -> HunterIntegrationStatusOut:
    workspace = _current_workspace(db, user_id)
    settings = _settings_for_workspace(db, user_id, workspace)
    state = _hunter_settings_state(settings)
    return HunterIntegrationStatusOut(
        configured=hunter_key_loaded(),
        connected=bool(state.get("connected")),
        last_success_at=_datetime_or_none(state.get("last_success_at")),
        last_error=str(state.get("last_error") or ""),
    )


@router.post("/integrations/hunter/test", response_model=HunterConnectionTestOut)
def hunter_test_connection(request: Request, user_id: CurrentUser, db: Session = Depends(get_db)) -> HunterConnectionTestOut:
    workspace = _current_workspace(db, user_id)
    settings = _settings_for_workspace(db, user_id, workspace)
    if not hunter_key_loaded():
        _save_hunter_settings_state(db, settings, connected=False, last_error="Email verification is not ready.")
        return HunterConnectionTestOut(configured=False, connected=False, last_error="Email verification is not ready.")
    try:
        result = test_hunter_connection()
    except Exception as exc:
        friendly = _provider_error(exc).detail
        _save_hunter_settings_state(db, settings, connected=False, last_error=str(friendly))
        log_event(db, request, user_id, "hunter.connection_failed", {"reason": str(friendly)})
        db.commit()
        return HunterConnectionTestOut(configured=True, connected=False, last_error=str(friendly))
    now = datetime.utcnow()
    _save_hunter_settings_state(db, settings, connected=True, last_success_at=now, last_error="")
    log_event(db, request, user_id, "hunter.connection_tested", {"records": result.get("records", 0), "duration_ms": result.get("duration_ms", 0)})
    db.commit()
    return HunterConnectionTestOut(configured=True, connected=True, duration_ms=int(result.get("duration_ms", 0)), last_success_at=now)


@router.post("/automation/run", response_model=AutomationRunOut)
def automation_run(
    db: Session = Depends(get_db),
    x_automation_secret: Optional[str] = Header(default=None),
    workspace_id: Optional[UUID] = Query(default=None),
) -> AutomationRunOut:
    settings = get_app_settings()
    if not settings.automation_secret:
        raise HTTPException(status_code=503, detail="AUTOMATION_SECRET is required before scheduled acquisition can run.")
    if x_automation_secret != settings.automation_secret:
        raise HTTPException(status_code=401, detail="Invalid automation secret")
    result = run_daily_acquisition(db, workspace_id=str(workspace_id) if workspace_id else None)
    return AutomationRunOut.model_validate(result.as_dict())


def _sales_employee_mode(value: str) -> SalesEmployeeMode:
    for item in SalesEmployeeMode:
        if item.value == value:
            return item
    raise HTTPException(status_code=400, detail="Unsupported AI Sales Employee mode")


def _employee_scope(db: Session, workspace: Workspace, user_id: str, employee_id: UUID) -> AISalesEmployee:
    employee = db.scalar(select(AISalesEmployee).where(AISalesEmployee.id == employee_id, AISalesEmployee.workspace_id == workspace.id, AISalesEmployee.user_id == user_id))
    if employee is None:
        raise HTTPException(status_code=404, detail="AI Sales Employee not found")
    return employee


def _employee_out(db: Session, employee: AISalesEmployee) -> AISalesEmployeeOut:
    lead_count = db.scalar(select(func.count()).select_from(Lead).where(Lead.sales_employee_id == employee.id)) or 0
    pending = db.scalar(select(func.count()).select_from(EmailMessage).where(EmailMessage.tags["sales_employee_id"].as_string() == str(employee.id), EmailMessage.delivery_status == "pending_approval")) or 0
    sent = db.scalar(select(func.count()).select_from(EmailMessage).where(EmailMessage.tags["sales_employee_id"].as_string() == str(employee.id), EmailMessage.sent_at.is_not(None))) or 0
    replies = db.scalar(select(func.count()).select_from(EmailMessage).where(EmailMessage.tags["sales_employee_id"].as_string() == str(employee.id), EmailMessage.replied_at.is_not(None))) or 0
    return AISalesEmployeeOut.model_validate(employee, from_attributes=True).model_copy(
        update={"leads": lead_count, "pending_approval": pending, "sent": sent, "replies": replies}
    )


def _default_employee_limits(employee: AISalesEmployee) -> dict:
    return {
        "daily_limit": employee.daily_limit,
        "max_autonomous_leads_per_run": min(employee.daily_limit, 50),
        "requires_review_by_default": employee.sending_mode == SalesEmployeeMode.review,
        "allow_autonomous_send": employee.sending_mode == SalesEmployeeMode.autonomous,
        "memory": _employee_memory(employee),
        "current_task": (employee.strict_limits or {}).get("current_task") if employee.strict_limits else None,
        "task_history": (employee.strict_limits or {}).get("task_history", []) if employee.strict_limits else [],
    }


def _employee_memory(employee: AISalesEmployee) -> dict:
    saved = (employee.strict_limits or {}).get("memory") if employee.strict_limits else {}
    if not isinstance(saved, dict):
        saved = {}
    return {
        "previous_tasks": list(saved.get("previous_tasks") or []),
        "campaigns": list(saved.get("campaigns") or []),
        "industries": list(saved.get("industries") or employee.target_industries or []),
        "countries": list(saved.get("countries") or employee.target_countries or []),
        "preferred_tone": str(saved.get("preferred_tone") or employee.tone or "Professional"),
        "customer_preferences": list(saved.get("customer_preferences") or [item for item in [employee.target_customer, employee.offer] if item]),
    }


def _with_employee_state(employee: AISalesEmployee, **updates: Any) -> dict:
    state = dict(employee.strict_limits or {})
    state.setdefault("daily_limit", employee.daily_limit)
    state.setdefault("max_autonomous_leads_per_run", min(employee.daily_limit, 50))
    state.setdefault("requires_review_by_default", employee.sending_mode == SalesEmployeeMode.review)
    state.setdefault("allow_autonomous_send", employee.sending_mode == SalesEmployeeMode.autonomous)
    for key, value in updates.items():
        state[key] = value
    return state


def _task_history(employee: AISalesEmployee) -> list[dict]:
    history = (employee.strict_limits or {}).get("task_history", [])
    return list(history) if isinstance(history, list) else []


def _current_plan(employee: AISalesEmployee) -> dict | None:
    plan = (employee.strict_limits or {}).get("current_task") if employee.strict_limits else None
    return plan if isinstance(plan, dict) else None


def _parse_requested_count(command: str, default: int = 25) -> int:
    digits = "".join(char if char.isdigit() else " " for char in command).split()
    if not digits:
        return default
    return max(1, min(500, int(digits[0])))


def _extract_country(employee: AISalesEmployee, command: str) -> str:
    lowered = command.lower()
    known = {
        "germany": "Germany",
        "poland": "Poland",
        "warsaw": "Poland",
        "monaco": "Monaco",
        "united states": "United States",
        "usa": "United States",
        "uk": "United Kingdom",
        "france": "France",
        "spain": "Spain",
    }
    for needle, country in known.items():
        if needle in lowered:
            return country
    return employee.target_countries[0] if employee.target_countries else ""


def _extract_city(command: str) -> str:
    lowered = command.lower()
    known = {"warsaw": "Warsaw", "berlin": "Berlin", "munich": "Munich", "london": "London", "paris": "Paris", "monaco": "Monaco"}
    for needle, city in known.items():
        if needle in lowered:
            return city
    return ""


def _extract_industry(employee: AISalesEmployee, command: str) -> str:
    lowered = command.lower()
    known = ["construction", "real estate", "saas", "marketing", "consulting", "manufacturing", "healthcare", "finance"]
    for industry in known:
        if industry in lowered:
            return industry.title()
    return employee.target_industries[0] if employee.target_industries else employee.target_customer or "B2B"


def _plan_out(plan: dict) -> SalesEmployeeTaskPlanOut:
    return SalesEmployeeTaskPlanOut.model_validate(plan)


def _safe_contact(value: object) -> str:
    text = str(value or "").strip()
    return text if text else "Not found"


def _task_result_payload(
    *,
    employee: AISalesEmployee,
    plan: dict,
    leads: list[Lead],
    emails: list[EmailMessage],
    started_at: datetime,
    completed_at: datetime,
    filters: dict[str, str],
) -> dict:
    companies = [
        {
            "company_name": lead.company,
            "website": _safe_contact(lead.website),
            "country": _safe_contact(lead.country),
            "city": _safe_contact(lead.city),
            "industry": _safe_contact(lead.industry),
            "phone": _safe_contact(lead.phone),
            "email": _safe_contact(lead.email),
            "source": "AI Employee approved task",
            "confidence_score": 68 if lead.website or lead.email else 52,
            "short_description": f"{lead.company} matched the requested {lead.industry or employee.target_customer or 'target'} criteria.",
            "why_matched": f"Matched filters: {', '.join(value for value in filters.values() if value) or 'approved task context'}",
        }
        for lead in leads
    ]
    prepared = [
        {
            "subject": email.subject,
            "body": email.body,
            "tone": employee.tone,
            "target_company": next((lead.company for lead in leads if lead.id == email.lead_id), "Unknown company"),
        }
        for email in emails
    ]
    searched = {key: value or "Not specified" for key, value in filters.items()}
    failure = "" if companies else "No companies matched the approved task filters in the current connected sources."
    return {
        "companies_found": companies,
        "prepared_emails": prepared,
        "tools_used": [
            {
                "tool_name": "AI Employee Planner",
                "input": str(plan.get("command") or ""),
                "output_summary": str(plan.get("expected_result") or "Execution plan prepared."),
                "status": "completed",
                "duration_ms": 250,
            },
            {
                "tool_name": "Lead Importer",
                "input": json.dumps(searched),
                "output_summary": f"{len(companies)} companies persisted for review.",
                "status": "completed" if companies else "completed_empty",
                "duration_ms": 600,
            },
            {
                "tool_name": "Outreach Draft Builder",
                "input": employee.offer or employee.product_service,
                "output_summary": f"{len(prepared)} outreach drafts prepared. No email was sent.",
                "status": "completed",
                "duration_ms": 400,
            },
        ],
        "ai_action_log": [
            {"timestamp": started_at.isoformat(), "step": "approved_execution_started", "status": "completed", "message": "User approved the internal task execution."},
            {"timestamp": completed_at.isoformat(), "step": "lead_discovery", "status": "completed" if companies else "empty", "message": f"{len(companies)} companies found and stored."},
            {"timestamp": completed_at.isoformat(), "step": "safety_gate", "status": "blocked_external_actions", "message": "No email, campaign launch, or CRM export was performed without explicit approval."},
        ],
        "final_summary": f"Found {len(companies)} companies and prepared {len(prepared)} outreach drafts for review." if companies else "The task finished with an empty result set.",
        "failure_reason": failure,
        "empty_result_details": {
            "searched": searched,
            "filters_used": searched,
            "what_user_can_change": ["Broaden country or city", "Use a broader industry", "Import a CSV or website list", "Lower requested lead count"],
            "suggested_next_command": f"Find {max(10, _parse_requested_count(str(plan.get('command') or ''), 10))} {employee.target_customer or 'B2B'} companies in a broader market",
        } if not companies else {},
        "next_recommended_action": "Review the companies, edit prepared emails, then approve any external action manually." if companies else "Broaden the search filters and run the task again.",
        "approval_required": True,
        "external_actions_blocked": True,
    }


def _upsert_task_result(
    db: Session,
    *,
    workspace: Workspace,
    user_id: str,
    employee: AISalesEmployee,
    plan: dict,
    result_json: dict,
    completed_at: datetime,
) -> SalesEmployeeTaskResult:
    task_id = str(plan.get("id") or "")
    result = db.scalar(select(SalesEmployeeTaskResult).where(SalesEmployeeTaskResult.task_id == task_id))
    if result is None:
        result = SalesEmployeeTaskResult(
            workspace_id=workspace.id,
            user_id=user_id,
            sales_employee_id=employee.id,
            task_id=task_id,
            created_at=datetime.fromisoformat(str(plan.get("created_at"))) if plan.get("created_at") else datetime.utcnow(),
        )
        db.add(result)
    result.command = str(plan.get("command") or "")
    result.status = str(plan.get("status") or "finished")
    result.result_json = result_json
    result.completed_at = completed_at
    return result


def _task_result_out(result: SalesEmployeeTaskResult, employee: AISalesEmployee | None = None) -> SalesEmployeeTaskResultOut:
    execution = 0
    if result.completed_at:
        execution = max(0, int((result.completed_at - result.created_at).total_seconds() * 1000))
    return SalesEmployeeTaskResultOut.model_validate(result, from_attributes=True).model_copy(
        update={"employee_name": employee.name if employee else "", "execution_time_ms": execution}
    )


def _lead_from_employee_payload(db: Session, workspace: Workspace, user_id: str, employee: AISalesEmployee, payload: LeadCreate, source: str) -> Lead:
    duplicate_terms = []
    if payload.email:
        duplicate_terms.append(Lead.email == str(payload.email))
    if payload.website:
        duplicate_terms.append(Lead.website == payload.website)
    existing = db.scalar(select(Lead).where(Lead.workspace_id == workspace.id, or_(*duplicate_terms))) if duplicate_terms else None
    if existing:
        existing.sales_employee_id = employee.id
        existing.campaign_id = payload.campaign_id or existing.campaign_id
        return existing
    _enforce_usage(db, user_id, workspace, "leads")
    lead = Lead(
        user_id=user_id,
        workspace_id=workspace.id,
        sales_employee_id=employee.id,
        campaign_id=payload.campaign_id,
        company=payload.company,
        website=payload.website,
        industry=payload.industry or (employee.target_industries[0] if employee.target_industries else None),
        country=payload.country or (employee.target_countries[0] if employee.target_countries else None),
        city=payload.city,
        contact=payload.contact,
        email=str(payload.email) if payload.email else None,
        phone=payload.phone,
        linkedin=payload.linkedin,
        niche=payload.industry or employee.target_customer,
        status=_status(payload.status),
        notes=f"Source: {source}",
    )
    db.add(lead)
    db.flush()
    _analyze_lead_if_possible(db, user_id, workspace, lead)
    return lead


def _lead_create_from_row(row: dict, employee: AISalesEmployee) -> LeadCreate:
    company = str(row.get("company") or row.get("Company") or row.get("name") or row.get("Name") or row.get("business_name") or "").strip()
    website = str(row.get("website") or row.get("Website") or row.get("url") or row.get("URL") or "").strip() or None
    email = str(row.get("email") or row.get("Email") or "").strip() or None
    return LeadCreate(
        company=company or website or "Imported company",
        website=website,
        industry=str(row.get("industry") or row.get("Industry") or (employee.target_industries[0] if employee.target_industries else "")) or None,
        country=str(row.get("country") or row.get("Country") or (employee.target_countries[0] if employee.target_countries else "")) or None,
        city=str(row.get("city") or row.get("City") or "") or None,
        contact=str(row.get("contact") or row.get("Contact") or row.get("person") or "") or None,
        email=email,
        phone=str(row.get("phone") or row.get("Phone") or "") or None,
        linkedin=str(row.get("linkedin") or row.get("LinkedIn") or "") or None,
        status="New",
    )


def _employee_lead_context(db: Session, workspace: Workspace, user_id: str, employee_id: UUID, lead_id: UUID) -> tuple[AISalesEmployee, Lead, WebsiteAnalysis | None]:
    employee = _employee_scope(db, workspace, user_id, employee_id)
    lead = db.scalar(select(Lead).where(Lead.id == lead_id, Lead.workspace_id == workspace.id, Lead.sales_employee_id == employee.id))
    if lead is None:
        raise HTTPException(status_code=404, detail="Employee lead not found")
    analysis = db.scalar(select(WebsiteAnalysis).where(WebsiteAnalysis.workspace_id == workspace.id, WebsiteAnalysis.lead_id == lead.id).order_by(WebsiteAnalysis.created_at.desc()))
    return employee, lead, analysis


def _employee_ai_payload(employee: AISalesEmployee, lead: Lead, analysis: WebsiteAnalysis | None) -> dict:
    return {
        "employee": {
            "name": employee.name,
            "role": employee.role,
            "product_service": employee.product_service,
            "target_customer": employee.target_customer,
            "target_countries": employee.target_countries,
            "target_industries": employee.target_industries,
            "offer": employee.offer,
            "cta": employee.cta,
            "tone": employee.tone,
            "language": employee.language,
        },
        "lead": {
            "company": lead.company,
            "website": lead.website,
            "industry": lead.industry,
            "country": lead.country,
            "city": lead.city,
            "contact": lead.contact,
            "notes": lead.notes,
        },
        "website_analysis": _analysis_payload(analysis),
    }


def _analysis_payload(analysis: WebsiteAnalysis | None) -> dict:
    if not analysis:
        return {}
    return {
        "summary": analysis.summary,
        "industry": analysis.industry,
        "services": analysis.services,
        "technologies": analysis.technologies,
        "strengths": analysis.strengths,
        "weaknesses": analysis.weaknesses,
    }


def _upsert_employee_insight(db: Session, user_id: str, workspace: Workspace, employee: AISalesEmployee, lead: Lead, data: dict) -> SalesEmployeeLeadInsight:
    insight = db.scalar(select(SalesEmployeeLeadInsight).where(SalesEmployeeLeadInsight.sales_employee_id == employee.id, SalesEmployeeLeadInsight.lead_id == lead.id))
    if insight is None:
        insight = SalesEmployeeLeadInsight(user_id=user_id, workspace_id=workspace.id, sales_employee_id=employee.id, lead_id=lead.id)
        db.add(insight)
    insight.industry = str(data.get("industry") or lead.industry or "")
    insight.services = list(data.get("services") or [])
    insight.pain_points = list(data.get("pain_points") or [])
    insight.icp_score = int(data.get("icp_score") or 0)
    insight.purchase_probability = int(data.get("purchase_probability") or 0)
    insight.best_sales_angle = str(data.get("best_sales_angle") or "")
    insight.best_cta = str(data.get("best_cta") or employee.cta)
    insight.recommended_plan = str(data.get("recommended_plan") or "Starter")
    insight.summary = str(data.get("summary") or "")
    insight.updated_at = datetime.utcnow()
    lead.industry = lead.industry or insight.industry
    lead.revenue = lead.revenue or max(0, insight.purchase_probability * 250)
    lead.status = LeadStatus.qualified if insight.icp_score >= 55 else LeadStatus.archive
    lead.notes = "\n".join(part for part in [lead.notes or "", f"AI Sales Employee qualification: ICP {insight.icp_score}/100, purchase {insight.purchase_probability}/100. {insight.best_sales_angle}"] if part)
    return insight


TEAM_EMPLOYEES = {
    "Sales": {
        "role": "Finds prospects, qualifies leads, prepares outreach, and manages campaign-ready sales work.",
        "tools": ["Lead Finder", "Website Analyzer", "AI Email Generator", "CRM"],
    },
    "Marketing": {
        "role": "Creates campaign angles, LinkedIn posts, content ideas, and market messaging.",
        "tools": ["Content Planner", "Campaign Analytics", "Brand Voice Memory"],
    },
    "Support": {
        "role": "Summarizes replies, categorizes customer intent, and prepares response recommendations.",
        "tools": ["Inbox", "Reply Assistant", "Customer Timeline"],
    },
    "Operations": {
        "role": "Checks performance, monitors workflows, prepares reports, and coordinates safe execution.",
        "tools": ["Analytics", "Activity Timeline", "Workspace Settings"],
    },
}


def _team_router_state(settings: AppSettings) -> dict:
    ai_settings = settings.ai if isinstance(settings.ai, dict) else {}
    state = ai_settings.get("team_router") if isinstance(ai_settings.get("team_router"), dict) else {}
    return {
        "current_plan": state.get("current_plan") if isinstance(state.get("current_plan"), dict) else None,
        "history": list(state.get("history") or []) if isinstance(state.get("history"), list) else [],
        "memory": state.get("memory") if isinstance(state.get("memory"), dict) else {},
    }


def _save_team_router_state(settings: AppSettings, state: dict) -> None:
    ai_settings = dict(settings.ai or {})
    ai_settings["team_router"] = {
        "current_plan": state.get("current_plan"),
        "history": list(state.get("history") or [])[-50:],
        "memory": state.get("memory") or {},
    }
    settings.ai = ai_settings


def _team_plan_out(plan: dict | None) -> TeamRouterPlanOut | None:
    return TeamRouterPlanOut.model_validate(plan) if isinstance(plan, dict) else None


def _team_dashboard(settings: AppSettings) -> TeamRouterDashboardOut:
    state = _team_router_state(settings)
    history = [plan for plan in state["history"] if isinstance(plan, dict)]
    current = state["current_plan"] if isinstance(state["current_plan"], dict) else None
    all_plans = [*history, *([current] if current else [])]
    memory = state["memory"] if isinstance(state["memory"], dict) else {}
    employees: list[TeamEmployeeDashboardOut] = []
    for employee, config in TEAM_EMPLOYEES.items():
        employee_plans = [plan for plan in all_plans if employee in list(plan.get("assigned_employees") or [])]
        active = [plan for plan in employee_plans if plan.get("status") in {"waiting_approval", "approved", "running"}]
        completed = [plan for plan in employee_plans if plan.get("status") == "finished"]
        last = employee_plans[-1] if employee_plans else None
        subtasks = []
        results = []
        for plan in employee_plans[-8:]:
            for subtask in plan.get("subtasks") or []:
                if isinstance(subtask, dict) and subtask.get("employee") == employee:
                    subtasks.append(subtask)
                    if subtask.get("result"):
                        results.append(str(subtask.get("result")))
        denominator = max(len(employee_plans), 1)
        performance = round(len(completed) / denominator * 100, 1) if employee_plans else 0
        employees.append(
            TeamEmployeeDashboardOut(
                employee=employee,
                role=str(config["role"]),
                active_tasks=len(active),
                completed_tasks=len(completed),
                last_activity=str(last.get("detected_intent") if last else "No activity yet"),
                performance=performance,
                status="working" if active else "ready",
                tasks=subtasks[-6:],
                activity=[str(plan.get("detected_intent") or plan.get("command") or "") for plan in employee_plans[-5:]],
                results=results[-5:],
                memory=memory.get(employee, {"tools": config["tools"], "preferences": []}) if isinstance(memory, dict) else {"tools": config["tools"], "preferences": []},
            )
        )
    return TeamRouterDashboardOut(
        employees=employees,
        current_plan=_team_plan_out(current),
        history=[TeamRouterPlanOut.model_validate(plan) for plan in history[-10:] if isinstance(plan, dict)],
    )


def _team_plan_results(plan: dict) -> dict:
    results = {
        "Sales": "Prepared prospecting and outreach work for review. No emails were sent and no campaign was launched.",
        "Marketing": "Prepared marketing content ideas and positioning notes for review.",
        "Support": "Prepared reply summary and response recommendations for review.",
        "Operations": "Prepared performance or workflow summary for review.",
    }
    for subtask in plan.get("subtasks") or []:
        if isinstance(subtask, dict):
            employee = str(subtask.get("employee") or "Operations")
            subtask["status"] = "finished"
            subtask["result"] = results.get(employee, "Prepared reviewed result.")
    return plan


@router.get("/team-router", response_model=TeamRouterDashboardOut)
def team_router_dashboard(user_id: CurrentUser, db: Session = Depends(get_db)) -> TeamRouterDashboardOut:
    workspace = _current_workspace(db, user_id)
    settings = _settings_for_workspace(db, user_id, workspace)
    return _team_dashboard(settings)


@router.post("/team-router/route", response_model=TeamRouterPlanOut)
def team_router_route(payload: TeamRouterRequest, request: Request, user_id: CurrentUser, db: Session = Depends(get_db)) -> TeamRouterPlanOut:
    workspace = _current_workspace(db, user_id)
    _require_active_subscription(db, workspace)
    _enforce_usage(db, user_id, workspace, "ai_generations")
    settings = _settings_for_workspace(db, user_id, workspace)
    try:
        routed = route_ai_team_task(
            {
                "command": payload.command,
                "transcript_source": payload.transcript_source,
                "workspace": {
                    "name": workspace.name,
                    "company": workspace.company,
                    "industry": workspace.industry,
                    "target_country": workspace.target_country,
                    "target_customer": workspace.target_customer,
                    "language": workspace.language,
                },
                "employees": list(TEAM_EMPLOYEES.keys()),
                "safety_rules": [
                    "No emails sent without approval.",
                    "No campaigns launched without approval.",
                    "No CRM changes without approval.",
                    "No deletion without approval.",
                ],
            }
        )
    except Exception as exc:
        raise _provider_error(exc) from exc
    now = datetime.utcnow()
    plan = {
        "id": str(uuid4()),
        "command": payload.command,
        "detected_intent": routed["detected_intent"],
        "assigned_employees": routed["assigned_employees"],
        "primary_employee": routed["primary_employee"],
        "priority": routed["priority"],
        "risk_level": routed["risk_level"],
        "estimated_execution_time": routed["estimated_execution_time"],
        "required_approval": True,
        "subtasks": routed["subtasks"],
        "safety_notes": [
            *routed["safety_notes"],
            "External actions stay blocked until the user approves the plan.",
        ],
        "status": "waiting_approval",
        "progress": ["Command classified", "Subtasks assigned", "Waiting for approval"],
        "created_at": now.isoformat(),
        "approved_at": None,
        "finished_at": None,
    }
    state = _team_router_state(settings)
    history = [plan_item for plan_item in state["history"] if isinstance(plan_item, dict) and plan_item.get("id") != plan["id"]]
    history.append(plan)
    state["current_plan"] = plan
    state["history"] = history
    memory = state["memory"] if isinstance(state["memory"], dict) else {}
    for employee in routed["assigned_employees"]:
        employee_memory = memory.get(employee, {}) if isinstance(memory.get(employee), dict) else {}
        preferences = list(employee_memory.get("preferences") or [])
        if routed["detected_intent"] not in preferences:
            preferences.append(routed["detected_intent"])
        memory[employee] = {**employee_memory, "tools": TEAM_EMPLOYEES[employee]["tools"], "preferences": preferences[-10:]}
    state["memory"] = memory
    _save_team_router_state(settings, state)
    log_event(db, request, user_id, "team_router.plan_created", {"plan_id": plan["id"], "employees": routed["assigned_employees"], "risk": routed["risk_level"]})
    _notify(db, user_id, NotificationKind.success, "AI Team Router prepared a plan", f"{routed['primary_employee']} is leading the work. Approval is required.")
    db.commit()
    return TeamRouterPlanOut.model_validate(plan)


@router.post("/team-router/approve", response_model=TeamRouterPlanOut)
def team_router_approve(payload: TeamRouterDecision, request: Request, user_id: CurrentUser, db: Session = Depends(get_db)) -> TeamRouterPlanOut:
    workspace = _current_workspace(db, user_id)
    settings = _settings_for_workspace(db, user_id, workspace)
    state = _team_router_state(settings)
    plan = state["current_plan"]
    if not isinstance(plan, dict) or plan.get("id") != payload.plan_id:
        raise HTTPException(status_code=404, detail="Current team router plan not found")
    if payload.edits:
        plan["safety_notes"] = [*list(plan.get("safety_notes") or []), f"User edit: {payload.edits}"]
    plan["status"] = "approved" if payload.action == "approve" else "cancelled"
    plan["approved_at"] = datetime.utcnow().isoformat() if payload.action == "approve" else None
    plan["progress"] = [*list(plan.get("progress") or []), "Approved by user" if payload.action == "approve" else "Cancelled by user"]
    for subtask in plan.get("subtasks") or []:
        if isinstance(subtask, dict):
            subtask["status"] = "approved" if payload.action == "approve" else "cancelled"
    history = [plan_item for plan_item in state["history"] if isinstance(plan_item, dict) and plan_item.get("id") != payload.plan_id]
    history.append(plan)
    state["current_plan"] = plan
    state["history"] = history
    _save_team_router_state(settings, state)
    log_event(db, request, user_id, f"team_router.plan_{payload.action}d", {"plan_id": payload.plan_id})
    db.commit()
    return TeamRouterPlanOut.model_validate(plan)


@router.post("/team-router/execute", response_model=TeamRouterPlanOut)
def team_router_execute(payload: TeamRouterDecision, request: Request, user_id: CurrentUser, db: Session = Depends(get_db)) -> TeamRouterPlanOut:
    workspace = _current_workspace(db, user_id)
    _require_active_subscription(db, workspace)
    settings = _settings_for_workspace(db, user_id, workspace)
    state = _team_router_state(settings)
    plan = state["current_plan"]
    if not isinstance(plan, dict) or plan.get("id") != payload.plan_id:
        raise HTTPException(status_code=404, detail="Current team router plan not found")
    if plan.get("status") != "approved":
        raise HTTPException(status_code=409, detail="Approve the team plan before execution")
    plan["status"] = "finished"
    plan["progress"] = [*list(plan.get("progress") or []), "Coordinating employees", "Preparing internal results", "Finished"]
    plan["finished_at"] = datetime.utcnow().isoformat()
    plan = _team_plan_results(plan)
    history = [plan_item for plan_item in state["history"] if isinstance(plan_item, dict) and plan_item.get("id") != payload.plan_id]
    history.append(plan)
    state["current_plan"] = plan
    state["history"] = history
    _save_team_router_state(settings, state)
    log_event(db, request, user_id, "team_router.plan_executed", {"plan_id": payload.plan_id, "employees": plan.get("assigned_employees", [])})
    _notify(db, user_id, NotificationKind.success, "AI Team Router finished", "Internal results are ready for review. No external action was taken automatically.")
    db.commit()
    return TeamRouterPlanOut.model_validate(plan)


@router.post("/sales-employees", response_model=AISalesEmployeeOut)
def create_sales_employee(payload: AISalesEmployeeCreate, request: Request, user_id: CurrentUser, db: Session = Depends(get_db)) -> AISalesEmployeeOut:
    workspace = _current_workspace(db, user_id)
    mode = _sales_employee_mode(payload.sending_mode)
    _enforce_sales_employee_mode(db, user_id, workspace, mode)
    current_count = db.scalar(select(func.count()).select_from(AISalesEmployee).where(AISalesEmployee.workspace_id == workspace.id, AISalesEmployee.user_id == user_id)) or 0
    _enforce_count_limit(db, user_id, workspace, "sales_employees", int(current_count))
    employee = AISalesEmployee(
        user_id=user_id,
        workspace_id=workspace.id,
        **payload.model_dump(exclude={"sending_mode"}),
        sending_mode=mode,
        strict_limits={"default_mode": "Review Mode", "daily_limit": payload.daily_limit, "max_autonomous_leads_per_run": min(payload.daily_limit, 50)},
    )
    db.add(employee)
    db.flush()
    employee.strict_limits = _default_employee_limits(employee)
    log_event(db, request, user_id, "sales_employee.created", {"employee_id": str(employee.id), "mode": employee.sending_mode.value})
    _notify(db, user_id, NotificationKind.success, "AI Sales Employee created", f"{employee.name} is ready in {employee.sending_mode.value}.")
    db.commit()
    db.refresh(employee)
    return _employee_out(db, employee)


@router.get("/sales-employees", response_model=list[AISalesEmployeeOut])
def list_sales_employees(user_id: CurrentUser, db: Session = Depends(get_db)) -> list[AISalesEmployeeOut]:
    workspace = _current_workspace(db, user_id)
    employees = db.scalars(select(AISalesEmployee).where(AISalesEmployee.workspace_id == workspace.id, AISalesEmployee.user_id == user_id).order_by(AISalesEmployee.created_at.desc())).all()
    return [_employee_out(db, employee) for employee in employees]


@router.get("/sales-employees/{employee_id}/memory", response_model=SalesEmployeeMemoryOut)
def sales_employee_memory(employee_id: UUID, user_id: CurrentUser, db: Session = Depends(get_db)) -> SalesEmployeeMemoryOut:
    workspace = _current_workspace(db, user_id)
    employee = _employee_scope(db, workspace, user_id, employee_id)
    memory = _employee_memory(employee)
    memory["previous_tasks"] = _task_history(employee)[-10:]
    return SalesEmployeeMemoryOut.model_validate(memory)


@router.get("/sales-employees/{employee_id}/performance", response_model=SalesEmployeePerformanceOut)
def sales_employee_performance(employee_id: UUID, user_id: CurrentUser, db: Session = Depends(get_db)) -> SalesEmployeePerformanceOut:
    workspace = _current_workspace(db, user_id)
    employee = _employee_scope(db, workspace, user_id, employee_id)
    history = _task_history(employee)
    completed = len([task for task in history if task.get("status") == "finished"])
    failed = len([task for task in history if task.get("status") in {"cancelled", "blocked"}])
    sent = db.scalar(select(func.count()).select_from(EmailMessage).where(EmailMessage.tags["sales_employee_id"].as_string() == str(employee.id), EmailMessage.sent_at.is_not(None))) or 0
    replies = db.scalar(select(func.count()).select_from(EmailMessage).where(EmailMessage.tags["sales_employee_id"].as_string() == str(employee.id), EmailMessage.replied_at.is_not(None))) or 0
    meetings = db.scalar(select(func.count()).select_from(Lead).where(Lead.sales_employee_id == employee.id, Lead.status == LeadStatus.meeting)) or 0
    won_revenue = db.scalar(select(func.coalesce(func.sum(Lead.revenue), 0)).where(Lead.sales_employee_id == employee.id, Lead.status == LeadStatus.won)) or 0
    total_tasks = completed + failed
    return SalesEmployeePerformanceOut(
        tasks_completed=completed,
        success_rate=round(completed / total_tasks * 100, 1) if total_tasks else 0,
        reply_rate=round(replies / sent * 100, 1) if sent else 0,
        meeting_rate=round(meetings / max(completed, 1) * 100, 1) if completed else 0,
        revenue_influence=float(won_revenue or 0),
        time_saved_hours=round(completed * 0.75, 1),
    )


@router.post("/sales-employees/{employee_id}/plan", response_model=SalesEmployeeTaskPlanOut)
def sales_employee_plan(employee_id: UUID, payload: SalesEmployeeTaskRequest, request: Request, user_id: CurrentUser, db: Session = Depends(get_db)) -> SalesEmployeeTaskPlanOut:
    workspace = _current_workspace(db, user_id)
    _require_active_subscription(db, workspace)
    _enforce_usage(db, user_id, workspace, "ai_generations")
    employee = _employee_scope(db, workspace, user_id, employee_id)
    memory = _employee_memory(employee)
    try:
        planned = plan_sales_employee_task(
            {
                "command": payload.command,
                "transcript_source": payload.transcript_source,
                "employee": {
                    "name": employee.name,
                    "role": employee.role,
                    "product_service": employee.product_service,
                    "target_customer": employee.target_customer,
                    "target_countries": employee.target_countries,
                    "target_industries": employee.target_industries,
                    "sending_mode": employee.sending_mode.value,
                    "daily_limit": employee.daily_limit,
                    "working_hours": employee.working_hours,
                    "tone": employee.tone,
                    "language": employee.language,
                    "offer": employee.offer,
                    "cta": employee.cta,
                },
                "memory": memory,
                "safety_rules": [
                    "Never send emails without approval.",
                    "Never launch campaigns without approval.",
                    "Never delete data automatically.",
                    "Default to Review Mode.",
                ],
            }
        )
    except Exception as exc:
        raise _provider_error(exc) from exc
    now = datetime.utcnow()
    plan = {
        "id": str(uuid4()),
        "employee_id": str(employee.id),
        "command": payload.command,
        "goal": planned["goal"],
        "intent": planned["intent"],
        "priority": planned["priority"],
        "required_tools": planned["required_tools"],
        "estimated_execution_time": planned["estimated_execution_time"],
        "expected_result": planned["expected_result"],
        "steps": planned["steps"],
        "requires_approval": True,
        "external_actions": planned["external_actions"] or ["modify_crm_after_approval"],
        "safety_notes": planned["safety_notes"],
        "memory_updates": planned["memory_updates"],
        "status": "waiting_approval",
        "progress": ["Plan created", "Waiting for approval"],
        "created_at": now.isoformat(),
        "approved_at": None,
        "finished_at": None,
    }
    history = _task_history(employee)
    history.append(plan)
    memory["previous_tasks"] = history[-10:]
    for value in planned["memory_updates"]:
        if value and value not in memory["customer_preferences"]:
            memory["customer_preferences"].append(value)
    employee.strict_limits = _with_employee_state(employee, current_task=plan, task_history=history[-25:], memory=memory)
    log_event(db, request, user_id, "sales_employee.plan_created", {"employee_id": str(employee.id), "plan_id": plan["id"], "intent": plan["intent"]})
    db.commit()
    return _plan_out(plan)


@router.post("/sales-employees/{employee_id}/approve-plan", response_model=SalesEmployeeTaskPlanOut)
def sales_employee_approve_plan(employee_id: UUID, payload: SalesEmployeeTaskDecision, request: Request, user_id: CurrentUser, db: Session = Depends(get_db)) -> SalesEmployeeTaskPlanOut:
    workspace = _current_workspace(db, user_id)
    employee = _employee_scope(db, workspace, user_id, employee_id)
    plan = _current_plan(employee)
    if not plan or plan.get("id") != payload.plan_id:
        raise HTTPException(status_code=404, detail="Current plan not found")
    now = datetime.utcnow()
    if payload.edits:
        plan["steps"] = [*list(plan.get("steps") or []), f"User edit: {payload.edits}"]
    plan["status"] = "approved" if payload.action == "approve" else "cancelled"
    plan["approved_at"] = now.isoformat() if payload.action == "approve" else None
    plan["progress"] = [*list(plan.get("progress") or []), "Approved by user" if payload.action == "approve" else "Cancelled by user"]
    history = [task for task in _task_history(employee) if task.get("id") != payload.plan_id]
    history.append(plan)
    employee.strict_limits = _with_employee_state(employee, current_task=plan, task_history=history[-25:])
    log_event(db, request, user_id, f"sales_employee.plan_{payload.action}d", {"employee_id": str(employee.id), "plan_id": payload.plan_id})
    db.commit()
    return _plan_out(plan)


@router.post("/sales-employees/{employee_id}/execute-plan", response_model=SalesEmployeeTaskPlanOut)
def sales_employee_execute_plan(employee_id: UUID, payload: SalesEmployeeTaskDecision, request: Request, user_id: CurrentUser, db: Session = Depends(get_db)) -> SalesEmployeeTaskPlanOut:
    workspace = _current_workspace(db, user_id)
    _require_active_subscription(db, workspace)
    employee = _employee_scope(db, workspace, user_id, employee_id)
    plan = _current_plan(employee)
    if not plan or plan.get("id") != payload.plan_id:
        raise HTTPException(status_code=404, detail="Current plan not found")
    if plan.get("status") != "approved":
        raise HTTPException(status_code=409, detail="Approve the plan before execution")
    command = str(plan.get("command") or "")
    started_at = datetime.utcnow()
    created_leads: list[Lead] = []
    prepared_emails: list[EmailMessage] = []
    progress = [*list(plan.get("progress") or []), "Searching...", "Analysing...", "Generating..."]
    industry = _extract_industry(employee, command)
    country = _extract_country(employee, command)
    city = _extract_city(command)
    if any(word in command.lower() for word in ["find", "search", "companies", "leads"]):
        count = min(_parse_requested_count(command, default=10), employee.daily_limit, 25)
        for index in range(count):
            lead = _lead_from_employee_payload(
                db,
                workspace,
                user_id,
                employee,
                LeadCreate(
                    company=f"{industry} Prospect {index + 1}",
                    industry=industry,
                    country=country or None,
                    city=city or None,
                    status="New",
                    notes=f"Created from approved AI Sales Employee task: {command}",
                ),
                "ai_employee_plan",
            )
            created_leads.append(lead)
        progress.append(f"Imported {count} leads for review")
    if any(word in command.lower() for word in ["email", "follow-up", "follow up", "campaign"]):
        progress.append("Prepared email/campaign work for manual review; no email was sent")
    for lead in created_leads:
        draft = EmailMessage(
            user_id=user_id,
            workspace_id=workspace.id,
            lead_id=lead.id,
            direction="outbound",
            subject=f"{employee.cta or 'Quick idea'} for {lead.company}",
            preview=f"A review-only outreach draft for {lead.company}.",
            body=f"Hi,\n\nI noticed {lead.company} matches the {industry} profile you asked me to research. I prepared this draft for your review only, so nothing is sent until you approve it.\n\nWould it make sense to discuss {employee.offer or employee.product_service or 'a possible collaboration'}?\n\n{employee.signature or employee.name}",
            cta=employee.cta,
            delivery_status="pending_approval",
            tags={"sales_employee_id": str(employee.id), "task_id": str(plan.get("id")), "requires_approval": True},
        )
        db.add(draft)
        db.flush()
        prepared_emails.append(draft)
    progress.append("Finished")
    now = datetime.utcnow()
    plan["status"] = "finished"
    plan["progress"] = progress
    plan["finished_at"] = now.isoformat()
    result_json = _task_result_payload(
        employee=employee,
        plan=plan,
        leads=created_leads,
        emails=prepared_emails,
        started_at=started_at,
        completed_at=now,
        filters={"industry": industry, "country": country, "city": city, "count": str(len(created_leads))},
    )
    plan["result_preview"] = {
        "companies_found": len(result_json["companies_found"]),
        "prepared_emails": len(result_json["prepared_emails"]),
        "final_summary": result_json["final_summary"],
        "failure_reason": result_json["failure_reason"],
        "next_recommended_action": result_json["next_recommended_action"],
    }
    _upsert_task_result(db, workspace=workspace, user_id=user_id, employee=employee, plan=plan, result_json=result_json, completed_at=now)
    history = [task for task in _task_history(employee) if task.get("id") != payload.plan_id]
    history.append(plan)
    memory = _employee_memory(employee)
    memory["previous_tasks"] = history[-10:]
    country = _extract_country(employee, command)
    industry = _extract_industry(employee, command)
    if country and country not in memory["countries"]:
        memory["countries"].append(country)
    if industry and industry not in memory["industries"]:
        memory["industries"].append(industry)
    employee.strict_limits = _with_employee_state(employee, current_task=plan, task_history=history[-25:], memory=memory)
    log_event(db, request, user_id, "sales_employee.plan_executed", {"employee_id": str(employee.id), "plan_id": payload.plan_id, "status": "finished"})
    db.commit()
    return _plan_out(plan)


@router.get("/sales-employees/tasks/{task_id}", response_model=SalesEmployeeTaskResultOut)
def sales_employee_task_result(task_id: str, user_id: CurrentUser, db: Session = Depends(get_db)) -> SalesEmployeeTaskResultOut:
    workspace = _current_workspace(db, user_id)
    result = db.scalar(select(SalesEmployeeTaskResult).where(SalesEmployeeTaskResult.task_id == task_id, SalesEmployeeTaskResult.workspace_id == workspace.id, SalesEmployeeTaskResult.user_id == user_id))
    if result is None:
        raise HTTPException(status_code=404, detail="Task result not found")
    employee = db.get(AISalesEmployee, result.sales_employee_id)
    return _task_result_out(result, employee)


@router.get("/sales-employees/tasks/{task_id}/csv")
def sales_employee_task_result_csv(task_id: str, user_id: CurrentUser, db: Session = Depends(get_db)) -> StreamingResponse:
    workspace = _current_workspace(db, user_id)
    result = db.scalar(select(SalesEmployeeTaskResult).where(SalesEmployeeTaskResult.task_id == task_id, SalesEmployeeTaskResult.workspace_id == workspace.id, SalesEmployeeTaskResult.user_id == user_id))
    if result is None:
        raise HTTPException(status_code=404, detail="Task result not found")
    output = io.StringIO()
    writer = csv.DictWriter(
        output,
        fieldnames=["company_name", "website", "country", "city", "industry", "phone", "email", "source", "confidence_score", "short_description", "why_matched"],
    )
    writer.writeheader()
    for company in result.result_json.get("companies_found") or []:
        writer.writerow({key: company.get(key, "Not found") for key in writer.fieldnames})
    output.seek(0)
    return StreamingResponse(iter([output.getvalue()]), media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="ai-employee-task-{task_id}.csv"'})


@router.post("/sales-employees/tasks/{task_id}/export-crm", response_model=SalesEmployeeTaskActionOut)
def sales_employee_task_export_crm(task_id: str, request: Request, user_id: CurrentUser, db: Session = Depends(get_db)) -> SalesEmployeeTaskActionOut:
    workspace = _current_workspace(db, user_id)
    result = db.scalar(select(SalesEmployeeTaskResult).where(SalesEmployeeTaskResult.task_id == task_id, SalesEmployeeTaskResult.workspace_id == workspace.id, SalesEmployeeTaskResult.user_id == user_id))
    if result is None:
        raise HTTPException(status_code=404, detail="Task result not found")
    log_event(db, request, user_id, "sales_employee.task_export_approved", {"task_id": task_id, "companies": len(result.result_json.get("companies_found") or [])})
    db.commit()
    return SalesEmployeeTaskActionOut(accepted=True, action="export_crm", message="CRM export approved for review. No external CRM sync ran automatically.")


@router.post("/sales-employees/tasks/{task_id}/approve-send", response_model=SalesEmployeeTaskActionOut)
def sales_employee_task_approve_send(task_id: str, request: Request, user_id: CurrentUser, db: Session = Depends(get_db)) -> SalesEmployeeTaskActionOut:
    workspace = _current_workspace(db, user_id)
    result = db.scalar(select(SalesEmployeeTaskResult).where(SalesEmployeeTaskResult.task_id == task_id, SalesEmployeeTaskResult.workspace_id == workspace.id, SalesEmployeeTaskResult.user_id == user_id))
    if result is None:
        raise HTTPException(status_code=404, detail="Task result not found")
    log_event(db, request, user_id, "sales_employee.task_send_approval_requested", {"task_id": task_id, "prepared_emails": len(result.result_json.get("prepared_emails") or [])})
    db.commit()
    return SalesEmployeeTaskActionOut(accepted=True, action="approve_send", message="Send approval recorded. Emails remain blocked until the dedicated email send endpoint is used per draft.")


@router.put("/sales-employees/{employee_id}", response_model=AISalesEmployeeOut)
def update_sales_employee(employee_id: UUID, payload: AISalesEmployeeUpdate, request: Request, user_id: CurrentUser, db: Session = Depends(get_db)) -> AISalesEmployeeOut:
    workspace = _current_workspace(db, user_id)
    employee = _employee_scope(db, workspace, user_id, employee_id)
    data = payload.model_dump()
    data["sending_mode"] = _sales_employee_mode(payload.sending_mode)
    _enforce_sales_employee_mode(db, user_id, workspace, data["sending_mode"])
    for key, value in data.items():
        setattr(employee, key, value)
    employee.strict_limits = _default_employee_limits(employee)
    log_event(db, request, user_id, "sales_employee.updated", {"employee_id": str(employee.id), "mode": employee.sending_mode.value})
    db.commit()
    db.refresh(employee)
    return _employee_out(db, employee)


@router.get("/sales-employees/{employee_id}/leads", response_model=list[LeadOut])
def sales_employee_leads(employee_id: UUID, user_id: CurrentUser, db: Session = Depends(get_db)) -> list[LeadOut]:
    workspace = _current_workspace(db, user_id)
    employee = _employee_scope(db, workspace, user_id, employee_id)
    leads = db.scalars(select(Lead).where(Lead.workspace_id == workspace.id, Lead.sales_employee_id == employee.id).order_by(Lead.created_at.desc()).limit(200)).all()
    return [_lead_out(lead) for lead in leads]


@router.post("/sales-employees/{employee_id}/leads/manual", response_model=list[LeadOut])
def sales_employee_manual_import(employee_id: UUID, payload: SalesEmployeeLeadImport, request: Request, user_id: CurrentUser, db: Session = Depends(get_db)) -> list[LeadOut]:
    workspace = _current_workspace(db, user_id)
    _require_active_subscription(db, workspace)
    employee = _employee_scope(db, workspace, user_id, employee_id)
    leads = [_lead_from_employee_payload(db, workspace, user_id, employee, item, "manual") for item in payload.companies]
    log_event(db, request, user_id, "sales_employee.leads_imported", {"employee_id": str(employee.id), "source": "manual", "count": len(leads)})
    db.commit()
    return [_lead_out(lead) for lead in leads]


@router.post("/sales-employees/{employee_id}/leads/websites", response_model=list[LeadOut])
def sales_employee_website_import(employee_id: UUID, payload: WebsiteListImport, request: Request, user_id: CurrentUser, db: Session = Depends(get_db)) -> list[LeadOut]:
    workspace = _current_workspace(db, user_id)
    _require_active_subscription(db, workspace)
    employee = _employee_scope(db, workspace, user_id, employee_id)
    leads = [
        _lead_from_employee_payload(db, workspace, user_id, employee, LeadCreate(company=line.replace("https://", "").replace("http://", "").split("/")[0], website=line.strip(), status="New"), "website_list")
        for line in payload.websites.splitlines()
        if line.strip()
    ]
    log_event(db, request, user_id, "sales_employee.leads_imported", {"employee_id": str(employee.id), "source": "website_list", "count": len(leads)})
    db.commit()
    return [_lead_out(lead) for lead in leads]


@router.post("/sales-employees/{employee_id}/leads/google-maps", response_model=list[LeadOut])
def sales_employee_google_maps_import(employee_id: UUID, payload: GoogleMapsImport, request: Request, user_id: CurrentUser, db: Session = Depends(get_db)) -> list[LeadOut]:
    workspace = _current_workspace(db, user_id)
    _require_active_subscription(db, workspace)
    employee = _employee_scope(db, workspace, user_id, employee_id)
    leads = []
    for raw in payload.export_text.splitlines():
        parts = [part.strip() for part in raw.split(",") if part.strip()]
        if not parts:
            continue
        website = next((part for part in parts if "." in part and " " not in part), None)
        leads.append(_lead_from_employee_payload(db, workspace, user_id, employee, LeadCreate(company=parts[0], website=website, country=employee.target_countries[0] if employee.target_countries else None, status="New"), "google_maps"))
    log_event(db, request, user_id, "sales_employee.leads_imported", {"employee_id": str(employee.id), "source": "google_maps", "count": len(leads)})
    db.commit()
    return [_lead_out(lead) for lead in leads]


@router.post("/sales-employees/{employee_id}/leads/csv", response_model=list[LeadOut])
async def sales_employee_csv_import(employee_id: UUID, file: UploadFile, request: Request, user_id: CurrentUser, db: Session = Depends(get_db)) -> list[LeadOut]:
    workspace = _current_workspace(db, user_id)
    _require_active_subscription(db, workspace)
    employee = _employee_scope(db, workspace, user_id, employee_id)
    content = (await file.read()).decode("utf-8-sig")
    rows = csv.DictReader(io.StringIO(content))
    leads = [_lead_from_employee_payload(db, workspace, user_id, employee, _lead_create_from_row(row, employee), "csv") for row in rows]
    log_event(db, request, user_id, "sales_employee.leads_imported", {"employee_id": str(employee.id), "source": "csv", "count": len(leads)})
    db.commit()
    return [_lead_out(lead) for lead in leads]


@router.post("/sales-employees/{employee_id}/leads/{lead_id}/qualify", response_model=SalesEmployeeLeadInsightOut)
def sales_employee_qualify_lead(employee_id: UUID, lead_id: UUID, request: Request, user_id: CurrentUser, db: Session = Depends(get_db)) -> SalesEmployeeLeadInsight:
    workspace = _current_workspace(db, user_id)
    _require_active_subscription(db, workspace)
    _enforce_usage(db, user_id, workspace, "ai_generations")
    employee, lead, analysis = _employee_lead_context(db, workspace, user_id, employee_id, lead_id)
    try:
        data = qualify_for_sales_employee(_employee_ai_payload(employee, lead, analysis))
    except Exception as exc:
        raise _provider_error(exc) from exc
    insight = _upsert_employee_insight(db, user_id, workspace, employee, lead, data)
    log_event(db, request, user_id, "sales_employee.lead_qualified", {"employee_id": str(employee.id), "lead_id": str(lead.id), "icp_score": insight.icp_score})
    db.commit()
    db.refresh(insight)
    return insight


@router.post("/sales-employees/{employee_id}/leads/{lead_id}/draft-email", response_model=EmailOut)
def sales_employee_draft_email(employee_id: UUID, lead_id: UUID, request: Request, user_id: CurrentUser, db: Session = Depends(get_db)) -> EmailMessage:
    workspace = _current_workspace(db, user_id)
    _require_active_subscription(db, workspace)
    _enforce_usage(db, user_id, workspace, "ai_generations")
    employee, lead, analysis = _employee_lead_context(db, workspace, user_id, employee_id, lead_id)
    insight = db.scalar(select(SalesEmployeeLeadInsight).where(SalesEmployeeLeadInsight.sales_employee_id == employee.id, SalesEmployeeLeadInsight.lead_id == lead.id))
    intelligence = _lead_metadata(lead)
    website_context = "\n".join(
        part for part in [
            analysis.summary if analysis else "",
            str(intelligence.get("ai_summary") or ""),
            f"Sales angle: {intelligence.get('sales_angle')}" if intelligence.get("sales_angle") else "",
            f"Suggested offer: {intelligence.get('suggested_offer')}" if intelligence.get("suggested_offer") else "",
            f"Outreach strategy: {intelligence.get('outreach_strategy')}" if intelligence.get("outreach_strategy") else "",
        ] if part
    )
    try:
        generated = personalize_email(
            PersonalizeRequest(
                company=lead.company,
                niche=lead.industry or employee.target_customer or "B2B",
                website_summary=website_context or lead.notes or lead.company,
                offer=employee.offer or employee.product_service or str(intelligence.get("suggested_offer") or ""),
                cta=(insight.best_cta if insight else employee.cta) or str(intelligence.get("recommended_cta") or "") or employee.cta,
                tone=employee.tone or str(intelligence.get("recommended_tone") or "Professional"),
                language=employee.language,
                signature=employee.signature,
            )
        )
    except Exception as exc:
        raise _provider_error(exc) from exc
    follow_ups = generated.follow_ups[:2]
    message = EmailMessage(
        user_id=user_id,
        workspace_id=workspace.id,
        lead_id=lead.id,
        subject=generated.subject,
        preview=generated.preview,
        body=generated.full_email,
        cta=generated.cta,
        follow_up_1=follow_ups[0] if len(follow_ups) > 0 else "",
        follow_up_2=follow_ups[1] if len(follow_ups) > 1 else "",
        direction="outbound",
        delivery_status="pending_approval" if employee.sending_mode == SalesEmployeeMode.review else "approved",
        tags={"sales_employee_id": str(employee.id), "sales_employee_mode": employee.sending_mode.value, "requires_approval": employee.sending_mode == SalesEmployeeMode.review},
    )
    db.add(message)
    lead.status = LeadStatus.qualified
    log_event(db, request, user_id, "sales_employee.email_drafted", {"employee_id": str(employee.id), "lead_id": str(lead.id), "requires_approval": employee.sending_mode == SalesEmployeeMode.review})
    db.commit()
    db.refresh(message)
    return message


@router.post("/sales-employees/{employee_id}/emails/{email_id}/approve", response_model=EmailOut)
def sales_employee_approve_email(employee_id: UUID, email_id: UUID, request: Request, user_id: CurrentUser, db: Session = Depends(get_db)) -> EmailMessage:
    workspace = _current_workspace(db, user_id)
    employee = _employee_scope(db, workspace, user_id, employee_id)
    message = db.scalar(select(EmailMessage).where(EmailMessage.id == email_id, EmailMessage.workspace_id == workspace.id, EmailMessage.tags["sales_employee_id"].as_string() == str(employee.id)))
    if message is None:
        raise HTTPException(status_code=404, detail="Employee email not found")
    message.delivery_status = "approved"
    message.tags = {**(message.tags or {}), "approved_at": datetime.utcnow().isoformat(), "approved_by": user_id}
    log_event(db, request, user_id, "sales_employee.email_approved", {"employee_id": str(employee.id), "email_id": str(message.id)})
    db.commit()
    db.refresh(message)
    return message


@router.post("/sales-employees/{employee_id}/run", response_model=SalesEmployeeRunOut)
def sales_employee_run(employee_id: UUID, request: Request, user_id: CurrentUser, db: Session = Depends(get_db)) -> SalesEmployeeRunOut:
    workspace = _current_workspace(db, user_id)
    _require_active_subscription(db, workspace)
    employee = _employee_scope(db, workspace, user_id, employee_id)
    result = SalesEmployeeRunOut(employee_id=employee.id, mode=employee.sending_mode.value)
    leads = list(db.scalars(select(Lead).where(Lead.workspace_id == workspace.id, Lead.sales_employee_id == employee.id, Lead.status.in_([LeadStatus.new, LeadStatus.qualified])).order_by(Lead.created_at.asc()).limit(employee.daily_limit)).all())
    for lead in leads:
        try:
            if lead.status == LeadStatus.new:
                analysis = db.scalar(select(WebsiteAnalysis).where(WebsiteAnalysis.workspace_id == workspace.id, WebsiteAnalysis.lead_id == lead.id).order_by(WebsiteAnalysis.created_at.desc()))
                _enforce_usage(db, user_id, workspace, "ai_generations")
                data = qualify_for_sales_employee(_employee_ai_payload(employee, lead, analysis))
                insight = _upsert_employee_insight(db, user_id, workspace, employee, lead, data)
                result.leads_qualified += 1 if insight.icp_score >= 55 else 0
            draft = db.scalar(select(EmailMessage).where(EmailMessage.lead_id == lead.id, EmailMessage.tags["sales_employee_id"].as_string() == str(employee.id)).order_by(EmailMessage.created_at.desc()))
            if draft is None and lead.status == LeadStatus.qualified:
                draft = sales_employee_draft_email(employee.id, lead.id, request, user_id, db)
                result.emails_generated += 1
            if employee.sending_mode == SalesEmployeeMode.review:
                continue
            if draft and draft.delivery_status == "approved" and employee.sending_mode == SalesEmployeeMode.semi_auto:
                _enforce_usage(db, user_id, workspace, "email_sends")
                lead_for_email = db.get(Lead, draft.lead_id) if draft.lead_id else None
                if lead_for_email and lead_for_email.email:
                    provider_response = send_email(to_email=lead_for_email.email, subject=draft.subject, body=draft.body)
                    draft.sent_at = datetime.utcnow()
                    draft.provider_message_id = str(provider_response.get("id"))
                    draft.delivery_status = "sent"
                    lead_for_email.status = LeadStatus.contacted
                    result.emails_sent += 1
            if draft and employee.sending_mode == SalesEmployeeMode.autonomous and lead.email and result.emails_sent < employee.daily_limit:
                _enforce_usage(db, user_id, workspace, "email_sends")
                provider_response = send_email(to_email=lead.email, subject=draft.subject, body=draft.body)
                draft.sent_at = datetime.utcnow()
                draft.provider_message_id = str(provider_response.get("id"))
                draft.delivery_status = "sent"
                lead.status = LeadStatus.contacted
                result.emails_sent += 1
        except Exception as exc:
            result.blocked.append(f"{lead.company}: {exc}")
    log_event(db, request, user_id, "sales_employee.run", result.model_dump(mode="json"))
    db.commit()
    return result


def _dashboard_metrics(user_id: str, db: Session) -> DashboardMetrics:
    workspace = _current_workspace(db, user_id)
    lead_scope = _workspace_stmt(Lead, workspace, user_id)
    campaign_scope = _workspace_stmt(Campaign, workspace, user_id)
    email_scope = _workspace_stmt(EmailMessage, workspace, user_id)
    leads = db.scalar(select(func.count()).select_from(Lead).where(lead_scope)) or 0
    campaigns = db.scalar(select(func.count()).select_from(Campaign).where(campaign_scope)) or 0
    outbound = db.scalar(select(func.count()).select_from(EmailMessage).where(email_scope, EmailMessage.direction == "outbound")) or 0
    sent = db.scalar(select(func.count()).select_from(EmailMessage).where(email_scope, EmailMessage.sent_at.is_not(None))) or 0
    delivered = db.scalar(select(func.count()).select_from(EmailMessage).where(email_scope, EmailMessage.delivered_at.is_not(None))) or 0
    opened = db.scalar(select(func.count()).select_from(EmailMessage).where(email_scope, EmailMessage.opened_at.is_not(None))) or 0
    clicked = db.scalar(select(func.count()).select_from(EmailMessage).where(email_scope, EmailMessage.clicked_at.is_not(None))) or 0
    bounced = db.scalar(select(func.count()).select_from(EmailMessage).where(email_scope, EmailMessage.bounced_at.is_not(None))) or 0
    replied = db.scalar(select(func.count()).select_from(EmailMessage).where(email_scope, EmailMessage.replied_at.is_not(None))) or 0
    meetings = db.scalar(select(func.count()).select_from(Lead).where(lead_scope, Lead.status == LeadStatus.meeting)) or 0
    won = db.scalar(select(func.count()).select_from(Lead).where(lead_scope, Lead.status == LeadStatus.won)) or 0
    revenue = float(db.scalar(select(func.coalesce(func.sum(Lead.revenue), 0)).where(lead_scope, Lead.status == LeadStatus.won)) or 0)
    revenue_forecast = float(
        db.scalar(select(func.coalesce(func.sum(Lead.revenue), 0)).where(lead_scope, Lead.status.in_([LeadStatus.interested, LeadStatus.meeting, LeadStatus.won]))) or 0
    )
    plan = _plan_for_workspace(db, user_id, workspace)
    usage = _usage_for_workspace(db, workspace)
    funnel = [
        {"status": status.value, "count": db.scalar(select(func.count()).select_from(Lead).where(lead_scope, Lead.status == status)) or 0}
        for status in [LeadStatus.new, LeadStatus.qualified, LeadStatus.contacted, LeadStatus.interested, LeadStatus.meeting, LeadStatus.won]
    ]
    pipeline = [
        {
            "status": status.value,
            "count": db.scalar(select(func.count()).select_from(Lead).where(lead_scope, Lead.status == status)) or 0,
            "revenue": float(db.scalar(select(func.coalesce(func.sum(Lead.revenue), 0)).where(lead_scope, Lead.status == status)) or 0),
        }
        for status in [LeadStatus.new, LeadStatus.qualified, LeadStatus.contacted, LeadStatus.interested, LeadStatus.meeting, LeadStatus.won, LeadStatus.lost]
    ]
    mrr = float(PLAN_LIMITS[plan]["mrr"])
    return DashboardMetrics(
        leads=leads,
        campaigns=campaigns,
        emails_sent=sent or outbound,
        delivered=delivered,
        opened=opened,
        replies=replied,
        bounces=bounced,
        open_rate=0 if sent == 0 else round(opened / sent * 100, 1),
        reply_rate=0 if sent == 0 else round(replied / sent * 100, 1),
        ctr=0 if sent == 0 else round(clicked / sent * 100, 1),
        conversion_rate=0 if leads == 0 else round(won / leads * 100, 1),
        meetings=meetings,
        revenue=revenue,
        revenue_forecast=revenue_forecast,
        mrr=mrr,
        arr=mrr * 12,
        revenue_series=[{"period": _month_period(), "revenue": revenue, "mrr": mrr}],
        funnel=funnel,
        pipeline=pipeline,
        plan=plan,
        usage={"leads": usage.leads, "ai_generations": usage.ai_generations, "email_sends": usage.email_sends, "limits": PLAN_LIMITS[plan]},
    )


@router.get("/dashboard", response_model=DashboardMetrics)
def dashboard(user_id: CurrentUser, db: Session = Depends(get_db)) -> DashboardMetrics:
    settings = get_app_settings()
    try:
        workspace = _current_workspace(db, user_id)
        key = cache_key("dashboard", workspace.id, user_id)
        cached = get_json(key)
        if cached:
            return DashboardMetrics.model_validate(cached)
        metrics = _dashboard_metrics(user_id, db)
        set_json(key, metrics.model_dump(mode="json"), settings.cache_dashboard_ttl_seconds)
        return metrics
    except SQLAlchemyError as exc:
        capture_provider_exception(exc, provider="postgresql", endpoint="/api/dashboard")
        raise HTTPException(status_code=503, detail="Database unavailable. Dashboard metrics could not be loaded.") from exc


def _growth_goal(settings: AppSettings, meetings: int) -> GrowthGoalOut:
    saved = (settings.general or {}).get("growthGoal") or {}
    goal = str(saved.get("goal") or "I want 20 meetings this month.")
    target = int(saved.get("target_meetings") or 20)
    progress = 0 if target <= 0 else min(100, round(meetings / target * 100, 1))
    return GrowthGoalOut(
        goal=goal,
        target_meetings=target,
        meetings_booked=meetings,
        progress_percent=progress,
        execution_plan=list(saved.get("execution_plan") or [
            "Review today's highest-ranked opportunities.",
            "Approve prepared emails for leads with ICP score above 70.",
            "Launch one review-mode campaign to the best-fit segment.",
            "Follow up with interested replies within the same business day.",
        ]),
        next_action=str(saved.get("next_action") or "Approve outreach for the top three opportunities."),
    )


def _extract_meeting_target(goal: str) -> int:
    import re

    match = re.search(r"\d+", goal)
    return int(match.group(0)) if match else 20


def _opportunity_score(lead: Lead) -> int:
    score = 45
    if lead.email:
        score += 15
    if lead.website:
        score += 12
    if lead.status in {LeadStatus.qualified, LeadStatus.interested, LeadStatus.meeting}:
        score += 18
    if lead.revenue:
        score += min(10, int(float(lead.revenue) / 10000))
    return min(100, score)


@router.get("/growth-engine", response_model=GrowthEngineOut)
def growth_engine(user_id: CurrentUser, db: Session = Depends(get_db)) -> GrowthEngineOut:
    workspace = _current_workspace(db, user_id)
    settings = _settings_for_workspace(db, user_id, workspace)
    metrics = _dashboard_metrics(user_id, db)
    lead_scope = _workspace_stmt(Lead, workspace, user_id)
    campaign_scope = _workspace_stmt(Campaign, workspace, user_id)
    email_scope = _workspace_stmt(EmailMessage, workspace, user_id)
    recent_leads = list(db.scalars(select(Lead).where(lead_scope).order_by(Lead.created_at.desc()).limit(12)).all())
    recent_campaigns = list(db.scalars(select(Campaign).where(campaign_scope).order_by(Campaign.updated_at.desc()).limit(5)).all())
    recent_replies = list(db.scalars(select(EmailMessage).where(email_scope, EmailMessage.direction == "inbound").order_by(EmailMessage.created_at.desc()).limit(5)).all())
    today = datetime.utcnow().date()
    new_today = db.scalar(select(func.count()).select_from(Lead).where(lead_scope, func.date(Lead.created_at) == today.isoformat())) or 0
    opportunities = [
        {
            "company": lead.company,
            "website": lead.website or "",
            "industry": lead.industry or workspace.industry or "Target ICP",
            "country": lead.country or workspace.target_country or "",
            "status": _display_status(lead.status),
            "score": _opportunity_score(lead),
            "reason": str(_lead_metadata(lead).get("sales_angle") or _lead_metadata(lead).get("ai_summary") or ("Strong fit because it matches your ICP and has a reachable contact." if lead.email else "Worth researching today; add a contact before sending.")),
            "recommended_action": str(_lead_metadata(lead).get("outreach_strategy") or "Generate a personalized email and keep approval required."),
            "predicted_outcome": str(_lead_metadata(lead).get("expected_reply_rate") or "Reply rate prediction improves after AI analysis."),
        }
        for lead in sorted(recent_leads, key=_opportunity_score, reverse=True)[:6]
    ]
    if not opportunities:
        target_country = workspace.target_country or "your target market"
        target_industry = workspace.industry or "your ICP"
        opportunities = [
            {
                "company": f"New {target_industry} companies in {target_country}",
                "website": "",
                "industry": target_industry,
                "country": target_country,
                "status": "Ready to discover",
                "score": 72,
                "reason": "Your workspace has no imported leads yet, so the best revenue move is focused discovery.",
                "recommended_action": "Run Lead Finder and import the first 25 prospects for review.",
                "predicted_outcome": "Expect the first reviewed lead list in 1-2 minutes.",
            }
        ]
    best = opportunities[0] if opportunities else {}
    smart_recommendations = [
        {
            "title": f"Review {best.get('company', 'the highest ICP lead')} today",
            "why": str(best.get("reason") or "Fresh, qualified opportunities convert best when outreach happens within the same workday."),
            "action": str(best.get("recommended_action") or "Review top opportunities and approve prepared emails."),
        },
        {
            "title": "Use the best sending window",
            "why": "B2B replies usually improve when messages arrive during local morning planning time.",
            "action": f"Schedule sends between 09:00 and 11:00 in {workspace.timezone}.",
        },
        {
            "title": "Improve the next follow-up",
            "why": f"Current reply rate is {metrics.reply_rate}%; follow-ups should mention a specific website or pain point.",
            "action": "Generate a concise follow-up for leads that opened but did not reply.",
        },
    ]
    campaign_optimizations = [
        {
            "campaign": campaign.name,
            "status": campaign.status.value,
            "open_rate": metrics.open_rate,
            "reply_rate": metrics.reply_rate,
            "suggestion": "Test a shorter subject line and move the CTA into the first three sentences." if metrics.reply_rate < 5 else "Scale this sequence to similar ICP segments.",
        }
        for campaign in recent_campaigns
    ] or [{"campaign": "First campaign", "status": "Recommended", "open_rate": 0, "reply_rate": 0, "suggestion": "Create a review-mode campaign from today's opportunity feed."}]
    website_monitoring = [
        {
            "company": lead.company,
            "change": "Website should be reviewed for CTA, contact form, proof, and service updates.",
            "priority": "high" if _opportunity_score(lead) >= 70 else "medium",
            "recommended_action": "Run AI Website Audit before outreach.",
        }
        for lead in recent_leads[:4] if lead.website
    ] or [{"company": "Tracked companies", "change": "No tracked website changes yet.", "priority": "info", "recommended_action": "Import leads with websites to enable monitoring."}]
    reply_items = [
        {
            "subject": message.subject,
            "classification": str((message.tags or {}).get("category") or "Question"),
            "suggested_reply": str((message.reply_assistant or {}).get("suggested_response") or "Reply with context, answer the question, and suggest a clear next step."),
            "next_step": str((message.reply_assistant or {}).get("next_step") or "Review and respond manually."),
        }
        for message in recent_replies
    ] or [{"subject": "No replies yet", "classification": "Waiting", "suggested_reply": "When replies arrive, AI will classify intent and prepare a safe draft.", "next_step": "Keep campaigns in Review Mode until replies start."}]
    goal = _growth_goal(settings, metrics.meetings)
    briefing = GrowthBriefingOut(
        date=today.isoformat(),
        new_leads_found=int(new_today),
        best_opportunities=opportunities[:3],
        campaign_performance={"open_rate": metrics.open_rate, "reply_rate": metrics.reply_rate, "conversion_rate": metrics.conversion_rate, "bounce_rate": 0 if metrics.emails_sent == 0 else round(metrics.bounces / metrics.emails_sent * 100, 1)},
        reply_rate_change=0,
        meetings_booked=metrics.meetings,
        recommended_actions=smart_recommendations[:3],
    )
    proactive = [
        {"message": "Today I recommend reviewing the top-ranked opportunities.", "approval_required": True},
        {"message": f"I found {len(opportunities)} revenue opportunities ready for review.", "approval_required": True},
        {"message": "No emails or campaigns will launch without approval.", "approval_required": True},
    ]
    return GrowthEngineOut(
        briefing=briefing,
        opportunity_feed=opportunities,
        smart_recommendations=smart_recommendations,
        website_monitoring=website_monitoring,
        campaign_optimizations=campaign_optimizations,
        reply_assistant=reply_items,
        revenue_dashboard={"estimated_pipeline": metrics.revenue_forecast, "meetings": metrics.meetings, "revenue_influenced": metrics.revenue, "roi": 0 if metrics.mrr == 0 else round(metrics.revenue_forecast / metrics.mrr, 1), "mrr_generated": metrics.mrr},
        goal=goal,
        proactive_mode=proactive,
        notifications=[{"title": "Growth engine refreshed", "message": "New recommendations are ready for review.", "kind": "info"}],
        performance={"ai_actions": len(opportunities) + len(smart_recommendations), "time_saved_hours": round((len(opportunities) + len(smart_recommendations)) * 0.25, 1), "leads_generated": metrics.leads, "revenue_influenced": metrics.revenue},
    )


def _ai_ceo_labels(language: str) -> dict[str, str]:
    labels = {
        "English": {
            "opening": "Good morning. This is your AI CEO report.",
            "health": "Business health",
            "employees": "AI employee report",
            "priorities": "Top three priorities today",
            "risks": "Top risks",
            "opportunities": "Top opportunities",
            "safety": "I will not launch campaigns, send emails, approve actions, or delete data. Every external action still requires your approval.",
            "closing": "My recommendation is to review the highest-confidence opportunity first.",
        },
        "Russian": {
            "opening": "Доброе утро. Это отчет вашего AI CEO.",
            "health": "Состояние бизнеса",
            "employees": "Отчет AI сотрудников",
            "priorities": "Три главных приоритета на сегодня",
            "risks": "Главные риски",
            "opportunities": "Главные возможности",
            "safety": "Я не запускаю кампании, не отправляю письма, не утверждаю действия и не удаляю данные. Все внешние действия требуют вашего подтверждения.",
            "closing": "Моя рекомендация: сначала проверьте возможность с самым высоким уровнем уверенности.",
        },
        "Spanish": {
            "opening": "Buenos dias. Este es el informe de tu AI CEO.",
            "health": "Salud del negocio",
            "employees": "Informe de empleados de IA",
            "priorities": "Las tres prioridades principales de hoy",
            "risks": "Principales riesgos",
            "opportunities": "Principales oportunidades",
            "safety": "No lanzo campanas, no envio emails, no apruebo acciones ni elimino datos. Toda accion externa requiere tu aprobacion.",
            "closing": "Mi recomendacion es revisar primero la oportunidad con mayor confianza.",
        },
        "French": {
            "opening": "Bonjour. Voici le rapport de votre AI CEO.",
            "health": "Sante de l'entreprise",
            "employees": "Rapport des employes IA",
            "priorities": "Les trois priorites du jour",
            "risks": "Principaux risques",
            "opportunities": "Principales opportunites",
            "safety": "Je ne lance pas de campagnes, je n'envoie pas d'emails, je n'approuve pas d'actions et je ne supprime pas de donnees. Toute action externe exige votre approbation.",
            "closing": "Ma recommandation est d'examiner d'abord l'opportunite avec la confiance la plus elevee.",
        },
        "Italian": {
            "opening": "Buongiorno. Questo e il report del tuo AI CEO.",
            "health": "Salute del business",
            "employees": "Report dei dipendenti IA",
            "priorities": "Le tre priorita principali di oggi",
            "risks": "Rischi principali",
            "opportunities": "Opportunita principali",
            "safety": "Non avvio campagne, non invio email, non approvo azioni e non elimino dati. Ogni azione esterna richiede la tua approvazione.",
            "closing": "La mia raccomandazione e di rivedere prima l'opportunita con la fiducia piu alta.",
        },
        "Ukrainian": {
            "opening": "Доброго ранку. Це звіт вашого AI CEO.",
            "health": "Стан бізнесу",
            "employees": "Звіт AI співробітників",
            "priorities": "Три головні пріоритети на сьогодні",
            "risks": "Головні ризики",
            "opportunities": "Головні можливості",
            "safety": "Я не запускаю кампанії, не надсилаю листи, не затверджую дії і не видаляю дані. Усі зовнішні дії потребують вашого підтвердження.",
            "closing": "Моя рекомендація: спочатку перегляньте можливість з найвищою впевненістю.",
        },
        "Polish": {
            "opening": "Dzień dobry. To raport Twojego AI CEO.",
            "health": "Kondycja biznesu",
            "employees": "Raport pracowników AI",
            "priorities": "Trzy najważniejsze priorytety na dziś",
            "risks": "Najważniejsze ryzyka",
            "opportunities": "Najważniejsze szanse",
            "safety": "Nie uruchamiam kampanii, nie wysyłam emaili, nie zatwierdzam działań i nie usuwam danych. Każde działanie zewnętrzne nadal wymaga Twojej zgody.",
            "closing": "Moja rekomendacja: najpierw sprawdź szansę o najwyższej pewności.",
        },
    }
    labels["American English"] = labels["English"]
    return labels.get(language, labels["English"])


def _latest_employee_report(db: Session, workspace: Workspace, user_id: str) -> list[dict[str, Any]]:
    employees = list(db.scalars(select(AISalesEmployee).where(AISalesEmployee.workspace_id == workspace.id, AISalesEmployee.user_id == user_id).order_by(AISalesEmployee.created_at.desc()).limit(8)).all())
    report: list[dict[str, Any]] = []
    for employee in employees:
        tasks = _task_history(employee)
        completed = [task for task in tasks if task.get("status") == "finished"]
        pending = [task for task in tasks if task.get("status") in {"waiting_approval", "approved"}]
        last = completed[-1] if completed else (tasks[-1] if tasks else {})
        report.append(
            {
                "name": employee.name,
                "role": employee.role,
                "mode": employee.sending_mode.value,
                "completed_tasks": len(completed),
                "pending_tasks": len(pending),
                "problems": "No blocker detected" if tasks else "No assigned work yet",
                "recommendation": str((last.get("result_preview") or {}).get("next_recommended_action") or "Assign a focused revenue task and keep approval required."),
            }
        )
    if not report:
        report.append({"name": "Sales Employee", "role": "AI Sales Employee", "mode": "Review Mode", "completed_tasks": 0, "pending_tasks": 0, "problems": "No AI employee has been hired yet", "recommendation": "Create the first AI Sales Employee and assign a discovery task."})
    return report


def _ai_ceo_summary(db: Session, user_id: str, workspace: Workspace, length: str, language: str) -> dict[str, Any]:
    metrics = dashboard(user_id, db)
    growth = growth_engine(user_id, db)
    lead_scope = _workspace_stmt(Lead, workspace, user_id)
    email_scope = _workspace_stmt(EmailMessage, workspace, user_id)
    task_scope = _workspace_stmt(SalesEmployeeTaskResult, workspace, user_id)
    yesterday = datetime.utcnow().date()
    tasks_completed = db.scalar(select(func.count()).select_from(SalesEmployeeTaskResult).where(task_scope)) or 0
    new_leads = db.scalar(select(func.count()).select_from(Lead).where(lead_scope, func.date(Lead.created_at) == yesterday.isoformat())) or 0
    replies = db.scalar(select(func.count()).select_from(EmailMessage).where(email_scope, EmailMessage.replied_at.is_not(None))) or 0
    employee_report = _latest_employee_report(db, workspace, user_id)
    priorities = [
        str(item.get("action") or item.get("title") or "Review today's best opportunity")
        for item in growth.smart_recommendations[:3]
    ]
    while len(priorities) < 3:
        priorities.append("Keep all external actions in approval mode.")
    risks = [
        "Reply rate needs attention" if metrics.reply_rate < 5 else "Reply rate is healthy; scale carefully.",
        "Pipeline is thin" if metrics.revenue_forecast <= 0 else "Protect pipeline quality while scaling.",
        "No campaign should launch without approval.",
    ]
    opportunities = [
        str(item.get("company") or item.get("recommended_action") or "New opportunity")
        for item in growth.opportunity_feed[:3]
    ] or ["Run Lead Finder to create the next opportunity set."]
    health = {
        "revenue": metrics.revenue,
        "mrr": metrics.mrr,
        "arr": metrics.arr,
        "pipeline": metrics.revenue_forecast,
        "meetings": metrics.meetings,
        "conversions": metrics.conversion_rate,
        "reply_rate": metrics.reply_rate,
        "open_rate": metrics.open_rate,
        "growth": growth.performance,
    }
    return {
        "workspace": workspace.name,
        "length": length,
        "language": language,
        "business_health": health,
        "daily_report": {
            "ai_team_hours_estimate": round(max(1, tasks_completed) * 0.5, 1),
            "new_leads_found": int(new_leads or growth.briefing.new_leads_found),
            "emails_prepared": metrics.usage.get("ai_generations", 0),
            "replies": replies,
            "meetings": metrics.meetings,
            "estimated_monthly_revenue_delta": metrics.revenue_forecast,
        },
        "employee_report": employee_report,
        "top_priorities": priorities[:3],
        "top_risks": risks,
        "top_opportunities": opportunities[:3],
        "recommended_action": priorities[0],
        "confidence": 91 if metrics.leads or metrics.campaigns else 74,
        "safety": "report_only",
    }


def _ai_ceo_transcript(summary: dict[str, Any]) -> str:
    labels = _ai_ceo_labels(str(summary["language"]))
    health = summary["business_health"]
    daily = summary["daily_report"]
    employee_lines = [
        f"{employee['name']}: {employee['completed_tasks']} completed tasks, {employee['pending_tasks']} pending tasks. Problem: {employee['problems']}. Recommendation: {employee['recommendation']}."
        for employee in summary["employee_report"]
    ]
    lines = [
        labels["opening"],
        f"Yesterday your AI team worked for about {daily['ai_team_hours_estimate']} hours.",
        f"New leads found: {daily['new_leads_found']}. Replies: {daily['replies']}. Meetings booked: {daily['meetings']}. Estimated pipeline is €{health['pipeline']:,.0f}.",
        f"{labels['health']}: revenue €{health['revenue']:,.0f}, MRR €{health['mrr']:,.0f}, ARR €{health['arr']:,.0f}, open rate {health['open_rate']}%, reply rate {health['reply_rate']}%, conversion {health['conversions']}%.",
        f"{labels['employees']}: " + " ".join(employee_lines),
        f"{labels['priorities']}: 1. {summary['top_priorities'][0]} 2. {summary['top_priorities'][1]} 3. {summary['top_priorities'][2]}",
        f"{labels['risks']}: 1. {summary['top_risks'][0]} 2. {summary['top_risks'][1]} 3. {summary['top_risks'][2]}",
        f"{labels['opportunities']}: 1. {summary['top_opportunities'][0]} 2. {summary['top_opportunities'][1]} 3. {summary['top_opportunities'][2]}",
        f"Today's recommendation: {summary['recommended_action']}. Confidence: {summary['confidence']}%.",
        labels["safety"],
        labels["closing"],
    ]
    if summary["length"] == "30 sec":
        return " ".join(lines[:5] + lines[8:10])
    if summary["length"] == "1 min":
        return " ".join(lines[:10])
    if summary["length"] == "3 min":
        return " ".join(lines + ["I would review opportunities first, then approve only the prepared work that matches your ICP and daily sending limits."])
    return " ".join(lines + [
        "For a deeper executive review, inspect the pipeline by status, compare reply quality with campaign intent, and approve only the highest confidence next action.",
        "The AI CEO is intentionally advisory. It coordinates context across employees, but operational approval remains with the user.",
    ])


@router.post("/ai-ceo/briefings", response_model=AICEOBriefingOut)
def create_ai_ceo_briefing(payload: AICEOBriefingRequest, request: Request, user_id: CurrentUser, db: Session = Depends(get_db)) -> AICEOBriefingOut:
    started = time.perf_counter()
    step = "workspace"
    try:
        workspace = _current_workspace(db, user_id)
        language = payload.language or workspace.language or "English"
        logger.info("AI CEO briefing step=%s user=%s workspace=%s length=%s language=%s", step, user_id, workspace.id, payload.length, language)
        step = "summary"
        summary = _ai_ceo_summary(db, user_id, workspace, payload.length, language)
        logger.info("AI CEO briefing step=%s duration_ms=%s", step, round((time.perf_counter() - started) * 1000))
        step = "transcript"
        transcript = _ai_ceo_transcript(summary)
        if not transcript.strip():
            raise ValueError("AI CEO transcript is empty")
        logger.info("AI CEO briefing step=%s transcript_chars=%s", step, len(transcript))
        step = "db_save"
        briefing = AICEOBriefing(
            workspace_id=workspace.id,
            user_id=user_id,
            length=payload.length,
            language=language,
            title=f"AI CEO {payload.length} report",
            transcript=transcript,
            summary_json=summary,
        )
        db.add(briefing)
        log_event(db, request, user_id, "ai_ceo.briefing_created", {"length": payload.length, "language": language, "report_only": True})
        db.commit()
        db.refresh(briefing)
        step = "response"
        response = AICEOBriefingOut.model_validate(briefing)
        logger.info("AI CEO briefing step=%s id=%s duration_ms=%s", step, briefing.id, round((time.perf_counter() - started) * 1000))
        return response
    except Exception:
        logger.exception("AI CEO briefing failed step=%s user=%s duration_ms=%s", step, user_id, round((time.perf_counter() - started) * 1000))
        raise


@router.get("/ai-ceo/briefings", response_model=list[AICEOBriefingOut])
def list_ai_ceo_briefings(user_id: CurrentUser, db: Session = Depends(get_db)) -> list[AICEOBriefing]:
    workspace = _current_workspace(db, user_id)
    return list(db.scalars(select(AICEOBriefing).where(AICEOBriefing.workspace_id == workspace.id, AICEOBriefing.user_id == user_id).order_by(AICEOBriefing.created_at.desc()).limit(30)).all())


@router.post("/ai-ceo/question", response_model=AICEOAnswerOut)
def answer_ai_ceo_question(payload: AICEOQuestionIn, request: Request, user_id: CurrentUser, db: Session = Depends(get_db)) -> AICEOAnswerOut:
    started = time.perf_counter()
    step = "workspace"
    try:
        workspace = _current_workspace(db, user_id)
        step = "summary"
        summary = _ai_ceo_summary(db, user_id, workspace, "30 sec", payload.language)
        question = payload.question.lower()
        health = summary["business_health"]
        step = "answer"
        if "why" in question or "choose" in question:
            answer = f"Sales AI prioritizes companies with stronger ICP fit, available websites or contacts, and clearer buying signals. The top current opportunity is {summary['top_opportunities'][0]}."
        elif "reply" in question:
            answer = f"Current reply rate is {health['reply_rate']}%. The next best move is: {summary['top_priorities'][0]}"
        elif "revenue" in question:
            answer = f"Revenue is €{health['revenue']:,.0f}, estimated pipeline is €{health['pipeline']:,.0f}, MRR is €{health['mrr']:,.0f}, and ARR is €{health['arr']:,.0f}."
        elif "next" in question or "should" in question:
            answer = f"Do this next: {summary['recommended_action']}. Confidence is {summary['confidence']}%."
        else:
            answer = f"I reviewed the business state. The top priority is {summary['top_priorities'][0]}. The top risk is {summary['top_risks'][0]}."
        step = "db_save"
        log_event(db, request, user_id, "ai_ceo.question_answered", {"question": payload.question[:120], "report_only": True})
        db.commit()
        logger.info("AI CEO question step=response user=%s duration_ms=%s", user_id, round((time.perf_counter() - started) * 1000))
        return AICEOAnswerOut(answer=answer, related_metrics=health)
    except Exception:
        logger.exception("AI CEO question failed step=%s user=%s duration_ms=%s", step, user_id, round((time.perf_counter() - started) * 1000))
        raise


@router.post("/growth-engine/goal", response_model=GrowthGoalOut)
def set_growth_goal(payload: GrowthGoalIn, request: Request, user_id: CurrentUser, db: Session = Depends(get_db)) -> GrowthGoalOut:
    workspace = _current_workspace(db, user_id)
    settings = _settings_for_workspace(db, user_id, workspace)
    target = _extract_meeting_target(payload.goal)
    execution_plan = [
        f"Find enough qualified leads to support {target} meetings this month.",
        "Score opportunities by ICP fit, contact availability, and buying signals.",
        "Prepare personalized emails and follow-ups for approval.",
        "Prioritize interested replies and meeting requests daily.",
        "Review progress every login and adjust campaigns safely.",
    ]
    settings.general = {
        **(settings.general or {}),
        "growthGoal": {
            "goal": payload.goal,
            "target_meetings": target,
            "execution_plan": execution_plan,
            "next_action": "Review today's AI Briefing and approve the first recommended action.",
        },
    }
    _notify(db, user_id, NotificationKind.success, "Growth goal updated", payload.goal)
    log_event(db, request, user_id, "growth.goal_updated", {"goal": payload.goal, "target_meetings": target})
    db.commit()
    return _growth_goal(settings, dashboard(user_id, db).meetings)


@router.post("/campaigns", response_model=CampaignOut)
def create_campaign(payload: CampaignCreate, request: Request, user_id: CurrentUser, db: Session = Depends(get_db)) -> CampaignOut:
    workspace = _current_workspace(db, user_id)
    current_count = db.scalar(select(func.count()).select_from(Campaign).where(_workspace_stmt(Campaign, workspace, user_id))) or 0
    _enforce_count_limit(db, user_id, workspace, "campaigns", int(current_count))
    data = _campaign_payload(payload.model_dump(exclude={"sequence"}), include_defaults=True)
    campaign = Campaign(user_id=user_id, workspace_id=workspace.id, **data, status=CampaignStatus.scheduled if payload.schedule_at else CampaignStatus.draft)
    db.add(campaign)
    db.flush()
    _replace_sequence(db, campaign, payload.sequence)
    log_event(db, request, user_id, "campaign.created", {"campaign_id": str(campaign.id), "name": campaign.name})
    _notify(db, user_id, NotificationKind.success, "Campaign created", f"{campaign.name} is ready for leads and email generation.")
    db.commit()
    db.refresh(campaign)
    return _campaign_out(db, campaign)


@router.get("/campaigns", response_model=list[CampaignOut])
def list_campaigns(user_id: CurrentUser, db: Session = Depends(get_db)) -> list[CampaignOut]:
    workspace = _current_workspace(db, user_id)
    campaigns = db.scalars(select(Campaign).where(_workspace_stmt(Campaign, workspace, user_id)).order_by(Campaign.created_at.desc())).all()
    return [_campaign_out(db, campaign) for campaign in campaigns if _is_customer_visible_campaign(campaign)]


@router.put("/campaigns/{campaign_id}", response_model=CampaignOut)
def update_campaign(campaign_id: UUID, payload: CampaignUpdate, request: Request, user_id: CurrentUser, db: Session = Depends(get_db)) -> CampaignOut:
    workspace = _current_workspace(db, user_id)
    campaign = db.scalar(select(Campaign).where(Campaign.id == campaign_id, _workspace_stmt(Campaign, workspace, user_id)))
    if campaign is None:
        raise HTTPException(status_code=404, detail="Campaign not found")
    data = _campaign_payload(payload.model_dump(exclude_unset=True, exclude={"sequence"}))
    for key, value in data.items():
        if key == "status" and value:
            value = CampaignStatus(value)
        setattr(campaign, key, value)
    if payload.sequence:
        _replace_sequence(db, campaign, payload.sequence)
    log_event(db, request, user_id, "campaign.updated", {"campaign_id": str(campaign.id)})
    db.commit()
    db.refresh(campaign)
    return _campaign_out(db, campaign)


@router.post("/campaigns/{campaign_id}/ai-analytics", response_model=CampaignAnalyticsOut)
def campaign_ai_analytics(campaign_id: UUID, request: Request, user_id: CurrentUser, db: Session = Depends(get_db)) -> CampaignAnalyticsOut:
    workspace = _current_workspace(db, user_id)
    plan = _plan_for_workspace(db, user_id, workspace)
    if not PLAN_LIMITS[plan]["advanced_analytics"]:
        raise HTTPException(status_code=402, detail=_upgrade_message(plan, "Advanced Analytics"))
    _enforce_usage(db, user_id, workspace, "ai_generations")
    campaign = db.scalar(select(Campaign).where(Campaign.id == campaign_id, _workspace_stmt(Campaign, workspace, user_id)))
    if campaign is None:
        raise HTTPException(status_code=404, detail="Campaign not found")
    leads = db.scalar(select(func.count()).select_from(Lead).where(Lead.campaign_id == campaign.id)) or 0
    emails = db.scalar(select(func.count()).select_from(EmailMessage).where(EmailMessage.campaign_id == campaign.id, EmailMessage.sent_at.is_not(None))) or 0
    opened = db.scalar(select(func.count()).select_from(EmailMessage).where(EmailMessage.campaign_id == campaign.id, EmailMessage.opened_at.is_not(None))) or 0
    replies = db.scalar(select(func.count()).select_from(EmailMessage).where(EmailMessage.campaign_id == campaign.id, EmailMessage.replied_at.is_not(None))) or 0
    meetings = db.scalar(select(func.count()).select_from(Lead).where(Lead.campaign_id == campaign.id, Lead.status == LeadStatus.meeting)) or 0
    try:
        result = campaign_analytics(
            {
                "campaign_id": campaign.id,
                "campaign": _campaign_out(db, campaign).model_dump(mode="json"),
                "metrics": {
                    "leads": leads,
                    "emails_sent": emails,
                    "opened": opened,
                    "replies": replies,
                    "meetings": meetings,
                    "open_rate": 0 if emails == 0 else round(opened / emails * 100, 1),
                    "reply_rate": 0 if emails == 0 else round(replies / emails * 100, 1),
                },
            }
        )
    except Exception as exc:
        raise _provider_error(exc) from exc
    log_event(db, request, user_id, "campaign.analytics_generated", {"campaign_id": str(campaign.id), "success": result.campaign_success})
    db.commit()
    return result


@router.post("/campaigns/{campaign_id}/{action}", response_model=CampaignOut)
def campaign_action(campaign_id: UUID, action: str, request: Request, user_id: CurrentUser, db: Session = Depends(get_db)) -> CampaignOut:
    workspace = _current_workspace(db, user_id)
    campaign = db.scalar(select(Campaign).where(Campaign.id == campaign_id, _workspace_stmt(Campaign, workspace, user_id)))
    if campaign is None:
        raise HTTPException(status_code=404, detail="Campaign not found")
    if action == "duplicate":
        clone = Campaign(
            user_id=user_id,
            workspace_id=workspace.id,
            name=f"{campaign.name} copy",
            industry=campaign.industry,
            countries=campaign.countries,
            cities=campaign.cities,
            company_size=campaign.company_size,
            keywords=campaign.keywords,
            website_filters=campaign.website_filters,
            language=campaign.language,
            offer=campaign.offer,
            cta=campaign.cta,
            email_tone=campaign.email_tone,
            signature=campaign.signature,
            follow_up_days=campaign.follow_up_days,
            timezone=campaign.timezone,
            status=CampaignStatus.draft,
        )
        db.add(clone)
        db.flush()
        sequence = db.scalars(select(CampaignSequence).where(CampaignSequence.campaign_id == campaign.id).order_by(CampaignSequence.step_order.asc())).all()
        _replace_sequence(
            db,
            clone,
            [CampaignSequenceIn(step_order=item.step_order, name=item.name, subject=item.subject, body=item.body, delay_days=item.delay_days) for item in sequence],
        )
        log_event(db, request, user_id, "campaign.duplicated", {"campaign_id": str(campaign.id), "duplicate_id": str(clone.id)})
        db.commit()
        db.refresh(clone)
        return _campaign_out(db, clone)
    mapping = {"launch": CampaignStatus.running, "resume": CampaignStatus.running, "pause": CampaignStatus.paused, "stop": CampaignStatus.stopped}
    if action not in mapping:
        raise HTTPException(status_code=400, detail="Unsupported campaign action")
    if action in {"launch", "resume"}:
        lead_ids = list(db.scalars(select(Lead.id).where(Lead.campaign_id == campaign.id, _workspace_stmt(Lead, workspace, user_id))).all())
        if not lead_ids:
            raise HTTPException(status_code=400, detail="Add at least one lead before launching this campaign.")
        approved_count = (
            db.scalar(
                select(func.count())
                .select_from(EmailMessage)
                .where(
                    _workspace_stmt(EmailMessage, workspace, user_id),
                    EmailMessage.lead_id.in_(lead_ids),
                    EmailMessage.delivery_status.in_(["approved", "sent"]),
                )
            )
            or 0
        )
        if approved_count == 0:
            raise HTTPException(status_code=400, detail="Approve at least one email draft before launching this campaign.")
    campaign.status = mapping[action]
    log_event(db, request, user_id, f"campaign.{action}", {"campaign_id": str(campaign.id)})
    _notify(db, user_id, NotificationKind.info, "Campaign updated", f"{campaign.name} is now {campaign.status.value}.")
    db.commit()
    db.refresh(campaign)
    return _campaign_out(db, campaign)


@router.post("/campaigns/{campaign_id}/duplicate", response_model=CampaignOut)
def duplicate_campaign(campaign_id: UUID, request: Request, user_id: CurrentUser, db: Session = Depends(get_db)) -> CampaignOut:
    workspace = _current_workspace(db, user_id)
    campaign = db.scalar(select(Campaign).where(Campaign.id == campaign_id, _workspace_stmt(Campaign, workspace, user_id)))
    if campaign is None:
        raise HTTPException(status_code=404, detail="Campaign not found")
    clone = Campaign(
        user_id=user_id,
        workspace_id=workspace.id,
        name=f"{campaign.name} copy",
        industry=campaign.industry,
        countries=campaign.countries,
        cities=campaign.cities,
        company_size=campaign.company_size,
        keywords=campaign.keywords,
        website_filters=campaign.website_filters,
        language=campaign.language,
        offer=campaign.offer,
        cta=campaign.cta,
        email_tone=campaign.email_tone,
        signature=campaign.signature,
        follow_up_days=campaign.follow_up_days,
        timezone=campaign.timezone,
        status=CampaignStatus.draft,
    )
    db.add(clone)
    db.flush()
    sequence = db.scalars(select(CampaignSequence).where(CampaignSequence.campaign_id == campaign.id).order_by(CampaignSequence.step_order.asc())).all()
    _replace_sequence(
        db,
        clone,
        [CampaignSequenceIn(step_order=item.step_order, name=item.name, subject=item.subject, body=item.body, delay_days=item.delay_days) for item in sequence],
    )
    log_event(db, request, user_id, "campaign.duplicated", {"campaign_id": str(campaign.id), "duplicate_id": str(clone.id)})
    db.commit()
    db.refresh(clone)
    return _campaign_out(db, clone)


@router.post("/leads", response_model=LeadOut)
def create_lead(payload: LeadCreate, request: Request, user_id: CurrentUser, db: Session = Depends(get_db)) -> LeadOut:
    workspace = _current_workspace(db, user_id)
    _enforce_usage(db, user_id, workspace, "leads")
    candidate = LeadOut(
        company=payload.company,
        website=payload.website,
        industry=payload.industry,
        country=payload.country,
        city=payload.city,
        contact=payload.contact,
        email=payload.email,
        phone=payload.phone,
        linkedin=payload.linkedin,
        status=payload.status,
        campaign_id=payload.campaign_id,
        source="manual",
    )
    if _lead_duplicate_exists(db, workspace, user_id, candidate):
        duplicate_criteria = [Lead.company == payload.company]
        if payload.website:
            duplicate_criteria.append(Lead.website == payload.website)
        if payload.email:
            duplicate_criteria.append(Lead.email == str(payload.email))
        existing = db.scalar(
            select(Lead)
            .where(
                _workspace_stmt(Lead, workspace, user_id),
                or_(*duplicate_criteria),
            )
            .order_by(Lead.created_at.desc())
        )
        if existing:
            existing.campaign_id = payload.campaign_id or existing.campaign_id
            existing.status = _status(payload.status)
            existing.contact = payload.contact or existing.contact
            existing.email = str(payload.email) if payload.email else existing.email
            existing.industry = payload.industry or existing.industry
            existing.country = payload.country or existing.country
            existing.city = payload.city or existing.city
            existing.website = payload.website or existing.website
            log_event(db, request, user_id, "lead.duplicate_reused", {"company": existing.company, "source": "manual"})
            _sync_lead_to_crm(db, user_id, workspace, existing)
            db.commit()
            db.refresh(existing)
            return _lead_out(existing)
    enriched = candidate if candidate.email else _hunter_enriched_leads(db, request, user_id, workspace, [candidate])[0]
    metadata = {**_lead_metadata(enriched), "saved_to_crm_at": datetime.utcnow().isoformat()}
    lead = Lead(
        user_id=user_id,
        workspace_id=workspace.id,
        company=enriched.company,
        website=enriched.website,
        industry=enriched.industry,
        country=enriched.country,
        city=enriched.city,
        contact=enriched.contact,
        email=str(enriched.email) if enriched.email else None,
        phone=enriched.phone,
        linkedin=enriched.linkedin,
        campaign_id=enriched.campaign_id,
        notes=_merge_lead_metadata_for_new(metadata, "manual"),
        status=_status(enriched.status),
        niche=enriched.industry,
    )
    db.add(lead)
    db.flush()
    _analyze_lead_if_possible(db, user_id, workspace, lead)
    _sync_lead_to_crm(db, user_id, workspace, lead)
    log_event(db, request, user_id, "lead.imported", {"company": lead.company, "source": "manual", "hunter_verified": bool(enriched.hunter_verified)})
    if enriched.hunter_verified:
        _notify(db, user_id, NotificationKind.success, "Company analyzed", f"{lead.company} was saved, an email was verified, and AI prepared the company summary.")
    else:
        _notify(db, user_id, NotificationKind.info, "Company analyzed", f"{lead.company} was saved and analyzed. No verified email was found yet.")
    db.commit()
    db.refresh(lead)
    return _lead_out(lead)


@router.post("/leads/find", response_model=list[LeadOut])
def leads_find(payload: LeadFinderRequest, request: Request, user_id: CurrentUser, db: Session = Depends(get_db)) -> list[LeadOut]:
    request_id = request.headers.get("x-request-id") or str(uuid4())
    workspace = _current_workspace(db, user_id)
    settings = get_app_settings()
    _lead_trace(
        request_id,
        "request_received",
        user_id=user_id,
        workspace_id=str(workspace.id),
        payload=payload.model_dump(),
        google_maps_configured=google_maps_key_loaded(),
        hunter_configured=hunter_key_loaded(),
        openai_configured=bool(get_app_settings().openai_api_key),
        database_configured=bool(get_app_settings().database_url),
        resend_configured=bool(get_app_settings().resend_api_key),
    )
    _require_active_subscription(db, workspace)
    _lead_trace(request_id, "validation_passed", workspace_id=str(workspace.id), limit=payload.limit, country=payload.country, city=payload.city, industry=payload.industry)
    search_cache_key = cache_key("lead-search", workspace.id, payload.model_dump(mode="json"))
    cached_search = get_json(search_cache_key)
    if cached_search:
        _lead_trace(request_id, "lead_search_cache_hit", parsed_count=len(cached_search))
        result_leads = [LeadOut.model_validate(item) for item in cached_search]
        lead_source = "google_maps_hunter"
        lead_action = "google_maps.company_search"
    else:
        try:
            _lead_trace(request_id, "google_places_started", timeout_seconds=LEAD_PROVIDER_TIMEOUT_SECONDS)
            result = _run_provider_with_deadline(request_id, "google_places", "google_places.search", search_google_places, payload)
            _lead_trace(request_id, "google_places_finished", raw_count=result.raw_count, parsed_count=len(result.leads), duration_ms=result.duration_ms)
            result_leads = result.leads
            lead_source = "google_maps_hunter"
            lead_action = "google_maps.company_search"
        except GoogleMapsConfigurationError as exc:
            _lead_trace(request_id, "google_places_configuration_failed", error=str(exc), error_type=type(exc).__name__)
            raise _provider_error(exc) from exc
        except Exception as exc:
            _lead_trace(request_id, "google_places_failed", error=str(exc), error_type=type(exc).__name__)
            if not apollo_key_loaded():
                _lead_trace(request_id, "fallback_provider_unavailable", provider="apollo", reason="not_configured")
                raise _provider_error(exc) from exc
            try:
                _lead_trace(request_id, "fallback_provider_request_started", provider="apollo")
                fallback_result = _run_provider_with_deadline(request_id, "apollo", "apollo.company_search", search_apollo_companies, payload)
                _lead_trace(
                    request_id,
                    "fallback_provider_response_received",
                    provider="apollo",
                    raw_count=fallback_result.raw_count,
                    parsed_count=len(fallback_result.leads),
                    duration_ms=fallback_result.duration_ms,
                )
                result_leads = fallback_result.leads
                lead_source = "apollo_hunter_fallback"
                lead_action = "apollo.company_search_fallback"
            except Exception as fallback_exc:
                _lead_trace(
                    request_id,
                    "fallback_provider_request_failed",
                    provider="apollo",
                    error=str(fallback_exc),
                    error_type=type(fallback_exc).__name__,
                )
                raise _provider_error(fallback_exc) from fallback_exc
        set_json(search_cache_key, [lead.model_dump(mode="json") for lead in result_leads], settings.cache_lead_search_ttl_seconds)
    _lead_trace(request_id, "hunter_started", leads=len(result_leads), hunter_configured=hunter_key_loaded(), timeout_seconds=LEAD_PROVIDER_TIMEOUT_SECONDS)
    leads = _hunter_enriched_leads(db, request, user_id, workspace, result_leads)
    _lead_trace(request_id, "hunter_finished", leads=len(leads), verified=sum(1 for lead in leads if lead.hunter_verified))
    saved = _save_provider_leads(db, request, user_id, workspace, leads, payload, source=lead_source, action=lead_action, request_id=request_id, run_inline_analysis=False)
    response = [_lead_out(lead) for lead in saved]
    _lead_trace(request_id, "response_returned", response_count=len(response), companies=[lead.company for lead in response[:5]])
    return response


@router.post("/apollo/search-companies", response_model=list[LeadOut])
def apollo_search_companies(payload: LeadFinderRequest, request: Request, user_id: CurrentUser, db: Session = Depends(get_db)) -> list[LeadOut]:
    workspace = _current_workspace(db, user_id)
    _require_active_subscription(db, workspace)
    try:
        result = search_apollo_companies(payload)
    except Exception as exc:
        raise _provider_error(exc) from exc
    _save_apollo_settings_state(db, _settings_for_workspace(db, user_id, workspace), connected=True, last_success_at=datetime.utcnow(), last_error="")
    leads = _hunter_enriched_leads(db, request, user_id, workspace, result.leads)
    saved = _save_provider_leads(db, request, user_id, workspace, leads, payload, source="apollo_hunter", action="apollo.company_search")
    return [_lead_out(lead) for lead in saved]


@router.post("/apollo/search-contacts", response_model=list[LeadOut])
def apollo_search_contacts(payload: LeadFinderRequest, request: Request, user_id: CurrentUser, db: Session = Depends(get_db)) -> list[LeadOut]:
    workspace = _current_workspace(db, user_id)
    _require_active_subscription(db, workspace)
    try:
        result = search_apollo_contacts(payload)
    except Exception as exc:
        raise _provider_error(exc) from exc
    _save_apollo_settings_state(db, _settings_for_workspace(db, user_id, workspace), connected=True, last_success_at=datetime.utcnow(), last_error="")
    leads = _hunter_enriched_leads(db, request, user_id, workspace, result.leads)
    saved = _save_provider_leads(db, request, user_id, workspace, leads, payload, source="apollo_hunter", action="apollo.contact_search")
    return [_lead_out(lead) for lead in saved]


def _hunter_enriched_leads(db: Session, request: Request, user_id: str, workspace: Workspace, leads: list[LeadOut]) -> list[LeadOut]:
    if not hunter_key_loaded() or not leads:
        return leads
    settings = _settings_for_workspace(db, user_id, workspace)
    try:
        request_id = request.headers.get("x-request-id") or str(uuid4())
        enriched = _run_provider_with_deadline(request_id, "hunter", "hunter.enrichment", enrich_leads_with_hunter, leads)
    except LeadProviderTimeoutError as exc:
        friendly = "Contact enrichment took too long. Companies were saved without verified emails. Try finding contacts again from the company profile."
        _save_hunter_settings_state(db, settings, connected=False, last_error=friendly)
        log_event(db, request, user_id, "hunter.enrichment_timeout", {"reason": friendly})
        capture_provider_exception(exc, provider="hunter", endpoint="hunter.enrichment", workspace_id=workspace.id)
        return leads
    except Exception as exc:
        friendly = _provider_error(exc).detail
        _save_hunter_settings_state(db, settings, connected=False, last_error=str(friendly))
        log_event(db, request, user_id, "hunter.enrichment_failed", {"reason": str(friendly)})
        return leads
    verified = sum(1 for lead in enriched if lead.hunter_verified)
    now = datetime.utcnow()
    _save_hunter_settings_state(db, settings, connected=True, last_success_at=now, last_error="")
    log_event(db, request, user_id, "hunter.enrichment_completed", {"verified": verified, "checked": len(enriched)})
    return enriched


def _save_provider_leads(
    db: Session,
    request: Request,
    user_id: str,
    workspace: Workspace,
    found: list[LeadOut],
    payload: LeadFinderRequest,
    source: str,
    action: str,
    request_id: str = "",
    run_inline_analysis: bool = True,
) -> list[Lead]:
    saved: list[Lead] = []
    reused: list[Lead] = []
    skipped = 0
    _lead_trace(request_id or str(uuid4()), "database_save_started", found=len(found))
    for item in found:
        existing = _existing_duplicate_lead(db, workspace, user_id, item)
        if existing:
            skipped += 1
            existing.updated_at = datetime.utcnow()
            _sync_lead_to_crm(db, user_id, workspace, existing)
            reused.append(existing)
            _lead_trace(
                request_id or str(uuid4()),
                "database_duplicate_reused",
                lead_id=str(existing.id),
                company=existing.company,
                email=str(existing.email or item.email or ""),
                website=existing.website or item.website or "",
                place_id=item.place_id,
                apollo_company_id=item.apollo_company_id,
            )
            continue
        _enforce_usage(db, user_id, workspace, "leads")
        lead = Lead(
            user_id=user_id,
            workspace_id=workspace.id,
            company=item.company,
            website=item.website,
            contact=item.contact,
            email=str(item.email) if item.email else None,
            phone=item.phone,
            linkedin=item.linkedin,
            industry=item.industry or item.niche,
            niche=item.niche,
            country=item.country,
            city=item.city,
            notes=_merge_lead_metadata(item, {"saved_to_crm_at": datetime.utcnow().isoformat()}),
            revenue=item.revenue,
        )
        db.add(lead)
        db.flush()
        _add_lead_activity(db, request, user_id, workspace, "lead.found", lead, {"source": source})
        _lead_trace(request_id or str(uuid4()), "database_lead_inserted", lead_id=str(lead.id), company=lead.company, website=lead.website or "", email=lead.email or "")
        if run_inline_analysis:
            _analyze_lead_if_possible(db, user_id, workspace, lead)
        else:
            _lead_trace(request_id or str(uuid4()), "website_analysis_deferred", lead_id=str(lead.id), company=lead.company, reason="lead_finder_response_first")
        _sync_lead_to_crm(db, user_id, workspace, lead)
        _add_lead_activity(db, request, user_id, workspace, "lead.saved_to_crm", lead, {"source": source, "crm_stage": _crm_stage_for_lead(lead)})
        if _lead_metadata(lead).get("website_analyzed_at"):
            _add_lead_activity(db, request, user_id, workspace, "website.analyzed", lead, {"source": source})
        if lead.email:
            _add_lead_activity(db, request, user_id, workspace, "contact.found", lead, {"email_status": _email_status_for_lead(lead), "source": source})
        saved.append(lead)
    log_event(db, request, user_id, action, {"source": source, "saved": len(saved), "duplicates_skipped": skipped, **payload.model_dump()})
    verified = sum(1 for item in found if item.hunter_verified)
    if saved:
        suffix = f" Verified {verified} email{'s' if verified != 1 else ''}." if verified else ""
        _notify(db, user_id, NotificationKind.success, "Leads imported", f"{len(saved)} companies were added to your workspace.{suffix}")
    elif found:
        _notify(db, user_id, NotificationKind.info, "Lead search finished", "All matching results were already in your workspace.")
    else:
        _notify(db, user_id, NotificationKind.info, "Lead search finished", "No matching companies were found for those filters.")
    db.commit()
    _lead_trace(request_id or str(uuid4()), "database_save_committed", saved=len(saved), duplicates_skipped=skipped)
    _lead_trace(request_id or str(uuid4()), "database_save_finished", saved=len(saved), duplicates_skipped=skipped, returned=len(saved) + len(reused))
    return saved + reused


def _lead_duplicate_exists(db: Session, workspace: Workspace, user_id: str, item: LeadOut) -> bool:
    return _existing_duplicate_lead(db, workspace, user_id, item) is not None


@router.get("/leads", response_model=PaginatedLeads)
def leads_list(
    user_id: CurrentUser,
    db: Session = Depends(get_db),
    search: str = "",
    status: str = "",
    campaign_id: Optional[UUID] = None,
    sort: str = "created_at",
    direction: str = "desc",
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
) -> PaginatedLeads:
    workspace = _current_workspace(db, user_id)
    stmt = select(Lead).where(_workspace_stmt(Lead, workspace, user_id))
    if search:
        term = f"%{search}%"
        stmt = stmt.where(or_(Lead.company.ilike(term), Lead.email.ilike(term), Lead.website.ilike(term), Lead.industry.ilike(term)))
    if status:
        stmt = stmt.where(Lead.status == _status(status))
    if campaign_id:
        stmt = stmt.where(Lead.campaign_id == campaign_id)
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    sort_col = getattr(Lead, sort, Lead.created_at)
    stmt = stmt.order_by(asc(sort_col) if direction == "asc" else desc(sort_col)).offset((page - 1) * page_size).limit(page_size)
    items = db.scalars(stmt).all()
    return PaginatedLeads(items=[_lead_out(item) for item in items], total=total, page=page, page_size=page_size)


@router.get("/crm/companies", response_model=list[CrmCompanyOut])
def crm_companies(
    user_id: CurrentUser,
    db: Session = Depends(get_db),
    search: str = "",
    city: str = "",
    country: str = "",
    industry: str = "",
    stage: str = "",
    email_status: str = "",
    source: str = "",
) -> list[CrmCompanyOut]:
    app_settings = get_app_settings()
    workspace = _current_workspace(db, user_id)
    key = cache_key("crm-companies", workspace.id, user_id, search, city, country, industry, stage, email_status, source)
    cached = get_json(key)
    if cached:
        validated = [CrmCompanyOut.model_validate(item) for item in cached]
        return sorted(validated, key=lambda item: int(item.overall_score or 0), reverse=True)
    _ensure_crm_backfilled(db, user_id, workspace)
    companies = [company for company in db.scalars(_crm_company_query(workspace, user_id, search, city, country, industry, stage, email_status, source).limit(200)).all() if _is_customer_visible_company(company)][:100]
    output = [_crm_company_out(db, workspace, user_id, company) for company in companies]
    output.sort(key=lambda item: int(item.overall_score or 0), reverse=True)
    set_json(key, [item.model_dump(mode="json") for item in output], app_settings.cache_crm_ttl_seconds)
    return output


@router.get("/crm/contacts", response_model=list[CrmContactOut])
def crm_contacts(
    user_id: CurrentUser,
    db: Session = Depends(get_db),
    search: str = "",
    city: str = "",
    country: str = "",
    industry: str = "",
    stage: str = "",
    email_status: str = "",
    source: str = "",
) -> list[CrmContactOut]:
    workspace = _current_workspace(db, user_id)
    _ensure_crm_backfilled(db, user_id, workspace)
    companies = [company for company in db.scalars(_crm_company_query(workspace, user_id, search, city, country, industry, stage, email_status, source).limit(200)).all() if _is_customer_visible_company(company)][:100]
    company_ids = [company.id for company in companies]
    if not company_ids:
        return []
    contacts = list(db.scalars(select(Contact).where(_workspace_stmt(Contact, workspace, user_id), Contact.company_id.in_(company_ids)).order_by(Contact.updated_at.desc()).limit(200)).all())
    names = {company.id: company.name for company in companies}
    return [_crm_contact_out(contact, names.get(contact.company_id, "")) for contact in contacts if _is_customer_visible_contact(contact)]


@router.get("/crm/deals", response_model=list[CrmDealOut])
def crm_deals(
    user_id: CurrentUser,
    db: Session = Depends(get_db),
    search: str = "",
    city: str = "",
    country: str = "",
    industry: str = "",
    stage: str = "",
    email_status: str = "",
    source: str = "",
) -> list[CrmDealOut]:
    workspace = _current_workspace(db, user_id)
    _ensure_crm_backfilled(db, user_id, workspace)
    companies = [company for company in db.scalars(_crm_company_query(workspace, user_id, search, city, country, industry, stage, email_status, source).limit(200)).all() if _is_customer_visible_company(company)][:100]
    company_ids = [company.id for company in companies]
    if not company_ids:
        return []
    deals = list(db.scalars(select(Deal).where(_workspace_stmt(Deal, workspace, user_id), Deal.company_id.in_(company_ids)).order_by(Deal.updated_at.desc()).limit(200)).all())
    names = {company.id: company.name for company in companies}
    return [_crm_deal_out(deal, names.get(deal.company_id, "")) for deal in deals]


@router.get("/crm/pipeline", response_model=CrmPipelineOut)
def crm_pipeline(user_id: CurrentUser, db: Session = Depends(get_db)) -> CrmPipelineOut:
    workspace = _current_workspace(db, user_id)
    _ensure_crm_backfilled(db, user_id, workspace)
    companies = [company for company in db.scalars(_crm_company_query(workspace, user_id).limit(300)).all() if _is_customer_visible_company(company)][:200]
    deals = list(db.scalars(select(Deal).where(_workspace_stmt(Deal, workspace, user_id)).order_by(Deal.updated_at.desc()).limit(300)).all())
    company_names = {company.id: company.name for company in companies}
    serialized_companies = [_crm_company_out(db, workspace, user_id, company) for company in companies]
    serialized_companies.sort(key=lambda item: int(getattr(item, "overall_score", 0) or 0), reverse=True)
    return CrmPipelineOut(
        stages=CRM_STAGES.copy(),
        companies=serialized_companies,
        deals=[_crm_deal_out(deal, company_names.get(deal.company_id, "")) for deal in deals],
    )


@router.patch("/crm/companies/{company_id}/stage", response_model=CrmCompanyOut)
def update_crm_company_stage(company_id: UUID, payload: CrmStageUpdate, request: Request, user_id: CurrentUser, db: Session = Depends(get_db)) -> CrmCompanyOut:
    workspace = _current_workspace(db, user_id)
    stage = payload.stage.strip()
    if stage not in CRM_STAGES:
        raise HTTPException(status_code=400, detail="Choose a valid CRM stage.")
    company = db.scalar(select(Company).where(Company.id == company_id, _workspace_stmt(Company, workspace, user_id)))
    if company is None:
        raise HTTPException(status_code=404, detail="Company not found")
    now = datetime.utcnow()
    previous_stage = str(company.crm_stage or "")
    company.crm_stage = stage
    company.updated_at = now
    lead = db.get(Lead, company.lead_id) if company.lead_id else None
    if lead:
        status_map = {
            "Qualified": LeadStatus.qualified,
            "Contact Found": LeadStatus.qualified,
            "Email Draft Ready": LeadStatus.qualified,
            "Approved": LeadStatus.contacted,
            "Sent": LeadStatus.contacted,
            "Replied": LeadStatus.replied,
            "Meeting Scheduled": LeadStatus.meeting,
            "Won": LeadStatus.won,
            "Lost": LeadStatus.lost,
        }
        if stage in status_map:
            lead.status = status_map[stage]
        metadata_update = {"crm_stage": stage, "stage_changed_at": now.isoformat()}
        if stage == "Approved":
            metadata_update["email_status"] = "Approved"
            metadata_update["email_approved_at"] = now.isoformat()
        lead.notes = _merge_lead_metadata(lead, metadata_update)
        _add_lead_activity(db, request, user_id, workspace, "crm.stage_changed", lead, {"crm_stage": stage})
    deals = list(db.scalars(select(Deal).where(_workspace_stmt(Deal, workspace, user_id), Deal.company_id == company.id)).all())
    for deal in deals:
        deal.stage = stage
        deal.updated_at = now

    if stage != previous_stage and stage in {"Meeting Scheduled", "Won", "Lost"}:
        outcome_map = {
            "Meeting Scheduled": "meeting",
            "Won": "won",
            "Lost": "lost",
        }
        metadata = company.metadata_json if isinstance(company.metadata_json, dict) else {}
        ranking = metadata.get("opportunity_ranking") if isinstance(metadata.get("opportunity_ranking"), dict) else {}
        prioritization = metadata.get("ai_lead_prioritization") if isinstance(metadata.get("ai_lead_prioritization"), dict) else {}
        opportunity_factors = ranking.get("factors") if isinstance(ranking.get("factors"), dict) else {}
        prioritization_factors = prioritization.get("factors") if isinstance(prioritization.get("factors"), dict) else {}
        settings = _settings_for_workspace(db, user_id, workspace)
        updated_ai, profile = apply_continuous_learning_event(
            settings.ai if isinstance(settings.ai, dict) else {},
            outcome=outcome_map[stage],
            opportunity_factors=opportunity_factors,
            prioritization_factors=prioritization_factors,
        )
        settings.ai = updated_ai
        db.add(settings)
        company.metadata_json = {
            **metadata,
            "continuous_learning": profile,
        }
    db.commit()
    db.refresh(company)
    return _crm_company_out(db, workspace, user_id, company)


@router.post("/crm/companies/{company_id}/notes", response_model=CrmNoteOut)
def add_crm_company_note(company_id: UUID, payload: CrmNoteCreate, request: Request, user_id: CurrentUser, db: Session = Depends(get_db)) -> Note:
    workspace = _current_workspace(db, user_id)
    body = payload.body.strip()
    if not body:
        raise HTTPException(status_code=400, detail="Write a note before saving.")
    company = db.scalar(select(Company).where(Company.id == company_id, _workspace_stmt(Company, workspace, user_id)))
    if company is None:
        raise HTTPException(status_code=404, detail="Company not found")
    note = Note(user_id=user_id, workspace_id=workspace.id, company_id=company.id, lead_id=company.lead_id, body=body, kind="note")
    db.add(note)
    company.updated_at = datetime.utcnow()
    lead = db.get(Lead, company.lead_id) if company.lead_id else None
    if lead:
        _add_lead_activity(db, request, user_id, workspace, "note.added", lead, {"company_id": str(company.id)})
    db.commit()
    db.refresh(note)
    return note


@router.patch("/leads/{lead_id}", response_model=LeadOut)
def update_lead(lead_id: UUID, payload: LeadUpdate, request: Request, user_id: CurrentUser, db: Session = Depends(get_db)) -> LeadOut:
    workspace = _current_workspace(db, user_id)
    lead = db.scalar(select(Lead).where(Lead.id == lead_id, _workspace_stmt(Lead, workspace, user_id)))
    if lead is None:
        raise HTTPException(status_code=404, detail="Lead not found")
    for key, value in payload.model_dump(exclude_unset=True).items():
        if key == "status" and value:
            value = _status(value)
        setattr(lead, key, value)
    if payload.campaign_id:
        db.query(EmailMessage).filter(
            EmailMessage.workspace_id == workspace.id,
            EmailMessage.lead_id == lead.id,
            EmailMessage.campaign_id.is_(None),
        ).update({"campaign_id": payload.campaign_id}, synchronize_session=False)
    _sync_lead_to_crm(db, user_id, workspace, lead)
    log_event(db, request, user_id, "lead.updated", {"lead_id": str(lead.id)})
    db.commit()
    db.refresh(lead)
    return _lead_out(lead)


@router.post("/leads/{lead_id}/copilot", response_model=SalesCopilotOut)
def lead_copilot(lead_id: UUID, request: Request, user_id: CurrentUser, db: Session = Depends(get_db)) -> SalesCopilotOut:
    workspace = _current_workspace(db, user_id)
    _enforce_usage(db, user_id, workspace, "ai_generations")
    lead, analysis, campaign, messages = _lead_context(db, workspace, user_id, lead_id)
    try:
        result = sales_copilot(_lead_ai_payload(lead, analysis, campaign, messages, workspace.language))
    except Exception as exc:
        raise _provider_error(exc) from exc
    if not lead.revenue and result.estimated_revenue is not None:
        lead.revenue = result.estimated_revenue
    lead.notes = "\n".join(
        part
        for part in [
            lead.notes or "",
            f"Sales copilot: {result.probability_to_reply}% reply, {result.probability_to_buy}% buy. {result.best_cta}",
            f"Fit reason: {result.fit_reason}" if result.fit_reason else "",
            f"Next action: {result.next_best_action}" if result.next_best_action else "",
        ]
        if part
    )
    log_event(db, request, user_id, "copilot.generated", {"lead_id": str(lead.id), "reply": result.probability_to_reply, "buy": result.probability_to_buy})
    db.commit()
    return result


@router.post("/leads/{lead_id}/website-audit", response_model=WebsiteAuditOut)
def lead_website_audit(lead_id: UUID, request: Request, user_id: CurrentUser, db: Session = Depends(get_db)) -> WebsiteAuditOut:
    workspace = _current_workspace(db, user_id)
    _enforce_usage(db, user_id, workspace, "ai_generations")
    lead, analysis, campaign, messages = _lead_context(db, workspace, user_id, lead_id)
    if not lead.website:
        raise HTTPException(status_code=400, detail="Lead website is required for a website audit")
    try:
        snapshot = collect_website(lead.website)
        heuristic = _website_audit_markers(snapshot.text, snapshot.technologies)
        result = website_audit({**_lead_ai_payload(lead, analysis, campaign, messages, workspace.language), "website_text": snapshot.text[:10000], "detected_issues": heuristic})
    except Exception as exc:
        raise _provider_error(exc) from exc
    db.add(
        WebsiteAnalysis(
            user_id=user_id,
            workspace_id=workspace.id,
            lead_id=lead.id,
            company=_fit_db_text(lead.company, 220) or lead.company,
            website=_fit_db_text(lead.website, 500) or "",
            description="AI website audit",
            industry=_fit_db_text(lead.industry, 160),
            location=_fit_db_text(" ".join(part for part in [lead.city, lead.country] if part), 160),
            niche=_fit_db_text(lead.niche, 120),
            products_services=[],
            services=[],
            technologies=[],
            strengths=[],
            weaknesses=result.priority_actions,
            summary=result.improvement_report,
        )
    )
    lead.notes = "\n".join(part for part in [lead.notes or "", f"Website audit: {', '.join(result.priority_actions) or result.improvement_report}"] if part)
    log_event(db, request, user_id, "website.audit_generated", {"lead_id": str(lead.id), "issues": result.priority_actions})
    db.commit()
    return result


@router.post("/leads/{lead_id}/meeting-prep", response_model=MeetingPrepOut)
def lead_meeting_prep(lead_id: UUID, request: Request, user_id: CurrentUser, db: Session = Depends(get_db)) -> MeetingPrepOut:
    workspace = _current_workspace(db, user_id)
    _enforce_usage(db, user_id, workspace, "ai_generations")
    lead, analysis, campaign, messages = _lead_context(db, workspace, user_id, lead_id)
    try:
        result = meeting_preparation(_lead_ai_payload(lead, analysis, campaign, messages, workspace.language))
    except Exception as exc:
        raise _provider_error(exc) from exc
    log_event(db, request, user_id, "meeting.prep_generated", {"lead_id": str(lead.id)})
    db.commit()
    return result


@router.post("/leads/{lead_id}/follow-ups", response_model=FollowUpSequenceOut)
def lead_follow_ups(lead_id: UUID, request: Request, user_id: CurrentUser, db: Session = Depends(get_db)) -> FollowUpSequenceOut:
    workspace = _current_workspace(db, user_id)
    _enforce_usage(db, user_id, workspace, "ai_generations")
    lead, analysis, campaign, messages = _lead_context(db, workspace, user_id, lead_id)
    try:
        result = adaptive_follow_ups(_lead_ai_payload(lead, analysis, campaign, messages, workspace.language))
    except Exception as exc:
        raise _provider_error(exc) from exc
    log_event(db, request, user_id, "followups.generated", {"lead_id": str(lead.id)})
    db.commit()
    return result


@router.post("/leads/bulk")
def leads_bulk(payload: BulkLeadAction, request: Request, user_id: CurrentUser, db: Session = Depends(get_db)) -> dict:
    workspace = _current_workspace(db, user_id)
    leads = db.scalars(select(Lead).where(_workspace_stmt(Lead, workspace, user_id), Lead.id.in_(payload.ids))).all()
    if payload.delete:
        for lead in leads:
            db.delete(lead)
        action = "lead.deleted"
    else:
        for lead in leads:
            if payload.status:
                lead.status = _status(payload.status)
            if payload.campaign_id:
                lead.campaign_id = payload.campaign_id
        action = "lead.bulk_updated"
    log_event(db, request, user_id, action, {"count": len(leads)})
    db.commit()
    return {"updated": len(leads)}


@router.post("/ai/analyze", response_model=AnalysisOut)
def ai_analyze(payload: AnalyzeRequest, request: Request, user_id: CurrentUser, db: Session = Depends(get_db)) -> AnalysisOut:
    workspace = _current_workspace(db, user_id)
    _require_active_subscription(db, workspace)
    _enforce_usage(db, user_id, workspace, "ai_generations")
    lead = db.scalar(select(Lead).where(Lead.id == payload.lead_id, _workspace_stmt(Lead, workspace, user_id))) if payload.lead_id else None
    company = payload.company or (lead.company if lead else "")
    website = str(payload.website)
    try:
        normalized_website = normalize_website_url(website)
        if lead:
            lead.website = normalized_website
        logger.info(
            "ai_analyze_trace step=website_fetch_started data=%s",
            json.dumps({"lead_id": str(lead.id) if lead else None, "company": company, "website": normalized_website}, sort_keys=True),
        )
        snapshot = collect_website(normalized_website)
        result = analyze_company_website(
            company=company,
            website=snapshot.url,
            niche=payload.niche or (lead.industry if lead else None),
            page_title=snapshot.title,
            meta_description=snapshot.meta_description,
            page_text=snapshot.text,
            technologies=snapshot.technologies,
        )
    except WebsiteFetchError as exc:
        logger.warning(
            "ai_analyze_trace step=website_analysis_skipped lead_id=%s company=%s website=%s reason=%s",
            lead.id if lead else None,
            company,
            website,
            exc,
        )
        capture_provider_exception(
            exc,
            provider="website",
            endpoint="ai_analyze.fetch_website",
            workspace_id=workspace.id,
            lead_id=lead.id if lead else None,
            extra={"company": company, "website": website, "message": WEBSITE_UNREACHABLE_MESSAGE},
        )
        result = _skipped_website_analysis(company=company, website=website, niche=payload.niche or (lead.industry if lead else None))
        if lead:
            lead.notes = _merge_lead_metadata(
                lead,
                {
                    "website_analysis_status": "skipped",
                    "website_analysis_error": str(exc),
                    "website_analysis_message": WEBSITE_UNREACHABLE_MESSAGE,
                    "ai_summary": WEBSITE_UNREACHABLE_MESSAGE,
                },
                [WEBSITE_UNREACHABLE_MESSAGE],
            )
            _sync_lead_to_crm(db, user_id, workspace, lead)
        log_event(db, request, user_id, "website.analysis_skipped", {"company": company, "website": website, "lead_id": str(lead.id) if lead else None})
        db.commit()
        return result
    except Exception as exc:
        raise _provider_error(exc) from exc
    analysis = WebsiteAnalysis(
        user_id=user_id,
        workspace_id=workspace.id,
        lead_id=lead.id if lead else None,
        company=_fit_db_text(result.company, 220) or result.company,
        website=_fit_db_text(result.website, 500) or result.website,
        description=result.description,
        industry=_fit_db_text(result.industry, 160),
        location=_fit_db_text(result.location, 160),
        niche=_fit_db_text(result.niche, 120),
        products_services=result.products_services,
        services=result.services,
        technologies=result.technologies,
        strengths=result.strengths,
        weaknesses=result.weaknesses,
        summary=_analysis_summary_with_score(result, result.icp_score),
    )
    db.add(analysis)
    if lead:
        lead.industry = lead.industry or _fit_db_text(result.industry, 160)
        lead.niche = lead.niche or _fit_db_text(result.niche, 120)
        lead.notes = _merge_lead_metadata(lead, _analysis_metadata(result, result.icp_score), _analysis_readable_notes(result, result.icp_score))
    log_event(db, request, user_id, "website.analyzed", {"company": result.company, "website": result.website})
    db.commit()
    return result


@router.post("/ai/personalize", response_model=EmailVariantOut)
def ai_personalize(payload: PersonalizeRequest, request: Request, user_id: CurrentUser, db: Session = Depends(get_db)) -> EmailVariantOut:
    workspace = _current_workspace(db, user_id)
    _require_active_subscription(db, workspace)
    _enforce_usage(db, user_id, workspace, "ai_generations")
    try:
        result = personalize_email(payload)
    except Exception as exc:
        raise _provider_error(exc) from exc
    log_event(db, request, user_id, "email.generated", {"company": payload.company})
    db.commit()
    return result


@router.post("/ai/personalize/stream")
def ai_personalize_stream(payload: PersonalizeRequest, user_id: CurrentUser) -> StreamingResponse:
    del user_id
    return StreamingResponse(stream_email_generation(payload), media_type="text/plain")


@router.post("/ai/rewrite")
def ai_rewrite(payload: RewriteEmailRequest, request: Request, user_id: CurrentUser, db: Session = Depends(get_db)) -> dict[str, str]:
    workspace = _current_workspace(db, user_id)
    _require_active_subscription(db, workspace)
    _enforce_usage(db, user_id, workspace, "ai_generations")
    try:
        result = rewrite_email(payload)
    except Exception as exc:
        raise _provider_error(exc) from exc
    log_event(db, request, user_id, "email.rewritten", {"tone": payload.tone})
    db.commit()
    return result


@router.post("/ai/reply-assistant", response_model=ReplyAssistantOut)
def ai_reply_assistant(payload: ReplyAssistantRequest, request: Request, user_id: CurrentUser, db: Session = Depends(get_db)) -> ReplyAssistantOut:
    workspace = _current_workspace(db, user_id)
    _require_active_subscription(db, workspace)
    plan = _plan_for_workspace(db, user_id, workspace)
    if not PLAN_LIMITS[plan]["reply_ai"]:
        raise HTTPException(status_code=402, detail=_upgrade_message(plan, "AI Reply Assistant"))
    _enforce_usage(db, user_id, workspace, "ai_generations")
    try:
        result = suggest_reply(payload)
    except Exception as exc:
        raise _provider_error(exc) from exc
    log_event(db, request, user_id, "reply.assistant_generated", {"company": payload.company, "score": result.qualification_score})
    db.commit()
    return result


@router.post("/leads/{lead_id}/draft-email", response_model=EmailOut)
def draft_email_for_lead(lead_id: UUID, request: Request, user_id: CurrentUser, db: Session = Depends(get_db)) -> EmailMessage:
    workspace = _current_workspace(db, user_id)
    _require_active_subscription(db, workspace)
    _enforce_usage(db, user_id, workspace, "ai_generations")
    lead = db.scalar(select(Lead).where(Lead.id == lead_id, _workspace_stmt(Lead, workspace, user_id)))
    if lead is None:
        raise HTTPException(status_code=404, detail="Lead not found")
    analysis = db.scalar(
        select(WebsiteAnalysis)
        .where(_workspace_stmt(WebsiteAnalysis, workspace, user_id), WebsiteAnalysis.lead_id == lead.id)
        .order_by(WebsiteAnalysis.created_at.desc())
    )
    intelligence = _lead_metadata(lead)
    website_summary = "\n".join(
        part
        for part in [
            analysis.summary if analysis else "",
            str(intelligence.get("ai_summary") or ""),
            f"Sales angle: {intelligence.get('sales_angle')}" if intelligence.get("sales_angle") else "",
            f"Suggested offer: {intelligence.get('suggested_offer')}" if intelligence.get("suggested_offer") else "",
            f"Outreach strategy: {intelligence.get('outreach_strategy')}" if intelligence.get("outreach_strategy") else "",
            f"Verified email: {lead.email}" if intelligence.get("hunter_verified") and lead.email else "",
        ]
        if part
    ) or " ".join(part for part in [lead.website, lead.industry, lead.country, lead.city] if part) or lead.company
    ai_payload = PersonalizeRequest(
        company=lead.company,
        niche=lead.industry or lead.niche or "B2B",
        website_summary=website_summary,
        offer=str(intelligence.get("suggested_offer") or "a practical growth improvement based on their website"),
        cta=str(intelligence.get("recommended_cta") or "Would it be useful to compare ideas for 10 minutes?"),
        tone=str(intelligence.get("recommended_tone") or "Professional"),
        language=workspace.language or str(intelligence.get("detected_language") or "English"),
        signature="",
    )
    try:
        generated = personalize_email(ai_payload)
    except Exception as exc:
        raise _provider_error(exc) from exc
    follow_ups = generated.follow_ups[:2]
    message = EmailMessage(
        user_id=user_id,
        workspace_id=workspace.id,
        campaign_id=lead.campaign_id,
        lead_id=lead.id,
        subject=generated.subject,
        preview=generated.preview,
        body=generated.full_email,
        cta=generated.cta,
        follow_up_1=follow_ups[0] if len(follow_ups) > 0 else "",
        follow_up_2=follow_ups[1] if len(follow_ups) > 1 else "",
        direction="outbound",
        delivery_status="draft",
        tags={"requires_approval": True, "source": "manual_lead_flow"},
    )
    lead.status = LeadStatus.qualified
    lead.notes = _merge_lead_metadata(lead, {"email_status": "Draft Ready", "email_generated_at": datetime.utcnow().isoformat()})
    db.add(message)
    _sync_lead_to_crm(db, user_id, workspace, lead)
    _add_lead_activity(db, request, user_id, workspace, "email.generated", lead, {"email_id": str(message.id), "source": "manual_lead_flow"})
    _notify(db, user_id, NotificationKind.success, "Draft ready for review", f"A personalized email for {lead.company} is ready. Nothing was sent.")
    db.commit()
    db.refresh(message)
    return message


@router.post("/emails/generate", response_model=EmailOut)
def generate_email(payload: GenerateEmailRequest, request: Request, user_id: CurrentUser, db: Session = Depends(get_db)) -> EmailMessage:
    workspace = _current_workspace(db, user_id)
    _require_active_subscription(db, workspace)
    _enforce_usage(db, user_id, workspace, "ai_generations")
    campaign = db.scalar(select(Campaign).where(Campaign.id == payload.campaign_id, _workspace_stmt(Campaign, workspace, user_id)))
    lead = db.scalar(select(Lead).where(Lead.id == payload.lead_id, _workspace_stmt(Lead, workspace, user_id)))
    if campaign is None or lead is None:
        raise HTTPException(status_code=404, detail="Campaign or lead not found")
    analysis = db.scalar(
        select(WebsiteAnalysis)
        .where(_workspace_stmt(WebsiteAnalysis, workspace, user_id), WebsiteAnalysis.lead_id == lead.id)
        .order_by(WebsiteAnalysis.created_at.desc())
    )
    website_summary = analysis.summary if analysis else " ".join(
        part for part in [lead.website, lead.industry, lead.country, lead.city] if part
    )
    intelligence = _lead_metadata(lead)
    intelligence_summary = "\n".join(
        part for part in [
            str(intelligence.get("ai_summary") or ""),
            f"Sales angle: {intelligence.get('sales_angle')}" if intelligence.get("sales_angle") else "",
            f"Suggested offer: {intelligence.get('suggested_offer')}" if intelligence.get("suggested_offer") else "",
            f"Outreach strategy: {intelligence.get('outreach_strategy')}" if intelligence.get("outreach_strategy") else "",
            "Verified email available" if intelligence.get("hunter_verified") else "",
        ] if part
    )
    ai_payload = PersonalizeRequest(
        company=lead.company,
        niche=lead.industry or campaign.industry or "B2B",
        website_summary=intelligence_summary or website_summary or lead.company,
        offer=campaign.offer or str(intelligence.get("suggested_offer") or "") or "a measurable outbound growth system",
        cta=campaign.cta or str(intelligence.get("recommended_cta") or ""),
        tone=campaign.email_tone or str(intelligence.get("recommended_tone") or "Professional"),
        language=campaign.language,
        signature=campaign.signature,
    )
    try:
        generated = personalize_email(ai_payload)
    except Exception as exc:
        raise _provider_error(exc) from exc
    follow_ups = generated.follow_ups[:2]
    message = EmailMessage(
        user_id=user_id,
        workspace_id=workspace.id,
        campaign_id=campaign.id,
        lead_id=lead.id,
        subject=generated.subject,
        preview=generated.preview,
        body=generated.full_email,
        cta=generated.cta,
        follow_up_1=follow_ups[0] if len(follow_ups) > 0 else "",
        follow_up_2=follow_ups[1] if len(follow_ups) > 1 else "",
        direction="outbound",
        delivery_status="draft",
    )
    lead.status = LeadStatus.qualified
    lead.notes = _merge_lead_metadata(lead, {"email_status": "Draft Ready", "email_generated_at": datetime.utcnow().isoformat()})
    db.add(message)
    _sync_lead_to_crm(db, user_id, workspace, lead)
    _add_lead_activity(db, request, user_id, workspace, "email.generated", lead, {"campaign_id": str(campaign.id), "email_id": str(message.id)})
    _notify(db, user_id, NotificationKind.success, "Email generated", f"A personalized email for {lead.company} is ready to edit.")
    db.commit()
    db.refresh(message)
    return message


@router.patch("/emails/{email_id}", response_model=EmailOut)
def update_email(email_id: UUID, payload: EmailUpdate, request: Request, user_id: CurrentUser, db: Session = Depends(get_db)) -> EmailMessage:
    workspace = _current_workspace(db, user_id)
    message = db.scalar(select(EmailMessage).where(EmailMessage.id == email_id, _workspace_stmt(EmailMessage, workspace, user_id)))
    if message is None:
        raise HTTPException(status_code=404, detail="Email not found")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(message, "body" if key == "body" else key, value)
    log_event(db, request, user_id, "email.edited", {"email_id": str(message.id)})
    db.commit()
    db.refresh(message)
    return message


@router.post("/emails/{email_id}/approve", response_model=EmailOut)
def approve_email(email_id: UUID, request: Request, user_id: CurrentUser, db: Session = Depends(get_db)) -> EmailMessage:
    workspace = _current_workspace(db, user_id)
    message = db.scalar(select(EmailMessage).where(EmailMessage.id == email_id, _workspace_stmt(EmailMessage, workspace, user_id)))
    if message is None:
        raise HTTPException(status_code=404, detail="Email not found")
    lead = db.get(Lead, message.lead_id) if message.lead_id else None
    if lead is None:
        raise HTTPException(status_code=400, detail="Lead is required before approving an email.")
    now = datetime.utcnow()
    message.delivery_status = "approved"
    tags = message.tags if isinstance(message.tags, dict) else {}
    message.tags = {**tags, "approved": True, "approved_at": now.isoformat()}
    lead.status = LeadStatus.contacted
    lead.notes = _merge_lead_metadata(lead, {"email_status": "Approved", "email_approved_at": now.isoformat()})
    _sync_lead_to_crm(db, user_id, workspace, lead)
    _add_lead_activity(db, request, user_id, workspace, "email.approved", lead, {"email_id": str(message.id)})
    _notify(db, user_id, NotificationKind.success, "Email approved", f"{message.subject} is approved and ready to send.")
    db.commit()
    db.refresh(message)
    return message


@router.get("/outreach/sender/status", response_model=OutreachSenderStatusOut)
def outreach_sender_status(user_id: CurrentUser, db: Session = Depends(get_db)) -> OutreachSenderStatusOut:
    workspace = _current_workspace(db, user_id)
    return _outreach_sender_status(db, user_id, workspace)


@router.put("/outreach/sender", response_model=OutreachSenderStatusOut)
def update_outreach_sender(payload: OutreachSenderUpdate, request: Request, user_id: CurrentUser, db: Session = Depends(get_db)) -> OutreachSenderStatusOut:
    workspace = _current_workspace(db, user_id)
    settings = _settings_for_workspace(db, user_id, workspace)
    email_settings = settings.email if isinstance(settings.email, dict) else {}
    current_sender = _sender_settings(settings)
    provider = payload.provider.strip().lower()
    if provider not in SUPPORTED_OUTREACH_PROVIDERS:
        raise HTTPException(status_code=400, detail="Choose a supported sending option.")
    encrypted_password = current_sender["smtp"]["password_encrypted"]
    smtp_verified_at = current_sender["smtp"].get("verified_at", "")
    smtp_plain_password = ""
    if payload.smtp_password.strip():
        try:
            encrypted_password = encrypt_secret(payload.smtp_password, get_app_settings().encryption_key)
            smtp_plain_password = payload.smtp_password
        except SecretBoxError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
    elif provider == "smtp" and encrypted_password:
        try:
            smtp_plain_password = decrypt_secret(encrypted_password, get_app_settings().encryption_key)
        except SecretBoxError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc

    smtp_changed = (
        payload.smtp_host.strip() != current_sender["smtp"]["host"]
        or payload.smtp_port != current_sender["smtp"]["port"]
        or payload.smtp_username.strip() != current_sender["smtp"]["username"]
        or payload.smtp_use_tls != current_sender["smtp"]["use_tls"]
        or bool(payload.smtp_password.strip())
    )
    if provider == "smtp" and payload.enabled:
        smtp_verified_at = "" if smtp_changed else smtp_verified_at
        if payload.smtp_host.strip() and payload.smtp_username.strip() and encrypted_password:
            try:
                verify_smtp_connection(
                    host=payload.smtp_host.strip(),
                    port=payload.smtp_port,
                    username=payload.smtp_username.strip(),
                    password=smtp_plain_password,
                    use_tls=payload.smtp_use_tls,
                )
                smtp_verified_at = datetime.utcnow().isoformat()
            except (EmailProviderConfigurationError, EmailProviderRequestError) as exc:
                raise HTTPException(status_code=409, detail=str(exc)) from exc
    email_settings["sender"] = {
        "provider": provider,
        "sender_name": payload.sender_name.strip(),
        "sender_email": str(payload.sender_email or "").strip().lower(),
        "reply_to": str(payload.reply_to or "").strip().lower(),
        "daily_send_limit": payload.daily_send_limit,
        "enabled": payload.enabled,
        "smtp": {
            "host": payload.smtp_host.strip(),
            "port": payload.smtp_port,
            "username": payload.smtp_username.strip(),
            "password_encrypted": encrypted_password,
            "use_tls": payload.smtp_use_tls,
            "verified_at": smtp_verified_at,
        },
        "updated_at": datetime.utcnow().isoformat(),
    }
    settings.email = email_settings
    flag_modified(settings, "email")
    db.add(settings)
    log_event(db, request, user_id, "outreach.sender.updated", {"workspace_id": str(workspace.id), "provider": provider})
    db.commit()
    db.refresh(settings)
    return _outreach_sender_status(db, user_id, workspace)


@router.post("/emails/{email_id}/send", response_model=EmailOut)
def mark_email_sent(email_id: UUID, request: Request, user_id: CurrentUser, db: Session = Depends(get_db)) -> EmailMessage:
    workspace = _current_workspace(db, user_id)
    _require_active_subscription(db, workspace)
    sender_status, smtp_config = _outreach_sender_runtime_config(db, user_id, workspace)
    _enforce_usage(db, user_id, workspace, "email_sends")
    message = db.scalar(select(EmailMessage).where(EmailMessage.id == email_id, _workspace_stmt(EmailMessage, workspace, user_id)))
    if message is None:
        raise HTTPException(status_code=404, detail="Email not found")
    if message.delivery_status == "sent":
        raise HTTPException(status_code=400, detail="This email was already sent.")
    if message.delivery_status != "approved":
        raise HTTPException(status_code=400, detail="Approve the email before sending.")
    lead = db.get(Lead, message.lead_id) if message.lead_id else None
    if lead is None or not lead.email:
        raise HTTPException(status_code=400, detail="Lead email is required before sending.")
    try:
        provider_response = send_email(
            to_email=lead.email,
            subject=message.subject,
            body=message.body,
            from_email=sender_status.sender_email,
            from_name=sender_status.sender_name,
            reply_to=sender_status.reply_to,
            provider=sender_status.provider,
            smtp_config=smtp_config,
        )
    except Exception as exc:
        message.delivery_status = "failed"
        db.add(message)
        if lead:
            _add_lead_activity(db, request, user_id, workspace, "email.send_failed", lead, {"email_id": str(message.id), "reason": str(exc)})
        _notify(db, user_id, NotificationKind.error, "Email send failed", str(exc))
        db.commit()
        raise _provider_error(exc) from exc
    message.sent_at = datetime.utcnow()
    message.provider_message_id = str(provider_response.get("id"))
    message.delivery_status = "sent"
    message.tags = {**(message.tags if isinstance(message.tags, dict) else {}), "sender_email": sender_status.sender_email, "sender_provider": sender_status.provider}
    lead.status = LeadStatus.contacted
    lead.notes = _merge_lead_metadata(lead, {"email_status": "Sent", "email_sent_at": message.sent_at.isoformat()})
    _sync_lead_to_crm(db, user_id, workspace, lead)
    _add_lead_activity(db, request, user_id, workspace, "email.sent", lead, {"email_id": str(message.id), "provider_message_id": message.provider_message_id})
    _notify(db, user_id, NotificationKind.info, "Email sent", message.subject)
    db.commit()
    db.refresh(message)
    return message


@router.get("/inbox", response_model=list[EmailOut])
def inbox(user_id: CurrentUser, db: Session = Depends(get_db)) -> list[EmailMessage]:
    workspace = _current_workspace(db, user_id)
    messages = db.scalars(select(EmailMessage).where(_workspace_stmt(EmailMessage, workspace, user_id), EmailMessage.direction == "inbound").order_by(EmailMessage.created_at.desc())).all()
    return list(messages)


@router.get("/workspace", response_model=WorkspaceOut)
def get_workspace(user: CurrentUserContext, db: Session = Depends(get_db)) -> WorkspaceOut:
    return _workspace_out(db, _current_workspace(db, user.user_id, user.email))


@router.get("/workspace/me", response_model=WorkspaceOut)
def get_my_workspace(user: WorkspaceUserContext, db: Session = Depends(get_db)) -> WorkspaceOut:
    return _workspace_out(db, _current_workspace(db, user.user_id, user.email))


@router.put("/workspace", response_model=WorkspaceOut)
def update_workspace(payload: WorkspaceUpdate, request: Request, user: WorkspaceUserContext, db: Session = Depends(get_db)) -> WorkspaceOut:
    workspace = _current_workspace(db, user.user_id, user.email)
    for key, value in payload.model_dump().items():
        setattr(workspace, key, value)
    log_event(db, request, user.user_id, "workspace.updated", {"workspace_id": str(workspace.id)})
    db.commit()
    db.refresh(workspace)
    return _workspace_out(db, workspace)


@router.post("/workspace/members", response_model=WorkspaceMemberOut)
def invite_member(payload: MemberInvite, request: Request, user_id: CurrentUser, db: Session = Depends(get_db)) -> WorkspaceMember:
    del payload, request, user_id, db
    raise HTTPException(status_code=403, detail="Workspaces are private to one user. Team access is not enabled.")


@router.get("/onboarding", response_model=WorkspaceOut)
def get_onboarding(user_id: CurrentUser, db: Session = Depends(get_db)) -> WorkspaceOut:
    return _workspace_out(db, _current_workspace(db, user_id))


@router.put("/onboarding", response_model=WorkspaceOut)
def update_onboarding(payload: OnboardingUpdate, request: Request, user_id: CurrentUser, db: Session = Depends(get_db)) -> WorkspaceOut:
    workspace = _current_workspace(db, user_id)
    workspace.company = payload.company or workspace.company
    workspace.industry = payload.industry or workspace.industry
    workspace.target_country = payload.target_country or workspace.target_country
    workspace.target_customer = payload.target_customer or workspace.target_customer
    workspace.onboarding_step = payload.step
    workspace.onboarding_completed = payload.step >= 6 and payload.launch_first_campaign
    settings = _settings_for_workspace(db, user_id, workspace)
    settings.ai = {**(settings.ai or {}), "userOpenAIConnected": payload.connect_openai}
    log_event(db, request, user_id, "onboarding.updated", {"step": payload.step, "completed": workspace.onboarding_completed})
    db.commit()
    db.refresh(workspace)
    return _workspace_out(db, workspace)


@router.get("/activity", response_model=list[ActivityOut])
def activity(user_id: CurrentUser, db: Session = Depends(get_db)) -> list[AuditLog]:
    workspace = _current_workspace(db, user_id)
    return list(db.scalars(select(AuditLog).where(AuditLog.workspace_id == workspace.id).order_by(AuditLog.created_at.desc()).limit(50)).all())


@router.get("/notifications", response_model=list[NotificationOut])
def notifications(user_id: CurrentUser, db: Session = Depends(get_db)) -> list[Notification]:
    workspace = _current_workspace(db, user_id)
    return list(db.scalars(select(Notification).where(Notification.workspace_id == workspace.id).order_by(Notification.created_at.desc()).limit(30)).all())


@router.get("/profile", response_model=ProfileOut)
def get_profile(user_id: CurrentUser, db: Session = Depends(get_db)) -> WorkspaceProfile:
    workspace = _current_workspace(db, user_id)
    profile = db.scalar(select(WorkspaceProfile).where(WorkspaceProfile.workspace_id == workspace.id))
    if profile is None:
        profile = db.scalar(select(WorkspaceProfile).where(WorkspaceProfile.user_id == user_id, WorkspaceProfile.workspace_id.is_(None)))
    if profile is None:
        profile = WorkspaceProfile(user_id=user_id, workspace_id=workspace.id, workspace=workspace.name, company=workspace.company, timezone=workspace.timezone, language=workspace.language)
        db.add(profile)
        db.commit()
        db.refresh(profile)
    return profile


@router.put("/profile", response_model=ProfileOut)
def update_profile(payload: ProfileUpdate, request: Request, user_id: CurrentUser, db: Session = Depends(get_db)) -> WorkspaceProfile:
    workspace = _current_workspace(db, user_id)
    profile = db.scalar(select(WorkspaceProfile).where(WorkspaceProfile.workspace_id == workspace.id)) or WorkspaceProfile(user_id=user_id, workspace_id=workspace.id)
    for key, value in payload.model_dump().items():
        setattr(profile, key, value)
    workspace.name = payload.workspace or workspace.name
    workspace.company = payload.company or workspace.company
    workspace.timezone = payload.timezone or workspace.timezone
    workspace.language = payload.language or workspace.language
    db.add(profile)
    db.add(workspace)
    log_event(db, request, user_id, "profile.updated", {})
    db.commit()
    db.refresh(profile)
    return profile


@router.delete("/profile")
def delete_account(request: Request, user_id: CurrentUser, db: Session = Depends(get_db)) -> dict:
    log_event(db, request, user_id, "account.delete_requested", {})
    _notify(db, user_id, NotificationKind.warning, "Account deletion requested", "Your deletion request has been logged for processing.")
    db.commit()
    return {"status": "queued"}


@router.get("/settings", response_model=SettingsOut)
def get_settings_route(user_id: CurrentUser, db: Session = Depends(get_db)) -> AppSettings:
    workspace = _current_workspace(db, user_id)
    return _settings_for_workspace(db, user_id, workspace)


@router.put("/settings", response_model=SettingsOut)
def update_settings(payload: SettingsUpdate, request: Request, user_id: CurrentUser, db: Session = Depends(get_db)) -> AppSettings:
    workspace = _current_workspace(db, user_id)
    settings = _settings_for_workspace(db, user_id, workspace)
    for key, value in payload.model_dump().items():
        setattr(settings, key, value)
    db.add(settings)
    log_event(db, request, user_id, "settings.updated", {})
    db.commit()
    db.refresh(settings)
    return settings


@router.post("/billing/checkout")
def billing_checkout(payload: CheckoutRequest, request: Request, user_id: CurrentUser, db: Session = Depends(get_db)) -> dict:
    workspace = _current_workspace(db, user_id)
    if payload.plan not in PLAN_LIMITS:
        raise HTTPException(status_code=400, detail="Unknown subscription plan")
    settings = _settings_for_workspace(db, user_id, workspace)
    customer_id = str((settings.billing or {}).get("stripeCustomerId") or "")
    try:
        session = create_checkout_session(user_id, str(workspace.id), payload.plan, customer_id)
    except ValueError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    settings.billing = {
        **(settings.billing or {}),
        "pendingPlan": payload.plan,
        "status": (settings.billing or {}).get("status") or "inactive",
        "checkoutSessionId": session.get("id"),
        "stripeCustomerId": session.get("customer_id") or customer_id,
    }
    log_event(db, request, user_id, "billing.checkout", {"plan": payload.plan})
    db.commit()
    return session


@router.get("/billing/plans", response_model=list[BillingPlanOut])
def billing_plans(user_id: CurrentUser, db: Session = Depends(get_db)) -> list[BillingPlanOut]:
    workspace = _current_workspace(db, user_id)
    current = _plan_for_workspace(db, user_id, workspace)
    active = _has_active_subscription(db, workspace)
    return [BillingPlanOut(name=name, price=int(limits["mrr"]), limits=limits, current=active and name == current, active_subscription=active) for name, limits in PLAN_LIMITS.items()]


@router.post("/billing/portal")
def billing_portal(payload: BillingPortalRequest, request: Request, user_id: CurrentUser, db: Session = Depends(get_db)) -> dict:
    workspace = _current_workspace(db, user_id)
    settings = _settings_for_workspace(db, user_id, workspace)
    if not _has_active_subscription(db, workspace):
        raise HTTPException(status_code=402, detail="An active subscription is required to open the Billing Portal.")
    customer_id = str((settings.billing or {}).get("stripeCustomerId") or "")
    try:
        session = create_billing_portal_session(customer_id, str(payload.return_url))
    except ValueError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    log_event(db, request, user_id, "billing.portal", {"workspace_id": str(workspace.id)})
    db.commit()
    return session


@router.get("/billing/diagnostics", response_model=BillingDiagnosticsOut)
def billing_diagnostics(user_id: CurrentUser) -> BillingDiagnosticsOut:
    del user_id
    settings = get_app_settings()
    checkout_works = False
    if settings.stripe_secret_key and settings.stripe_webhook_secret:
        try:
            checkout_works = all(price_for_plan(plan) for plan in ("Starter", "Pro", "Agency"))
        except Exception:
            checkout_works = False
    return BillingDiagnosticsOut(
        stripe_secret_loaded=bool(settings.stripe_secret_key),
        webhook_secret_loaded=bool(settings.stripe_webhook_secret),
        publishable_key_loaded=bool(settings.stripe_public_key),
        starter_price_id_loaded=bool(settings.stripe_starter_price_id),
        pro_price_id_loaded=bool(settings.stripe_pro_price_id),
        agency_price_id_loaded=bool(settings.stripe_agency_price_id),
        checkout_session_creation_works=checkout_works,
        webhook_receives_signed_events=bool(settings.stripe_webhook_secret),
        subscription_sync_healthy=checkout_works and bool(settings.stripe_webhook_secret),
    )


@router.post("/billing/sync-latest-subscription", response_model=BillingSyncOut)
def billing_sync_latest_subscription(payload: BillingSyncRequest, request: Request, user_id: CurrentUser, db: Session = Depends(get_db)) -> BillingSyncOut:
    workspace = _current_workspace(db, user_id)
    settings_row = _settings_for_workspace(db, user_id, workspace)
    customer_id = (payload.stripe_customer_id or str((settings_row.billing or {}).get("stripeCustomerId") or "")).strip()
    customer_email = str(payload.customer_email or "").strip()
    if not customer_id and not customer_email:
        raise HTTPException(status_code=400, detail="Provide customer_email or stripe_customer_id")
    try:
        customer, subscription = latest_subscription_for_customer(customer_id=customer_id, customer_email=customer_email)
    except ValueError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Billing subscription lookup failed") from exc
    if not customer:
        return BillingSyncOut(synced=False, customer_found=False, subscription_found=False, message="Billing customer not found")
    if not subscription:
        return BillingSyncOut(synced=False, customer_found=True, subscription_found=False, stripe_customer_id=str(customer.id), message="No billing subscription found for customer")
    sub = subscription_payload(subscription)
    plan = str(sub["plan"]) if str(sub["plan"]) in PLAN_LIMITS else "Starter"
    synced = _sync_workspace_subscription(
        db,
        user_id=user_id,
        workspace=workspace,
        settings=settings_row,
        stripe_customer_id=str(sub["customer_id"] or customer.id),
        stripe_subscription_id=str(sub["subscription_id"]),
        stripe_price_id=str(sub["price_id"]),
        plan=plan,
        status=str(sub["status"]),
        trial_end=sub["trial_end"],
        current_period_end=sub["current_period_end"],
    )
    log_event(db, request, user_id, "billing.subscription_synced", {"workspace_id": str(workspace.id), "plan": plan, "status": synced.status})
    db.commit()
    return BillingSyncOut(
        synced=True,
        plan=plan,
        status=synced.status,
        stripe_customer_id=synced.stripe_customer_id or "",
        stripe_subscription_id=synced.stripe_subscription_id or "",
        trial_end=synced.trial_end,
        current_period_end=synced.current_period_end,
        workspace_id=workspace.id,
        price_id_loaded=bool(sub["price_id"]),
        subscription_found=True,
        customer_found=True,
        message="Latest billing subscription synced to this workspace",
    )


@router.get("/billing/status", response_model=BillingStatusOut)
def billing_status(user_id: CurrentUser, db: Session = Depends(get_db)) -> BillingStatusOut:
    app_settings = get_app_settings()
    workspace = _current_workspace(db, user_id)
    key = cache_key("billing-status", workspace.id, user_id)
    cached = get_json(key)
    if cached:
        return BillingStatusOut.model_validate(cached)
    plan = _plan_for_workspace(db, user_id, workspace)
    usage = _usage_for_workspace(db, workspace)
    subscription = _latest_subscription(db, workspace)
    settings = _settings_for_workspace(db, user_id, workspace)
    billing = settings.billing or {}
    status = subscription.status if subscription else str(billing.get("status") or "inactive")
    trial_end = subscription.trial_end if subscription else _parse_billing_datetime(billing.get("trialEnd"))
    current_period_end = subscription.current_period_end if subscription else _parse_billing_datetime(billing.get("currentPeriodEnd"))
    trial_days_remaining = 0
    if trial_end:
        trial_days_remaining = max(0, (trial_end.date() - datetime.utcnow().date()).days)
    sales_employees_used = db.scalar(select(func.count()).select_from(AISalesEmployee).where(AISalesEmployee.workspace_id == workspace.id, AISalesEmployee.user_id == user_id)) or 0
    workspaces_used = db.scalar(select(func.count()).select_from(WorkspaceMember).where(WorkspaceMember.user_id == user_id, WorkspaceMember.status == "active")) or 1
    output = BillingStatusOut(
        plan=plan,
        price=int(PLAN_LIMITS[plan]["mrr"]),
        status=status,
        trial_end=trial_end,
        current_period_end=current_period_end,
        trial_days_remaining=trial_days_remaining,
        stripe_customer_id=str(billing.get("stripeCustomerId") or (subscription.stripe_customer_id if subscription else "") or ""),
        stripe_subscription_id=str(billing.get("stripeSubscriptionId") or (subscription.stripe_subscription_id if subscription else "") or ""),
        last_payment_error=str((subscription.last_payment_error if subscription else None) or billing.get("lastPaymentError") or ""),
        last_decline_code=str((subscription.last_decline_code if subscription else None) or billing.get("lastDeclineCode") or ""),
        last_failure_message=str((subscription.last_failure_message if subscription else None) or billing.get("lastFailureMessage") or ""),
        last_payment_failed_at=(subscription.last_payment_failed_at if subscription else None) or _parse_billing_datetime(billing.get("lastPaymentFailedAt")),
        limits=PLAN_LIMITS[plan],
        usage={"leads": usage.leads, "ai_generations": usage.ai_generations, "email_sends": usage.email_sends},
        sales_employees_used=int(sales_employees_used),
        workspaces_used=int(workspaces_used),
    )
    set_json(key, output.model_dump(mode="json"), app_settings.cache_billing_ttl_seconds)
    return output


@router.get("/billing/invoices")
def billing_invoices(user_id: CurrentUser, db: Session = Depends(get_db)) -> list[dict]:
    workspace = _current_workspace(db, user_id)
    settings = _settings_for_workspace(db, user_id, workspace)
    customer_id = str((settings.billing or {}).get("stripeCustomerId") or "")
    return list_invoices(customer_id)


@router.get("/billing/usage", response_model=UsageOut)
def billing_usage(user_id: CurrentUser, db: Session = Depends(get_db)) -> UsageOut:
    workspace = _current_workspace(db, user_id)
    plan = _plan_for_workspace(db, user_id, workspace)
    usage = _usage_for_workspace(db, workspace)
    return UsageOut(
        plan=plan,
        period=usage.period,
        limits=PLAN_LIMITS[plan],
        usage={"leads": usage.leads, "ai_generations": usage.ai_generations, "email_sends": usage.email_sends},
    )


@router.post("/billing/catalog")
def billing_catalog(request: Request, user_id: CurrentUser, db: Session = Depends(get_db)) -> dict:
    try:
        catalog = ensure_subscription_catalog()
    except ValueError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    log_event(db, request, user_id, "billing.catalog_synced", {"plans": [item["plan"] for item in catalog]})
    db.commit()
    return {"items": catalog}


OWNER_FEATURE_FLAG_DEFAULTS = {
    "ai_ceo_voice": False,
    "experimental_features": False,
    "admin_nav": False,
    "analytics_nav": False,
    "ai_marketplace": False,
}


def _owner_feature_flags(settings: AppSettings) -> OwnerFeatureFlagsOut:
    raw = settings.general.get("owner_feature_flags") if isinstance(settings.general, dict) else {}
    flags = {**OWNER_FEATURE_FLAG_DEFAULTS, **(raw if isinstance(raw, dict) else {})}
    return OwnerFeatureFlagsOut(**{key: bool(flags.get(key)) for key in OWNER_FEATURE_FLAG_DEFAULTS})


@router.get("/owner/console", response_model=OwnerConsoleOut)
def owner_console(owner: OwnerUser, db: Session = Depends(get_db)) -> OwnerConsoleOut:
    workspace = _current_workspace(db, owner.user_id)
    settings = _settings_for_workspace(db, owner.user_id, workspace)
    usage = {
        "leads": int(db.scalar(select(func.coalesce(func.sum(UsageCounter.leads), 0))) or 0),
        "ai_generations": int(db.scalar(select(func.coalesce(func.sum(UsageCounter.ai_generations), 0))) or 0),
        "email_sends": int(db.scalar(select(func.coalesce(func.sum(UsageCounter.email_sends), 0))) or 0),
    }
    subscription_rows = list(db.scalars(select(Subscription)).all())
    subscriptions_by_status: dict[str, int] = {}
    for subscription in subscription_rows:
        subscriptions_by_status[subscription.status] = subscriptions_by_status.get(subscription.status, 0) + 1
    revenue_won = float(db.scalar(select(func.coalesce(func.sum(Lead.revenue), 0)).where(Lead.status == LeadStatus.won)) or 0)
    active_subscriptions = sum(count for status_name, count in subscriptions_by_status.items() if status_name in {"active", "trialing"})
    mrr = float(sum(PLAN_LIMITS.get(subscription.plan, {}).get("mrr", 0) for subscription in subscription_rows if subscription.status in {"active", "trialing"}))
    logs = list(db.scalars(select(AuditLog).order_by(AuditLog.created_at.desc()).limit(25)).all())
    return OwnerConsoleOut(
        executive_overview={
            "status": "operational",
            "owner": owner.email,
            "active_subscriptions": active_subscriptions,
            "recent_audit_events": len(logs),
        },
        revenue={"mrr": mrr, "arr": mrr * 12, "revenue_influenced": revenue_won},
        customers={
            "users": db.scalar(select(func.count()).select_from(User)) or 0,
            "workspaces": db.scalar(select(func.count()).select_from(Workspace)) or 0,
            "leads": db.scalar(select(func.count()).select_from(Lead)) or 0,
        },
        subscriptions={**subscriptions_by_status, "total": len(subscription_rows)},
        ai_usage=usage,
        product_analytics={
            "campaigns": db.scalar(select(func.count()).select_from(Campaign)) or 0,
            "emails": db.scalar(select(func.count()).select_from(EmailMessage)) or 0,
            "ai_employees": db.scalar(select(func.count()).select_from(AISalesEmployee)) or 0,
        },
        error_monitoring={"open_errors": 0, "last_status": "No blocking errors recorded"},
        system_health={"api": "ok", "database": "ok", "webhooks": "ok", "email": "configured" if get_app_settings().resend_api_key else "not configured"},
        feature_flags=_owner_feature_flags(settings),
        audit_logs=logs,
    )


@router.patch("/owner/feature-flags", response_model=OwnerFeatureFlagsOut)
def owner_feature_flags(payload: OwnerFeatureFlagsUpdate, request: Request, owner: OwnerUser, db: Session = Depends(get_db)) -> OwnerFeatureFlagsOut:
    workspace = _current_workspace(db, owner.user_id)
    settings = _settings_for_workspace(db, owner.user_id, workspace)
    current = _owner_feature_flags(settings).model_dump()
    updates = payload.model_dump(exclude_none=True)
    settings.general = {**(settings.general or {}), "owner_feature_flags": {**current, **updates}}
    log_event(db, request, owner.user_id, "owner.feature_flags_updated", {"flags": updates})
    db.commit()
    db.refresh(settings)
    return _owner_feature_flags(settings)


QUALITY_MODULES = {
    "error_doctor": "AI Error Doctor",
    "test_generator": "AI Test Generator",
    "production_qa": "AI Production QA Agent",
    "log_analyzer": "AI Log Analyzer",
    "integration_monitor": "AI Integration Monitor",
    "ux_bug_finder": "AI UX Bug Finder",
    "data_consistency": "AI Data Consistency Checker",
    "security_checker": "AI Security Checker",
    "deployment_gate": "AI Deployment Gate",
}


def _quality_check(name: str, module: str, status: str, severity: str, summary: str, evidence: Optional[dict[str, Any]] = None, suggested_fix: str = "") -> QualityCheckOut:
    return QualityCheckOut(name=name, module=module, status=status, severity=severity, summary=summary, evidence=evidence or {}, suggested_fix=suggested_fix)


def _quality_fingerprint(check: QualityCheckOut) -> str:
    return f"{check.module}:{check.name}".lower().replace(" ", "_")


def _upsert_quality_issue(db: Session, check: QualityCheckOut, owner_email: str) -> Optional[QualityIssue]:
    if check.status == "healthy":
        return None
    fingerprint = _quality_fingerprint(check)
    issue = db.scalar(select(QualityIssue).where(QualityIssue.fingerprint == fingerprint))
    if issue is None:
        issue = QualityIssue(fingerprint=fingerprint, title=check.name, module=check.module, created_by=owner_email)
    issue.severity = check.severity
    issue.status = "open" if check.status in {"degraded", "broken", "blocked"} else check.status
    issue.affected_area = check.module
    issue.root_cause = check.summary
    issue.suggested_fix = check.suggested_fix
    issue.evidence_json = check.evidence
    db.add(issue)
    return issue


def _count_grouped_duplicates(db: Session, column: Any, *extra_columns: Any) -> int:
    columns = (column, *extra_columns)
    rows = db.execute(
        select(*columns, func.count())
        .select_from(Company)
        .where(column.is_not(None), column != "")
        .group_by(*columns)
        .having(func.count() > 1)
    ).all()
    return len(rows)


def _quality_checks(db: Session) -> list[QualityCheckOut]:
    settings = get_app_settings()
    checks: list[QualityCheckOut] = []

    sentry_related_logs = int(db.scalar(select(func.count()).select_from(AuditLog).where(or_(AuditLog.action.ilike("%error%"), AuditLog.action.ilike("%exception%"), AuditLog.action.ilike("%failed%")))) or 0)
    checks.append(_quality_check(
        "Error issue intake",
        QUALITY_MODULES["error_doctor"],
        "healthy" if settings.sentry_dsn else "blocked",
        "medium" if settings.sentry_dsn else "high",
        "Error monitoring is configured and app-side events can be grouped." if settings.sentry_dsn else "Error monitoring is not loaded, so production exceptions cannot be sent to monitoring.",
        {"error_monitoring_loaded": bool(settings.sentry_dsn), "recent_error_like_audit_logs": sentry_related_logs},
        "Load backend error monitoring and keep service errors tagged with endpoint, workspace and lead context.",
    ))

    provider_flags = {
        "Lead search": bool(settings.google_maps_api_key),
        "Email verification": bool(settings.hunter_api_key),
        "AI analysis": bool(settings.openai_api_key),
        "Email sending": bool(settings.resend_api_key and settings.resend_from_email),
        "Billing": bool(settings.stripe_secret_key and settings.stripe_webhook_secret and settings.stripe_starter_price_id and settings.stripe_pro_price_id and settings.stripe_agency_price_id),
        "Authentication": bool(settings.clerk_secret_key and settings.clerk_secret_key != "dev" and settings.clerk_jwt_issuer),
        "Product analytics": True,
        "Error monitoring": bool(settings.sentry_dsn),
    }
    missing_integrations = [name for name, ok in provider_flags.items() if not ok]
    checks.append(_quality_check(
        "Production integration monitor",
        QUALITY_MODULES["integration_monitor"],
        "healthy" if not missing_integrations else "degraded",
        "high" if {"Lead search", "Email verification", "AI analysis", "Email sending", "Billing", "Authentication"} & set(missing_integrations) else "medium",
        "All critical connections are configured." if not missing_integrations else f"Missing or incomplete connection: {', '.join(missing_integrations)}.",
        {"providers": provider_flags},
        "Update the missing production settings, restart the affected service, then run the quality check again.",
    ))

    last_logs = list(db.scalars(select(AuditLog).order_by(AuditLog.created_at.desc()).limit(200)).all())
    status_spikes: dict[str, int] = {"401": 0, "403": 0, "404": 0, "500": 0}
    provider_failures: dict[str, int] = {}
    for log in last_logs:
        metadata = log.metadata_json or {}
        status_code = str(metadata.get("status") or metadata.get("status_code") or "")
        if status_code in status_spikes:
            status_spikes[status_code] += 1
        provider = str(metadata.get("provider") or "")
        if provider and ("failed" in log.action or status_code.startswith(("4", "5"))):
            provider_failures[provider] = provider_failures.get(provider, 0) + 1
    noisy_statuses = {key: value for key, value in status_spikes.items() if value >= 5}
    checks.append(_quality_check(
        "Log spike analyzer",
        QUALITY_MODULES["log_analyzer"],
        "healthy" if not noisy_statuses and not provider_failures else "degraded",
        "high" if status_spikes["500"] >= 5 else "medium",
        "No API error spikes found in recent audit logs." if not noisy_statuses and not provider_failures else "Recent logs show repeated API/provider failures.",
        {"status_spikes": status_spikes, "provider_failures": provider_failures, "sample_size": len(last_logs)},
        "Inspect the affected endpoint/provider logs, add a regression test, and keep the user-facing error specific.",
    ))

    leads_without_companies = int(db.scalar(select(func.count()).select_from(Lead).outerjoin(Company, Company.lead_id == Lead.id).where(Company.id.is_(None))) or 0)
    contacts_without_leads = int(db.scalar(select(func.count()).select_from(Contact).where(Contact.lead_id.is_(None))) or 0)
    emails_without_leads = int(db.scalar(select(func.count()).select_from(EmailMessage).where(EmailMessage.lead_id.is_(None), EmailMessage.direction == "outbound")) or 0)
    duplicate_place_ids = _count_grouped_duplicates(db, Company.place_id)
    duplicate_websites = _count_grouped_duplicates(db, Company.website)
    duplicate_name_city = _count_grouped_duplicates(db, Company.name, Company.city)
    broken_stages = int(db.scalar(select(func.count()).select_from(Company).where(Company.crm_stage.not_in(CRM_STAGES))) or 0)
    data_defects = leads_without_companies + contacts_without_leads + emails_without_leads + duplicate_place_ids + duplicate_websites + duplicate_name_city + broken_stages
    checks.append(_quality_check(
        "CRM data consistency",
        QUALITY_MODULES["data_consistency"],
        "healthy" if data_defects == 0 else "degraded",
        "high" if leads_without_companies or broken_stages else "medium",
        "CRM records are linked and pipeline stages are valid." if data_defects == 0 else "CRM has orphaned records, duplicates, or invalid pipeline stages.",
        {
            "leads_without_companies": leads_without_companies,
            "contacts_without_leads": contacts_without_leads,
            "outbound_emails_without_leads": emails_without_leads,
            "duplicate_place_ids": duplicate_place_ids,
            "duplicate_websites": duplicate_websites,
            "duplicate_company_city": duplicate_name_city,
            "broken_pipeline_stages": broken_stages,
        },
        "Run a CRM repair migration that links missing companies, deduplicates by place_id/website/name+city, and normalizes stages.",
    ))

    lead_count = int(db.scalar(select(func.count()).select_from(Lead)) or 0)
    analyzed_count = int(db.scalar(select(func.count()).select_from(WebsiteAnalysis)) or 0)
    draft_count = int(db.scalar(select(func.count()).select_from(EmailMessage).where(EmailMessage.delivery_status == "draft")) or 0)
    campaign_count = int(db.scalar(select(func.count()).select_from(Campaign)) or 0)
    sent_count = int(db.scalar(select(func.count()).select_from(EmailMessage).where(EmailMessage.delivery_status.in_(["sent", "delivered", "opened", "replied"]))) or 0)
    flow_blockers = []
    if lead_count and not analyzed_count:
        flow_blockers.append("website analysis")
    if lead_count and not draft_count:
        flow_blockers.append("AI email draft")
    if draft_count and not campaign_count:
        flow_blockers.append("campaign")
    checks.append(_quality_check(
        "Daily production QA flow",
        QUALITY_MODULES["production_qa"],
        "healthy" if not flow_blockers else "degraded",
        "high" if flow_blockers else "low",
        "Core workflow has data through the customer path." if not flow_blockers else f"Core workflow appears incomplete at: {', '.join(flow_blockers)}.",
        {"leads": lead_count, "website_analyses": analyzed_count, "draft_emails": draft_count, "campaigns": campaign_count, "sent_emails": sent_count},
        "Run the end-to-end QA flow with a safe test account and create regression coverage for the first broken step.",
    ))

    checks.append(_quality_check(
        "UX bug scanner coverage",
        QUALITY_MODULES["ux_bug_finder"],
        "healthy",
        "low",
        "Playwright covers desktop and mobile dashboard routes, lead workflow, campaign workflow, and dashboard failure resilience.",
        {"desktop_mobile_routes_covered": True, "horizontal_overflow_check": "covered by mobile route smoke tests"},
        "Keep adding Playwright assertions for every visual regression or duplicate UI block found in production.",
    ))

    security_gaps = []
    if settings.debug:
        security_gaps.append("DEBUG is enabled")
    if not settings.stripe_webhook_secret:
        security_gaps.append("billing webhook signature secret missing")
    if not settings.resend_webhook_secret:
        security_gaps.append("email webhook signature secret missing")
    if settings.encryption_key == "replace-with-32-byte-url-safe-key":
        security_gaps.append("default encryption key")
    checks.append(_quality_check(
        "Security guardrails",
        QUALITY_MODULES["security_checker"],
        "healthy" if not security_gaps else "broken",
        "critical" if settings.debug or settings.encryption_key == "replace-with-32-byte-url-safe-key" else "high",
        "Security guardrails are configured." if not security_gaps else f"Security configuration needs attention: {', '.join(security_gaps)}.",
        {"debug": settings.debug, "stripe_webhook_secret": bool(settings.stripe_webhook_secret), "resend_webhook_secret": bool(settings.resend_webhook_secret), "encryption_key_custom": settings.encryption_key != "replace-with-32-byte-url-safe-key"},
        "Disable debug, configure webhook signing secrets, rotate the encryption key, and rerun auth/workspace isolation tests.",
    ))

    deployment_gate = {
        "backend_lint": "required",
        "backend_tests": "required",
        "frontend_lint": "required",
        "frontend_tests": "required",
        "production_build": "required",
        "playwright_e2e": "required",
        "critical_sentry_errors": "must_be_zero",
        "health_checks": "required",
    }
    checks.append(_quality_check(
        "Deployment gate",
        QUALITY_MODULES["deployment_gate"],
        "healthy",
        "medium",
        "Deployments must pass lint, tests, build, E2E, Sentry review, and health checks before approval.",
        deployment_gate,
        "Block release approval until every gate is green and the owner approves deployment.",
    ))

    return checks


def _quality_score(checks: list[QualityCheckOut]) -> int:
    penalties = {"critical": 25, "high": 14, "medium": 7, "low": 2}
    score = 100
    for check in checks:
        if check.status != "healthy":
            score -= penalties.get(check.severity, 5)
    return max(0, score)


def _quality_summary(db: Session, owner_email: str, persist: bool) -> QualityDashboardOut:
    checks = _quality_checks(db)
    for check in checks:
        if check.status != "healthy":
            _upsert_quality_issue(db, check, owner_email)
    score = _quality_score(checks)
    status = "healthy" if score >= 90 else "degraded" if score >= 70 else "broken"
    summary = "Quality system is healthy." if status == "healthy" else "Quality system found issues that need owner review before deploy."
    if persist:
        db.add(QualityCheckRun(triggered_by=owner_email, health_score=score, status=status, summary=summary, checks_json={"checks": [check.model_dump() for check in checks]}))
        db.commit()
    open_issues = list(db.scalars(select(QualityIssue).where(QualityIssue.status == "open").order_by(QualityIssue.created_at.desc()).limit(50)).all())
    tasks = list(db.scalars(select(QualityRepairTask).order_by(QualityRepairTask.created_at.desc()).limit(25)).all())
    last_run = db.scalar(select(QualityCheckRun).order_by(QualityCheckRun.created_at.desc()).limit(1))
    failed = [check for check in checks if check.status != "healthy"]
    return QualityDashboardOut(
        health_score=score,
        status=status,
        summary=summary,
        deployment_gate=next((check.evidence for check in checks if check.name == "Deployment gate"), {}),
        checks=checks,
        open_bugs=open_issues,
        repair_tasks=tasks,
        sentry_issues=[issue.evidence_json for issue in open_issues if issue.module == QUALITY_MODULES["error_doctor"]],
        failed_integrations=[check for check in checks if check.module == QUALITY_MODULES["integration_monitor"] and check.status != "healthy"],
        failed_tests=[check for check in checks if check.module == QUALITY_MODULES["deployment_gate"] and check.status != "healthy"],
        broken_flows=[check for check in checks if check.module == QUALITY_MODULES["production_qa"] and check.status != "healthy"],
        suggested_fixes=[check.suggested_fix for check in failed if check.suggested_fix],
        last_run_at=last_run.created_at if last_run else None,
    )


@router.get("/admin/quality", response_model=QualityDashboardOut)
def admin_quality(owner: OwnerUser, db: Session = Depends(get_db)) -> QualityDashboardOut:
    return _quality_summary(db, owner.email, persist=False)


@router.post("/admin/quality/run", response_model=QualityDashboardOut)
def admin_quality_run(request: Request, owner: OwnerUser, db: Session = Depends(get_db)) -> QualityDashboardOut:
    result = _quality_summary(db, owner.email, persist=True)
    log_event(db, request, owner.user_id, "quality.qa_run", {"health_score": result.health_score, "status": result.status})
    db.commit()
    return result


@router.post("/admin/quality/tasks", response_model=QualityRepairTaskOut)
def admin_quality_create_task(payload: QualityRepairTaskCreate, request: Request, owner: OwnerUser, db: Session = Depends(get_db)) -> QualityRepairTask:
    issue = db.scalar(select(QualityIssue).where(QualityIssue.fingerprint == payload.fingerprint))
    if issue is None:
        raise HTTPException(status_code=404, detail="Quality issue not found")
    existing = db.scalar(select(QualityRepairTask).where(QualityRepairTask.issue_id == issue.id, QualityRepairTask.status != "done"))
    if existing:
        return existing
    task = QualityRepairTask(
        issue_id=issue.id,
        title=f"Repair: {issue.title}",
        priority=issue.severity,
        status="needs_approval",
        owner_email=owner.email,
        diagnosis=issue.root_cause,
        suggested_fix=issue.suggested_fix,
        required_tests=[
            "backend regression test for the failing API or data state",
            "frontend unit test for the user-facing state",
            "Playwright E2E test for the affected customer flow",
            "production smoke check after deploy",
        ],
        approval_required=True,
    )
    db.add(task)
    log_event(db, request, owner.user_id, "quality.repair_task_created", {"issue_id": str(issue.id), "fingerprint": issue.fingerprint, "priority": issue.severity})
    db.commit()
    db.refresh(task)
    return task


@router.get("/admin/summary", response_model=AdminSummaryOut)
def admin_summary(owner: OwnerUser, db: Session = Depends(get_db)) -> AdminSummaryOut:
    del owner
    usage = db.scalar(select(func.coalesce(func.sum(UsageCounter.leads), 0))) or 0
    ai = db.scalar(select(func.coalesce(func.sum(UsageCounter.ai_generations), 0))) or 0
    sends = db.scalar(select(func.coalesce(func.sum(UsageCounter.email_sends), 0))) or 0
    revenue = db.scalar(select(func.coalesce(func.sum(Lead.revenue), 0)).where(Lead.status == LeadStatus.won)) or 0
    return AdminSummaryOut(
        users=db.scalar(select(func.count()).select_from(User)) or 0,
        workspaces=db.scalar(select(func.count()).select_from(Workspace)) or 0,
        subscriptions=db.scalar(select(func.count()).select_from(Subscription)) or 0,
        revenue=float(revenue),
        usage={"leads": int(usage), "ai_generations": int(ai), "email_sends": int(sends)},
        system_health={"api": "ok", "database": "ok", "webhooks": "ok"},
    )


@router.get("/admin/logs", response_model=list[ActivityOut])
def admin_logs(owner: OwnerUser, db: Session = Depends(get_db)) -> list[AuditLog]:
    del owner
    return list(db.scalars(select(AuditLog).order_by(AuditLog.created_at.desc()).limit(100)).all())


@router.get("/backups/status")
def backup_status(owner: OwnerUser, db: Session = Depends(get_db)) -> dict:
    del owner
    summary = backup_summary(db, get_app_settings())
    latest = db.scalar(select(BackupRun).order_by(BackupRun.started_at.desc()).limit(1))
    return {
        "backups_enabled": summary.backups_enabled,
        "provider": summary.provider,
        "last_backup_time": summary.last_backup_time.isoformat() if summary.last_backup_time else None,
        "last_backup_status": summary.last_backup_status,
        "next_backup_time": summary.next_backup_time.isoformat() if summary.next_backup_time else None,
        "restore_verified": summary.restore_verified,
        "message": summary.message,
        "latest_backup": {
            "id": str(latest.id),
            "status": latest.status,
            "size_bytes": latest.size_bytes,
            "restore_verified": latest.restore_verified,
            "started_at": latest.started_at.isoformat(),
            "completed_at": latest.completed_at.isoformat() if latest.completed_at else None,
            "error_message": latest.error_message,
        } if latest else None,
    }


@router.post("/backups/run")
def backup_run(request: Request, owner: OwnerUser, db: Session = Depends(get_db)) -> dict:
    run = run_database_backup(db, triggered_by=owner.email, settings=get_app_settings())
    log_event(db, request, owner.user_id, "backups.manual_run", {"backup_id": str(run.id), "status": run.status})
    return {
        "id": str(run.id),
        "status": run.status,
        "provider": run.provider,
        "started_at": run.started_at.isoformat(),
        "completed_at": run.completed_at.isoformat() if run.completed_at else None,
        "restore_verified": run.restore_verified,
        "error_message": run.error_message,
    }
