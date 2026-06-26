from __future__ import annotations

from datetime import datetime
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import asc, desc, func, or_, select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.config import get_settings as get_app_settings
from app.core.security import CurrentUser
from app.models.entities import (
    AppSettings,
    AuditLog,
    Campaign,
    CampaignSequence,
    CampaignStatus,
    EmailMessage,
    Lead,
    LeadStatus,
    Notification,
    NotificationKind,
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
    AdminSummaryOut,
    AnalysisOut,
    AnalyzeRequest,
    AutomationRunOut,
    BulkLeadAction,
    BillingPlanOut,
    BillingPortalRequest,
    CampaignCreate,
    CampaignAnalyticsOut,
    CampaignOut,
    CampaignSequenceIn,
    CampaignUpdate,
    CheckoutRequest,
    DashboardMetrics,
    EmailOut,
    EmailUpdate,
    EmailVariantOut,
    FollowUpSequenceOut,
    GenerateEmailRequest,
    IntegrationStatusOut,
    LeadCreate,
    LeadFinderRequest,
    LeadOut,
    LeadUpdate,
    MeetingPrepOut,
    MemberInvite,
    NotificationOut,
    OnboardingUpdate,
    PaginatedLeads,
    PersonalizeRequest,
    PLAN_LIMITS,
    ProfileOut,
    ProfileUpdate,
    ReplyAssistantOut,
    ReplyAssistantRequest,
    RewriteEmailRequest,
    SalesCopilotOut,
    SettingsOut,
    SettingsUpdate,
    UsageOut,
    WebsiteAuditOut,
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
    rewrite_email,
    sales_copilot,
    stream_email_generation,
    suggest_reply,
    website_audit,
)
from app.services.audit import log_event
from app.services.billing import create_billing_portal_session, create_checkout_session, ensure_subscription_catalog, list_invoices
from app.services.emailer import EmailProviderConfigurationError, EmailProviderRequestError, send_email
from app.services.lead_finder import LeadSourceConfigurationError, LeadSourceRequestError, find_leads
from app.services.website import WebsiteFetchError, collect_website

router = APIRouter()


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


def _current_workspace(db: Session, user_id: str) -> Workspace:
    member = db.scalar(select(WorkspaceMember).where(WorkspaceMember.user_id == user_id, WorkspaceMember.status == "active").order_by(WorkspaceMember.created_at.asc()))
    if member:
        return db.get(Workspace, member.workspace_id)
    workspace = db.scalar(select(Workspace).where(Workspace.owner_user_id == user_id).order_by(Workspace.created_at.asc()))
    if workspace is None:
        workspace = Workspace(owner_user_id=user_id)
        db.add(workspace)
        db.flush()
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=user_id, role=WorkspaceRole.owner, status="active"))
    db.commit()
    db.refresh(workspace)
    return workspace


def _workspace_members(db: Session, workspace_id: UUID) -> list[WorkspaceMember]:
    return list(db.scalars(select(WorkspaceMember).where(WorkspaceMember.workspace_id == workspace_id).order_by(WorkspaceMember.created_at.asc())).all())


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
    return or_(model.workspace_id == workspace.id, (model.workspace_id.is_(None) & (model.user_id == user_id)))


def _settings_for_workspace(db: Session, user_id: str, workspace: Workspace) -> AppSettings:
    settings = db.scalar(select(AppSettings).where(AppSettings.workspace_id == workspace.id))
    if settings is None:
        settings = db.scalar(select(AppSettings).where(AppSettings.user_id == user_id, AppSettings.workspace_id.is_(None)))
    if settings is None:
        settings = AppSettings(user_id=user_id, workspace_id=workspace.id, **_default_settings())
        db.add(settings)
        db.commit()
        db.refresh(settings)
    elif settings.workspace_id is None:
        settings.workspace_id = workspace.id
        db.add(settings)
        db.commit()
    return settings


def _plan_for_workspace(db: Session, user_id: str, workspace: Workspace) -> str:
    settings = _settings_for_workspace(db, user_id, workspace)
    plan = str((settings.billing or {}).get("plan") or "Starter")
    return plan if plan in PLAN_LIMITS else "Starter"


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
    if current + amount > int(limits[metric]):
        raise HTTPException(status_code=402, detail=f"{metric} limit reached for the {plan} plan")
    setattr(usage, metric, current + amount)
    db.add(usage)
    return usage


