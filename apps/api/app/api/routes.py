from __future__ import annotations

from datetime import datetime
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import asc, desc, func, or_, select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import CurrentUser
from app.models.entities import (
    AppSettings,
    AuditLog,
    Campaign,
    CampaignStatus,
    EmailMessage,
    Lead,
    LeadStatus,
    Notification,
    NotificationKind,
    WorkspaceProfile,
)
from app.schemas.dto import (
    ActivityOut,
    AnalysisOut,
    AnalyzeRequest,
    BulkLeadAction,
    CampaignCreate,
    CampaignOut,
    CampaignUpdate,
    CheckoutRequest,
    DashboardMetrics,
    EmailOut,
    EmailUpdate,
    EmailVariantOut,
    GenerateEmailRequest,
    LeadCreate,
    LeadFinderRequest,
    LeadOut,
    LeadUpdate,
    NotificationOut,
    PaginatedLeads,
    PersonalizeRequest,
    ProfileOut,
    ProfileUpdate,
    SettingsOut,
    SettingsUpdate,
)
from app.services.ai import analyze_website, personalize_email
from app.services.audit import log_event
from app.services.billing import create_checkout_session
from app.services.lead_finder import find_leads

router = APIRouter()


def _status(value: str) -> LeadStatus:
    for item in LeadStatus:
        if item.value == value:
            return item
    raise HTTPException(status_code=400, detail="Unsupported pipeline status")


def _campaign_out(db: Session, campaign: Campaign) -> CampaignOut:
    lead_count = db.scalar(select(func.count()).select_from(Lead).where(Lead.campaign_id == campaign.id)) or 0
    sent = db.scalar(select(func.count()).select_from(EmailMessage).where(EmailMessage.campaign_id == campaign.id, EmailMessage.sent_at.is_not(None))) or 0
    replies = db.scalar(select(func.count()).select_from(Lead).where(Lead.campaign_id == campaign.id, Lead.status == LeadStatus.replied)) or 0
    return CampaignOut.model_validate(campaign, from_attributes=True).model_copy(update={"leads": lead_count, "sent": sent, "replies": replies})


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
        status=lead.status.value,
        campaign_id=lead.campaign_id,
        campaign=lead.campaign.name if lead.campaign else None,
        created_at=lead.created_at,
    )


def _notify(db: Session, user_id: str, kind: NotificationKind, title: str, message: str) -> None:
    db.add(Notification(user_id=user_id, kind=kind, title=title, message=message))


def _default_settings() -> dict:
    return {
        "general": {"workspaceMode": "team", "dateFormat": "YYYY-MM-DD"},
        "ai": {"model": "gpt-4o-mini", "temperature": 0.7, "personalization": "high"},
        "email": {"provider": "Resend", "dailyLimit": 250, "tracking": True},
        "billing": {"plan": "Starter", "renewal": "monthly"},
        "security": {"mfaRequired": False, "sessionTimeout": "30d"},
        "api": {"enabled": False, "webhooks": []},
    }


@router.get("/health")
def health() -> dict:
    return {"status": "ok"}


