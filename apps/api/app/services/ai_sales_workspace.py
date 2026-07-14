from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, Field, ValidationError

from app.core.config import get_settings
from app.core.observability import capture_provider_exception
from app.models.entities import Company, Contact, Lead, WebsiteAnalysis
from app.services.ai import ProviderRequestError, sales_copilot


class AISalesWorkspaceDecisionMaker(BaseModel):
    name: str = ""
    title: str = ""
    email: str = ""


class AISalesWorkspaceEvidence(BaseModel):
    source_field: str
    value: str
    confidence: int = Field(ge=1, le=100)


class AISalesWorkspaceAnalysisPayload(BaseModel):
    generated_at: str
    provider: str
    model: str
    version: int
    company_summary: str
    what_company_sells: str
    target_customers: str
    likely_business_pains: list[str] = Field(default_factory=list)
    buying_signals: list[str] = Field(default_factory=list)
    relevant_technologies: list[str] = Field(default_factory=list)
    why_fits_icp: list[str] = Field(default_factory=list)
    why_may_not_fit: list[str] = Field(default_factory=list)
    ai_lead_score: int = Field(ge=0, le=100)
    score_explanation: str
    estimated_reply_probability: int = Field(ge=0, le=100)
    recommended_decision_maker_role: str
    best_outreach_angle: str
    personalized_opening_line: str
    strongest_sales_arguments: list[str] = Field(default_factory=list)
    suggested_cta: str
    recommended_next_action: str
    decision_maker: AISalesWorkspaceDecisionMaker
    reasoning: list[str] = Field(default_factory=list)
    missing_data: list[str] = Field(default_factory=list)
    evidence: list[AISalesWorkspaceEvidence] = Field(default_factory=list)
    summary: str
    opportunity_score: int = Field(ge=0, le=100)
    buying_intent_score: int = Field(ge=0, le=100)
    confidence_score: int = Field(ge=0, le=100)
    outreach_angle: str
    best_subject_line: str
    best_cta: str
    risk_to_check: str
    next_action: str


def _clean_text(value: Any) -> str:
    return str(value or "").strip()


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return default
    return parsed


def _compact_list(values: list[str], *, max_items: int = 5) -> list[str]:
    seen: set[str] = set()
    compact: list[str] = []
    for value in values:
        text = _clean_text(value)
        if not text:
            continue
        key = text.lower()
        if key in seen:
            continue
        seen.add(key)
        compact.append(text)
        if len(compact) >= max_items:
            break
    return compact


def _first_contact(contacts: list[Contact]) -> Optional[Contact]:
    if not contacts:
        return None
    for contact in contacts:
        if contact.email:
            return contact
    return contacts[0]


def _build_evidence(
    *,
    company: Company,
    lead: Optional[Lead],
    top_contact: Optional[Contact],
    website_analysis: Optional[WebsiteAnalysis],
) -> list[dict[str, Any]]:
    evidence: list[dict[str, Any]] = []

    def add(field: str, value: Any, confidence: int) -> None:
        text = _clean_text(value)
        if not text:
            return
        evidence.append({"source_field": field, "value": text, "confidence": max(1, min(100, confidence))})

    add("company.name", company.name, 100)
    add("company.website", company.website or company.domain, 98)
    add("company.industry", company.industry, 86)
    add("company.ai_summary", company.ai_summary, 72)
    add("company.sales_angle", company.sales_angle, 78)
    add("company.outreach_strategy", company.outreach_strategy, 76)
    add("lead.status", lead.status.value if lead else "", 75)
    add("lead.notes", lead.notes if lead else "", 66)
    add("website_analysis.summary", website_analysis.summary if website_analysis else "", 84)
    add("decision_maker.title", top_contact.title if top_contact else "", 82)
    add("decision_maker.email", top_contact.email if top_contact else "", 94)

    seen: set[tuple[str, str]] = set()
    deduped: list[dict[str, Any]] = []
    for item in evidence:
        key = (str(item.get("source_field") or "").lower(), str(item.get("value") or "").lower())
        if key in seen:
            continue
        seen.add(key)
        deduped.append(item)
    return deduped[:12]


