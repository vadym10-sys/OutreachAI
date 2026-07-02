from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Literal, Optional
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.api.routes import (
    LEAD_PROVIDER_TIMEOUT_SECONDS,
    LeadProviderTimeoutError,
    _add_lead_activity,
    _analyze_lead_if_possible,
    _crm_company_out,
    _current_workspace,
    _ensure_crm_backfilled,
    _existing_duplicate_lead,
    _hunter_enriched_leads,
    _lead_metadata,
    _lead_out,
    _lead_trace,
    _merge_lead_metadata,
    _run_provider_with_deadline,
    _save_provider_leads,
    _sync_lead_to_crm,
    _workspace_out,
    _enforce_usage,
)
from app.core.config import get_settings
from app.core.database import get_db
from app.core.observability import capture_provider_exception
from app.core.security import CurrentUserContext
from app.models.entities import AuditLog, Campaign, Company, Deal, EmailMessage, Lead, LeadStatus
from app.schemas.dto import CrmCompanyOut, EmailOut, LeadFinderRequest, LeadOut, PersonalizeRequest, WorkspaceOut
from app.services.ai import ProviderConfigurationError, ProviderRequestError, personalize_email
from app.services.emailer import EmailProviderConfigurationError, EmailProviderRequestError, send_email
from app.services.google_maps import GoogleMapsConfigurationError, GoogleMapsRequestError, search_google_places
from app.services.hunter import hunter_key_loaded
from app.services.website import normalize_website_url

logger = logging.getLogger("outreachai.workspace_app")
router = APIRouter()


UsageStatus = Literal["success", "partial_success", "empty", "provider_unavailable", "timeout", "error"]


class UsageCounts(BaseModel):
    leads: int = 0
    companies: int = 0
    campaigns: int = 0
    emails: int = 0
    deals: int = 0


class UsageActivityOut(BaseModel):
    action: str
    created_at: datetime
    company: str = ""
    message: str = ""


class UsageBootstrapOut(BaseModel):
    workspace: WorkspaceOut
    counts: UsageCounts
    next_action: str
    recent_companies: list[CrmCompanyOut] = Field(default_factory=list)
    recent_activity: list[UsageActivityOut] = Field(default_factory=list)


class UsageCompanyCreateIn(BaseModel):
    name: str = Field(min_length=1, max_length=220)
    website: Optional[str] = Field(default=None, max_length=500)
    country: Optional[str] = Field(default=None, max_length=120)
    city: Optional[str] = Field(default=None, max_length=120)
    industry: Optional[str] = Field(default=None, max_length=160)
    contact: Optional[str] = Field(default=None, max_length=220)
    phone: Optional[str] = Field(default=None, max_length=80)
    email: Optional[EmailStr] = None
    address: Optional[str] = Field(default=None, max_length=500)
    source: str = Field(default="manual", max_length=80)


class UsageCompanyCreateOut(BaseModel):
    status: Literal["created", "reused"]
    message: str
    company: CrmCompanyOut


class UsageLeadSearchOut(BaseModel):
    status: UsageStatus
    request_id: str
    message: str
    companies_saved: int = 0
    duplicates_skipped: int = 0
    companies: list[CrmCompanyOut] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class UsageActionOut(BaseModel):
    status: UsageStatus
    message: str
    company: Optional[CrmCompanyOut] = None
    email: Optional[EmailOut] = None


class UsageIntegrationStatus(BaseModel):
    key: str
    label: str
    status: Literal["connected", "missing_key", "needs_setup", "error"]
    message: str


class UsageIntegrationStatusOut(BaseModel):
    integrations: list[UsageIntegrationStatus]


def _workspace_counts(db: Session, workspace_id: UUID) -> UsageCounts:
    return UsageCounts(
        leads=db.scalar(select(func.count(Lead.id)).where(Lead.workspace_id == workspace_id)) or 0,
        companies=db.scalar(select(func.count(Company.id)).where(Company.workspace_id == workspace_id)) or 0,
        campaigns=db.scalar(select(func.count(Campaign.id)).where(Campaign.workspace_id == workspace_id)) or 0,
        emails=db.scalar(select(func.count(EmailMessage.id)).where(EmailMessage.workspace_id == workspace_id)) or 0,
        deals=db.scalar(select(func.count(Deal.id)).where(Deal.workspace_id == workspace_id)) or 0,
    )


