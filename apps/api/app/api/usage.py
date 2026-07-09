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
    _company_duplicate_stmt,
    _current_workspace,
    _ensure_crm_backfilled,
    _existing_duplicate_lead,
    _hunter_enriched_leads,
    _is_customer_visible_company,
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
from app.core.security import WorkspaceUserContext
from app.models.entities import AuditLog, Campaign, Company, Contact, Deal, EmailMessage, Lead, LeadStatus
from app.schemas.dto import CrmCompanyOut, EmailOut, LeadFinderRequest, LeadOut, PersonalizeRequest, WorkspaceOut
from app.services.ai import ProviderConfigurationError, ProviderRequestError, personalize_email
from app.services.emailer import EmailProviderConfigurationError, EmailProviderRequestError, send_email
from app.services.google_maps import GoogleMapsConfigurationError, GoogleMapsRequestError, get_google_place_details, search_google_places
from app.services.hunter import DECISION_MAKER_TITLES, hunter_key_loaded
from app.services.website import normalize_website_url

logger = logging.getLogger("outreachai.workspace_app")
router = APIRouter()


UsageStatus = Literal["success", "partial_success", "empty", "provider_unavailable", "timeout", "error"]
PLACEHOLDER_EMAIL_DOMAINS = {"example.com", "example.net", "example.org", "test.com", "invalid.test"}
MAX_TURNKEY_RESEARCH_LEADS = 10
LOCALE_LANGUAGE_NAMES = {
    "en": "English",
    "en-US": "American English",
    "ru": "Russian",
    "es": "Spanish",
    "fr": "French",
    "it": "Italian",
    "pl": "Polish",
}


class UsageCounts(BaseModel):
    leads: int = 0
    companies: int = 0
    campaigns: int = 0
    emails: int = 0
    deals: int = 0


def _workspace_language(request: Request, workspace) -> str:
    locale = (request.headers.get("x-outreachai-locale") or "").strip()
    if locale in LOCALE_LANGUAGE_NAMES:
        return LOCALE_LANGUAGE_NAMES[locale]
    return workspace.language or "English"


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


class UsageContactCreateIn(BaseModel):
    name: Optional[str] = Field(default=None, max_length=180)
    title: Optional[str] = Field(default=None, max_length=180)
    email: Optional[EmailStr] = None
    phone: Optional[str] = Field(default=None, max_length=80)
    linkedin: Optional[str] = Field(default=None, max_length=500)


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
    warnings: list[str] = Field(default_factory=list)
    completed_steps: list[str] = Field(default_factory=list)


class UsageIntegrationStatus(BaseModel):
    key: str
    label: str
    status: Literal["connected", "missing_key", "needs_setup", "error"]
    message: str


class UsageIntegrationStatusOut(BaseModel):
    integrations: list[UsageIntegrationStatus]


def _minimal_crm_company_out(company: Company) -> CrmCompanyOut:
    now = company.updated_at or company.created_at or datetime.utcnow()
    return CrmCompanyOut(
        id=company.id,
        lead_id=company.lead_id,
        name=company.name,
        website=company.website,
        domain=company.domain,
        phone=company.phone,
        email=company.email,
        address=company.address,
        city=company.city,
        country=company.country,
        industry=company.industry,
        google_rating=float(company.google_rating) if company.google_rating is not None else None,
        place_id=company.place_id,
        source=company.source or "manual",
        ai_summary=company.ai_summary or "",
        suggested_offer=company.suggested_offer or "",
        outreach_strategy=company.outreach_strategy or "",
        sales_angle=company.sales_angle or "",
        expected_reply_rate=company.expected_reply_rate or "",
        email_status=company.email_status or "Not prepared",
        crm_stage=company.crm_stage or "New Lead",
        created_at=company.created_at or now,
        updated_at=now,
        found_at=company.created_at or now,
        saved_to_crm_at=company.created_at or now,
        last_activity_at=now,
    )


def _ensure_minimal_company(db: Session, user_id: str, workspace, lead: Lead, metadata: dict[str, Any]) -> Company:
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
    company.source = str(metadata.get("source") or company.source or "manual")
    company.email_status = "Found" if lead.email else "Not prepared"
    company.crm_stage = "Contact Found" if lead.email else "New Lead"
    company.metadata_json = {**(company.metadata_json or {}), **metadata}
    company.updated_at = now
    db.flush()
    return company


def _safe_company_out(db: Session, workspace, user_id: str, company: Company) -> CrmCompanyOut:
    try:
        return _crm_company_out(db, workspace, user_id, company)
    except Exception as exc:
        capture_provider_exception(exc, provider="postgresql", endpoint="workspace_app.company_output")
        return _minimal_crm_company_out(company)


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


def _is_placeholder_recipient(email: str | None) -> bool:
    if not email or "@" not in email:
        return True
    domain = email.rsplit("@", 1)[1].strip().lower()
    return domain in PLACEHOLDER_EMAIL_DOMAINS


def _needs_ai_research(lead: Lead) -> bool:
    metadata = _lead_metadata(lead)
    return not all(
        [
            metadata.get("ai_summary"),
            metadata.get("sales_angle"),
            metadata.get("suggested_offer"),
            metadata.get("expected_reply_rate"),
        ]
    )


