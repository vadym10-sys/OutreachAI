from __future__ import annotations

import os
import json
import hashlib
import logging
import re
from datetime import datetime, timedelta
from types import SimpleNamespace
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
    _crm_stage_for_lead,
    _company_duplicate_stmt,
    _current_workspace,
    _email_status_for_lead,
    _ensure_crm_backfilled,
    _existing_duplicate_lead,
    _hunter_enriched_leads,
    _is_customer_visible_company,
    _lead_metadata,
    _lead_out,
    _lead_trace,
    _merge_lead_metadata,
    _outreach_sender_runtime_config,
    _run_provider_with_deadline,
    _save_provider_leads,
    _settings_for_workspace,
    _sync_lead_to_crm,
    _workspace_out,
    _enforce_usage,
)
from app.core.config import get_settings
from app.core.database import get_db, get_sessionmaker
from app.core.observability import capture_provider_exception
from app.core.security import WorkspaceUserContext
from app.models.entities import AppSettings, AuditLog, Campaign, Company, Contact, Deal, EmailMessage, EnrichmentJob, Lead, LeadStatus, Workspace
from app.schemas.dto import CrmCompanyOut, EmailOut, LeadFinderRequest, LeadOut, PersonalizeRequest, WorkspaceOut
from app.services.ai import ProviderConfigurationError, ProviderRequestError, personalize_email
from app.services.emailer import EmailProviderConfigurationError, EmailProviderRequestError, send_email
from app.services.enrichment_queue import cancel_jobs_for_lead, complete_job, enqueue_company_enrichment_job, enqueue_deep_contact_search_job, mark_cancelled, update_job_progress
from app.services.google_maps import GoogleMapsConfigurationError, GoogleMapsRequestError, get_google_place_details, search_google_places
from app.services.hunter import DECISION_MAKER_TITLES, hunter_key_loaded
from app.services.deep_contact_search import normalize_domain, run_deep_contact_search
from app.services.continuous_learning import (
    DEFAULT_OPPORTUNITY_WEIGHTS,
    DEFAULT_PRIORITIZATION_WEIGHTS,
    continuous_learning_snapshot,
    continuous_learning_weights,
)
from app.services.website import normalize_website_url

logger = logging.getLogger("outreachai.workspace_app")
router = APIRouter()


UsageStatus = Literal["success", "partial_success", "empty", "provider_unavailable", "timeout", "error"]
PLACEHOLDER_EMAIL_DOMAINS = {"example.com", "example.net", "example.org", "test.com", "invalid.test"}
MAX_TURNKEY_RESEARCH_LEADS = 10
LOCALE_LANGUAGE_NAMES = {
    "en": "English",
    "en-us": "American English",
    "ru": "Russian",
    "es": "Spanish",
    "fr": "French",
    "it": "Italian",
    "pl": "Polish",
}
VISIBLE_LANGUAGE_NAMES = {
    "english": "English",
    "english (us)": "American English",
    "american english": "American English",
    "русский": "Russian",
    "russian": "Russian",
    "español": "Spanish",
    "spanish": "Spanish",
    "français": "French",
    "french": "French",
    "italiano": "Italian",
    "italian": "Italian",
    "polski": "Polish",
    "polish": "Polish",
}


class UsageCounts(BaseModel):
    leads: int = 0
    companies: int = 0
    campaigns: int = 0
    emails: int = 0
    deals: int = 0


def _language_from_locale(value: str | None) -> str:
    locale = (value or "").strip()
    if not locale:
        return ""
    normalized = locale.lower()
    if normalized in LOCALE_LANGUAGE_NAMES:
        return LOCALE_LANGUAGE_NAMES[normalized]
    if normalized in VISIBLE_LANGUAGE_NAMES:
        return VISIBLE_LANGUAGE_NAMES[normalized]
    return ""


def _workspace_language(request: Request, workspace) -> str:
    header_language = _language_from_locale(request.headers.get("x-outreachai-locale"))
    if header_language:
        return header_language
    cookie_language = _language_from_locale(request.cookies.get("outreachai_locale"))
    if cookie_language:
        return cookie_language
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


class UsageDeepContactSearchIn(BaseModel):
    force: bool = False


class UsageLeadSearchOut(BaseModel):
    status: UsageStatus
    request_id: str
    message: str
    companies_saved: int = 0
    duplicates_skipped: int = 0
    companies: list[CrmCompanyOut] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class UsageLeadCommandIn(BaseModel):
    command: str = Field(min_length=4, max_length=500)


class UsageLeadCommandOut(UsageLeadSearchOut):
    filters: Optional[LeadFinderRequest] = None
    interpreted_query: str = ""


class UsageActionOut(BaseModel):
    status: UsageStatus
    message: str
    company: Optional[CrmCompanyOut] = None
    email: Optional[EmailOut] = None
    warnings: list[str] = Field(default_factory=list)
    completed_steps: list[str] = Field(default_factory=list)
    workflow_stages: dict[str, str] = Field(default_factory=dict)
    workflow_state: dict[str, Any] = Field(default_factory=dict)
    missing_fields: list[str] = Field(default_factory=list)
    recommended_actions: list[str] = Field(default_factory=list)
    next_action: str = ""
    job_id: str = ""
    job_status: str = ""


class UsageJobStatusOut(BaseModel):
    job_id: str
    job_type: str
    status: str
    progress: dict[str, Any] = Field(default_factory=dict)
    company: Optional[CrmCompanyOut] = None


class UsageMonitoringChangeOut(BaseModel):
    company_id: UUID
    lead_id: Optional[UUID] = None
    company_name: str = ""
    detected_at: str = ""
    changes: list[dict[str, Any]] = Field(default_factory=list)
    report_regenerated: bool = False


class UsageMonitoringOut(BaseModel):
    status: UsageStatus
    message: str
    monitored_companies: int = 0
    changed_companies: int = 0
    changes: list[UsageMonitoringChangeOut] = Field(default_factory=list)


class UsageIntegrationStatus(BaseModel):
    key: str
    label: str
    status: Literal["connected", "missing_key", "needs_setup", "error"]
    message: str


class UsageIntegrationStatusOut(BaseModel):
    integrations: list[UsageIntegrationStatus]


CITY_COUNTRY_MAP = {
    "berlin": ("Berlin", "Germany"),
    "берлин": ("Berlin", "Germany"),
    "warsaw": ("Warsaw", "Poland"),
    "варшав": ("Warsaw", "Poland"),
    "warszaw": ("Warsaw", "Poland"),
    "paris": ("Paris", "France"),
    "париж": ("Paris", "France"),
    "madrid": ("Madrid", "Spain"),
    "мадрид": ("Madrid", "Spain"),
    "rome": ("Rome", "Italy"),
    "рим": ("Rome", "Italy"),
    "milan": ("Milan", "Italy"),
    "милан": ("Milan", "Italy"),
    "london": ("London", "United Kingdom"),
    "лондон": ("London", "United Kingdom"),
    "new york": ("New York", "United States"),
}

COUNTRY_ALIASES = {
    "germany": "Germany",
    "германи": "Germany",
    "deutschland": "Germany",
    "poland": "Poland",
    "польш": "Poland",
    "polska": "Poland",
    "france": "France",
    "франц": "France",
    "spain": "Spain",
    "испани": "Spain",
    "italy": "Italy",
    "итали": "Italy",
    "ukraine": "Ukraine",
    "украин": "Ukraine",
    "usa": "United States",
    "united states": "United States",
    "сша": "United States",
    "united kingdom": "United Kingdom",
    "great britain": "United Kingdom",
    "britain": "United Kingdom",
    "europe": "Poland",
    "европ": "Poland",
}

INDUSTRY_ALIASES = {
    "Construction": ["construction", "строит", "ремонт", "builders", "contractor", "budow", "renovation"],
    "SaaS": ["saas", "software", "стартап", "софт", "it company"],
    "Real estate": ["real estate", "недвиж", "property", "realtor"],
    "Marketing": ["marketing", "маркет", "agency", "агентств"],
    "Beauty & cosmetics": ["cosmetic", "cosmetics", "beauty", "skincare", "makeup", "космет", "красот", "салон красоты", "парфюм", "perfume", "spa"],
    "Dental": ["dental", "dentist", "стомат", "clinic"],
    "Restaurant": ["restaurant", "рестор", "cafe", "bar"],
    "Logistics": ["logistics", "transport", "логист", "delivery"],
    "Manufacturing": ["manufacturing", "factory", "завод", "производ"],
}

COUNTRY_DEFAULT_CITY = {
    "Germany": "Berlin",
    "Poland": "Warsaw",
    "France": "Paris",
    "Spain": "Madrid",
    "Italy": "Milan",
    "Ukraine": "Kyiv",
    "United States": "New York",
    "United Kingdom": "London",
}

INDUSTRY_SEARCH_KEYWORDS = {
    "Beauty & cosmetics": "beauty salons cosmetics stores skincare spa",
}


def _parse_lead_command(command: str, workspace) -> tuple[LeadFinderRequest | None, list[str]]:
    raw = " ".join(command.strip().split())
    normalized = raw.lower()
    missing: list[str] = []

    range_match = re.search(r"(\d{1,5})\s*[-–]\s*(\d{1,5})", normalized)
    company_size = f"{range_match.group(1)}-{range_match.group(2)}" if range_match else ""
    command_without_range = re.sub(r"\d{1,5}\s*[-–]\s*\d{1,5}", " ", normalized)
    limit_match = re.search(r"\b(\d{1,3})\b", command_without_range)
    limit = min(25, max(1, int(limit_match.group(1)))) if limit_match else 10

    city = ""
    for city_alias in CITY_COUNTRY_MAP:
        if city_alias in normalized:
            city = CITY_COUNTRY_MAP[city_alias][0]
            break

    country = ""
    for alias, canonical in COUNTRY_ALIASES.items():
        if alias in normalized:
            country = canonical
            break
    if not country and city:
        country = next((value[1] for value in CITY_COUNTRY_MAP.values() if value[0].lower() == city.lower()), "")
    if not country:
        workspace_country = (getattr(workspace, "target_country", "") or "").strip()
        country = COUNTRY_ALIASES.get(workspace_country.lower(), workspace_country)
    if country.lower() in {"europe", "eu", "европа"}:
        country = "Poland"

    industry = ""
    for canonical, aliases in INDUSTRY_ALIASES.items():
        if any(alias in normalized for alias in aliases):
            industry = canonical
            break
    if not industry:
        workspace_industry = (getattr(workspace, "industry", "") or "").strip()
        industry = next((canonical for canonical, aliases in INDUSTRY_ALIASES.items() if workspace_industry == canonical or any(alias in workspace_industry.lower() for alias in aliases)), workspace_industry)

    if not country and industry:
        country = "Poland"

    if not city and country:
        city = COUNTRY_DEFAULT_CITY.get(country, "")

    if not country:
        missing.append("country")
    if not city:
        missing.append("city")
    if not industry:
        missing.append("industry")
    if missing:
        return None, missing

    return (
        LeadFinderRequest(
            country=country,
            city=city,
            industry=industry,
            category=industry,
            keyword=INDUSTRY_SEARCH_KEYWORDS.get(industry, industry),
            company_size=company_size or None,
            employee_count=company_size or None,
            radius=10000,
            limit=limit,
        ),
        [],
    )


def _minimal_crm_company_out(company: Company) -> CrmCompanyOut:
    now = company.updated_at or company.created_at or datetime.utcnow()
    metadata = company.metadata_json or {}
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
        buying_signal_score=int(metadata["buying_signal_score"]) if str(metadata.get("buying_signal_score") or "").isdigit() else None,
        buying_signal_urgency=str(metadata.get("buying_signal_urgency") or ""),
        buying_signal_explanation=str(metadata.get("buying_signal_explanation") or ""),
        buying_signal_evidence=[item for item in metadata.get("buying_signal_evidence", []) if isinstance(item, dict)] if isinstance(metadata.get("buying_signal_evidence"), list) else [],
        buying_signal_confidence=int(metadata["buying_signal_confidence"]) if str(metadata.get("buying_signal_confidence") or "").isdigit() else None,
        recommended_outreach_timing=str(metadata.get("recommended_outreach_timing") or ""),
        email_status=company.email_status or "Not prepared",
        crm_stage=company.crm_stage or "New Lead",
        created_at=company.created_at or now,
        updated_at=now,
        found_at=company.created_at or now,
        saved_to_crm_at=company.created_at or now,
        last_activity_at=now,
        decision_maker_intelligence=metadata.get("decision_maker_intelligence") if isinstance(metadata.get("decision_maker_intelligence"), dict) else {},
        company_intelligence=metadata.get("company_intelligence") if isinstance(metadata.get("company_intelligence"), dict) else {},
    )


def _company_action_guidance(company: CrmCompanyOut) -> dict[str, Any]:
    stages = company.workflow_stages or {}
    missing: list[str] = []
    actions: list[str] = []

    def needs(stage: str) -> bool:
        return stages.get(stage) != "completed"

    if needs("website_analysis"):
        missing.append("Website analysis")
        actions.append("Run AI website analysis to fill summary, pain points, offer and outreach angle.")
    if needs("decision_maker"):
        missing.append("Decision maker")
        actions.append("Find a decision maker automatically or add the right contact manually.")
    if needs("verified_email"):
        missing.append("Verified email")
        actions.append("Search for a verified business email or add a known recipient manually.")
    if needs("ai_email"):
        missing.append("AI email")
        actions.append("Generate a personalized first email for review.")
    if needs("approval"):
        missing.append("Approval")
        actions.append("Review and approve the draft before anything is sent.")

    if not missing:
        return {
            "missing_fields": [],
            "recommended_actions": ["Review the prepared opportunity and send only after confirmation."],
            "next_action": "Review the prepared opportunity and approve the next safe action.",
        }

    return {
        "missing_fields": missing,
        "recommended_actions": actions,
        "next_action": actions[0],
    }


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
    company.ai_summary = str(metadata.get("ai_summary") or company.ai_summary or "")
    company.suggested_offer = str(metadata.get("suggested_offer") or company.suggested_offer or "")
    company.outreach_strategy = str(metadata.get("outreach_strategy") or company.outreach_strategy or "")
    company.sales_angle = str(metadata.get("sales_angle") or company.sales_angle or "")
    company.expected_reply_rate = str(metadata.get("expected_reply_rate") or company.expected_reply_rate or "")
    if metadata.get("email_status"):
        company.email_status = _email_status_for_lead(lead)
        company.crm_stage = _crm_stage_for_lead(lead)
    else:
        company.email_status = "Found" if lead.email else (company.email_status or "Not prepared")
        company.crm_stage = "Contact Found" if lead.email else (company.crm_stage or "New Lead")
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


def _set_workflow_stage(lead: Lead, key: str, status: Literal["waiting", "running", "completed", "error"], message: str = "") -> None:
    metadata = _lead_metadata(lead)
    stages = metadata.get("workflow_stages") if isinstance(metadata.get("workflow_stages"), dict) else {}
    messages = metadata.get("workflow_stage_messages") if isinstance(metadata.get("workflow_stage_messages"), dict) else {}
    stages = {**stages, key: status}
    if message:
        messages = {**messages, key: message}
    lead.notes = _merge_lead_metadata(
        lead,
        {
            "workflow_stages": stages,
            "workflow_stage_messages": messages,
        },
    )


def _set_workflow_stages(lead: Lead, updates: dict[str, Literal["waiting", "running", "completed", "error"]], messages: dict[str, str] | None = None) -> None:
    for key, status in updates.items():
        _set_workflow_stage(lead, key, status, (messages or {}).get(key, ""))


def _finalize_enrichment_workflow(db: Session, workspace, lead: Lead) -> None:
    metadata = _lead_metadata(lead)
    language = workspace.language or "English"
    has_research = bool(
        metadata.get("website_analyzed_at")
        or metadata.get("ai_summary")
        or metadata.get("opportunity_analysis")
        or metadata.get("suggested_offer")
        or metadata.get("sales_angle")
        or metadata.get("pain_points")
    )
    selected_decision_maker = metadata.get("selected_decision_maker")
    has_decision_maker = bool(lead.contact or (isinstance(selected_decision_maker, dict) and selected_decision_maker))
    has_verified_email = bool(lead.email or metadata.get("hunter_verified") or metadata.get("email_status") == "Verified")
    existing_draft = _existing_review_draft(db, workspace.id, lead.id)
    has_draft = bool(existing_draft or metadata.get("email_generated_at"))
    approval_completed = bool(existing_draft and existing_draft.delivery_status in {"approved", "sent"})

    _set_workflow_stages(
        lead,
        {
            "company_profile": "completed",
            "website_analysis": "completed" if has_research else "error",
            "decision_maker": "completed" if has_decision_maker else "error",
            "verified_email": "completed" if has_verified_email else "error",
            "ai_email": "completed" if has_draft else "error",
            "approval": "completed" if approval_completed else "waiting",
        },
        {
            "company_profile": _workflow_message(language, "workflow_company_profile"),
            "website_analysis": _workflow_message(language, "workflow_website_done") if has_research else _workflow_message(language, "workflow_website_missing"),
            "decision_maker": _workflow_message(language, "workflow_decision_done") if has_decision_maker else _workflow_message(language, "workflow_decision_missing"),
            "verified_email": _workflow_message(language, "workflow_email_verified") if has_verified_email else _workflow_message(language, "workflow_email_missing"),
            "ai_email": _workflow_message(language, "workflow_ai_email_done") if has_draft else _workflow_message(language, "workflow_ai_email_missing"),
            "approval": _workflow_message(language, "workflow_approval_done") if approval_completed else _workflow_message(language, "workflow_approval_waiting"),
        },
    )


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


def _localized_fallback_text(language: str | None, key: str, **values: str) -> str:
    normalized = (language or "English").strip().lower()
    locale = "en"
    if "russian" in normalized:
        locale = "ru"
    elif "spanish" in normalized:
        locale = "es"
    elif "french" in normalized:
        locale = "fr"
    elif "italian" in normalized:
        locale = "it"
    elif "polish" in normalized:
        locale = "pl"
    elif "ukrainian" in normalized:
        locale = "uk"
    texts: dict[str, dict[str, str]] = {
        "market": {
            "en": "its market",
            "ru": "своём рынке",
            "es": "su mercado",
            "fr": "son marché",
            "it": "il suo mercato",
            "pl": "swoim rynku",
            "uk": "своєму ринку",
        },
        "website_available": {
            "en": "website available",
            "ru": "сайт доступен",
            "es": "sitio web disponible",
            "fr": "site disponible",
            "it": "sito disponibile",
            "pl": "strona dostępna",
            "uk": "сайт доступний",
        },
        "phone_available": {
            "en": "phone available",
            "ru": "телефон доступен",
            "es": "teléfono disponible",
            "fr": "téléphone disponible",
            "it": "telefono disponibile",
            "pl": "telefon dostępny",
            "uk": "телефон доступний",
        },
        "listing_available": {
            "en": "local business listing available",
            "ru": "локальная карточка бизнеса доступна",
            "es": "ficha local disponible",
            "fr": "fiche locale disponible",
            "it": "scheda locale disponibile",
            "pl": "lokalna wizytówka dostępna",
            "uk": "локальна картка бізнесу доступна",
        },
        "rating_available": {
            "en": "public rating available",
            "ru": "публичный рейтинг доступен",
            "es": "valoración pública disponible",
            "fr": "note publique disponible",
            "it": "valutazione pubblica disponibile",
            "pl": "publiczna ocena dostępna",
            "uk": "публічний рейтинг доступний",
        },
        "summary_more_research": {
            "en": "Public profile is saved, but more research is needed before outreach.",
            "ru": "Публичный профиль сохранён, но перед обращением нужно больше исследования.",
            "es": "El perfil público está guardado, pero falta más investigación antes del contacto.",
            "fr": "Le profil public est enregistré, mais une analyse supplémentaire est nécessaire avant le contact.",
            "it": "Il profilo pubblico è salvato, ma serve più ricerca prima del contatto.",
            "pl": "Profil publiczny zapisano, ale przed kontaktem potrzebna jest dalsza analiza.",
            "uk": "Публічний профіль збережено, але перед зверненням потрібне додаткове дослідження.",
        },
        "summary": {
            "en": "{company} is a {industry} company{location}. {signals}",
            "ru": "{company} — компания в сфере {industry}{location}. {signals}",
            "es": "{company} es una empresa de {industry}{location}. {signals}",
            "fr": "{company} est une entreprise de {industry}{location}. {signals}",
            "it": "{company} è un’azienda nel settore {industry}{location}. {signals}",
            "pl": "{company} to firma z branży {industry}{location}. {signals}",
            "uk": "{company} — компанія у сфері {industry}{location}. {signals}",
        },
        "signals": {
            "en": "Verified public signals: {signals}.",
            "ru": "Проверенные публичные сигналы: {signals}.",
            "es": "Señales públicas verificadas: {signals}.",
            "fr": "Signaux publics vérifiés : {signals}.",
            "it": "Segnali pubblici verificati: {signals}.",
            "pl": "Zweryfikowane sygnały publiczne: {signals}.",
            "uk": "Перевірені публічні сигнали: {signals}.",
        },
        "location": {
            "en": " in {location}",
            "ru": " в локации {location}",
            "es": " en {location}",
            "fr": " à {location}",
            "it": " in {location}",
            "pl": " w lokalizacji {location}",
            "uk": " у локації {location}",
        },
        "sales_angle": {
            "en": "Lead with a practical {industry} growth or partnership angle based on verified public data.",
            "ru": "Начните с практичного угла роста или партнёрства в сфере {industry} на основе проверенных публичных данных.",
            "es": "Empieza con un ángulo práctico de crecimiento o alianza en {industry} basado en datos públicos verificados.",
            "fr": "Commencez par un angle concret de croissance ou partenariat en {industry}, basé sur des données publiques vérifiées.",
            "it": "Apri con un angolo pratico di crescita o partnership in {industry}, basato su dati pubblici verificati.",
            "pl": "Zacznij od praktycznego kąta wzrostu lub partnerstwa w branży {industry}, opartego na zweryfikowanych danych publicznych.",
            "uk": "Почніть з практичного кута зростання або партнерства у сфері {industry} на основі перевірених публічних даних.",
        },
        "offer": {
            "en": "Offer {offer_focus} tailored to {company}.",
            "ru": "Предложите {offer_focus}, адаптированное под {company}.",
            "es": "Ofrece {offer_focus} adaptado a {company}.",
            "fr": "Proposez {offer_focus} adapté à {company}.",
            "it": "Proponi {offer_focus} adattato a {company}.",
            "pl": "Zaproponuj {offer_focus} dopasowane do {company}.",
            "uk": "Запропонуйте {offer_focus}, адаптоване під {company}.",
        },
        "offer_focus": {
            "en": "a focused B2B partnership and outbound workflow",
            "ru": "точное B2B-партнёрство и outbound-процесс",
            "es": "una alianza B2B enfocada y un flujo outbound",
            "fr": "un partenariat B2B ciblé et un processus outbound",
            "it": "una partnership B2B mirata e un flusso outbound",
            "pl": "ukierunkowane partnerstwo B2B i proces outbound",
            "uk": "точне B2B-партнерство та outbound-процес",
        },
        "strategy": {
            "en": "Use review mode: research the company, prepare a concise email, verify the recipient, then approve before sending.",
            "ru": "Используйте режим проверки: исследуйте компанию, подготовьте короткое письмо, проверьте получателя и только потом утвердите отправку.",
            "es": "Usa modo revisión: investiga la empresa, prepara un email breve, verifica destinatario y aprueba antes de enviar.",
            "fr": "Utilisez le mode revue : analysez l’entreprise, préparez un email court, vérifiez le destinataire puis approuvez avant envoi.",
            "it": "Usa la modalità revisione: analizza l’azienda, prepara una mail breve, verifica il destinatario e approva prima dell’invio.",
            "pl": "Użyj trybu przeglądu: przeanalizuj firmę, przygotuj krótki email, zweryfikuj odbiorcę i zatwierdź przed wysyłką.",
            "uk": "Використовуйте режим перевірки: дослідіть компанію, підготуйте короткий лист, перевірте отримувача і лише потім затвердіть відправку.",
        },
        "cta": {
            "en": "Book a quick call",
            "ru": "Назначить короткий звонок",
            "es": "Agendar una llamada breve",
            "fr": "Planifier un court appel",
            "it": "Fissare una breve chiamata",
            "pl": "Umówić krótką rozmowę",
            "uk": "Призначити короткий дзвінок",
        },
        "follow_up": {
            "en": "Send two short follow-ups only after the first email is reviewed.",
            "ru": "Отправьте два коротких follow-up только после проверки первого письма.",
            "es": "Envía dos seguimientos breves solo después de revisar el primer email.",
            "fr": "Envoyez deux relances courtes seulement après revue du premier email.",
            "it": "Invia due follow-up brevi solo dopo la revisione della prima email.",
            "pl": "Wyślij dwa krótkie follow-upy dopiero po sprawdzeniu pierwszego emaila.",
            "uk": "Надішліть два короткі follow-up лише після перевірки першого листа.",
        },
        "reply_unverified": {
            "en": "4-8% until contact is verified",
            "ru": "4-8%, пока контакт не проверен",
            "es": "4-8% hasta verificar el contacto",
            "fr": "4-8% tant que le contact n’est pas vérifié",
            "it": "4-8% finché il contatto non è verificato",
            "pl": "4-8% do czasu weryfikacji kontaktu",
            "uk": "4-8%, доки контакт не перевірено",
        },
        "profile_saved": {
            "en": "Company profile saved in CRM",
            "ru": "Профиль компании сохранён в CRM",
            "es": "Perfil de empresa guardado en CRM",
            "fr": "Profil entreprise enregistré dans le CRM",
            "it": "Profilo azienda salvato nel CRM",
            "pl": "Profil firmy zapisany w CRM",
            "uk": "Профіль компанії збережено в CRM",
        },
        "risk_website": {
            "en": "Website is missing, so AI research is limited.",
            "ru": "Сайт отсутствует, поэтому AI-исследование ограничено.",
            "es": "Falta el sitio web, por eso el análisis IA es limitado.",
            "fr": "Le site manque, donc l’analyse IA est limitée.",
            "it": "Manca il sito, quindi l’analisi AI è limitata.",
            "pl": "Brakuje strony, więc analiza AI jest ograniczona.",
            "uk": "Сайт відсутній, тому AI-дослідження обмежене.",
        },
        "risk_email": {
            "en": "Verified decision-maker email is not available yet.",
            "ru": "Проверенный email лица, принимающего решение, пока недоступен.",
            "es": "Aún no hay email verificado del decisor.",
            "fr": "L’email vérifié du décideur n’est pas encore disponible.",
            "it": "L’email verificata del decision maker non è ancora disponibile.",
            "pl": "Zweryfikowany email osoby decyzyjnej nie jest jeszcze dostępny.",
            "uk": "Перевірений email особи, що приймає рішення, поки недоступний.",
        },
        "opportunity": {
            "en": "{company} can be worked as a B2B opportunity once research and contact verification are complete.",
            "ru": "{company} можно вести как B2B-возможность после завершения исследования и проверки контакта.",
            "es": "{company} puede trabajarse como oportunidad B2B cuando investigación y contacto estén completos.",
            "fr": "{company} peut devenir une opportunité B2B après analyse et vérification du contact.",
            "it": "{company} può diventare un’opportunità B2B dopo analisi e verifica del contatto.",
            "pl": "{company} może być szansą B2B po analizie i weryfikacji kontaktu.",
            "uk": "{company} можна вести як B2B-можливість після дослідження та перевірки контакту.",
        },
        "fit": {
            "en": "Potential fit for {offer_focus} if the company matches the workspace ICP.",
            "ru": "Потенциально подходит для {offer_focus}, если компания совпадает с ICP пространства.",
            "es": "Encaje potencial para {offer_focus} si coincide con el ICP del workspace.",
            "fr": "Fit potentiel pour {offer_focus} si l’entreprise correspond à l’ICP.",
            "it": "Fit potenziale per {offer_focus} se l’azienda coincide con l’ICP.",
            "pl": "Potencjalne dopasowanie do {offer_focus}, jeśli firma pasuje do ICP workspace.",
            "uk": "Потенційно підходить для {offer_focus}, якщо компанія відповідає ICP простору.",
        },
        "next_email": {
            "en": "Review and approve the generated email.",
            "ru": "Проверьте и утвердите сгенерированное письмо.",
            "es": "Revisa y aprueba el email generado.",
            "fr": "Relisez et approuvez l’email généré.",
            "it": "Rivedi e approva l’email generata.",
            "pl": "Sprawdź i zatwierdź wygenerowany email.",
            "uk": "Перевірте та затвердьте згенерований лист.",
        },
        "next_contact": {
            "en": "Find or add a verified decision-maker email before sending.",
            "ru": "Найдите или добавьте проверенный email лица, принимающего решение, перед отправкой.",
            "es": "Busca o añade un email verificado del decisor antes de enviar.",
            "fr": "Trouvez ou ajoutez l’email vérifié du décideur avant l’envoi.",
            "it": "Trova o aggiungi l’email verificata del decision maker prima dell’invio.",
            "pl": "Znajdź lub dodaj zweryfikowany email osoby decyzyjnej przed wysyłką.",
            "uk": "Знайдіть або додайте перевірений email особи, що приймає рішення, перед відправкою.",
        },
        "workflow_company_profile": {
            "en": "Saved company profile and public business data.",
            "ru": "Профиль компании и публичные бизнес-данные сохранены.",
            "es": "Perfil de empresa y datos públicos guardados.",
            "fr": "Profil entreprise et données publiques enregistrés.",
            "it": "Profilo azienda e dati pubblici salvati.",
            "pl": "Profil firmy i dane publiczne zapisane.",
            "uk": "Профіль компанії та публічні бізнес-дані збережено.",
        },
        "workflow_website_done": {
            "en": "AI summary, services, sales angle, offer and useful personalization facts.",
            "ru": "AI подготовил резюме, услуги, угол продажи, предложение и полезные факты для персонализации.",
            "es": "IA preparó resumen, servicios, ángulo comercial, oferta y datos útiles de personalización.",
            "fr": "L’IA a préparé résumé, services, angle commercial, offre et faits utiles de personnalisation.",
            "it": "AI ha preparato riepilogo, servizi, angolo vendita, offerta e dati utili per personalizzare.",
            "pl": "AI przygotowała podsumowanie, usługi, kąt sprzedaży, ofertę i fakty do personalizacji.",
            "uk": "AI підготував резюме, послуги, кут продажу, пропозицію та факти для персоналізації.",
        },
        "workflow_website_missing": {
            "en": "Run website analysis to fill summary, pain points and opportunity angle.",
            "ru": "Запустите анализ сайта, чтобы заполнить резюме, боли и угол возможности.",
            "es": "Ejecuta análisis del sitio para completar resumen, dolores y ángulo de oportunidad.",
            "fr": "Lancez l’analyse du site pour compléter résumé, douleurs et angle d’opportunité.",
            "it": "Esegui analisi del sito per completare riepilogo, pain point e angolo opportunità.",
            "pl": "Uruchom analizę strony, aby uzupełnić podsumowanie, problemy i kąt szansy.",
            "uk": "Запустіть аналіз сайту, щоб заповнити резюме, болі та кут можливості.",
        },
        "workflow_decision_done": {
            "en": "Decision maker selected.",
            "ru": "Лицо, принимающее решение, выбрано.",
            "es": "Decisor seleccionado.",
            "fr": "Décideur sélectionné.",
            "it": "Decision maker selezionato.",
            "pl": "Osoba decyzyjna wybrana.",
            "uk": "Особу, що приймає рішення, вибрано.",
        },
        "workflow_decision_missing": {
            "en": "Find a decision maker or add the right contact manually.",
            "ru": "Найдите лицо, принимающее решение, или добавьте правильный контакт вручную.",
            "es": "Busca un decisor o añade el contacto correcto manualmente.",
            "fr": "Trouvez un décideur ou ajoutez le bon contact manuellement.",
            "it": "Trova un decision maker o aggiungi manualmente il contatto giusto.",
            "pl": "Znajdź osobę decyzyjną albo dodaj właściwy kontakt ręcznie.",
            "uk": "Знайдіть особу, що приймає рішення, або додайте правильний контакт вручну.",
        },
        "workflow_email_verified": {
            "en": "Verified business email saved.",
            "ru": "Проверенный рабочий email сохранён.",
            "es": "Email empresarial verificado guardado.",
            "fr": "Email professionnel vérifié enregistré.",
            "it": "Email aziendale verificata salvata.",
            "pl": "Zweryfikowany email biznesowy zapisany.",
            "uk": "Перевірений робочий email збережено.",
        },
        "workflow_email_missing": {
            "en": "Find a verified email or add a known business email manually.",
            "ru": "Найдите проверенный email или добавьте известный рабочий email вручную.",
            "es": "Busca un email verificado o añade manualmente un email empresarial conocido.",
            "fr": "Trouvez un email vérifié ou ajoutez manuellement un email professionnel connu.",
            "it": "Trova un’email verificata o aggiungi manualmente un’email aziendale nota.",
            "pl": "Znajdź zweryfikowany email albo dodaj znany email biznesowy ręcznie.",
            "uk": "Знайдіть перевірений email або додайте відомий робочий email вручну.",
        },
        "workflow_ai_email_done": {
            "en": "A personalized first email generated from the company research.",
            "ru": "Первое персональное письмо создано на основе исследования компании.",
            "es": "Primer email personalizado generado a partir de la investigación.",
            "fr": "Premier email personnalisé généré à partir de l’analyse entreprise.",
            "it": "Prima email personalizzata generata dalla ricerca aziendale.",
            "pl": "Pierwszy spersonalizowany email wygenerowany na podstawie analizy firmy.",
            "uk": "Перший персональний лист створено на основі дослідження компанії.",
        },
        "workflow_ai_email_missing": {
            "en": "Generate a personalized email for review. Sending stays blocked until approval.",
            "ru": "Создайте персональное письмо для проверки. Отправка заблокирована до утверждения.",
            "es": "Genera un email personalizado para revisar. El envío queda bloqueado hasta aprobar.",
            "fr": "Générez un email personnalisé à relire. L’envoi reste bloqué jusqu’à approbation.",
            "it": "Genera un’email personalizzata da rivedere. L’invio resta bloccato fino ad approvazione.",
            "pl": "Wygeneruj spersonalizowany email do sprawdzenia. Wysyłka jest zablokowana do akceptacji.",
            "uk": "Створіть персональний лист для перевірки. Відправка заблокована до затвердження.",
        },
        "workflow_approval_done": {
            "en": "Human review completed. The email is ready to send.",
            "ru": "Проверка человеком завершена. Письмо готово к отправке.",
            "es": "Revisión humana completada. El email está listo para enviar.",
            "fr": "Revue humaine terminée. L’email est prêt à être envoyé.",
            "it": "Revisione umana completata. L’email è pronta per l’invio.",
            "pl": "Weryfikacja człowieka zakończona. Email jest gotowy do wysyłki.",
            "uk": "Перевірка людиною завершена. Лист готовий до відправки.",
        },
        "workflow_approval_waiting": {
            "en": "Review the draft, edit it if needed, then approve before sending.",
            "ru": "Проверьте черновик, при необходимости отредактируйте и утвердите перед отправкой.",
            "es": "Revisa el borrador, edítalo si hace falta y aprueba antes de enviar.",
            "fr": "Relisez le brouillon, modifiez-le si besoin puis approuvez avant l’envoi.",
            "it": "Rivedi la bozza, modificala se serve e approva prima dell’invio.",
            "pl": "Sprawdź szkic, popraw go w razie potrzeby i zatwierdź przed wysyłką.",
            "uk": "Перевірте чернетку, за потреби відредагуйте й затвердіть перед відправкою.",
        },
        "source_ai_research": {
            "en": "AI website research",
            "ru": "AI-исследование сайта",
            "es": "Investigación IA del sitio",
            "fr": "Analyse IA du site",
            "it": "Analisi AI del sito",
            "pl": "Analiza strony przez AI",
            "uk": "AI-дослідження сайту",
        },
        "source_verified_contact": {
            "en": "Verified decision-maker contact",
            "ru": "Проверенный контакт лица, принимающего решение",
            "es": "Contacto verificado del decisor",
            "fr": "Contact décideur vérifié",
            "it": "Contatto verificato del decision maker",
            "pl": "Zweryfikowany kontakt osoby decyzyjnej",
            "uk": "Перевірений контакт особи, що приймає рішення",
        },
        "source_technology": {
            "en": "Technology profile",
            "ru": "Технологический профиль",
            "es": "Perfil tecnológico",
            "fr": "Profil technologique",
            "it": "Profilo tecnologico",
            "pl": "Profil technologiczny",
            "uk": "Технологічний профіль",
        },
        "gap_decision": {
            "en": "Decision maker is not verified yet.",
            "ru": "Лицо, принимающее решение, пока не проверено.",
            "es": "El decisor aún no está verificado.",
            "fr": "Le décideur n’est pas encore vérifié.",
            "it": "Il decision maker non è ancora verificato.",
            "pl": "Osoba decyzyjna nie jest jeszcze zweryfikowana.",
            "uk": "Особа, що приймає рішення, поки не перевірена.",
        },
        "gap_technology": {
            "en": "Technology stack is unavailable until a technographic source is connected.",
            "ru": "Технологический стек недоступен, пока не подключён технографический источник.",
            "es": "El stack tecnológico no está disponible hasta conectar una fuente tecnográfica.",
            "fr": "La stack technologique est indisponible tant qu’une source technographique n’est pas connectée.",
            "it": "Lo stack tecnologico non è disponibile finché non viene collegata una fonte tecnografica.",
            "pl": "Stack technologiczny jest niedostępny, dopóki nie podłączysz źródła technograficznego.",
            "uk": "Технологічний стек недоступний, доки не підключено технографічне джерело.",
        },
        "coverage_ready": {
            "en": "Enough verified context for a sales review.",
            "ru": "Достаточно проверенного контекста для проверки продажи.",
            "es": "Hay suficiente contexto verificado para una revisión comercial.",
            "fr": "Contexte vérifié suffisant pour une revue commerciale.",
            "it": "Contesto verificato sufficiente per una revisione commerciale.",
            "pl": "Wystarczający zweryfikowany kontekst do przeglądu sprzedażowego.",
            "uk": "Достатньо перевіреного контексту для перевірки продажу.",
        },
        "coverage_partial": {
            "en": "Useful starter brief; connect or verify the missing data before sending outreach.",
            "ru": "Полезный стартовый brief; подключите или проверьте недостающие данные перед отправкой.",
            "es": "Brief inicial útil; conecta o verifica los datos faltantes antes de enviar outreach.",
            "fr": "Brief initial utile ; connectez ou vérifiez les données manquantes avant l’envoi.",
            "it": "Brief iniziale utile; collega o verifica i dati mancanti prima dell’invio.",
            "pl": "Przydatny brief startowy; podłącz lub zweryfikuj brakujące dane przed wysyłką.",
            "uk": "Корисний стартовий brief; підключіть або перевірте відсутні дані перед відправкою.",
        },
        "confidence_high": {
            "en": "High confidence because company research and a verified contact are available.",
            "ru": "Высокая уверенность: есть исследование компании и проверенный контакт.",
            "es": "Alta confianza porque hay investigación de empresa y contacto verificado.",
            "fr": "Confiance élevée : analyse entreprise et contact vérifié disponibles.",
            "it": "Alta confidenza perché sono disponibili ricerca aziendale e contatto verificato.",
            "pl": "Wysoka pewność, bo dostępna jest analiza firmy i zweryfikowany kontakt.",
            "uk": "Висока впевненість: є дослідження компанії та перевірений контакт.",
        },
        "confidence_limited": {
            "en": "Confidence is limited by missing verified contact or website research.",
            "ru": "Уверенность ограничена из-за отсутствия проверенного контакта или исследования сайта.",
            "es": "La confianza está limitada por falta de contacto verificado o análisis del sitio.",
            "fr": "La confiance est limitée par l’absence de contact vérifié ou d’analyse du site.",
            "it": "La confidenza è limitata dalla mancanza di contatto verificato o analisi sito.",
            "pl": "Pewność ogranicza brak zweryfikowanego kontaktu albo analizy strony.",
            "uk": "Впевненість обмежена через відсутність перевіреного контакту або аналізу сайту.",
        },
        "provider_improve_company": {
            "en": "Connect company enrichment to improve firmographics and decision-maker coverage.",
            "ru": "Подключите обогащение компаний, чтобы улучшить фирмографику и покрытие decision makers.",
            "es": "Conecta enriquecimiento de empresas para mejorar firmografía y decisores.",
            "fr": "Connectez l’enrichissement entreprise pour améliorer firmographie et décideurs.",
            "it": "Collega enrichment aziende per migliorare firmografia e decision maker.",
            "pl": "Podłącz enrichment firm, aby poprawić firmografię i osoby decyzyjne.",
            "uk": "Підключіть збагачення компаній, щоб покращити фірмографіку та decision makers.",
        },
        "provider_improve_contact": {
            "en": "Connect contact verification to increase email confidence.",
            "ru": "Подключите проверку контактов, чтобы повысить уверенность в email.",
            "es": "Conecta verificación de contactos para aumentar confianza en email.",
            "fr": "Connectez la vérification des contacts pour augmenter la confiance email.",
            "it": "Collega verifica contatti per aumentare confidenza email.",
            "pl": "Podłącz weryfikację kontaktów, aby zwiększyć pewność emaila.",
            "uk": "Підключіть перевірку контактів, щоб підвищити впевненість в email.",
        },
        "provider_improve_tech": {
            "en": "Connect technographic enrichment to personalize the sales angle by website stack.",
            "ru": "Подключите технографическое обогащение, чтобы персонализировать угол продажи по стеку сайта.",
            "es": "Conecta enriquecimiento tecnográfico para personalizar el ángulo por stack del sitio.",
            "fr": "Connectez l’enrichissement technographique pour personnaliser l’angle selon la stack.",
            "it": "Collega enrichment tecnografico per personalizzare l’angolo in base allo stack.",
            "pl": "Podłącz enrichment technograficzny, aby personalizować kąt według stacku strony.",
            "uk": "Підключіть технографічне збагачення, щоб персоналізувати кут за стеком сайту.",
        },
        "enrichment_stopped": {
            "en": "Automatic enrichment was stopped.",
            "ru": "Автоматическое обогащение остановлено.",
            "es": "Enriquecimiento automático detenido.",
            "fr": "Enrichissement automatique arrêté.",
            "it": "Enrichment automatico fermato.",
            "pl": "Automatyczne enrichment zatrzymane.",
            "uk": "Автоматичне збагачення зупинено.",
        },
        "enrichment_cache": {
            "en": "Recent company intelligence reused from CRM cache.",
            "ru": "Свежие данные Company Intelligence взяты из кеша CRM.",
            "es": "Inteligencia reciente reutilizada desde caché CRM.",
            "fr": "Intelligence entreprise récente réutilisée depuis le cache CRM.",
            "it": "Company intelligence recente riutilizzata dalla cache CRM.",
            "pl": "Najnowsza inteligencja firmy użyta ponownie z cache CRM.",
            "uk": "Свіжі дані Company Intelligence взято з кешу CRM.",
        },
        "enrichment_completed": {
            "en": "Automatic enrichment completed.",
            "ru": "Автоматическое обогащение завершено.",
            "es": "Enriquecimiento automático completado.",
            "fr": "Enrichissement automatique terminé.",
            "it": "Enrichment automatico completato.",
            "pl": "Automatyczne enrichment zakończone.",
            "uk": "Автоматичне збагачення завершено.",
        },
        "enrichment_partial": {
            "en": "Automatic enrichment finished with missing fields.",
            "ru": "Автоматическое обогащение завершилось, но часть полей отсутствует.",
            "es": "Enriquecimiento automático terminado con campos faltantes.",
            "fr": "Enrichissement automatique terminé avec des champs manquants.",
            "it": "Enrichment automatico terminato con campi mancanti.",
            "pl": "Automatyczne enrichment zakończone z brakującymi polami.",
            "uk": "Автоматичне збагачення завершилося, але частина полів відсутня.",
        },
        "enrichment_failed": {
            "en": "Automatic enrichment could not finish. Retry from the company card.",
            "ru": "Автоматическое обогащение не завершилось. Повторите из карточки компании.",
            "es": "El enriquecimiento automático no pudo terminar. Reintenta desde la ficha.",
            "fr": "L’enrichissement automatique n’a pas pu finir. Réessayez depuis la fiche.",
            "it": "L’enrichment automatico non è terminato. Riprova dalla scheda azienda.",
            "pl": "Automatyczne enrichment nie zakończyło się. Spróbuj ponownie z karty firmy.",
            "uk": "Автоматичне збагачення не завершилося. Повторіть із картки компанії.",
        },
        "progress_ai_analyzing": {
            "en": "AI is analyzing the company and website.",
            "ru": "AI анализирует компанию и сайт.",
            "es": "IA analiza la empresa y el sitio.",
            "fr": "L’IA analyse l’entreprise et le site.",
            "it": "AI sta analizzando azienda e sito.",
            "pl": "AI analizuje firmę i stronę.",
            "uk": "AI аналізує компанію та сайт.",
        },
        "pain_manual": {
            "en": "Manual prospect research takes time.",
            "ru": "Ручное исследование потенциальных клиентов занимает время.",
            "es": "La investigación manual de prospectos lleva tiempo.",
            "fr": "La recherche manuelle de prospects prend du temps.",
            "it": "La ricerca manuale dei prospect richiede tempo.",
            "pl": "Ręczne badanie prospectów zajmuje czas.",
            "uk": "Ручне дослідження потенційних клієнтів займає час.",
        },
        "pain_context": {
            "en": "Personal outreach needs verified company context.",
            "ru": "Персональное обращение требует проверенного контекста компании.",
            "es": "El outreach personal necesita contexto verificado de la empresa.",
            "fr": "L’outreach personnalisé nécessite un contexte d’entreprise vérifié.",
            "it": "L’outreach personale richiede contesto aziendale verificato.",
            "pl": "Personalizowany outreach wymaga zweryfikowanego kontekstu firmy.",
            "uk": "Персональне звернення потребує перевіреного контексту компанії.",
        },
    }
    template = texts.get(key, {}).get(locale) or texts.get(key, {}).get("en") or ""
    return template.format(**values)


