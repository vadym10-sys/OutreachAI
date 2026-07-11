from __future__ import annotations

import logging
import re
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
    _outreach_sender_runtime_config,
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
from app.services.deep_contact_search import DeepContactSearchError, normalize_domain, run_deep_contact_search
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
    missing_fields: list[str] = Field(default_factory=list)
    recommended_actions: list[str] = Field(default_factory=list)
    next_action: str = ""


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
        "AI website research" if has_analysis else "",
        "Verified decision-maker contact" if has_email else "",
        "Technology profile" if technologies or deep_contact.get("technologies") else "",
    ]
    used_sources = [item for item in used_sources if item]
    gaps = [
        _localized_fallback_text(language, "risk_website") if not has_website else "",
        _localized_fallback_text(language, "risk_email") if not has_email else "",
        "Decision maker is not verified yet." if not has_contact else "",
        "Technology stack is unavailable until a technographic source is connected." if not technologies and not deep_contact.get("technologies") else "",
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
            "Enough verified context for a sales review."
            if has_analysis and has_email
            else "Useful starter brief; connect or verify the missing data before sending outreach."
        ),
        "confidence_reason": (
            "High confidence because company research and a verified contact are available."
            if has_analysis and has_email
            else "Confidence is limited by missing verified contact or website research."
        ),
        "provider_improvements": [
            "Connect company enrichment to improve firmographics and decision-maker coverage.",
            "Connect contact verification to increase email confidence.",
            "Connect technographic enrichment to personalize the sales angle by website stack.",
        ],
        "confidence_score": score,
    }


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
    offer_focus = workspace.company or getattr(workspace, "offer", "") or "a focused B2B partnership and outbound workflow"
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
    updates["intelligence_quality"] = _company_intelligence_quality(lead, {**metadata, **updates}, workspace, source, language)
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
        _set_workflow_stage(lead, "ai_email", "completed", "A personalized first email generated from the company research.")
        _set_workflow_stage(
            lead,
            "approval",
            "completed" if existing.delivery_status in {"approved", "sent"} else "waiting",
            "Human review completed. The email is ready to send." if existing.delivery_status in {"approved", "sent"} else "Review the draft, edit it if needed, then approve before sending.",
        )
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
    _set_workflow_stage(lead, "ai_email", "completed", "A personalized first email generated from the company research.")
    _set_workflow_stage(lead, "approval", "waiting", "Review the draft, edit it if needed, then approve before sending.")
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
                _ensure_b2b_opportunity_metadata(lead, workspace, source="turnkey_fallback", language=_workspace_language(request, workspace))
                metadata = _lead_metadata(lead)
                if metadata.get("ai_summary") or metadata.get("suggested_offer") or metadata.get("expected_reply_rate"):
                    _add_lead_activity(db, request, user_id, workspace, "website.analyzed", lead, {"source": "turnkey_lead_research"})
                else:
                    warnings.append(f"{lead.company}: AI research could not complete yet.")
                    _lead_trace(request_id, "turnkey_ai_research_partial", lead_id=str(lead.id), company=lead.company)
            _sync_lead_to_crm(db, user_id, workspace, lead)
        except Exception as exc:
            capture_provider_exception(exc, provider="openai", endpoint="workspace_app.turnkey_research", workspace_id=workspace.id, lead_id=lead.id, extra={"request_id": request_id})
            _ensure_b2b_opportunity_metadata(lead, workspace, source="turnkey_fallback_after_ai_error", language=_workspace_language(request, workspace))
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
    return _search_leads_impl(payload, request, user, db, run_turnkey_research=True)


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
    if run_turnkey_research:
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
    else:
        warnings.append("Companies were saved quickly. Open a company and run missing AI research when needed.")
        _lead_trace(request_id, "turnkey_research_batch_skipped", reason="ai_command_fast_path", leads=len(saved))

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
    elif not run_turnkey_research:
        message = f"Found and saved {len(companies)} companies. Open any company to complete AI research and outreach."
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
        _ensure_b2b_opportunity_metadata(lead, workspace, source="workspace_analyze", language=_workspace_language(request, workspace))
        _add_lead_activity(db, request, user.user_id, workspace, "website.analyzed", lead, {"source": "workspace_app"})
        db.commit()
        company = _sync_lead_to_crm(db, user.user_id, workspace, lead)
        db.commit()
        return UsageActionOut(status="success", message="Website analysis saved.", company=_crm_company_out(db, workspace, user.user_id, company))
    except Exception as exc:
        capture_provider_exception(exc, provider="openai", endpoint="workspace_app.company.analyze", workspace_id=workspace.id, lead_id=lead.id)
        return UsageActionOut(status="provider_unavailable", message=_safe_provider_warning(exc), company=_crm_company_out(db, workspace, user.user_id, company))