def _next_action(counts: UsageCounts) -> str:
    if counts.companies == 0:
        return "Add your first company or run a lead search."
    if counts.emails == 0:
        return "Open a company and generate the first reviewed email."
    if counts.campaigns == 0:
        return "Create a campaign from approved leads."
    return "Review replies and move qualified leads through the pipeline."


def _activity_out(item: AuditLog) -> UsageActivityOut:
    metadata = item.metadata_json or {}
    company = str(metadata.get("company") or "")
    message = company or item.action.replace(".", " ")
    return UsageActivityOut(action=item.action, created_at=item.created_at, company=company, message=message)


def _safe_provider_warning(exc: Exception) -> str:
    if isinstance(exc, LeadProviderTimeoutError):
        return "Lead search took too long. Saved partial results where available."
    if isinstance(exc, GoogleMapsConfigurationError):
        return "Lead search is not configured yet. Add a company manually to continue."
    if isinstance(exc, GoogleMapsRequestError):
        return "Lead search is temporarily unavailable. Try again in a moment."
    if isinstance(exc, ProviderConfigurationError):
        return "AI is not configured yet. The company was saved and can be analyzed later."
    if isinstance(exc, ProviderRequestError):
        return "AI is temporarily unavailable. Try again in a moment."
    return "This step is temporarily unavailable. Try again in a moment."


def _integration_status(key: str, label: str, configured: bool, ready_message: str, missing_message: str) -> UsageIntegrationStatus:
    return UsageIntegrationStatus(
        key=key,
        label=label,
        status="connected" if configured else "missing_key",
        message=ready_message if configured else missing_message,
    )


def _scoped_company(db: Session, workspace_id: UUID, company_id: UUID) -> Company:
    company = db.scalar(select(Company).where(Company.id == company_id, Company.workspace_id == workspace_id))
    if company is None:
        raise HTTPException(status_code=404, detail="Company not found.")
    return company


def _domain_from_website(website: str | None) -> str:
    if not website:
        return ""
    try:
        normalized = normalize_website_url(website)
    except Exception:
        normalized = website
    return normalized.removeprefix("https://").removeprefix("http://").split("/")[0].lower().strip()


def _find_existing_company(db: Session, workspace_id: UUID, payload: UsageCompanyCreateIn) -> Company | None:
    clauses: list[Any] = []
    domain = _domain_from_website(payload.website)
    if domain:
        clauses.append(func.lower(Company.domain) == domain)
    if payload.website:
        clauses.append(func.lower(Company.website) == str(payload.website).lower())
    if payload.name and payload.city:
        clauses.append(
            func.lower(Company.name) == payload.name.lower(),
        )
    if not clauses:
        return None
    stmt = select(Company).where(Company.workspace_id == workspace_id, or_(*clauses)).order_by(Company.created_at.asc())
    candidates = list(db.scalars(stmt).all())
    if payload.name and payload.city:
        for item in candidates:
            if item.name.lower() == payload.name.lower() and (item.city or "").lower() == payload.city.lower():
                return item
    return candidates[0] if candidates else None


@router.get("/bootstrap", response_model=UsageBootstrapOut)
def bootstrap_workspace_app(user: CurrentUserContext, db: Session = Depends(get_db)) -> UsageBootstrapOut:
    workspace = _current_workspace(db, user.user_id, user.email)
    _ensure_crm_backfilled(db, user.user_id, workspace)
    counts = _workspace_counts(db, workspace.id)
    recent = list(
        db.scalars(
            select(Company)
            .where(Company.workspace_id == workspace.id)
            .order_by(Company.updated_at.desc())
            .limit(5)
        ).all()
    )
    activity = list(
        db.scalars(
            select(AuditLog)
            .where(AuditLog.workspace_id == workspace.id)
            .order_by(AuditLog.created_at.desc())
            .limit(8)
        ).all()
    )
    return UsageBootstrapOut(
        workspace=_workspace_out(db, workspace),
        counts=counts,
        next_action=_next_action(counts),
        recent_companies=[_crm_company_out(db, workspace, user.user_id, item) for item in recent],
        recent_activity=[_activity_out(item) for item in activity],
    )