def _is_generic_sales_fallback(value) -> bool:
    if not value:
        return False
    if isinstance(value, list):
        return any(_is_generic_sales_fallback(item) for item in value)
    if not isinstance(value, str):
        return False
    markers = (
        "Verified public signals:",
        "Public profile is saved",
        "Lead with a practical",
        "growth or partnership angle based on verified public data",
        "tailored to",
        "Use review mode: research the company",
        "Book a quick call",
        "Send two short follow-ups",
        "until contact is verified",
        "Company profile saved in CRM",
        "Website is missing, so AI research is limited.",
        "Verified decision-maker email is not available yet.",
        "can be worked as a B2B opportunity",
        "Potential fit for",
        "Review and approve the generated email.",
        "Find or add a verified decision-maker email before sending.",
        "Manual prospect research takes time.",
        "Personal outreach needs verified company context.",
    )
    return any(marker in value for marker in markers)


def _sales_metadata_value(metadata: dict, key: str, fallback):
    current = metadata.get(key)
    if not current or _is_generic_sales_fallback(current):
        return fallback
    return current


def _workflow_message(language: str | None, key: str) -> str:
    return _localized_fallback_text(language, key)


def _company_intelligence_quality(lead: Lead, metadata: dict, workspace, source: str, language: str) -> dict[str, Any]:
    has_website = bool(lead.website or metadata.get("domain"))
    has_email = bool(lead.email)
    has_contact = bool(lead.contact or metadata.get("contact_search_status") == "verified_email_found")
    has_analysis = bool(metadata.get("ai_summary") or metadata.get("opportunity_analysis") or metadata.get("suggested_offer"))
    technologies = metadata.get("technologies") if isinstance(metadata.get("technologies"), list) else []
    deep_contact = metadata.get("deep_contact_search") if isinstance(metadata.get("deep_contact_search"), dict) else {}

    used_sources = [
        _localized_fallback_text(language, "profile_saved"),
        _localized_fallback_text(language, "website_available") if has_website else "",
        _localized_fallback_text(language, "source_ai_research") if has_analysis else "",
        _localized_fallback_text(language, "source_verified_contact") if has_email else "",
        _localized_fallback_text(language, "source_technology") if technologies or deep_contact.get("technologies") else "",
    ]
    used_sources = [item for item in used_sources if item]
    gaps = [
        _localized_fallback_text(language, "risk_website") if not has_website else "",
        _localized_fallback_text(language, "risk_email") if not has_email else "",
        _localized_fallback_text(language, "gap_decision") if not has_contact else "",
        _localized_fallback_text(language, "gap_technology") if not technologies and not deep_contact.get("technologies") else "",
    ]
    gaps = [item for item in gaps if item]
    score = int(metadata.get("confidence_score") or (82 if has_website and has_email and has_analysis else 68 if has_website and has_analysis else 52 if has_website else 38))
    if gaps:
        score = max(20, min(score, 88 - len(gaps) * 8))
    basis = [
        "Company profile is saved and scoped to this workspace.",
        "Website context supports personalization." if has_website else "",
        "AI research explains the sales angle." if has_analysis else "",
        "Verified email makes outreach actionable." if has_email else "",
    ]
    basis = [item for item in basis if item]
    return {
        "source": source,
        "used_sources": used_sources,
        "decision_basis": basis,
        "gaps": gaps,
        "coverage_summary": (
            _localized_fallback_text(language, "coverage_ready")
            if has_analysis and has_email
            else _localized_fallback_text(language, "coverage_partial")
        ),
        "confidence_reason": (
            _localized_fallback_text(language, "confidence_high")
            if has_analysis and has_email
            else _localized_fallback_text(language, "confidence_limited")
        ),
        "provider_improvements": [
            _localized_fallback_text(language, "provider_improve_company"),
            _localized_fallback_text(language, "provider_improve_contact"),
            _localized_fallback_text(language, "provider_improve_tech"),
        ],
        "confidence_score": score,
    }


def _dedupe_text_values(values: list[Any]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        text = str(value or "").strip()
        if not text:
            continue
        key = re.sub(r"\s+", " ", text).lower()
        if key in seen:
            continue
        seen.add(key)
        result.append(text)
    return result


def _intelligence_field(value: Any, *, source: str, confidence: int) -> dict[str, Any]:
    present = _metadata_value_present(value)
    return {
        "value": value if present else None,
        "source": source if present else "",
        "confidence": max(0, min(100, int(confidence if present else 0))),
    }


def _safe_score(value: Any, default: int = 0) -> int:
    if value is None:
        return default
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, (int, float)):
        return max(0, min(100, int(value)))
    text = str(value).strip().lower()
    if not text or text in {"unknown", "none", "null", "неизвестно", "n/a"}:
        return default
    match = re.search(r"-?\d+(?:[.,]\d+)?", text.replace(" ", ""))
    if not match:
        return default
    try:
        return max(0, min(100, int(float(match.group(0).replace(",", ".")))))
    except ValueError:
        return default


def _report_field(value: Any, *, sources: list[str], confidence: int) -> dict[str, Any]:
    present = _metadata_value_present(value)
    return {
        "value": value if present else None,
        "source": _dedupe_text_values(sources)[0] if present and sources else "",
        "confidence": max(0, min(100, int(confidence if present else 0))),
        "sources": _dedupe_text_values(sources) if present else [],
    }


def _metadata_texts(value: Any) -> list[str]:
    if isinstance(value, str):
        text = value.strip()
        return [text] if text else []
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item or "").strip()]
    return []


def _intent_evidence(signal: str, source_field: str, value: str, confidence: int) -> dict[str, Any]:
    return {
        "signal": signal,
        "source_field": source_field,
        "value": value,
        "confidence": max(0, min(100, int(confidence))),
    }


def _decision_evidence(source_field: str, value: str, confidence: int) -> dict[str, Any]:
    return {
        "source_field": source_field,
        "value": value,
        "confidence": max(0, min(100, int(confidence))),
    }


def _title_contains(title: str, keywords: list[str]) -> bool:
    lowered = (title or "").strip().lower()
    if not lowered:
        return False
    return any(keyword in lowered for keyword in keywords)


def _authority_level(title: str) -> str:
    if _title_contains(title, ["ceo", "founder", "owner", "president"]):
        return "executive"
    if _title_contains(title, ["chief", "vp", "vice president", "head", "director"]):
        return "senior"
    if _title_contains(title, ["manager", "lead"]):
        return "manager"
    return "unknown"


def _contact_decision_maker_intelligence(
    contact: Contact,
    *,
    company: Company,
    lead: Lead | None,
    deep_contact: dict[str, Any],
    company_intelligence: dict[str, Any],
) -> dict[str, Any]:
    contact_metadata = contact.metadata_json if isinstance(contact.metadata_json, dict) else {}
    title = str(contact.title or "").strip()
    is_selected = bool(contact_metadata.get("selected_decision_maker"))
    authority_level = _authority_level(title)
    evidence: list[dict[str, Any]] = []

    if title:
        evidence.append(_decision_evidence("contact.title", title, 88))
    if contact.email_status == "Verified" and contact.email:
        evidence.append(_decision_evidence("contact.email_status", "Verified business email", 92))
    if contact.linkedin:
        evidence.append(_decision_evidence("contact.linkedin", contact.linkedin, 76))
    reason = str(contact_metadata.get("reason") or "").strip()
    if reason:
        evidence.append(_decision_evidence("deep_contact_search.selected_decision_maker.reason", reason, 82))
    profile = deep_contact.get("company_profile") if isinstance(deep_contact.get("company_profile"), dict) else {}
    if profile.get("industry"):
        evidence.append(_decision_evidence("deep_contact_search.company_profile.industry", str(profile.get("industry")), 70))

    why_best = (
        "Top-ranked decision maker with verified contact path."
        if is_selected and contact.email_status == "Verified"
        else "Role alignment suggests strong decision influence."
    )
    if reason:
        why_best = f"{why_best} {reason}"

    responsibilities: list[str] = []
    goals: list[str] = []
    kpis: list[str] = []
    pain_points: list[str] = []
    communication_style = "Professional and concise"
    outreach_angle = "Lead with measurable business outcomes"

    if _title_contains(title, ["ceo", "founder", "owner", "president"]):
        responsibilities.extend(["Company strategy", "Budget allocation", "Revenue growth decisions"])
        goals.extend(["Sustainable revenue growth", "Market expansion", "Operational efficiency"])
        kpis.extend(["Revenue growth rate", "Gross margin", "Pipeline velocity"])
        pain_points.extend(["Limited high-quality pipeline", "Unpredictable outbound performance"])
        communication_style = "Executive-level, outcome-first"
        outreach_angle = "Show revenue impact and execution speed"
    elif _title_contains(title, ["sales", "vp sales", "cro", "head of sales", "sales director"]):
        responsibilities.extend(["Pipeline generation", "Quota attainment", "Team performance"])
        goals.extend(["Increase qualified pipeline", "Improve win rate", "Reduce sales cycle"])
        kpis.extend(["SQL volume", "Win rate", "Sales cycle length", "Quota attainment"])
        pain_points.extend(["Low intent lead quality", "Rep productivity constraints"])
        communication_style = "Direct and metric-driven"
        outreach_angle = "Improve pipeline quality and conversion efficiency"
    elif _title_contains(title, ["marketing", "cmo", "head of marketing", "marketing director"]):
        responsibilities.extend(["Demand generation", "Campaign performance", "Funnel efficiency"])
        goals.extend(["Increase qualified demand", "Improve CAC efficiency", "Raise campaign ROI"])
        kpis.extend(["MQL-to-SQL conversion", "CAC", "Pipeline contribution"])
        pain_points.extend(["Lead quality inconsistency", "Attribution pressure"])
        communication_style = "Insight-led and data-backed"
        outreach_angle = "Boost qualified demand without increasing acquisition waste"
    elif _title_contains(title, ["coo", "operations", "ops"]):
        responsibilities.extend(["Operational process quality", "Cross-team execution", "Resource efficiency"])
        goals.extend(["Improve workflow reliability", "Scale processes efficiently"])
        kpis.extend(["Process cycle time", "Cost per outcome", "Team throughput"])
        pain_points.extend(["Manual pipeline operations", "Inconsistent execution"])
        communication_style = "Structured and practical"
        outreach_angle = "Reduce operational friction in go-to-market workflows"
    else:
        responsibilities.extend(["Department planning", "Vendor evaluation"])
        goals.extend(["Reliable team outcomes", "Better decision speed"])
        kpis.extend(["Target attainment", "Execution consistency"])
        pain_points.extend(["Limited time for vendor evaluation"])

    responsibilities = _dedupe_text_values(responsibilities)
    goals = _dedupe_text_values(goals)
    kpis = _dedupe_text_values(kpis)
    pain_points = _dedupe_text_values(pain_points)

    company_name = company.name or (lead.company if lead else "this company") or "this company"
    first_sentence = (
        f"Noticed your role as {title or 'a key decision maker'} at {company_name} and wanted to share a quick idea to improve qualified pipeline outcomes."
    )

    base_confidence = 52
    base_confidence += 18 if title else 0
    base_confidence += 15 if contact.email_status == "Verified" else 0
    base_confidence += 8 if is_selected else 0
    base_confidence += 7 if contact.linkedin else 0
    base_confidence += 6 if reason else 0
    confidence = _safe_score(base_confidence)

    return {
        "contact_id": str(contact.id),
        "name": contact.name,
        "title": title,
        "is_verified_contact": bool(contact.email and contact.email_status == "Verified"),
        "why_best_decision_maker": why_best,
        "estimated_responsibilities": responsibilities,
        "probable_business_goals": goals,
        "likely_kpis": kpis,
        "possible_pain_points": pain_points,
        "communication_style": communication_style,
        "preferred_outreach_angle": outreach_angle,
        "recommended_first_sentence": first_sentence,
        "estimated_authority_level": authority_level,
        "confidence_score": confidence,
        "evidence_used": evidence,
    }


def _build_decision_maker_intelligence(
    *,
    lead: Lead,
    company: Company | None,
    contacts: list[Contact],
    metadata: dict[str, Any],
    company_intelligence: dict[str, Any],
) -> dict[str, Any]:
    deep_contact = metadata.get("deep_contact_search") if isinstance(metadata.get("deep_contact_search"), dict) else {}
    verified_contacts = [
        contact
        for contact in contacts
        if bool(contact.email) and str(contact.email_status or "").lower() == "verified"
    ]

    profiles = [
        _contact_decision_maker_intelligence(
            contact,
            company=company if company is not None else Company(name=lead.company or ""),
            lead=lead,
            deep_contact=deep_contact,
            company_intelligence=company_intelligence,
        )
        for contact in verified_contacts
    ]

    profiles.sort(key=lambda item: int(item.get("confidence_score") or 0), reverse=True)
    return {
        "generated_at": datetime.utcnow().isoformat(),
        "profiles": profiles,
        "top_contact_id": str(profiles[0]["contact_id"]) if profiles else None,
    }


def _numeric_from_size(value: Any) -> int | None:
    if isinstance(value, (int, float)):
        return max(0, int(value))
    text = str(value or "").strip().lower()
    if not text:
        return None
    numbers = [int(item) for item in re.findall(r"\d+", text)]
    if not numbers:
        return None
    if len(numbers) == 1:
        return numbers[0]
    return int(sum(numbers[:2]) / 2)


def _opportunity_ranking(
    *,
    lead: Lead,
    metadata: dict[str, Any],
    workspace,
    company: Company | None,
    contacts: list[Contact],
    company_intelligence: dict[str, Any],
    decision_maker_intelligence: dict[str, Any],
    opportunity_weights: dict[str, float] | None = None,
) -> dict[str, Any]:
    factor_scores: dict[str, int] = {}
    factor_reasons: dict[str, list[str]] = {}

    buying_intent = company_intelligence.get("buying_intent") if isinstance(company_intelligence.get("buying_intent"), dict) else {}
    buying_score = _safe_score(buying_intent.get("buying_signal_score"), 0)
    factor_scores["Buying Intent"] = buying_score
    factor_reasons["Buying Intent"] = _dedupe_text_values([
        str(buying_intent.get("explanation") or ""),
        *(str(item.get("value") or "") for item in buying_intent.get("evidence", []) if isinstance(item, dict)),
    ])

    ci_fields = company_intelligence.get("fields") if isinstance(company_intelligence.get("fields"), dict) else {}
    ci_present = sum(1 for value in ci_fields.values() if isinstance(value, dict) and _metadata_value_present(value.get("value")))
    ci_total = max(1, len(ci_fields))
    ci_score = _safe_score(round(ci_present * 100 / ci_total), 0)
    factor_scores["Company Intelligence"] = ci_score
    factor_reasons["Company Intelligence"] = [f"{ci_present}/{ci_total} intelligence fields populated from enrichment."]

    profiles = decision_maker_intelligence.get("profiles") if isinstance(decision_maker_intelligence.get("profiles"), list) else []
    top_profile = profiles[0] if profiles and isinstance(profiles[0], dict) else {}
    dm_score = _safe_score(top_profile.get("confidence_score"), 0)
    factor_scores["Decision Maker Quality"] = dm_score
    factor_reasons["Decision Maker Quality"] = _dedupe_text_values([
        str(top_profile.get("why_best_decision_maker") or ""),
        *(str(item.get("value") or "") for item in top_profile.get("evidence_used", []) if isinstance(item, dict)),
    ])

    technologies = metadata.get("technologies") if isinstance(metadata.get("technologies"), list) else []
    technologies = _dedupe_text_values(technologies)
    tech_score = _safe_score(70 if technologies else 25)
    if technologies:
        workspace_context = f"{getattr(workspace, 'company', '')} {getattr(workspace, 'target_customer', '')}".lower()
        if workspace_context and any(term.lower() in workspace_context for term in technologies):
            tech_score = _safe_score(85)
    factor_scores["Technology Match"] = tech_score
    factor_reasons["Technology Match"] = technologies[:4] if technologies else ["No technology enrichment data captured."]

    size_value = metadata.get("estimated_company_size") or metadata.get("employee_count") or metadata.get("employees")
    size_numeric = _numeric_from_size(size_value)
    if size_numeric is None:
        size_score = 35
    elif 20 <= size_numeric <= 500:
        size_score = 82
    elif 10 <= size_numeric <= 1000:
        size_score = 72
    else:
        size_score = 58
    factor_scores["Company Size"] = _safe_score(size_score)
    factor_reasons["Company Size"] = [str(size_value)] if _metadata_value_present(size_value) else ["Company size not enriched yet."]

    hiring_values = _dedupe_text_values([
        *(_metadata_texts(metadata.get("hiring_signals"))),
        *(_metadata_texts(metadata.get("jobs_signal"))),
    ])
    factor_scores["Hiring Signals"] = _safe_score(80 if hiring_values else 30)
    factor_reasons["Hiring Signals"] = hiring_values[:3] if hiring_values else ["No hiring evidence captured."]

    growth_values = _dedupe_text_values([
        *(_metadata_texts(metadata.get("funding_signal"))),
        *(_metadata_texts(metadata.get("growth_signal"))),
        *(_metadata_texts(metadata.get("customer_growth_signals"))),
        *(_metadata_texts(metadata.get("expansion_signals"))),
    ])
    factor_scores["Growth Signals"] = _safe_score(82 if growth_values else 28)
    factor_reasons["Growth Signals"] = growth_values[:3] if growth_values else ["No growth evidence captured."]

    company_country = str((company.country if company else "") or lead.country or "").strip().lower()
    target_country = str(getattr(workspace, "target_country", "") or "").strip().lower()
    geo_score = 65
    if company_country and target_country:
        geo_score = 85 if company_country == target_country else 55
    elif company_country:
        geo_score = 70
    factor_scores["Geography"] = _safe_score(geo_score)
    factor_reasons["Geography"] = [str((company.country if company else "") or lead.country or "Unknown geography")]

    website_quality = 20
    if lead.website or (company and company.website):
        website_quality += 30
    if metadata.get("ai_summary"):
        website_quality += 25
    if isinstance(metadata.get("google_rating"), (int, float)):
        website_quality += min(25, int(float(metadata.get("google_rating")) * 5))
    factor_scores["Website Quality"] = _safe_score(website_quality)
    factor_reasons["Website Quality"] = _dedupe_text_values([
        str(lead.website or (company.website if company else "") or ""),
        str(metadata.get("ai_summary") or ""),
        f"Google rating: {metadata.get('google_rating')}" if isinstance(metadata.get("google_rating"), (int, float)) else "",
    ]) or ["Limited website evidence."]

    verified_contacts = [
        contact
        for contact in contacts
        if bool(contact.email) and str(contact.email_status or "").lower() == "verified"
    ]
    verified_score = 25 if not verified_contacts else _safe_score(min(100, 60 + len(verified_contacts) * 15))
    factor_scores["Verified Contacts"] = verified_score
    factor_reasons["Verified Contacts"] = [
        *(f"{contact.name} ({contact.title})" for contact in verified_contacts[:3]),
    ] or ["No verified decision-maker email found."]

    raw_weights = opportunity_weights if isinstance(opportunity_weights, dict) else DEFAULT_OPPORTUNITY_WEIGHTS
    total_weight = sum(max(0.0, float(raw_weights.get(name) or 0.0)) for name in DEFAULT_OPPORTUNITY_WEIGHTS.keys())
    if total_weight <= 0:
        weights = DEFAULT_OPPORTUNITY_WEIGHTS.copy()
    else:
        weights = {
            name: max(0.0, float(raw_weights.get(name) or 0.0)) / total_weight
            for name in DEFAULT_OPPORTUNITY_WEIGHTS.keys()
        }
    weighted_score = sum(factor_scores[name] * weight for name, weight in weights.items())
    overall_score = _safe_score(round(weighted_score), 0)

    sorted_factors = sorted(factor_scores.items(), key=lambda item: item[1], reverse=True)
    positives = [f"{name}: {score}" for name, score in sorted_factors[:4] if score >= 60]
    negatives = [f"{name}: {score}" for name, score in sorted(factor_scores.items(), key=lambda item: item[1])[:4] if score <= 50]

    if overall_score >= 80:
        next_action = "Approve and send outreach to the verified decision maker now."
    elif overall_score >= 60:
        next_action = "Finalize personalization and send the first email this week."
    elif verified_contacts:
        next_action = "Run additional enrichment to improve intent coverage before sending."
    else:
        next_action = "Find a verified decision-maker contact before outreach."

    confidence_inputs = [
        factor_scores["Company Intelligence"],
        factor_scores["Decision Maker Quality"],
        factor_scores["Verified Contacts"],
        factor_scores["Website Quality"],
    ]
    confidence = _safe_score(round(sum(confidence_inputs) / len(confidence_inputs)), 0)

    reasoning = "; ".join(
        f"{name}: {', '.join(factor_reasons.get(name, [])[:2])}"
        for name, _ in sorted_factors[:4]
    )
    return {
        "overall_score": overall_score,
        "reasoning": reasoning,
        "top_positive_signals": positives,
        "top_negative_signals": negatives,
        "recommended_next_action": next_action,
        "confidence": confidence,
        "factors": {name: factor_scores[name] for name in weights.keys()},
        "weights_used": weights,
    }


def _estimated_reply_probability(*, metadata: dict[str, Any], opportunity_ranking: dict[str, Any], buying_intent: dict[str, Any]) -> int:
    expected_reply_rate = str(metadata.get("expected_reply_rate") or "").strip()
    match = re.search(r"(\d{1,3})(?:\s*[-to]+\s*(\d{1,3}))?", expected_reply_rate)
    if match:
        low = int(match.group(1))
        high = int(match.group(2)) if match.group(2) else low
        if 0 <= low <= 100 and 0 <= high <= 100:
            return _safe_score(round((low + high) / 2), 25)
    overall = _safe_score(opportunity_ranking.get("overall_score"), 0)
    buying = _safe_score(buying_intent.get("buying_signal_score"), 0)
    return _safe_score(round(overall * 0.45 + buying * 0.35 + 15), 25)


