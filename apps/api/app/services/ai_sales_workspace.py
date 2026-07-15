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
    business_model: str
    what_company_sells: str
    target_customers: str
    company_stage: str
    pain_points: list[str] = Field(default_factory=list)
    likely_business_pains: list[str] = Field(default_factory=list)
    buying_signals: list[str] = Field(default_factory=list)
    relevant_technologies: list[str] = Field(default_factory=list)
    company_growth_indicators: list[str] = Field(default_factory=list)
    why_fits_icp: list[str] = Field(default_factory=list)
    why_may_not_fit: list[str] = Field(default_factory=list)
    icp_fit_score: int = Field(ge=0, le=100)
    ai_lead_score: int = Field(ge=0, le=100)
    lead_priority_score: int = Field(ge=0, le=100)
    lead_priority_tier: str = ""
    buying_probability: int = Field(ge=0, le=100)
    score_explanation: str
    estimated_reply_probability: int = Field(ge=0, le=100)
    estimated_company_size: str = ""
    estimated_revenue: str = ""
    recommended_decision_maker_role: str
    decision_makers: list[AISalesWorkspaceDecisionMaker] = Field(default_factory=list)
    best_outreach_angle: str
    value_proposition: str
    best_communication_channel: str
    personalization_variables: list[str] = Field(default_factory=list)
    predicted_objections: list[str] = Field(default_factory=list)
    personalized_opening_line: str
    strongest_sales_arguments: list[str] = Field(default_factory=list)
    suggested_cta: str
    recommended_next_action: str
    recommended_first_message: str
    personalized_follow_up_sequence: list[str] = Field(default_factory=list)
    best_timing_to_contact: str
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
    recommendation_actions: dict[str, Any] = Field(default_factory=dict)
    ai_copilot_panel: dict[str, Any] = Field(default_factory=dict)
    recommendation_audit_log: list[dict[str, Any]] = Field(default_factory=list)
    action_center: dict[str, Any] = Field(default_factory=dict)
    action_center_audit_log: list[dict[str, Any]] = Field(default_factory=list)
    sdr_workflow: dict[str, Any] = Field(default_factory=dict)
    sdr_workflow_audit_log: list[dict[str, Any]] = Field(default_factory=list)


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


def _decision_makers(contacts: list[Contact]) -> list[dict[str, str]]:
    decision_makers: list[dict[str, str]] = []
    seen: set[tuple[str, str, str]] = set()
    for contact in contacts:
        name = _clean_text(contact.name)
        title = _clean_text(contact.title)
        email = _clean_text(contact.email)
        if not any([name, title, email]):
            continue
        key = (name.lower(), title.lower(), email.lower())
        if key in seen:
            continue
        seen.add(key)
        decision_makers.append({"name": name, "title": title, "email": email})
        if len(decision_makers) >= 3:
            break
    return decision_makers


def _decision_makers_from_metadata(raw_profiles: Any) -> list[dict[str, str]]:
    if not isinstance(raw_profiles, list):
        return []
    decision_makers: list[dict[str, str]] = []
    seen: set[tuple[str, str, str]] = set()
    for item in raw_profiles:
        if not isinstance(item, dict):
            continue
        name = _clean_text(item.get("name"))
        title = _clean_text(item.get("title"))
        email = _clean_text(item.get("email"))
        key = (name.lower(), title.lower(), email.lower())
        if not any(key) or key in seen:
            continue
        seen.add(key)
        decision_makers.append({"name": name, "title": title, "email": email})
        if len(decision_makers) >= 3:
            break
    return decision_makers


def _merge_decision_makers(*groups: list[dict[str, str]]) -> list[dict[str, str]]:
    merged: list[dict[str, str]] = []
    seen: set[tuple[str, str, str]] = set()
    for group in groups:
        for item in group:
            name = _clean_text(item.get("name"))
            title = _clean_text(item.get("title"))
            email = _clean_text(item.get("email"))
            key = (name.lower(), title.lower(), email.lower())
            if not any(key) or key in seen:
                continue
            seen.add(key)
            merged.append({"name": name, "title": title, "email": email})
            if len(merged) >= 3:
                return merged
    return merged


def _human_size(lead: Optional[Lead], company_metadata: dict[str, Any]) -> str:
    employee_count = getattr(lead, "employee_count", None)
    if isinstance(employee_count, (int, float)) and employee_count > 0:
        return f"{int(employee_count)} employees"
    return _clean_text(company_metadata.get("company_size") or company_metadata.get("employee_count"))


