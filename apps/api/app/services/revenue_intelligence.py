from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Literal, Optional
from uuid import UUID

from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.entities import AuditLog, Company, Notification, NotificationKind, Workspace

SignalCategory = Literal[
    "Hiring",
    "Funding",
    "Expansion",
    "Leadership",
    "Technology",
    "Compliance",
    "Product Launch",
    "Competitor Change",
    "Partnership",
    "Procurement",
    "Digital Transformation",
    "General Intent",
]

Recommendation = Literal["Contact now", "Wait", "Monitor", "Research more", "Low priority"]


class ScoreBreakdownOut(BaseModel):
    score: int
    factors: dict[str, int] = Field(default_factory=dict)
    weights: dict[str, int] = Field(default_factory=dict)
    explanation: str = ""


class SignalTimelineItemOut(BaseModel):
    timestamp: str
    signal_type: str
    category: SignalCategory
    source_url: str = ""
    evidence: str = ""
    previous_score: Optional[int] = None
    current_score: int
    score_delta: int
    confidence: int


class IntentHistoryOut(BaseModel):
    current_score: int
    previous_score: Optional[int] = None
    delta: int
    trend: Literal["up", "down", "flat"]
    last_updated: str
    points: list[dict[str, Any]] = Field(default_factory=list)


class VerificationOut(BaseModel):
    verification_count: int
    source_diversity: int
    verification_level: Literal["none", "single_source", "multi_source", "strong"]


class NextBestActionOut(BaseModel):
    action: Recommendation
    reason: str
    confidence: int
    supporting_signals: list[str] = Field(default_factory=list)
    blockers: list[str] = Field(default_factory=list)
    recommended_timing: str = ""


class SalesBriefOut(BaseModel):
    why_now: str
    business_changes: list[str] = Field(default_factory=list)
    buying_signals: list[str] = Field(default_factory=list)
    icp_explanation: str
    risks: list[str] = Field(default_factory=list)
    suggested_positioning: str
    suggested_cta: str


class RevenueCompanyOut(BaseModel):
    company_id: str
    company: str
    industry: str = ""
    country: str = ""
    website: str = ""
    icp_fit: ScoreBreakdownOut
    buying_intent: ScoreBreakdownOut
    revenue_opportunity: ScoreBreakdownOut
    confidence: int
    signal_summary: str
    last_change: str
    recommended_action: NextBestActionOut
    signal_timeline: list[SignalTimelineItemOut] = Field(default_factory=list)
    intent_history: IntentHistoryOut
    sales_brief: SalesBriefOut
    verification: VerificationOut
    similar_companies_count: int = 0
    watchlisted: bool = False
    feed_categories: list[str] = Field(default_factory=list)


class OpportunityFeedOut(BaseModel):
    generated_at: str
    categories: dict[str, list[RevenueCompanyOut]]
    top_opportunities: list[RevenueCompanyOut]
    highest_intent_increase: list[RevenueCompanyOut]
    recently_changed: list[RevenueCompanyOut]
    watchlist_updates: list[RevenueCompanyOut]
    recommended_today: list[RevenueCompanyOut]
    intent_trend: list[dict[str, Any]]
    pipeline_health: dict[str, Any]


SIGNAL_CATEGORY_MAP: dict[str, SignalCategory] = {
    "new_hiring": "Hiring",
    "hiring_related_workflow": "Hiring",
    "new_funding": "Funding",
    "funding_or_growth": "Funding",
    "market_expansion": "Expansion",
    "company_expansion_or_launch": "Expansion",
    "leadership_changes": "Leadership",
    "technology_changes": "Technology",
    "public_technology_adoption": "Technology",
    "compliance": "Compliance",
    "new_products": "Product Launch",
    "product_launch": "Product Launch",
    "new_competitors": "Competitor Change",
    "partnerships": "Partnership",
    "procurement": "Procurement",
    "digital_transformation": "Digital Transformation",
}