def _team_limit(db: Session, user_id: str, workspace: Workspace) -> int:
    return int(PLAN_LIMITS[_plan_for_workspace(db, user_id, workspace)]["team_members"])


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
        campaign=lead.campaign.name if lead.campaign else None,
        notes=lead.notes,
        revenue=float(lead.revenue or 0),
        created_at=lead.created_at,
    )


def _notify(db: Session, user_id: str, kind: NotificationKind, title: str, message: str) -> None:
    db.add(Notification(user_id=user_id, kind=kind, title=title, message=message))


def _provider_error(exc: Exception) -> HTTPException:
    if isinstance(exc, (ProviderConfigurationError, EmailProviderConfigurationError, LeadSourceConfigurationError)):
        return HTTPException(status_code=503, detail=str(exc))
    if isinstance(exc, (ProviderRequestError, EmailProviderRequestError, WebsiteFetchError, LeadSourceRequestError)):
        return HTTPException(status_code=502, detail=str(exc))
    return HTTPException(status_code=500, detail="Provider request failed.")


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
    return max(0, min(100, score))


def _analysis_summary_with_score(analysis: AnalysisOut, score: int) -> str:
    return f"ICP score: {score}/100. {analysis.summary}".strip()


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


def _lead_ai_payload(lead: Lead, analysis: WebsiteAnalysis | None, campaign: Campaign | None, messages: list[EmailMessage]) -> dict:
    return {
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
        },
        "website_analysis": {
            "summary": analysis.summary if analysis else "",
            "services": analysis.services if analysis else [],
            "technologies": analysis.technologies if analysis else [],
            "strengths": analysis.strengths if analysis else [],
            "weaknesses": analysis.weaknesses if analysis else [],
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


def _analyze_lead_if_possible(db: Session, user_id: str, workspace: Workspace, lead: Lead) -> None:
    if not lead.website:
        return
    try:
        snapshot = collect_website(lead.website)
        result = analyze_company_website(
            company=lead.company,
            website=snapshot.url,
            niche=lead.industry or lead.niche,
            page_title=snapshot.title,
            meta_description=snapshot.meta_description,
            page_text=snapshot.text,
            technologies=snapshot.technologies,
        )
    except Exception as exc:
        lead.notes = "\n".join(part for part in [lead.notes or "", f"Website analysis pending: {exc}"] if part)
        return
    score = _icp_score(result, lead)
    analysis = WebsiteAnalysis(
        user_id=user_id,
        workspace_id=workspace.id,
        lead_id=lead.id,
        company=result.company or lead.company,
        website=result.website or lead.website,
        description=result.description,
        industry=result.industry,
        location=result.location,
        niche=result.niche,
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
    audit = _website_audit_markers(snapshot.text, snapshot.technologies)
    audit_notes = ", ".join(audit["priority_actions"]) or "No critical website audit issues detected"
    lead.notes = "\n".join(part for part in [lead.notes or "", f"ICP score: {score}/100", f"Website audit: {audit_notes}", result.summary] if part)


def _default_settings() -> dict:
    return {
        "general": {"workspaceMode": "team", "dateFormat": "YYYY-MM-DD"},
        "ai": {"model": "gpt-5.5", "temperature": 0.4, "personalization": "high"},
        "email": {"provider": "Resend", "dailyLimit": 250, "tracking": True},
        "billing": {"plan": "Starter", "renewal": "monthly"},
        "security": {"mfaRequired": False, "sessionTimeout": "30d"},
        "api": {"enabled": False, "webhooks": []},
    }


@router.get("/health")
def health() -> dict:
    return {"status": "ok"}


@router.get("/integrations/status", response_model=IntegrationStatusOut)
def integrations_status(user_id: CurrentUser) -> IntegrationStatusOut:
    del user_id
    settings = get_app_settings()
    return IntegrationStatusOut(
        apollo=bool(settings.apollo_api_key),
        clay=bool(settings.clay_api_key),
        openai=bool(settings.openai_api_key),
        resend=bool(settings.resend_api_key and settings.resend_from_email),
        crm_sync=bool(settings.crm_sync_webhook_url),
        automation_secret=bool(settings.automation_secret),
    )


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


@router.get("/dashboard", response_model=DashboardMetrics)
def dashboard(user_id: CurrentUser, db: Session = Depends(get_db)) -> DashboardMetrics:
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


@router.post("/campaigns", response_model=CampaignOut)
def create_campaign(payload: CampaignCreate, request: Request, user_id: CurrentUser, db: Session = Depends(get_db)) -> CampaignOut:
    workspace = _current_workspace(db, user_id)
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
    return [_campaign_out(db, campaign) for campaign in campaigns]


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
    lead = Lead(user_id=user_id, workspace_id=workspace.id, **payload.model_dump(exclude={"status"}), status=_status(payload.status), niche=payload.industry)
    db.add(lead)
    db.flush()
    _analyze_lead_if_possible(db, user_id, workspace, lead)
    log_event(db, request, user_id, "lead.imported", {"company": lead.company})
    _notify(db, user_id, NotificationKind.success, "Lead imported", f"{lead.company} was added to your pipeline.")
    db.commit()
    db.refresh(lead)
    return _lead_out(lead)


@router.post("/leads/find", response_model=list[LeadOut])
def leads_find(payload: LeadFinderRequest, request: Request, user_id: CurrentUser, db: Session = Depends(get_db)) -> list[LeadOut]:
    try:
        found = find_leads(payload)
    except Exception as exc:
        raise _provider_error(exc) from exc
    workspace = _current_workspace(db, user_id)
    saved: list[Lead] = []
    for item in found:
        exists = db.scalar(select(Lead.id).where(_workspace_stmt(Lead, workspace, user_id), Lead.email == str(item.email))) if item.email else None
        if exists:
            continue
        _enforce_usage(db, user_id, workspace, "leads")
        lead = Lead(
            user_id=user_id,
            workspace_id=workspace.id,
            company=item.company,
            website=item.website,
            email=str(item.email) if item.email else None,
            phone=item.phone,
            linkedin=item.linkedin,
            industry=item.industry or item.niche,
            niche=item.niche,
            country=item.country,
            city=item.city,
            notes=item.notes,
            revenue=item.revenue,
        )
        db.add(lead)
        db.flush()
        _analyze_lead_if_possible(db, user_id, workspace, lead)
        saved.append(lead)
    log_event(db, request, user_id, "lead.imported", {"count": len(saved), **payload.model_dump()})
    _notify(db, user_id, NotificationKind.success, "Leads imported", f"{len(saved)} leads were added to your workspace.")
    db.commit()
    return [_lead_out(lead) for lead in saved]


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
        result = sales_copilot(_lead_ai_payload(lead, analysis, campaign, messages))
    except Exception as exc:
        raise _provider_error(exc) from exc
    if not lead.revenue:
        lead.revenue = result.estimated_revenue
    lead.notes = "\n".join(part for part in [lead.notes or "", f"Sales copilot: {result.probability_to_reply}% reply, {result.probability_to_buy}% buy. {result.best_cta}"] if part)
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
        result = website_audit({**_lead_ai_payload(lead, analysis, campaign, messages), "website_text": snapshot.text[:10000], "detected_issues": heuristic})
    except Exception as exc:
        raise _provider_error(exc) from exc
    db.add(
        WebsiteAnalysis(
            user_id=user_id,
            workspace_id=workspace.id,
            lead_id=lead.id,
            company=lead.company,
            website=lead.website or "",
            description="AI website audit",
            industry=lead.industry,
            location=" ".join(part for part in [lead.city, lead.country] if part),
            niche=lead.niche,
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
        result = meeting_preparation(_lead_ai_payload(lead, analysis, campaign, messages))
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
        result = adaptive_follow_ups(_lead_ai_payload(lead, analysis, campaign, messages))
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
    _enforce_usage(db, user_id, workspace, "ai_generations")
    lead = db.scalar(select(Lead).where(Lead.id == payload.lead_id, _workspace_stmt(Lead, workspace, user_id))) if payload.lead_id else None
    company = payload.company or (lead.company if lead else "")
    try:
        snapshot = collect_website(str(payload.website))
        result = analyze_company_website(
            company=company,
            website=snapshot.url,
            niche=payload.niche or (lead.industry if lead else None),
            page_title=snapshot.title,
            meta_description=snapshot.meta_description,
            page_text=snapshot.text,
            technologies=snapshot.technologies,
        )
    except Exception as exc:
        raise _provider_error(exc) from exc
    analysis = WebsiteAnalysis(
        user_id=user_id,
        workspace_id=workspace.id,
        lead_id=lead.id if lead else None,
        company=result.company,
        website=result.website,
        description=result.description,
        industry=result.industry,
        location=result.location,
        niche=result.niche,
        products_services=result.products_services,
        services=result.services,
        technologies=result.technologies,
        strengths=result.strengths,
        weaknesses=result.weaknesses,
        summary=_analysis_summary_with_score(result, result.icp_score),
    )
    db.add(analysis)
    if lead:
        lead.industry = lead.industry or result.industry
        lead.niche = lead.niche or result.niche
    log_event(db, request, user_id, "website.analyzed", {"company": result.company, "website": result.website})
    db.commit()
    return result


@router.post("/ai/personalize", response_model=EmailVariantOut)
def ai_personalize(payload: PersonalizeRequest, request: Request, user_id: CurrentUser, db: Session = Depends(get_db)) -> EmailVariantOut:
    workspace = _current_workspace(db, user_id)
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
    _enforce_usage(db, user_id, workspace, "ai_generations")
    try:
        result = suggest_reply(payload)
    except Exception as exc:
        raise _provider_error(exc) from exc
    log_event(db, request, user_id, "reply.assistant_generated", {"company": payload.company, "score": result.qualification_score})
    db.commit()
    return result


@router.post("/emails/generate", response_model=EmailOut)
def generate_email(payload: GenerateEmailRequest, request: Request, user_id: CurrentUser, db: Session = Depends(get_db)) -> EmailMessage:
    workspace = _current_workspace(db, user_id)
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
    ai_payload = PersonalizeRequest(
        company=lead.company,
        niche=lead.industry or campaign.industry or "B2B",
        website_summary=website_summary or lead.company,
        offer=campaign.offer or "a measurable outbound growth system",
        cta=campaign.cta,
        tone=campaign.email_tone,
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
    db.add(message)
    log_event(db, request, user_id, "email.generated", {"campaign_id": str(campaign.id), "lead_id": str(lead.id)})
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


@router.post("/emails/{email_id}/send", response_model=EmailOut)
def mark_email_sent(email_id: UUID, request: Request, user_id: CurrentUser, db: Session = Depends(get_db)) -> EmailMessage:
    workspace = _current_workspace(db, user_id)
    _enforce_usage(db, user_id, workspace, "email_sends")
    message = db.scalar(select(EmailMessage).where(EmailMessage.id == email_id, _workspace_stmt(EmailMessage, workspace, user_id)))
    if message is None:
        raise HTTPException(status_code=404, detail="Email not found")
    lead = db.get(Lead, message.lead_id) if message.lead_id else None
    if lead is None or not lead.email:
        raise HTTPException(status_code=400, detail="Lead email is required before sending.")
    try:
        provider_response = send_email(to_email=lead.email, subject=message.subject, body=message.body)
    except Exception as exc:
        message.delivery_status = "failed"
        db.add(message)
        log_event(db, request, user_id, "email.send_failed", {"email_id": str(message.id), "reason": str(exc)})
        _notify(db, user_id, NotificationKind.error, "Email send failed", str(exc))
        db.commit()
        raise _provider_error(exc) from exc
    message.sent_at = datetime.utcnow()
    message.provider_message_id = str(provider_response.get("id"))
    message.delivery_status = "sent"
    lead.status = LeadStatus.contacted
    log_event(db, request, user_id, "email.sent", {"email_id": str(message.id), "provider_message_id": message.provider_message_id})
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
def get_workspace(user_id: CurrentUser, db: Session = Depends(get_db)) -> WorkspaceOut:
    return _workspace_out(db, _current_workspace(db, user_id))


@router.put("/workspace", response_model=WorkspaceOut)
def update_workspace(payload: WorkspaceUpdate, request: Request, user_id: CurrentUser, db: Session = Depends(get_db)) -> WorkspaceOut:
    workspace = _current_workspace(db, user_id)
    for key, value in payload.model_dump().items():
        setattr(workspace, key, value)
    log_event(db, request, user_id, "workspace.updated", {"workspace_id": str(workspace.id)})
    db.commit()
    db.refresh(workspace)
    return _workspace_out(db, workspace)


@router.post("/workspace/members", response_model=WorkspaceMemberOut)
def invite_member(payload: MemberInvite, request: Request, user_id: CurrentUser, db: Session = Depends(get_db)) -> WorkspaceMember:
    workspace = _current_workspace(db, user_id)
    members = _workspace_members(db, workspace.id)
    if len(members) >= _team_limit(db, user_id, workspace):
        raise HTTPException(status_code=402, detail="Team member limit reached for the current plan")
    role = WorkspaceRole(payload.role) if payload.role in [item.value for item in WorkspaceRole] else WorkspaceRole.member
    member = WorkspaceMember(workspace_id=workspace.id, user_id=str(payload.email), email=str(payload.email), role=role, status="invited")
    db.add(member)
    log_event(db, request, user_id, "workspace.member_invited", {"email": str(payload.email), "role": role.value})
    db.commit()
    db.refresh(member)
    return member


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
    return list(db.scalars(select(AuditLog).where(or_(AuditLog.workspace_id == workspace.id, AuditLog.user_id == user_id)).order_by(AuditLog.created_at.desc()).limit(50)).all())


@router.get("/notifications", response_model=list[NotificationOut])
def notifications(user_id: CurrentUser, db: Session = Depends(get_db)) -> list[Notification]:
    workspace = _current_workspace(db, user_id)
    return list(db.scalars(select(Notification).where(or_(Notification.workspace_id == workspace.id, Notification.user_id == user_id)).order_by(Notification.created_at.desc()).limit(30)).all())


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
    db.add(profile)
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
    try:
        session = create_checkout_session(user_id, str(workspace.id), payload.plan, str(payload.success_url), str(payload.cancel_url))
    except ValueError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    settings = _settings_for_workspace(db, user_id, workspace)
    settings.billing = {**(settings.billing or {}), "plan": payload.plan, "checkoutSessionId": session.get("id")}
    log_event(db, request, user_id, "billing.checkout", {"plan": payload.plan})
    db.commit()
    return session


@router.get("/billing/plans", response_model=list[BillingPlanOut])
def billing_plans(user_id: CurrentUser, db: Session = Depends(get_db)) -> list[BillingPlanOut]:
    workspace = _current_workspace(db, user_id)
    current = _plan_for_workspace(db, user_id, workspace)
    return [BillingPlanOut(name=name, price=int(limits["mrr"]), limits=limits, current=name == current) for name, limits in PLAN_LIMITS.items()]


@router.post("/billing/portal")
def billing_portal(payload: BillingPortalRequest, request: Request, user_id: CurrentUser, db: Session = Depends(get_db)) -> dict:
    workspace = _current_workspace(db, user_id)
    settings = _settings_for_workspace(db, user_id, workspace)
    customer_id = str((settings.billing or {}).get("stripeCustomerId") or "")
    try:
        session = create_billing_portal_session(customer_id, str(payload.return_url))
    except ValueError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    log_event(db, request, user_id, "billing.portal", {"workspace_id": str(workspace.id)})
    db.commit()
    return session


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


@router.get("/admin/summary", response_model=AdminSummaryOut)
def admin_summary(user_id: CurrentUser, db: Session = Depends(get_db)) -> AdminSummaryOut:
    del user_id
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
def admin_logs(user_id: CurrentUser, db: Session = Depends(get_db)) -> list[AuditLog]:
    del user_id
    return list(db.scalars(select(AuditLog).order_by(AuditLog.created_at.desc()).limit(100)).all())
