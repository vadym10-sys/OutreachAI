from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import CurrentUser
from app.models.entities import Campaign, CampaignStatus, EmailMessage, Lead
from app.schemas.dto import (
    AnalysisOut,
    AnalyzeRequest,
    CampaignCreate,
    CampaignOut,
    CheckoutRequest,
    DashboardMetrics,
    EmailVariantOut,
    LeadFinderRequest,
    LeadOut,
    PersonalizeRequest
)
from app.services.ai import analyze_website, personalize_email
from app.services.audit import log_event
from app.services.billing import create_checkout_session
from app.services.lead_finder import find_leads

router = APIRouter()


@router.get("/health")
def health() -> dict:
    return {"status": "ok"}


@router.get("/dashboard", response_model=DashboardMetrics)
def dashboard(user_id: CurrentUser, db: Session = Depends(get_db)) -> DashboardMetrics:
    lead_count = db.scalar(select(func.count()).select_from(Lead).where(Lead.user_id == user_id)) or 0
    sent = db.scalar(select(func.count()).select_from(EmailMessage).where(EmailMessage.user_id == user_id, EmailMessage.direction == "outbound")) or 0
    replies = db.scalar(select(func.count()).select_from(EmailMessage).where(EmailMessage.user_id == user_id, EmailMessage.direction == "inbound")) or 0
    return DashboardMetrics(leads=lead_count, emails_sent=sent, open_rate=0.0 if sent == 0 else 58.4, replies=replies, conversions=0, roi=0)


@router.post("/leads/find", response_model=list[LeadOut])
def leads_find(payload: LeadFinderRequest, request: Request, user_id: CurrentUser, db: Session = Depends(get_db)) -> list[LeadOut]:
    leads = find_leads(payload)
    for item in leads:
        exists = db.scalar(select(Lead.id).where(Lead.user_id == user_id, Lead.email == str(item.email)))
        if exists:
            continue
        db.add(Lead(user_id=user_id, company=item.company, website=item.website, email=str(item.email) if item.email else None, phone=item.phone, linkedin=item.linkedin, niche=item.niche, country=item.country, city=item.city))
    db.commit()
    log_event(db, request, user_id, "leads.find", payload.model_dump())
    return leads


@router.get("/leads", response_model=list[LeadOut])
def leads_list(user_id: CurrentUser, db: Session = Depends(get_db)) -> list[Lead]:
    return list(db.scalars(select(Lead).where(Lead.user_id == user_id).order_by(Lead.created_at.desc())).all())


@router.post("/ai/analyze", response_model=AnalysisOut)
def ai_analyze(payload: AnalyzeRequest, request: Request, user_id: CurrentUser, db: Session = Depends(get_db)) -> AnalysisOut:
    result = analyze_website(payload.company, str(payload.website), payload.niche)
    log_event(db, request, user_id, "ai.analyze", {"company": payload.company, "website": str(payload.website)})
    return result


@router.post("/ai/personalize", response_model=EmailVariantOut)
def ai_personalize(payload: PersonalizeRequest, request: Request, user_id: CurrentUser, db: Session = Depends(get_db)) -> EmailVariantOut:
    result = personalize_email(payload)
    log_event(db, request, user_id, "ai.personalize", {"company": payload.company})
    return result


@router.post("/campaigns", response_model=CampaignOut)
def create_campaign(payload: CampaignCreate, request: Request, user_id: CurrentUser, db: Session = Depends(get_db)) -> Campaign:
    campaign = Campaign(user_id=user_id, name=payload.name, schedule_at=payload.schedule_at, follow_up_days=payload.follow_up_days, status=CampaignStatus.scheduled if payload.schedule_at else CampaignStatus.draft)
    db.add(campaign)
    db.commit()
    db.refresh(campaign)
    log_event(db, request, user_id, "campaign.create", {"campaign_id": str(campaign.id)})
    return campaign


@router.get("/campaigns", response_model=list[CampaignOut])
def list_campaigns(user_id: CurrentUser, db: Session = Depends(get_db)) -> list[Campaign]:
    return list(db.scalars(select(Campaign).where(Campaign.user_id == user_id).order_by(Campaign.created_at.desc())).all())


@router.post("/campaigns/{campaign_id}/{action}", response_model=CampaignOut)
def campaign_action(campaign_id: str, action: str, request: Request, user_id: CurrentUser, db: Session = Depends(get_db)) -> Campaign:
    campaign = db.scalar(select(Campaign).where(Campaign.id == campaign_id, Campaign.user_id == user_id))
    if campaign is None:
        raise HTTPException(status_code=404, detail="Campaign not found")
    mapping = {"launch": CampaignStatus.running, "pause": CampaignStatus.paused, "stop": CampaignStatus.stopped}
    if action not in mapping:
        raise HTTPException(status_code=400, detail="Unsupported campaign action")
    campaign.status = mapping[action]
    db.commit()
    db.refresh(campaign)
    log_event(db, request, user_id, f"campaign.{action}", {"campaign_id": campaign_id})
    return campaign


@router.get("/inbox")
def inbox(user_id: CurrentUser, db: Session = Depends(get_db)) -> list[dict]:
    messages = db.scalars(select(EmailMessage).where(EmailMessage.user_id == user_id, EmailMessage.direction == "inbound").order_by(EmailMessage.created_at.desc())).all()
    return [{"id": str(message.id), "subject": message.subject, "body": message.body, "tags": message.tags} for message in messages]


@router.post("/billing/checkout")
def billing_checkout(payload: CheckoutRequest, request: Request, user_id: CurrentUser, db: Session = Depends(get_db)) -> dict:
    session = create_checkout_session(user_id, payload.plan, str(payload.success_url), str(payload.cancel_url))
    log_event(db, request, user_id, "billing.checkout", {"plan": payload.plan})
    return session