@router.get("/dashboard", response_model=DashboardMetrics)
def dashboard(user_id: CurrentUser, db: Session = Depends(get_db)) -> DashboardMetrics:
    leads = db.scalar(select(func.count()).select_from(Lead).where(Lead.user_id == user_id)) or 0
    campaigns = db.scalar(select(func.count()).select_from(Campaign).where(Campaign.user_id == user_id)) or 0
    outbound = db.scalar(select(func.count()).select_from(EmailMessage).where(EmailMessage.user_id == user_id, EmailMessage.direction == "outbound")) or 0
    sent = db.scalar(select(func.count()).select_from(EmailMessage).where(EmailMessage.user_id == user_id, EmailMessage.sent_at.is_not(None))) or 0
    opened = db.scalar(select(func.count()).select_from(EmailMessage).where(EmailMessage.user_id == user_id, EmailMessage.opened_at.is_not(None))) or 0
    replied = db.scalar(select(func.count()).select_from(Lead).where(Lead.user_id == user_id, Lead.status == LeadStatus.replied)) or 0
    meetings = db.scalar(select(func.count()).select_from(Lead).where(Lead.user_id == user_id, Lead.status == LeadStatus.meeting)) or 0
    revenue = float(db.scalar(select(func.coalesce(func.sum(Lead.revenue), 0)).where(Lead.user_id == user_id, Lead.status == LeadStatus.won)) or 0)
    return DashboardMetrics(
        leads=leads,
        campaigns=campaigns,
        emails_sent=sent or outbound,
        open_rate=0 if outbound == 0 else round(opened / outbound * 100, 1),
        reply_rate=0 if outbound == 0 else round(replied / outbound * 100, 1),
        meetings=meetings,
        revenue=revenue,
        mrr=round(revenue / 12, 2) if revenue else 0,
    )


@router.post("/campaigns", response_model=CampaignOut)
def create_campaign(payload: CampaignCreate, request: Request, user_id: CurrentUser, db: Session = Depends(get_db)) -> CampaignOut:
    campaign = Campaign(user_id=user_id, **payload.model_dump(), status=CampaignStatus.scheduled if payload.schedule_at else CampaignStatus.draft)
    db.add(campaign)
    db.flush()
    log_event(db, request, user_id, "campaign.created", {"campaign_id": str(campaign.id), "name": campaign.name})
    _notify(db, user_id, NotificationKind.success, "Campaign created", f"{campaign.name} is ready for leads and email generation.")
    db.commit()
    db.refresh(campaign)
    return _campaign_out(db, campaign)


@router.get("/campaigns", response_model=list[CampaignOut])
def list_campaigns(user_id: CurrentUser, db: Session = Depends(get_db)) -> list[CampaignOut]:
    campaigns = db.scalars(select(Campaign).where(Campaign.user_id == user_id).order_by(Campaign.created_at.desc())).all()
    return [_campaign_out(db, campaign) for campaign in campaigns]


@router.put("/campaigns/{campaign_id}", response_model=CampaignOut)
def update_campaign(campaign_id: UUID, payload: CampaignUpdate, request: Request, user_id: CurrentUser, db: Session = Depends(get_db)) -> CampaignOut:
    campaign = db.scalar(select(Campaign).where(Campaign.id == campaign_id, Campaign.user_id == user_id))
    if campaign is None:
        raise HTTPException(status_code=404, detail="Campaign not found")
    for key, value in payload.model_dump(exclude_unset=True).items():
        if key == "status" and value:
            value = CampaignStatus(value)
        setattr(campaign, key, value)
    log_event(db, request, user_id, "campaign.updated", {"campaign_id": str(campaign.id)})
    db.commit()
    db.refresh(campaign)
    return _campaign_out(db, campaign)


@router.post("/campaigns/{campaign_id}/{action}", response_model=CampaignOut)
def campaign_action(campaign_id: UUID, action: str, request: Request, user_id: CurrentUser, db: Session = Depends(get_db)) -> CampaignOut:
    campaign = db.scalar(select(Campaign).where(Campaign.id == campaign_id, Campaign.user_id == user_id))
    if campaign is None:
        raise HTTPException(status_code=404, detail="Campaign not found")
    mapping = {"launch": CampaignStatus.running, "pause": CampaignStatus.paused, "stop": CampaignStatus.stopped}
    if action not in mapping:
        raise HTTPException(status_code=400, detail="Unsupported campaign action")
    campaign.status = mapping[action]
    log_event(db, request, user_id, f"campaign.{action}", {"campaign_id": str(campaign.id)})
    _notify(db, user_id, NotificationKind.info, "Campaign updated", f"{campaign.name} is now {campaign.status.value}.")
    db.commit()
    db.refresh(campaign)
    return _campaign_out(db, campaign)