def build_revenue_intelligence_feed(db: Session, *, workspace: Workspace, user_id: str) -> OpportunityFeedOut:
    companies = list(
        db.scalars(
            select(Company)
            .where(Company.workspace_id == workspace.id)
            .order_by(Company.updated_at.desc())
            .limit(250)
        ).all()
    )
    items = [build_revenue_company(company, companies=companies) for company in companies]
    items.sort(key=lambda item: (item.revenue_opportunity.score, item.buying_intent.score, item.confidence), reverse=True)
    categories = {
        "Hot Today": [item for item in items if "Hot Today" in item.feed_categories][:12],
        "Intent Increased": [item for item in items if "Intent Increased" in item.feed_categories][:12],
        "New Buying Signals": [item for item in items if "New Buying Signals" in item.feed_categories][:12],
        "Intent Dropped": [item for item in items if "Intent Dropped" in item.feed_categories][:12],
        "Recommended Now": [item for item in items if "Recommended Now" in item.feed_categories][:12],
    }
    trend_points = [
        {
            "company_id": item.company_id,
            "company": item.company,
            "current_score": item.intent_history.current_score,
            "previous_score": item.intent_history.previous_score,
            "delta": item.intent_history.delta,
            "trend": item.intent_history.trend,
            "last_updated": item.intent_history.last_updated,
        }
        for item in items[:20]
    ]
    pipeline_health = {
        "companies": len(items),
        "hot": len(categories["Hot Today"]),
        "recommended_now": len(categories["Recommended Now"]),
        "watchlisted": len([item for item in items if item.watchlisted]),
        "average_intent": round(sum(item.buying_intent.score for item in items) / max(1, len(items))),
        "average_confidence": round(sum(item.confidence for item in items) / max(1, len(items))),
    }
    return OpportunityFeedOut(
        generated_at=datetime.utcnow().isoformat(),
        categories=categories,
        top_opportunities=items[:8],
        highest_intent_increase=sorted(items, key=lambda item: item.intent_history.delta, reverse=True)[:8],
        recently_changed=sorted(items, key=lambda item: item.last_change or "", reverse=True)[:8],
        watchlist_updates=[item for item in items if item.watchlisted and item.intent_history.delta != 0][:8],
        recommended_today=[item for item in items if item.recommended_action.action == "Contact now"][:8],
        intent_trend=trend_points,
        pipeline_health=pipeline_health,
    )


def build_and_store_revenue_intelligence(db: Session, *, company: Company, companies: Optional[list[Company]] = None) -> dict[str, Any]:
    all_companies = companies or [company]
    item = build_revenue_company(company, companies=all_companies)
    metadata = company.metadata_json if isinstance(company.metadata_json, dict) else {}
    company.metadata_json = {
        **metadata,
        "ai_revenue_intelligence": item.model_dump(),
    }
    company.updated_at = datetime.utcnow()
    return item.model_dump()


def set_company_watchlist(db: Session, *, workspace_id: UUID, user_id: str, company_id: UUID, watchlisted: bool) -> RevenueCompanyOut:
    company = db.scalar(select(Company).where(Company.id == company_id, Company.workspace_id == workspace_id))
    if company is None:
        raise ValueError("Company not found")
    metadata = company.metadata_json if isinstance(company.metadata_json, dict) else {}
    company.metadata_json = {
        **metadata,
        "ai_watchlist": {
            "enabled": bool(watchlisted),
            "updated_at": datetime.utcnow().isoformat(),
            "updated_by": user_id,
            "monitoring": ["hiring", "funding", "news", "website", "signals"],
        },
    }
    company.updated_at = datetime.utcnow()
    db.add(
        AuditLog(
            user_id=user_id,
            workspace_id=workspace_id,
            action="revenue_intelligence.watchlist_updated",
            metadata_json={"company_id": str(company.id), "watchlisted": bool(watchlisted)},
        )
    )
    item = build_revenue_company(company, companies=[company])
    company.metadata_json = {
        **(company.metadata_json if isinstance(company.metadata_json, dict) else {}),
        "ai_revenue_intelligence": item.model_dump(),
    }
    db.commit()
    db.refresh(company)
    return build_revenue_company(company, companies=[company])


