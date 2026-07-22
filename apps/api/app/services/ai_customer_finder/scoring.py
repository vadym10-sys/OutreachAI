from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime, timezone

from app.services.ai_customer_finder.schemas import CustomerFinderCriteria


HIGH_INTENT_TERMS = {
    "looking for": 16,
    "alternative": 14,
    "migrate": 14,
    "migration": 14,
    "replace": 12,
    "manual": 12,
    "spreadsheet": 10,
    "hiring": 10,
    "careers": 8,
    "jobs": 8,
    "launch": 8,
    "funding": 8,
    "expansion": 8,
    "integrations": 6,
}

GROWTH_SIGNAL_TERMS = {
    "hiring": 18,
    "careers": 14,
    "jobs": 14,
    "we are hiring": 18,
    "funding": 18,
    "raised": 18,
    "series a": 20,
    "seed round": 18,
    "expansion": 18,
    "new market": 16,
    "launch": 14,
    "new product": 14,
    "growing": 12,
}

TECHNOLOGY_CHANGE_TERMS = {
    "api": 12,
    "integration": 14,
    "integrations": 14,
    "automation": 16,
    "crm": 12,
    "platform": 10,
    "workflow": 10,
    "migrate": 16,
    "migration": 16,
    "replace": 14,
    "replacing": 14,
}

EXPLICIT_INTENT_TERMS = {
    "looking for": 20,
    "recommend a tool": 20,
    "alternative to": 18,
    "replace": 16,
    "replacing": 16,
    "migrate": 16,
    "migration": 16,
    "need a": 12,
    "evaluating": 12,
}

NEGATIVE_TERMS = {
    "not hiring": 18,
    "hiring freeze": 18,
    "layoff": 16,
    "layoffs": 16,
    "closed": 20,
    "shut down": 20,
    "no budget": 14,
}

SCORING_VERSION = "lead-intelligence-v3"


@dataclass(frozen=True)
class ScoreResult:
    relevance_score: int
    confidence_score: int
    factors: dict[str, int]
    explanation: str
    icp_fit_score: int = 0
    buying_intent_score: int = 0
    revenue_opportunity_score: int = 0
    overall_lead_score: int = 0
    growth_signal_score: int = 0
    website_quality_score: int = 0
    technology_fit_score: int = 0
    contact_confidence_score: int = 0
    outreach_readiness_score: int = 0
    lead_intelligence: dict[str, object] = field(default_factory=dict)
    weights: dict[str, int] = field(default_factory=dict)
    penalties: dict[str, int] = field(default_factory=dict)
    scoring_version: str = SCORING_VERSION
    source_quality_score: int = 0
    signal_strength: int = 0
    has_meaningful_signal: bool = False
    verification_status: str = "unknown"


def clamp_score(value: int) -> int:
    return max(0, min(100, int(value)))