@router.post("/companies/{company_id}/deep-contact-search", response_model=UsageActionOut)
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
    domain = normalize_domain(company.domain or company.website or (lead.website if lead else "") or "")
    if not domain:
        return UsageActionOut(
            status="error",
            message="Add a company website before running deep contact search.",
            company=_crm_company_out(db, workspace, user.user_id, company),
            missing_fields=["website"],
            recommended_actions=["Add website", "Add contact manually"],
        )

    request_id = request.headers.get("x-request-id") or str(uuid4())
    _lead_trace(request_id, "deep_contact_search_started", lead_id=str(lead.id) if lead else "", company=company.name, domain=domain)
    _set_company_metadata_stage(company, "decision_maker", "running", "Searching for decision makers across connected sources.")
    _set_company_metadata_stage(company, "verified_email", "running", "Finding and verifying a usable business email.")
    _set_company_metadata_stage(company, "technographics", "running", "Detecting the website technology stack.")
    try:
        result = run_deep_contact_search(
            domain=domain,
            company_name=company.name,
            industry=company.industry or (lead.industry if lead else "") or "",
            product_context=workspace.company or workspace.target_customer or "",
            existing_metadata=company.metadata_json or {},
            force=payload.force,
        )
    except DeepContactSearchError as exc:
        capture_provider_exception(exc, provider="deep_contact_search", endpoint="workspace_app.company.deep_contact_search", workspace_id=workspace.id, lead_id=lead.id if lead else None)
        _set_company_metadata_stage(company, "decision_maker", "error", str(exc))
        _set_company_metadata_stage(company, "verified_email", "error", "No verified email was saved.")
        db.commit()
        return UsageActionOut(
            status="provider_unavailable",
            message=str(exc),
            company=_crm_company_out(db, workspace, user.user_id, company),
            missing_fields=["decision_maker", "verified_email"],
            recommended_actions=["Retry search", "Add contact manually"],
        )

    _apply_deep_contact_result(db, request, user.user_id, workspace, company, lead, result)
    db.commit()
    db.refresh(company)
    company_out = _crm_company_out(db, workspace, user.user_id, company)
    _lead_trace(
        request_id,
        "deep_contact_search_finished",
        lead_id=str(lead.id) if lead else "",
        company=company.name,
        status=result.status,
        candidates=len(result.candidates),
        verified=bool(result.verified_email),
    )
    return UsageActionOut(
        status=result.status if result.status in {"success", "partial_success"} else "partial_success",
        message=(
            "Deep contact search completed with a verified decision maker."
            if result.verified_email
            else "Deep contact search completed, but no verified email was found. Add one manually or retry later."
        ),
        company=company_out,
        warnings=[error.get("message", "") for error in result.errors if error.get("message")][:4],
        completed_steps=[stage for stage, state in result.stages.items() if state == "completed"],
        workflow_stages=company_out.workflow_stages,
        missing_fields=[] if result.verified_email else ["verified_email"],
        recommended_actions=["Generate email for review"] if result.verified_email else ["Add email manually", "Retry search"],
        next_action="Generate email for review" if result.verified_email else "Add a verified email or choose another contact",
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
        _set_workflow_stage(lead, "company_profile", "completed", "Saved company, location, website, phone and business listing data.")
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
        _set_workflow_stage(lead, "website_analysis", "running", "AI is analyzing the company website and sales angle.")
        metadata = _lead_metadata(lead)
        has_completed_research = bool(metadata.get("website_analyzed_at"))
        if (lead.website or metadata.get("domain")) and (_needs_ai_research(lead) or not has_completed_research):
            _analyze_lead_if_possible(db, user.user_id, workspace, lead, language=_workspace_language(request, workspace))
        _ensure_b2b_opportunity_metadata(lead, workspace, source="complete_opportunity", language=_workspace_language(request, workspace))
        metadata = _lead_metadata(lead)
        if not any(metadata.get(key) for key in ("ai_summary", "opportunity_analysis", "suggested_offer", "pain_points")):
            warnings.append("AI research could not complete yet. The company is saved and can be retried.")
            _set_workflow_stage(lead, "website_analysis", "error", "Run website analysis to fill summary, pain points and opportunity angle.")
        else:
            _set_workflow_stage(lead, "website_analysis", "completed", "AI summary, services, sales angle, offer and useful personalization facts.")
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
        _set_workflow_stage(lead, "decision_maker", "running", "Finding a decision maker or usable contact role.")
        _set_workflow_stage(lead, "verified_email", "running", "Verifying a usable business email when available.")
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
                    _set_workflow_stage(lead, "decision_maker", "error", "Find a decision maker or add the right contact manually.")
                    _set_workflow_stage(lead, "verified_email", "error", "Find a verified email or add a known business email manually.")
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
                _set_workflow_stage(lead, "decision_maker", "error", "Find a decision maker or add the right contact manually.")
                _set_workflow_stage(lead, "verified_email", "error", "Find a verified email or add a known business email manually.")
                _add_lead_activity(db, request, user.user_id, workspace, "contact.search_empty", lead, {"source": "complete_opportunity"})
        if lead.email:
            _set_workflow_stage(lead, "decision_maker", "completed", "A real person or role to contact. If not verified, add it manually.")
            _set_workflow_stage(lead, "verified_email", "completed", "A usable business email. OutreachAI never invents missing email addresses.")
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
        _set_workflow_stage(lead, "decision_maker", "error", "Contact search is temporarily unavailable. Add a contact manually and continue.")
        _set_workflow_stage(lead, "verified_email", "error", "Contact search is temporarily unavailable. Add a contact manually and continue.")
        completed_steps.append("Contact search checked")
        _lead_trace(request_id, "complete_opportunity_contacts_failed", lead_id=str(lead.id), company=lead.company, reason=str(exc))

    _lead_trace(request_id, "complete_opportunity_email_started", lead_id=str(lead.id), company=lead.company)
    try:
        _set_workflow_stage(lead, "ai_email", "running", "Generating a personalized email for review.")
        _ensure_b2b_opportunity_metadata(lead, workspace, source="complete_opportunity_before_draft", language=_workspace_language(request, workspace))
        email = _create_review_email_draft(db, request, user.user_id, workspace, lead)
        db.flush()
        if email:
            _set_workflow_stage(lead, "ai_email", "completed", "A personalized first email generated from the company research.")
            _set_workflow_stage(lead, "approval", "waiting", "Review the draft, edit it if needed, then approve before sending.")
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
        _set_workflow_stage(lead, "ai_email", "error", "Generate a personalized email for review. Sending stays blocked until approval.")
        completed_steps.append("Email draft checked")
        _lead_trace(request_id, "complete_opportunity_email_failed", lead_id=str(lead.id), company=lead.company, reason=str(exc))

    _lead_trace(request_id, "complete_opportunity_database_save_started", lead_id=str(lead.id), company=lead.company)
    company = _sync_lead_to_crm(db, user.user_id, workspace, lead)
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
        **guidance,
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