def _dedupe_evidence_items(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    deduped: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for item in items:
        source_field = str(item.get("source_field") or "").strip()
        value = str(item.get("value") or "").strip()
        if not source_field or not value:
            continue
        key = (source_field.lower(), value.lower())
        if key in seen:
            continue
        seen.add(key)
        deduped.append(
            {
                "source_field": source_field,
                "value": value,
                "confidence": _safe_score(item.get("confidence"), 65),
            }
        )
    return deduped


def _build_ai_outreach_strategy(
    *,
    lead: Lead,
    metadata: dict[str, Any],
    contacts: list[Contact],
    buying_intent: dict[str, Any],
    decision_maker_intelligence: dict[str, Any],
    opportunity_ranking: dict[str, Any],
) -> dict[str, Any]:
    profiles = decision_maker_intelligence.get("profiles") if isinstance(decision_maker_intelligence.get("profiles"), list) else []
    top_profile = profiles[0] if profiles and isinstance(profiles[0], dict) else {}
    top_profile_name = str(top_profile.get("name") or "").strip()
    top_profile_title = str(top_profile.get("title") or "").strip()
    urgency = str(buying_intent.get("urgency") or "watch").strip().lower()
    buying_explanation = str(buying_intent.get("explanation") or "").strip()

    buying_evidence = [
        {
            "source_field": str(item.get("source_field") or ""),
            "value": str(item.get("value") or ""),
            "confidence": _safe_score(item.get("confidence"), 70),
        }
        for item in buying_intent.get("evidence", [])
        if isinstance(item, dict)
    ]
    profile_evidence = [
        {
            "source_field": str(item.get("source_field") or ""),
            "value": str(item.get("value") or ""),
            "confidence": _safe_score(item.get("confidence"), 70),
        }
        for item in top_profile.get("evidence_used", [])
        if isinstance(item, dict)
    ]

    base_company_evidence = _dedupe_evidence_items(
        [
            _decision_evidence("lead.website", str(lead.website), 85) if lead.website else {},
            _decision_evidence("metadata.ai_summary", str(metadata.get("ai_summary")), 78) if metadata.get("ai_summary") else {},
            _decision_evidence("metadata.expected_reply_rate", str(metadata.get("expected_reply_rate")), 70) if metadata.get("expected_reply_rate") else {},
            _decision_evidence("metadata.suggested_offer", str(metadata.get("suggested_offer")), 78) if metadata.get("suggested_offer") else {},
            _decision_evidence("metadata.recommended_cta", str(metadata.get("recommended_cta")), 80) if metadata.get("recommended_cta") else {},
        ]
        + buying_evidence
        + profile_evidence
    )

    why_contact_now_signals = _dedupe_text_values([
        buying_explanation,
        *(str(item) for item in opportunity_ranking.get("top_positive_signals", []) if item),
    ])
    why_contact_now = why_contact_now_signals[0] if why_contact_now_signals else "Insufficient intent evidence to justify immediate outreach."
    why_contact_now_evidence = _dedupe_evidence_items([
        *buying_evidence,
        *base_company_evidence,
    ])[:4]

    best_timing = str(buying_intent.get("recommended_outreach_timing") or "").strip()
    if not best_timing and urgency == "high":
        best_timing = "Reach out within 24-48 hours."
    elif not best_timing and urgency == "medium":
        best_timing = "Reach out this week."
    elif not best_timing and urgency == "low":
        best_timing = "Reach out in 1-2 weeks after minor personalization updates."
    elif not best_timing:
        best_timing = "Run one more enrichment pass before first outreach."
    best_timing_evidence = _dedupe_evidence_items([
        _decision_evidence("buying_intent.urgency", urgency, 78),
        _decision_evidence("buying_intent.recommended_outreach_timing", best_timing, 80),
        *buying_evidence,
    ])[:4]

    verified_contacts = [
        contact
        for contact in contacts
        if bool(contact.email) and str(contact.email_status or "").lower() == "verified"
    ]
    has_linkedin = bool(top_profile.get("evidence_used")) or any(bool(contact.linkedin) for contact in contacts)
    if verified_contacts:
        best_channel = "Email"
    elif has_linkedin:
        best_channel = "LinkedIn"
    elif lead.phone or metadata.get("phone"):
        best_channel = "Phone"
    else:
        best_channel = "Email"
    channel_evidence = _dedupe_evidence_items(
        [
            *[
                _decision_evidence("contact.email_status", f"{contact.name}: {contact.email_status}", 90)
                for contact in verified_contacts[:2]
            ],
            *[
                _decision_evidence("contact.linkedin", contact.linkedin or "", 76)
                for contact in contacts[:2]
                if contact.linkedin
            ],
            _decision_evidence("lead.phone", str(lead.phone), 70) if lead.phone else {},
            *base_company_evidence,
        ]
    )[:4]

    confidence = _safe_score(opportunity_ranking.get("confidence"), 0)
    if confidence >= 80:
        best_email_length = "90-130 words"
    elif confidence >= 60:
        best_email_length = "120-170 words"
    else:
        best_email_length = "70-110 words"
    email_length_evidence = _dedupe_evidence_items([
        _decision_evidence("opportunity_ranking.confidence", str(confidence), 80),
        _decision_evidence("metadata.expected_reply_rate", str(metadata.get("expected_reply_rate")), 70) if metadata.get("expected_reply_rate") else {},
        *buying_evidence,
    ])[:4]

    strongest_value_proposition = str(
        metadata.get("suggested_offer")
        or metadata.get("best_outreach_angle")
        or metadata.get("value_proposition")
        or metadata.get("outreach_strategy")
        or ""
    ).strip()
    if not strongest_value_proposition:
        strongest_value_proposition = "Insufficient offer evidence in current enrichment data."
    strongest_value_proposition_evidence = _dedupe_evidence_items([
        _decision_evidence("metadata.suggested_offer", str(metadata.get("suggested_offer")), 82) if metadata.get("suggested_offer") else {},
        _decision_evidence("metadata.best_outreach_angle", str(metadata.get("best_outreach_angle")), 78) if metadata.get("best_outreach_angle") else {},
        _decision_evidence("metadata.value_proposition", str(metadata.get("value_proposition")), 76) if metadata.get("value_proposition") else {},
        _decision_evidence("metadata.outreach_strategy", str(metadata.get("outreach_strategy")), 74) if metadata.get("outreach_strategy") else {},
    ])[:4]

    strongest_pain_point = ""
    pain_points = [str(item) for item in metadata.get("pain_points", []) if str(item).strip()] if isinstance(metadata.get("pain_points"), list) else []
    risks = [str(item) for item in metadata.get("risks", []) if str(item).strip()] if isinstance(metadata.get("risks"), list) else []
    if pain_points:
        strongest_pain_point = pain_points[0]
    elif risks:
        strongest_pain_point = risks[0]
    if not strongest_pain_point:
        strongest_pain_point = "Insufficient pain-point evidence in current enrichment data."
    strongest_pain_point_evidence = _dedupe_evidence_items([
        _decision_evidence("metadata.pain_points", pain_points[0], 78) if pain_points else {},
        _decision_evidence("metadata.risks", risks[0], 72) if risks else {},
        *buying_evidence,
    ])[:4]

    best_subject_line = ""
    if strongest_pain_point and strongest_pain_point != "Insufficient pain-point evidence in current enrichment data.":
        best_subject_line = f"Idea to improve {strongest_pain_point[:60]}"
    elif strongest_value_proposition and strongest_value_proposition != "Insufficient offer evidence in current enrichment data.":
        best_subject_line = f"Quick idea for {lead.company or 'your team'}"
    else:
        best_subject_line = f"Quick question for {lead.company or 'your team'}"
    best_subject_line_evidence = _dedupe_evidence_items([
        *strongest_pain_point_evidence,
        *strongest_value_proposition_evidence,
        _decision_evidence("lead.company", lead.company or "", 90),
    ])[:4]

    first_sentence = str(top_profile.get("recommended_first_sentence") or "").strip()
    if not first_sentence:
        if top_profile_title:
            first_sentence = f"Noticed your role as {top_profile_title} at {lead.company or 'your company'} and wanted to share a relevant idea based on your current priorities."
        else:
            first_sentence = f"I reviewed {lead.company or 'your company'} and found one practical growth idea based on your recent signals."
    first_sentence_evidence = _dedupe_evidence_items([
        *profile_evidence,
        _decision_evidence("decision_maker_intelligence.recommended_first_sentence", str(top_profile.get("recommended_first_sentence")), 82)
        if top_profile.get("recommended_first_sentence")
        else {},
        _decision_evidence("lead.company", lead.company or "", 90),
    ])[:4]

    follow_up_schedule = [
        "Day 0: Send the personalized first message.",
        "Day 3: Follow up with one concrete proof point tied to their likely KPI.",
        "Day 7: Send a short final follow-up with a low-friction CTA.",
    ]

    risk_items = metadata.get("risks") if isinstance(metadata.get("risks"), list) else []
    weakness_items = metadata.get("weaknesses") if isinstance(metadata.get("weaknesses"), list) else []
    objections = _dedupe_text_values(
        [
            *(str(item) for item in risk_items if item),
            *(str(item) for item in weakness_items if item),
        ]
    )[:4]
    if not objections:
        objections = ["Insufficient objection evidence in current enrichment data."]
    objections_evidence = _dedupe_evidence_items([
        *[
            _decision_evidence("metadata.risks", item, 74)
            for item in risk_items[:3]
            if isinstance(item, str) and item.strip()
        ],
        *[
            _decision_evidence("metadata.weaknesses", item, 70)
            for item in weakness_items[:3]
            if isinstance(item, str) and item.strip()
        ],
        *base_company_evidence,
    ])[:4]

    cta = str(metadata.get("recommended_cta") or "").strip() or "Open to a 15-minute fit check next week?"
    cta_evidence = _dedupe_evidence_items([
        _decision_evidence("metadata.recommended_cta", str(metadata.get("recommended_cta")), 82) if metadata.get("recommended_cta") else {},
        _decision_evidence("metadata.suggested_offer", str(metadata.get("suggested_offer")), 76) if metadata.get("suggested_offer") else {},
        *base_company_evidence,
    ])[:4]

    follow_up_schedule = [
        "Day 0: Send the personalized first message.",
        "Day 3: Follow up with one concrete proof point tied to their likely KPI.",
        "Day 7: Send a short final follow-up with a low-friction CTA.",
    ]
    follow_up_schedule_evidence = _dedupe_evidence_items([
        _decision_evidence("buying_intent.urgency", urgency, 76),
        _decision_evidence("opportunity_ranking.confidence", str(confidence), 76),
        *buying_evidence,
        *base_company_evidence,
    ])[:4]

    probability_of_reply = _estimated_reply_probability(
        metadata=metadata,
        opportunity_ranking=opportunity_ranking,
        buying_intent=buying_intent,
    )
    estimated_reply_probability_evidence = _dedupe_evidence_items([
        _decision_evidence("metadata.expected_reply_rate", str(metadata.get("expected_reply_rate")), 74) if metadata.get("expected_reply_rate") else {},
        _decision_evidence("opportunity_ranking.overall_score", str(opportunity_ranking.get("overall_score")), 72) if opportunity_ranking.get("overall_score") is not None else {},
        _decision_evidence("buying_intent.buying_signal_score", str(buying_intent.get("buying_signal_score")), 78) if buying_intent.get("buying_signal_score") is not None else {},
        *base_company_evidence,
    ])[:4]

    decision_maker_strategies: list[dict[str, Any]] = []
    for profile in profiles:
        if not isinstance(profile, dict):
            continue
        profile_name = str(profile.get("name") or "").strip()
        profile_title = str(profile.get("title") or "").strip()
        profile_first_sentence = str(profile.get("recommended_first_sentence") or "").strip() or first_sentence
        profile_evidence_full = _dedupe_evidence_items(
            [
                {
                    "source_field": str(item.get("source_field") or ""),
                    "value": str(item.get("value") or ""),
                    "confidence": _safe_score(item.get("confidence"), 70),
                }
                for item in profile.get("evidence_used", [])
                if isinstance(item, dict)
            ]
            + best_subject_line_evidence
            + strongest_value_proposition_evidence
            + strongest_pain_point_evidence
        )[:6]
        decision_maker_strategies.append(
            {
                "contact_id": str(profile.get("contact_id") or ""),
                "name": profile_name,
                "title": profile_title,
                "best_subject_line": best_subject_line,
                "first_sentence": profile_first_sentence,
                "strongest_value_proposition": strongest_value_proposition,
                "strongest_pain_point": strongest_pain_point,
                "expected_objections": objections,
                "cta": cta,
                "estimated_reply_probability": probability_of_reply,
                "evidence": profile_evidence_full,
            }
        )

    return {
        "why_contact_now": why_contact_now,
        "why_contact_now_evidence": why_contact_now_evidence,
        "best_timing": best_timing,
        "best_timing_evidence": best_timing_evidence,
        "best_communication_channel": best_channel,
        "best_communication_channel_evidence": channel_evidence,
        "best_channel": best_channel,
        "best_email_length": best_email_length,
        "best_email_length_evidence": email_length_evidence,
        "best_subject_line": best_subject_line,
        "best_subject_line_evidence": best_subject_line_evidence,
        "first_sentence": first_sentence,
        "first_sentence_evidence": first_sentence_evidence,
        "strongest_value_proposition": strongest_value_proposition,
        "strongest_value_proposition_evidence": strongest_value_proposition_evidence,
        "strongest_pain_point": strongest_pain_point,
        "strongest_pain_point_evidence": strongest_pain_point_evidence,
        "expected_objections": objections,
        "expected_objections_evidence": objections_evidence,
        "objections": objections,
        "cta": cta,
        "cta_evidence": cta_evidence,
        "follow_up_schedule": follow_up_schedule,
        "follow_up_schedule_evidence": follow_up_schedule_evidence,
        "estimated_reply_probability": probability_of_reply,
        "estimated_reply_probability_evidence": estimated_reply_probability_evidence,
        "probability_of_reply": probability_of_reply,
        "target_contact": {
            "name": top_profile_name,
            "title": top_profile_title,
        },
        "decision_maker_strategies": decision_maker_strategies,
    }


def _build_ai_competitor_intelligence(
    *,
    lead: Lead,
    metadata: dict[str, Any],
    company_intelligence: dict[str, Any],
    opportunity_ranking: dict[str, Any],
) -> dict[str, Any]:
    report = company_intelligence.get("report") if isinstance(company_intelligence.get("report"), dict) else {}
    competitors = _dedupe_text_values(
        [
            *(metadata.get("competitors") if isinstance(metadata.get("competitors"), list) else []),
            *(report.get("competitors", {}).get("value", []) if isinstance(report.get("competitors"), dict) and isinstance(report.get("competitors", {}).get("value"), list) else []),
        ]
    )
    technologies = _dedupe_text_values(
        [
            *(metadata.get("technologies") if isinstance(metadata.get("technologies"), list) else []),
            *(report.get("technology_stack", {}).get("value", []) if isinstance(report.get("technology_stack"), dict) and isinstance(report.get("technology_stack", {}).get("value"), list) else []),
        ]
    )

    positioning = str(metadata.get("value_proposition") or metadata.get("sales_angle") or metadata.get("partnership_fit") or "").strip()
    if not positioning:
        positioning = f"{lead.company or 'The company'} appears positioned around practical outcomes for its target buyers."

    strengths = _dedupe_text_values(
        [
            *(metadata.get("services") if isinstance(metadata.get("services"), list) else []),
            *(metadata.get("buying_signals") if isinstance(metadata.get("buying_signals"), list) else []),
            *(item for item in opportunity_ranking.get("top_positive_signals", []) if isinstance(item, str)),
        ]
    )[:5]
    if not strengths:
        strengths = ["Clear target market focus", "Existing digital presence"]

    weaknesses = _dedupe_text_values(
        [
            *(metadata.get("weaknesses") if isinstance(metadata.get("weaknesses"), list) else []),
            *(metadata.get("risks") if isinstance(metadata.get("risks"), list) else []),
            *(item for item in opportunity_ranking.get("top_negative_signals", []) if isinstance(item, str)),
        ]
    )[:5]
    if not weaknesses:
        weaknesses = ["Limited verified contact coverage", "Potential execution gaps in outbound consistency"]

    market_gaps = _dedupe_text_values(
        [
            *(metadata.get("pain_points") if isinstance(metadata.get("pain_points"), list) else []),
            *(metadata.get("market_gaps") if isinstance(metadata.get("market_gaps"), list) else []),
            "Personalized outbound process may be underdeveloped",
        ]
    )[:5]

    opportunity_to_sell = str(metadata.get("suggested_offer") or metadata.get("best_outreach_angle") or metadata.get("outreach_strategy") or "").strip()
    if not opportunity_to_sell:
        opportunity_to_sell = "Lead with a measurable pipeline-improvement offer tied to one clear KPI."

    return {
        "competitors": competitors,
        "technologies": technologies,
        "positioning": positioning,
        "strengths": strengths,
        "weaknesses": weaknesses,
        "market_gaps": market_gaps,
        "opportunity_to_sell": opportunity_to_sell,
    }


def _build_ai_sales_timeline(
    *,
    lead: Lead,
    metadata: dict[str, Any],
    ai_outreach_strategy: dict[str, Any],
    decision_maker_intelligence: dict[str, Any],
) -> dict[str, Any]:
    decision_maker_strategies = ai_outreach_strategy.get("decision_maker_strategies") if isinstance(ai_outreach_strategy.get("decision_maker_strategies"), list) else []
    top_dm_strategy = decision_maker_strategies[0] if decision_maker_strategies and isinstance(decision_maker_strategies[0], dict) else {}
    profiles = decision_maker_intelligence.get("profiles") if isinstance(decision_maker_intelligence.get("profiles"), list) else []
    top_profile = profiles[0] if profiles and isinstance(profiles[0], dict) else {}

    subject_line = str(
        top_dm_strategy.get("best_subject_line")
        or ai_outreach_strategy.get("best_subject_line")
        or f"Quick question for {lead.company or 'your team'}"
    ).strip()
    first_sentence = str(
        top_dm_strategy.get("first_sentence")
        or ai_outreach_strategy.get("first_sentence")
        or f"I found one relevant idea for {lead.company or 'your team'} based on your current public signals."
    ).strip()
    value_proposition = str(
        top_dm_strategy.get("strongest_value_proposition")
        or ai_outreach_strategy.get("strongest_value_proposition")
        or metadata.get("suggested_offer")
        or "Share one measurable value proposition tied to pipeline outcomes."
    ).strip()
    pain_point = str(
        top_dm_strategy.get("strongest_pain_point")
        or ai_outreach_strategy.get("strongest_pain_point")
        or (metadata.get("pain_points", [""])[0] if isinstance(metadata.get("pain_points"), list) and metadata.get("pain_points") else "")
        or "Potential outbound efficiency gaps"
    ).strip()
    cta = str(top_dm_strategy.get("cta") or ai_outreach_strategy.get("cta") or metadata.get("recommended_cta") or "Open to a 15-minute fit check next week?").strip()
    best_channel = str(ai_outreach_strategy.get("best_communication_channel") or ai_outreach_strategy.get("best_channel") or "Email").strip()
    base_probability = _safe_score(ai_outreach_strategy.get("estimated_reply_probability") or ai_outreach_strategy.get("probability_of_reply"), 30)

    evidence = _dedupe_evidence_items(
        [
            *(
                ai_outreach_strategy.get("why_contact_now_evidence")
                if isinstance(ai_outreach_strategy.get("why_contact_now_evidence"), list)
                else []
            ),
            *(
                ai_outreach_strategy.get("best_subject_line_evidence")
                if isinstance(ai_outreach_strategy.get("best_subject_line_evidence"), list)
                else []
            ),
            *(
                ai_outreach_strategy.get("first_sentence_evidence")
                if isinstance(ai_outreach_strategy.get("first_sentence_evidence"), list)
                else []
            ),
            *(
                ai_outreach_strategy.get("cta_evidence")
                if isinstance(ai_outreach_strategy.get("cta_evidence"), list)
                else []
            ),
            *(
                top_dm_strategy.get("evidence")
                if isinstance(top_dm_strategy.get("evidence"), list)
                else []
            ),
            _decision_evidence("lead.company", lead.company or "", 90),
            _decision_evidence("decision_maker.title", str(top_profile.get("title") or ""), 78) if top_profile else {},
        ]
    )[:8]

    schedule = [
        ("Today", 0, "Send first personalized outreach"),
        ("+2 days", 2, "Follow up with a single proof point"),
        ("+5 days", 5, "Send value-based follow-up with a new angle"),
        ("+8 days", 8, "Try alternate channel touch"),
        ("+14 days", 14, "Send final close-the-loop message"),
    ]

    steps: list[dict[str, Any]] = []
    for label, day_offset, action in schedule:
        success_probability = _safe_score(round(base_probability - day_offset * 1.4), 8)
        email = {
            "subject": subject_line,
            "body": f"{first_sentence} {value_proposition} {cta}",
        }
        linkedin = {
            "message": f"{first_sentence} {value_proposition}",
            "recommended": best_channel == "LinkedIn" or day_offset >= 8,
        }
        phone = {
            "script": f"Mention pain point: {pain_point}. Share value: {value_proposition}. Ask: {cta}",
            "recommended": best_channel == "Phone" or day_offset in {8, 14},
        }
        reminder = f"Day {day_offset}: {action.lower()} and log response status in CRM."
        steps.append(
            {
                "step": label,
                "day_offset": day_offset,
                "action": action,
                "email": email,
                "linkedin": linkedin,
                "phone": phone,
                "reminder": reminder,
                "success_probability": success_probability,
                "evidence": evidence[:5],
            }
        )

    by_key = {step["step"]: step for step in steps}
    return {
        "today": by_key.get("Today", {}),
        "plus_2_days": by_key.get("+2 days", {}),
        "plus_5_days": by_key.get("+5 days", {}),
        "plus_8_days": by_key.get("+8 days", {}),
        "plus_14_days": by_key.get("+14 days", {}),
        "steps": steps,
    }


def _build_ai_risk_analyzer(
    *,
    lead: Lead,
    metadata: dict[str, Any],
    company_intelligence: dict[str, Any],
    decision_maker_intelligence: dict[str, Any],
    ai_outreach_strategy: dict[str, Any],
    opportunity_ranking: dict[str, Any],
) -> dict[str, Any]:
    now = datetime.utcnow()
    missing_fields = company_intelligence.get("missing_fields") if isinstance(company_intelligence.get("missing_fields"), list) else []
    profiles = decision_maker_intelligence.get("profiles") if isinstance(decision_maker_intelligence.get("profiles"), list) else []

    risk_items = metadata.get("risks") if isinstance(metadata.get("risks"), list) else []
    personalization_bullets = metadata.get("personalization_bullets") if isinstance(metadata.get("personalization_bullets"), list) else []
    ai_summary = str(metadata.get("ai_summary") or "").strip()
    weak_personalization_score = 20
    if not personalization_bullets:
        weak_personalization_score += 30
    if not ai_summary:
        weak_personalization_score += 25
    if str(ai_outreach_strategy.get("strongest_value_proposition") or "").startswith("Insufficient"):
        weak_personalization_score += 20
    weak_personalization_score = _safe_score(weak_personalization_score, 20)

    missing_data_score = _safe_score(15 + len(missing_fields) * 12 + (10 if not ai_summary else 0), 20)
    missing_decision_maker_score = _safe_score(88 if not profiles else (28 if profiles else 88), 35)

    model_confidence = _safe_score(
        opportunity_ranking.get("confidence")
        if opportunity_ranking.get("confidence") is not None
        else metadata.get("confidence_score"),
        50,
    )
    low_confidence_score = _safe_score(100 - model_confidence, 40)

    raw_last_enriched = str(metadata.get("last_enriched_at") or company_intelligence.get("generated_at") or "").strip()
    enrichment_age_days = 999
    if raw_last_enriched:
        try:
            last_enriched_at = datetime.fromisoformat(raw_last_enriched.replace("Z", "+00:00")).replace(tzinfo=None)
            enrichment_age_days = max(0, int((now - last_enriched_at).total_seconds() // 86400))
        except ValueError:
            enrichment_age_days = 999
    stale_enrichment_score = _safe_score(
        18 if enrichment_age_days <= 3 else 42 if enrichment_age_days <= 10 else 70 if enrichment_age_days <= 20 else 90,
        70,
    )

    probability_company_will_ignore_outreach = _safe_score(
        round(
            missing_data_score * 0.20
            + weak_personalization_score * 0.24
            + missing_decision_maker_score * 0.18
            + low_confidence_score * 0.18
            + stale_enrichment_score * 0.20
        ),
        45,
    )
    risk_score = probability_company_will_ignore_outreach

    evidence_pool = _dedupe_evidence_items(
        [
            _decision_evidence("company_intelligence.missing_fields", ", ".join(str(item) for item in missing_fields), 76) if missing_fields else {},
            _decision_evidence("metadata.personalization_bullets", ", ".join(str(item) for item in personalization_bullets[:3]), 74) if personalization_bullets else {},
            _decision_evidence("metadata.ai_summary", ai_summary, 76) if ai_summary else {},
            _decision_evidence("decision_maker_intelligence.profiles", str(len(profiles)), 86),
            _decision_evidence("metadata.confidence_score", str(metadata.get("confidence_score")), 78) if metadata.get("confidence_score") is not None else {},
            _decision_evidence("opportunity_ranking.confidence", str(opportunity_ranking.get("confidence")), 80) if opportunity_ranking.get("confidence") is not None else {},
            _decision_evidence("metadata.last_enriched_at", raw_last_enriched, 84) if raw_last_enriched else {},
            _decision_evidence("metadata.risks", ", ".join(str(item) for item in risk_items[:3]), 70) if risk_items else {},
        ]
        + (
            ai_outreach_strategy.get("why_contact_now_evidence")
            if isinstance(ai_outreach_strategy.get("why_contact_now_evidence"), list)
            else []
        )
    )

    factors = {
        "missing_data": {
            "risk": missing_data_score,
            "evidence": evidence_pool[:3],
        },
        "weak_personalization": {
            "risk": weak_personalization_score,
            "evidence": evidence_pool[1:5],
        },
        "missing_decision_maker": {
            "risk": missing_decision_maker_score,
            "evidence": evidence_pool[2:6],
        },
        "low_confidence": {
            "risk": low_confidence_score,
            "evidence": evidence_pool[3:7],
        },
        "stale_enrichment": {
            "risk": stale_enrichment_score,
            "age_days": enrichment_age_days,
            "evidence": evidence_pool[4:8],
        },
    }

    reasons: list[str] = []
    if missing_data_score >= 55:
        reasons.append("Missing enrichment fields reduce outreach relevance and deliverability confidence.")
    if weak_personalization_score >= 55:
        reasons.append("Personalization depth is weak for a high-probability first response.")
    if missing_decision_maker_score >= 55:
        reasons.append("No strong decision-maker profile is available for targeted outreach.")
    if low_confidence_score >= 55:
        reasons.append("Overall enrichment confidence is too low for reliable messaging.")
    if stale_enrichment_score >= 55:
        reasons.append("Enrichment may be stale and should be refreshed before outreach.")
    if not reasons:
        reasons.append("Current enrichment signals suggest manageable outreach risk.")

    recommended_improvements: list[str] = []
    if missing_data_score >= 55:
        recommended_improvements.append("Run company enrichment again to fill missing firmographic and buying-signal fields.")
    if weak_personalization_score >= 55:
        recommended_improvements.append("Add 2-3 evidence-backed personalization bullets before sending.")
    if missing_decision_maker_score >= 55:
        recommended_improvements.append("Find and verify at least one decision-maker contact.")
    if low_confidence_score >= 55:
        recommended_improvements.append("Improve confidence by validating company summary, pain points, and offer fit from new sources.")
    if stale_enrichment_score >= 55:
        recommended_improvements.append("Refresh enrichment data and regenerate outreach strategy.")
    if not recommended_improvements:
        recommended_improvements.append("Proceed with outreach and monitor response data for optimization.")

    confidence = _safe_score(
        round(
            (100 - missing_data_score) * 0.20
            + (100 - weak_personalization_score) * 0.20
            + (100 - missing_decision_maker_score) * 0.20
            + (100 - stale_enrichment_score) * 0.20
            + model_confidence * 0.20
        ),
        55,
    )

    return {
        "probability_company_will_ignore_outreach": probability_company_will_ignore_outreach,
        "missing_data": missing_data_score,
        "weak_personalization": weak_personalization_score,
        "missing_decision_maker": missing_decision_maker_score,
        "low_confidence": low_confidence_score,
        "stale_enrichment": stale_enrichment_score,
        "risk_score": risk_score,
        "reasons": reasons,
        "recommended_improvements": recommended_improvements,
        "confidence": confidence,
        "factors": factors,
    }


def _build_ai_sales_coach(
    *,
    lead: Lead,
    metadata: dict[str, Any],
    company_intelligence: dict[str, Any],
    decision_maker_intelligence: dict[str, Any],
    ai_outreach_strategy: dict[str, Any],
    ai_risk_analyzer: dict[str, Any],
    opportunity_ranking: dict[str, Any],
) -> dict[str, Any]:
    profiles = decision_maker_intelligence.get("profiles") if isinstance(decision_maker_intelligence.get("profiles"), list) else []
    top_profile = profiles[0] if profiles and isinstance(profiles[0], dict) else {}
    report = company_intelligence.get("report") if isinstance(company_intelligence.get("report"), dict) else {}

    why_this_company = str(
        metadata.get("ai_summary")
        or report.get("company_summary", {}).get("value")
        or metadata.get("opportunity_analysis")
        or "Insufficient company-fit evidence in current enrichment data."
    ).strip()

    why_now = str(
        ai_outreach_strategy.get("why_contact_now")
        or metadata.get("buying_signal_explanation")
        or "Insufficient timing evidence in current enrichment data."
    ).strip()

    decision_maker_name = str(top_profile.get("name") or "").strip()
    decision_maker_title = str(top_profile.get("title") or "").strip()
    why_this_decision_maker = str(
        top_profile.get("why_best_decision_maker")
        or (
            f"{decision_maker_name} ({decision_maker_title}) is the strongest reachable decision-maker from current enrichment signals."
            if decision_maker_name or decision_maker_title
            else "No verified decision-maker profile found yet."
        )
    ).strip()

    what_could_fail = _dedupe_text_values(
        [
            *(str(item) for item in ai_risk_analyzer.get("reasons", []) if str(item).strip()),
            *(str(item) for item in metadata.get("risks", []) if isinstance(metadata.get("risks"), list) and str(item).strip()),
        ]
    )[:5]
    if not what_could_fail:
        what_could_fail = ["Insufficient failure-risk evidence in current enrichment data."]

    how_to_increase_reply_rate = _dedupe_text_values(
        [
            *(str(item) for item in ai_risk_analyzer.get("recommended_improvements", []) if str(item).strip()),
            "Lead with one measurable pain point and one quantified value proposition.",
            "Keep the first message concise and specific to the decision maker role.",
        ]
    )[:5]

    alternative_strategy = str(
        metadata.get("follow_up_strategy")
        or (
            "Switch to LinkedIn-first sequencing for one week, then retry email with new proof points."
            if str(ai_outreach_strategy.get("best_communication_channel") or ai_outreach_strategy.get("best_channel") or "") == "Email"
            else "Switch to email-first sequencing with a shorter subject line and role-specific opener."
        )
    ).strip()

    evidence = _dedupe_evidence_items(
        [
            _decision_evidence("metadata.ai_summary", str(metadata.get("ai_summary")), 80) if metadata.get("ai_summary") else {},
            _decision_evidence("metadata.opportunity_analysis", str(metadata.get("opportunity_analysis")), 76) if metadata.get("opportunity_analysis") else {},
            _decision_evidence("ai_outreach_strategy.why_contact_now", str(ai_outreach_strategy.get("why_contact_now")), 82) if ai_outreach_strategy.get("why_contact_now") else {},
            _decision_evidence("decision_maker_intelligence.top_profile", f"{decision_maker_name} {decision_maker_title}".strip(), 84)
            if decision_maker_name or decision_maker_title
            else {},
            _decision_evidence("ai_risk_analyzer.risk_score", str(ai_risk_analyzer.get("risk_score")), 78) if ai_risk_analyzer.get("risk_score") is not None else {},
            _decision_evidence("opportunity_ranking.overall_score", str(opportunity_ranking.get("overall_score")), 78) if opportunity_ranking.get("overall_score") is not None else {},
        ]
        + (
            ai_outreach_strategy.get("why_contact_now_evidence")
            if isinstance(ai_outreach_strategy.get("why_contact_now_evidence"), list)
            else []
        )
    )[:8]

    confidence = _safe_score(
        round(
            _safe_score(opportunity_ranking.get("confidence"), 55) * 0.45
            + (100 - _safe_score(ai_risk_analyzer.get("risk_score"), 50)) * 0.35
            + (70 if profiles else 35) * 0.20
        ),
        55,
    )

    return {
        "why_this_company": why_this_company,
        "why_now": why_now,
        "why_this_decision_maker": why_this_decision_maker,
        "what_could_fail": what_could_fail,
        "how_to_increase_reply_rate": how_to_increase_reply_rate,
        "alternative_strategy": alternative_strategy,
        "target_contact": {
            "name": decision_maker_name,
            "title": decision_maker_title,
        },
        "evidence": evidence,
        "confidence": confidence,
    }


def _build_ai_company_predictions(
    *,
    lead: Lead,
    metadata: dict[str, Any],
    company_intelligence: dict[str, Any],
    decision_maker_intelligence: dict[str, Any],
    opportunity_ranking: dict[str, Any],
    ai_outreach_strategy: dict[str, Any],
    ai_risk_analyzer: dict[str, Any],
    ai_company_timeline: dict[str, Any],
) -> dict[str, Any]:
    now = datetime.utcnow().isoformat()
    report = company_intelligence.get("report") if isinstance(company_intelligence.get("report"), dict) else {}
    buying_intent = company_intelligence.get("buying_intent") if isinstance(company_intelligence.get("buying_intent"), dict) else {}
    profiles = decision_maker_intelligence.get("profiles") if isinstance(decision_maker_intelligence.get("profiles"), list) else []
    top_profile = profiles[0] if profiles and isinstance(profiles[0], dict) else {}
    timeline_events = ai_company_timeline.get("events") if isinstance(ai_company_timeline.get("events"), list) else []

    size_value = (
        metadata.get("estimated_company_size")
        or ((report.get("estimated_company_size") or {}).get("value") if isinstance(report.get("estimated_company_size"), dict) else None)
        or metadata.get("employee_count")
        or metadata.get("employees")
    )
    size_numeric = _numeric_from_size(size_value)
    buying_signal_score = _safe_score(buying_intent.get("buying_signal_score"), 0)
    ranking_score = _safe_score(opportunity_ranking.get("overall_score"), 0)
    risk_score = _safe_score(ai_risk_analyzer.get("risk_score"), 50)
    top_contact_confidence = _safe_score(top_profile.get("confidence_score"), 0)
    has_verified_decision_maker = bool(top_profile.get("is_verified_contact"))

    funding_signals = _event_texts(metadata.get("funding_signal")) + _event_texts(metadata.get("funding_signals"))
    hiring_signals = _event_texts(metadata.get("hiring_signals")) + _event_texts(metadata.get("jobs_signal"))
    product_signals = _event_texts(metadata.get("product_launches"))
    partnership_signals = _event_texts(metadata.get("partnership_signals")) + _event_texts(metadata.get("partnership_updates"))

    estimated_arr_score = 25
    if size_numeric is not None:
        if size_numeric >= 500:
            estimated_arr_score += 48
        elif size_numeric >= 200:
            estimated_arr_score += 40
        elif size_numeric >= 100:
            estimated_arr_score += 32
        elif size_numeric >= 50:
            estimated_arr_score += 26
        elif size_numeric >= 20:
            estimated_arr_score += 20
        else:
            estimated_arr_score += 12
    estimated_arr_score += min(15, len(funding_signals) * 5)
    estimated_arr_score += min(10, len(pricing) * 4) if (pricing := _event_texts(metadata.get("pricing_signals"))) else 0
    estimated_arr_score += min(8, len(hiring_signals) * 2)
    estimated_arr_score = _safe_score(estimated_arr_score, 20)

    arr_evidence = _dedupe_evidence_items(
        [
            _decision_evidence("metadata.estimated_company_size", str(size_value), 78) if size_value else {},
            *[_decision_evidence("metadata.funding_signal", item, 82) for item in funding_signals[:3]],
            *[_decision_evidence("metadata.pricing_signals", item, 72) for item in pricing[:3]],
            *[_decision_evidence("metadata.hiring_signals", item, 72) for item in hiring_signals[:3]],
        ]
    )
    arr_reasoning = (
        "Estimated ARR potential is inferred from available company size and growth/funding enrichment signals."
        if arr_evidence
        else "Estimated ARR confidence is low because enrichment lacks size and funding detail."
    )
    arr_confidence = _safe_score(40 + len(arr_evidence) * 12 + (8 if size_numeric is not None else 0), 30)

    maturity_score = 22
    maturity_score += 18 if lead.website else 0
    maturity_score += min(18, len(_event_texts(metadata.get("technologies"))) * 4)
    maturity_score += 12 if metadata.get("ai_summary") else 0
    maturity_score += 10 if metadata.get("icp") else 0
    maturity_score += 8 if metadata.get("value_proposition") or metadata.get("suggested_offer") else 0
    maturity_score += min(12, len(timeline_events) * 2)
    maturity_score = _safe_score(maturity_score, 25)

    maturity_evidence = _dedupe_evidence_items(
        [
            _decision_evidence("lead.website", str(lead.website), 85) if lead.website else {},
            _decision_evidence("metadata.ai_summary", str(metadata.get("ai_summary")), 76) if metadata.get("ai_summary") else {},
            _decision_evidence("metadata.icp", str(metadata.get("icp")), 72) if metadata.get("icp") else {},
            *[_decision_evidence("metadata.technologies", item, 74) for item in _event_texts(metadata.get("technologies"))[:4]],
        ]
    )
    maturity_reasoning = (
        "Company maturity is based on structured enrichment signals such as website presence, defined positioning, and technology footprint."
        if maturity_evidence
        else "Company maturity confidence is low because structured enrichment fields are sparse."
    )
    maturity_confidence = _safe_score(38 + len(maturity_evidence) * 11, 30)

    growth_score = 18
    growth_score += round(buying_signal_score * 0.35)
    growth_score += min(14, len(funding_signals) * 4)
    growth_score += min(12, len(hiring_signals) * 3)
    growth_score += min(10, len(product_signals) * 3)
    growth_score += min(8, len(partnership_signals) * 2)
    growth_score += min(8, len(timeline_events) * 2)
    growth_score = _safe_score(growth_score, 20)

    growth_evidence = _dedupe_evidence_items(
        [
            _decision_evidence("company_intelligence.buying_intent.buying_signal_score", str(buying_signal_score), 80),
            *[_decision_evidence("metadata.funding_signal", item, 82) for item in funding_signals[:3]],
            *[_decision_evidence("metadata.hiring_signals", item, 78) for item in hiring_signals[:3]],
            *[_decision_evidence("metadata.product_launches", item, 76) for item in product_signals[:3]],
            *[_decision_evidence("metadata.partnership_signals", item, 74) for item in partnership_signals[:3]],
        ]
    )
    growth_reasoning = (
        "Growth probability is derived from observed buying intent and timeline-aligned expansion signals in enrichment data."
        if growth_evidence
        else "Growth probability confidence is low because no strong expansion signals were enriched."
    )
    growth_confidence = _safe_score(40 + len(growth_evidence) * 10 + _safe_score(buying_intent.get("confidence"), 0) // 5, 32)

    readiness_score = 16
    readiness_score += round(ranking_score * 0.42)
    readiness_score += round((100 - risk_score) * 0.28)
    readiness_score += 14 if has_verified_decision_maker else 0
    readiness_score += round(top_contact_confidence * 0.10)
    readiness_score += 8 if ai_outreach_strategy.get("best_subject_line") and ai_outreach_strategy.get("cta") else 0
    readiness_score = _safe_score(readiness_score, 20)

    readiness_evidence = _dedupe_evidence_items(
        [
            _decision_evidence("opportunity_ranking.overall_score", str(ranking_score), 82),
            _decision_evidence("ai_risk_analyzer.risk_score", str(risk_score), 80),
            _decision_evidence("decision_maker_intelligence.top_profile.is_verified_contact", str(has_verified_decision_maker), 88),
            _decision_evidence("decision_maker_intelligence.top_profile.confidence_score", str(top_contact_confidence), 80),
            _decision_evidence("ai_outreach_strategy.best_subject_line", str(ai_outreach_strategy.get("best_subject_line") or ""), 72)
            if ai_outreach_strategy.get("best_subject_line")
            else {},
            _decision_evidence("ai_outreach_strategy.cta", str(ai_outreach_strategy.get("cta") or ""), 72)
            if ai_outreach_strategy.get("cta")
            else {},
        ]
    )
    readiness_reasoning = (
        "Sales readiness is based on ranking, risk, decision-maker verification, and readiness of generated outreach strategy fields."
        if readiness_evidence
        else "Sales readiness confidence is low because ranking, risk, and contact-quality signals are incomplete."
    )
    readiness_confidence = _safe_score(42 + len(readiness_evidence) * 10, 34)

    return {
        "generated_at": now,
        "estimated_arr": {
            "score": estimated_arr_score,
            "reasoning": arr_reasoning,
            "confidence": arr_confidence,
            "evidence": arr_evidence,
        },
        "company_maturity": {
            "score": maturity_score,
            "reasoning": maturity_reasoning,
            "confidence": maturity_confidence,
            "evidence": maturity_evidence,
        },
        "growth_probability": {
            "score": growth_score,
            "reasoning": growth_reasoning,
            "confidence": growth_confidence,
            "evidence": growth_evidence,
        },
        "sales_readiness": {
            "score": readiness_score,
            "reasoning": readiness_reasoning,
            "confidence": readiness_confidence,
            "evidence": readiness_evidence,
        },
    }


def _agent_result(
    *,
    name: str,
    output: dict[str, Any],
    reasoning: list[str],
    evidence: list[dict[str, Any]],
    confidence: int,
) -> dict[str, Any]:
    return {
        "agent": name,
        "status": "complete" if output else "insufficient_data",
        "output": output,
        "confidence": _safe_score(confidence, 30),
    }


def _build_ai_specialized_agents(
    *,
    lead: Lead,
    company_intelligence: dict[str, Any],
    decision_maker_intelligence: dict[str, Any],
    ai_outreach_strategy: dict[str, Any],
    ai_competitor_intelligence: dict[str, Any],
    ai_risk_analyzer: dict[str, Any],
    ai_sales_coach: dict[str, Any],
    ai_company_predictions: dict[str, Any],
) -> dict[str, Any]:
    report = company_intelligence.get("report") if isinstance(company_intelligence.get("report"), dict) else {}
    buying_intent = company_intelligence.get("buying_intent") if isinstance(company_intelligence.get("buying_intent"), dict) else {}
    profiles = decision_maker_intelligence.get("profiles") if isinstance(decision_maker_intelligence.get("profiles"), list) else []
    top_profile = profiles[0] if profiles and isinstance(profiles[0], dict) else {}

    company_output = {
        "company_summary": (report.get("company_summary") or {}).get("value") if isinstance(report.get("company_summary"), dict) else "",
        "icp": (report.get("icp") or {}).get("value") if isinstance(report.get("icp"), dict) else "",
        "estimated_company_size": (report.get("estimated_company_size") or {}).get("value") if isinstance(report.get("estimated_company_size"), dict) else "",
        "technology_stack": (report.get("technology_stack") or {}).get("value") if isinstance(report.get("technology_stack"), dict) else [],
    }
    company_reasoning = [
        "Company Analyst output is derived from enriched report fields only.",
        "No missing fields are inferred; missing values remain empty.",
    ]
    company_evidence = _dedupe_evidence_items(
        [
            _decision_evidence("company_intelligence.report.company_summary", str(company_output.get("company_summary") or ""), 82)
            if company_output.get("company_summary")
            else {},
            _decision_evidence("company_intelligence.report.icp", str(company_output.get("icp") or ""), 78)
            if company_output.get("icp")
            else {},
            _decision_evidence("company_intelligence.report.estimated_company_size", str(company_output.get("estimated_company_size") or ""), 74)
            if company_output.get("estimated_company_size")
            else {},
        ]
    )

    decision_output = {
        "top_contact_id": top_profile.get("contact_id"),
        "name": top_profile.get("name"),
        "title": top_profile.get("title"),
        "authority_level": top_profile.get("estimated_authority_level"),
        "is_verified_contact": bool(top_profile.get("is_verified_contact")),
        "confidence_score": _safe_score(top_profile.get("confidence_score"), 0),
    }
    decision_reasoning = [
        "Decision Maker Analyst ranks contacts from verified enrichment records.",
        "If no verified profile exists, output remains sparse instead of fabricated.",
    ]
    decision_evidence = _dedupe_evidence_items(
        [
            _decision_evidence("decision_maker_intelligence.top_profile.name", str(top_profile.get("name") or ""), 84)
            if top_profile.get("name")
            else {},
            _decision_evidence("decision_maker_intelligence.top_profile.title", str(top_profile.get("title") or ""), 80)
            if top_profile.get("title")
            else {},
            _decision_evidence("decision_maker_intelligence.top_profile.is_verified_contact", str(bool(top_profile.get("is_verified_contact"))), 88)
            if top_profile
            else {},
        ]
    )

    buying_output = {
        "buying_signal_score": _safe_score(buying_intent.get("buying_signal_score"), 0),
        "urgency": str(buying_intent.get("urgency") or ""),
        "recommended_outreach_timing": str(buying_intent.get("recommended_outreach_timing") or ""),
    }
    buying_reasoning = [
        "Buying Signal Analyst uses explicit buying-intent detection output.",
        "Only detected signals from enrichment are used.",
    ]
    buying_evidence = _dedupe_evidence_items(
        [
            _decision_evidence("company_intelligence.buying_intent.buying_signal_score", str(buying_output.get("buying_signal_score") or ""), 84),
            _decision_evidence("company_intelligence.buying_intent.urgency", str(buying_output.get("urgency") or ""), 80)
            if buying_output.get("urgency")
            else {},
            *[
                {
                    "source_field": str(item.get("source_field") or ""),
                    "value": str(item.get("value") or ""),
                    "confidence": _safe_score(item.get("confidence"), 70),
                }
                for item in (buying_intent.get("evidence") or [])
                if isinstance(item, dict)
            ],
        ]
    )

    competitor_output = {
        "competitors": ai_competitor_intelligence.get("competitors") if isinstance(ai_competitor_intelligence.get("competitors"), list) else [],
        "market_gaps": ai_competitor_intelligence.get("market_gaps") if isinstance(ai_competitor_intelligence.get("market_gaps"), list) else [],
        "opportunity_to_sell": str(ai_competitor_intelligence.get("opportunity_to_sell") or ""),
    }
    competitor_reasoning = [
        "Competitor Analyst summarizes only enriched competitor and gap signals.",
        "No external competitor assumptions are injected.",
    ]
    competitor_evidence = _dedupe_evidence_items(
        [
            *[_decision_evidence("ai_competitor_intelligence.competitors", str(item), 74) for item in competitor_output.get("competitors", [])[:4]],
            *[_decision_evidence("ai_competitor_intelligence.market_gaps", str(item), 72) for item in competitor_output.get("market_gaps", [])[:4]],
            _decision_evidence("ai_competitor_intelligence.opportunity_to_sell", competitor_output.get("opportunity_to_sell", ""), 76)
            if competitor_output.get("opportunity_to_sell")
            else {},
        ]
    )

    email_output = {
        "subject": str(ai_outreach_strategy.get("best_subject_line") or ""),
        "first_sentence": str(ai_outreach_strategy.get("first_sentence") or ""),
        "cta": str(ai_outreach_strategy.get("cta") or ""),
        "best_channel": str(ai_outreach_strategy.get("best_communication_channel") or ai_outreach_strategy.get("best_channel") or ""),
    }
    email_reasoning = [
        "Email Writer uses existing outreach-strategy fields generated from enrichment evidence.",
        "When message fields are missing, they remain blank instead of synthesized.",
    ]
    email_evidence = _dedupe_evidence_items(
        [
            *[
                {
                    "source_field": str(item.get("source_field") or ""),
                    "value": str(item.get("value") or ""),
                    "confidence": _safe_score(item.get("confidence"), 70),
                }
                for item in (ai_outreach_strategy.get("best_subject_line_evidence") or [])
                if isinstance(item, dict)
            ],
            *[
                {
                    "source_field": str(item.get("source_field") or ""),
                    "value": str(item.get("value") or ""),
                    "confidence": _safe_score(item.get("confidence"), 70),
                }
                for item in (ai_outreach_strategy.get("first_sentence_evidence") or [])
                if isinstance(item, dict)
            ],
            *[
                {
                    "source_field": str(item.get("source_field") or ""),
                    "value": str(item.get("value") or ""),
                    "confidence": _safe_score(item.get("confidence"), 70),
                }
                for item in (ai_outreach_strategy.get("cta_evidence") or [])
                if isinstance(item, dict)
            ],
        ]
    )

    coach_output = {
        "why_now": str(ai_sales_coach.get("why_now") or ""),
        "what_could_fail": ai_sales_coach.get("what_could_fail") if isinstance(ai_sales_coach.get("what_could_fail"), list) else [],
        "how_to_increase_reply_rate": ai_sales_coach.get("how_to_increase_reply_rate") if isinstance(ai_sales_coach.get("how_to_increase_reply_rate"), list) else [],
        "risk_score": _safe_score(ai_risk_analyzer.get("risk_score"), 0),
    }
    coach_reasoning = [
        "Sales Coach combines risk analyzer and coach outputs produced from enrichment traces.",
        "Recommendations are constrained to collected risk and outreach context.",
    ]
    coach_evidence = _dedupe_evidence_items(
        [
            *[
                {
                    "source_field": str(item.get("source_field") or ""),
                    "value": str(item.get("value") or ""),
                    "confidence": _safe_score(item.get("confidence"), 70),
                }
                for item in (ai_sales_coach.get("evidence") or [])
                if isinstance(item, dict)
            ],
            _decision_evidence("ai_risk_analyzer.risk_score", str(coach_output.get("risk_score") or ""), 80)
            if coach_output.get("risk_score") is not None
            else {},
        ]
    )

    agents = {
        "company_analyst": _agent_result(
            name="Company Analyst",
            output=company_output,
            reasoning=company_reasoning,
            evidence=company_evidence,
            confidence=68 + min(20, len(company_evidence) * 4),
        ),
        "decision_maker_analyst": _agent_result(
            name="Decision Maker Analyst",
            output=decision_output,
            reasoning=decision_reasoning,
            evidence=decision_evidence,
            confidence=60 + min(28, len(decision_evidence) * 6),
        ),
        "buying_signal_analyst": _agent_result(
            name="Buying Signal Analyst",
            output=buying_output,
            reasoning=buying_reasoning,
            evidence=buying_evidence,
            confidence=62 + min(24, len(buying_evidence) * 4),
        ),
        "competitor_analyst": _agent_result(
            name="Competitor Analyst",
            output=competitor_output,
            reasoning=competitor_reasoning,
            evidence=competitor_evidence,
            confidence=60 + min(24, len(competitor_evidence) * 4),
        ),
        "email_writer": _agent_result(
            name="Email Writer",
            output=email_output,
            reasoning=email_reasoning,
            evidence=email_evidence,
            confidence=58 + min(28, len(email_evidence) * 5),
        ),
        "sales_coach": _agent_result(
            name="Sales Coach",
            output=coach_output,
            reasoning=coach_reasoning,
            evidence=coach_evidence,
            confidence=60 + min(28, len(coach_evidence) * 5),
        ),
    }

    intermediate_reasoning = {
        "company_analyst": {
            "reasoning": company_reasoning,
            "evidence": company_evidence,
        },
        "decision_maker_analyst": {
            "reasoning": decision_reasoning,
            "evidence": decision_evidence,
        },
        "buying_signal_analyst": {
            "reasoning": buying_reasoning,
            "evidence": buying_evidence,
        },
        "competitor_analyst": {
            "reasoning": competitor_reasoning,
            "evidence": competitor_evidence,
        },
        "email_writer": {
            "reasoning": email_reasoning,
            "evidence": email_evidence,
        },
        "sales_coach": {
            "reasoning": coach_reasoning,
            "evidence": coach_evidence,
        },
    }

    orchestrator_evidence = _dedupe_evidence_items(
        [
            *company_evidence[:2],
            *decision_evidence[:2],
            *buying_evidence[:2],
            *competitor_evidence[:2],
            *email_evidence[:2],
            *coach_evidence[:2],
        ]
    )
    orchestrator_output = {
        "company": company_output,
        "decision_maker": decision_output,
        "buying_signals": buying_output,
        "competitor_view": competitor_output,
        "email_plan": email_output,
        "coaching": coach_output,
        "predictions": {
            "estimated_arr": ai_company_predictions.get("estimated_arr") if isinstance(ai_company_predictions.get("estimated_arr"), dict) else {},
            "company_maturity": ai_company_predictions.get("company_maturity") if isinstance(ai_company_predictions.get("company_maturity"), dict) else {},
            "growth_probability": ai_company_predictions.get("growth_probability") if isinstance(ai_company_predictions.get("growth_probability"), dict) else {},
            "sales_readiness": ai_company_predictions.get("sales_readiness") if isinstance(ai_company_predictions.get("sales_readiness"), dict) else {},
        },
        "final_recommendation": {
            "next_action": str(ai_sales_coach.get("alternative_strategy") or ai_outreach_strategy.get("cta") or "Insufficient evidence for next action."),
            "target_company": str(lead.company or ""),
        },
    }
    orchestrator_reasoning = [
        "Final Orchestrator merges structured outputs from Company, Decision Maker, Buying Signal, Competitor, Email Writer, and Sales Coach agents.",
        "Merged payload keeps original evidence-backed outputs without creating new facts.",
    ]
    orchestrator = {
        "agent": "Final Orchestrator",
        "status": "complete",
        "output": orchestrator_output,
        "confidence": _safe_score(
            round(sum(_safe_score(agent.get("confidence"), 0) for agent in agents.values()) / max(1, len(agents))),
            40,
        ),
    }

    intermediate_reasoning["final_orchestrator"] = {
        "reasoning": orchestrator_reasoning,
        "evidence": orchestrator_evidence,
    }
    return {
        "generated_at": datetime.utcnow().isoformat(),
        "agents": agents,
        "intermediate_reasoning": intermediate_reasoning,
        "final_orchestrator": orchestrator,
    }


def _build_ai_executive_dashboard(
    *,
    ai_specialized_agents: dict[str, Any],
    ai_agent_intermediate_reasoning: dict[str, Any],
    ai_final_orchestrator: dict[str, Any],
    opportunity_ranking: dict[str, Any],
    buying_intent: dict[str, Any],
    ai_risk_analyzer: dict[str, Any],
    ai_outreach_strategy: dict[str, Any],
    ai_competitor_intelligence: dict[str, Any],
) -> dict[str, Any]:
    orchestrator_output = ai_final_orchestrator.get("output") if isinstance(ai_final_orchestrator.get("output"), dict) else {}
    decision_maker = (orchestrator_output.get("decision_maker") if isinstance(orchestrator_output.get("decision_maker"), dict) else {})
    email_plan = (orchestrator_output.get("email_plan") if isinstance(orchestrator_output.get("email_plan"), dict) else {})
    competitor_view = (orchestrator_output.get("competitor_view") if isinstance(orchestrator_output.get("competitor_view"), dict) else {})
    final_recommendation = (
        orchestrator_output.get("final_recommendation")
        if isinstance(orchestrator_output.get("final_recommendation"), dict)
        else {}
    )

    top_risks = ai_risk_analyzer.get("reasons") if isinstance(ai_risk_analyzer.get("reasons"), list) else []
    top_opportunities = _dedupe_text_values(
        [
            str(competitor_view.get("opportunity_to_sell") or "").strip(),
            *(str(item) for item in (opportunity_ranking.get("top_positive_signals") or []) if str(item or "").strip()),
        ]
    )[:5]

    recommended_follow_up = ""
    schedule = ai_outreach_strategy.get("follow_up_schedule") if isinstance(ai_outreach_strategy.get("follow_up_schedule"), list) else []
    if schedule:
        recommended_follow_up = str(schedule[0] or "").strip()

    intermediate_evidence = []
    for section in ai_agent_intermediate_reasoning.values():
        if isinstance(section, dict) and isinstance(section.get("evidence"), list):
            intermediate_evidence.extend(section.get("evidence") or [])

    evidence = _dedupe_evidence_items(
        [
            {
                "source_field": str(item.get("source_field") or ""),
                "value": str(item.get("value") or ""),
                "confidence": _safe_score(item.get("confidence"), 70),
            }
            for item in intermediate_evidence
            if isinstance(item, dict) and str(item.get("source_field") or "").strip() and str(item.get("value") or "").strip()
        ]
    )[:12]

    return {
        "generated_at": datetime.utcnow().isoformat(),
        "source": "cached_orchestrator",
        "overall_opportunity_score": {
            "score": _safe_score(opportunity_ranking.get("overall_score"), 0),
            "reasoning": str(opportunity_ranking.get("reasoning") or ""),
        },
        "buying_intent": {
            "score": _safe_score(buying_intent.get("buying_signal_score"), 0),
            "urgency": str(buying_intent.get("urgency") or ""),
            "reasoning": str(buying_intent.get("explanation") or ""),
        },
        "decision_maker": {
            "contact_id": decision_maker.get("top_contact_id"),
            "name": decision_maker.get("name"),
            "title": decision_maker.get("title"),
            "authority_level": decision_maker.get("authority_level"),
            "is_verified_contact": bool(decision_maker.get("is_verified_contact")),
        },
        "top_risks": [str(item) for item in top_risks if str(item or "").strip()][:5],
        "top_opportunities": top_opportunities,
        "recommended_next_action": str(
            final_recommendation.get("next_action")
            or opportunity_ranking.get("recommended_next_action")
            or ""
        ),
        "recommended_email": {
            "subject": str(email_plan.get("subject") or ""),
            "first_sentence": str(email_plan.get("first_sentence") or ""),
            "cta": str(email_plan.get("cta") or ""),
            "channel": str(email_plan.get("best_channel") or ""),
        },
        "recommended_follow_up": recommended_follow_up,
        "competitor_summary": {
            "competitors": competitor_view.get("competitors") if isinstance(competitor_view.get("competitors"), list) else [],
            "market_gaps": competitor_view.get("market_gaps") if isinstance(competitor_view.get("market_gaps"), list) else [],
            "opportunity_to_sell": str(competitor_view.get("opportunity_to_sell") or ""),
        },
        "evidence": evidence,
        "confidence": _safe_score(ai_final_orchestrator.get("confidence"), 0),
    }


def _stable_fingerprint(payload: dict[str, Any]) -> str:
    normalized = json.dumps(payload, sort_keys=True, default=str, separators=(",", ":"))
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def _build_ai_revenue_engine_report(
    *,
    previous_report: dict[str, Any] | None,
    company_intelligence: dict[str, Any],
    opportunity_ranking: dict[str, Any],
    buying_intent: dict[str, Any],
    decision_maker_intelligence: dict[str, Any],
    ai_competitor_intelligence: dict[str, Any],
    ai_sales_coach: dict[str, Any],
    ai_outreach_strategy: dict[str, Any],
    ai_risk_analyzer: dict[str, Any],
) -> dict[str, Any]:
    report_seed = {
        "company_intelligence": company_intelligence,
        "opportunity_ranking": opportunity_ranking,
        "buying_intent": buying_intent,
        "decision_maker_intelligence": decision_maker_intelligence,
        "ai_competitor_intelligence": ai_competitor_intelligence,
        "ai_sales_coach": ai_sales_coach,
        "ai_outreach_strategy": ai_outreach_strategy,
        "ai_risk_analyzer": ai_risk_analyzer,
    }
    fingerprint = _stable_fingerprint(report_seed)
    previous = previous_report if isinstance(previous_report, dict) else {}
    if str(previous.get("source_fingerprint") or "") == fingerprint:
        return previous

    report = company_intelligence.get("report") if isinstance(company_intelligence.get("report"), dict) else {}
    profiles = decision_maker_intelligence.get("profiles") if isinstance(decision_maker_intelligence.get("profiles"), list) else []
    top_profile = profiles[0] if profiles and isinstance(profiles[0], dict) else {}

    top_pain_points = [str(item) for item in report.get("possible_pain_points", {}).get("value", []) if str(item or "").strip()] if isinstance(report.get("possible_pain_points"), dict) and isinstance(report.get("possible_pain_points", {}).get("value"), list) else []
    if not top_pain_points:
        top_pain_points = [str(item) for item in ai_outreach_strategy.get("expected_objections", []) if str(item or "").strip()] if isinstance(ai_outreach_strategy.get("expected_objections"), list) else []

    top_opportunities = [str(item) for item in opportunity_ranking.get("top_positive_signals", []) if str(item or "").strip()] if isinstance(opportunity_ranking.get("top_positive_signals"), list) else []
    opportunity_to_sell = str(ai_competitor_intelligence.get("opportunity_to_sell") or "").strip()
    if opportunity_to_sell:
        top_opportunities = [opportunity_to_sell, *top_opportunities]

    top_risks = [str(item) for item in ai_risk_analyzer.get("reasons", []) if str(item or "").strip()] if isinstance(ai_risk_analyzer.get("reasons"), list) else []
    if not top_risks:
        top_risks = [str(item) for item in opportunity_ranking.get("top_negative_signals", []) if str(item or "").strip()] if isinstance(opportunity_ranking.get("top_negative_signals"), list) else []

    buying_score = _safe_score(buying_intent.get("buying_signal_score"), 0)
    opportunity_score = _safe_score(opportunity_ranking.get("overall_score"), 0)
    confidence = _safe_score(
        round(
            _safe_score(opportunity_ranking.get("confidence"), 0) * 0.40
            + _safe_score(buying_intent.get("confidence"), 0) * 0.25
            + _safe_score(top_profile.get("confidence_score"), 0) * 0.20
            + _safe_score(ai_sales_coach.get("confidence"), 0) * 0.15
        ),
        0,
    )

    products = report.get("products", {}).get("value", []) if isinstance(report.get("products"), dict) else []
    technologies = report.get("technology_stack", {}).get("value", []) if isinstance(report.get("technology_stack"), dict) else []
    technology_summary = {
        "products": [str(item) for item in products if str(item or "").strip()] if isinstance(products, list) else [],
        "technology_stack": [str(item) for item in technologies if str(item or "").strip()] if isinstance(technologies, list) else [],
    }

    recommended_email = {
        "subject": str(ai_outreach_strategy.get("best_subject_line") or ""),
        "first_sentence": str(ai_outreach_strategy.get("first_sentence") or ""),
        "cta": str(ai_outreach_strategy.get("cta") or ""),
    }

    evidence = _dedupe_evidence_items(
        [
            *(
                [
                    {
                        "source_field": str(item.get("source_field") or ""),
                        "value": str(item.get("value") or ""),
                        "confidence": _safe_score(item.get("confidence"), 70),
                    }
                    for item in buying_intent.get("evidence", [])
                    if isinstance(item, dict)
                ]
                if isinstance(buying_intent.get("evidence"), list)
                else []
            ),
            *(
                [
                    {
                        "source_field": str(item.get("source_field") or ""),
                        "value": str(item.get("value") or ""),
                        "confidence": _safe_score(item.get("confidence"), 70),
                    }
                    for item in top_profile.get("evidence_used", [])
                    if isinstance(item, dict)
                ]
                if isinstance(top_profile.get("evidence_used"), list)
                else []
            ),
            *(
                [
                    {
                        "source_field": str(item.get("source_field") or ""),
                        "value": str(item.get("value") or ""),
                        "confidence": _safe_score(item.get("confidence"), 70),
                    }
                    for item in ai_sales_coach.get("evidence", [])
                    if isinstance(item, dict)
                ]
                if isinstance(ai_sales_coach.get("evidence"), list)
                else []
            ),
            *(
                ai_outreach_strategy.get("why_contact_now_evidence")
                if isinstance(ai_outreach_strategy.get("why_contact_now_evidence"), list)
                else []
            ),
            {
                "source_field": "opportunity_ranking.reasoning",
                "value": str(opportunity_ranking.get("reasoning") or ""),
                "confidence": _safe_score(opportunity_ranking.get("confidence"), 65),
            },
        ]
    )[:16]

    executive_summary = " ".join(
        [
            str(company_intelligence.get("summary") or "").strip(),
            str(buying_intent.get("explanation") or "").strip(),
            str(ai_sales_coach.get("why_this_company") or "").strip(),
        ]
    ).strip()
    if not executive_summary:
        executive_summary = str(opportunity_ranking.get("reasoning") or "").strip()

    return {
        "generated_at": datetime.utcnow().isoformat(),
        "source": "cached_enrichment_modules",
        "source_fingerprint": fingerprint,
        "executive_summary": executive_summary,
        "overall_opportunity_score": {
            "score": opportunity_score,
            "reasoning": str(opportunity_ranking.get("reasoning") or ""),
        },
        "buying_intent": {
            "score": buying_score,
            "urgency": str(buying_intent.get("urgency") or ""),
            "reasoning": str(buying_intent.get("explanation") or ""),
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
            "opportunity_to_sell": opportunity_to_sell,
        },
        "technology_summary": technology_summary,
        "recommended_outreach_strategy": {
            "why_contact_now": str(ai_outreach_strategy.get("why_contact_now") or ""),
            "best_timing": str(ai_outreach_strategy.get("best_timing") or ""),
            "best_channel": str(ai_outreach_strategy.get("best_communication_channel") or ai_outreach_strategy.get("best_channel") or ""),
            "strongest_value_proposition": str(ai_outreach_strategy.get("strongest_value_proposition") or ""),
        },
        "recommended_first_email": recommended_email,
        "recommended_follow_up_strategy": {
            "schedule": [str(item) for item in ai_outreach_strategy.get("follow_up_schedule", []) if str(item or "").strip()] if isinstance(ai_outreach_strategy.get("follow_up_schedule"), list) else [],
            "strategy": str(ai_sales_coach.get("alternative_strategy") or ""),
        },
        "recommended_cta": str(ai_outreach_strategy.get("cta") or ""),
        "confidence": confidence,
        "evidence": evidence,
    }


def _build_ai_crm_summary(
    *,
    lead: Lead,
    company: Company | None,
    metadata: dict[str, Any],
    buying_intent: dict[str, Any],
    ai_risk_analyzer: dict[str, Any],
    ai_lead_prioritization: dict[str, Any],
    opportunity_ranking: dict[str, Any],
    ai_revenue_engine_report: dict[str, Any],
) -> dict[str, Any]:
    priority_tier = str(ai_lead_prioritization.get("tier") or "Needs More Data")
    priority_score = _safe_score(ai_lead_prioritization.get("score"), 0)
    risk_score = _safe_score(ai_risk_analyzer.get("risk_score"), 50)
    ranking_confidence = _safe_score(opportunity_ranking.get("confidence"), 0)
    health_score = _safe_score(round((100 - risk_score) * 0.55 + ranking_confidence * 0.45), 0)

    if health_score >= 75:
        health_status = "Healthy"
    elif health_score >= 50:
        health_status = "Watch"
    else:
        health_status = "At Risk"

    replied = bool(metadata.get("replied_at"))
    opened = bool(metadata.get("opened_at"))
    sent = bool(metadata.get("email_sent_at"))
    crm_stage = str((company.crm_stage if company else "") or metadata.get("crm_stage") or "")
    if crm_stage in {"Won", "Lost"}:
        relationship_status = crm_stage
    elif replied or crm_stage in {"Replied", "Meeting Scheduled"}:
        relationship_status = "Engaged"
    elif opened:
        relationship_status = "Warm"
    elif sent:
        relationship_status = "Outreach Sent"
    elif str(metadata.get("email_generated_at") or ""):
        relationship_status = "Draft Ready"
    else:
        relationship_status = "New"

    top_opportunities = ai_revenue_engine_report.get("top_opportunities") if isinstance(ai_revenue_engine_report.get("top_opportunities"), list) else []
    upcoming_opportunity = str(top_opportunities[0] or "").strip() if top_opportunities else ""
    if not upcoming_opportunity:
        upcoming_opportunity = str(opportunity_ranking.get("recommended_next_action") or "").strip()

    next_action = str(
        opportunity_ranking.get("recommended_next_action")
        or ai_lead_prioritization.get("reasoning")
        or ai_revenue_engine_report.get("recommended_cta")
        or "Review company card and proceed with the safest next step."
    ).strip()

    return {
        "generated_at": datetime.utcnow().isoformat(),
        "auto_updated": True,
        "priority": {
            "tier": priority_tier,
            "score": priority_score,
            "reasoning": str(ai_lead_prioritization.get("reasoning") or ""),
        },
        "health": {
            "status": health_status,
            "score": health_score,
            "reasoning": str(ai_risk_analyzer.get("reasons", [""])[0] if isinstance(ai_risk_analyzer.get("reasons"), list) and ai_risk_analyzer.get("reasons") else ""),
        },
        "buying_intent": {
            "score": _safe_score(buying_intent.get("buying_signal_score"), 0),
            "urgency": str(buying_intent.get("urgency") or ""),
            "reasoning": str(buying_intent.get("explanation") or ""),
        },
        "risk": {
            "score": risk_score,
            "level": "High" if risk_score >= 70 else "Medium" if risk_score >= 45 else "Low",
            "top_reasons": [str(item) for item in ai_risk_analyzer.get("reasons", []) if str(item or "").strip()][:3] if isinstance(ai_risk_analyzer.get("reasons"), list) else [],
        },
        "relationship_status": relationship_status,
        "next_action": next_action,
        "last_ai_review": datetime.utcnow().isoformat(),
        "upcoming_opportunity": upcoming_opportunity,
    }


def _build_ai_ceo_dashboard(
    *,
    lead: Lead,
    company: Company | None,
    ai_crm: dict[str, Any],
    ai_live_buying_signals: dict[str, Any],
    ai_competitor_intelligence: dict[str, Any],
    ai_revenue_engine_report: dict[str, Any],
    ai_executive_dashboard: dict[str, Any],
    ai_company_predictions: dict[str, Any],
    opportunity_ranking: dict[str, Any],
    ai_risk_analyzer: dict[str, Any],
) -> dict[str, Any]:
    today = datetime.utcnow().date().isoformat()
    top_opportunities = ai_revenue_engine_report.get("top_opportunities") if isinstance(ai_revenue_engine_report.get("top_opportunities"), list) else []
    if not top_opportunities:
        top_opportunities = opportunity_ranking.get("top_positive_signals") if isinstance(opportunity_ranking.get("top_positive_signals"), list) else []
    todays_best_opportunities = [str(item) for item in top_opportunities if str(item or "").strip()][:5]

    latest_changes = ai_live_buying_signals.get("latest_changes") if isinstance(ai_live_buying_signals.get("latest_changes"), list) else []
    new_buying_signals = [
        {
            "change_type": str(item.get("change_type") or ""),
            "added": [str(v) for v in item.get("added", []) if str(v or "").strip()] if isinstance(item.get("added"), list) else [],
            "detected_at": str(item.get("detected_at") or ""),
        }
        for item in latest_changes
        if isinstance(item, dict)
    ]

    risk_score = _safe_score(ai_risk_analyzer.get("risk_score"), 0)
    companies_at_risk = []
    if risk_score >= 55:
        companies_at_risk.append(
            {
                "company": str((company.name if company else None) or lead.company or ""),
                "risk_score": risk_score,
                "risk_level": "High" if risk_score >= 70 else "Medium",
                "top_reasons": [str(item) for item in ai_risk_analyzer.get("reasons", []) if str(item or "").strip()][:3] if isinstance(ai_risk_analyzer.get("reasons"), list) else [],
            }
        )

    competitors = {
        "companies": [str(item) for item in ai_competitor_intelligence.get("competitors", []) if str(item or "").strip()] if isinstance(ai_competitor_intelligence.get("competitors"), list) else [],
        "market_gaps": [str(item) for item in ai_competitor_intelligence.get("market_gaps", []) if str(item or "").strip()] if isinstance(ai_competitor_intelligence.get("market_gaps"), list) else [],
        "positioning": str(ai_competitor_intelligence.get("positioning") or ""),
        "opportunity_to_sell": str(ai_competitor_intelligence.get("opportunity_to_sell") or ""),
    }

    sales_pipeline = {
        "crm_stage": str((company.crm_stage if company else "") or ai_crm.get("relationship_status") or "New Lead"),
        "relationship_status": str(ai_crm.get("relationship_status") or "New"),
        "next_action": str(ai_crm.get("next_action") or ""),
    }

    arr_prediction = ai_company_predictions.get("estimated_arr") if isinstance(ai_company_predictions.get("estimated_arr"), dict) else {}
    expected_revenue = {
        "estimated_arr_score": _safe_score(arr_prediction.get("score"), 0),
        "estimated_arr_reasoning": str(arr_prediction.get("reasoning") or ""),
        "opportunity_score": _safe_score((ai_revenue_engine_report.get("overall_opportunity_score") or {}).get("score") if isinstance(ai_revenue_engine_report.get("overall_opportunity_score"), dict) else 0, 0),
    }

    ai_recommendations = _dedupe_text_values(
        [
            str(ai_crm.get("next_action") or "").strip(),
            str(ai_executive_dashboard.get("recommended_next_action") or "").strip(),
            str(ai_revenue_engine_report.get("recommended_cta") or "").strip(),
            str((ai_revenue_engine_report.get("recommended_outreach_strategy") or {}).get("why_contact_now") or "").strip()
            if isinstance(ai_revenue_engine_report.get("recommended_outreach_strategy"), dict)
            else "",
        ]
    )
    top_priorities = ai_recommendations[:3]
    while len(top_priorities) < 3:
        top_priorities.append("Continue monitoring buying signals and prioritize the safest high-confidence action.")

    daily_summary = (
        f"{today}: {len(todays_best_opportunities)} top opportunities, "
        f"{len(new_buying_signals)} new buying signal changes, "
        f"{len(companies_at_risk)} companies at risk. "
        f"Primary priority: {top_priorities[0]}"
    )

    return {
        "generated_at": datetime.utcnow().isoformat(),
        "auto_updated": True,
        "todays_best_opportunities": todays_best_opportunities,
        "new_buying_signals": new_buying_signals,
        "companies_at_risk": companies_at_risk,
        "competitors": competitors,
        "sales_pipeline": sales_pipeline,
        "expected_revenue": expected_revenue,
        "ai_recommendations": ai_recommendations,
        "top_priorities": top_priorities,
        "daily_summary": daily_summary,
    }


def _sales_os_agent_result(
    *,
    name: str,
    output: dict[str, Any],
    reasoning: list[str],
    evidence: list[dict[str, Any]],
    confidence: int,
) -> dict[str, Any]:
    return {
        "agent": name,
        "status": "complete" if output else "insufficient_data",
        "output": output,
        "reasoning": [str(item) for item in reasoning if str(item or "").strip()],
        "evidence": _dedupe_evidence_items(evidence),
        "confidence": _safe_score(confidence, 30),
        "no_fabrication": True,
    }


def _build_ai_sales_os(
    *,
    lead: Lead,
    company: Company | None,
    company_intelligence: dict[str, Any],
    decision_maker_intelligence: dict[str, Any],
    ai_competitor_intelligence: dict[str, Any],
    ai_outreach_strategy: dict[str, Any],
    ai_sales_timeline: dict[str, Any],
    ai_live_buying_signals: dict[str, Any],
    ai_crm: dict[str, Any],
    ai_company_predictions: dict[str, Any],
    ai_risk_analyzer: dict[str, Any],
    ai_revenue_engine_report: dict[str, Any],
    opportunity_ranking: dict[str, Any],
    ai_ceo_dashboard: dict[str, Any],
) -> dict[str, Any]:
    report = company_intelligence.get("report") if isinstance(company_intelligence.get("report"), dict) else {}
    buying_intent = company_intelligence.get("buying_intent") if isinstance(company_intelligence.get("buying_intent"), dict) else {}
    profiles = decision_maker_intelligence.get("profiles") if isinstance(decision_maker_intelligence.get("profiles"), list) else []
    top_profile = profiles[0] if profiles and isinstance(profiles[0], dict) else {}
    latest_changes = ai_live_buying_signals.get("latest_changes") if isinstance(ai_live_buying_signals.get("latest_changes"), list) else []
    sales_steps = ai_sales_timeline.get("steps") if isinstance(ai_sales_timeline.get("steps"), list) else []

    research_output = {
        "company_name": str((company.name if company else None) or lead.company or ""),
        "company_summary": str((report.get("company_summary") or {}).get("value") or "") if isinstance(report.get("company_summary"), dict) else "",
        "sources": [str(item) for item in company_intelligence.get("sources", []) if str(item or "").strip()] if isinstance(company_intelligence.get("sources"), list) else [],
        "missing_fields": [str(item) for item in company_intelligence.get("missing_fields", []) if str(item or "").strip()] if isinstance(company_intelligence.get("missing_fields"), list) else [],
    }
    company_output = {
        "products": [str(item) for item in (report.get("products") or {}).get("value", []) if str(item or "").strip()] if isinstance(report.get("products"), dict) and isinstance((report.get("products") or {}).get("value"), list) else [],
        "icp": str((report.get("icp") or {}).get("value") or "") if isinstance(report.get("icp"), dict) else "",
        "estimated_company_size": (report.get("estimated_company_size") or {}).get("value") if isinstance(report.get("estimated_company_size"), dict) else None,
        "technology_stack": [str(item) for item in (report.get("technology_stack") or {}).get("value", []) if str(item or "").strip()] if isinstance(report.get("technology_stack"), dict) and isinstance((report.get("technology_stack") or {}).get("value"), list) else [],
    }
    buying_output = {
        "buying_signal_score": _safe_score(buying_intent.get("buying_signal_score"), 0),
        "urgency": str(buying_intent.get("urgency") or ""),
        "new_signals": [
            {
                "change_type": str(item.get("change_type") or ""),
                "added": [str(v) for v in item.get("added", []) if str(v or "").strip()] if isinstance(item.get("added"), list) else [],
                "detected_at": str(item.get("detected_at") or ""),
            }
            for item in latest_changes
            if isinstance(item, dict)
        ],
    }
    decision_maker_output = {
        "top_contact_id": top_profile.get("contact_id"),
        "name": top_profile.get("name"),
        "title": top_profile.get("title"),
        "authority_level": top_profile.get("estimated_authority_level"),
        "is_verified_contact": bool(top_profile.get("is_verified_contact")),
    }
    competitor_output = {
        "competitors": [str(item) for item in ai_competitor_intelligence.get("competitors", []) if str(item or "").strip()] if isinstance(ai_competitor_intelligence.get("competitors"), list) else [],
        "market_gaps": [str(item) for item in ai_competitor_intelligence.get("market_gaps", []) if str(item or "").strip()] if isinstance(ai_competitor_intelligence.get("market_gaps"), list) else [],
        "opportunity_to_sell": str(ai_competitor_intelligence.get("opportunity_to_sell") or ""),
    }
    email_output = {
        "subject": str(ai_outreach_strategy.get("best_subject_line") or ""),
        "first_sentence": str(ai_outreach_strategy.get("first_sentence") or ""),
        "cta": str(ai_outreach_strategy.get("cta") or ""),
        "channel": str(ai_outreach_strategy.get("best_communication_channel") or ai_outreach_strategy.get("best_channel") or ""),
    }
    follow_up_output = {
        "strategy": [str(item) for item in (ai_revenue_engine_report.get("recommended_follow_up_strategy") or {}).get("schedule", []) if str(item or "").strip()] if isinstance(ai_revenue_engine_report.get("recommended_follow_up_strategy"), dict) and isinstance((ai_revenue_engine_report.get("recommended_follow_up_strategy") or {}).get("schedule"), list) else [],
        "timeline_steps": [
            {
                "step": str(item.get("step") or ""),
                "action": str(item.get("action") or ""),
                "success_probability": _safe_score(item.get("success_probability"), 0),
            }
            for item in sales_steps
            if isinstance(item, dict)
        ][:5],
    }
    crm_output = {
        "priority": ai_crm.get("priority") if isinstance(ai_crm.get("priority"), dict) else {},
        "relationship_status": str(ai_crm.get("relationship_status") or ""),
        "next_action": str(ai_crm.get("next_action") or ""),
        "last_ai_review": str(ai_crm.get("last_ai_review") or ""),
    }
    analytics_output = {
        "opportunity_score": _safe_score(opportunity_ranking.get("overall_score"), 0),
        "confidence": _safe_score(opportunity_ranking.get("confidence"), 0),
        "risk_score": _safe_score(ai_risk_analyzer.get("risk_score"), 0),
        "predictions": {
            "estimated_arr": ai_company_predictions.get("estimated_arr") if isinstance(ai_company_predictions.get("estimated_arr"), dict) else {},
            "growth_probability": ai_company_predictions.get("growth_probability") if isinstance(ai_company_predictions.get("growth_probability"), dict) else {},
            "sales_readiness": ai_company_predictions.get("sales_readiness") if isinstance(ai_company_predictions.get("sales_readiness"), dict) else {},
        },
    }
    ceo_output = {
        "daily_summary": str(ai_ceo_dashboard.get("daily_summary") or ""),
        "top_priorities": [str(item) for item in ai_ceo_dashboard.get("top_priorities", []) if str(item or "").strip()] if isinstance(ai_ceo_dashboard.get("top_priorities"), list) else [],
        "expected_revenue": ai_ceo_dashboard.get("expected_revenue") if isinstance(ai_ceo_dashboard.get("expected_revenue"), dict) else {},
    }

    agents = {
        "research_agent": _sales_os_agent_result(
            name="Research Agent",
            output=research_output,
            reasoning=[
                "Research Agent only uses enriched company intelligence fields and source traces.",
                "Missing fields remain explicit instead of inferred.",
            ],
            evidence=[
                {"source_field": "company_intelligence.summary", "value": str(company_intelligence.get("summary") or ""), "confidence": 75},
            ],
            confidence=75,
        ),
        "company_agent": _sales_os_agent_result(
            name="Company Agent",
            output=company_output,
            reasoning=["Company Agent extracts structured company profile information from enriched report fields."],
            evidence=[
                {"source_field": "company_intelligence.report.icp", "value": str(company_output.get("icp") or ""), "confidence": 74},
            ],
            confidence=74,
        ),
        "buying_agent": _sales_os_agent_result(
            name="Buying Agent",
            output=buying_output,
            reasoning=["Buying Agent combines buying-intent score and detected live signal changes."],
            evidence=[
                {"source_field": "company_intelligence.buying_intent.buying_signal_score", "value": str(buying_output.get("buying_signal_score") or ""), "confidence": 82},
            ],
            confidence=82,
        ),
        "decision_maker_agent": _sales_os_agent_result(
            name="Decision Maker Agent",
            output=decision_maker_output,
            reasoning=["Decision Maker Agent ranks known contacts from decision-maker intelligence only."],
            evidence=[
                {"source_field": "decision_maker_intelligence.top_contact_id", "value": str(decision_maker_output.get("top_contact_id") or ""), "confidence": 80},
            ],
            confidence=80,
        ),
        "competitor_agent": _sales_os_agent_result(
            name="Competitor Agent",
            output=competitor_output,
            reasoning=["Competitor Agent summarizes competitor and market-gap enrichment artifacts."],
            evidence=[
                {"source_field": "ai_competitor_intelligence.opportunity_to_sell", "value": str(competitor_output.get("opportunity_to_sell") or ""), "confidence": 72},
            ],
            confidence=72,
        ),
        "email_agent": _sales_os_agent_result(
            name="Email Agent",
            output=email_output,
            reasoning=["Email Agent uses generated outreach strategy fields only."],
            evidence=[
                {"source_field": "ai_outreach_strategy.best_subject_line", "value": str(email_output.get("subject") or ""), "confidence": 76},
            ],
            confidence=76,
        ),
        "follow_up_agent": _sales_os_agent_result(
            name="Follow-up Agent",
            output=follow_up_output,
            reasoning=["Follow-up Agent uses existing follow-up schedules and sales timeline steps."],
            evidence=[
                {"source_field": "ai_sales_timeline.steps", "value": str(len(follow_up_output.get("timeline_steps") or [])), "confidence": 70},
            ],
            confidence=70,
        ),
        "crm_agent": _sales_os_agent_result(
            name="CRM Agent",
            output=crm_output,
            reasoning=["CRM Agent reflects AI CRM summary fields that are already synchronized to company metadata."],
            evidence=[
                {"source_field": "ai_crm.next_action", "value": str(crm_output.get("next_action") or ""), "confidence": 78},
            ],
            confidence=78,
        ),
        "analytics_agent": _sales_os_agent_result(
            name="Analytics Agent",
            output=analytics_output,
            reasoning=["Analytics Agent merges ranking, risk, and predictive signals for quantitative planning."],
            evidence=[
                {"source_field": "opportunity_ranking.overall_score", "value": str(analytics_output.get("opportunity_score") or ""), "confidence": 80},
            ],
            confidence=80,
        ),
        "ceo_agent": _sales_os_agent_result(
            name="CEO Agent",
            output=ceo_output,
            reasoning=["CEO Agent surfaces daily priorities and summary directly from the AI CEO dashboard."],
            evidence=[
                {"source_field": "ai_ceo_dashboard.daily_summary", "value": str(ceo_output.get("daily_summary") or ""), "confidence": 74},
            ],
            confidence=74,
        ),
    }

    execution_order = [
        "research_agent",
        "company_agent",
        "buying_agent",
        "decision_maker_agent",
        "competitor_agent",
        "email_agent",
        "follow_up_agent",
        "crm_agent",
        "analytics_agent",
        "ceo_agent",
    ]
    intermediate_reasoning = {
        key: {
            "reasoning": value.get("reasoning") if isinstance(value.get("reasoning"), list) else [],
            "evidence": value.get("evidence") if isinstance(value.get("evidence"), list) else [],
        }
        for key, value in agents.items()
        if isinstance(value, dict)
    }

    merged_output = {
        "company": company_output,
        "buying": buying_output,
        "decision_maker": decision_maker_output,
        "competitors": competitor_output,
        "email": email_output,
        "follow_up": follow_up_output,
        "crm": crm_output,
        "analytics": analytics_output,
        "ceo": ceo_output,
        "next_action": str(ai_crm.get("next_action") or ai_ceo_dashboard.get("daily_summary") or ""),
    }

    orchestrator = {
        "agent": "The Orchestrator",
        "status": "complete",
        "autonomous": True,
        "execution_order": execution_order,
        "coordination_summary": "The Orchestrator coordinated all agents, merged structured outputs, and preserved intermediate reasoning.",
        "output": merged_output,
        "confidence": _safe_score(round(sum(_safe_score((agents.get(name) or {}).get("confidence"), 0) for name in execution_order) / max(1, len(execution_order))), 45),
    }

    intermediate_reasoning["orchestrator"] = {
        "reasoning": [
            "The Orchestrator sequences all agents and only merges evidence-backed outputs.",
            "No facts are fabricated; missing values are left empty.",
        ],
        "evidence": _dedupe_evidence_items(
            [
                {"source_field": "ai_crm.next_action", "value": str(ai_crm.get("next_action") or ""), "confidence": 78},
                {"source_field": "ai_ceo_dashboard.daily_summary", "value": str(ai_ceo_dashboard.get("daily_summary") or ""), "confidence": 74},
            ]
        ),
    }

    return {
        "generated_at": datetime.utcnow().isoformat(),
        "autonomous": True,
        "safety": {
            "never_fabricate_facts": True,
            "policy": "Agents may only use enriched, persisted, or computed signals; unknown values remain empty.",
        },
        "agents": agents,
        "intermediate_reasoning": intermediate_reasoning,
        "orchestrator": orchestrator,
    }


def _event_texts(value: Any) -> list[str]:
    if isinstance(value, str):
        text = value.strip()
        return [text] if text else []
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item or "").strip()]
    return []


def _live_buying_signal_snapshot(*, lead: Lead | None, metadata: dict[str, Any], company_intelligence: dict[str, Any]) -> dict[str, list[str]]:
    report = company_intelligence.get("report") if isinstance(company_intelligence.get("report"), dict) else {}

    def _report_value(key: str) -> list[str]:
        item = report.get(key)
        if not isinstance(item, dict):
            return []
        return _event_texts(item.get("value"))

    leadership_from_report: list[str] = []
    recommended_dm = report.get("recommended_decision_maker")
    if isinstance(recommended_dm, dict):
        leadership_from_report = _event_texts(recommended_dm.get("value"))

    categories: dict[str, list[str]] = {
        "new_hiring": _dedupe_text_values(
            [
                *_event_texts(metadata.get("hiring_signals")),
                *_event_texts(metadata.get("jobs_signal")),
                *_event_texts(metadata.get("sales_hiring_signals")),
            ]
        ),
        "technology_changes": _dedupe_text_values(
            [
                *_event_texts(metadata.get("technology_changes")),
                *_event_texts(metadata.get("tech_changes")),
                *_report_value("technology_stack"),
            ]
        ),
        "website_changes": _dedupe_text_values(
            [
                *_event_texts(metadata.get("website_changes")),
                *_event_texts(metadata.get("website_change_signal")),
            ]
        ),
        "pricing_changes": _dedupe_text_values(
            [
                *_event_texts(metadata.get("pricing_changes")),
                *_event_texts(metadata.get("pricing_signals")),
            ]
        ),
        "new_products": _dedupe_text_values(
            [
                *_event_texts(metadata.get("product_launches")),
                *_event_texts(metadata.get("launch_signals")),
                *_report_value("products"),
            ]
        ),
        "new_competitors": _dedupe_text_values(
            [
                *_event_texts(metadata.get("competitors")),
                *_report_value("competitors"),
            ]
        ),
        "leadership_changes": _dedupe_text_values(
            [
                *_event_texts(metadata.get("leadership_changes")),
                *_event_texts(metadata.get("management_changes")),
                *_event_texts(metadata.get("recommended_decision_maker")),
                *leadership_from_report,
            ]
        ),
        "market_expansion": _dedupe_text_values(
            [
                *_event_texts(metadata.get("market_expansion")),
                *_event_texts(metadata.get("expansion_signals")),
                *_event_texts(metadata.get("new_locations")),
            ]
        ),
        "new_funding": _dedupe_text_values(
            [
                *_event_texts(metadata.get("funding_signal")),
                *_event_texts(metadata.get("funding_signals")),
            ]
        ),
    }

    return {
        key: value
        for key, value in categories.items()
        if isinstance(value, list)
    }


def _build_ai_live_buying_signals(
    *,
    previous_live_buying_signals: dict[str, Any],
    current_snapshot: dict[str, list[str]],
) -> dict[str, Any]:
    generated_at = datetime.utcnow().isoformat()
    previous_snapshot = (
        previous_live_buying_signals.get("snapshot")
        if isinstance(previous_live_buying_signals.get("snapshot"), dict)
        else {}
    )
    previous_timeline = (
        previous_live_buying_signals.get("change_timeline")
        if isinstance(previous_live_buying_signals.get("change_timeline"), list)
        else []
    )

    latest_changes: list[dict[str, Any]] = []
    timeline_additions: list[dict[str, Any]] = []

    categories = [
        "new_hiring",
        "technology_changes",
        "website_changes",
        "pricing_changes",
        "new_products",
        "new_competitors",
        "leadership_changes",
        "market_expansion",
        "new_funding",
    ]
    for category in categories:
        current_values = [str(item).strip() for item in (current_snapshot.get(category) or []) if str(item or "").strip()]
        previous_values = [str(item).strip() for item in (previous_snapshot.get(category) or []) if str(item or "").strip()]
        previous_set = {item.lower() for item in previous_values}
        added_values = [item for item in current_values if item.lower() not in previous_set]
        if not added_values:
            continue
        change = {
            "change_type": category,
            "added": added_values,
            "previous": previous_values,
            "current": current_values,
            "detected_at": generated_at,
        }
        latest_changes.append(change)
        timeline_additions.append(
            {
                "change_type": category,
                "added": added_values,
                "detected_at": generated_at,
            }
        )

    combined_timeline = [
        item
        for item in [*previous_timeline, *timeline_additions]
        if isinstance(item, dict) and str(item.get("change_type") or "").strip()
    ][-200:]

    return {
        "generated_at": generated_at,
        "latest_changes": latest_changes,
        "change_timeline": combined_timeline,
        "snapshot": current_snapshot,
    }


def _parse_event_datetime(text: str, fallback: datetime) -> datetime:
    value = str(text or "").strip()
    if not value:
        return fallback
    match = re.search(r"(20\d{2})[-/](\d{1,2})[-/](\d{1,2})", value)
    if match:
        year, month, day = int(match.group(1)), int(match.group(2)), int(match.group(3))
        try:
            return datetime(year, month, day)
        except ValueError:
            return fallback
    month_year = re.search(r"\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(20\d{2})\b", value, flags=re.I)
    if month_year:
        month_map = {
            "jan": 1,
            "feb": 2,
            "mar": 3,
            "apr": 4,
            "may": 5,
            "jun": 6,
            "jul": 7,
            "aug": 8,
            "sep": 9,
            "oct": 10,
            "nov": 11,
            "dec": 12,
        }
        month = month_map.get(month_year.group(1).lower()[:3], fallback.month)
        year = int(month_year.group(2))
        return datetime(year, month, 1)
    year_only = re.search(r"\b(20\d{2})\b", value)
    if year_only:
        return datetime(int(year_only.group(1)), 1, 1)
    return fallback


def _timeline_events_for_field(
    *,
    event_type: str,
    source_field: str,
    values: list[str],
    fallback: datetime,
    provider: str,
    enrichment_step: str,
    model_version: str,
    prompt_version: str,
    base_confidence: int,
) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    for index, value in enumerate(values):
        event_dt = _parse_event_datetime(value, fallback + timedelta(seconds=index))
        events.append(
            {
                "event_type": event_type,
                "event_date": event_dt.date().isoformat(),
                "timestamp": event_dt.isoformat(),
                "title": value[:120],
                "details": value,
                "source": source_field,
                "evidence_snippet": value,
                "confidence": _safe_score(base_confidence, 70),
                "provider": provider,
                "enrichment_step": enrichment_step,
                "model_version": model_version,
                "prompt_version": prompt_version,
            }
        )
    return events


def _build_ai_company_timeline(
    *,
    lead: Lead,
    metadata: dict[str, Any],
    company_intelligence: dict[str, Any],
) -> dict[str, Any]:
    now = datetime.utcnow()
    provider = "outreachai-enrichment"
    enrichment_step = "company_timeline"
    model_version = "rules-v1"
    prompt_version = "company-timeline-v1"

    report = company_intelligence.get("report") if isinstance(company_intelligence.get("report"), dict) else {}
    fields = company_intelligence.get("fields") if isinstance(company_intelligence.get("fields"), dict) else {}

    funding_values = _event_texts(metadata.get("funding_signal")) + _event_texts(metadata.get("funding_signals"))
    hiring_values = _event_texts(metadata.get("hiring_signals")) + _event_texts(metadata.get("jobs_signal"))
    technology_values = _event_texts(metadata.get("technology_changes"))
    if not technology_values:
        technology_values = _event_texts((report.get("technology_stack") or {}).get("value")) if isinstance(report.get("technology_stack"), dict) else _event_texts(metadata.get("technologies"))
    website_values = _event_texts(metadata.get("website_changes"))
    if not website_values and lead.website:
        website_values = [f"Website present: {lead.website}"]
    leadership_values = _event_texts(metadata.get("leadership_changes"))
    if not leadership_values:
        leadership_values = _event_texts(metadata.get("recommended_decision_maker"))
    if not leadership_values and isinstance(fields.get("ceo_founder"), dict):
        ceo = fields.get("ceo_founder", {}).get("value")
        if isinstance(ceo, dict) and (ceo.get("name") or ceo.get("title")):
            leadership_values = [f"Leadership signal: {ceo.get('name') or ''} {ceo.get('title') or ''}".strip()]
    location_values = _event_texts(metadata.get("new_locations")) + _event_texts(metadata.get("market_expansion"))
    if not location_values and (lead.city or lead.country):
        location_values = [f"Operating location: {', '.join(part for part in [lead.city, lead.country] if part)}"]
    product_values = _event_texts(metadata.get("product_launches"))
    if not product_values:
        product_values = _event_texts((report.get("products") or {}).get("value")) if isinstance(report.get("products"), dict) else _event_texts(metadata.get("products"))
    partnership_values = _event_texts(metadata.get("partnership_signals")) + _event_texts(metadata.get("partnership_updates"))
    if not partnership_values and metadata.get("partnership_fit"):
        partnership_values = [str(metadata.get("partnership_fit"))]

    events: list[dict[str, Any]] = []
    events.extend(_timeline_events_for_field(event_type="funding_events", source_field="metadata.funding_signal", values=funding_values, fallback=now - timedelta(days=90), provider=provider, enrichment_step=enrichment_step, model_version=model_version, prompt_version=prompt_version, base_confidence=85))
    events.extend(_timeline_events_for_field(event_type="hiring_events", source_field="metadata.hiring_signals", values=hiring_values, fallback=now - timedelta(days=60), provider=provider, enrichment_step=enrichment_step, model_version=model_version, prompt_version=prompt_version, base_confidence=82))
    events.extend(_timeline_events_for_field(event_type="technology_changes", source_field="metadata.technology_changes", values=technology_values, fallback=now - timedelta(days=50), provider=provider, enrichment_step=enrichment_step, model_version=model_version, prompt_version=prompt_version, base_confidence=78))
    events.extend(_timeline_events_for_field(event_type="website_changes", source_field="metadata.website_changes", values=website_values, fallback=now - timedelta(days=40), provider=provider, enrichment_step=enrichment_step, model_version=model_version, prompt_version=prompt_version, base_confidence=75))
    events.extend(_timeline_events_for_field(event_type="leadership_changes", source_field="metadata.leadership_changes", values=leadership_values, fallback=now - timedelta(days=30), provider=provider, enrichment_step=enrichment_step, model_version=model_version, prompt_version=prompt_version, base_confidence=74))
    events.extend(_timeline_events_for_field(event_type="new_locations", source_field="metadata.new_locations", values=location_values, fallback=now - timedelta(days=20), provider=provider, enrichment_step=enrichment_step, model_version=model_version, prompt_version=prompt_version, base_confidence=72))
    events.extend(_timeline_events_for_field(event_type="product_launches", source_field="metadata.product_launches", values=product_values, fallback=now - timedelta(days=15), provider=provider, enrichment_step=enrichment_step, model_version=model_version, prompt_version=prompt_version, base_confidence=76))
    events.extend(_timeline_events_for_field(event_type="partnerships", source_field="metadata.partnership_signals", values=partnership_values, fallback=now - timedelta(days=10), provider=provider, enrichment_step=enrichment_step, model_version=model_version, prompt_version=prompt_version, base_confidence=74))

    events.sort(key=lambda item: str(item.get("timestamp") or ""))
    by_type = {
        "funding_events": [item for item in events if item["event_type"] == "funding_events"],
        "hiring_events": [item for item in events if item["event_type"] == "hiring_events"],
        "technology_changes": [item for item in events if item["event_type"] == "technology_changes"],
        "website_changes": [item for item in events if item["event_type"] == "website_changes"],
        "leadership_changes": [item for item in events if item["event_type"] == "leadership_changes"],
        "new_locations": [item for item in events if item["event_type"] == "new_locations"],
        "product_launches": [item for item in events if item["event_type"] == "product_launches"],
        "partnerships": [item for item in events if item["event_type"] == "partnerships"],
    }
    return {
        "generated_at": now.isoformat(),
        **by_type,
        "events": events,
    }


def _reasoning_text(value: Any) -> str:
    if isinstance(value, list):
        values = [str(item).strip() for item in value if str(item).strip()]
        return "; ".join(values[:3])
    return str(value or "").strip()


def _append_evidence_entries(
    *,
    entries: list[dict[str, Any]],
    insight_key: str,
    reasoning: Any,
    evidence_items: Any,
    provider: str,
    timestamp: str,
    enrichment_step: str,
    model_version: str,
    prompt_version: str,
    default_source: str,
    default_confidence: int = 70,
) -> None:
    reasoning_text = _reasoning_text(reasoning)
    raw_items = evidence_items if isinstance(evidence_items, list) else []
    prepared_items: list[dict[str, Any]] = []
    for item in raw_items:
        if isinstance(item, dict):
            prepared_items.append(item)
            continue
        text = str(item or "").strip()
        if text:
            prepared_items.append(
                {
                    "source_field": default_source,
                    "value": text,
                    "confidence": default_confidence,
                }
            )
    normalized = _dedupe_evidence_items(prepared_items)
    if normalized:
        for item in normalized:
            source_field = str(item.get("source_field") or default_source).strip() or default_source
            evidence_snippet = str(item.get("value") or reasoning_text).strip() or reasoning_text
            if not evidence_snippet:
                continue
            entries.append(
                {
                    "insight_key": insight_key,
                    "provider": provider,
                    "source": source_field,
                    "raw_source": source_field,
                    "evidence_snippet": evidence_snippet,
                    "reasoning": reasoning_text,
                    "confidence": _safe_score(item.get("confidence"), default_confidence),
                    "timestamp": timestamp,
                    "enrichment_step": enrichment_step,
                    "model_version": model_version,
                    "prompt_version": prompt_version,
                }
            )
        return
    if not reasoning_text:
        return
    entries.append(
        {
            "insight_key": insight_key,
            "provider": provider,
            "source": default_source,
            "raw_source": default_source,
            "evidence_snippet": reasoning_text,
            "reasoning": reasoning_text,
            "confidence": _safe_score(default_confidence, 60),
            "timestamp": timestamp,
            "enrichment_step": enrichment_step,
            "model_version": model_version,
            "prompt_version": prompt_version,
        }
    )


def _build_ai_evidence_engine(
    *,
    company_intelligence: dict[str, Any],
    opportunity_ranking: dict[str, Any],
    ai_outreach_strategy: dict[str, Any],
    ai_competitor_intelligence: dict[str, Any],
    ai_company_timeline: dict[str, Any],
    ai_company_predictions: dict[str, Any],
    ai_sales_timeline: dict[str, Any],
    ai_risk_analyzer: dict[str, Any],
    ai_sales_coach: dict[str, Any],
    enrichment_step: str,
) -> dict[str, Any]:
    provider = "outreachai-enrichment"
    model_version = "rules-v1"
    prompt_version = "evidence-engine-v1"
    timestamp = datetime.utcnow().isoformat()
    entries: list[dict[str, Any]] = []

    _append_evidence_entries(
        entries=entries,
        insight_key="company_intelligence.summary",
        reasoning=(company_intelligence.get("report") or {}).get("company_summary", {}).get("value") if isinstance((company_intelligence.get("report") or {}).get("company_summary"), dict) else "",
        evidence_items=(company_intelligence.get("report") or {}).get("company_summary", {}).get("sources") if isinstance((company_intelligence.get("report") or {}).get("company_summary"), dict) else [],
        provider=provider,
        timestamp=timestamp,
        enrichment_step=enrichment_step,
        model_version=model_version,
        prompt_version=prompt_version,
        default_source="company_intelligence.report.company_summary",
        default_confidence=80,
    )

    _append_evidence_entries(
        entries=entries,
        insight_key="opportunity_ranking.reasoning",
        reasoning=opportunity_ranking.get("reasoning"),
        evidence_items=[
            {
                "source_field": "opportunity_ranking.top_positive_signals",
                "value": str(item),
                "confidence": _safe_score(opportunity_ranking.get("confidence"), 70),
            }
            for item in (opportunity_ranking.get("top_positive_signals") or [])
            if str(item).strip()
        ],
        provider=provider,
        timestamp=timestamp,
        enrichment_step=enrichment_step,
        model_version=model_version,
        prompt_version=prompt_version,
        default_source="opportunity_ranking.reasoning",
        default_confidence=_safe_score(opportunity_ranking.get("confidence"), 70),
    )

    outreach_fields = [
        "why_contact_now",
        "best_timing",
        "best_communication_channel",
        "best_email_length",
        "best_subject_line",
        "first_sentence",
        "strongest_value_proposition",
        "strongest_pain_point",
        "expected_objections",
        "cta",
        "follow_up_schedule",
        "estimated_reply_probability",
    ]
    for field in outreach_fields:
        _append_evidence_entries(
            entries=entries,
            insight_key=f"ai_outreach_strategy.{field}",
            reasoning=ai_outreach_strategy.get(field),
            evidence_items=ai_outreach_strategy.get(f"{field}_evidence"),
            provider=provider,
            timestamp=timestamp,
            enrichment_step=enrichment_step,
            model_version=model_version,
            prompt_version=prompt_version,
            default_source=f"ai_outreach_strategy.{field}",
            default_confidence=75,
        )

    for field in ["positioning", "strengths", "weaknesses", "market_gaps", "opportunity_to_sell"]:
        _append_evidence_entries(
            entries=entries,
            insight_key=f"ai_competitor_intelligence.{field}",
            reasoning=ai_competitor_intelligence.get(field),
            evidence_items=[
                {
                    "source_field": f"ai_competitor_intelligence.{field}",
                    "value": str(item),
                    "confidence": 70,
                }
                for item in (ai_competitor_intelligence.get(field) if isinstance(ai_competitor_intelligence.get(field), list) else [ai_competitor_intelligence.get(field)])
                if str(item or "").strip()
            ],
            provider=provider,
            timestamp=timestamp,
            enrichment_step=enrichment_step,
            model_version=model_version,
            prompt_version=prompt_version,
            default_source=f"ai_competitor_intelligence.{field}",
            default_confidence=70,
        )

    if isinstance(ai_company_timeline.get("events"), list):
        for item in ai_company_timeline.get("events", []):
            if not isinstance(item, dict):
                continue
            event_type = str(item.get("event_type") or "timeline_event").strip().lower()
            _append_evidence_entries(
                entries=entries,
                insight_key=f"ai_company_timeline.{event_type}",
                reasoning=item.get("details") or item.get("title"),
                evidence_items=[
                    {
                        "source_field": str(item.get("source") or "ai_company_timeline"),
                        "value": str(item.get("evidence_snippet") or item.get("details") or item.get("title") or ""),
                        "confidence": _safe_score(item.get("confidence"), 70),
                    }
                ],
                provider=provider,
                timestamp=str(item.get("timestamp") or timestamp),
                enrichment_step=enrichment_step,
                model_version=model_version,
                prompt_version=prompt_version,
                default_source="ai_company_timeline.events",
                default_confidence=_safe_score(item.get("confidence"), 70),
            )

    for field in ["estimated_arr", "company_maturity", "growth_probability", "sales_readiness"]:
        prediction = ai_company_predictions.get(field) if isinstance(ai_company_predictions.get(field), dict) else {}
        _append_evidence_entries(
            entries=entries,
            insight_key=f"ai_company_predictions.{field}",
            reasoning=prediction.get("reasoning"),
            evidence_items=prediction.get("evidence"),
            provider=provider,
            timestamp=timestamp,
            enrichment_step=enrichment_step,
            model_version=model_version,
            prompt_version=prompt_version,
            default_source=f"ai_company_predictions.{field}",
            default_confidence=_safe_score(prediction.get("confidence"), 70),
        )

    if isinstance(ai_sales_timeline.get("steps"), list):
        for item in ai_sales_timeline.get("steps", []):
            if not isinstance(item, dict):
                continue
            step_name = str(item.get("step") or "timeline_step").strip().lower().replace(" ", "_")
            _append_evidence_entries(
                entries=entries,
                insight_key=f"ai_sales_timeline.{step_name}.action",
                reasoning=item.get("action"),
                evidence_items=item.get("evidence"),
                provider=provider,
                timestamp=timestamp,
                enrichment_step=enrichment_step,
                model_version=model_version,
                prompt_version=prompt_version,
                default_source=f"ai_sales_timeline.{step_name}",
                default_confidence=_safe_score(item.get("success_probability"), 65),
            )

    risk_fields = [
        "probability_company_will_ignore_outreach",
        "missing_data",
        "weak_personalization",
        "missing_decision_maker",
        "low_confidence",
        "stale_enrichment",
        "risk_score",
        "reasons",
        "recommended_improvements",
        "confidence",
    ]
    for field in risk_fields:
        factor_evidence = []
        if isinstance(ai_risk_analyzer.get("factors"), dict):
            for factor in ai_risk_analyzer.get("factors", {}).values():
                if isinstance(factor, dict) and isinstance(factor.get("evidence"), list):
                    factor_evidence.extend(factor.get("evidence") or [])
        _append_evidence_entries(
            entries=entries,
            insight_key=f"ai_risk_analyzer.{field}",
            reasoning=ai_risk_analyzer.get(field),
            evidence_items=factor_evidence,
            provider=provider,
            timestamp=timestamp,
            enrichment_step=enrichment_step,
            model_version=model_version,
            prompt_version=prompt_version,
            default_source=f"ai_risk_analyzer.{field}",
            default_confidence=_safe_score(ai_risk_analyzer.get("confidence"), 70),
        )

    coach_fields = [
        "why_this_company",
        "why_now",
        "why_this_decision_maker",
        "what_could_fail",
        "how_to_increase_reply_rate",
        "alternative_strategy",
    ]
    for field in coach_fields:
        _append_evidence_entries(
            entries=entries,
            insight_key=f"ai_sales_coach.{field}",
            reasoning=ai_sales_coach.get(field),
            evidence_items=ai_sales_coach.get("evidence"),
            provider=provider,
            timestamp=timestamp,
            enrichment_step=enrichment_step,
            model_version=model_version,
            prompt_version=prompt_version,
            default_source=f"ai_sales_coach.{field}",
            default_confidence=_safe_score(ai_sales_coach.get("confidence"), 70),
        )

    by_insight: dict[str, list[dict[str, Any]]] = {}
    for entry in entries:
        key = str(entry.get("insight_key") or "")
        if not key:
            continue
        by_insight.setdefault(key, []).append(
            {
                "source": entry.get("source"),
                "evidence": entry.get("evidence_snippet"),
                "reasoning": entry.get("reasoning"),
                "confidence": entry.get("confidence"),
                "timestamp": entry.get("timestamp"),
                "provider": entry.get("provider"),
            }
        )

    return {
        "generated_at": timestamp,
        "provider": provider,
        "model_version": model_version,
        "prompt_version": prompt_version,
        "entries": entries,
        "by_insight": by_insight,
    }


def _detect_buying_intent(metadata: dict[str, Any]) -> dict[str, Any]:
    signal_specs = [
        {
            "name": "active_hiring",
            "weight": 12,
            "keys": ["hiring_signals", "jobs_signal"],
            "patterns": [r"\bhiring\b", r"\bwe'?re hiring\b", r"\bopen roles?\b", r"\bjob openings?\b"],
        },
        {
            "name": "recent_funding",
            "weight": 14,
            "keys": ["funding_signal", "funding_signals"],
            "patterns": [r"\braised\b", r"\bseries [abcde]\b", r"\bseed\b", r"\bfunding\b", r"\binvestment\b"],
        },
        {
            "name": "technology_changes",
            "weight": 10,
            "keys": ["technology_changes", "tech_changes", "technologies"],
            "patterns": [r"\bmigrat(ed|ion)\b", r"\bnew stack\b", r"\breplatform\b", r"\bintegration\b"],
        },
        {
            "name": "website_changes",
            "weight": 8,
            "keys": ["website_changes", "website_change_signal"],
            "patterns": [r"\bredesign\b", r"\bsite update\b", r"\bnew website\b", r"\bupdated website\b"],
        },
        {
            "name": "product_launches",
            "weight": 12,
            "keys": ["product_launches", "launch_signals"],
            "patterns": [r"\blaunch(ed)?\b", r"\bnew product\b", r"\brelease(d)?\b", r"\bintroduced\b"],
        },
        {
            "name": "expansion_new_markets",
            "weight": 10,
            "keys": ["expansion_signals", "market_expansion"],
            "patterns": [r"\bexpan(d|sion)\b", r"\bnew market\b", r"\bnew region\b", r"\bnew country\b"],
        },
        {
            "name": "open_sales_positions",
            "weight": 10,
            "keys": ["sales_hiring_signals", "hiring_signals", "jobs_signal"],
            "patterns": [r"\baccount executive\b", r"\bsdr\b", r"\bbdr\b", r"\bsales rep\b", r"\bhead of sales\b"],
        },
        {
            "name": "new_partnerships",
            "weight": 9,
            "keys": ["partnership_signals", "partnership_updates"],
            "patterns": [r"\bpartner(ship|ed)?\b", r"\balliance\b", r"\bstrategic partner\b", r"\bco-sell\b"],
        },
        {
            "name": "pricing_changes",
            "weight": 8,
            "keys": ["pricing_changes", "pricing_signals"],
            "patterns": [r"\bpricing\b", r"\bprice increase\b", r"\bnew plan(s)?\b", r"\bpackag(e|ing)\b"],
        },
        {
            "name": "customer_growth_indicators",
            "weight": 9,
            "keys": ["customer_growth_signals", "growth_signal"],
            "patterns": [r"\bcustomer(s)?\b", r"\buser growth\b", r"\badoption\b", r"\bexpanding customer base\b"],
        },
        {
            "name": "blog_news_activity",
            "weight": 8,
            "keys": ["blog_news_activity", "news_activity", "blog_activity"],
            "patterns": [r"\bblog\b", r"\bnews\b", r"\bpress\b", r"\bannouncement\b", r"\bupdate\b"],
        },
    ]

    fallback_sources = {
        key: _metadata_texts(metadata.get(key))
        for key in [
            "buying_signals",
            "hiring_signals",
            "jobs_signal",
            "funding_signal",
            "growth_signal",
            "blog_news_activity",
            "pricing_signals",
            "product_launches",
            "expansion_signals",
            "technology_changes",
            "website_changes",
            "customer_growth_signals",
            "partnership_signals",
            "news_activity",
            "blog_activity",
        ]
    }

    per_signal: list[dict[str, Any]] = []
    evidence: list[dict[str, Any]] = []
    raw_score = 0
    confidence_values: list[int] = []

    for spec in signal_specs:
        signal_name = str(spec["name"])
        weight = int(spec["weight"])
        keys = [str(item) for item in spec["keys"]]
        patterns = [str(item) for item in spec["patterns"]]
        signal_evidence: list[dict[str, Any]] = []

        for key in keys:
            for text in _metadata_texts(metadata.get(key)):
                signal_evidence.append(_intent_evidence(signal_name, key, text, 85))

        if not signal_evidence:
            for source_field, candidates in fallback_sources.items():
                for text in candidates:
                    if any(re.search(pattern, text, flags=re.I) for pattern in patterns):
                        signal_evidence.append(_intent_evidence(signal_name, source_field, text, 65))

        deduped: list[dict[str, Any]] = []
        seen: set[tuple[str, str]] = set()
        for item in signal_evidence:
            fingerprint = (str(item["source_field"]).lower(), str(item["value"]).strip().lower())
            if fingerprint in seen:
                continue
            seen.add(fingerprint)
            deduped.append(item)

        detected = bool(deduped)
        contribution = weight if detected else 0
        signal_confidence = _safe_score(round(sum(item["confidence"] for item in deduped) / len(deduped))) if deduped else 0
        per_signal.append(
            {
                "signal": signal_name,
                "detected": detected,
                "weight": weight,
                "score": contribution,
                "confidence": signal_confidence,
                "evidence": deduped,
            }
        )
        evidence.extend(deduped)
        raw_score += contribution
        if signal_confidence:
            confidence_values.append(signal_confidence)

    buying_signal_score = _safe_score(round(raw_score * 100 / max(1, sum(int(spec["weight"]) for spec in signal_specs))))
    if buying_signal_score >= 80:
        urgency = "high"
        timing = "Reach out within 24-48 hours"
    elif buying_signal_score >= 55:
        urgency = "medium"
        timing = "Reach out this week"
    elif buying_signal_score >= 30:
        urgency = "low"
        timing = "Nurture and reach out within 2-3 weeks"
    else:
        urgency = "watch"
        timing = "Monitor for new intent signals before outreach"

    top_signals = [item["signal"].replace("_", " ") for item in per_signal if item["detected"]]
    explanation = (
        f"Detected {len(top_signals)} evidence-backed buying signals: {', '.join(top_signals[:4])}."
        if top_signals
        else "No evidence-backed buying intent signals were detected from current enrichment data."
    )

    confidence = _safe_score(round(sum(confidence_values) / len(confidence_values))) if confidence_values else 35
    return {
        "buying_signal_score": buying_signal_score,
        "urgency": urgency,
        "explanation": explanation,
        "evidence": evidence,
        "confidence": confidence,
        "recommended_outreach_timing": timing,
        "signals": per_signal,
    }


def _company_intelligence_cache_key(lead: Lead, metadata: dict[str, Any], company: Company | None = None) -> str:
    domain = normalize_domain(str((company.domain if company else "") or metadata.get("domain") or lead.website or lead.company or ""))
    if domain:
        return f"domain:{domain}"
    place_id = str((company.place_id if company else "") or metadata.get("place_id") or "").strip()
    if place_id:
        return f"place:{place_id}"
    city = str((company.city if company else "") or lead.city or "").strip().lower()
    return f"name:{(lead.company or (company.name if company else '') or '').strip().lower()}:{city}"


def _fresh_company_intelligence(metadata: dict[str, Any]) -> dict[str, Any] | None:
    payload = metadata.get("company_intelligence") if isinstance(metadata.get("company_intelligence"), dict) else None
    if not payload:
        return None
    raw_updated = str(payload.get("generated_at") or metadata.get("company_intelligence_cached_at") or "").strip()
    if not raw_updated:
        return None
    try:
        updated_at = datetime.fromisoformat(raw_updated.replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
        return None
    settings = get_settings()
    cache_hours = max(1, min(168, int(settings.enrichment_cache_hours or 24)))
    return payload if datetime.utcnow() - updated_at < timedelta(hours=cache_hours) else None


def _build_company_intelligence(
    *,
    lead: Lead,
    metadata: dict[str, Any],
    workspace,
    company: Company | None = None,
    contacts: list[Contact] | None = None,
) -> dict[str, Any]:
    contacts = contacts or []
    deep_contact = metadata.get("deep_contact_search") if isinstance(metadata.get("deep_contact_search"), dict) else {}
    profile = deep_contact.get("company_profile") if isinstance(deep_contact.get("company_profile"), dict) else {}
    selected = deep_contact.get("selected_decision_maker") if isinstance(deep_contact.get("selected_decision_maker"), dict) else {}
    candidates = deep_contact.get("candidates") if isinstance(deep_contact.get("candidates"), list) else []
    source_types = _dedupe_text_values(
        [
            "CRM profile",
            "Public business listing" if metadata.get("place_id") or metadata.get("google_maps_url") else "",
            "Website analysis" if metadata.get("ai_summary") or metadata.get("opportunity_analysis") else "",
            "Contact enrichment" if contacts or selected or candidates else "",
            "Email verification" if lead.email or (company and company.email) or deep_contact.get("verified_email") else "",
            "Technographic enrichment" if metadata.get("technologies") or deep_contact.get("technologies") else "",
        ]
    )
    technologies = _dedupe_text_values(
        [
            *(metadata.get("technologies") if isinstance(metadata.get("technologies"), list) else []),
            *(deep_contact.get("technologies") if isinstance(deep_contact.get("technologies"), list) else []),
        ]
    )
    contact_linkedins = _dedupe_text_values(
        [
            *[contact.linkedin for contact in contacts if contact.linkedin],
            *[item.get("linkedin") for item in candidates if isinstance(item, dict) and item.get("linkedin")],
            selected.get("linkedin") if selected else "",
        ]
    )
    verified_emails = _dedupe_text_values(
        [
            lead.email,
            company.email if company else "",
            deep_contact.get("verified_email"),
            *[contact.email for contact in contacts if contact.email],
        ]
    )
    phones = _dedupe_text_values([lead.phone, company.phone if company else "", metadata.get("phone")])
    social_profiles = _dedupe_text_values(
        [
            metadata.get("company_linkedin"),
            metadata.get("linkedin_url"),
            metadata.get("facebook_url"),
            metadata.get("instagram_url"),
            metadata.get("twitter_url"),
            metadata.get("google_maps_url"),
        ]
    )
    official_site = (company.website if company else "") or lead.website or profile.get("website") or (
        f"https://{company.domain}" if company and company.domain else ""
    )
    employee_count = (
        metadata.get("employee_count")
        or metadata.get("employees")
        or profile.get("estimated_num_employees")
        or profile.get("employee_count")
    )
    buying_signals = _dedupe_text_values(metadata.get("buying_signals") if isinstance(metadata.get("buying_signals"), list) else [])
    score = 20
    score += 12 if official_site else 0
    score += 10 if metadata.get("ai_summary") or metadata.get("opportunity_analysis") else 0
    score += 12 if selected or contacts else 0
    score += 16 if verified_emails else 0
    score += 8 if phones else 0
    score += 8 if technologies else 0
    score += 8 if employee_count else 0
    score += min(12, len(buying_signals) * 3)
    score = _safe_score(metadata.get("priority_score") or deep_contact.get("lead_score"), score)
    missing = [
        label
        for label, present in [
            ("official website", official_site),
            ("decision maker", selected or contacts),
            ("verified email", verified_emails),
            ("employee count", employee_count),
            ("company LinkedIn", metadata.get("company_linkedin") or metadata.get("linkedin_url")),
            ("technologies", technologies),
            ("growth signals", metadata.get("jobs_signal") or metadata.get("growth_signal") or metadata.get("funding_signal")),
        ]
        if not present
    ]
    ai_reason = str(
        metadata.get("personalized_reason")
        or metadata.get("opportunity_analysis")
        or metadata.get("partnership_fit")
        or metadata.get("sales_angle")
        or metadata.get("suggested_offer")
        or "Use the saved profile and AI summary to validate whether this company matches the workspace ICP before outreach."
    )
    ceo_founder = selected or next(
        (
            item
            for item in candidates
            if isinstance(item, dict) and re.search(r"\b(ceo|founder|owner)\b", str(item.get("title") or ""), flags=re.I)
        ),
        {},
    )
    report_sources = {
        "company_summary": ["AI website analysis"] if metadata.get("ai_summary") else ["CRM profile"],
        "products": ["AI website analysis"] if metadata.get("products") else [],
        "icp": ["AI website analysis"] if metadata.get("icp") else [],
        "estimated_company_size": ["Company enrichment"] if employee_count else [],
        "buying_signals": ["AI website analysis"] if buying_signals else [],
        "hiring_signals": ["Company enrichment"] if metadata.get("hiring_signals") else [],
        "technology_stack": ["Technographic enrichment"] if technologies else [],
        "competitors": ["AI website analysis"] if metadata.get("competitors") else [],
        "possible_pain_points": ["AI website analysis"] if metadata.get("pain_points") else [],
        "best_outreach_angle": ["AI sales reasoning"] if metadata.get("best_outreach_angle") or metadata.get("suggested_offer") or metadata.get("sales_angle") else [],
        "recommended_decision_maker": ["Decision-maker ranking"] if selected or contacts else [],
        "personalization_bullets": ["AI website analysis"] if metadata.get("personalization_bullets") else [],
        "ai_confidence_score": ["AI website analysis"] if metadata.get("confidence_score") else [],
    }
    report = {
        "company_summary": _report_field(
            metadata.get("company_summary") or metadata.get("ai_summary") or metadata.get("summary"),
            sources=report_sources["company_summary"],
            confidence=82 if metadata.get("ai_summary") or metadata.get("company_summary") else 60,
        ),
        "products": _report_field(
            metadata.get("products"),
            sources=report_sources["products"],
            confidence=74 if metadata.get("products") else 0,
        ),
        "icp": _report_field(
            metadata.get("icp"),
            sources=report_sources["icp"],
            confidence=74 if metadata.get("icp") else 0,
        ),
        "estimated_company_size": _report_field(
            metadata.get("estimated_company_size") or employee_count,
            sources=report_sources["estimated_company_size"],
            confidence=72 if employee_count or metadata.get("estimated_company_size") else 0,
        ),
        "buying_signals": _report_field(
            buying_signals,
            sources=report_sources["buying_signals"],
            confidence=70 if buying_signals else 0,
        ),
        "hiring_signals": _report_field(
            metadata.get("hiring_signals") or metadata.get("jobs_signal") or metadata.get("growth_signal"),
            sources=report_sources["hiring_signals"],
            confidence=70 if metadata.get("hiring_signals") or metadata.get("jobs_signal") or metadata.get("growth_signal") else 0,
        ),
        "technology_stack": _report_field(
            technologies,
            sources=report_sources["technology_stack"],
            confidence=76 if technologies else 0,
        ),
        "competitors": _report_field(
            metadata.get("competitors"),
            sources=report_sources["competitors"],
            confidence=68 if metadata.get("competitors") else 0,
        ),
        "possible_pain_points": _report_field(
            metadata.get("pain_points"),
            sources=report_sources["possible_pain_points"],
            confidence=70 if metadata.get("pain_points") else 0,
        ),
        "best_outreach_angle": _report_field(
            metadata.get("best_outreach_angle") or metadata.get("suggested_offer") or metadata.get("sales_angle") or metadata.get("partnership_fit"),
            sources=report_sources["best_outreach_angle"],
            confidence=78 if metadata.get("best_outreach_angle") or metadata.get("suggested_offer") or metadata.get("sales_angle") or metadata.get("partnership_fit") else 0,
        ),
        "recommended_decision_maker": _report_field(
            metadata.get("recommended_decision_maker")
            or (selected.get("name") if isinstance(selected, dict) and selected.get("name") else "")
            or (selected.get("title") if isinstance(selected, dict) and selected.get("title") else "")
            or (contacts[0].name if contacts else ""),
            sources=report_sources["recommended_decision_maker"],
            confidence=int((selected or {}).get("confidence") or 72) if isinstance(selected, dict) and selected else 72 if contacts else 0,
        ),
        "personalization_bullets": _report_field(
            metadata.get("personalization_bullets"),
            sources=report_sources["personalization_bullets"],
            confidence=74 if metadata.get("personalization_bullets") else 0,
        ),
        "ai_confidence_score": _report_field(
            metadata.get("confidence_score") or score,
            sources=report_sources["ai_confidence_score"],
            confidence=_safe_score(metadata.get("confidence_score") or score, 0),
        ),
    }
    buying_intent = _detect_buying_intent(metadata)
    fields = {
        "official_website": _intelligence_field(official_site, source="CRM and public profile", confidence=90 if official_site else 0),
        "business_description": _intelligence_field(metadata.get("ai_summary") or profile.get("short_description") or profile.get("description"), source="AI website analysis", confidence=84 if metadata.get("ai_summary") else 62),
        "industry": _intelligence_field((company.industry if company else "") or lead.industry or lead.niche or metadata.get("business_category"), source="CRM and public profile", confidence=78),
        "employee_count": _intelligence_field(employee_count, source="Company enrichment", confidence=72),
        "technologies": _intelligence_field(technologies, source="Technographic enrichment", confidence=76),
        "company_linkedin": _intelligence_field(metadata.get("company_linkedin") or metadata.get("linkedin_url") or profile.get("linkedin_url"), source="Public profile", confidence=70),
        "key_employee_linkedin": _intelligence_field(contact_linkedins, source="Contact enrichment", confidence=75),
        "ceo_founder": _intelligence_field(ceo_founder, source="Decision-maker ranking", confidence=int((ceo_founder or {}).get("confidence") or 72) if isinstance(ceo_founder, dict) and ceo_founder else 0),
        "verified_emails": _intelligence_field(verified_emails, source="Email verification", confidence=92 if verified_emails else 0),
        "phones": _intelligence_field(phones, source="Public profile and CRM", confidence=80 if phones else 0),
        "social_profiles": _intelligence_field(social_profiles, source="Public profile", confidence=68 if social_profiles else 0),
        "buying_signals": _intelligence_field(buying_signals, source="AI and public signals", confidence=70 if buying_signals else 0),
        "ai_summary": _intelligence_field(metadata.get("ai_summary"), source="AI website analysis", confidence=82 if metadata.get("ai_summary") else 0),
        "personalized_reason": _intelligence_field(ai_reason, source="AI sales reasoning", confidence=78 if ai_reason else 0),
    }
    return {
        "version": 1,
        "generated_at": datetime.utcnow().isoformat(),
        "cache_key": _company_intelligence_cache_key(lead, metadata, company),
        "sources": source_types,
        "buying_intent": buying_intent,
        "report": report,
        "fields": fields,
        "lead_score": {
            "value": score,
            "confidence": _safe_score(metadata.get("confidence_score") or deep_contact.get("confidence_score"), int(fields["personalized_reason"]["confidence"] or 55)),
            "reasons": _dedupe_text_values([ai_reason, *buying_signals])[:5],
        },
        "missing_fields": missing,
    }


def _refresh_company_intelligence(db: Session, user_id: str, workspace, lead: Lead, company: Company | None = None) -> dict[str, Any]:
    db.flush()
    metadata = _lead_metadata(lead)
    if company is None:
        company = db.scalar(select(Company).where(Company.workspace_id == workspace.id, Company.lead_id == lead.id).order_by(Company.updated_at.desc()).limit(1))
    contacts: list[Contact] = []
    if company is not None:
        contacts = list(db.scalars(select(Contact).where(Contact.workspace_id == workspace.id, Contact.company_id == company.id).order_by(Contact.updated_at.desc()).limit(20)).all())
        metadata = {**metadata, **(company.metadata_json or {})}
    intelligence = _build_company_intelligence(lead=lead, metadata=metadata, workspace=workspace, company=company, contacts=contacts)
    decision_maker_intelligence = _build_decision_maker_intelligence(
        lead=lead,
        company=company,
        contacts=contacts,
        metadata=metadata,
        company_intelligence=intelligence,
    )
    settings = _settings_for_workspace(db, user_id, workspace)
    learning_weights = continuous_learning_weights(settings.ai if isinstance(settings.ai, dict) else {})
    learning_snapshot = continuous_learning_snapshot(settings.ai if isinstance(settings.ai, dict) else {})
    opportunity_ranking = _opportunity_ranking(
        lead=lead,
        metadata=metadata,
        workspace=workspace,
        company=company,
        contacts=contacts,
        company_intelligence=intelligence,
        decision_maker_intelligence=decision_maker_intelligence,
        opportunity_weights=learning_weights.get("opportunity") if isinstance(learning_weights.get("opportunity"), dict) else None,
    )
    buying_intent = intelligence.get("buying_intent") if isinstance(intelligence.get("buying_intent"), dict) else {}
    ai_outreach_strategy = _build_ai_outreach_strategy(
        lead=lead,
        metadata=metadata,
        contacts=contacts,
        buying_intent=buying_intent,
        decision_maker_intelligence=decision_maker_intelligence,
        opportunity_ranking=opportunity_ranking,
    )
    ai_competitor_intelligence = _build_ai_competitor_intelligence(
        lead=lead,
        metadata=metadata,
        company_intelligence=intelligence,
        opportunity_ranking=opportunity_ranking,
    )
    ai_company_timeline = _build_ai_company_timeline(
        lead=lead,
        metadata=metadata,
        company_intelligence=intelligence,
    )
    ai_sales_timeline = _build_ai_sales_timeline(
        lead=lead,
        metadata=metadata,
        ai_outreach_strategy=ai_outreach_strategy,
        decision_maker_intelligence=decision_maker_intelligence,
    )
    ai_risk_analyzer = _build_ai_risk_analyzer(
        lead=lead,
        metadata=metadata,
        company_intelligence=intelligence,
        decision_maker_intelligence=decision_maker_intelligence,
        ai_outreach_strategy=ai_outreach_strategy,
        opportunity_ranking=opportunity_ranking,
    )
    ai_company_predictions = _build_ai_company_predictions(
        lead=lead,
        metadata=metadata,
        company_intelligence=intelligence,
        decision_maker_intelligence=decision_maker_intelligence,
        opportunity_ranking=opportunity_ranking,
        ai_outreach_strategy=ai_outreach_strategy,
        ai_risk_analyzer=ai_risk_analyzer,
        ai_company_timeline=ai_company_timeline,
    )
    ai_sales_coach = _build_ai_sales_coach(
        lead=lead,
        metadata=metadata,
        company_intelligence=intelligence,
        decision_maker_intelligence=decision_maker_intelligence,
        ai_outreach_strategy=ai_outreach_strategy,
        ai_risk_analyzer=ai_risk_analyzer,
        opportunity_ranking=opportunity_ranking,
    )
    specialized_agents = _build_ai_specialized_agents(
        lead=lead,
        company_intelligence=intelligence,
        decision_maker_intelligence=decision_maker_intelligence,
        ai_outreach_strategy=ai_outreach_strategy,
        ai_competitor_intelligence=ai_competitor_intelligence,
        ai_risk_analyzer=ai_risk_analyzer,
        ai_sales_coach=ai_sales_coach,
        ai_company_predictions=ai_company_predictions,
    )
    ai_specialized_agents = specialized_agents.get("agents") if isinstance(specialized_agents.get("agents"), dict) else {}
    ai_agent_intermediate_reasoning = specialized_agents.get("intermediate_reasoning") if isinstance(specialized_agents.get("intermediate_reasoning"), dict) else {}
    ai_final_orchestrator = specialized_agents.get("final_orchestrator") if isinstance(specialized_agents.get("final_orchestrator"), dict) else {}
    ai_executive_dashboard = _build_ai_executive_dashboard(
        ai_specialized_agents=ai_specialized_agents,
        ai_agent_intermediate_reasoning=ai_agent_intermediate_reasoning,
        ai_final_orchestrator=ai_final_orchestrator,
        opportunity_ranking=opportunity_ranking,
        buying_intent=buying_intent,
        ai_risk_analyzer=ai_risk_analyzer,
        ai_outreach_strategy=ai_outreach_strategy,
        ai_competitor_intelligence=ai_competitor_intelligence,
    )
    previous_live_buying_signals = (
        metadata.get("ai_live_buying_signals")
        if isinstance(metadata.get("ai_live_buying_signals"), dict)
        else {}
    )
    ai_live_buying_signals = _build_ai_live_buying_signals(
        previous_live_buying_signals=previous_live_buying_signals,
        current_snapshot=_live_buying_signal_snapshot(
            lead=lead,
            metadata=metadata,
            company_intelligence=intelligence,
        ),
    )
    ai_lead_prioritization = _lead_prioritization_from_metadata(
        company=company,
        metadata=metadata,
        prioritization_weights=learning_weights.get("prioritization") if isinstance(learning_weights.get("prioritization"), dict) else None,
    )
    ai_revenue_engine_report = _build_ai_revenue_engine_report(
        previous_report=metadata.get("ai_revenue_engine_report") if isinstance(metadata.get("ai_revenue_engine_report"), dict) else {},
        company_intelligence=intelligence,
        opportunity_ranking=opportunity_ranking,
        buying_intent=buying_intent,
        decision_maker_intelligence=decision_maker_intelligence,
        ai_competitor_intelligence=ai_competitor_intelligence,
        ai_sales_coach=ai_sales_coach,
        ai_outreach_strategy=ai_outreach_strategy,
        ai_risk_analyzer=ai_risk_analyzer,
    )
    ai_crm = _build_ai_crm_summary(
        lead=lead,
        company=company,
        metadata=metadata,
        buying_intent=buying_intent,
        ai_risk_analyzer=ai_risk_analyzer,
        ai_lead_prioritization=ai_lead_prioritization,
        opportunity_ranking=opportunity_ranking,
        ai_revenue_engine_report=ai_revenue_engine_report,
    )
    ai_ceo_dashboard = _build_ai_ceo_dashboard(
        lead=lead,
        company=company,
        ai_crm=ai_crm,
        ai_live_buying_signals=ai_live_buying_signals,
        ai_competitor_intelligence=ai_competitor_intelligence,
        ai_revenue_engine_report=ai_revenue_engine_report,
        ai_executive_dashboard=ai_executive_dashboard,
        ai_company_predictions=ai_company_predictions,
        opportunity_ranking=opportunity_ranking,
        ai_risk_analyzer=ai_risk_analyzer,
    )
    ai_sales_os = _build_ai_sales_os(
        lead=lead,
        company=company,
        company_intelligence=intelligence,
        decision_maker_intelligence=decision_maker_intelligence,
        ai_competitor_intelligence=ai_competitor_intelligence,
        ai_outreach_strategy=ai_outreach_strategy,
        ai_sales_timeline=ai_sales_timeline,
        ai_live_buying_signals=ai_live_buying_signals,
        ai_crm=ai_crm,
        ai_company_predictions=ai_company_predictions,
        ai_risk_analyzer=ai_risk_analyzer,
        ai_revenue_engine_report=ai_revenue_engine_report,
        opportunity_ranking=opportunity_ranking,
        ai_ceo_dashboard=ai_ceo_dashboard,
    )
    ai_evidence_engine = _build_ai_evidence_engine(
        company_intelligence=intelligence,
        opportunity_ranking=opportunity_ranking,
        ai_outreach_strategy=ai_outreach_strategy,
        ai_competitor_intelligence=ai_competitor_intelligence,
        ai_company_timeline=ai_company_timeline,
        ai_company_predictions=ai_company_predictions,
        ai_sales_timeline=ai_sales_timeline,
        ai_risk_analyzer=ai_risk_analyzer,
        ai_sales_coach=ai_sales_coach,
        enrichment_step="company_intelligence_refresh",
    )
    lead.notes = _merge_lead_metadata(
        lead,
        {
            "company_intelligence": intelligence,
            "decision_maker_intelligence": decision_maker_intelligence,
            "opportunity_ranking": opportunity_ranking,
            "overall_score": opportunity_ranking["overall_score"],
            "reasoning": opportunity_ranking["reasoning"],
            "top_positive_signals": opportunity_ranking["top_positive_signals"],
            "top_negative_signals": opportunity_ranking["top_negative_signals"],
            "recommended_next_action": opportunity_ranking["recommended_next_action"],
            "confidence": opportunity_ranking["confidence"],
            "company_intelligence_cached_at": intelligence["generated_at"],
            "company_intelligence_cache_key": intelligence["cache_key"],
            "priority_score": intelligence["lead_score"]["value"],
            "confidence_score": intelligence["lead_score"]["confidence"],
            "buying_signal_score": _safe_score(buying_intent.get("buying_signal_score"), 0),
            "buying_signal_urgency": str(buying_intent.get("urgency") or ""),
            "buying_signal_explanation": str(buying_intent.get("explanation") or ""),
            "buying_signal_evidence": buying_intent.get("evidence") if isinstance(buying_intent.get("evidence"), list) else [],
            "buying_signal_confidence": _safe_score(buying_intent.get("confidence"), 0),
            "recommended_outreach_timing": str(buying_intent.get("recommended_outreach_timing") or ""),
            "ai_outreach_strategy": ai_outreach_strategy,
            "ai_competitor_intelligence": ai_competitor_intelligence,
            "ai_company_timeline": ai_company_timeline,
            "ai_company_predictions": ai_company_predictions,
            "ai_sales_timeline": ai_sales_timeline,
            "ai_risk_analyzer": ai_risk_analyzer,
            "ai_sales_coach": ai_sales_coach,
            "ai_specialized_agents": ai_specialized_agents,
            "ai_agent_intermediate_reasoning": ai_agent_intermediate_reasoning,
            "ai_final_orchestrator": ai_final_orchestrator,
            "ai_executive_dashboard": ai_executive_dashboard,
            "ai_live_buying_signals": ai_live_buying_signals,
            "ai_lead_prioritization": ai_lead_prioritization,
            "lead_priority_tier": ai_lead_prioritization["tier"],
            "ai_revenue_engine_report": ai_revenue_engine_report,
            "ai_crm": ai_crm,
            "ai_ceo_dashboard": ai_ceo_dashboard,
            "ai_sales_os": ai_sales_os,
            "continuous_learning": learning_snapshot,
            "ai_evidence_engine": ai_evidence_engine,
        },
    )
    if company is not None:
        company.metadata_json = {
            **(company.metadata_json or {}),
            "company_intelligence": intelligence,
            "decision_maker_intelligence": decision_maker_intelligence,
            "opportunity_ranking": opportunity_ranking,
            "overall_score": opportunity_ranking["overall_score"],
            "reasoning": opportunity_ranking["reasoning"],
            "top_positive_signals": opportunity_ranking["top_positive_signals"],
            "top_negative_signals": opportunity_ranking["top_negative_signals"],
            "recommended_next_action": opportunity_ranking["recommended_next_action"],
            "confidence": opportunity_ranking["confidence"],
            "company_intelligence_cached_at": intelligence["generated_at"],
            "company_intelligence_cache_key": intelligence["cache_key"],
            "priority_score": intelligence["lead_score"]["value"],
            "confidence_score": intelligence["lead_score"]["confidence"],
            "buying_signal_score": _safe_score(buying_intent.get("buying_signal_score"), 0),
            "buying_signal_urgency": str(buying_intent.get("urgency") or ""),
            "buying_signal_explanation": str(buying_intent.get("explanation") or ""),
            "buying_signal_evidence": buying_intent.get("evidence") if isinstance(buying_intent.get("evidence"), list) else [],
            "buying_signal_confidence": _safe_score(buying_intent.get("confidence"), 0),
            "recommended_outreach_timing": str(buying_intent.get("recommended_outreach_timing") or ""),
            "ai_outreach_strategy": ai_outreach_strategy,
            "ai_competitor_intelligence": ai_competitor_intelligence,
            "ai_company_timeline": ai_company_timeline,
            "ai_company_predictions": ai_company_predictions,
            "ai_sales_timeline": ai_sales_timeline,
            "ai_risk_analyzer": ai_risk_analyzer,
            "ai_sales_coach": ai_sales_coach,
            "ai_specialized_agents": ai_specialized_agents,
            "ai_agent_intermediate_reasoning": ai_agent_intermediate_reasoning,
            "ai_final_orchestrator": ai_final_orchestrator,
            "ai_executive_dashboard": ai_executive_dashboard,
            "ai_live_buying_signals": ai_live_buying_signals,
            "ai_lead_prioritization": ai_lead_prioritization,
            "lead_priority_tier": ai_lead_prioritization["tier"],
            "ai_revenue_engine_report": ai_revenue_engine_report,
            "ai_crm": ai_crm,
            "ai_ceo_dashboard": ai_ceo_dashboard,
            "ai_sales_os": ai_sales_os,
            "ai_evidence_engine": ai_evidence_engine,
        }
        profiles = decision_maker_intelligence.get("profiles") if isinstance(decision_maker_intelligence.get("profiles"), list) else []
        profile_by_contact = {
            str(item.get("contact_id")): item
            for item in profiles
            if isinstance(item, dict) and item.get("contact_id")
        }
        for contact in contacts:
            profile = profile_by_contact.get(str(contact.id))
            if not profile:
                continue
            contact.metadata_json = {
                **(contact.metadata_json or {}),
                "decision_maker_intelligence": profile,
                "decision_maker_intelligence_generated_at": decision_maker_intelligence.get("generated_at"),
            }
            contact.updated_at = datetime.utcnow()
        company.updated_at = datetime.utcnow()
    return intelligence


def _apply_cached_company_intelligence(db: Session, user_id: str, workspace, lead: Lead, request_id: str) -> bool:
    own_company = db.scalar(select(Company).where(Company.workspace_id == workspace.id, Company.lead_id == lead.id).order_by(Company.updated_at.desc()).limit(1))
    own_metadata = {**_lead_metadata(lead), **((own_company.metadata_json or {}) if own_company else {})}
    cache_key = _company_intelligence_cache_key(lead, own_metadata, own_company)
    if _fresh_company_intelligence(own_metadata):
        _refresh_company_intelligence(db, user_id, workspace, lead, own_company)
        return True
    candidates = list(
        db.scalars(
            select(Company)
            .where(Company.workspace_id == workspace.id)
            .order_by(Company.updated_at.desc())
            .limit(200)
        ).all()
    )
    for candidate in candidates:
        if own_company and candidate.id == own_company.id:
            continue
        metadata = candidate.metadata_json or {}
        if str(metadata.get("company_intelligence_cache_key") or "") != cache_key:
            continue
        cached = _fresh_company_intelligence(metadata)
        if not cached:
            continue
        lead.notes = _merge_lead_metadata(
            lead,
            {
                **metadata,
                "company_intelligence": cached,
                "company_intelligence_reused_from_cache": True,
                "company_intelligence_cached_at": datetime.utcnow().isoformat(),
            },
        )
        if own_company:
            own_company.metadata_json = {
                **(own_company.metadata_json or {}),
                **metadata,
                "company_intelligence": cached,
                "company_intelligence_reused_from_cache": True,
                "company_intelligence_cached_at": datetime.utcnow().isoformat(),
            }
            own_company.updated_at = datetime.utcnow()
        _lead_trace(request_id, "company_intelligence_cache_hit", lead_id=str(lead.id), company=lead.company)
        return True
    return False


def _ensure_b2b_opportunity_metadata(lead: Lead, workspace, source: str = "fallback", language: str | None = None) -> None:
    """Fill useful sales fields from verified CRM data without inventing contacts."""
    metadata = _lead_metadata(lead)
    company = (lead.company or "This company").strip()
    language = language or workspace.language or "English"
    industry = (lead.industry or lead.niche or metadata.get("business_category") or _localized_fallback_text(language, "market")).strip()
    location = ", ".join(part for part in [lead.city, lead.country] if part)
    has_website = bool(lead.website or metadata.get("domain"))
    has_email = bool(lead.email)
    public_signals = [
        _localized_fallback_text(language, "website_available") if has_website else "",
        _localized_fallback_text(language, "phone_available") if lead.phone else "",
        _localized_fallback_text(language, "listing_available") if metadata.get("place_id") else "",
        _localized_fallback_text(language, "rating_available") if metadata.get("google_rating") else "",
    ]
    public_signals = [signal for signal in public_signals if signal]
    signal_sentence = (
        _localized_fallback_text(language, "signals", signals=", ".join(public_signals))
        if public_signals
        else _localized_fallback_text(language, "summary_more_research")
    )
    summary = _localized_fallback_text(
        language,
        "summary",
        company=company,
        industry=industry,
        location=_localized_fallback_text(language, "location", location=location) if location else "",
        signals=signal_sentence,
    )
    offer_focus = workspace.company or getattr(workspace, "offer", "") or _localized_fallback_text(language, "offer_focus")
    updates = {
        "ai_summary": _sales_metadata_value(metadata, "ai_summary", summary),
        "sales_angle": _sales_metadata_value(metadata, "sales_angle", _localized_fallback_text(language, "sales_angle", industry=industry)),
        "suggested_offer": _sales_metadata_value(metadata, "suggested_offer", _localized_fallback_text(language, "offer", offer_focus=offer_focus, company=company)),
        "outreach_strategy": _sales_metadata_value(metadata, "outreach_strategy", _localized_fallback_text(language, "strategy")),
        "recommended_tone": metadata.get("recommended_tone") or "Professional",
        "recommended_cta": _sales_metadata_value(metadata, "recommended_cta", _localized_fallback_text(language, "cta")),
        "follow_up_strategy": _sales_metadata_value(metadata, "follow_up_strategy", _localized_fallback_text(language, "follow_up")),
        "expected_reply_rate": _sales_metadata_value(metadata, "expected_reply_rate", "8-12%" if has_website and has_email else _localized_fallback_text(language, "reply_unverified")),
        "confidence_score": metadata.get("confidence_score") or (72 if has_website and has_email else 58 if has_website else 42),
        "priority_score": metadata.get("priority_score") or (78 if has_website and has_email else 62 if has_website else 45),
        "buying_signals": _sales_metadata_value(metadata, "buying_signals", public_signals or [_localized_fallback_text(language, "profile_saved")]),
        "risks": _sales_metadata_value(
            metadata,
            "risks",
            [
            risk
            for risk in [
                "" if has_website else _localized_fallback_text(language, "risk_website"),
                "" if has_email else _localized_fallback_text(language, "risk_email"),
            ]
            if risk
            ],
        ),
        "opportunity_analysis": _sales_metadata_value(metadata, "opportunity_analysis", _localized_fallback_text(language, "opportunity", company=company)),
        "partnership_fit": _sales_metadata_value(metadata, "partnership_fit", _localized_fallback_text(language, "fit", offer_focus=offer_focus)),
        "next_recommended_action": _sales_metadata_value(
            metadata,
            "next_recommended_action",
            _localized_fallback_text(language, "next_email") if has_email else _localized_fallback_text(language, "next_contact")
        ),
        "research_source": metadata.get("research_source") or source,
    }
    if not metadata.get("pain_points") or _is_generic_sales_fallback(metadata.get("pain_points")):
        updates["pain_points"] = [
            _localized_fallback_text(language, "pain_manual"),
            _localized_fallback_text(language, "pain_context"),
        ]
    combined_metadata = {**metadata, **updates}
    updates["intelligence_quality"] = _company_intelligence_quality(lead, combined_metadata, workspace, source, language)
    updates["company_intelligence"] = _build_company_intelligence(lead=lead, metadata={**combined_metadata, "intelligence_quality": updates["intelligence_quality"]}, workspace=workspace)
    updates["company_intelligence_cached_at"] = updates["company_intelligence"]["generated_at"]
    updates["company_intelligence_cache_key"] = updates["company_intelligence"]["cache_key"]
    buying_intent = updates["company_intelligence"].get("buying_intent") if isinstance(updates["company_intelligence"].get("buying_intent"), dict) else {}
    updates["buying_signal_score"] = _safe_score(buying_intent.get("buying_signal_score"), 0)
    updates["buying_signal_urgency"] = str(buying_intent.get("urgency") or "")
    updates["buying_signal_explanation"] = str(buying_intent.get("explanation") or "")
    updates["buying_signal_evidence"] = buying_intent.get("evidence") if isinstance(buying_intent.get("evidence"), list) else []
    updates["buying_signal_confidence"] = _safe_score(buying_intent.get("confidence"), 0)
    updates["recommended_outreach_timing"] = str(buying_intent.get("recommended_outreach_timing") or "")
    updates["ai_outreach_strategy"] = _build_ai_outreach_strategy(
        lead=lead,
        metadata={**combined_metadata, **updates},
        contacts=[],
        buying_intent=buying_intent,
        decision_maker_intelligence={},
        opportunity_ranking={},
    )
    updates["ai_competitor_intelligence"] = _build_ai_competitor_intelligence(
        lead=lead,
        metadata={**combined_metadata, **updates},
        company_intelligence=updates["company_intelligence"],
        opportunity_ranking={},
    )
    updates["ai_company_timeline"] = _build_ai_company_timeline(
        lead=lead,
        metadata={**combined_metadata, **updates},
        company_intelligence=updates["company_intelligence"],
    )
    updates["ai_sales_timeline"] = _build_ai_sales_timeline(
        lead=lead,
        metadata={**combined_metadata, **updates},
        ai_outreach_strategy=updates["ai_outreach_strategy"],
        decision_maker_intelligence={},
    )
    updates["ai_risk_analyzer"] = _build_ai_risk_analyzer(
        lead=lead,
        metadata={**combined_metadata, **updates},
        company_intelligence=updates["company_intelligence"],
        decision_maker_intelligence={},
        ai_outreach_strategy=updates["ai_outreach_strategy"],
        opportunity_ranking={},
    )
    updates["ai_company_predictions"] = _build_ai_company_predictions(
        lead=lead,
        metadata={**combined_metadata, **updates},
        company_intelligence=updates["company_intelligence"],
        decision_maker_intelligence={},
        opportunity_ranking={},
        ai_outreach_strategy=updates["ai_outreach_strategy"],
        ai_risk_analyzer=updates["ai_risk_analyzer"],
        ai_company_timeline=updates["ai_company_timeline"],
    )
    updates["ai_sales_coach"] = _build_ai_sales_coach(
        lead=lead,
        metadata={**combined_metadata, **updates},
        company_intelligence=updates["company_intelligence"],
        decision_maker_intelligence={},
        ai_outreach_strategy=updates["ai_outreach_strategy"],
        ai_risk_analyzer=updates["ai_risk_analyzer"],
        opportunity_ranking={},
    )
    specialized_agents = _build_ai_specialized_agents(
        lead=lead,
        company_intelligence=updates["company_intelligence"],
        decision_maker_intelligence={},
        ai_outreach_strategy=updates["ai_outreach_strategy"],
        ai_competitor_intelligence=updates["ai_competitor_intelligence"],
        ai_risk_analyzer=updates["ai_risk_analyzer"],
        ai_sales_coach=updates["ai_sales_coach"],
        ai_company_predictions=updates["ai_company_predictions"],
    )
    updates["ai_specialized_agents"] = specialized_agents.get("agents") if isinstance(specialized_agents.get("agents"), dict) else {}
    updates["ai_agent_intermediate_reasoning"] = (
        specialized_agents.get("intermediate_reasoning")
        if isinstance(specialized_agents.get("intermediate_reasoning"), dict)
        else {}
    )
    updates["ai_final_orchestrator"] = (
        specialized_agents.get("final_orchestrator")
        if isinstance(specialized_agents.get("final_orchestrator"), dict)
        else {}
    )
    updates["ai_executive_dashboard"] = _build_ai_executive_dashboard(
        ai_specialized_agents=updates["ai_specialized_agents"],
        ai_agent_intermediate_reasoning=updates["ai_agent_intermediate_reasoning"],
        ai_final_orchestrator=updates["ai_final_orchestrator"],
        opportunity_ranking={},
        buying_intent=buying_intent,
        ai_risk_analyzer=updates["ai_risk_analyzer"],
        ai_outreach_strategy=updates["ai_outreach_strategy"],
        ai_competitor_intelligence=updates["ai_competitor_intelligence"],
    )
    previous_live_buying_signals = (
        metadata.get("ai_live_buying_signals")
        if isinstance(metadata.get("ai_live_buying_signals"), dict)
        else {}
    )
    updates["ai_live_buying_signals"] = _build_ai_live_buying_signals(
        previous_live_buying_signals=previous_live_buying_signals,
        current_snapshot=_live_buying_signal_snapshot(
            lead=lead,
            metadata={**combined_metadata, **updates},
            company_intelligence=updates["company_intelligence"],
        ),
    )
    updates["ai_lead_prioritization"] = _lead_prioritization_from_metadata(company=None, metadata={**combined_metadata, **updates})
    updates["lead_priority_tier"] = updates["ai_lead_prioritization"]["tier"]
    updates["ai_revenue_engine_report"] = _build_ai_revenue_engine_report(
        previous_report=metadata.get("ai_revenue_engine_report") if isinstance(metadata.get("ai_revenue_engine_report"), dict) else {},
        company_intelligence=updates["company_intelligence"],
        opportunity_ranking={},
        buying_intent=buying_intent,
        decision_maker_intelligence={},
        ai_competitor_intelligence=updates["ai_competitor_intelligence"],
        ai_sales_coach=updates["ai_sales_coach"],
        ai_outreach_strategy=updates["ai_outreach_strategy"],
        ai_risk_analyzer=updates["ai_risk_analyzer"],
    )
    updates["ai_crm"] = _build_ai_crm_summary(
        lead=lead,
        company=None,
        metadata={**combined_metadata, **updates},
        buying_intent=buying_intent,
        ai_risk_analyzer=updates["ai_risk_analyzer"],
        ai_lead_prioritization=updates["ai_lead_prioritization"],
        opportunity_ranking={},
        ai_revenue_engine_report=updates["ai_revenue_engine_report"],
    )
    updates["ai_ceo_dashboard"] = _build_ai_ceo_dashboard(
        lead=lead,
        company=None,
        ai_crm=updates["ai_crm"],
        ai_live_buying_signals=updates["ai_live_buying_signals"],
        ai_competitor_intelligence=updates["ai_competitor_intelligence"],
        ai_revenue_engine_report=updates["ai_revenue_engine_report"],
        ai_executive_dashboard=updates["ai_executive_dashboard"],
        ai_company_predictions=updates["ai_company_predictions"],
        opportunity_ranking={},
        ai_risk_analyzer=updates["ai_risk_analyzer"],
    )
    updates["ai_sales_os"] = _build_ai_sales_os(
        lead=lead,
        company=None,
        company_intelligence=updates["company_intelligence"],
        decision_maker_intelligence={},
        ai_competitor_intelligence=updates["ai_competitor_intelligence"],
        ai_outreach_strategy=updates["ai_outreach_strategy"],
        ai_sales_timeline=updates["ai_sales_timeline"],
        ai_live_buying_signals=updates["ai_live_buying_signals"],
        ai_crm=updates["ai_crm"],
        ai_company_predictions=updates["ai_company_predictions"],
        ai_risk_analyzer=updates["ai_risk_analyzer"],
        ai_revenue_engine_report=updates["ai_revenue_engine_report"],
        opportunity_ranking={},
        ai_ceo_dashboard=updates["ai_ceo_dashboard"],
    )
    updates["ai_evidence_engine"] = _build_ai_evidence_engine(
        company_intelligence=updates["company_intelligence"],
        opportunity_ranking={},
        ai_outreach_strategy=updates["ai_outreach_strategy"],
        ai_competitor_intelligence=updates["ai_competitor_intelligence"],
        ai_company_timeline=updates["ai_company_timeline"],
        ai_company_predictions=updates["ai_company_predictions"],
        ai_sales_timeline=updates["ai_sales_timeline"],
        ai_risk_analyzer=updates["ai_risk_analyzer"],
        ai_sales_coach=updates["ai_sales_coach"],
        enrichment_step="b2b_fallback_enrichment",
    )
    lead.notes = _merge_lead_metadata(lead, updates)


def _existing_review_draft(db: Session, workspace_id: UUID, lead_id: UUID) -> EmailMessage | None:
    return db.scalar(
        select(EmailMessage)
        .where(EmailMessage.workspace_id == workspace_id, EmailMessage.lead_id == lead_id)
        .order_by(EmailMessage.created_at.desc())
        .limit(1)
    )


def _create_review_email_draft(db: Session, request: Request, user_id: str, workspace, lead: Lead) -> EmailMessage | None:
    language = _workspace_language(request, workspace)
    existing = _existing_review_draft(db, workspace.id, lead.id)
    if existing:
        _set_workflow_stage(lead, "ai_email", "completed", _workflow_message(language, "workflow_ai_email_done"))
        _set_workflow_stage(
            lead,
            "approval",
            "completed" if existing.delivery_status in {"approved", "sent"} else "waiting",
            _workflow_message(language, "workflow_approval_done") if existing.delivery_status in {"approved", "sent"} else _workflow_message(language, "workflow_approval_waiting"),
        )
        return existing
    metadata = _lead_metadata(lead)
    variant = personalize_email(
        PersonalizeRequest(
            company=lead.company,
            niche=lead.industry or lead.niche or "",
            website_summary=str(metadata.get("ai_summary") or ""),
            offer=str(metadata.get("suggested_offer") or workspace.company or _localized_fallback_text(language, "offer_focus")),
            cta=str(metadata.get("recommended_cta") or _localized_fallback_text(language, "cta")),
            tone=str(metadata.get("recommended_tone") or "Professional"),
            language=language,
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
    _set_workflow_stage(lead, "ai_email", "completed", _workflow_message(language, "workflow_ai_email_done"))
    _set_workflow_stage(lead, "approval", "waiting", _workflow_message(language, "workflow_approval_waiting"))
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
                _refresh_company_intelligence(db, user_id, workspace, lead)
                _sync_lead_to_crm(db, user_id, workspace, lead)
                _lead_trace(request_id, "turnkey_contact_refresh_finished", lead_id=str(lead.id), company=lead.company, has_email=bool(lead.email))
            except Exception as exc:
                capture_provider_exception(exc, provider="hunter", endpoint="workspace_app.turnkey_contact_refresh", workspace_id=workspace.id, lead_id=lead.id, extra={"request_id": request_id})
                warnings.append(f"{lead.company}: verified contact could not be completed yet.")
                _lead_trace(request_id, "turnkey_contact_refresh_failed", lead_id=str(lead.id), company=lead.company, reason=str(exc))
        try:
            if _needs_ai_research(lead):
                _analyze_lead_if_possible(db, user_id, workspace, lead)
                _ensure_b2b_opportunity_metadata(lead, workspace, source="turnkey_fallback", language=_workspace_language(request, workspace))
                metadata = _lead_metadata(lead)
                if metadata.get("ai_summary") or metadata.get("suggested_offer") or metadata.get("expected_reply_rate"):
                    _add_lead_activity(db, request, user_id, workspace, "website.analyzed", lead, {"source": "turnkey_lead_research"})
                else:
                    warnings.append(f"{lead.company}: AI research could not complete yet.")
                    _lead_trace(request_id, "turnkey_ai_research_partial", lead_id=str(lead.id), company=lead.company)
            _refresh_company_intelligence(db, user_id, workspace, lead)
            _sync_lead_to_crm(db, user_id, workspace, lead)
        except Exception as exc:
            capture_provider_exception(exc, provider="openai", endpoint="workspace_app.turnkey_research", workspace_id=workspace.id, lead_id=lead.id, extra={"request_id": request_id})
            _ensure_b2b_opportunity_metadata(lead, workspace, source="turnkey_fallback_after_ai_error", language=_workspace_language(request, workspace))
            _refresh_company_intelligence(db, user_id, workspace, lead)
            _sync_lead_to_crm(db, user_id, workspace, lead)
            warnings.append(f"{lead.company}: AI research is temporarily unavailable.")
            _lead_trace(request_id, "turnkey_ai_research_failed", lead_id=str(lead.id), company=lead.company, reason=str(exc))

        try:
            _create_review_email_draft(db, request, user_id, workspace, lead)
            _refresh_company_intelligence(db, user_id, workspace, lead)
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


def _background_request(language: str) -> Any:
    return SimpleNamespace(headers={"x-outreachai-locale": language}, cookies={}, client=None)


def _enrichment_metadata_update(status: str, request_id: str, extra: dict[str, Any] | None = None) -> dict[str, Any]:
    now = datetime.utcnow().isoformat()
    payload: dict[str, Any] = {
        "enrichment_status": status,
        "enrichment_request_id": request_id,
        "enrichment_updated_at": now,
    }
    if status == "queued":
        payload["enrichment_queued_at"] = now
        payload["enrichment_cancel_requested"] = False
    if status == "running":
        payload["enrichment_started_at"] = now
        payload["enrichment_cancel_requested"] = False
    if status in {"completed", "partial_success", "error", "cancelled"}:
        payload["last_enriched_at"] = now
    if extra:
        payload.update(extra)
    return payload


def _mark_auto_enrichment_queued(lead: Lead, request_id: str, language: str | None = None) -> None:
    language = language or "English"
    lead.notes = _merge_lead_metadata(lead, _enrichment_metadata_update("queued", request_id))
    _set_workflow_stages(
        lead,
        {
            "company_profile": "completed",
            "website_analysis": "running",
            "decision_maker": "running",
            "verified_email": "running",
            "ai_email": "waiting",
            "approval": "waiting",
        },
        {
            "company_profile": _workflow_message(language, "workflow_company_profile"),
            "website_analysis": _localized_fallback_text(language, "progress_ai_analyzing"),
            "decision_maker": _workflow_message(language, "workflow_decision_missing"),
            "verified_email": _workflow_message(language, "workflow_email_missing"),
            "ai_email": _workflow_message(language, "workflow_ai_email_missing"),
            "approval": _workflow_message(language, "workflow_approval_waiting"),
        },
    )


def _lead_enrichment_cancelled(lead: Lead) -> bool:
    return bool(_lead_metadata(lead).get("enrichment_cancel_requested"))


def _lead_recently_enriched(lead: Lead) -> bool:
    metadata = _lead_metadata(lead)
    if metadata.get("enrichment_status") not in {"completed", "partial_success"}:
        return False
    raw_last_enriched = str(metadata.get("last_enriched_at") or "").strip()
    if not raw_last_enriched:
        return False
    try:
        last_enriched = datetime.fromisoformat(raw_last_enriched.replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
        return False
    settings = get_settings()
    cache_hours = max(1, min(168, int(settings.enrichment_cache_hours or 24)))
    return datetime.utcnow() - last_enriched < timedelta(hours=cache_hours)


def process_enrichment_job(job_id: UUID, claim_token: str | None = None) -> bool:
    db = get_sessionmaker()()
    try:
        job = db.get(EnrichmentJob, job_id)
        if job is None:
            return False
        if claim_token and (job.status != "running" or job.locked_by != claim_token):
            logger.warning("Ignoring enrichment execution for stale claim job_id=%s claim_token=%s status=%s locked_by=%s", job_id, claim_token, job.status, job.locked_by)
            return False
        workspace = db.get(Workspace, job.workspace_id)
        lead = db.scalar(select(Lead).where(Lead.id == job.lead_id, Lead.workspace_id == job.workspace_id))
        request_id = job.request_id or str(job.id)
        if workspace is None or lead is None:
            return mark_cancelled(db, job, message="Workspace or lead no longer exists.", claim_token=claim_token)
        request = _background_request(job.language or "English")
        language = job.language or workspace.language or "English"
        if job.cancel_requested or _lead_enrichment_cancelled(lead):
            lead.notes = _merge_lead_metadata(
                lead,
                _enrichment_metadata_update("cancelled", request_id, {"enrichment_message": _localized_fallback_text(language, "enrichment_stopped")}),
            )
            _set_workflow_stages(
                lead,
                {"website_analysis": "waiting", "decision_maker": "waiting", "verified_email": "waiting", "ai_email": "waiting"},
            )
            _sync_lead_to_crm(db, job.user_id, workspace, lead)
            return mark_cancelled(db, job, claim_token=claim_token)

        lead.notes = _merge_lead_metadata(
            lead,
            _enrichment_metadata_update(
                "running",
                request_id,
                {
                    "enrichment_attempt": int(job.attempts or 1),
                    "enrichment_job_id": str(job.id),
                },
            ),
        )
        _sync_lead_to_crm(db, job.user_id, workspace, lead)
        if not update_job_progress(db, job, stage="website_analysis", message=_localized_fallback_text(language, "progress_ai_analyzing"), percent=25, claim_token=claim_token):
            return False
        _lead_trace(request_id, "durable_auto_enrichment_started", lead_id=str(lead.id), job_id=str(job.id), company=lead.company, attempt=job.attempts)

        if _apply_cached_company_intelligence(db, job.user_id, workspace, lead, request_id):
            lead.notes = _merge_lead_metadata(
                lead,
                _enrichment_metadata_update(
                    "completed",
                    request_id,
                    {
                        "enrichment_job_id": str(job.id),
                        "enrichment_message": _localized_fallback_text(language, "enrichment_cache"),
                    },
                ),
            )
            _finalize_enrichment_workflow(db, workspace, lead)
            _sync_lead_to_crm(db, job.user_id, workspace, lead)
            completed = complete_job(db, job, partial=False, warnings=[], claim_token=claim_token)
            _lead_trace(request_id, "durable_auto_enrichment_cache_hit", lead_id=str(lead.id), job_id=str(job.id))
            return completed

        warnings = _complete_turnkey_b2b_research(db, request, job.user_id, workspace, [lead], request_id)
        db.refresh(job)
        if job.cancel_requested:
            return mark_cancelled(db, job, claim_token=claim_token)

        lead = db.scalar(select(Lead).where(Lead.id == job.lead_id, Lead.workspace_id == job.workspace_id))
        if lead is None:
            return mark_cancelled(db, job, message="Lead no longer exists.", claim_token=claim_token)
        status = "partial_success" if warnings else "completed"
        lead.notes = _merge_lead_metadata(
            lead,
            _enrichment_metadata_update(
                status,
                request_id,
                {
                    "enrichment_job_id": str(job.id),
                    "enrichment_message": _localized_fallback_text(language, "enrichment_partial") if warnings else _localized_fallback_text(language, "enrichment_completed"),
                    "enrichment_warnings": warnings[:5],
                },
            ),
        )
        _finalize_enrichment_workflow(db, workspace, lead)
        _sync_lead_to_crm(db, job.user_id, workspace, lead)
        completed = complete_job(db, job, partial=bool(warnings), warnings=warnings, claim_token=claim_token)
        _lead_trace(request_id, "durable_auto_enrichment_finished", lead_id=str(lead.id), job_id=str(job.id), status=status, warnings=len(warnings))
        return completed
    finally:
        db.close()


def process_deep_contact_search_job(job_id: UUID, claim_token: str | None = None) -> bool:
    db = get_sessionmaker()()
    try:
        job = db.get(EnrichmentJob, job_id)
        if job is None or job.job_type != "deep_contact_search":
            return False
        if claim_token and (job.status != "running" or job.locked_by != claim_token):
            logger.warning("Ignoring deep contact execution for stale claim job_id=%s claim_token=%s status=%s locked_by=%s", job_id, claim_token, job.status, job.locked_by)
            return False

        workspace = db.get(Workspace, job.workspace_id)
        lead = db.scalar(select(Lead).where(Lead.id == job.lead_id, Lead.workspace_id == job.workspace_id))
        payload = job.payload_json if isinstance(job.payload_json, dict) else {}
        try:
            company_id = UUID(str(payload.get("company_id") or ""))
        except Exception:
            company_id = None
        company = db.scalar(select(Company).where(Company.id == company_id, Company.workspace_id == job.workspace_id)) if company_id else None
        request_id = job.request_id or str(job.id)

        if workspace is None or lead is None or company is None:
            return mark_cancelled(db, job, message="Workspace, lead, or company no longer exists.", claim_token=claim_token)

        language = job.language or workspace.language or "English"
        if not update_job_progress(db, job, stage="decision_maker", message="Searching for decision makers across connected sources.", percent=30, claim_token=claim_token):
            return False

        result = run_deep_contact_search(
            domain=str(payload.get("domain") or company.domain or company.website or ""),
            company_name=company.name,
            industry=company.industry or lead.industry or "",
            product_context=workspace.company or workspace.target_customer or "",
            existing_metadata=company.metadata_json or {},
            force=bool(payload.get("force")),
        )

        if not update_job_progress(db, job, stage="verified_email", message="Selecting and verifying the strongest contact email.", percent=70, claim_token=claim_token):
            return False

        request = _background_request(language)
        _apply_deep_contact_result(db, request, job.user_id, workspace, company, lead, result)
        db.commit()

        warnings = [error.get("message", "") for error in result.errors if isinstance(error, dict) and error.get("message")][:5]
        partial = result.status != "success" or bool(warnings)
        completed = complete_job(db, job, partial=partial, warnings=warnings, claim_token=claim_token)
        _lead_trace(
            request_id,
            "deep_contact_search_finished",
            lead_id=str(lead.id),
            job_id=str(job.id),
            company=company.name,
            status=result.status,
            candidates=len(result.candidates),
            verified=bool(result.verified_email),
        )
        return completed
    finally:
        db.close()


def mark_enrichment_job_failed(job_id: UUID, exc: Exception, *, final: bool = False) -> None:
    db = get_sessionmaker()()
    try:
        job = db.get(EnrichmentJob, job_id)
        if job is None:
            return
        if not final:
            return
        workspace = db.get(Workspace, job.workspace_id)
        lead = db.scalar(select(Lead).where(Lead.id == job.lead_id, Lead.workspace_id == job.workspace_id))
        if workspace is None or lead is None:
            return

        if job.job_type == "deep_contact_search":
            payload = job.payload_json if isinstance(job.payload_json, dict) else {}
            try:
                company_id = UUID(str(payload.get("company_id") or ""))
            except Exception:
                company_id = None
            company = db.scalar(select(Company).where(Company.id == company_id, Company.workspace_id == job.workspace_id)) if company_id else None
            if company is not None:
                _set_company_metadata_stage(company, "decision_maker", "error", "Deep contact search could not finish. Retry or add a contact manually.")
                _set_company_metadata_stage(company, "verified_email", "error", "No verified email was saved.")
                _set_company_metadata_stage(company, "technographics", "error", "Technology stack is temporarily unavailable.")
            _set_workflow_stage(lead, "decision_maker", "error", "Deep contact search could not finish. Retry or add a contact manually.")
            _set_workflow_stage(lead, "verified_email", "error", "No verified email was saved.")
            _sync_lead_to_crm(db, job.user_id, workspace, lead)
            db.commit()
            return

        lead.notes = _merge_lead_metadata(
            lead,
            _enrichment_metadata_update("error", job.request_id or str(job.id), {"enrichment_message": _localized_fallback_text(workspace.language if workspace else job.language, "enrichment_failed")}),
        )
        _set_workflow_stages(lead, {"website_analysis": "error", "decision_maker": "error", "verified_email": "error", "ai_email": "error"})
        _sync_lead_to_crm(db, job.user_id, workspace, lead)
        db.commit()
    finally:
        db.close()


def _coerce_dt(value: Any) -> datetime | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00")).replace(tzinfo=None)
    except Exception:
        return None


def _lead_prioritization_from_metadata(
    *,
    company: Company | None,
    metadata: dict[str, Any],
    prioritization_weights: dict[str, float] | None = None,
) -> dict[str, Any]:
    now = datetime.utcnow()
    decision_intel = metadata.get("decision_maker_intelligence") if isinstance(metadata.get("decision_maker_intelligence"), dict) else {}
    profiles = decision_intel.get("profiles") if isinstance(decision_intel.get("profiles"), list) else []
    top_profile = profiles[0] if profiles and isinstance(profiles[0], dict) else {}

    buying_intent_score = _safe_score(metadata.get("buying_signal_score"), 0)
    opportunity_score = _safe_score(metadata.get("overall_score"), 0)
    decision_maker_quality = _safe_score(top_profile.get("confidence_score"), 0)

    website_activity_signals = _dedupe_text_values(
        [
            *_event_texts(metadata.get("website_changes")),
            *_event_texts(metadata.get("blog_news_activity")),
            *_event_texts(metadata.get("news_activity")),
            *_event_texts(metadata.get("blog_activity")),
        ]
    )
    website_activity_score = _safe_score(25 + min(70, len(website_activity_signals) * 20), 20)

    last_enriched = _coerce_dt(metadata.get("last_enriched_at") or metadata.get("company_intelligence_cached_at"))
    if not last_enriched and company is not None:
        last_enriched = company.updated_at
    age_days = max(0, int((now - last_enriched).total_seconds() // 86400)) if last_enriched else 999
    freshness = _safe_score(95 if age_days <= 1 else 82 if age_days <= 3 else 68 if age_days <= 7 else 50 if age_days <= 14 else 30)

    ai_confidence = _safe_score(metadata.get("confidence_score"), 0)

    raw_weights = prioritization_weights if isinstance(prioritization_weights, dict) else DEFAULT_PRIORITIZATION_WEIGHTS
    total_weight = sum(max(0.0, float(raw_weights.get(name) or 0.0)) for name in DEFAULT_PRIORITIZATION_WEIGHTS.keys())
    if total_weight <= 0:
        weights = DEFAULT_PRIORITIZATION_WEIGHTS.copy()
    else:
        weights = {
            name: max(0.0, float(raw_weights.get(name) or 0.0)) / total_weight
            for name in DEFAULT_PRIORITIZATION_WEIGHTS.keys()
        }

    weighted_score = round(
        buying_intent_score * weights["buying_intent"]
        + opportunity_score * weights["opportunity_score"]
        + decision_maker_quality * weights["decision_maker_quality"]
        + website_activity_score * weights["website_activity"]
        + freshness * weights["freshness"]
        + ai_confidence * weights["ai_confidence"]
    )
    score = _safe_score(weighted_score, 0)

    missing_data_flags = [
        buying_intent_score == 0,
        opportunity_score == 0,
        decision_maker_quality == 0,
        ai_confidence == 0,
    ]
    missing_ratio = sum(1 for flag in missing_data_flags if flag) / max(1, len(missing_data_flags))
    if missing_ratio >= 0.5:
        tier = "Needs More Data"
    elif score >= 75:
        tier = "Hot"
    elif score >= 55:
        tier = "Warm"
    else:
        tier = "Cold"

    reasoning_parts = _dedupe_text_values(
        [
            f"Buying Intent {buying_intent_score}",
            f"Opportunity Score {opportunity_score}",
            f"Decision Maker Quality {decision_maker_quality}",
            f"Website Activity {website_activity_score}",
            f"Freshness {freshness}",
            f"AI Confidence {ai_confidence}",
        ]
    )
    confidence = _safe_score(round((100 - missing_ratio * 40 + ai_confidence) / 2), 35)
    return {
        "generated_at": now.isoformat(),
        "tier": tier,
        "score": score,
        "reasoning": "; ".join(reasoning_parts),
        "confidence": confidence,
        "factors": {
            "buying_intent": buying_intent_score,
            "opportunity_score": opportunity_score,
            "decision_maker_quality": decision_maker_quality,
            "website_activity": website_activity_score,
            "freshness": freshness,
            "ai_confidence": ai_confidence,
        },
        "weights_used": weights,
    }


def run_continuous_company_monitoring_once(*, workspace_id: UUID | None = None) -> list[dict[str, Any]]:
    db = get_sessionmaker()()
    changed: list[dict[str, Any]] = []
    try:
        stmt = select(Company).order_by(Company.updated_at.desc()).limit(2000)
        if workspace_id is not None:
            stmt = select(Company).where(Company.workspace_id == workspace_id).order_by(Company.updated_at.desc()).limit(2000)
        companies = list(db.scalars(stmt).all())
        for company in companies:
            metadata = company.metadata_json if isinstance(company.metadata_json, dict) else {}
            previous_live = metadata.get("ai_live_buying_signals") if isinstance(metadata.get("ai_live_buying_signals"), dict) else {}
            intelligence = metadata.get("company_intelligence") if isinstance(metadata.get("company_intelligence"), dict) else {}
            lead = db.get(Lead, company.lead_id) if company.lead_id else None

            current_snapshot = _live_buying_signal_snapshot(
                lead=lead,
                metadata=metadata,
                company_intelligence=intelligence,
            )
            monitoring = _build_ai_live_buying_signals(
                previous_live_buying_signals=previous_live,
                current_snapshot=current_snapshot,
            )
            latest_changes = [item for item in monitoring.get("latest_changes", []) if isinstance(item, dict)]
            if not latest_changes:
                continue

            report_regenerated = False
            workspace = db.get(Workspace, company.workspace_id) if company.workspace_id else None
            if lead is not None and workspace is not None:
                _refresh_company_intelligence(
                    db,
                    user_id=str(company.user_id or lead.user_id or ""),
                    workspace=workspace,
                    lead=lead,
                    company=company,
                )
                report_regenerated = True
            else:
                company.metadata_json = {
                    **metadata,
                    "ai_live_buying_signals": monitoring,
                }
                company.updated_at = datetime.utcnow()

            changed.append(
                {
                    "company_id": company.id,
                    "lead_id": company.lead_id,
                    "company_name": str(company.name or ""),
                    "detected_at": str(monitoring.get("generated_at") or datetime.utcnow().isoformat()),
                    "changes": latest_changes,
                    "report_regenerated": report_regenerated,
                }
            )
        db.commit()
        return changed
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


@router.post("/monitoring/run", response_model=UsageMonitoringOut)
def run_company_monitoring(user: WorkspaceUserContext, db: Session = Depends(get_db)) -> UsageMonitoringOut:
    workspace = _current_workspace(db, user.user_id, user.email)
    monitored_count = int(db.scalar(select(func.count(Company.id)).where(Company.workspace_id == workspace.id)) or 0)
    changes = run_continuous_company_monitoring_once(workspace_id=workspace.id)
    return UsageMonitoringOut(
        status="success",
        message=(
            "Monitoring completed. Returning only newly detected company changes."
            if changes
            else "Monitoring completed. No new company changes detected."
        ),
        monitored_companies=monitored_count,
        changed_companies=len(changes),
        changes=[UsageMonitoringChangeOut.model_validate(item) for item in changes],
    )


def run_nightly_lead_prioritization_once() -> int:
    db = get_sessionmaker()()
    updated = 0
    try:
        companies = list(db.scalars(select(Company).order_by(Company.updated_at.desc()).limit(2000)).all())
        weights_by_workspace: dict[str, dict[str, float]] = {}
        for company in companies:
            metadata = company.metadata_json or {}
            workspace_key = str(company.workspace_id or "")
            prioritization_weights: dict[str, float] | None = None
            if workspace_key:
                if workspace_key not in weights_by_workspace:
                    settings = db.scalar(select(AppSettings).where(AppSettings.workspace_id == company.workspace_id))
                    if settings is not None:
                        learning = continuous_learning_weights(settings.ai if isinstance(settings.ai, dict) else {})
                        weights_by_workspace[workspace_key] = learning.get("prioritization") if isinstance(learning.get("prioritization"), dict) else DEFAULT_PRIORITIZATION_WEIGHTS.copy()
                    else:
                        weights_by_workspace[workspace_key] = DEFAULT_PRIORITIZATION_WEIGHTS.copy()
                prioritization_weights = weights_by_workspace.get(workspace_key)

            prioritization = _lead_prioritization_from_metadata(
                company=company,
                metadata=metadata,
                prioritization_weights=prioritization_weights,
            )
            company.metadata_json = {
                **metadata,
                "ai_lead_prioritization": prioritization,
                "lead_priority_tier": prioritization["tier"],
                "priority_score": prioritization["score"],
                "next_recommended_action": metadata.get("next_recommended_action") or metadata.get("recommended_next_action") or "",
            }
            company.updated_at = datetime.utcnow()
            if company.lead_id:
                lead = db.get(Lead, company.lead_id)
                if lead is not None:
                    lead.notes = _merge_lead_metadata(
                        lead,
                        {
                            "ai_lead_prioritization": prioritization,
                            "lead_priority_tier": prioritization["tier"],
                            "priority_score": prioritization["score"],
                        },
                    )
            updated += 1
        db.commit()
        return updated
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def _enqueue_auto_enrichment(db: Session, request: Request, user_id: str, workspace, leads: list[Lead], request_id: str, *, force: bool = False) -> bool:
    jobs: list[EnrichmentJob] = []
    settings = get_settings()
    language = _workspace_language(request, workspace)
    max_attempts = max(1, min(5, int(settings.enrichment_max_retries or 2) + 1))
    for lead in leads[:MAX_TURNKEY_RESEARCH_LEADS]:
        if not force and _lead_recently_enriched(lead):
            continue
        job = enqueue_company_enrichment_job(
            db,
            user_id=user_id,
            workspace_id=workspace.id,
            lead=lead,
            request_id=request_id,
            language=language,
            max_attempts=max_attempts,
            force=force,
        )
        if job:
            jobs.append(job)
    db.commit()
    if not jobs:
        return False
    if os.getenv("PYTEST_CURRENT_TEST") or os.getenv("OUTREACHAI_SYNC_ENRICHMENT") == "true":
        for job in jobs:
            process_enrichment_job(job.id)
        return True
    return False


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

    updates = {key: value for key, value in details.items() if _metadata_value_present(value)}
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
        updates = {key: value for key, value in details.items() if _metadata_value_present(value)}
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


def _metadata_value_present(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, (list, tuple, set, dict)):
        return bool(value)
    return True


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


def _set_company_metadata_stage(company: Company, key: str, status: str, message: str) -> None:
    metadata = dict(company.metadata_json or {})
    workflow = dict(metadata.get("workflow_stages") or {})
    messages = dict(metadata.get("workflow_stage_messages") or {})
    workflow[key] = status
    messages[key] = message
    metadata["workflow_stages"] = workflow
    metadata["workflow_stage_messages"] = messages
    company.metadata_json = metadata
    company.updated_at = datetime.utcnow()


def _apply_deep_contact_result(db: Session, request: Request, user_id: str, workspace, company: Company, lead: Lead | None, result) -> None:
    now = datetime.utcnow()
    metadata = {**(company.metadata_json or {}), **result.to_metadata()}
    metadata["decision_maker_roles_searched"] = list(DECISION_MAKER_TITLES)
    metadata["contact_search_checked_at"] = now.isoformat()
    metadata["contact_search_status"] = "verified_email_found" if result.verified_email else "no_verified_email"
    metadata["contact_search_message"] = (
        "Verified decision maker saved to CRM."
        if result.verified_email
        else "Deep search ran, but no verified business email was found. Choose another contact or add one manually."
    )
    metadata["confidence_score"] = result.confidence_score
    metadata["priority_score"] = result.lead_score
    metadata["technologies"] = result.technologies
    metadata["last_enriched_at"] = result.last_enriched_at
    company.metadata_json = metadata

    profile = result.company_profile or {}
    company.domain = company.domain or normalize_domain(str(profile.get("domain") or company.website or ""))
    company.website = company.website or str(profile.get("website") or (f"https://{company.domain}" if company.domain else ""))
    company.industry = company.industry or str(profile.get("industry") or "")
    company.source = "deep_enrichment" if result.sources else company.source
    company.email_status = "Verified" if result.verified_email else "No verified email"
    company.crm_stage = "Contact Found" if result.verified_email else company.crm_stage
    company.updated_at = now

    selected = result.selected_decision_maker
    if selected:
        contact = _upsert_deep_contact(db, user_id, workspace, company, lead, selected, selected.email == result.verified_email and bool(result.verified_email))
        if result.verified_email:
            company.email = result.verified_email
            if lead:
                lead.contact = contact.name or lead.contact
                lead.email = result.verified_email
                lead.linkedin = contact.linkedin or lead.linkedin
                lead.status = LeadStatus.qualified

    for candidate in result.candidates:
        if selected and (candidate.email or candidate.linkedin or candidate.name) == (selected.email or selected.linkedin or selected.name):
            continue
        _upsert_deep_contact(db, user_id, workspace, company, lead, candidate, False)

    if lead:
        lead.notes = _merge_lead_metadata(
            lead,
            {
                **metadata,
                "email_status": company.email_status,
                "contact_found_at": now.isoformat() if result.verified_email else _lead_metadata(lead).get("contact_found_at"),
                "last_enriched_at": result.last_enriched_at,
            },
        )
        _set_workflow_stage(lead, "decision_maker", "completed" if selected else "error", "Decision maker selected." if selected else "Choose or add a decision maker manually.")
        _set_workflow_stage(lead, "verified_email", "completed" if result.verified_email else "error", "Verified business email saved." if result.verified_email else "No verified email was found.")
        _add_lead_activity(db, request, user_id, workspace, "contact.deep_search", lead, {"status": result.status, "verified": bool(result.verified_email)})
        _sync_lead_to_crm(db, user_id, workspace, lead)

    _set_company_metadata_stage(company, "decision_maker", "completed" if selected else "error", "Decision maker selected." if selected else "Choose or add a decision maker manually.")
    _set_company_metadata_stage(company, "verified_email", "completed" if result.verified_email else "error", "Verified business email saved." if result.verified_email else "No verified email was found.")
    _set_company_metadata_stage(company, "technographics", "completed" if result.technologies else "error", "Technology stack saved." if result.technologies else "Technology stack unavailable.")
    if lead:
        _refresh_company_intelligence(db, user_id, workspace, lead, company)


def _upsert_deep_contact(db: Session, user_id: str, workspace, company: Company, lead: Lead | None, candidate, selected: bool) -> Contact:
    contact = None
    if candidate.email:
        contact = db.scalar(select(Contact).where(Contact.workspace_id == workspace.id, Contact.email == candidate.email).order_by(Contact.updated_at.desc()).limit(1))
    if contact is None and candidate.linkedin:
        contact = db.scalar(select(Contact).where(Contact.workspace_id == workspace.id, Contact.company_id == company.id, Contact.linkedin == candidate.linkedin).order_by(Contact.updated_at.desc()).limit(1))
    if contact is None and candidate.name:
        contact = db.scalar(select(Contact).where(Contact.workspace_id == workspace.id, Contact.company_id == company.id, Contact.name == candidate.name).order_by(Contact.updated_at.desc()).limit(1))
    if contact is None:
        contact = Contact(user_id=user_id, workspace_id=workspace.id, company_id=company.id, lead_id=lead.id if lead else None)
        db.add(contact)
    contact.company_id = company.id
    contact.lead_id = contact.lead_id or (lead.id if lead else None)
    contact.name = candidate.name or contact.name or ""
    contact.title = candidate.title or contact.title or ""
    contact.email = candidate.email or contact.email
    contact.linkedin = candidate.linkedin or contact.linkedin
    contact.confidence = str(candidate.confidence or contact.confidence or "")
    contact.source = candidate.source or "deep_enrichment"
    contact.email_status = "Verified" if selected and candidate.email else ("Unverified" if candidate.email else "Unknown")
    contact.metadata_json = {
        **(contact.metadata_json or {}),
        "selected_decision_maker": selected,
        "verification_status": candidate.verification_status,
        "apollo_contact_id": candidate.apollo_contact_id,
        "reason": candidate.reason,
        "source": candidate.source,
        "last_enriched_at": datetime.utcnow().isoformat(),
    }
    contact.updated_at = datetime.utcnow()
    return contact


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
        if existing_company.lead_id:
            existing_lead = db.scalar(select(Lead).where(Lead.id == existing_company.lead_id, Lead.workspace_id == workspace.id))
            if existing_lead:
                _ensure_b2b_opportunity_metadata(existing_lead, workspace, source="manual_company_reused_fallback", language=_workspace_language(request, workspace))
                existing_company = _sync_lead_to_crm(db, user.user_id, workspace, existing_lead)
                db.commit()
                db.refresh(existing_company)
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
        _ensure_b2b_opportunity_metadata(existing_lead, workspace, source="manual_company_reused_fallback", language=_workspace_language(request, workspace))
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
    _ensure_b2b_opportunity_metadata(lead, workspace, source="manual_company_fallback", language=_workspace_language(request, workspace))
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

    request_id = request.headers.get("x-request-id") or str(uuid4())
    _mark_auto_enrichment_queued(lead, request_id, _workspace_language(request, workspace))
    enqueue_company_enrichment_job(
        db,
        user_id=user.user_id,
        workspace_id=workspace.id,
        lead=lead,
        request_id=request_id,
        language=_workspace_language(request, workspace),
        max_attempts=max(1, min(5, int(get_settings().enrichment_max_retries or 2) + 1)),
    )
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
    return _search_leads_impl(payload, request, user, db, run_turnkey_research=False)


def _search_leads_impl(
    payload: LeadFinderRequest,
    request: Request,
    user: WorkspaceUserContext,
    db: Session,
    *,
    run_turnkey_research: bool,
) -> UsageLeadSearchOut:
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
    queued_for_enrichment: list[Lead] = []
    if saved:
        for lead in saved:
            if _lead_recently_enriched(lead):
                continue
            _mark_auto_enrichment_queued(lead, request_id, _workspace_language(request, workspace))
            queued_for_enrichment.append(lead)
        _lead_trace(request_id, "auto_enrichment_batch_queued", leads=len(queued_for_enrichment), skipped_recent=len(saved) - len(queued_for_enrichment), run_turnkey_research=run_turnkey_research)

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
    enrichment_ran_inline = _enqueue_auto_enrichment(db, request, user.user_id, workspace, queued_for_enrichment, request_id) if queued_for_enrichment else False
    if enrichment_ran_inline:
        db.expire_all()
        companies = []
        for lead in saved:
            refreshed = db.scalar(select(Lead).where(Lead.id == lead.id, Lead.workspace_id == workspace.id))
            if refreshed is None:
                continue
            company = _sync_lead_to_crm(db, user.user_id, workspace, refreshed)
            companies.append(_safe_company_out(db, workspace, user.user_id, company))
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
    elif not queued_for_enrichment:
        message = f"Found {len(companies)} companies. Recent AI enrichment is already saved in CRM."
    elif not run_turnkey_research:
        message = f"Found and saved {len(companies)} companies. AI enrichment is now filling research, contacts and email drafts automatically."
    else:
        message = f"Found and saved {len(companies)} companies to your CRM. AI enrichment is running automatically."
    return UsageLeadSearchOut(
        status=status,
        request_id=request_id,
        message=message,
        companies_saved=new_saved_count,
        duplicates_skipped=duplicates_skipped,
        companies=companies,
        warnings=warnings,
    )


@router.post("/leads/command", response_model=UsageLeadCommandOut)
def search_leads_from_command(payload: UsageLeadCommandIn, request: Request, user: WorkspaceUserContext, db: Session = Depends(get_db)) -> UsageLeadCommandOut:
    workspace = _current_workspace(db, user.user_id, user.email)
    request_id = request.headers.get("x-request-id") or str(uuid4())
    filters, missing = _parse_lead_command(payload.command, workspace)
    _lead_trace(
        request_id,
        "workspace_app_command_received",
        workspace_id=str(workspace.id),
        command=payload.command,
        missing=missing,
        filters=filters.model_dump() if filters else None,
    )
    if not filters:
        labels = ", ".join(missing)
        return UsageLeadCommandOut(
            status="error",
            request_id=request_id,
            message=f"Add a clearer {labels} and try again.",
            warnings=["AI command needs a city, country and industry before search."],
            interpreted_query=payload.command,
        )
    result = _search_leads_impl(filters, request, user, db, run_turnkey_research=False)
    return UsageLeadCommandOut(**result.model_dump(), filters=filters, interpreted_query=payload.command)


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
    companies = [
        company
        for company in db.scalars(stmt.order_by(Company.updated_at.desc()).limit(200)).all()
        if company.lead_id is not None or _is_customer_visible_company(company)
    ][:100]
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
        _ensure_b2b_opportunity_metadata(lead, workspace, source="workspace_analyze", language=_workspace_language(request, workspace))
        _add_lead_activity(db, request, user.user_id, workspace, "website.analyzed", lead, {"source": "workspace_app"})
        db.commit()
        company = _sync_lead_to_crm(db, user.user_id, workspace, lead)
        db.commit()
        return UsageActionOut(status="success", message="Website analysis saved.", company=_crm_company_out(db, workspace, user.user_id, company))
    except Exception as exc:
        capture_provider_exception(exc, provider="openai", endpoint="workspace_app.company.analyze", workspace_id=workspace.id, lead_id=lead.id)
        return UsageActionOut(status="provider_unavailable", message=_safe_provider_warning(exc), company=_crm_company_out(db, workspace, user.user_id, company))


@router.post("/companies/{company_id}/deep-contact-search", response_model=UsageActionOut, status_code=202)
def deep_search_company_contacts(
    company_id: UUID,
    payload: UsageDeepContactSearchIn,
    request: Request,
    user: WorkspaceUserContext,
    db: Session = Depends(get_db),
) -> UsageActionOut:
    workspace = _current_workspace(db, user.user_id, user.email)
    company = _scoped_company(db, workspace.id, company_id)
    lead = db.scalar(select(Lead).where(Lead.id == company.lead_id, Lead.workspace_id == workspace.id)) if company.lead_id else None

    def _safe_company_out() -> Optional[CrmCompanyOut]:
        try:
            return _crm_company_out(db, workspace, user.user_id, company)
        except Exception as exc:
            capture_provider_exception(
                exc,
                provider="deep_contact_search",
                endpoint="workspace_app.company.deep_contact_search.company_out",
                workspace_id=workspace.id,
                lead_id=lead.id if lead else None,
            )
            return None

    def _safe_workflow_stages(company_out: Optional[CrmCompanyOut]) -> dict[str, Any]:
        stages = getattr(company_out, "workflow_stages", {}) if company_out else {}
        return stages if isinstance(stages, dict) else {}

    def _safe_workflow_state(company_out: Optional[CrmCompanyOut]) -> dict[str, Any]:
        state = getattr(company_out, "ai_workflow_engine", {}) if company_out else {}
        return state if isinstance(state, dict) else {}

    domain = normalize_domain(company.domain or company.website or (lead.website if lead else "") or "")
    if not domain:
        return UsageActionOut(
            status="error",
            message="Add a company website before running deep contact search.",
            company=_safe_company_out(),
            missing_fields=["website"],
            recommended_actions=["Add website", "Add contact manually"],
        )

    request_id = request.headers.get("x-request-id") or str(uuid4())
    _lead_trace(request_id, "deep_contact_search_queued", lead_id=str(lead.id) if lead else "", company=company.name, domain=domain)
    _set_company_metadata_stage(company, "decision_maker", "running", "Searching for decision makers across connected sources.")
    _set_company_metadata_stage(company, "verified_email", "running", "Finding and verifying a usable business email.")
    _set_company_metadata_stage(company, "technographics", "running", "Detecting the website technology stack.")
    if lead is None:
        _set_company_metadata_stage(company, "decision_maker", "error", "This company needs a saved lead before deep contact search can run.")
        _set_company_metadata_stage(company, "verified_email", "error", "No verified email was saved.")
        _set_company_metadata_stage(company, "technographics", "error", "Technology stack is temporarily unavailable.")
        db.commit()
        raise HTTPException(status_code=400, detail="Save this company to CRM before running deep contact search.")

    job = enqueue_deep_contact_search_job(
        db,
        user_id=user.user_id,
        workspace_id=workspace.id,
        lead=lead,
        company_id=company.id,
        request_id=request_id,
        language=_workspace_language(request, workspace),
        domain=domain,
        force=payload.force,
    )
    db.commit()

    if job.status in {"pending", "running", "retrying"} and int(job.attempts or 0) > 0:
        return UsageActionOut(
            status="partial_success",
            message="Deep contact search is already running for this company. Tracking existing job.",
            company=_safe_company_out(),
            job_id=str(job.id),
            job_status=job.status,
            recommended_actions=["Wait for completion", "Refresh company card"],
        )

    company_out = _safe_company_out()
    return UsageActionOut(
        status="success",
        message="Deep contact search queued. This company card will update automatically when processing finishes.",
        company=company_out,
        workflow_stages=_safe_workflow_stages(company_out),
        workflow_state=_safe_workflow_state(company_out),
        recommended_actions=["Wait for completion", "Add contact manually if needed"],
        next_action="Track job progress and review the updated contact data.",
        job_id=str(job.id),
        job_status=job.status,
    )


@router.get("/companies/{company_id}/deep-contact-search/jobs/{job_id}", response_model=UsageJobStatusOut)
def deep_contact_search_job_status(company_id: UUID, job_id: UUID, user: WorkspaceUserContext, db: Session = Depends(get_db)) -> UsageJobStatusOut:
    workspace = _current_workspace(db, user.user_id, user.email)
    company = _scoped_company(db, workspace.id, company_id)
    job = db.scalar(
        select(EnrichmentJob).where(
            EnrichmentJob.id == job_id,
            EnrichmentJob.workspace_id == workspace.id,
            EnrichmentJob.job_type == "deep_contact_search",
            EnrichmentJob.lead_id == company.lead_id,
        )
    )
    if not job:
        raise HTTPException(status_code=404, detail="Deep contact search job not found.")
    return UsageJobStatusOut(
        job_id=str(job.id),
        job_type=job.job_type,
        status=job.status,
        progress=job.progress_json if isinstance(job.progress_json, dict) else {},
        company=_crm_company_out(db, workspace, user.user_id, company),
    )


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
    _ensure_b2b_opportunity_metadata(lead, workspace, source="workspace_contact_discovery", language=_workspace_language(request, workspace))
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
        _ensure_b2b_opportunity_metadata(lead, workspace, source="workspace_email_draft", language=_workspace_language(request, workspace))
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
    language = _workspace_language(request, workspace)
    warnings: list[str] = []
    completed_steps: list[str] = []
    email: EmailMessage | None = None
    _lead_trace(request_id, "complete_opportunity_started", lead_id=str(lead.id), company=lead.company)
    _set_workflow_stages(
        lead,
        {
            "company_profile": "running",
            "website_analysis": "waiting",
            "decision_maker": "waiting",
            "verified_email": "waiting",
            "ai_email": "waiting",
            "approval": "waiting",
        },
    )

    _lead_trace(request_id, "complete_opportunity_profile_started", lead_id=str(lead.id), company=lead.company)
    try:
        _complete_public_company_details(db, request, user.user_id, workspace, lead, request_id)
        _set_workflow_stage(lead, "company_profile", "completed", _workflow_message(language, "workflow_company_profile"))
        completed_steps.append("Company profile checked")
        _lead_trace(request_id, "complete_opportunity_profile_finished", lead_id=str(lead.id), company=lead.company)
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
        _set_workflow_stage(lead, "company_profile", "error", "Company profile could not be refreshed. Saved CRM data was kept.")
        completed_steps.append("Company profile checked")
        _lead_trace(request_id, "complete_opportunity_profile_failed", lead_id=str(lead.id), company=lead.company, reason=str(exc))

    _lead_trace(request_id, "complete_opportunity_analysis_started", lead_id=str(lead.id), company=lead.company)
    try:
        _set_workflow_stage(lead, "website_analysis", "running", _localized_fallback_text(language, "progress_ai_analyzing"))
        metadata = _lead_metadata(lead)
        has_completed_research = bool(metadata.get("website_analyzed_at"))
        if (lead.website or metadata.get("domain")) and (_needs_ai_research(lead) or not has_completed_research):
            _analyze_lead_if_possible(db, user.user_id, workspace, lead, language=_workspace_language(request, workspace))
        _ensure_b2b_opportunity_metadata(lead, workspace, source="complete_opportunity", language=_workspace_language(request, workspace))
        metadata = _lead_metadata(lead)
        if not any(metadata.get(key) for key in ("ai_summary", "opportunity_analysis", "suggested_offer", "pain_points")):
            warnings.append("AI research could not complete yet. The company is saved and can be retried.")
            _set_workflow_stage(lead, "website_analysis", "error", _workflow_message(language, "workflow_website_missing"))
        else:
            _set_workflow_stage(lead, "website_analysis", "completed", _workflow_message(language, "workflow_website_done"))
            _add_lead_activity(db, request, user.user_id, workspace, "website.analyzed", lead, {"source": "complete_opportunity"})
        completed_steps.append("Website analysis checked")
        _lead_trace(request_id, "complete_opportunity_analysis_finished", lead_id=str(lead.id), company=lead.company)
    except Exception as exc:
        capture_provider_exception(
            exc,
            provider="openai",
            endpoint="workspace_app.complete_opportunity.analysis",
            workspace_id=workspace.id,
            lead_id=lead.id,
            extra={"request_id": request_id},
        )
        _ensure_b2b_opportunity_metadata(lead, workspace, source="complete_opportunity_ai_fallback", language=_workspace_language(request, workspace))
        warnings.append(_safe_provider_warning(exc))
        _set_workflow_stage(lead, "website_analysis", "error", _safe_provider_warning(exc))
        completed_steps.append("Website analysis checked")
        _lead_trace(request_id, "complete_opportunity_analysis_failed", lead_id=str(lead.id), company=lead.company, reason=str(exc))

    _lead_trace(request_id, "complete_opportunity_contacts_started", lead_id=str(lead.id), company=lead.company)
    try:
        _set_workflow_stage(lead, "decision_maker", "running", _workflow_message(language, "workflow_decision_missing"))
        _set_workflow_stage(lead, "verified_email", "running", _workflow_message(language, "workflow_email_missing"))
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
                    _set_workflow_stage(lead, "decision_maker", "error", _workflow_message(language, "workflow_decision_missing"))
                    _set_workflow_stage(lead, "verified_email", "error", _workflow_message(language, "workflow_email_missing"))
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
                _set_workflow_stage(lead, "decision_maker", "error", _workflow_message(language, "workflow_decision_missing"))
                _set_workflow_stage(lead, "verified_email", "error", _workflow_message(language, "workflow_email_missing"))
                _add_lead_activity(db, request, user.user_id, workspace, "contact.search_empty", lead, {"source": "complete_opportunity"})
        if lead.email:
            _set_workflow_stage(lead, "decision_maker", "completed", _workflow_message(language, "workflow_decision_done"))
            _set_workflow_stage(lead, "verified_email", "completed", _workflow_message(language, "workflow_email_verified"))
        completed_steps.append("Contact search checked")
        _lead_trace(request_id, "complete_opportunity_contacts_finished", lead_id=str(lead.id), company=lead.company, has_email=bool(lead.email))
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
        _set_workflow_stage(lead, "decision_maker", "error", _workflow_message(language, "workflow_decision_missing"))
        _set_workflow_stage(lead, "verified_email", "error", _workflow_message(language, "workflow_email_missing"))
        completed_steps.append("Contact search checked")
        _lead_trace(request_id, "complete_opportunity_contacts_failed", lead_id=str(lead.id), company=lead.company, reason=str(exc))

    _lead_trace(request_id, "complete_opportunity_email_started", lead_id=str(lead.id), company=lead.company)
    try:
        _set_workflow_stage(lead, "ai_email", "running", _workflow_message(language, "workflow_ai_email_missing"))
        _ensure_b2b_opportunity_metadata(lead, workspace, source="complete_opportunity_before_draft", language=_workspace_language(request, workspace))
        email = _create_review_email_draft(db, request, user.user_id, workspace, lead)
        db.flush()
        if email:
            _set_workflow_stage(lead, "ai_email", "completed", _workflow_message(language, "workflow_ai_email_done"))
            _set_workflow_stage(lead, "approval", "waiting", _workflow_message(language, "workflow_approval_waiting"))
        completed_steps.append("Email draft checked")
        _lead_trace(request_id, "complete_opportunity_email_finished", lead_id=str(lead.id), company=lead.company, has_email_draft=bool(email))
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
        _set_workflow_stage(lead, "ai_email", "error", _workflow_message(language, "workflow_ai_email_missing"))
        completed_steps.append("Email draft checked")
        _lead_trace(request_id, "complete_opportunity_email_failed", lead_id=str(lead.id), company=lead.company, reason=str(exc))

    _lead_trace(request_id, "complete_opportunity_database_save_started", lead_id=str(lead.id), company=lead.company)
    company = _sync_lead_to_crm(db, user.user_id, workspace, lead)
    _refresh_company_intelligence(db, user.user_id, workspace, lead, company)
    db.commit()
    db.refresh(company)
    if email:
        db.refresh(email)
    _lead_trace(request_id, "complete_opportunity_database_save_finished", lead_id=str(lead.id), company=lead.company, company_id=str(company.id), has_email_draft=bool(email))
    _lead_trace(request_id, "complete_opportunity_finished", lead_id=str(lead.id), company=lead.company, warnings=len(warnings), has_email_draft=bool(email))
    company_out = _crm_company_out(db, workspace, user.user_id, company)
    guidance = _company_action_guidance(company_out)

    return UsageActionOut(
        status="partial_success" if warnings else "success",
        message=(
            "Sales opportunity prepared with missing fields. Review the next recommended action."
            if warnings
            else "Sales opportunity prepared. Review the AI research and approve only when ready."
        ),
        company=company_out,
        email=EmailOut.model_validate(email) if email else None,
        warnings=warnings,
        completed_steps=completed_steps,
        workflow_stages=company_out.workflow_stages,
        workflow_state=company_out.ai_workflow_engine,
        **guidance,
    )


@router.post("/companies/{company_id}/enrichment/restart", response_model=UsageActionOut)
def restart_company_auto_enrichment(company_id: UUID, request: Request, user: WorkspaceUserContext, db: Session = Depends(get_db)) -> UsageActionOut:
    request_id = request.headers.get("x-request-id") or str(uuid4())
    workspace = None
    company = None
    lead = None

    def _safe_workflow_state(company_out: Optional[CrmCompanyOut]) -> dict[str, Any]:
        state = getattr(company_out, "ai_workflow_engine", {}) if company_out else {}
        return state if isinstance(state, dict) else {}

    try:
        workspace = _current_workspace(db, user.user_id, user.email)
        company = _scoped_company(db, workspace.id, company_id)
        if not company.lead_id:
            return UsageActionOut(status="error", message="This company needs a saved lead before AI enrichment.", company=_crm_company_out(db, workspace, user.user_id, company))
        lead = db.scalar(select(Lead).where(Lead.id == company.lead_id, Lead.workspace_id == workspace.id))
        if not lead:
            return UsageActionOut(status="error", message="This company needs a saved lead before AI enrichment.", company=_crm_company_out(db, workspace, user.user_id, company))

        warnings: list[str] = []
        try:
            _mark_auto_enrichment_queued(lead, request_id, _workspace_language(request, workspace))
            company = _sync_lead_to_crm(db, user.user_id, workspace, lead)
            db.commit()
        except Exception as exc:
            db.rollback()
            logger.exception("Workspace enrichment restart setup failed")
            capture_provider_exception(
                exc,
                provider="workspace_app",
                endpoint="workspace_app.enrichment_restart_setup",
                workspace_id=workspace.id,
                lead_id=lead.id,
                extra={"request_id": request_id, "company_id": str(company_id)},
            )
            warnings.append("AI enrichment restart setup is temporarily unavailable. Continuing with queue restart.")

        ran_inline = False
        try:
            ran_inline = _enqueue_auto_enrichment(db, request, user.user_id, workspace, [lead], request_id, force=True)
        except Exception as exc:
            db.rollback()
            logger.exception("Workspace enrichment restart enqueue failed")
            capture_provider_exception(
                exc,
                provider="workspace_app",
                endpoint="workspace_app.enrichment_restart",
                workspace_id=workspace.id,
                lead_id=lead.id,
                extra={"request_id": request_id, "company_id": str(company_id)},
            )
            warnings.append("AI enrichment restart is temporarily unavailable. Saved company data remains available.")
        if ran_inline and not warnings:
            db.expire_all()
            company = _scoped_company(db, workspace.id, company_id)
        company_out = None
        try:
            company_out = _crm_company_out(db, workspace, user.user_id, company)
        except Exception as out_exc:
            logger.exception("Workspace enrichment restart response serialization failed")
            capture_provider_exception(
                out_exc,
                provider="workspace_app",
                endpoint="workspace_app.enrichment_restart_out",
                workspace_id=workspace.id,
                lead_id=lead.id,
                extra={"request_id": request_id, "company_id": str(company_id)},
            )
            warnings.append("Company card update is temporarily unavailable. Reload the page to continue.")
        return UsageActionOut(
            status="partial_success" if warnings else "success",
            message=(
                "AI enrichment restart is temporarily unavailable. Saved company data remains available."
                if warnings
                else "AI enrichment restarted. The company card will update as research, contacts and email draft are completed."
            ),
            company=company_out,
            warnings=warnings,
            workflow_stages=company_out.workflow_stages if company_out else {},
            workflow_state=_safe_workflow_state(company_out),
            next_action="Keep this company open or return to CRM while AI enrichment runs.",
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Workspace enrichment restart failed unexpectedly")
        capture_provider_exception(
            exc,
            provider="workspace_app",
            endpoint="workspace_app.enrichment_restart_unhandled",
            workspace_id=getattr(workspace, "id", None),
            lead_id=getattr(lead, "id", None),
            extra={"request_id": request_id, "company_id": str(company_id)},
        )
        fallback_company_out = None
        if workspace is not None:
            try:
                fallback_company = company or _scoped_company(db, workspace.id, company_id)
                fallback_company_out = _crm_company_out(db, workspace, user.user_id, fallback_company)
            except Exception as out_exc:
                logger.exception("Workspace enrichment restart unhandled fallback serialization failed")
                capture_provider_exception(
                    out_exc,
                    provider="workspace_app",
                    endpoint="workspace_app.enrichment_restart_unhandled_out",
                    workspace_id=getattr(workspace, "id", None),
                    lead_id=getattr(lead, "id", None),
                    extra={"request_id": request_id, "company_id": str(company_id)},
                )
        return UsageActionOut(
            status="partial_success",
            message="AI enrichment restart is temporarily unavailable. Saved company data remains available.",
            company=fallback_company_out,
            warnings=["AI enrichment restart is temporarily unavailable. Saved company data remains available."],
            workflow_stages=fallback_company_out.workflow_stages if fallback_company_out else {},
            workflow_state=_safe_workflow_state(fallback_company_out),
            next_action="Keep this company open and continue manual steps while enrichment service recovers.",
        )


@router.post("/companies/{company_id}/enrichment/cancel", response_model=UsageActionOut)
def cancel_company_auto_enrichment(company_id: UUID, request: Request, user: WorkspaceUserContext, db: Session = Depends(get_db)) -> UsageActionOut:
    workspace = _current_workspace(db, user.user_id, user.email)
    company = _scoped_company(db, workspace.id, company_id)
    if not company.lead_id:
        return UsageActionOut(status="error", message="This company does not have a running AI enrichment job.", company=_crm_company_out(db, workspace, user.user_id, company))
    lead = db.scalar(select(Lead).where(Lead.id == company.lead_id, Lead.workspace_id == workspace.id))
    if not lead:
        return UsageActionOut(status="error", message="This company does not have a running AI enrichment job.", company=_crm_company_out(db, workspace, user.user_id, company))
    request_id = request.headers.get("x-request-id") or str(uuid4())
    cancel_jobs_for_lead(db, workspace_id=workspace.id, lead_id=lead.id, reason="AI enrichment was stopped by the user.")
    lead.notes = _merge_lead_metadata(
        lead,
        _enrichment_metadata_update(
            "cancelled",
            request_id,
            {
                "enrichment_cancel_requested": True,
                "enrichment_message": "Automatic enrichment was stopped. You can restart it from this company card.",
            },
        ),
    )
    _set_workflow_stages(
        lead,
        {
            "website_analysis": "waiting",
            "decision_maker": "waiting",
            "verified_email": "waiting",
            "ai_email": "waiting",
        },
    )
    company = _sync_lead_to_crm(db, user.user_id, workspace, lead)
    db.commit()
    company_out = _crm_company_out(db, workspace, user.user_id, company)
    return UsageActionOut(
        status="success",
        message="AI enrichment stopped. Saved company data stayed in CRM.",
        company=company_out,
        workflow_stages=company_out.workflow_stages,
        workflow_state=company_out.ai_workflow_engine,
        next_action="Restart enrichment when you want OutreachAI to continue filling missing sales data.",
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
        _set_workflow_stage(lead, "approval", "completed", "Human review completed. The email is ready to send.")
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
        sender_status, smtp_config = _outreach_sender_runtime_config(db, user.user_id, workspace)
        _enforce_usage(db, user.user_id, workspace, "email_sends")
        provider_response = send_email(
            to_email=lead.email,
            subject=email.subject,
            body=email.body,
            from_email=sender_status.sender_email,
            from_name=sender_status.sender_name,
            reply_to=sender_status.reply_to,
            provider=sender_status.provider,
            smtp_config=smtp_config,
        )
    except HTTPException as exc:
        return UsageActionOut(status="provider_unavailable", message=str(exc.detail), email=EmailOut.model_validate(email))
    except (EmailProviderConfigurationError, EmailProviderRequestError) as exc:
        email.delivery_status = "failed"
        _add_lead_activity(db, request, user.user_id, workspace, "email.send_failed", lead, {"email_id": str(email.id), "reason": str(exc)})
        db.commit()
        capture_provider_exception(exc, provider="email", endpoint="workspace_app.email.send", workspace_id=workspace.id, lead_id=lead.id)
        return UsageActionOut(status="provider_unavailable", message="Email sending needs setup or is temporarily unavailable. The approved draft is still saved.", email=EmailOut.model_validate(email))
    except Exception as exc:
        email.delivery_status = "failed"
        _add_lead_activity(db, request, user.user_id, workspace, "email.send_failed", lead, {"email_id": str(email.id)})
        db.commit()
        capture_provider_exception(exc, provider="email", endpoint="workspace_app.email.send", workspace_id=workspace.id, lead_id=lead.id)
        return UsageActionOut(status="provider_unavailable", message="Email sending is temporarily unavailable. The approved draft is still saved.", email=EmailOut.model_validate(email))

    email.sent_at = datetime.utcnow()
    email.provider_message_id = str(provider_response.get("id"))
    email.delivery_status = "sent"
    email.tags = {**(email.tags if isinstance(email.tags, dict) else {}), "sender_email": sender_status.sender_email, "sender_provider": sender_status.provider}
    lead.status = LeadStatus.contacted
    lead.notes = _merge_lead_metadata(lead, {"email_status": "Sent", "email_sent_at": email.sent_at.isoformat()})
    _add_lead_activity(db, request, user.user_id, workspace, "email.sent", lead, {"email_id": str(email.id), "provider_message_id": email.provider_message_id})
    company = _sync_lead_to_crm(db, user.user_id, workspace, lead)
    db.commit()
    db.refresh(email)
    db.refresh(company)
    return UsageActionOut(status="success", message="Approved email was sent. CRM stage updated.", company=_crm_company_out(db, workspace, user.user_id, company), email=EmailOut.model_validate(email))