def _ensure_b2b_opportunity_metadata(lead: Lead, workspace, source: str = "fallback") -> None:
    """Fill useful sales fields from verified CRM data without inventing contacts."""
    metadata = _lead_metadata(lead)
    company = (lead.company or "This company").strip()
    industry = (lead.industry or lead.niche or metadata.get("business_category") or "its market").strip()
    location = ", ".join(part for part in [lead.city, lead.country] if part)
    has_website = bool(lead.website or metadata.get("domain"))
    has_email = bool(lead.email)
    public_signals = [
        "website available" if has_website else "",
        "phone available" if lead.phone else "",
        "local business listing available" if metadata.get("place_id") else "",
        "public rating available" if metadata.get("google_rating") else "",
    ]
    public_signals = [signal for signal in public_signals if signal]
    summary = (
        f"{company} is a {industry} company"
        + (f" in {location}" if location else "")
        + ". "
        + (
            f"Verified public signals: {', '.join(public_signals)}."
            if public_signals
            else "Public profile is saved, but more research is needed before outreach."
        )
    )
    offer_focus = workspace.company or getattr(workspace, "offer", "") or "a focused B2B partnership and outbound workflow"
    updates = {
        "ai_summary": metadata.get("ai_summary") or summary,
        "sales_angle": metadata.get("sales_angle") or f"Lead with a practical {industry} growth or partnership angle based on verified public data.",
        "suggested_offer": metadata.get("suggested_offer") or f"Offer {offer_focus} tailored to {company}.",
        "outreach_strategy": metadata.get("outreach_strategy") or (
            "Use review mode: research the company, prepare a concise email, verify the recipient, then approve before sending."
        ),
        "recommended_tone": metadata.get("recommended_tone") or "Professional",
        "recommended_cta": metadata.get("recommended_cta") or "Book a quick call",
        "follow_up_strategy": metadata.get("follow_up_strategy") or "Send two short follow-ups only after the first email is reviewed.",
        "expected_reply_rate": metadata.get("expected_reply_rate") or ("8-12%" if has_website and has_email else "4-8% until contact is verified"),
        "confidence_score": metadata.get("confidence_score") or (72 if has_website and has_email else 58 if has_website else 42),
        "priority_score": metadata.get("priority_score") or (78 if has_website and has_email else 62 if has_website else 45),
        "buying_signals": metadata.get("buying_signals") or public_signals or ["Company profile saved in CRM"],
        "risks": metadata.get("risks")
        or [
            risk
            for risk in [
                "" if has_website else "Website is missing, so AI research is limited.",
                "" if has_email else "Verified decision-maker email is not available yet.",
            ]
            if risk
        ],
        "opportunity_analysis": metadata.get("opportunity_analysis")
        or f"{company} can be worked as a B2B opportunity once research and contact verification are complete.",
        "partnership_fit": metadata.get("partnership_fit") or f"Potential fit for {offer_focus} if the company matches the workspace ICP.",
        "next_recommended_action": metadata.get("next_recommended_action")
        or (
            "Review and approve the generated email." if has_email else "Find or add a verified decision-maker email before sending."
        ),
        "research_source": metadata.get("research_source") or source,
    }
    if not metadata.get("pain_points"):
        updates["pain_points"] = [
            "Manual prospect research takes time.",
            "Personal outreach needs verified company context.",
        ]
    lead.notes = _merge_lead_metadata(lead, updates)


def _existing_review_draft(db: Session, workspace_id: UUID, lead_id: UUID) -> EmailMessage | None:
    return db.scalar(
        select(EmailMessage)
        .where(EmailMessage.workspace_id == workspace_id, EmailMessage.lead_id == lead_id)
        .order_by(EmailMessage.created_at.desc())
        .limit(1)
    )


def _create_review_email_draft(db: Session, request: Request, user_id: str, workspace, lead: Lead) -> EmailMessage | None:
    existing = _existing_review_draft(db, workspace.id, lead.id)
    if existing:
        return existing
    metadata = _lead_metadata(lead)
    variant = personalize_email(
        PersonalizeRequest(
            company=lead.company,
            niche=lead.industry or lead.niche or "",
            website_summary=str(metadata.get("ai_summary") or ""),
            offer=str(metadata.get("suggested_offer") or workspace.company or "AI-powered B2B lead generation"),
            cta=str(metadata.get("recommended_cta") or "Book a quick call"),
            tone=str(metadata.get("recommended_tone") or "Professional"),
            language=_workspace_language(request, workspace),
            signature="",
        )
    )
    email = EmailMessage(
        user_id=user_id,
        workspace_id=workspace.id,
        lead_id=lead.id,
        subject=variant.subject or f"Quick idea for {lead.company}",
        preview=variant.preview,
        body=variant.full_email or variant.cold_email,
        cta=variant.cta,
        follow_up_1=variant.follow_ups[0] if len(variant.follow_ups) > 0 else "",
        follow_up_2=variant.follow_ups[1] if len(variant.follow_ups) > 1 else "",
        tags={"requires_approval": True, "source": "turnkey_lead_research"},
        delivery_status="draft",
    )
    db.add(email)
    lead.status = LeadStatus.email_generated
    lead.notes = _merge_lead_metadata(lead, {"email_status": "Draft Ready", "email_generated_at": datetime.utcnow().isoformat()})
    _add_lead_activity(db, request, user_id, workspace, "email.generated", lead, {"source": "turnkey_lead_research"})
    return email