def _human_revenue(lead: Optional[Lead], company_predictions: dict[str, Any]) -> str:
    revenue_range = _clean_text(getattr(lead, "revenue_range", None))
    if revenue_range:
        return revenue_range
    estimated_arr = company_predictions.get("estimated_arr") if isinstance(company_predictions.get("estimated_arr"), dict) else {}
    return _clean_text(estimated_arr.get("reasoning"))


def _extra_evidence(raw_items: Any) -> list[dict[str, Any]]:
    if not isinstance(raw_items, list):
        return []
    evidence: list[dict[str, Any]] = []
    for item in raw_items:
        if not isinstance(item, dict):
            continue
        field = _clean_text(item.get("source_field"))
        value = _clean_text(item.get("value"))
        if not field or not value:
            continue
        evidence.append(
            {
                "source_field": field,
                "value": value,
                "confidence": max(1, min(100, _safe_int(item.get("confidence"), 70))),
            }
        )
    return evidence


def _best_communication_channel(top_contact: Optional[Contact], company: Company) -> str:
    if top_contact and _clean_text(top_contact.email):
        return "Email"
    if top_contact and _clean_text(top_contact.linkedin):
        return "LinkedIn"
    if top_contact and _clean_text(top_contact.phone):
        return "Phone"
    if _clean_text(company.phone):
        return "Phone"
    if _clean_text(company.website) or _clean_text(company.domain):
        return "Website form"
    return "Manual research"


def _company_stage(*, lead: Optional[Lead], buying_signals: list[str], missing_data: list[str]) -> str:
    if lead and lead.status in {"Meeting", "Won"}:
        return "Late-stage evaluation"
    if lead and lead.status in {"Replied", "Opened", "Sent", "Contacted", "Interested", "Email Generated"}:
        return "Active outreach"
    if buying_signals:
        return "Active evaluation"
    if "decision_maker" in missing_data or "decision_maker_email" in missing_data:
        return "Researching stakeholders"
    return "Early research"


def _business_model(company: Company, target_customers: str) -> str:
    industry = _clean_text(company.industry)
    if industry and target_customers:
        return f"{industry} provider serving {target_customers}."
    if industry:
        return f"{industry} business with a likely B2B sales motion."
    return "Business model is only partially visible from current public data."


def _personalization_variables(
    *,
    company: Company,
    top_contact: Optional[Contact],
    target_customers: str,
    technologies: list[str],
    buying_signals: list[str],
) -> list[str]:
    return _compact_list(
        [
            company.city and company.country and f"{company.city}, {company.country} market context",
            company.industry and f"Industry focus: {company.industry}",
            target_customers and f"Target customer fit: {target_customers}",
            top_contact and top_contact.title and f"Decision-maker role: {top_contact.title}",
            technologies[0] and f"Technology signal: {technologies[0]}" if technologies else "",
            buying_signals[0] and f"Buying signal: {buying_signals[0]}" if buying_signals else "",
        ],
        max_items=6,
    )


def _predicted_objections(*, missing_data: list[str], risk_to_check: str, buying_signals: list[str]) -> list[str]:
    return _compact_list(
        [
            risk_to_check,
            "Priority may be unclear without a confirmed active initiative" if not buying_signals else "",
            "Decision-maker ownership may still need verification" if "decision_maker" in missing_data else "",
            "Recipient relevance may be challenged until the email is tied to one concrete pain point" if "decision_maker_email" in missing_data else "",
        ],
        max_items=4,
    )


def _best_timing_to_contact(*, company_stage: str, best_communication_channel: str, top_contact: Optional[Contact]) -> str:
    contact_tz = ""
    if top_contact and isinstance(top_contact.metadata_json, dict):
        contact_tz = _clean_text(top_contact.metadata_json.get("timezone"))
    if contact_tz:
        return f"Weekdays between 09:00-11:00 in {contact_tz}."
    if best_communication_channel == "Email":
        if company_stage == "Active outreach":
            return "Tuesday to Thursday between 08:30-10:30 local time."
        return "Tuesday to Thursday between 09:00-11:00 local time."
    if best_communication_channel == "LinkedIn":
        return "Weekday mornings and late afternoons in the company local timezone."
    if best_communication_channel == "Phone":
        return "Weekday mornings after 09:30 local time to improve answer rates."
    return "Contact during weekday business hours in the company local timezone."


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