@router.post("/leads", response_model=LeadOut)
def create_lead(payload: LeadCreate, request: Request, user_id: CurrentUser, db: Session = Depends(get_db)) -> LeadOut:
    lead = Lead(user_id=user_id, **payload.model_dump(exclude={"status"}), status=_status(payload.status), niche=payload.industry)
    db.add(lead)
    log_event(db, request, user_id, "lead.imported", {"company": lead.company})
    _notify(db, user_id, NotificationKind.success, "Lead imported", f"{lead.company} was added to your pipeline.")
    db.commit()
    db.refresh(lead)
    return _lead_out(lead)


@router.post("/leads/find", response_model=list[LeadOut])
def leads_find(payload: LeadFinderRequest, request: Request, user_id: CurrentUser, db: Session = Depends(get_db)) -> list[LeadOut]:
    found = find_leads(payload)
    saved: list[Lead] = []
    for item in found:
        exists = db.scalar(select(Lead.id).where(Lead.user_id == user_id, Lead.email == str(item.email))) if item.email else None
        if exists:
            continue
        lead = Lead(user_id=user_id, company=item.company, website=item.website, email=str(item.email) if item.email else None, phone=item.phone, linkedin=item.linkedin, industry=item.niche, niche=item.niche, country=item.country, city=item.city)
        db.add(lead)
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
    stmt = select(Lead).where(Lead.user_id == user_id)
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
    lead = db.scalar(select(Lead).where(Lead.id == lead_id, Lead.user_id == user_id))
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


@router.post("/leads/bulk")
def leads_bulk(payload: BulkLeadAction, request: Request, user_id: CurrentUser, db: Session = Depends(get_db)) -> dict:
    leads = db.scalars(select(Lead).where(Lead.user_id == user_id, Lead.id.in_(payload.ids))).all()
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
    result = analyze_website(payload.company, str(payload.website), payload.niche)
    log_event(db, request, user_id, "website.analyzed", {"company": payload.company, "website": str(payload.website)})
    db.commit()
    return result


@router.post("/ai/personalize", response_model=EmailVariantOut)
def ai_personalize(payload: PersonalizeRequest, request: Request, user_id: CurrentUser, db: Session = Depends(get_db)) -> EmailVariantOut:
    result = personalize_email(payload)
    log_event(db, request, user_id, "email.generated", {"company": payload.company})
    db.commit()
    return result


@router.post("/emails/generate", response_model=EmailOut)
def generate_email(payload: GenerateEmailRequest, request: Request, user_id: CurrentUser, db: Session = Depends(get_db)) -> EmailMessage:
    campaign = db.scalar(select(Campaign).where(Campaign.id == payload.campaign_id, Campaign.user_id == user_id))
    lead = db.scalar(select(Lead).where(Lead.id == payload.lead_id, Lead.user_id == user_id))
    if campaign is None or lead is None:
        raise HTTPException(status_code=404, detail="Campaign or lead not found")
    ai_payload = PersonalizeRequest(company=lead.company, niche=lead.industry or campaign.industry or "B2B", website_summary=f"{lead.website or lead.company} in {lead.country or 'target market'}", offer=campaign.offer or "a measurable outbound growth system")
    generated = personalize_email(ai_payload)
    message = EmailMessage(user_id=user_id, campaign_id=campaign.id, lead_id=lead.id, subject=generated.subject, preview=generated.preview, body=generated.full_email, cta=generated.cta, direction="outbound")
    lead.status = LeadStatus.email_generated
    db.add(message)
    log_event(db, request, user_id, "email.generated", {"campaign_id": str(campaign.id), "lead_id": str(lead.id)})
    _notify(db, user_id, NotificationKind.success, "Email generated", f"A personalized email for {lead.company} is ready to edit.")
    db.commit()
    db.refresh(message)
    return message