def create_revenue_notification_if_needed(db: Session, *, company: Company, user_id: str, workspace_id: UUID, intelligence: dict[str, Any]) -> None:
    current = _safe_score(((intelligence.get("buying_intent") or {}) if isinstance(intelligence.get("buying_intent"), dict) else {}).get("score"), 0)
    history = intelligence.get("intent_history") if isinstance(intelligence.get("intent_history"), dict) else {}
    delta = _safe_int(history.get("delta"), 0)
    action = (intelligence.get("recommended_action") or {}) if isinstance(intelligence.get("recommended_action"), dict) else {}
    should_notify = current >= 80 and delta >= 8 and action.get("action") == "Contact now"
    if not should_notify:
        return
    title = f"{company.name} is recommended now"
    since = datetime.utcnow() - timedelta(hours=24)
    recent = db.scalar(
        select(Notification.id)
        .where(
            Notification.workspace_id == workspace_id,
            Notification.user_id == user_id,
            Notification.title == title,
            Notification.created_at >= since,
        )
        .limit(1)
    )
    if recent is not None:
        return
    db.add(
        Notification(
            user_id=user_id,
            workspace_id=workspace_id,
            kind=NotificationKind.success,
            title=title,
            message=f"Buying intent increased by {delta} points. Review the verified signal before outreach.",
        )
    )


def build_revenue_company(company: Company, *, companies: list[Company]) -> RevenueCompanyOut:
    metadata = company.metadata_json if isinstance(company.metadata_json, dict) else {}
    live = metadata.get("ai_live_buying_signals") if isinstance(metadata.get("ai_live_buying_signals"), dict) else {}
    timeline = _timeline_items(live, metadata)
    current_score = _safe_score(live.get("current_score"), _safe_score(metadata.get("buying_signal_score"), _safe_score(metadata.get("priority_score"), 0)))
    previous_score = _score_or_none(live.get("previous_score"))
    delta = _safe_int(live.get("score_delta"), current_score - previous_score if previous_score is not None else 0)
    last_updated = str(live.get("generated_at") or company.updated_at.isoformat())
    trend = "up" if delta > 0 else "down" if delta < 0 else "flat"
    intent_history = IntentHistoryOut(
        current_score=current_score,
        previous_score=previous_score,
        delta=delta,
        trend=trend,
        last_updated=last_updated,
        points=_history_points(timeline, current_score=current_score, last_updated=last_updated),
    )
    verification = _verification(metadata, timeline)
    icp = _icp_score(company, metadata)
    intent = _intent_score(current_score=current_score, timeline=timeline, verification=verification, metadata=metadata)
    revenue = _revenue_score(company, metadata, intent=intent.score, icp=icp.score, confidence=_safe_score(metadata.get("confidence_score"), _safe_score(metadata.get("confidence"), 50)))
    confidence = _safe_score(round((_safe_score(metadata.get("confidence_score"), _safe_score(metadata.get("confidence"), 50)) + verification.verification_count * 10 + verification.source_diversity * 5) / 1.4), 50)
    next_action = _next_best_action(intent_score=intent.score, revenue_score=revenue.score, confidence=confidence, delta=delta, has_recent_signal=bool(timeline))
    watchlist = metadata.get("ai_watchlist") if isinstance(metadata.get("ai_watchlist"), dict) else {}
    similar_count = _similar_companies_count(company, companies)
    signal_summary = _signal_summary(timeline, metadata)
    last_change = timeline[-1].timestamp if timeline else last_updated
    brief = _sales_brief(company, metadata, timeline, next_action, icp, intent, revenue)
    feed_categories = _feed_categories(intent_score=intent.score, delta=delta, timeline=timeline, recommendation=next_action.action, watchlisted=bool(watchlist.get("enabled")))
    return RevenueCompanyOut(
        company_id=str(company.id),
        company=company.name,
        industry=company.industry or "",
        country=company.country or "",
        website=company.website or "",
        icp_fit=icp,
        buying_intent=intent,
        revenue_opportunity=revenue,
        confidence=confidence,
        signal_summary=signal_summary,
        last_change=last_change,
        recommended_action=next_action,
        signal_timeline=timeline,
        intent_history=intent_history,
        sales_brief=brief,
        verification=verification,
        similar_companies_count=similar_count,
        watchlisted=bool(watchlist.get("enabled")),
        feed_categories=feed_categories,
    )