def _build_recommendation_actions(*, payload: dict[str, Any]) -> dict[str, Any]:
    confidence = max(1, min(100, _safe_int(payload.get("confidence_score"), 70)))

    def _entry(label: str, value: Any, reasoning: str, evidence: list[dict[str, Any]]) -> dict[str, Any]:
        return {
            "label": label,
            "value": value,
            "approved": False,
            "edited": False,
            "regenerated": False,
            "confidence": confidence,
            "reasoning": _clean_text(reasoning),
            "evidence": evidence[:3],
            "updated_at": datetime.utcnow().isoformat(),
        }

    top_evidence = payload.get("evidence") if isinstance(payload.get("evidence"), list) else []
    first_reason = _clean_text((payload.get("reasoning") or [""])[0] if isinstance(payload.get("reasoning"), list) else "")

    return {
        "decision_maker": _entry(
            "Best decision maker",
            {
                "name": _clean_text(payload.get("decision_maker", {}).get("name") if isinstance(payload.get("decision_maker"), dict) else ""),
                "title": _clean_text(payload.get("decision_maker", {}).get("title") if isinstance(payload.get("decision_maker"), dict) else ""),
                "email": _clean_text(payload.get("decision_maker", {}).get("email") if isinstance(payload.get("decision_maker"), dict) else ""),
                "recommended_role": _clean_text(payload.get("recommended_decision_maker_role")),
            },
            payload.get("score_explanation") or first_reason,
            top_evidence,
        ),
        "first_message": _entry(
            "Personalized first message",
            _clean_text(payload.get("recommended_first_message") or payload.get("personalized_opening_line")),
            payload.get("best_outreach_angle") or first_reason,
            top_evidence,
        ),
        "follow_up_sequence": _entry(
            "Follow-up sequence",
            payload.get("personalized_follow_up_sequence") if isinstance(payload.get("personalized_follow_up_sequence"), list) else [],
            payload.get("recommended_next_action") or first_reason,
            top_evidence,
        ),
        "best_channel": _entry(
            "Best outreach channel",
            _clean_text(payload.get("best_communication_channel")),
            payload.get("best_timing_to_contact") or first_reason,
            top_evidence,
        ),
        "reply_probability": _entry(
            "Reply probability",
            max(0, min(100, _safe_int(payload.get("estimated_reply_probability"), 0))),
            payload.get("score_explanation") or first_reason,
            top_evidence,
        ),
        "deal_success_probability": _entry(
            "Deal success probability",
            max(0, min(100, _safe_int(payload.get("buying_probability"), 0))),
            payload.get("score_explanation") or first_reason,
            top_evidence,
        ),
        "priority_score": _entry(
            "Priority score",
            max(0, min(100, _safe_int(payload.get("lead_priority_score"), 0))),
            payload.get("score_explanation") or first_reason,
            top_evidence,
        ),
        "next_best_action": _entry(
            "Next best action",
            _clean_text(payload.get("recommended_next_action") or payload.get("next_action")),
            payload.get("score_explanation") or first_reason,
            top_evidence,
        ),
    }


def _build_ai_copilot_panel(*, payload: dict[str, Any], recommendation_actions: dict[str, Any]) -> dict[str, Any]:
    evidence = payload.get("evidence") if isinstance(payload.get("evidence"), list) else []
    reasoning = payload.get("reasoning") if isinstance(payload.get("reasoning"), list) else []
    recommendations: list[dict[str, Any]] = []
    for key, item in recommendation_actions.items():
        if not isinstance(item, dict):
            continue
        recommendations.append(
            {
                "key": key,
                "label": _clean_text(item.get("label")) or key.replace("_", " ").title(),
                "confidence": max(1, min(100, _safe_int(item.get("confidence"), _safe_int(payload.get("confidence_score"), 70)))),
                "reasoning": _clean_text(item.get("reasoning")) or _clean_text((reasoning[0] if reasoning else payload.get("score_explanation"))),
                "value": item.get("value"),
                "evidence": item.get("evidence") if isinstance(item.get("evidence"), list) else [],
            }
        )

    return {
        "generated_at": datetime.utcnow().isoformat(),
        "summary": _clean_text(payload.get("summary") or payload.get("company_summary")),
        "confidence": max(1, min(100, _safe_int(payload.get("confidence_score"), 70))),
        "reasoning": [_clean_text(item) for item in reasoning if _clean_text(item)][:6],
        "recommendations": recommendations,
        "evidence": [item for item in evidence if isinstance(item, dict)][:12],
        "policy": "Every recommendation is evidence-backed, confidence-scored, editable, and auditable.",
    }