@router.get("/integrations/status", response_model=UsageIntegrationStatusOut)
def integration_status(user: CurrentUserContext, db: Session = Depends(get_db)) -> UsageIntegrationStatusOut:
    workspace = _current_workspace(db, user.user_id, user.email)
    settings = get_settings()
    # Touching the workspace is intentional: it proves the status response is scoped to an authenticated private account.
    _workspace_counts(db, workspace.id)
    return UsageIntegrationStatusOut(
        integrations=[
            _integration_status(
                "lead_search",
                "Lead search",
                bool(settings.google_maps_api_key),
                "Connected. Lead Finder can search real companies.",
                "Needs setup. Add lead search credentials or add companies manually.",
            ),
            _integration_status(
                "contact_discovery",
                "Contact discovery",
                bool(settings.hunter_api_key),
                "Connected. Contact discovery can verify business emails.",
                "Needs setup. Add contact discovery credentials or add contacts manually.",
            ),
            _integration_status(
                "ai_research",
                "AI research and email",
                bool(settings.openai_api_key),
                "Connected. AI can analyze websites and draft outreach.",
                "Needs setup. Add AI credentials before generating research or emails.",
            ),
            _integration_status(
                "email_sending",
                "Email sending",
                bool(settings.resend_api_key and settings.resend_from_email),
                "Connected. Approved emails can be sent.",
                "Needs setup. Configure a verified sender before sending email.",
            ),
            _integration_status(
                "billing",
                "Billing",
                bool(settings.stripe_secret_key and settings.stripe_starter_price_id and settings.stripe_pro_price_id and settings.stripe_agency_price_id),
                "Connected. Plans and billing status can be managed.",
                "Needs setup. Billing keys or monthly price IDs are missing.",
            ),
        ]
    )


@router.post("/companies", response_model=UsageCompanyCreateOut)
def create_company(payload: UsageCompanyCreateIn, request: Request, user: CurrentUserContext, db: Session = Depends(get_db)) -> UsageCompanyCreateOut:
    workspace = _current_workspace(db, user.user_id, user.email)
    existing_company = _find_existing_company(db, workspace.id, payload)
    if existing_company:
        return UsageCompanyCreateOut(
            status="reused",
            message="This company already exists in your private workspace.",
            company=_crm_company_out(db, workspace, user.user_id, existing_company),
        )

    normalized_website = None
    if payload.website:
        try:
            normalized_website = normalize_website_url(payload.website)
        except Exception:
            normalized_website = payload.website
    metadata = {
        "source": payload.source or "manual",
        "domain": _domain_from_website(normalized_website),
        "saved_to_crm_at": datetime.utcnow().isoformat(),
        "found_at": datetime.utcnow().isoformat(),
        "address": payload.address or "",
    }
    lead_out = LeadOut(
        company=payload.name,
        website=normalized_website,
        industry=payload.industry,
        country=payload.country,
        city=payload.city,
        contact=payload.contact,
        email=payload.email,
        phone=payload.phone,
        notes="",
        source=payload.source or "manual",
        domain=metadata["domain"] or None,
    )
    existing_lead = _existing_duplicate_lead(db, workspace, user.user_id, lead_out)
    if existing_lead:
        company = _sync_lead_to_crm(db, user.user_id, workspace, existing_lead)
        db.commit()
        return UsageCompanyCreateOut(
            status="reused",
            message="This company already exists in your private workspace.",
            company=_crm_company_out(db, workspace, user.user_id, company),
        )

    lead = Lead(
        user_id=user.user_id,
        workspace_id=workspace.id,
        company=payload.name,
        website=normalized_website,
        contact=payload.contact,
        industry=payload.industry,
        country=payload.country,
        city=payload.city,
        email=str(payload.email) if payload.email else None,
        phone=payload.phone,
        notes=_merge_lead_metadata_for_create(metadata),
    )
    db.add(lead)
    db.flush()
    _add_lead_activity(db, request, user.user_id, workspace, "lead.saved_to_crm", lead, {"source": payload.source or "manual"})
    company = _sync_lead_to_crm(db, user.user_id, workspace, lead)
    if payload.address:
        company.address = payload.address
    db.commit()
    db.refresh(company)
    return UsageCompanyCreateOut(
        status="created",
        message="Company saved to your private workspace.",
        company=_crm_company_out(db, workspace, user.user_id, company),
    )


