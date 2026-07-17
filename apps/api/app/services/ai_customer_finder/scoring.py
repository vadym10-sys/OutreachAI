from __future__ import annotations

import re
from dataclasses import dataclass

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


@dataclass(frozen=True)
class ScoreResult:
    relevance_score: int
    confidence_score: int
    factors: dict[str, int]
    explanation: str


def clamp_score(value: int) -> int:
    return max(0, min(100, int(value)))


def score_candidate(criteria: CustomerFinderCriteria, *, text: str, industry: str, country: str, source_verified: bool) -> ScoreResult:
    haystack = f"{text} {industry} {country}".lower()
    industry_fit = 25 if criteria.target_industry.lower() in haystack else 12
    country_fit = 15 if criteria.target_country.lower() in haystack or criteria.target_country else 8
    use_case_terms = _terms(criteria.product_or_service)[:8] + _terms(criteria.additional_criteria)[:8]
    use_case_fit = min(25, sum(4 for term in use_case_terms if term in haystack))
    signal_strength = min(25, sum(weight for term, weight in HIGH_INTENT_TERMS.items() if term in haystack))
    disqualifier_penalty = min(40, sum(20 for term in criteria.exclusions if term.lower() in haystack))
    relevance = clamp_score(industry_fit + country_fit + use_case_fit + signal_strength - disqualifier_penalty)
    confidence = clamp_score((40 if source_verified else 10) + (20 if industry_fit >= 20 else 8) + (20 if signal_strength else 8) + min(20, len(text) // 600))
    factors = {
        "industry_fit": industry_fit,
        "country_fit": country_fit,
        "use_case_fit": use_case_fit,
        "signal_strength": signal_strength,
        "disqualifier_penalty": -disqualifier_penalty,
        "source_quality": 40 if source_verified else 10,
    }
    explanation = "Score uses verified public source quality, ICP fit, target-market fit, use-case language, and detected buying or timing signals."
    return ScoreResult(relevance_score=relevance, confidence_score=confidence, factors=factors, explanation=explanation)


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


def _terms(value: str) -> list[str]:
    return [term for term in re.split(r"[^a-z0-9]+", (value or "").lower()) if len(term) >= 4]