def _timeline_items(live: dict[str, Any], metadata: dict[str, Any]) -> list[SignalTimelineItemOut]:
    raw_timeline = live.get("change_timeline") if isinstance(live.get("change_timeline"), list) else []
    items: list[SignalTimelineItemOut] = []
    for raw in raw_timeline:
        if not isinstance(raw, dict):
            continue
        change_type = str(raw.get("change_type") or raw.get("signal_type") or "intent_signal")
        added = raw.get("added") if isinstance(raw.get("added"), list) else []
        evidence = str(raw.get("signal") or raw.get("evidence") or ", ".join(str(item) for item in added if str(item or "").strip()) or "")
        current = _safe_score(raw.get("current_score"), _safe_score(live.get("current_score"), _safe_score(metadata.get("buying_signal_score"), 0)))
        previous = _score_or_none(raw.get("previous_score"))
        items.append(
            SignalTimelineItemOut(
                timestamp=str(raw.get("detected_at") or raw.get("timestamp") or live.get("generated_at") or datetime.utcnow().isoformat()),
                signal_type=change_type,
                category=SIGNAL_CATEGORY_MAP.get(change_type, "General Intent"),
                source_url=str(raw.get("source_url") or ""),
                evidence=evidence or _signal_summary_from_metadata(metadata),
                previous_score=previous,
                current_score=current,
                score_delta=_safe_int(raw.get("score_delta"), current - previous if previous is not None else 0),
                confidence=_safe_score(raw.get("confidence"), _safe_score(metadata.get("buying_signal_confidence"), 50)),
            )
        )
    return sorted(items, key=lambda item: item.timestamp)[-50:]


def _history_points(timeline: list[SignalTimelineItemOut], *, current_score: int, last_updated: str) -> list[dict[str, Any]]:
    points = [
        {
            "timestamp": item.timestamp,
            "score": item.current_score,
            "delta": item.score_delta,
            "signal_type": item.signal_type,
        }
        for item in timeline
    ]
    if not points:
        points.append({"timestamp": last_updated, "score": current_score, "delta": 0, "signal_type": "current"})
    return points[-20:]


def _verification(metadata: dict[str, Any], timeline: list[SignalTimelineItemOut]) -> VerificationOut:
    evidence = metadata.get("buying_signal_evidence") if isinstance(metadata.get("buying_signal_evidence"), list) else []
    urls = [str(item.source_url) for item in timeline if item.source_url]
    for item in evidence:
        if isinstance(item, dict) and item.get("source_url"):
            urls.append(str(item.get("source_url")))
    domains = {_domain(url) for url in urls if _domain(url)}
    count = len({url.strip().lower() for url in urls if url.strip()})
    diversity = len(domains)
    level: Literal["none", "single_source", "multi_source", "strong"] = "none"
    if count >= 3 and diversity >= 2:
        level = "strong"
    elif count >= 2 or diversity >= 2:
        level = "multi_source"
    elif count == 1:
        level = "single_source"
    return VerificationOut(verification_count=count, source_diversity=diversity, verification_level=level)


def _icp_score(company: Company, metadata: dict[str, Any]) -> ScoreBreakdownOut:
    factors = {
        "Industry": 20 if company.industry else 8,
        "Size": 15 if _has_size(metadata) else 6,
        "Country": 10 if company.country else 4,
        "Technology": min(18, len(_list(metadata.get("technologies"))) * 6),
        "Use Case": 24 if metadata.get("value_proposition") or metadata.get("opportunity_analysis") or metadata.get("ai_summary") else 10,
        "Disqualifiers": 0,
    }
    return ScoreBreakdownOut(
        score=_safe_score(sum(factors.values()), 0),
        factors=factors,
        weights={"Industry": 20, "Size": 15, "Country": 10, "Technology": 18, "Use Case": 24, "Disqualifiers": -20},
        explanation="ICP Fit combines industry, geography, size evidence, technology/workflow fit, use-case clarity, and disqualifiers.",
    )