def _merge_lead_metadata_for_create(metadata: dict[str, Any]) -> str:
    clean = {key: value for key, value in metadata.items() if value is not None and value != ""}
    import json

    return json.dumps(clean, sort_keys=True)


@router.post("/leads/search", response_model=UsageLeadSearchOut)
def search_leads(payload: LeadFinderRequest, request: Request, user: CurrentUserContext, db: Session = Depends(get_db)) -> UsageLeadSearchOut:
    workspace = _current_workspace(db, user.user_id, user.email)
    request_id = request.headers.get("x-request-id") or str(uuid4())
    warnings: list[str] = []
    _lead_trace(request_id, "workspace_app_search_received", workspace_id=str(workspace.id), payload=payload.model_dump())
    try:
        _lead_trace(request_id, "google_places_started", timeout_seconds=LEAD_PROVIDER_TIMEOUT_SECONDS)
        result = _run_provider_with_deadline(request_id, "google_places", "google_places.search", search_google_places, payload)
        found = result.leads
        _lead_trace(request_id, "google_places_finished", raw_count=result.raw_count, parsed_count=len(found), duration_ms=result.duration_ms)
    except Exception as exc:
        logger.warning("Workspace app lead search provider failed request_id=%s reason=%s", request_id, exc)
        capture_provider_exception(exc, provider="google_maps", endpoint="workspace_app.leads.search", workspace_id=workspace.id, extra={"request_id": request_id})
        warnings.append(_safe_provider_warning(exc))
        return UsageLeadSearchOut(
            status="timeout" if isinstance(exc, LeadProviderTimeoutError) else "provider_unavailable",
            request_id=request_id,
            message="Lead search is temporarily unavailable. Add a company manually or try again later.",
            warnings=warnings,
        )

    if not found:
        return UsageLeadSearchOut(
            status="empty",
            request_id=request_id,
            message="No companies were found for these filters. Try a broader city, industry, or company size.",
        )

    try:
        _lead_trace(request_id, "hunter_started", leads=len(found))
        enriched = _hunter_enriched_leads(db, request, user.user_id, workspace, found)
        _lead_trace(request_id, "hunter_finished", leads=len(enriched), verified=sum(1 for item in enriched if item.hunter_verified))
    except Exception as exc:
        capture_provider_exception(exc, provider="hunter", endpoint="workspace_app.hunter.enrichment", workspace_id=workspace.id, extra={"request_id": request_id})
        warnings.append("Contacts could not be verified right now. Companies were saved without verified emails.")
        enriched = found

    saved = _save_provider_leads(
        db,
        request,
        user.user_id,
        workspace,
        enriched,
        payload,
        source="google_maps_hunter",
        action="workspace_app.lead_search",
        request_id=request_id,
        run_inline_analysis=False,
    )
    companies = [_crm_company_out(db, workspace, user.user_id, _sync_lead_to_crm(db, user.user_id, workspace, lead)) for lead in saved]
    db.commit()
    saved_count = sum(1 for lead in saved if lead.created_at == lead.updated_at)
    status: UsageStatus = "partial_success" if warnings else "success"
    return UsageLeadSearchOut(
        status=status,
        request_id=request_id,
        message=f"Found and saved {len(companies)} companies to your CRM.",
        companies_saved=len(companies),
        duplicates_skipped=max(0, len(enriched) - saved_count),
        companies=companies,
        warnings=warnings,
    )


@router.get("/companies", response_model=list[CrmCompanyOut])
def list_companies(
    user: CurrentUserContext,
    db: Session = Depends(get_db),
    search: str = "",
    city: str = "",
    country: str = "",
    industry: str = "",
    stage: str = "",
    email_status: str = "",
    source: str = "",
) -> list[CrmCompanyOut]:
    workspace = _current_workspace(db, user.user_id, user.email)
    _ensure_crm_backfilled(db, user.user_id, workspace)
    stmt = select(Company).where(Company.workspace_id == workspace.id)
    if search:
        term = f"%{search}%"
        stmt = stmt.where(or_(Company.name.ilike(term), Company.website.ilike(term), Company.city.ilike(term), Company.industry.ilike(term)))
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
    companies = list(db.scalars(stmt.order_by(Company.updated_at.desc()).limit(100)).all())
    return [_crm_company_out(db, workspace, user.user_id, company) for company in companies]