def _complete_turnkey_b2b_research(
    db: Session,
    request: Request,
    user_id: str,
    workspace,
    leads: list[Lead],
    request_id: str,
) -> list[str]:
    warnings: list[str] = []
    for index, lead in enumerate(leads[:MAX_TURNKEY_RESEARCH_LEADS], start=1):
        _lead_trace(request_id, "turnkey_research_started", lead_id=str(lead.id), company=lead.company, index=index)
        public_details_updated = _complete_public_company_details(db, request, user_id, workspace, lead, request_id)
        if public_details_updated:
            _sync_lead_to_crm(db, user_id, workspace, lead)
            _lead_trace(request_id, "turnkey_public_details_completed", lead_id=str(lead.id), company=lead.company, website=lead.website or "", phone=lead.phone or "")
        if not lead.email and hunter_key_loaded() and (lead.website or _lead_metadata(lead).get("domain")):
            try:
                _lead_trace(request_id, "turnkey_contact_refresh_started", lead_id=str(lead.id), company=lead.company)
                enriched = _hunter_enriched_leads(db, request, user_id, workspace, [_lead_out(lead)])
                enriched_lead = enriched[0] if enriched else None
                if enriched_lead:
                    _apply_enriched_lead_to_record(lead, enriched_lead)
                    if lead.email:
                        _add_lead_activity(db, request, user_id, workspace, "contact.found", lead, {"source": "turnkey_lead_research"})
                    else:
                        _add_lead_activity(db, request, user_id, workspace, "contact.search_empty", lead, {"source": "turnkey_lead_research"})
                _sync_lead_to_crm(db, user_id, workspace, lead)
                _lead_trace(request_id, "turnkey_contact_refresh_finished", lead_id=str(lead.id), company=lead.company, has_email=bool(lead.email))
            except Exception as exc:
                capture_provider_exception(exc, provider="hunter", endpoint="workspace_app.turnkey_contact_refresh", workspace_id=workspace.id, lead_id=lead.id, extra={"request_id": request_id})
                warnings.append(f"{lead.company}: verified contact could not be completed yet.")
                _lead_trace(request_id, "turnkey_contact_refresh_failed", lead_id=str(lead.id), company=lead.company, reason=str(exc))
        try:
            if _needs_ai_research(lead):
                _analyze_lead_if_possible(db, user_id, workspace, lead)
                _ensure_b2b_opportunity_metadata(lead, workspace, source="turnkey_fallback")
                metadata = _lead_metadata(lead)
                if metadata.get("ai_summary") or metadata.get("suggested_offer") or metadata.get("expected_reply_rate"):
                    _add_lead_activity(db, request, user_id, workspace, "website.analyzed", lead, {"source": "turnkey_lead_research"})
                else:
                    warnings.append(f"{lead.company}: AI research could not complete yet.")
                    _lead_trace(request_id, "turnkey_ai_research_partial", lead_id=str(lead.id), company=lead.company)
            _sync_lead_to_crm(db, user_id, workspace, lead)
        except Exception as exc:
            capture_provider_exception(exc, provider="openai", endpoint="workspace_app.turnkey_research", workspace_id=workspace.id, lead_id=lead.id, extra={"request_id": request_id})
            _ensure_b2b_opportunity_metadata(lead, workspace, source="turnkey_fallback_after_ai_error")
            _sync_lead_to_crm(db, user_id, workspace, lead)
            warnings.append(f"{lead.company}: AI research is temporarily unavailable.")
            _lead_trace(request_id, "turnkey_ai_research_failed", lead_id=str(lead.id), company=lead.company, reason=str(exc))

        try:
            _create_review_email_draft(db, request, user_id, workspace, lead)
            _sync_lead_to_crm(db, user_id, workspace, lead)
        except Exception as exc:
            capture_provider_exception(exc, provider="openai", endpoint="workspace_app.turnkey_email_draft", workspace_id=workspace.id, lead_id=lead.id, extra={"request_id": request_id})
            warnings.append(f"{lead.company}: email draft could not be prepared yet.")
            _lead_trace(request_id, "turnkey_email_draft_failed", lead_id=str(lead.id), company=lead.company, reason=str(exc))
            continue
        _lead_trace(request_id, "turnkey_research_finished", lead_id=str(lead.id), company=lead.company)
    if len(leads) > MAX_TURNKEY_RESEARCH_LEADS:
        warnings.append(f"Prepared the first {MAX_TURNKEY_RESEARCH_LEADS} opportunities. Open the rest to complete research.")
    return warnings


def _complete_public_company_details(db: Session, request: Request, user_id: str, workspace, lead: Lead, request_id: str) -> bool:
    metadata = _lead_metadata(lead)
    place_id = str(metadata.get("place_id") or "").strip()
    if not place_id:
        return False
    if lead.website and lead.phone and metadata.get("address") and metadata.get("google_maps_url"):
        return False
    try:
        _lead_trace(request_id, "google_place_details_started", lead_id=str(lead.id), company=lead.company, place_id=place_id)
        details = get_google_place_details(place_id)
    except Exception as exc:
        capture_provider_exception(exc, provider="google_maps", endpoint="workspace_app.place_details", workspace_id=workspace.id, lead_id=lead.id, extra={"request_id": request_id, "place_id": place_id})
        _lead_trace(request_id, "google_place_details_failed", lead_id=str(lead.id), company=lead.company, place_id=place_id, reason=str(exc))
        return False

    updates = {key: value for key, value in details.items() if value not in {None, ""}}
    if not updates:
        return False
    if not lead.website and updates.get("website"):
        lead.website = str(updates["website"])
    if not lead.phone and updates.get("phone"):
        lead.phone = str(updates["phone"])
    if not lead.industry and updates.get("business_category"):
        lead.industry = str(updates["business_category"])
    if not lead.niche and updates.get("business_category"):
        lead.niche = str(updates["business_category"])
    updates["domain"] = str(updates.get("domain") or _domain_from_website(lead.website) or metadata.get("domain") or "") or None
    lead.notes = _merge_lead_metadata(lead, updates)
    _add_lead_activity(db, request, user_id, workspace, "company.public_details_completed", lead, {"source": "turnkey_lead_research"})
    return True


def _complete_public_details_for_search_results(leads: list[LeadOut], request_id: str) -> list[LeadOut]:
    completed: list[LeadOut] = []
    for lead in leads:
        metadata = _lead_metadata(lead)
        place_id = str(metadata.get("place_id") or lead.place_id or "").strip()
        if not place_id or (lead.website and lead.phone):
            completed.append(lead)
            continue
        try:
            _lead_trace(request_id, "google_place_details_started", company=lead.company, place_id=place_id)
            details = get_google_place_details(place_id)
        except Exception as exc:
            _lead_trace(request_id, "google_place_details_failed", company=lead.company, place_id=place_id, reason=str(exc))
            completed.append(lead)
            continue
        updates = {key: value for key, value in details.items() if value not in {None, ""}}
        if not updates:
            completed.append(lead)
            continue
        completed.append(
            lead.model_copy(
                update={
                    "website": lead.website or updates.get("website"),
                    "domain": lead.domain or updates.get("domain"),
                    "phone": lead.phone or updates.get("phone"),
                    "address": lead.address or updates.get("address"),
                    "google_rating": lead.google_rating or updates.get("google_rating"),
                    "business_category": lead.business_category or updates.get("business_category"),
                    "industry": lead.industry or updates.get("business_category"),
                    "niche": lead.niche or updates.get("business_category"),
                    "notes": _merge_metadata_notes_for_lead_out(lead, updates),
                }
            )
        )
    return completed