def _default_action_center_tasks(*, payload: dict[str, Any]) -> list[dict[str, Any]]:
    priority_score = max(0, min(100, _safe_int(payload.get("lead_priority_score"), _safe_int(payload.get("opportunity_score"), 0))))
    confidence = max(1, min(100, _safe_int(payload.get("confidence_score"), 70)))
    buying_probability = max(0, min(100, _safe_int(payload.get("buying_probability"), _safe_int(payload.get("buying_intent_score"), 0))))
    reply_probability = max(0, min(100, _safe_int(payload.get("estimated_reply_probability"), 0)))
    next_action = _clean_text(payload.get("recommended_next_action") or payload.get("next_action"))
    best_channel = _clean_text(payload.get("best_communication_channel")) or "Email"
    decision_maker = payload.get("decision_maker") if isinstance(payload.get("decision_maker"), dict) else {}
    decision_maker_name = _clean_text(decision_maker.get("name")) or _clean_text(payload.get("recommended_decision_maker_role")) or "Decision maker"
    reasoning = _clean_text((payload.get("reasoning") or [""])[0] if isinstance(payload.get("reasoning"), list) else payload.get("score_explanation"))

    def task(
        task_id: str,
        title: str,
        action_type: str,
        *,
        priority: int,
        estimated_impact: str,
        expected_outcome: str,
        task_reasoning: str,
    ) -> dict[str, Any]:
        return {
            "task_id": task_id,
            "title": title,
            "action_type": action_type,
            "priority": max(0, min(100, priority)),
            "estimated_impact": estimated_impact,
            "confidence_score": confidence,
            "reasoning": _clean_text(task_reasoning),
            "expected_outcome": _clean_text(expected_outcome),
            "status": "pending",
            "status_reason": "",
            "status_history": [],
            "updated_at": datetime.utcnow().isoformat(),
            "rank": 0,
        }

    tasks = [
        task(
            "send_first_email",
            "Send first personalized email",
            "send_first_email",
            priority=priority_score,
            estimated_impact="High",
            expected_outcome="Start a direct sales conversation with the best-fit buyer.",
            task_reasoning=next_action or reasoning or "First outreach is ready and prioritized.",
        ),
        task(
            "connect_linkedin",
            f"Connect with {decision_maker_name} on LinkedIn",
            "connect_linkedin",
            priority=max(10, priority_score - 8),
            estimated_impact="Medium",
            expected_outcome="Create a second touchpoint to increase reply likelihood.",
            task_reasoning="Multi-channel outreach improves response rates when email alone is uncertain.",
        ),
        task(
            "call_decision_maker",
            f"Call {decision_maker_name}",
            action_type="call_decision_maker",
            priority=max(10, min(100, buying_probability + 8)),
            estimated_impact="High",
            expected_outcome="Qualify urgency and move the lead into active pipeline discussion.",
            task_reasoning="Call is recommended when intent is strong and speed matters.",
        ),
        task(
            "wait_three_days",
            "Wait 3 days before the next touch",
            action_type="wait_3_days",
            priority=max(5, min(100, reply_probability - 12)),
            estimated_impact="Medium",
            expected_outcome="Avoid over-messaging and time follow-up for better engagement.",
            task_reasoning="Spacing touches can improve response quality for outbound sequences.",
        ),
        task(
            "send_follow_up",
            "Send follow-up sequence",
            action_type="send_follow_up",
            priority=max(10, min(100, reply_probability + 6)),
            estimated_impact="High",
            expected_outcome="Recover silent opportunities and prompt a clear yes/no response.",
            task_reasoning="Follow-up sequence is available and tailored for this company.",
        ),
        task(
            "research_funding_news",
            "Research funding and company news",
            action_type="research_funding_news",
            priority=max(5, min(100, priority_score - 20)),
            estimated_impact="Medium",
            expected_outcome="Improve personalization and confidence with fresher buying context.",
            task_reasoning="Additional context can sharpen pitch timing and messaging relevance.",
        ),
        task(
            "skip_lead",
            "Skip this lead for now",
            action_type="skip_lead",
            priority=70 if buying_probability < 35 else 12,
            estimated_impact="Low",
            expected_outcome="Preserve sales capacity for better-fit opportunities.",
            task_reasoning="Skip is recommended only when confidence or intent is too weak.",
        ),
    ]

    ranked = sorted(tasks, key=lambda item: int(item.get("priority") or 0), reverse=True)
    for index, item in enumerate(ranked, start=1):
        item["rank"] = index
    return ranked