@router.get("/companies/{company_id}", response_model=CrmCompanyOut)
def get_company(company_id: UUID, user: CurrentUserContext, db: Session = Depends(get_db)) -> CrmCompanyOut:
    workspace = _current_workspace(db, user.user_id, user.email)
    company = _scoped_company(db, workspace.id, company_id)
    return _crm_company_out(db, workspace, user.user_id, company)


@router.post("/companies/{company_id}/analyze", response_model=UsageActionOut)
def analyze_company(company_id: UUID, request: Request, user: CurrentUserContext, db: Session = Depends(get_db)) -> UsageActionOut:
    workspace = _current_workspace(db, user.user_id, user.email)
    company = _scoped_company(db, workspace.id, company_id)
    if not company.lead_id:
        return UsageActionOut(status="error", message="This company needs a saved lead before analysis.", company=_crm_company_out(db, workspace, user.user_id, company))
    lead = db.scalar(select(Lead).where(Lead.id == company.lead_id, Lead.workspace_id == workspace.id))
    if not lead:
        return UsageActionOut(status="error", message="This company needs a saved lead before analysis.", company=_crm_company_out(db, workspace, user.user_id, company))
    try:
        _analyze_lead_if_possible(db, user.user_id, workspace, lead)
        _add_lead_activity(db, request, user.user_id, workspace, "website.analyzed", lead, {"source": "workspace_app"})
        db.commit()
        company = _sync_lead_to_crm(db, user.user_id, workspace, lead)
        db.commit()
        return UsageActionOut(status="success", message="Website analysis saved.", company=_crm_company_out(db, workspace, user.user_id, company))
    except Exception as exc:
        capture_provider_exception(exc, provider="openai", endpoint="workspace_app.company.analyze", workspace_id=workspace.id, lead_id=lead.id)
        return UsageActionOut(status="provider_unavailable", message=_safe_provider_warning(exc), company=_crm_company_out(db, workspace, user.user_id, company))


@router.post("/companies/{company_id}/contacts", response_model=UsageActionOut)
def discover_company_contacts(company_id: UUID, request: Request, user: CurrentUserContext, db: Session = Depends(get_db)) -> UsageActionOut:
    workspace = _current_workspace(db, user.user_id, user.email)
    company = _scoped_company(db, workspace.id, company_id)
    if not company.lead_id:
        return UsageActionOut(status="error", message="Save this company as a lead before finding contacts.", company=_crm_company_out(db, workspace, user.user_id, company))
    lead = db.scalar(select(Lead).where(Lead.id == company.lead_id, Lead.workspace_id == workspace.id))
    if not lead:
        return UsageActionOut(status="error", message="Save this company as a lead before finding contacts.", company=_crm_company_out(db, workspace, user.user_id, company))
    if not hunter_key_loaded():
        return UsageActionOut(status="provider_unavailable", message="Contact discovery needs setup. You can add a contact manually and continue.", company=_crm_company_out(db, workspace, user.user_id, company))

    before_email = lead.email
    try:
        enriched = _hunter_enriched_leads(db, request, user.user_id, workspace, [_lead_out(lead)])
    except Exception as exc:
        capture_provider_exception(exc, provider="hunter", endpoint="workspace_app.company.contacts", workspace_id=workspace.id, lead_id=lead.id)
        return UsageActionOut(status="provider_unavailable", message="Contact discovery is temporarily unavailable. You can add a contact manually and continue.", company=_crm_company_out(db, workspace, user.user_id, company))

    enriched_lead = enriched[0] if enriched else _lead_out(lead)
    metadata = _lead_metadata(enriched_lead)
    lead.contact = enriched_lead.contact or lead.contact
    lead.email = str(enriched_lead.email) if enriched_lead.email else lead.email
    lead.phone = enriched_lead.phone or lead.phone
    lead.linkedin = enriched_lead.linkedin or lead.linkedin
    lead.notes = _merge_lead_metadata(
        lead,
        {
            **metadata,
            "contact_found_at": datetime.utcnow().isoformat() if enriched_lead.email or lead.email else _lead_metadata(lead).get("contact_found_at"),
            "hunter_status": enriched_lead.hunter_status or metadata.get("hunter_status") or ("verified" if enriched_lead.email else "no_verified_email"),
            "hunter_verified": bool(enriched_lead.hunter_verified or metadata.get("hunter_verified")),
            "email_status": "Verified" if enriched_lead.hunter_verified or metadata.get("hunter_verified") else ("Found" if enriched_lead.email or lead.email else "No verified email"),
        },
    )
    company = _sync_lead_to_crm(db, user.user_id, workspace, lead)
    if lead.email and lead.email != before_email:
        _add_lead_activity(db, request, user.user_id, workspace, "contact.found", lead, {"source": "contact_discovery"})
    db.commit()
    db.refresh(company)
    status: UsageStatus = "success" if lead.email else "empty"
    message = "Verified contact saved to CRM." if lead.email else "No verified email was found. Add a contact manually or continue with company research."
    return UsageActionOut(status=status, message=message, company=_crm_company_out(db, workspace, user.user_id, company))


