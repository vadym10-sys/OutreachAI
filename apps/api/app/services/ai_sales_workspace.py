from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from app.core.config import get_settings
from app.models.entities import Company, Contact, Lead, WebsiteAnalysis
from app.services.ai import sales_copilot


def _clean_text(value: Any) -> str:
    return str(value or "").strip()


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return default
    return parsed


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

    return {
        "generated_at": datetime.utcnow().isoformat(),
        "provider": "openai",
        "model": settings.openai_model,
        "summary": copilot.fit_reason or company.ai_summary or "Potential fit exists but needs validation before outreach.",
        "opportunity_score": max(0, min(100, opportunity_score)),
        "buying_intent_score": max(0, min(100, copilot.probability_to_buy)),
        "confidence_score": max(0, min(100, confidence)),
        "decision_maker": {
            "name": top_contact.name if top_contact else "",
            "title": top_contact.title if top_contact else "",
            "email": top_contact.email if top_contact else "",
        },
        "outreach_angle": copilot.best_first_contact,
        "best_subject_line": copilot.best_subject_line,
        "best_cta": copilot.best_cta,
        "risk_to_check": copilot.risk_to_check or "Verify decision-maker context and active need before outreach.",
        "next_action": copilot.next_best_action or "Review the contact profile and send a tailored intro email.",
        "reasoning": [item for item in copilot.reasoning if _clean_text(item)],
        "missing_data": missing_data,
        "evidence": evidence,
        "version": 1,
    }


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