@router.patch("/emails/{email_id}", response_model=EmailOut)
def update_email(email_id: UUID, payload: EmailUpdate, request: Request, user_id: CurrentUser, db: Session = Depends(get_db)) -> EmailMessage:
    message = db.scalar(select(EmailMessage).where(EmailMessage.id == email_id, EmailMessage.user_id == user_id))
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
    message = db.scalar(select(EmailMessage).where(EmailMessage.id == email_id, EmailMessage.user_id == user_id))
    if message is None:
        raise HTTPException(status_code=404, detail="Email not found")
    message.sent_at = datetime.utcnow()
    lead = db.get(Lead, message.lead_id) if message.lead_id else None
    if lead:
        lead.status = LeadStatus.sent
    log_event(db, request, user_id, "email.sent", {"email_id": str(message.id)})
    _notify(db, user_id, NotificationKind.info, "Email marked sent", message.subject)
    db.commit()
    db.refresh(message)
    return message


@router.get("/inbox")
def inbox(user_id: CurrentUser, db: Session = Depends(get_db)) -> list[dict]:
    messages = db.scalars(select(EmailMessage).where(EmailMessage.user_id == user_id, EmailMessage.direction == "inbound").order_by(EmailMessage.created_at.desc())).all()
    return [{"id": str(message.id), "subject": message.subject, "body": message.body, "tags": message.tags, "created_at": message.created_at.isoformat()} for message in messages]


@router.get("/activity", response_model=list[ActivityOut])
def activity(user_id: CurrentUser, db: Session = Depends(get_db)) -> list[AuditLog]:
    return list(db.scalars(select(AuditLog).where(AuditLog.user_id == user_id).order_by(AuditLog.created_at.desc()).limit(50)).all())


@router.get("/notifications", response_model=list[NotificationOut])
def notifications(user_id: CurrentUser, db: Session = Depends(get_db)) -> list[Notification]:
    return list(db.scalars(select(Notification).where(Notification.user_id == user_id).order_by(Notification.created_at.desc()).limit(30)).all())


@router.get("/profile", response_model=ProfileOut)
def get_profile(user_id: CurrentUser, db: Session = Depends(get_db)) -> WorkspaceProfile:
    profile = db.scalar(select(WorkspaceProfile).where(WorkspaceProfile.user_id == user_id))
    if profile is None:
        profile = WorkspaceProfile(user_id=user_id)
        db.add(profile)
        db.commit()
        db.refresh(profile)
    return profile


@router.put("/profile", response_model=ProfileOut)
def update_profile(payload: ProfileUpdate, request: Request, user_id: CurrentUser, db: Session = Depends(get_db)) -> WorkspaceProfile:
    profile = db.scalar(select(WorkspaceProfile).where(WorkspaceProfile.user_id == user_id)) or WorkspaceProfile(user_id=user_id)
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
    settings = db.scalar(select(AppSettings).where(AppSettings.user_id == user_id))
    if settings is None:
        settings = AppSettings(user_id=user_id, **_default_settings())
        db.add(settings)
        db.commit()
        db.refresh(settings)
    return settings


@router.put("/settings", response_model=SettingsOut)
def update_settings(payload: SettingsUpdate, request: Request, user_id: CurrentUser, db: Session = Depends(get_db)) -> AppSettings:
    settings = db.scalar(select(AppSettings).where(AppSettings.user_id == user_id)) or AppSettings(user_id=user_id)
    for key, value in payload.model_dump().items():
        setattr(settings, key, value)
    db.add(settings)
    log_event(db, request, user_id, "settings.updated", {})
    db.commit()
    db.refresh(settings)
    return settings


@router.post("/billing/checkout")
def billing_checkout(payload: CheckoutRequest, request: Request, user_id: CurrentUser, db: Session = Depends(get_db)) -> dict:
    session = create_checkout_session(user_id, payload.plan, str(payload.success_url), str(payload.cancel_url))
    log_event(db, request, user_id, "billing.checkout", {"plan": payload.plan})
    db.commit()
    return session