def score_candidate(
    criteria: CustomerFinderCriteria,
    *,
    text: str,
    industry: str,
    country: str,
    source_verified: bool,
    source_type: str = "official_website",
    publication_date: str = "Unknown",
    independent_source_count: int = 1,
    source_diversity: int = 1,
    public_work_contact: str = "",
    contact_title: str = "",
) -> ScoreResult:
    haystack = f"{text} {industry} {country}".lower()
    industry_fit = 30 if criteria.target_industry and criteria.target_industry.lower() in haystack else 12
    country_fit = 18 if criteria.target_country and criteria.target_country.lower() in haystack else 8 if not criteria.target_country else 4
    use_case_terms = (
        _terms(criteria.company_description)[:6]
        + _terms(criteria.product_or_service)[:8]
        + _terms(criteria.additional_criteria)[:8]
    )
    use_case_fit = min(28, sum(4 for term in use_case_terms if term in haystack))
    signal_strength = min(30, sum(weight for term, weight in HIGH_INTENT_TERMS.items() if term in haystack))
    explicitness = min(20, sum(weight for term, weight in EXPLICIT_INTENT_TERMS.items() if term in haystack))
    growth_signal = clamp_score(sum(weight for term, weight in GROWTH_SIGNAL_TERMS.items() if term in haystack))
    evidence_quality = _source_quality(source_verified=source_verified, source_type=source_type, text=text)
    recency = _recency_score(publication_date)
    diversity = min(12, max(0, independent_source_count) * 4 + max(0, source_diversity - 1) * 4)
    negative_penalty = min(35, sum(weight for term, weight in NEGATIVE_TERMS.items() if term in haystack))
    disqualifier_penalty = min(40, sum(20 for term in criteria.exclusions if term.lower() in haystack))
    icp_fit = clamp_score(industry_fit + country_fit + use_case_fit - disqualifier_penalty)
    has_meaningful_signal = signal_strength >= 10 or explicitness >= 12
    raw_intent = signal_strength + explicitness + recency + evidence_quality // 2 + diversity - negative_penalty - disqualifier_penalty
    buying_intent = clamp_score(raw_intent)
    if not has_meaningful_signal:
        buying_intent = min(buying_intent, 38)
    if evidence_quality < 20:
        buying_intent = min(buying_intent, 45)
    revenue = clamp_score(round(icp_fit * 0.45 + buying_intent * 0.4 + evidence_quality * 0.15))
    website_quality = clamp_score(evidence_quality + min(20, len(text or "") // 500) + (8 if source_type == "official_website" else 0))
    technology_fit = _technology_fit_score(criteria, haystack)
    contact_confidence = _contact_confidence_score(public_work_contact=public_work_contact, contact_title=contact_title, source_verified=source_verified)
    outreach_readiness = clamp_score(round(buying_intent * 0.36 + contact_confidence * 0.28 + evidence_quality * 0.2 + icp_fit * 0.16))
    if not public_work_contact:
        outreach_readiness = min(outreach_readiness, 58)
    if not has_meaningful_signal:
        outreach_readiness = min(outreach_readiness, 42)
    overall_lead_score = clamp_score(
        round(
            icp_fit * 0.24
            + buying_intent * 0.24
            + growth_signal * 0.14
            + website_quality * 0.12
            + technology_fit * 0.10
            + contact_confidence * 0.08
            + outreach_readiness * 0.08
        )
    )
    confidence = clamp_score(
        (evidence_quality * 0.65)
        + (30 if has_meaningful_signal else 6)
        + (8 if source_verified else 0)
        + min(20, len(text) // 600)
        + min(15, diversity)
    )
    factors = {
        "industry_fit": industry_fit,
        "country_fit": country_fit,
        "use_case_fit": use_case_fit,
        "signal_strength": signal_strength,
        "signal_explicitness": explicitness,
        "growth_signal": growth_signal,
        "website_quality": website_quality,
        "technology_fit": technology_fit,
        "contact_confidence": contact_confidence,
        "outreach_readiness": outreach_readiness,
        "overall_lead_score": overall_lead_score,
        "signal_recency": recency,
        "source_quality": evidence_quality,
        "source_diversity": diversity,
        "negative_evidence": -negative_penalty,
        "disqualifier_penalty": -disqualifier_penalty,
    }
    penalties = {
        "disqualifiers": disqualifier_penalty,
        "negative_or_contradictory_evidence": negative_penalty,
        "stale_or_unknown_publication_date": max(0, 18 - recency),
        "weak_or_missing_buying_signal": 22 if not has_meaningful_signal else 0,
    }
    weights = {
        "industry_fit": 30,
        "country_fit": 18,
        "use_case_fit": 28,
        "signal_strength": 30,
        "signal_explicitness": 20,
        "signal_recency": 18,
        "source_quality": 30,
        "source_diversity": 12,
        "overall_lead_score": 100,
        "lead_score_icp_match": 24,
        "lead_score_buying_intent": 24,
        "lead_score_growth_signal": 14,
        "lead_score_website_quality": 12,
        "lead_score_technology_fit": 10,
        "lead_score_contact_confidence": 8,
        "lead_score_outreach_readiness": 8,
    }
    lead_intelligence = {
        "overall_lead_score": overall_lead_score,
        "components": {
            "icp_match": icp_fit,
            "buying_intent": buying_intent,
            "growth_signal": growth_signal,
            "website_quality": website_quality,
            "technology_fit": technology_fit,
            "contact_confidence": contact_confidence,
            "outreach_readiness": outreach_readiness,
        },
        "evidence": {
            "buying_intent_terms": _matched_terms(haystack, HIGH_INTENT_TERMS | EXPLICIT_INTENT_TERMS),
            "growth_terms": _matched_terms(haystack, GROWTH_SIGNAL_TERMS),
            "technology_terms": _matched_terms(haystack, TECHNOLOGY_CHANGE_TERMS),
        },
        "insufficient_data": _insufficient_data(
            has_meaningful_signal=has_meaningful_signal,
            growth_signal=growth_signal,
            technology_fit=technology_fit,
            public_work_contact=public_work_contact,
            source_verified=source_verified,
            evidence_quality=evidence_quality,
        ),
    }
    explanation = (
        "Scores are deterministic: Overall Lead Score blends ICP match, public buying intent, growth, website evidence, technology fit, "
        "contact confidence, and outreach readiness. Missing public evidence lowers the score instead of being inferred."
    )
    status = "verified" if source_verified and evidence_quality >= 24 and has_meaningful_signal else "partially_verified" if source_verified else "unknown"
    return ScoreResult(
        relevance_score=buying_intent,
        confidence_score=confidence,
        factors=factors,
        explanation=explanation,
        icp_fit_score=icp_fit,
        buying_intent_score=buying_intent,
        revenue_opportunity_score=revenue,
        overall_lead_score=overall_lead_score,
        growth_signal_score=growth_signal,
        website_quality_score=website_quality,
        technology_fit_score=technology_fit,
        contact_confidence_score=contact_confidence,
        outreach_readiness_score=outreach_readiness,
        lead_intelligence=lead_intelligence,
        weights=weights,
        penalties=penalties,
        source_quality_score=evidence_quality,
        signal_strength=signal_strength,
        has_meaningful_signal=has_meaningful_signal,
        verification_status=status,
    )


def signal_type_from_text(text: str) -> str:
    lower = text.lower()
    if any(term in lower for term in ["looking for", "recommend a tool", "alternative to", "replace"]):
        return "explicit_solution_request"
    if any(term in lower for term in ["manual", "spreadsheet", "copy paste", "workaround"]):
        return "manual_workaround"
    if any(term in lower for term in ["hiring", "careers", "jobs", "we are hiring"]):
        return "hiring_related_workflow"
    if any(term in lower for term in ["funding", "series a", "seed round", "raised"]):
        return "funding_or_growth"
    if any(term in lower for term in ["launch", "new product", "expansion", "new market"]):
        return "company_expansion_or_launch"
    if any(term in lower for term in ["api", "integration", "platform", "automation", "crm"]):
        return "public_technology_adoption"
    return "public_company_fit"


def meaningful_signal_present(text: str) -> bool:
    lower = (text or "").lower()
    return any(term in lower for term in HIGH_INTENT_TERMS) or any(term in lower for term in EXPLICIT_INTENT_TERMS)


def _terms(value: str) -> list[str]:
    return [term for term in re.split(r"[^a-z0-9]+", (value or "").lower()) if len(term) >= 4]


def _source_quality(*, source_verified: bool, source_type: str, text: str) -> int:
    if not source_verified:
        return 5
    source_bonus = 30 if source_type in {"official_website", "company_news", "job_post", "press_release"} else 22
    text_bonus = min(10, len(text or "") // 1000)
    return clamp_score(source_bonus + text_bonus)


def _technology_fit_score(criteria: CustomerFinderCriteria, haystack: str) -> int:
    product_terms = _terms(criteria.product_or_service)[:10] + _terms(criteria.company_description)[:8]
    overlap = min(40, sum(5 for term in product_terms if term in haystack))
    tech_change = min(45, sum(weight for term, weight in TECHNOLOGY_CHANGE_TERMS.items() if term in haystack))
    return clamp_score(overlap + tech_change)


def _contact_confidence_score(*, public_work_contact: str, contact_title: str, source_verified: bool) -> int:
    if public_work_contact:
        return 84 if source_verified else 66
    if contact_title:
        return 42 if source_verified else 28
    return 20 if source_verified else 8


def _matched_terms(haystack: str, terms: dict[str, int]) -> list[str]:
    return [term for term in terms if term in haystack][:12]


def _insufficient_data(
    *,
    has_meaningful_signal: bool,
    growth_signal: int,
    technology_fit: int,
    public_work_contact: str,
    source_verified: bool,
    evidence_quality: int,
) -> list[str]:
    missing: list[str] = []
    if not source_verified or evidence_quality < 20:
        missing.append("verified_public_source")
    if not has_meaningful_signal:
        missing.append("buying_intent")
    if growth_signal <= 0:
        missing.append("growth_signal")
    if technology_fit <= 20:
        missing.append("technology_change")
    if not public_work_contact:
        missing.append("public_work_contact")
    return missing


def _recency_score(publication_date: str) -> int:
    value = (publication_date or "").strip()
    if not value or value.lower() == "unknown":
        return 6
    parsed = _parse_date(value)
    if parsed is None:
        return 6
    age_days = max(0, (datetime.now(timezone.utc) - parsed).days)
    if age_days <= 30:
        return 18
    if age_days <= 90:
        return 14
    if age_days <= 180:
        return 10
    if age_days <= 365:
        return 6
    return 2


def _parse_date(value: str) -> datetime | None:
    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%Y-%m", "%Y"):
        try:
            parsed = datetime.strptime(value[: len(fmt)], fmt)
            return parsed.replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except ValueError:
        return None