@router.post("/companies/{company_id}/email-draft", response_model=UsageActionOut)
def generate_email_draft(company_id: UUID, request: Request, user: CurrentUserContext, db: Session = Depends(get_db)) -> UsageActionOut:
    workspace = _current_workspace(db, user.user_id, user.email)
    company = _scoped_company(db, workspace.id, company_id)
    if not company.lead_id:
        return UsageActionOut(status="error", message="This company needs a saved lead before email generation.", company=_crm_company_out(db, workspace, user.user_id, company))
    lead = db.scalar(select(Lead).where(Lead.id == company.lead_id, Lead.workspace_id == workspace.id))
    if not lead:
        return UsageActionOut(status="error", message="This company needs a saved lead before email generation.", company=_crm_company_out(db, workspace, user.user_id, company))
    try:
        variant = personalize_email(
            PersonalizeRequest(
                company=lead.company,
                niche=lead.industry or lead.niche or "",
                website_summary=company.ai_summary or _lead_metadata(lead).get("ai_summary") or "",
                offer=company.suggested_offer or workspace.company or "AI-powered lead generation and outbound growth",
                cta="Book a quick call",
                tone="Professional",
                language=workspace.language or "English",
                signature="",
            )
        )
    except Exception as exc:
        capture_provider_exception(exc, provider="openai", endpoint="workspace_app.email_draft", workspace_id=workspace.id, lead_id=lead.id)
        return UsageActionOut(status="provider_unavailable", message=_safe_provider_warning(exc), company=_crm_company_out(db, workspace, user.user_id, company))

    email = EmailMessage(
        user_id=user.user_id,
        workspace_id=workspace.id,
        lead_id=lead.id,
        subject=variant.subject or f"Quick idea for {lead.company}",
        preview=variant.preview,
        body=variant.full_email or variant.cold_email,
        cta=variant.cta,
        follow_up_1=variant.follow_ups[0] if len(variant.follow_ups) > 0 else "",
        follow_up_2=variant.follow_ups[1] if len(variant.follow_ups) > 1 else "",
        tags={"requires_approval": True, "source": "workspace_app"},
        delivery_status="draft",
    )
    db.add(email)
    lead.status = LeadStatus.email_generated
    lead.notes = _merge_lead_metadata(lead, {"email_status": "Draft Ready", "email_generated_at": datetime.utcnow().isoformat()})
    _add_lead_activity(db, request, user.user_id, workspace, "email.generated", lead, {"source": "workspace_app"})
    company = _sync_lead_to_crm(db, user.user_id, workspace, lead)
    db.commit()
    db.refresh(email)
    return UsageActionOut(
        status="success",
        message="Email draft created for review. Nothing was sent.",
        company=_crm_company_out(db, workspace, user.user_id, company),
        email=EmailOut.model_validate(email),
    )