def build_default_action_center_tasks(payload: dict[str, Any]) -> list[dict[str, Any]]:
    return _default_action_center_tasks(payload=payload)


def _default_sdr_workflow(*, payload: dict[str, Any]) -> dict[str, Any]:
    now = datetime.utcnow().isoformat()
    stage_order = [
        "New Lead",
        "Analyzed",
        "Email Generated",
        "Approved",
        "Sent",
        "Follow-up",
        "Completed",
    ]
    checkpoints = {
        "new_lead": {"label": "New Lead", "status": "completed", "completed_at": now},
        "analyzed": {"label": "Analyzed", "status": "completed", "completed_at": now},
        "email_generated": {"label": "Email Generated", "status": "pending", "completed_at": ""},
        "approved": {"label": "Approved", "status": "pending", "completed_at": ""},
        "sent": {"label": "Sent", "status": "pending", "completed_at": ""},
        "follow_up": {"label": "Follow-up", "status": "pending", "completed_at": ""},
        "completed": {"label": "Completed", "status": "pending", "completed_at": ""},
    }
    return {
        "generated_at": now,
        "updated_at": now,
        "current_stage": "Analyzed",
        "progress_percent": 29,
        "stage_order": stage_order,
        "checkpoints": checkpoints,
        "crm_sync": {
            "status": "pending",
            "pushed": False,
            "last_pushed_at": "",
            "notes": "",
        },
        "timeline": [
            {
                "source": "workflow",
                "event": "analysis_generated",
                "actor": "ai-system",
                "at": now,
                "title": "AI analysis completed",
                "details": "Lead moved to analyzed stage with recommendations and prioritized actions.",
                "reversible": False,
            }
        ],
    }