def _merge_metadata_notes_for_lead_out(lead: LeadOut, updates: dict[str, Any]) -> str:
    return _merge_lead_metadata(lead, {**_lead_metadata(lead), **updates})


def _preserve_search_public_details(original: list[LeadOut], enriched: list[LeadOut]) -> list[LeadOut]:
    metadata_by_key: dict[str, dict[str, Any]] = {}
    lead_by_key: dict[str, LeadOut] = {}
    for lead in original:
        key = _lead_out_match_key(lead)
        if key:
            metadata_by_key[key] = _lead_metadata(lead)
            lead_by_key[key] = lead
    preserved: list[LeadOut] = []
    for lead in enriched:
        key = _lead_out_match_key(lead)
        source_lead = lead_by_key.get(key)
        if not source_lead:
            preserved.append(lead)
            continue
        public_metadata = metadata_by_key.get(key, {})
        preserved.append(
            lead.model_copy(
                update={
                    "website": lead.website or source_lead.website,
                    "domain": lead.domain or source_lead.domain,
                    "phone": lead.phone or source_lead.phone,
                    "address": lead.address or source_lead.address,
                    "google_rating": lead.google_rating or source_lead.google_rating,
                    "business_category": lead.business_category or source_lead.business_category,
                    "notes": _merge_metadata_notes_for_lead_out(lead, {**public_metadata, **_lead_metadata(lead)}),
                }
            )
        )
    return preserved


def _lead_out_match_key(lead: LeadOut) -> str:
    metadata = _lead_metadata(lead)
    return str(metadata.get("place_id") or lead.place_id or metadata.get("domain") or lead.domain or lead.website or lead.company or "")


