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

HIRING_SIGNAL_TERMS = {
    "hiring": 22,
    "we are hiring": 24,
    "careers": 14,
    "jobs": 14,
    "open roles": 18,
    "sales operations roles": 20,
    "revenue operations": 18,
    "sdr": 14,
    "account executive": 14,
}

FUNDING_SIGNAL_TERMS = {
    "funding": 22,
    "raised": 22,
    "series a": 24,
    "series b": 24,
    "seed round": 22,
    "investment": 16,
    "backed by": 14,
    "new capital": 18,
}

EXPANSION_SIGNAL_TERMS = {
    "expansion": 22,
    "new market": 20,
    "launch": 16,
    "launched": 16,
    "new product": 18,
    "new office": 18,
    "international": 14,
    "partnership": 14,
    "partnerships": 14,
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

URGENCY_TERMS = {
    "now": 10,
    "today": 10,
    "this quarter": 12,
    "this month": 12,
    "scaling": 14,
    "rapid growth": 16,
    "replacing": 16,
    "migration": 16,
    "manual": 10,
    "spreadsheet": 10,
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
    "not interested": 18,
    "not looking": 16,
    "personal blog": 14,
    "directory": 12,
    "marketplace": 12,
    "agency": 8,
}

SCORING_VERSION = "lead-intelligence-v4"
LeadReasoning = dict[str, object]


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
    hiring_signal_score: int = 0
    funding_signal_score: int = 0
    expansion_signal_score: int = 0
    website_quality_score: int = 0
    technology_fit_score: int = 0
    contact_confidence_score: int = 0
    outreach_readiness_score: int = 0
    company_momentum_score: int = 0
    urgency_score: int = 0
    ai_confidence_score: int = 0
    lead_intelligence: dict[str, object] = field(default_factory=dict)
    lead_reasoning: LeadReasoning = field(default_factory=dict)
    passes_quality_gate: bool = False
    rejection_reason: str = ""
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
    hiring_signal = clamp_score(sum(weight for term, weight in HIRING_SIGNAL_TERMS.items() if term in haystack))
    funding_signal = clamp_score(sum(weight for term, weight in FUNDING_SIGNAL_TERMS.items() if term in haystack))
    expansion_signal = clamp_score(sum(weight for term, weight in EXPANSION_SIGNAL_TERMS.items() if term in haystack))
    broad_growth_signal = clamp_score(sum(weight for term, weight in GROWTH_SIGNAL_TERMS.items() if term in haystack))
    growth_signal = clamp_score(round(max(broad_growth_signal, hiring_signal, funding_signal, expansion_signal) * 0.6 + (hiring_signal + funding_signal + expansion_signal) * 0.18))
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
    urgency = _urgency_score(haystack=haystack, explicitness=explicitness, recency=recency, has_meaningful_signal=has_meaningful_signal)
    company_momentum = clamp_score(round(hiring_signal * 0.32 + funding_signal * 0.26 + expansion_signal * 0.26 + growth_signal * 0.16))
    outreach_readiness = clamp_score(round(buying_intent * 0.36 + contact_confidence * 0.28 + evidence_quality * 0.2 + icp_fit * 0.16))
    if not public_work_contact:
        outreach_readiness = min(outreach_readiness, 58)
    if not has_meaningful_signal:
        outreach_readiness = min(outreach_readiness, 42)
    confidence = clamp_score(
        (evidence_quality * 0.65)
        + (30 if has_meaningful_signal else 6)
        + (8 if source_verified else 0)
        + min(20, len(text) // 600)
        + min(15, diversity)
    )
    ai_confidence = _ai_confidence_score(
        confidence=confidence,
        evidence_quality=evidence_quality,
        has_meaningful_signal=has_meaningful_signal,
        negative_penalty=negative_penalty,
        disqualifier_penalty=disqualifier_penalty,
        public_work_contact=public_work_contact,
        company_momentum=company_momentum,
    )
    overall_lead_score = clamp_score(
        round(
            icp_fit * 0.18
            + buying_intent * 0.20
            + company_momentum * 0.14
            + urgency * 0.10
            + website_quality * 0.10
            + technology_fit * 0.10
            + contact_confidence * 0.08
            + outreach_readiness * 0.06
            + ai_confidence * 0.04
        )
    )
    passes_quality_gate, rejection_reason = _quality_gate(
        icp_fit=icp_fit,
        buying_intent=buying_intent,
        company_momentum=company_momentum,
        website_quality=website_quality,
        ai_confidence=ai_confidence,
        negative_penalty=negative_penalty,
        disqualifier_penalty=disqualifier_penalty,
        has_meaningful_signal=has_meaningful_signal,
    )
    factors = {
        "industry_fit": industry_fit,
        "country_fit": country_fit,
        "use_case_fit": use_case_fit,
        "signal_strength": signal_strength,
        "signal_explicitness": explicitness,
        "growth_signal": growth_signal,
        "hiring_signal": hiring_signal,
        "funding_signal": funding_signal,
        "expansion_signal": expansion_signal,
        "website_quality": website_quality,
        "technology_fit": technology_fit,
        "contact_confidence": contact_confidence,
        "outreach_readiness": outreach_readiness,
        "company_momentum": company_momentum,
        "urgency": urgency,
        "ai_confidence": ai_confidence,
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
        "quality_gate": 0 if passes_quality_gate else 30,
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
        "lead_score_company_momentum": 14,
        "lead_score_urgency": 10,
        "lead_score_website_quality": 10,
        "lead_score_technology_fit": 10,
        "lead_score_contact_confidence": 8,
        "lead_score_outreach_readiness": 6,
        "lead_score_ai_confidence": 4,
    }
    evidence = {
        "buying_intent_terms": _matched_terms(haystack, HIGH_INTENT_TERMS | EXPLICIT_INTENT_TERMS),
        "growth_terms": _matched_terms(haystack, GROWTH_SIGNAL_TERMS),
        "hiring_terms": _matched_terms(haystack, HIRING_SIGNAL_TERMS),
        "funding_terms": _matched_terms(haystack, FUNDING_SIGNAL_TERMS),
        "expansion_terms": _matched_terms(haystack, EXPANSION_SIGNAL_TERMS),
        "technology_terms": _matched_terms(haystack, TECHNOLOGY_CHANGE_TERMS),
        "urgency_terms": _matched_terms(haystack, URGENCY_TERMS),
        "risk_terms": _matched_terms(haystack, NEGATIVE_TERMS),
    }
    insufficient_data = _insufficient_data(
        has_meaningful_signal=has_meaningful_signal,
        hiring_signal=hiring_signal,
        funding_signal=funding_signal,
        expansion_signal=expansion_signal,
        technology_fit=technology_fit,
        public_work_contact=public_work_contact,
        source_verified=source_verified,
        evidence_quality=evidence_quality,
    )
    lead_reasoning = _lead_reasoning(
        criteria=criteria,
        icp_fit=icp_fit,
        buying_intent=buying_intent,
        company_momentum=company_momentum,
        urgency=urgency,
        technology_fit=technology_fit,
        contact_confidence=contact_confidence,
        outreach_readiness=outreach_readiness,
        ai_confidence=ai_confidence,
        source_verified=source_verified,
        public_work_contact=public_work_contact,
        evidence=evidence,
        insufficient_data=insufficient_data,
        negative_penalty=negative_penalty,
        rejection_reason=rejection_reason,
        passes_quality_gate=passes_quality_gate,
    )
    lead_intelligence = {
        "overall_lead_score": overall_lead_score,
        "score_model": "outreach_success_probability",
        "passes_quality_gate": passes_quality_gate,
        "rejection_reason": rejection_reason,
        "components": {
            "icp_match": icp_fit,
            "buying_intent": buying_intent,
            "growth_signal": growth_signal,
            "hiring_signal": hiring_signal,
            "funding_signal": funding_signal,
            "expansion_signal": expansion_signal,
            "website_quality": website_quality,
            "technology_fit": technology_fit,
            "contact_confidence": contact_confidence,
            "outreach_readiness": outreach_readiness,
            "company_momentum": company_momentum,
            "urgency": urgency,
            "ai_confidence": ai_confidence,
        },
        "evidence": evidence,
        "insufficient_data": insufficient_data,
        "reasoning": lead_reasoning,
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
        hiring_signal_score=hiring_signal,
        funding_signal_score=funding_signal,
        expansion_signal_score=expansion_signal,
        website_quality_score=website_quality,
        technology_fit_score=technology_fit,
        contact_confidence_score=contact_confidence,
        outreach_readiness_score=outreach_readiness,
        company_momentum_score=company_momentum,
        urgency_score=urgency,
        ai_confidence_score=ai_confidence,
        lead_intelligence=lead_intelligence,
        lead_reasoning=lead_reasoning,
        passes_quality_gate=passes_quality_gate,
        rejection_reason=rejection_reason,
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
    signal_terms = (
        set(HIGH_INTENT_TERMS)
        | set(EXPLICIT_INTENT_TERMS)
        | set(HIRING_SIGNAL_TERMS)
        | set(FUNDING_SIGNAL_TERMS)
        | set(EXPANSION_SIGNAL_TERMS)
        | set(TECHNOLOGY_CHANGE_TERMS)
    )
    return any(term in lower for term in signal_terms)


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


def _urgency_score(*, haystack: str, explicitness: int, recency: int, has_meaningful_signal: bool) -> int:
    urgency_terms = min(45, sum(weight for term, weight in URGENCY_TERMS.items() if term in haystack))
    base = urgency_terms + explicitness + (recency if has_meaningful_signal else 0)
    return clamp_score(base)


def _contact_confidence_score(*, public_work_contact: str, contact_title: str, source_verified: bool) -> int:
    if public_work_contact:
        return 84 if source_verified else 66
    if contact_title:
        return 42 if source_verified else 28
    return 20 if source_verified else 8


def _matched_terms(haystack: str, terms: dict[str, int]) -> list[str]:
    return [term for term in terms if term in haystack][:12]


def _ai_confidence_score(
    *,
    confidence: int,
    evidence_quality: int,
    has_meaningful_signal: bool,
    negative_penalty: int,
    disqualifier_penalty: int,
    public_work_contact: str,
    company_momentum: int,
) -> int:
    value = confidence + (8 if public_work_contact else 0) + min(10, company_momentum // 8)
    if not has_meaningful_signal:
        value -= 24
    if evidence_quality < 30:
        value -= 12
    value -= min(30, negative_penalty + disqualifier_penalty)
    return clamp_score(value)


def _quality_gate(
    *,
    icp_fit: int,
    buying_intent: int,
    company_momentum: int,
    website_quality: int,
    ai_confidence: int,
    negative_penalty: int,
    disqualifier_penalty: int,
    has_meaningful_signal: bool,
) -> tuple[bool, str]:
    if disqualifier_penalty >= 20:
        return False, "Rejected: matched an explicit exclusion."
    if negative_penalty >= 28:
        return False, "Rejected: public evidence contains strong negative or contradictory signals."
    if not has_meaningful_signal:
        return False, "Rejected: no public buying, growth, hiring, expansion, or timing signal."
    if website_quality < 30:
        return False, "Rejected: public website evidence is too thin."
    if ai_confidence < 45:
        return False, "Rejected: AI confidence is too low for outreach."
    if icp_fit < 34 and buying_intent < 70:
        return False, "Rejected: buying signal exists, but ICP match is too weak."
    if buying_intent < 45 and company_momentum < 35:
        return False, "Rejected: no strong buying intent or company momentum."
    return True, ""


def _insufficient_data(
    *,
    has_meaningful_signal: bool,
    hiring_signal: int,
    funding_signal: int,
    expansion_signal: int,
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
    if hiring_signal <= 0:
        missing.append("hiring_signal")
    if funding_signal <= 0:
        missing.append("funding_signal")
    if expansion_signal <= 0:
        missing.append("expansion_signal")
    if technology_fit <= 20:
        missing.append("technology_change")
    if not public_work_contact:
        missing.append("public_work_contact")
    return missing


def _reason_or_insufficient(items: list[str], label: str) -> str:
    if not items:
        return "Недостаточно данных."
    return f"{label}: {', '.join(items[:5])}."


def _lead_reasoning(
    *,
    criteria: CustomerFinderCriteria,
    icp_fit: int,
    buying_intent: int,
    company_momentum: int,
    urgency: int,
    technology_fit: int,
    contact_confidence: int,
    outreach_readiness: int,
    ai_confidence: int,
    source_verified: bool,
    public_work_contact: str,
    evidence: dict[str, list[str]],
    insufficient_data: list[str],
    negative_penalty: int,
    rejection_reason: str,
    passes_quality_gate: bool,
) -> LeadReasoning:
    buying_terms = evidence.get("buying_intent_terms", [])
    growth_terms = [*evidence.get("hiring_terms", []), *evidence.get("funding_terms", []), *evidence.get("expansion_terms", [])]
    technology_terms = evidence.get("technology_terms", [])
    urgency_terms = evidence.get("urgency_terms", [])
    risk_terms = evidence.get("risk_terms", [])
    positive_signals = _dedupe_terms([*buying_terms, *growth_terms, *technology_terms, *urgency_terms])
    selected = (
        f"ICP match is {icp_fit}/100 for {criteria.target_industry} in {criteria.target_country}; "
        f"buying intent is {buying_intent}/100 and momentum is {company_momentum}/100."
        if icp_fit >= 34 and (buying_intent >= 45 or company_momentum >= 35)
        else "Недостаточно данных."
    )
    why_now = (
        f"Urgency is {urgency}/100 based on current public timing or operational-change terms."
        if urgency >= 30
        else "Недостаточно данных."
    )
    facts = _facts(
        criteria=criteria,
        icp_fit=icp_fit,
        source_verified=source_verified,
        public_work_contact=public_work_contact,
        positive_signals=positive_signals,
    )
    missing = insufficient_data or ["Недостаточно данных."]
    negative_signals = risk_terms or ["Недостаточно данных."]
    recommended_action = _recommended_action(
        passes_quality_gate=passes_quality_gate,
        outreach_readiness=outreach_readiness,
        ai_confidence=ai_confidence,
        public_work_contact=public_work_contact,
        rejection_reason=rejection_reason,
    )
    reason_summary = _reason_summary(
        passes_quality_gate=passes_quality_gate,
        selected=selected,
        why_now=why_now,
        rejection_reason=rejection_reason,
    )
    probabilistic = _probabilistic_conclusions(
        buying_intent=buying_intent,
        company_momentum=company_momentum,
        urgency=urgency,
        technology_fit=technology_fit,
        outreach_readiness=outreach_readiness,
        ai_confidence=ai_confidence,
    )
    return {
        "schema": "LeadReasoning",
        "Facts": facts,
        "Evidence": {
            "Buying Intent": buying_terms or ["Недостаточно данных."],
            "Growth": _dedupe_terms(growth_terms) or ["Недостаточно данных."],
            "Hiring": evidence.get("hiring_terms", []) or ["Недостаточно данных."],
            "Funding": evidence.get("funding_terms", []) or ["Недостаточно данных."],
            "Expansion": evidence.get("expansion_terms", []) or ["Недостаточно данных."],
            "Technology Fit": technology_terms or ["Недостаточно данных."],
            "Urgency": urgency_terms or ["Недостаточно данных."],
            "Risk": risk_terms or ["Недостаточно данных."],
        },
        "Missing Evidence": missing,
        "Positive Signals": positive_signals or ["Недостаточно данных."],
        "Negative Signals": negative_signals,
        "Confidence": {
            "score": ai_confidence,
            "label": _confidence_label(ai_confidence),
            "reason": _confidence_reason(ai_confidence=ai_confidence, source_verified=source_verified, public_work_contact=public_work_contact, insufficient_data=insufficient_data),
        },
        "Recommended Action": recommended_action,
        "Reason Summary": reason_summary,
        "Fact Conclusions": facts,
        "Probabilistic Conclusions": probabilistic or ["Недостаточно данных."],
        "Outreach Timing": why_now,
        "why_selected": selected,
        "why_now": why_now,
        "buying_signals": _reason_or_insufficient(buying_terms, "Public buying evidence"),
        "growth_signals": _reason_or_insufficient(_dedupe_terms(growth_terms), "Public growth evidence"),
        "risk_signals": _reason_or_insufficient(risk_terms, "Public risk evidence") if negative_penalty > 0 else "Недостаточно данных.",
        "evidence_limitations": insufficient_data or ["none"],
        "quality_gate": rejection_reason or "Passed.",
    }


def _facts(
    *,
    criteria: CustomerFinderCriteria,
    icp_fit: int,
    source_verified: bool,
    public_work_contact: str,
    positive_signals: list[str],
) -> list[str]:
    facts: list[str] = []
    if source_verified:
        facts.append("Public source was retrieved and verified.")
    if criteria.target_industry and icp_fit >= 30:
        facts.append(f"Public text matched target industry context: {criteria.target_industry}.")
    if criteria.target_country and criteria.target_country.lower() != "any" and icp_fit >= 30:
        facts.append(f"Public text matched target country context: {criteria.target_country}.")
    if public_work_contact:
        facts.append("A public business contact route was found.")
    if positive_signals:
        facts.append("Public text contained explicit signal terms.")
    return facts or ["Недостаточно данных."]


def _recommended_action(
    *,
    passes_quality_gate: bool,
    outreach_readiness: int,
    ai_confidence: int,
    public_work_contact: str,
    rejection_reason: str,
) -> str:
    if not passes_quality_gate:
        return rejection_reason or "Keep in CRM as requires review."
    if not public_work_contact:
        return "Save for review, but do not send outreach until a verified public business contact is found."
    if outreach_readiness >= 65 and ai_confidence >= 60:
        return "Prepare a personalized draft for manual review."
    return "Save to CRM and review evidence before outreach."


def _reason_summary(*, passes_quality_gate: bool, selected: str, why_now: str, rejection_reason: str) -> str:
    if not passes_quality_gate:
        return rejection_reason or "Недостаточно данных."
    if selected == "Недостаточно данных." and why_now == "Недостаточно данных.":
        return "Недостаточно данных."
    if why_now == "Недостаточно данных.":
        return selected
    return f"{selected} {why_now}"


def _probabilistic_conclusions(
    *,
    buying_intent: int,
    company_momentum: int,
    urgency: int,
    technology_fit: int,
    outreach_readiness: int,
    ai_confidence: int,
) -> list[str]:
    conclusions: list[str] = []
    if buying_intent >= 60:
        conclusions.append(f"Buying intent is likely meaningful ({buying_intent}/100).")
    if company_momentum >= 35:
        conclusions.append(f"Company momentum may improve timing ({company_momentum}/100).")
    if urgency >= 30:
        conclusions.append(f"Current timing may be favorable ({urgency}/100).")
    if technology_fit >= 40:
        conclusions.append(f"Technology context appears relevant ({technology_fit}/100).")
    if outreach_readiness >= 60 and ai_confidence >= 55:
        conclusions.append(f"Manual-review outreach is likely appropriate ({outreach_readiness}/100 readiness).")
    return conclusions


def _confidence_label(score: int) -> str:
    if score >= 75:
        return "high"
    if score >= 55:
        return "medium"
    if score > 0:
        return "low"
    return "unknown"


def _confidence_reason(*, ai_confidence: int, source_verified: bool, public_work_contact: str, insufficient_data: list[str]) -> str:
    if ai_confidence <= 0:
        return "Недостаточно данных."
    reasons: list[str] = []
    if source_verified:
        reasons.append("verified public source")
    if public_work_contact:
        reasons.append("public business contact")
    if insufficient_data:
        reasons.append(f"missing evidence: {', '.join(insufficient_data[:4])}")
    return ", ".join(reasons) if reasons else "Недостаточно данных."


def _dedupe_terms(terms: list[str]) -> list[str]:
    seen: set[str] = set()
    output: list[str] = []
    for term in terms:
        if term in seen:
            continue
        seen.add(term)
        output.append(term)
    return output


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