def _intent_score(*, current_score: int, timeline: list[SignalTimelineItemOut], verification: VerificationOut, metadata: dict[str, Any]) -> ScoreBreakdownOut:
    categories = {item.category for item in timeline}
    factors = {
        "Pain": 25 if metadata.get("pain_points") or any(item.category in {"Procurement", "Digital Transformation"} for item in timeline) else 10,
        "Hiring": 20 if "Hiring" in categories else 0,
        "Funding": 15 if "Funding" in categories else 0,
        "Recency": 18 if timeline else 6,
        "Evidence": min(12, verification.verification_count * 5 + verification.source_diversity * 2),
    }
    blended = round(current_score * 0.45 + sum(factors.values()) * 0.55)
    return ScoreBreakdownOut(
        score=_safe_score(blended, current_score),
        factors=factors,
        weights={"Pain": 25, "Hiring": 20, "Funding": 15, "Recency": 18, "Evidence": 12},
        explanation="Buying Intent blends the latest deterministic intent score with pain strength, signal type, recency, and independent evidence quality.",
    )


def _revenue_score(company: Company, metadata: dict[str, Any], *, intent: int, icp: int, confidence: int) -> ScoreBreakdownOut:
    size_score = 20 if _has_size(metadata) else 10
    expansion_score = 18 if any(term in " ".join(_list(metadata.get("buying_signals"))).lower() for term in ["expand", "growth", "funding", "launch"]) else 8
    technology_score = min(18, len(_list(metadata.get("technologies"))) * 6)
    deal_complexity = 16 if company.email or metadata.get("recommended_decision_maker_role") else 8
    probability = round((intent + icp + confidence) / 6)
    factors = {
        "Company Size": size_score,
        "Expansion": expansion_score,
        "Technology": technology_score,
        "Decision Complexity": deal_complexity,
        "Purchase Probability": probability,
    }
    return ScoreBreakdownOut(
        score=_safe_score(sum(factors.values()), 0),
        factors=factors,
        weights={"Company Size": 20, "Expansion": 18, "Technology": 18, "Decision Complexity": 16, "Purchase Probability": 28},
        explanation="Revenue Opportunity Score estimates commercial upside from company scale, expansion context, workflow/technology fit, decision complexity, and purchase probability.",
    )


def _next_best_action(*, intent_score: int, revenue_score: int, confidence: int, delta: int, has_recent_signal: bool) -> NextBestActionOut:
    supporting = []
    if intent_score >= 75:
        supporting.append("Strong buying intent")
    if revenue_score >= 65:
        supporting.append("Strong revenue fit")
    if delta > 0:
        supporting.append(f"Intent increased by {delta}")
    if has_recent_signal:
        supporting.append("Recent verified signal")
    if confidence < 40:
        return NextBestActionOut(action="Research more", reason="Evidence confidence is too low for outreach. Collect another public source first.", confidence=confidence, supporting_signals=supporting, blockers=["Low evidence confidence"], recommended_timing="After another verified source is found")
    if intent_score >= 75 and revenue_score >= 65 and delta >= 0:
        return NextBestActionOut(action="Contact now", reason="Intent and revenue fit are both strong, with enough evidence to review outreach now.", confidence=confidence, supporting_signals=supporting, recommended_timing="Today")
    if delta <= -10:
        return NextBestActionOut(action="Wait", reason="Intent dropped recently. Avoid outreach until a stronger signal appears.", confidence=confidence, supporting_signals=supporting, blockers=["Intent dropped"], recommended_timing="Wait for a new verified signal")
    if has_recent_signal:
        return NextBestActionOut(action="Monitor", reason="A new signal appeared, but score or confidence is not strong enough yet.", confidence=confidence, supporting_signals=supporting, blockers=["Score below contact threshold"], recommended_timing="Review again after the next signal")
    if revenue_score < 45:
        return NextBestActionOut(action="Low priority", reason="Revenue fit is weaker than other opportunities in the workspace.", confidence=confidence, supporting_signals=supporting, blockers=["Low revenue fit"], recommended_timing="Do not prioritize this week")
    return NextBestActionOut(action="Monitor", reason="Keep watching for a stronger timing signal before outreach.", confidence=confidence, supporting_signals=supporting, blockers=["No recent high-intent signal"], recommended_timing="Monitor weekly")