def build_default_sdr_workflow(payload: dict[str, Any]) -> dict[str, Any]:
    return _default_sdr_workflow(payload=payload)


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
    revenue_engine_report = company_metadata.get("ai_revenue_engine_report") if isinstance(company_metadata.get("ai_revenue_engine_report"), dict) else {}
    lead_prioritization = company_metadata.get("ai_lead_prioritization") if isinstance(company_metadata.get("ai_lead_prioritization"), dict) else {}
    outreach_strategy = company_metadata.get("ai_outreach_strategy") if isinstance(company_metadata.get("ai_outreach_strategy"), dict) else {}
    live_buying_signals = company_metadata.get("ai_live_buying_signals") if isinstance(company_metadata.get("ai_live_buying_signals"), dict) else {}
    company_predictions = company_metadata.get("ai_company_predictions") if isinstance(company_metadata.get("ai_company_predictions"), dict) else {}
    decision_maker_intelligence = company_metadata.get("decision_maker_intelligence") if isinstance(company_metadata.get("decision_maker_intelligence"), dict) else {}

    lead_risks = list(lead_metadata.get("risks", []) or [])
    lead_signals = list(lead_metadata.get("buying_signals", []) or [])
    lead_technologies = list(lead_metadata.get("technologies", []) or [])
    revenue_pain_points = list(revenue_engine_report.get("top_pain_points", []) or [])
    revenue_opportunities = list(revenue_engine_report.get("top_opportunities", []) or [])
    live_snapshot = live_buying_signals.get("snapshot") if isinstance(live_buying_signals.get("snapshot"), dict) else {}
    follow_up_strategy = revenue_engine_report.get("recommended_follow_up_strategy") if isinstance(revenue_engine_report.get("recommended_follow_up_strategy"), dict) else {}
    recommended_strategy = revenue_engine_report.get("recommended_outreach_strategy") if isinstance(revenue_engine_report.get("recommended_outreach_strategy"), dict) else {}
    technology_summary = revenue_engine_report.get("technology_summary") if isinstance(revenue_engine_report.get("technology_summary"), dict) else {}
    decision_profiles = decision_maker_intelligence.get("profiles") if isinstance(decision_maker_intelligence.get("profiles"), list) else []

    pains = _compact_list(
        [
            *revenue_pain_points,
            *lead_risks,
            str(copilot.risk_to_check or ""),
            "Limited proof of urgency in publicly available data" if not lead_signals else "",
        ],
        max_items=5,
    )
    buying_signals = _compact_list(
        [
            *lead_signals,
            *revenue_opportunities,
            *list(live_snapshot.get("new_hiring", []) or []),
            *list(live_snapshot.get("new_funding", []) or []),
            *list(live_snapshot.get("market_expansion", []) or []),
        ],
        max_items=8,
    )
    technologies = _compact_list(
        [
            *lead_technologies,
            *list(company_metadata.get("technologies", []) or []),
            *list(technology_summary.get("technology_stack", []) or []),
            *list(technology_summary.get("products", []) or []),
            *([company.industry] if company.industry else []),
        ],
        max_items=8,
    )
    growth_indicators = _compact_list(
        [
            *list(live_snapshot.get("new_hiring", []) or []),
            *list(live_snapshot.get("new_funding", []) or []),
            *list(live_snapshot.get("market_expansion", []) or []),
            *list(live_snapshot.get("leadership_changes", []) or []),
            *list(live_snapshot.get("new_products", []) or []),
        ],
        max_items=6,
    )

    fit_reasons = _compact_list(
        [
            str(lead_prioritization.get("reasoning") or ""),
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
            str(recommended_strategy.get("strongest_value_proposition") or ""),
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
    decision_makers = _merge_decision_makers(
        _decision_makers_from_metadata(decision_profiles),
        _decision_makers(contacts),
    )
    top_decision_maker = decision_makers[0] if decision_makers else {"name": _clean_text(top_contact.name if top_contact else ""), "title": _clean_text(top_contact.title if top_contact else ""), "email": _clean_text(top_contact.email if top_contact else "")}
    decision_role = _clean_text(top_decision_maker.get("title")) or "Founder, CEO, VP Sales, or Revenue leader"
    opening_line = f"Hi {top_contact.name if top_contact and top_contact.name else 'there'}, I noticed {company.name} is focused on {target_customers.lower()} and thought this might be relevant."
    score_explanation = str(revenue_engine_report.get("overall_opportunity_score", {}).get("reasoning") or lead_prioritization.get("reasoning") or copilot.fit_reason or "") or "Score is based on fit, buyer intent, and available evidence quality."
    best_communication_channel = _clean_text(recommended_strategy.get("best_channel") or recommended_strategy.get("best_communication_channel") or outreach_strategy.get("best_communication_channel") or outreach_strategy.get("best_channel")) or _best_communication_channel(top_contact, company)
    company_stage = _company_stage(lead=lead, buying_signals=buying_signals, missing_data=missing_data)
    value_proposition = _clean_text(recommended_strategy.get("strongest_value_proposition")) or _clean_text(company.suggested_offer) or str(copilot.best_first_contact or company.sales_angle or "Lead with a concrete operational outcome.")
    personalization_variables = _personalization_variables(
        company=company,
        top_contact=top_contact,
        target_customers=target_customers,
        technologies=technologies,
        buying_signals=buying_signals,
    )
    predicted_objections = _predicted_objections(
        missing_data=missing_data,
        risk_to_check=str(copilot.risk_to_check or "Verify decision-maker context and active need before outreach."),
        buying_signals=buying_signals,
    )
    best_timing_to_contact = _best_timing_to_contact(
        company_stage=company_stage,
        best_communication_channel=best_communication_channel,
        top_contact=top_contact,
    )
    best_timing_to_contact = _clean_text(recommended_strategy.get("best_timing") or outreach_strategy.get("best_timing")) or best_timing_to_contact
    personalized_follow_up_sequence = _compact_list(
        [
            *list(follow_up_strategy.get("schedule", []) or []),
            *list(outreach_strategy.get("follow_up_schedule", []) or []),
        ],
        max_items=4,
    )
    recommended_first_message = " ".join(
        item
        for item in [
            _clean_text(revenue_engine_report.get("recommended_first_email", {}).get("first_sentence")),
            opening_line,
            value_proposition,
            str(revenue_engine_report.get("recommended_cta") or copilot.best_cta or "Would a short 15-minute call next week be useful?"),
        ]
        if _clean_text(item)
    ).strip()
    lead_priority_score = max(0, min(100, _safe_int(lead_prioritization.get("score"), opportunity_score)))
    estimated_company_size = _human_size(lead, company_metadata)
    estimated_revenue = _human_revenue(lead, company_predictions)
    evidence = _compact_list([])  # type: ignore[assignment]
    evidence = _build_evidence(company=company, lead=lead, top_contact=top_contact, website_analysis=website_analysis)
    evidence.extend(_extra_evidence(revenue_engine_report.get("evidence")))
    evidence.extend(_extra_evidence(outreach_strategy.get("why_contact_now_evidence")))
    evidence.extend(_extra_evidence(outreach_strategy.get("best_timing_evidence")))
    deduped_evidence: list[dict[str, Any]] = []
    seen_evidence: set[tuple[str, str]] = set()
    for item in evidence:
        key = (str(item.get("source_field") or "").lower(), str(item.get("value") or "").lower())
        if key in seen_evidence:
            continue
        seen_evidence.add(key)
        deduped_evidence.append(item)
        if len(deduped_evidence) >= 16:
            break

    payload = {
        "generated_at": datetime.utcnow().isoformat(),
        "provider": "openai",
        "model": settings.openai_model,
        "version": 2,
        "company_summary": _clean_text(revenue_engine_report.get("executive_summary")) or _clean_text(copilot.fit_reason) or company.ai_summary or "Potential fit exists but needs validation before outreach.",
        "business_model": _business_model(company, target_customers),
        "what_company_sells": sells,
        "target_customers": target_customers,
        "company_stage": company_stage,
        "pain_points": pains,
        "likely_business_pains": pains,
        "buying_signals": buying_signals,
        "relevant_technologies": technologies,
        "company_growth_indicators": growth_indicators,
        "why_fits_icp": fit_reasons,
        "why_may_not_fit": misfit_reasons,
        "icp_fit_score": max(0, min(100, _safe_int(revenue_engine_report.get("overall_opportunity_score", {}).get("score"), opportunity_score))),
        "ai_lead_score": max(0, min(100, opportunity_score)),
        "lead_priority_score": lead_priority_score,
        "lead_priority_tier": _clean_text(lead_prioritization.get("tier")),
        "buying_probability": max(0, min(100, _safe_int(revenue_engine_report.get("buying_intent", {}).get("score"), copilot.probability_to_buy))),
        "score_explanation": score_explanation,
        "estimated_reply_probability": max(0, min(100, _safe_int(outreach_strategy.get("estimated_reply_probability") or outreach_strategy.get("probability_of_reply"), copilot.probability_to_reply))),
        "estimated_company_size": estimated_company_size,
        "estimated_revenue": estimated_revenue,
        "recommended_decision_maker_role": decision_role,
        "decision_makers": decision_makers,
        "best_outreach_angle": _clean_text(recommended_strategy.get("why_contact_now")) or str(copilot.best_first_contact or company.sales_angle or "Lead with a concrete operational outcome."),
        "value_proposition": value_proposition,
        "best_communication_channel": best_communication_channel,
        "personalization_variables": personalization_variables,
        "predicted_objections": predicted_objections,
        "personalized_opening_line": _clean_text(revenue_engine_report.get("recommended_first_email", {}).get("first_sentence")) or opening_line,
        "strongest_sales_arguments": strongest_arguments,
        "suggested_cta": str(revenue_engine_report.get("recommended_cta") or copilot.best_cta or "Book a 15-minute discovery call"),
        "recommended_next_action": str(revenue_engine_report.get("recommended_next_action") or copilot.next_best_action or "Review fit and send first personalized email."),
        "recommended_first_message": recommended_first_message,
        "personalized_follow_up_sequence": personalized_follow_up_sequence,
        "best_timing_to_contact": best_timing_to_contact,
        "decision_maker": {
            "name": top_decision_maker.get("name") or (top_contact.name if top_contact else ""),
            "title": top_decision_maker.get("title") or (top_contact.title if top_contact else ""),
            "email": top_decision_maker.get("email") or (top_contact.email if top_contact else ""),
        },
        "reasoning": _compact_list([
            *[item for item in copilot.reasoning if _clean_text(item)],
            str(revenue_engine_report.get("overall_opportunity_score", {}).get("reasoning") or ""),
            str(revenue_engine_report.get("buying_intent", {}).get("reasoning") or ""),
            str(lead_prioritization.get("reasoning") or ""),
        ], max_items=6),
        "missing_data": missing_data,
        "evidence": deduped_evidence,
        "summary": _clean_text(revenue_engine_report.get("executive_summary")) or _clean_text(copilot.fit_reason) or company.ai_summary or "Potential fit exists but needs validation before outreach.",
        "opportunity_score": max(0, min(100, _safe_int(revenue_engine_report.get("overall_opportunity_score", {}).get("score"), opportunity_score))),
        "buying_intent_score": max(0, min(100, _safe_int(revenue_engine_report.get("buying_intent", {}).get("score"), copilot.probability_to_buy))),
        "confidence_score": max(0, min(100, _safe_int(revenue_engine_report.get("confidence"), confidence))),
        "outreach_angle": _clean_text(recommended_strategy.get("why_contact_now")) or str(copilot.best_first_contact or company.sales_angle or "Lead with a concrete operational outcome."),
        "best_subject_line": str(revenue_engine_report.get("recommended_first_email", {}).get("subject") or outreach_strategy.get("best_subject_line") or copilot.best_subject_line or "Quick idea for your team"),
        "best_cta": str(revenue_engine_report.get("recommended_cta") or outreach_strategy.get("cta") or copilot.best_cta or "Book a quick call"),
        "risk_to_check": str(copilot.risk_to_check or "Verify decision-maker context and active need before outreach."),
        "next_action": str(revenue_engine_report.get("recommended_next_action") or copilot.next_best_action or "Review the contact profile and send a tailored intro email."),
    }

    recommendation_actions = _build_recommendation_actions(payload=payload)
    payload["recommendation_actions"] = recommendation_actions
    payload["ai_copilot_panel"] = _build_ai_copilot_panel(payload=payload, recommendation_actions=recommendation_actions)
    payload["recommendation_audit_log"] = [
        {
            "event": "generated",
            "actor": "ai-system",
            "at": datetime.utcnow().isoformat(),
            "version": payload.get("version", 1),
            "details": "Initial autonomous SDR recommendations generated.",
        }
    ]
    payload["action_center"] = {
        "generated_at": datetime.utcnow().isoformat(),
        "summary": _clean_text(payload.get("recommended_next_action") or payload.get("next_action") or payload.get("summary")),
        "tasks": _default_action_center_tasks(payload=payload),
        "policy": "Action Center ranks next steps by priority, expected impact, and confidence, and keeps every state change auditable.",
    }
    payload["action_center_audit_log"] = [
        {
            "event": "action_center_generated",
            "actor": "ai-system",
            "at": datetime.utcnow().isoformat(),
            "reason": "initial generation",
            "task_id": "all",
            "new_status": "pending",
        }
    ]
    payload["sdr_workflow"] = _default_sdr_workflow(payload=payload)
    payload["sdr_workflow_audit_log"] = [
        {
            "event": "workflow_initialized",
            "action": "analysis_generated",
            "actor": "ai-system",
            "at": datetime.utcnow().isoformat(),
            "from_stage": "New Lead",
            "to_stage": "Analyzed",
            "reason": "Initial AI SDR workflow created from analysis.",
            "reversible": False,
            "reverted": False,
        }
    ]

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
    payload.setdefault("business_model", "")
    payload.setdefault("company_stage", "")
    payload.setdefault("pain_points", payload.get("likely_business_pains", []) if isinstance(payload.get("likely_business_pains"), list) else [])
    payload.setdefault("icp_fit_score", _safe_int(payload.get("ai_lead_score"), 0))
    payload.setdefault("lead_priority_score", _safe_int(payload.get("ai_lead_score"), 0))
    payload.setdefault("lead_priority_tier", "")
    payload.setdefault("buying_probability", _safe_int(payload.get("buying_intent_score"), 0))
    payload.setdefault("estimated_company_size", "")
    payload.setdefault("estimated_revenue", "")
    payload.setdefault("decision_makers", [payload.get("decision_maker", {})] if isinstance(payload.get("decision_maker"), dict) and payload.get("decision_maker") else [])
    payload.setdefault("value_proposition", "")
    payload.setdefault("best_communication_channel", "")
    payload.setdefault("personalization_variables", [])
    payload.setdefault("predicted_objections", [])
    payload.setdefault("recommended_first_message", payload.get("personalized_opening_line", ""))
    payload.setdefault("personalized_follow_up_sequence", [])
    payload.setdefault("best_timing_to_contact", "")
    payload.setdefault("company_growth_indicators", [])
    payload.setdefault("recommendation_actions", {})
    payload.setdefault("ai_copilot_panel", {})
    payload.setdefault("recommendation_audit_log", [])
    payload.setdefault("action_center", {})
    payload.setdefault("action_center_audit_log", [])
    payload.setdefault("sdr_workflow", _default_sdr_workflow(payload=payload))
    payload.setdefault("sdr_workflow_audit_log", [])
    return payload