def build_ai_sales_workspace_analysis(
    *,
    company: Company,
    lead: Optional[Lead],
    contacts: list[Contact],
    website_analysis: Optional[WebsiteAnalysis],
    language: str,
) -> dict[str, Any]:
    top_contact = _first_contact(contacts)
    profile = {
        "company": company.name,
        "website": company.website or company.domain or "",
        "industry": company.industry or "",
        "country": company.country or "",
        "city": company.city or "",
        "website_summary": website_analysis.summary if website_analysis else company.ai_summary,
        "sales_angle": company.sales_angle,
        "outreach_strategy": company.outreach_strategy,
        "lead_status": lead.status.value if lead else "",
        "decision_maker": {
            "name": top_contact.name if top_contact else "",
            "title": top_contact.title if top_contact else "",
            "email": top_contact.email if top_contact else "",
        },
        "response_language": language or "English",
    }

    copilot = sales_copilot(profile)
    opportunity_score = int(round((copilot.probability_to_reply * 0.45) + (copilot.probability_to_buy * 0.55)))
    confidence = max(45, min(97, int(round((copilot.probability_to_reply + copilot.probability_to_buy) / 2))))
    missing_data: list[str] = []
    if not (company.website or company.domain):
        missing_data.append("website")
    if not company.industry:
        missing_data.append("industry")
    if not top_contact:
        missing_data.append("decision_maker")
    elif not top_contact.email:
        missing_data.append("decision_maker_email")

    evidence = _build_evidence(company=company, lead=lead, top_contact=top_contact, website_analysis=website_analysis)
    settings = get_settings()

    lead_metadata = lead.metadata_json if lead and isinstance(getattr(lead, "metadata_json", None), dict) else {}
    company_metadata = company.metadata_json if isinstance(company.metadata_json, dict) else {}

    lead_risks = list(lead_metadata.get("risks", []) or [])
    lead_signals = list(lead_metadata.get("buying_signals", []) or [])
    lead_technologies = list(lead_metadata.get("technologies", []) or [])

    pains = _compact_list(
        [
            *lead_risks,
            str(copilot.risk_to_check or ""),
            "Limited proof of urgency in publicly available data" if not lead_signals else "",
        ],
        max_items=5,
    )
    buying_signals = _compact_list([*lead_signals], max_items=6)
    technologies = _compact_list([*lead_technologies, *list(company_metadata.get("technologies", []) or []), *([company.industry] if company.industry else [])], max_items=8)

    fit_reasons = _compact_list(
        [
            str(copilot.fit_reason or ""),
            _clean_text(company.industry) and f"Industry match: {company.industry}",
            _clean_text(company.country) and f"Target market presence in {company.country}",
        ],
        max_items=4,
    )
    misfit_reasons = _compact_list(
        [
            "Missing verified decision-maker email" if "decision_maker_email" in missing_data else "",
            "Missing confirmed decision-maker profile" if "decision_maker" in missing_data else "",
            "Website or domain data is incomplete" if "website" in missing_data else "",
            "Industry details are incomplete" if "industry" in missing_data else "",
        ],
        max_items=4,
    )

    strongest_arguments = _compact_list(
        [
            *(copilot.reasoning or []),
            str(copilot.fit_reason or ""),
            _clean_text(company.sales_angle),
        ],
        max_items=3,
    )

    sells = _clean_text(company.ai_summary) or _clean_text(website_analysis.summary if website_analysis else "")
    if not sells:
        sells = "Core product and service details are limited in current data."

    target_customers = _clean_text(lead_metadata.get("business_category")) or _clean_text(company.industry) or "B2B customers matching workspace ICP settings"
    decision_role = _clean_text(top_contact.title if top_contact else "") or "Founder, CEO, VP Sales, or Revenue leader"
    opening_line = f"Hi {top_contact.name if top_contact and top_contact.name else 'there'}, I noticed {company.name} is focused on {target_customers.lower()} and thought this might be relevant."
    score_explanation = str(copilot.fit_reason or "") or "Score is based on fit, buyer intent, and available evidence quality."

    payload = {
        "generated_at": datetime.utcnow().isoformat(),
        "provider": "openai",
        "model": settings.openai_model,
        "version": 2,
        "company_summary": _clean_text(copilot.fit_reason) or company.ai_summary or "Potential fit exists but needs validation before outreach.",
        "what_company_sells": sells,
        "target_customers": target_customers,
        "likely_business_pains": pains,
        "buying_signals": buying_signals,
        "relevant_technologies": technologies,
        "why_fits_icp": fit_reasons,
        "why_may_not_fit": misfit_reasons,
        "ai_lead_score": max(0, min(100, opportunity_score)),
        "score_explanation": score_explanation,
        "estimated_reply_probability": max(0, min(100, copilot.probability_to_reply)),
        "recommended_decision_maker_role": decision_role,
        "best_outreach_angle": str(copilot.best_first_contact or company.sales_angle or "Lead with a concrete operational outcome."),
        "personalized_opening_line": opening_line,
        "strongest_sales_arguments": strongest_arguments,
        "suggested_cta": str(copilot.best_cta or "Book a 15-minute discovery call"),
        "recommended_next_action": str(copilot.next_best_action or "Review fit and send first personalized email."),
        "decision_maker": {
            "name": top_contact.name if top_contact else "",
            "title": top_contact.title if top_contact else "",
            "email": top_contact.email if top_contact else "",
        },
        "reasoning": [item for item in copilot.reasoning if _clean_text(item)],
        "missing_data": missing_data,
        "evidence": evidence,
        "summary": _clean_text(copilot.fit_reason) or company.ai_summary or "Potential fit exists but needs validation before outreach.",
        "opportunity_score": max(0, min(100, opportunity_score)),
        "buying_intent_score": max(0, min(100, copilot.probability_to_buy)),
        "confidence_score": max(0, min(100, confidence)),
        "outreach_angle": str(copilot.best_first_contact or company.sales_angle or "Lead with a concrete operational outcome."),
        "best_subject_line": str(copilot.best_subject_line or "Quick idea for your team"),
        "best_cta": str(copilot.best_cta or "Book a quick call"),
        "risk_to_check": str(copilot.risk_to_check or "Verify decision-maker context and active need before outreach."),
        "next_action": str(copilot.next_best_action or "Review the contact profile and send a tailored intro email."),
    }

    try:
        validated = AISalesWorkspaceAnalysisPayload.model_validate(payload)
    except ValidationError as exc:
        capture_provider_exception(exc, provider="openai", endpoint="workspace_app.ai_sales_analysis.validation")
        raise ProviderRequestError("AI sales analysis response did not match required schema.") from exc

    return validated.model_dump()


def read_cached_analysis(metadata_json: dict[str, Any]) -> dict[str, Any]:
    cached = metadata_json.get("ai_sales_workspace") if isinstance(metadata_json.get("ai_sales_workspace"), dict) else {}
    if not cached:
        return {}
    payload = dict(cached)
    payload.setdefault("version", _safe_int(payload.get("version"), 1))
    payload.setdefault("evidence", [])
    payload.setdefault("reasoning", [])
    payload.setdefault("missing_data", [])
    return payload