@router.post("/emails/{email_id}/approve", response_model=UsageActionOut)
def approve_email(email_id: UUID, request: Request, user: CurrentUserContext, db: Session = Depends(get_db)) -> UsageActionOut:
    workspace = _current_workspace(db, user.user_id, user.email)
    email = db.scalar(select(EmailMessage).where(EmailMessage.id == email_id, EmailMessage.workspace_id == workspace.id))
    if not email:
        raise HTTPException(status_code=404, detail="Email draft not found.")
    if email.delivery_status == "sent":
        return UsageActionOut(status="error", message="This email has already been sent.", email=EmailOut.model_validate(email))
    email.delivery_status = "approved"
    lead = db.scalar(select(Lead).where(Lead.id == email.lead_id, Lead.workspace_id == workspace.id)) if email.lead_id else None
    company = None
    if lead:
        lead.notes = _merge_lead_metadata(lead, {"email_status": "Approved", "email_approved_at": datetime.utcnow().isoformat()})
        _add_lead_activity(db, request, user.user_id, workspace, "email.approved", lead, {"email_id": str(email.id)})
        company = _sync_lead_to_crm(db, user.user_id, workspace, lead)
    db.commit()
    db.refresh(email)
    return UsageActionOut(
        status="success",
        message="Email approved. It is ready to send, but nothing was sent automatically.",
        company=_crm_company_out(db, workspace, user.user_id, company) if company else None,
        email=EmailOut.model_validate(email),
    )


@router.post("/emails/{email_id}/send", response_model=UsageActionOut)
def send_approved_email(email_id: UUID, request: Request, user: CurrentUserContext, db: Session = Depends(get_db)) -> UsageActionOut:
    workspace = _current_workspace(db, user.user_id, user.email)
    email = db.scalar(select(EmailMessage).where(EmailMessage.id == email_id, EmailMessage.workspace_id == workspace.id))
    if not email:
        raise HTTPException(status_code=404, detail="Email draft not found.")
    if email.delivery_status == "sent":
        return UsageActionOut(status="error", message="This email has already been sent.", email=EmailOut.model_validate(email))
    if email.delivery_status != "approved":
        return UsageActionOut(status="error", message="Approve the email before sending.", email=EmailOut.model_validate(email))
    lead = db.scalar(select(Lead).where(Lead.id == email.lead_id, Lead.workspace_id == workspace.id)) if email.lead_id else None
    if not lead or not lead.email:
        return UsageActionOut(status="error", message="Add a verified recipient email before sending.", email=EmailOut.model_validate(email))

    try:
        _enforce_usage(db, user.user_id, workspace, "email_sends")
        provider_response = send_email(to_email=lead.email, subject=email.subject, body=email.body)
    except (EmailProviderConfigurationError, EmailProviderRequestError) as exc:
        email.delivery_status = "failed"
        _add_lead_activity(db, request, user.user_id, workspace, "email.send_failed", lead, {"email_id": str(email.id), "reason": str(exc)})
        db.commit()
        capture_provider_exception(exc, provider="resend", endpoint="workspace_app.email.send", workspace_id=workspace.id, lead_id=lead.id)
        return UsageActionOut(status="provider_unavailable", message="Email sending needs setup or is temporarily unavailable. The approved draft is still saved.", email=EmailOut.model_validate(email))
    except Exception as exc:
        email.delivery_status = "failed"
        _add_lead_activity(db, request, user.user_id, workspace, "email.send_failed", lead, {"email_id": str(email.id)})
        db.commit()
        capture_provider_exception(exc, provider="resend", endpoint="workspace_app.email.send", workspace_id=workspace.id, lead_id=lead.id)
        return UsageActionOut(status="provider_unavailable", message="Email sending is temporarily unavailable. The approved draft is still saved.", email=EmailOut.model_validate(email))

    email.sent_at = datetime.utcnow()
    email.provider_message_id = str(provider_response.get("id"))
    email.delivery_status = "sent"
    lead.status = LeadStatus.contacted
    lead.notes = _merge_lead_metadata(lead, {"email_status": "Sent", "email_sent_at": email.sent_at.isoformat()})
    _add_lead_activity(db, request, user.user_id, workspace, "email.sent", lead, {"email_id": str(email.id), "provider_message_id": email.provider_message_id})
    company = _sync_lead_to_crm(db, user.user_id, workspace, lead)
    db.commit()
    db.refresh(email)
    db.refresh(company)
    return UsageActionOut(status="success", message="Approved email was sent. CRM stage updated.", company=_crm_company_out(db, workspace, user.user_id, company), email=EmailOut.model_validate(email))