def _sales_brief(company: Company, metadata: dict[str, Any], timeline: list[SignalTimelineItemOut], next_action: NextBestActionOut, icp: ScoreBreakdownOut, intent: ScoreBreakdownOut, revenue: ScoreBreakdownOut) -> SalesBriefOut:
    changes = [item.evidence for item in timeline[-5:] if item.evidence]
    signals = _list(metadata.get("buying_signals"))[:6]
    risks = _list(metadata.get("risks")) or _list(metadata.get("top_negative_signals"))
    return SalesBriefOut(
        why_now=next_action.reason,
        business_changes=changes,
        buying_signals=signals,
        icp_explanation=icp.explanation,
        risks=risks[:5],
        suggested_positioning=str(metadata.get("value_proposition") or metadata.get("sales_angle") or metadata.get("suggested_offer") or "Lead with the strongest verified business change."),
        suggested_cta=str(metadata.get("recommended_cta") or metadata.get("next_recommended_action") or metadata.get("recommended_next_action") or "Ask if this is worth a quick fit review."),
    )


def _feed_categories(*, intent_score: int, delta: int, timeline: list[SignalTimelineItemOut], recommendation: str, watchlisted: bool) -> list[str]:
    categories: list[str] = []
    if intent_score >= 80:
        categories.append("Hot Today")
    if delta > 0:
        categories.append("Intent Increased")
    if timeline:
        categories.append("New Buying Signals")
    if delta < 0:
        categories.append("Intent Dropped")
    if recommendation == "Contact now":
        categories.append("Recommended Now")
    if watchlisted and "New Buying Signals" not in categories:
        categories.append("New Buying Signals")
    return categories


def _similar_companies_count(company: Company, companies: list[Company]) -> int:
    industry = str(company.industry or "").lower()
    country = str(company.country or "").lower()
    metadata = company.metadata_json if isinstance(company.metadata_json, dict) else {}
    technologies = {item.lower() for item in _list(metadata.get("technologies"))}
    count = 0
    for other in companies:
        if other.id == company.id:
            continue
        other_metadata = other.metadata_json if isinstance(other.metadata_json, dict) else {}
        shared_tech = technologies & {item.lower() for item in _list(other_metadata.get("technologies"))}
        if (industry and industry == str(other.industry or "").lower()) or (country and country == str(other.country or "").lower()) or shared_tech:
            count += 1
    return count


def _signal_summary(timeline: list[SignalTimelineItemOut], metadata: dict[str, Any]) -> str:
    if timeline:
        latest = timeline[-1]
        return latest.evidence or latest.category
    return _signal_summary_from_metadata(metadata)


def _signal_summary_from_metadata(metadata: dict[str, Any]) -> str:
    signals = _list(metadata.get("buying_signals"))
    if signals:
        return signals[0]
    return str(metadata.get("buying_signal_explanation") or metadata.get("reasoning") or "No fresh verified signal yet.")


def _has_size(metadata: dict[str, Any]) -> bool:
    if metadata.get("estimated_company_size") or metadata.get("employee_count"):
        return True
    intelligence = metadata.get("company_intelligence") if isinstance(metadata.get("company_intelligence"), dict) else {}
    report = intelligence.get("report") if isinstance(intelligence.get("report"), dict) else {}
    size = report.get("estimated_company_size") if isinstance(report.get("estimated_company_size"), dict) else {}
    return bool(size.get("value"))


def _domain(url: str) -> str:
    value = str(url or "").strip().lower()
    value = value.replace("https://", "").replace("http://", "").split("/")[0]
    return value[4:] if value.startswith("www.") else value


def _list(value: Any) -> list[str]:
    return [str(item).strip() for item in value if str(item or "").strip()] if isinstance(value, list) else []


def _safe_score(value: Any, fallback: int = 0) -> int:
    return max(0, min(100, _safe_int(value, fallback)))


def _safe_int(value: Any, fallback: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return fallback


def _score_or_none(value: Any) -> Optional[int]:
    try:
        return max(0, min(100, int(value)))
    except (TypeError, ValueError):
        return None