def _apply_enriched_lead_to_record(lead: Lead, enriched: LeadOut) -> None:
    metadata = _lead_metadata(enriched)
    lead.contact = enriched.contact or lead.contact
    lead.email = str(enriched.email) if enriched.email else lead.email
    lead.phone = enriched.phone or lead.phone
    lead.linkedin = enriched.linkedin or lead.linkedin
    lead.website = enriched.website or lead.website
    lead.industry = enriched.industry or lead.industry
    lead.niche = enriched.niche or lead.niche
    lead.notes = _merge_lead_metadata(
        lead,
        {
            **metadata,
            "contact_search_checked_at": datetime.utcnow().isoformat(),
            "contact_search_status": "verified_email_found" if enriched.email else metadata.get("hunter_status", "no_verified_email"),
            "contact_search_message": "Verified contact saved to CRM." if enriched.email else "No verified business email was found yet. Add a decision maker manually or continue with research.",
            "decision_maker_roles_searched": list(DECISION_MAKER_TITLES),
            "hunter_status": enriched.hunter_status or metadata.get("hunter_status") or ("verified" if enriched.email else "no_verified_email"),
            "hunter_verified": bool(enriched.hunter_verified or metadata.get("hunter_verified")),
            "email_status": "Verified" if enriched.hunter_verified or metadata.get("hunter_verified") else ("Found" if enriched.email or lead.email else "No verified email"),
            "contact_found_at": datetime.utcnow().isoformat() if enriched.email or lead.email else metadata.get("contact_found_at"),
        },
    )


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
def bootstrap_workspace_app(user: WorkspaceUserContext, db: Session = Depends(get_db)) -> UsageBootstrapOut:
    workspace = _current_workspace(db, user.user_id, user.email)
    _ensure_crm_backfilled(db, user.user_id, workspace)
    counts = _workspace_counts(db, workspace.id)
    recent = list(
        db.scalars(
            select(Company)
            .where(Company.workspace_id == workspace.id)
            .order_by(Company.updated_at.desc())
            .limit(20)
        ).all()
    )
    recent = [item for item in recent if _is_customer_visible_company(item)][:5]
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
def integration_status(user: WorkspaceUserContext, db: Session = Depends(get_db)) -> UsageIntegrationStatusOut:
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
def create_company(payload: UsageCompanyCreateIn, request: Request, user: WorkspaceUserContext, db: Session = Depends(get_db)) -> UsageCompanyCreateOut:
    workspace = _current_workspace(db, user.user_id, user.email)
    existing_company = _find_existing_company(db, workspace.id, payload)
    if existing_company:
        return UsageCompanyCreateOut(
            status="reused",
            message="This company already exists in your private workspace.",
            company=_safe_company_out(db, workspace, user.user_id, existing_company),
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
        _ensure_b2b_opportunity_metadata(existing_lead, workspace, source="manual_company_reused_fallback")
        metadata = {**metadata, **_lead_metadata(existing_lead)}
        company = _ensure_minimal_company(db, user.user_id, workspace, existing_lead, metadata)
        try:
            with db.begin_nested():
                company = _sync_lead_to_crm(db, user.user_id, workspace, existing_lead)
        except Exception as exc:
            capture_provider_exception(exc, provider="postgresql", endpoint="workspace_app.company_sync_existing")
        db.commit()
        return UsageCompanyCreateOut(
            status="reused",
            message="This company already exists in your private workspace.",
            company=_safe_company_out(db, workspace, user.user_id, company),
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
    _ensure_b2b_opportunity_metadata(lead, workspace, source="manual_company_fallback")
    metadata = {**metadata, **_lead_metadata(lead)}
    company = _ensure_minimal_company(db, user.user_id, workspace, lead, metadata)
    try:
        with db.begin_nested():
            _add_lead_activity(db, request, user.user_id, workspace, "lead.saved_to_crm", lead, {"source": payload.source or "manual"})
            company = _sync_lead_to_crm(db, user.user_id, workspace, lead)
    except Exception as exc:
        capture_provider_exception(exc, provider="postgresql", endpoint="workspace_app.company_sync")
    if payload.address:
        company.address = payload.address
    db.commit()
    db.refresh(company)
    return UsageCompanyCreateOut(
        status="created",
        message="Company saved to your private workspace.",
        company=_safe_company_out(db, workspace, user.user_id, company),
    )


def _merge_lead_metadata_for_create(metadata: dict[str, Any]) -> str:
    clean = {key: value for key, value in metadata.items() if value is not None and value != ""}
    import json

    return json.dumps(clean, sort_keys=True)


@router.post("/leads/search", response_model=UsageLeadSearchOut)
def search_leads(payload: LeadFinderRequest, request: Request, user: WorkspaceUserContext, db: Session = Depends(get_db)) -> UsageLeadSearchOut:
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

    found = _complete_public_details_for_search_results(found, request_id)
    try:
        _lead_trace(request_id, "hunter_started", leads=len(found))
        enriched = _hunter_enriched_leads(db, request, user.user_id, workspace, found)
        enriched = _preserve_search_public_details(found, enriched)
        _lead_trace(request_id, "hunter_finished", leads=len(enriched), verified=sum(1 for item in enriched if item.hunter_verified))
    except Exception as exc:
        capture_provider_exception(exc, provider="hunter", endpoint="workspace_app.hunter.enrichment", workspace_id=workspace.id, extra={"request_id": request_id})
        warnings.append("Contacts could not be verified right now. Companies were saved without verified emails.")
        enriched = found

    duplicates_skipped = sum(1 for item in enriched if _existing_duplicate_lead(db, workspace, user.user_id, item) is not None)
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
    _lead_trace(request_id, "turnkey_research_batch_started", leads=len(saved))
    try:
        warnings.extend(_complete_turnkey_b2b_research(db, request, user.user_id, workspace, saved, request_id))
    except Exception as exc:
        capture_provider_exception(exc, provider="openai", endpoint="workspace_app.turnkey_research_batch", workspace_id=workspace.id, extra={"request_id": request_id})
        warnings.append("Companies were saved. Some AI research is still being prepared and can be retried from the company profile.")
        _lead_trace(request_id, "turnkey_research_batch_failed", reason=str(exc), error_type=type(exc).__name__)
        try:
            db.rollback()
        except Exception:
            pass

    companies: list[CrmCompanyOut] = []
    for lead in saved:
        try:
            company = _sync_lead_to_crm(db, user.user_id, workspace, lead)
            companies.append(_safe_company_out(db, workspace, user.user_id, company))
        except Exception as exc:
            capture_provider_exception(exc, provider="postgresql", endpoint="workspace_app.company_output_after_search", workspace_id=workspace.id, lead_id=lead.id, extra={"request_id": request_id})
            _lead_trace(request_id, "company_output_after_search_failed", lead_id=str(lead.id), company=lead.company, reason=str(exc), error_type=type(exc).__name__)
            try:
                db.rollback()
            except Exception:
                pass
            fallback_company = _ensure_minimal_company(db, user.user_id, workspace, lead, _lead_metadata(lead))
            companies.append(_minimal_crm_company_out(fallback_company))

    db.commit()
    _lead_trace(
        request_id,
        "turnkey_research_batch_finished",
        companies=len(companies),
        ai_ready=sum(1 for company in companies if company.ai_summary and company.suggested_offer),
        drafts_ready=sum(1 for company in companies if company.generated_emails),
        warnings=len(warnings),
    )
    new_saved_count = max(0, len(enriched) - duplicates_skipped)
    status: UsageStatus = "partial_success" if warnings else "success"
    if new_saved_count and duplicates_skipped:
        message = f"Found {len(companies)} companies. Added {new_saved_count} new and reused {duplicates_skipped} already in your CRM."
    elif duplicates_skipped:
        message = f"Found {len(companies)} companies. They were already in your CRM."
    else:
        message = f"Found, researched and saved {len(companies)} companies to your CRM."
    return UsageLeadSearchOut(
        status=status,
        request_id=request_id,
        message=message,
        companies_saved=new_saved_count,
        duplicates_skipped=duplicates_skipped,
        companies=companies,
        warnings=warnings,
    )


@router.get("/companies", response_model=list[CrmCompanyOut])
def list_companies(
    user: WorkspaceUserContext,
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
    companies = [company for company in db.scalars(stmt.order_by(Company.updated_at.desc()).limit(200)).all() if _is_customer_visible_company(company)][:100]
    return [_crm_company_out(db, workspace, user.user_id, company) for company in companies]


@router.get("/companies/{company_id}", response_model=CrmCompanyOut)
def get_company(company_id: UUID, user: WorkspaceUserContext, db: Session = Depends(get_db)) -> CrmCompanyOut:
    workspace = _current_workspace(db, user.user_id, user.email)
    company = _scoped_company(db, workspace.id, company_id)
    return _crm_company_out(db, workspace, user.user_id, company)


@router.post("/companies/{company_id}/analyze", response_model=UsageActionOut)
def analyze_company(company_id: UUID, request: Request, user: WorkspaceUserContext, db: Session = Depends(get_db)) -> UsageActionOut:
    workspace = _current_workspace(db, user.user_id, user.email)
    company = _scoped_company(db, workspace.id, company_id)
    if not company.lead_id:
        return UsageActionOut(status="error", message="This company needs a saved lead before analysis.", company=_crm_company_out(db, workspace, user.user_id, company))
    lead = db.scalar(select(Lead).where(Lead.id == company.lead_id, Lead.workspace_id == workspace.id))
    if not lead:
        return UsageActionOut(status="error", message="This company needs a saved lead before analysis.", company=_crm_company_out(db, workspace, user.user_id, company))
    try:
        _complete_public_company_details(db, request, user.user_id, workspace, lead, request.headers.get("x-request-id") or str(uuid4()))
        _analyze_lead_if_possible(db, user.user_id, workspace, lead, language=_workspace_language(request, workspace))
        _ensure_b2b_opportunity_metadata(lead, workspace, source="workspace_analyze")
        _add_lead_activity(db, request, user.user_id, workspace, "website.analyzed", lead, {"source": "workspace_app"})
        db.commit()
        company = _sync_lead_to_crm(db, user.user_id, workspace, lead)
        db.commit()
        return UsageActionOut(status="success", message="Website analysis saved.", company=_crm_company_out(db, workspace, user.user_id, company))
    except Exception as exc:
        capture_provider_exception(exc, provider="openai", endpoint="workspace_app.company.analyze", workspace_id=workspace.id, lead_id=lead.id)
        return UsageActionOut(status="provider_unavailable", message=_safe_provider_warning(exc), company=_crm_company_out(db, workspace, user.user_id, company))


@router.post("/companies/{company_id}/contacts", response_model=UsageActionOut)
def discover_company_contacts(company_id: UUID, request: Request, user: WorkspaceUserContext, db: Session = Depends(get_db)) -> UsageActionOut:
    workspace = _current_workspace(db, user.user_id, user.email)
    company = _scoped_company(db, workspace.id, company_id)
    if not company.lead_id:
        return UsageActionOut(status="error", message="Save this company as a lead before finding contacts.", company=_crm_company_out(db, workspace, user.user_id, company))
    lead = db.scalar(select(Lead).where(Lead.id == company.lead_id, Lead.workspace_id == workspace.id))
    if not lead:
        return UsageActionOut(status="error", message="Save this company as a lead before finding contacts.", company=_crm_company_out(db, workspace, user.user_id, company))
    if not hunter_key_loaded():
        return UsageActionOut(status="provider_unavailable", message="Contact discovery needs setup. You can add a contact manually and continue.", company=_crm_company_out(db, workspace, user.user_id, company))

    _complete_public_company_details(db, request, user.user_id, workspace, lead, request.headers.get("x-request-id") or str(uuid4()))
    before_email = lead.email
    try:
        enriched = _hunter_enriched_leads(db, request, user.user_id, workspace, [_lead_out(lead)])
    except Exception as exc:
        capture_provider_exception(exc, provider="hunter", endpoint="workspace_app.company.contacts", workspace_id=workspace.id, lead_id=lead.id)
        return UsageActionOut(status="provider_unavailable", message="Contact discovery is temporarily unavailable. You can add a contact manually and continue.", company=_crm_company_out(db, workspace, user.user_id, company))

    enriched_lead = enriched[0] if enriched else _lead_out(lead)
    metadata = _lead_metadata(enriched_lead)
    contact_search_checked_at = datetime.utcnow().isoformat()
    has_verified_contact = bool(enriched_lead.email or lead.email)
    contact_search_status = "verified_email_found" if has_verified_contact else "no_verified_email"
    contact_search_message = (
        "Verified contact saved to CRM."
        if has_verified_contact
        else "No verified business email was found. Add a decision maker manually or continue with research."
    )
    lead.contact = enriched_lead.contact or lead.contact
    lead.email = str(enriched_lead.email) if enriched_lead.email else lead.email
    lead.phone = enriched_lead.phone or lead.phone
    lead.linkedin = enriched_lead.linkedin or lead.linkedin
    lead.notes = _merge_lead_metadata(
        lead,
        {
            **metadata,
            "contact_found_at": contact_search_checked_at if has_verified_contact else _lead_metadata(lead).get("contact_found_at"),
            "contact_search_checked_at": contact_search_checked_at,
            "contact_search_status": contact_search_status,
            "contact_search_message": contact_search_message,
            "decision_maker_roles_searched": list(DECISION_MAKER_TITLES),
            "hunter_status": enriched_lead.hunter_status or metadata.get("hunter_status") or ("verified" if enriched_lead.email else "no_verified_email"),
            "hunter_verified": bool(enriched_lead.hunter_verified or metadata.get("hunter_verified")),
            "email_status": "Verified" if enriched_lead.hunter_verified or metadata.get("hunter_verified") else ("Found" if enriched_lead.email or lead.email else "No verified email"),
        },
    )
    _ensure_b2b_opportunity_metadata(lead, workspace, source="workspace_contact_discovery")
    company = _sync_lead_to_crm(db, user.user_id, workspace, lead)
    if lead.email and lead.email != before_email:
        _add_lead_activity(db, request, user.user_id, workspace, "contact.found", lead, {"source": "contact_discovery"})
    elif not lead.email:
        _add_lead_activity(db, request, user.user_id, workspace, "contact.search_empty", lead, {"source": "contact_discovery", "roles_searched": list(DECISION_MAKER_TITLES)})
    db.commit()
    db.refresh(company)
    status: UsageStatus = "success" if lead.email else "empty"
    message = "Verified contact saved to CRM." if lead.email else contact_search_message
    return UsageActionOut(status=status, message=message, company=_crm_company_out(db, workspace, user.user_id, company))


@router.post("/companies/{company_id}/contacts/manual", response_model=UsageActionOut)
def add_manual_company_contact(company_id: UUID, payload: UsageContactCreateIn, request: Request, user: WorkspaceUserContext, db: Session = Depends(get_db)) -> UsageActionOut:
    workspace = _current_workspace(db, user.user_id, user.email)
    company = _scoped_company(db, workspace.id, company_id)
    lead = db.scalar(select(Lead).where(Lead.id == company.lead_id, Lead.workspace_id == workspace.id)) if company.lead_id else None
    clean_name = (payload.name or "").strip()
    clean_title = (payload.title or "").strip()
    clean_email = str(payload.email).strip() if payload.email else ""
    clean_phone = (payload.phone or "").strip()
    clean_linkedin = (payload.linkedin or "").strip()
    if not any([clean_name, clean_title, clean_email, clean_phone, clean_linkedin]):
        return UsageActionOut(status="error", message="Add at least one contact detail before saving.", company=_crm_company_out(db, workspace, user.user_id, company))

    contact = None
    if clean_email:
        contact = db.scalar(select(Contact).where(Contact.workspace_id == workspace.id, Contact.email == clean_email).order_by(Contact.updated_at.desc()))
    if contact is None and clean_name:
        contact = db.scalar(
            select(Contact)
            .where(Contact.workspace_id == workspace.id, Contact.company_id == company.id, Contact.name == clean_name)
            .order_by(Contact.updated_at.desc())
        )
    if contact is None:
        contact = Contact(user_id=user.user_id, workspace_id=workspace.id, company_id=company.id, lead_id=lead.id if lead else None)
        db.add(contact)

    contact.company_id = company.id
    contact.lead_id = contact.lead_id or (lead.id if lead else None)
    contact.name = clean_name or contact.name or ""
    contact.title = clean_title or contact.title or ""
    contact.email = clean_email or contact.email
    contact.phone = clean_phone or contact.phone
    contact.linkedin = clean_linkedin or contact.linkedin
    contact.source = "manual"
    contact.confidence = "Manual"
    contact.email_status = "Found" if contact.email else "Unknown"
    contact.metadata_json = {**(contact.metadata_json or {}), "source": "manual", "updated_from": "company_workspace"}
    contact.updated_at = datetime.utcnow()

    company.email = contact.email or company.email
    company.phone = contact.phone or company.phone
    company.email_status = "Found" if contact.email else company.email_status
    company.crm_stage = "Contact Found" if contact.email else company.crm_stage
    company.updated_at = datetime.utcnow()
    if lead:
        lead.contact = contact.name or lead.contact
        lead.email = contact.email or lead.email
        lead.phone = contact.phone or lead.phone
        lead.linkedin = contact.linkedin or lead.linkedin
        lead.notes = _merge_lead_metadata(
            lead,
            {
                "contact_found_at": datetime.utcnow().isoformat(),
                "email_status": "Found" if contact.email else _lead_metadata(lead).get("email_status", "No verified email"),
                "manual_contact_added": True,
            },
        )
        _add_lead_activity(db, request, user.user_id, workspace, "contact.found", lead, {"source": "manual", "email_status": contact.email_status})
        company = _sync_lead_to_crm(db, user.user_id, workspace, lead)
    db.commit()
    db.refresh(company)
    return UsageActionOut(status="success", message="Contact saved to CRM.", company=_crm_company_out(db, workspace, user.user_id, company))


@router.post("/companies/{company_id}/email-draft", response_model=UsageActionOut)
def generate_email_draft(company_id: UUID, request: Request, user: WorkspaceUserContext, db: Session = Depends(get_db)) -> UsageActionOut:
    workspace = _current_workspace(db, user.user_id, user.email)
    company = _scoped_company(db, workspace.id, company_id)
    if not company.lead_id:
        return UsageActionOut(status="error", message="This company needs a saved lead before email generation.", company=_crm_company_out(db, workspace, user.user_id, company))
    lead = db.scalar(select(Lead).where(Lead.id == company.lead_id, Lead.workspace_id == workspace.id))
    if not lead:
        return UsageActionOut(status="error", message="This company needs a saved lead before email generation.", company=_crm_company_out(db, workspace, user.user_id, company))
    try:
        _complete_public_company_details(db, request, user.user_id, workspace, lead, request.headers.get("x-request-id") or str(uuid4()))
        if _needs_ai_research(lead):
            _analyze_lead_if_possible(db, user.user_id, workspace, lead, language=_workspace_language(request, workspace))
        _ensure_b2b_opportunity_metadata(lead, workspace, source="workspace_email_draft")
        company = _sync_lead_to_crm(db, user.user_id, workspace, lead)
        variant = personalize_email(
            PersonalizeRequest(
                company=lead.company,
                niche=lead.industry or lead.niche or "",
                website_summary=company.ai_summary or _lead_metadata(lead).get("ai_summary") or "",
                offer=company.suggested_offer or workspace.company or "AI-powered lead generation and outbound growth",
                cta="Book a quick call",
                tone="Professional",
                language=_workspace_language(request, workspace),
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


@router.post("/companies/{company_id}/complete-opportunity", response_model=UsageActionOut)
def complete_company_opportunity(company_id: UUID, request: Request, user: WorkspaceUserContext, db: Session = Depends(get_db)) -> UsageActionOut:
    workspace = _current_workspace(db, user.user_id, user.email)
    company = _scoped_company(db, workspace.id, company_id)
    if not company.lead_id:
        return UsageActionOut(
            status="error",
            message="This company needs a saved lead before preparation.",
            company=_crm_company_out(db, workspace, user.user_id, company),
        )
    lead = db.scalar(select(Lead).where(Lead.id == company.lead_id, Lead.workspace_id == workspace.id))
    if not lead:
        return UsageActionOut(
            status="error",
            message="This company needs a saved lead before preparation.",
            company=_crm_company_out(db, workspace, user.user_id, company),
        )

    request_id = request.headers.get("x-request-id") or str(uuid4())
    warnings: list[str] = []
    completed_steps: list[str] = []
    email: EmailMessage | None = None
    _lead_trace(request_id, "complete_opportunity_started", lead_id=str(lead.id), company=lead.company)

    try:
        _complete_public_company_details(db, request, user.user_id, workspace, lead, request_id)
        completed_steps.append("Company profile checked")
    except Exception as exc:
        capture_provider_exception(
            exc,
            provider="google_maps",
            endpoint="workspace_app.complete_opportunity.profile",
            workspace_id=workspace.id,
            lead_id=lead.id,
            extra={"request_id": request_id},
        )
        warnings.append("Company profile could not be refreshed. Saved CRM data was kept.")
        completed_steps.append("Company profile checked")
        _lead_trace(request_id, "complete_opportunity_profile_failed", lead_id=str(lead.id), company=lead.company, reason=str(exc))

    try:
        metadata = _lead_metadata(lead)
        has_completed_research = bool(metadata.get("website_analyzed_at"))
        if (lead.website or metadata.get("domain")) and (_needs_ai_research(lead) or not has_completed_research):
            _analyze_lead_if_possible(db, user.user_id, workspace, lead, language=_workspace_language(request, workspace))
        _ensure_b2b_opportunity_metadata(lead, workspace, source="complete_opportunity")
        metadata = _lead_metadata(lead)
        if not any(metadata.get(key) for key in ("ai_summary", "opportunity_analysis", "suggested_offer", "pain_points")):
            warnings.append("AI research could not complete yet. The company is saved and can be retried.")
        else:
            _add_lead_activity(db, request, user.user_id, workspace, "website.analyzed", lead, {"source": "complete_opportunity"})
        completed_steps.append("Website analysis checked")
    except Exception as exc:
        capture_provider_exception(
            exc,
            provider="openai",
            endpoint="workspace_app.complete_opportunity.analysis",
            workspace_id=workspace.id,
            lead_id=lead.id,
            extra={"request_id": request_id},
        )
        _ensure_b2b_opportunity_metadata(lead, workspace, source="complete_opportunity_ai_fallback")
        warnings.append(_safe_provider_warning(exc))
        completed_steps.append("Website analysis checked")
        _lead_trace(request_id, "complete_opportunity_analysis_failed", lead_id=str(lead.id), company=lead.company, reason=str(exc))

    try:
        if not lead.email:
            metadata = _lead_metadata(lead)
            if hunter_key_loaded() and (lead.website or metadata.get("domain")):
                enriched = _hunter_enriched_leads(db, request, user.user_id, workspace, [_lead_out(lead)])
                if enriched:
                    before_email = lead.email
                    _apply_enriched_lead_to_record(lead, enriched[0])
                    if lead.email and lead.email != before_email:
                        _add_lead_activity(db, request, user.user_id, workspace, "contact.found", lead, {"source": "complete_opportunity"})
                if not lead.email:
                    warnings.append("No verified business email was found yet. Add a decision maker manually or continue with research.")
                    _add_lead_activity(db, request, user.user_id, workspace, "contact.search_empty", lead, {"source": "complete_opportunity"})
            else:
                lead.notes = _merge_lead_metadata(
                    lead,
                    {
                        "contact_search_checked_at": datetime.utcnow().isoformat(),
                        "contact_search_status": "needs_manual_contact",
                        "contact_search_message": "Add a decision maker email manually or connect contact discovery to continue.",
                        "decision_maker_roles_searched": list(DECISION_MAKER_TITLES),
                        "email_status": _lead_metadata(lead).get("email_status", "No verified email"),
                    },
                )
                warnings.append("Contact discovery needs setup. Add a decision maker email manually and continue.")
                _add_lead_activity(db, request, user.user_id, workspace, "contact.search_empty", lead, {"source": "complete_opportunity"})
        completed_steps.append("Contact search checked")
    except Exception as exc:
        capture_provider_exception(
            exc,
            provider="hunter",
            endpoint="workspace_app.complete_opportunity.contacts",
            workspace_id=workspace.id,
            lead_id=lead.id,
            extra={"request_id": request_id},
        )
        lead.notes = _merge_lead_metadata(
            lead,
            {
                "contact_search_checked_at": datetime.utcnow().isoformat(),
                "contact_search_status": "provider_unavailable",
                "contact_search_message": "Contact search is temporarily unavailable. Add a contact manually and continue.",
                "email_status": _lead_metadata(lead).get("email_status", "No verified email"),
            },
        )
        warnings.append("Contact search is temporarily unavailable. Add a contact manually and continue.")
        completed_steps.append("Contact search checked")
        _lead_trace(request_id, "complete_opportunity_contacts_failed", lead_id=str(lead.id), company=lead.company, reason=str(exc))

    try:
        _ensure_b2b_opportunity_metadata(lead, workspace, source="complete_opportunity_before_draft")
        email = _create_review_email_draft(db, request, user.user_id, workspace, lead)
        db.flush()
        completed_steps.append("Email draft checked")
    except Exception as exc:
        capture_provider_exception(
            exc,
            provider="openai",
            endpoint="workspace_app.complete_opportunity.email_draft",
            workspace_id=workspace.id,
            lead_id=lead.id,
            extra={"request_id": request_id},
        )
        warnings.append("Email draft could not be prepared yet. Review the company and try again.")
        completed_steps.append("Email draft checked")
        _lead_trace(request_id, "complete_opportunity_email_failed", lead_id=str(lead.id), company=lead.company, reason=str(exc))

    company = _sync_lead_to_crm(db, user.user_id, workspace, lead)
    db.commit()
    db.refresh(company)
    if email:
        db.refresh(email)
    _lead_trace(request_id, "complete_opportunity_finished", lead_id=str(lead.id), company=lead.company, warnings=len(warnings), has_email_draft=bool(email))

    return UsageActionOut(
        status="partial_success" if warnings else "success",
        message=(
            "Sales opportunity prepared with missing fields. Review the next recommended action."
            if warnings
            else "Sales opportunity prepared. Review the AI research and approve only when ready."
        ),
        company=_crm_company_out(db, workspace, user.user_id, company),
        email=EmailOut.model_validate(email) if email else None,
        warnings=warnings,
        completed_steps=completed_steps,
    )


@router.post("/emails/{email_id}/approve", response_model=UsageActionOut)
def approve_email(email_id: UUID, request: Request, user: WorkspaceUserContext, db: Session = Depends(get_db)) -> UsageActionOut:
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
def send_approved_email(email_id: UUID, request: Request, user: WorkspaceUserContext, db: Session = Depends(get_db)) -> UsageActionOut:
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
    if _is_placeholder_recipient(lead.email):
        return UsageActionOut(status="error", message="Use a real recipient email before sending.", email=EmailOut.model_validate(email))

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
