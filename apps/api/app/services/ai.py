from __future__ import annotations

import json
import logging
import threading
import time
from collections import deque
from collections.abc import Iterator
from typing import Any, Optional

from openai import OpenAI, OpenAIError

from app.core.config import get_settings
from app.core.observability import capture_provider_exception
from app.schemas.dto import (
    AnalysisOut,
    CampaignAnalyticsOut,
    EmailVariantOut,
    FollowUpSequenceOut,
    MeetingPrepOut,
    PersonalizeRequest,
    ReplyAssistantOut,
    ReplyAssistantRequest,
    RewriteEmailRequest,
    SalesCopilotOut,
    WebsiteAuditOut,
)

logger = logging.getLogger("outreachai.ai")


class ProviderConfigurationError(RuntimeError):
    pass


class ProviderRequestError(RuntimeError):
    pass


_rate_lock = threading.Lock()
_rate_window: deque[float] = deque()


def _enforce_rate_limit() -> None:
    settings = get_settings()
    limit = max(settings.ai_rate_limit_per_minute, 1)
    now = time.monotonic()
    with _rate_lock:
        while _rate_window and now - _rate_window[0] > 60:
            _rate_window.popleft()
        if len(_rate_window) >= limit:
            raise ProviderRequestError("AI rate limit exceeded. Try again in a minute.")
        _rate_window.append(now)


def _client() -> OpenAI:
    settings = get_settings()
    if not settings.openai_api_key:
        raise ProviderConfigurationError("OPENAI_API_KEY is required for AI generation.")
    return OpenAI(
        api_key=settings.openai_api_key,
        timeout=settings.openai_timeout_seconds,
        max_retries=settings.openai_max_retries,
    )


def _json_completion(system: str, payload: dict[str, Any]) -> dict[str, Any]:
    _enforce_rate_limit()
    settings = get_settings()
    client = _client()
    try:
        response = client.chat.completions.create(
            model=settings.openai_model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
            ],
            response_format={"type": "json_object"},
        )
    except OpenAIError as exc:
        logger.exception("OpenAI request failed")
        capture_provider_exception(exc, provider="openai", endpoint="openai.chat_completion", extra={"model": settings.openai_model})
        raise ProviderRequestError(str(exc)) from exc

    content = response.choices[0].message.content or "{}"
    try:
        parsed = json.loads(content)
    except json.JSONDecodeError as exc:
        capture_provider_exception(exc, provider="openai", endpoint="openai.chat_completion", extra={"model": settings.openai_model, "reason": "invalid_json"})
        raise ProviderRequestError("OpenAI returned invalid JSON.") from exc
    if not isinstance(parsed, dict):
        raise ProviderRequestError("OpenAI returned an unexpected response shape.")
    return parsed


def analyze_company_website(
    *,
    company: str,
    website: str,
    niche: Optional[str],
    page_title: str,
    meta_description: str,
    page_text: str,
    technologies: list[str],
) -> AnalysisOut:
    system = (
        "You are OutreachAI's production website analyst. Return only JSON with keys "
        "company, website, description, industry, location, niche, products_services, "
        "services, technologies, strengths, weaknesses, icp_score, summary, icp, "
        "value_proposition, detected_language, target_geography, sales_angle, "
        "company_summary, suggested_offer, outreach_strategy, recommended_tone, "
        "recommended_cta, follow_up_strategy, expected_reply_rate. icp_score must be "
        "an integer from 0 to 100. expected_reply_rate should be a realistic percentage "
        "range like 6-10%. Do not invent contact details. Mark unknown fields as empty "
        "strings or empty arrays."
    )
    data = _json_completion(
        system,
        {
            "company_hint": company,
            "website": website,
            "niche_hint": niche,
            "page_title": page_title,
            "meta_description": meta_description,
            "detected_technologies": technologies,
            "visible_website_text": page_text[:12000],
        },
    )
    return AnalysisOut(
        company=str(data.get("company") or company or ""),
        website=website,
        description=str(data.get("description") or meta_description or ""),
        industry=data.get("industry") or niche,
        location=data.get("location") or "",
        niche=str(data.get("niche") or niche or data.get("industry") or "B2B"),
        products_services=_list(data.get("products_services")),
        services=_list(data.get("services") or data.get("products_services")),
        technologies=sorted(set([*_list(data.get("technologies")), *technologies])),
        strengths=_list(data.get("strengths")),
        weaknesses=_list(data.get("weaknesses")),
        icp_score=max(0, min(100, int(data.get("icp_score") or 0))),
        summary=str(data.get("summary") or ""),
        icp=str(data.get("icp") or ""),
        value_proposition=str(data.get("value_proposition") or ""),
        detected_language=str(data.get("detected_language") or ""),
        target_geography=str(data.get("target_geography") or data.get("location") or ""),
        sales_angle=str(data.get("sales_angle") or ""),
        company_summary=str(data.get("company_summary") or data.get("summary") or ""),
        suggested_offer=str(data.get("suggested_offer") or ""),
        outreach_strategy=str(data.get("outreach_strategy") or ""),
        recommended_tone=str(data.get("recommended_tone") or "Professional"),
        recommended_cta=str(data.get("recommended_cta") or "Book a quick call"),
        follow_up_strategy=str(data.get("follow_up_strategy") or ""),
        expected_reply_rate=str(data.get("expected_reply_rate") or ""),
    )


def personalize_email(payload: PersonalizeRequest) -> EmailVariantOut:
    system = (
        "You are OutreachAI's production outbound copywriter. Return only JSON with keys "
        "subject, preview, full_email, cta, cold_email, follow_ups, ab_tests. Write concise, "
        "personalized B2B email copy in the requested language and tone. Every email must use "
        "specific details from the provided company, website summary, industry, location, services, "
        "and pain points when present. Avoid generic first lines. Do not use unverified metrics."
    )
    data = _json_completion(system, payload.model_dump())
    subject = str(data.get("subject") or "")
    body = str(data.get("full_email") or data.get("cold_email") or "")
    cta = str(data.get("cta") or payload.cta)
    return EmailVariantOut(
        subject=subject,
        preview=str(data.get("preview") or ""),
        full_email=body,
        cta=cta,
        cold_email=str(data.get("cold_email") or f"Subject: {subject}\n\n{body}"),
        follow_ups=_list(data.get("follow_ups"))[:3],
        ab_tests=_list(data.get("ab_tests")),
    )


def rewrite_email(payload: RewriteEmailRequest) -> dict[str, str]:
    system = "Rewrite the provided outbound email. Return only JSON with key body."
    data = _json_completion(system, payload.model_dump())
    return {"body": str(data.get("body") or "")}


def suggest_reply(payload: ReplyAssistantRequest) -> ReplyAssistantOut:
    system = (
        "You are an AI sales reply assistant. Return only JSON with keys suggested_response, "
        "next_step, qualification_score. qualification_score must be an integer from 0 to 100."
    )
    data = _json_completion(system, payload.model_dump())
    return ReplyAssistantOut(
        suggested_response=str(data.get("suggested_response") or ""),
        next_step=str(data.get("next_step") or ""),
        qualification_score=max(0, min(100, int(data.get("qualification_score") or 0))),
    )


def sales_copilot(payload: dict[str, Any]) -> SalesCopilotOut:
    system = (
        "You are OutreachAI's AI sales copilot. Return only JSON with keys "
        "probability_to_reply, probability_to_buy, best_first_contact, best_subject_line, "
        "best_cta, estimated_revenue, reasoning. Probabilities are integers 0-100. "
        "Base recommendations only on provided lead, website analysis, and campaign context."
    )
    data = _json_completion(system, payload)
    return SalesCopilotOut(
        probability_to_reply=_bounded_int(data.get("probability_to_reply"), 0, 100),
        probability_to_buy=_bounded_int(data.get("probability_to_buy"), 0, 100),
        best_first_contact=str(data.get("best_first_contact") or "Personalized email"),
        best_subject_line=str(data.get("best_subject_line") or "Quick idea for your team"),
        best_cta=str(data.get("best_cta") or "Book a quick call"),
        estimated_revenue=max(0, float(data.get("estimated_revenue") or 0)),
        reasoning=_list(data.get("reasoning")),
    )


def website_audit(payload: dict[str, Any]) -> WebsiteAuditOut:
    system = (
        "You are OutreachAI's website conversion auditor. Return only JSON with keys "
        "missing_cta, missing_contact_form, poor_seo, weak_trust_signals, missing_reviews, "
        "slow_website, outdated_design, improvement_report, priority_actions. "
        "Use booleans for detected issues and write a concise actionable report."
    )
    data = _json_completion(system, payload)
    return WebsiteAuditOut(
        missing_cta=bool(data.get("missing_cta")),
        missing_contact_form=bool(data.get("missing_contact_form")),
        poor_seo=bool(data.get("poor_seo")),
        weak_trust_signals=bool(data.get("weak_trust_signals")),
        missing_reviews=bool(data.get("missing_reviews")),
        slow_website=bool(data.get("slow_website")),
        outdated_design=bool(data.get("outdated_design")),
        improvement_report=str(data.get("improvement_report") or ""),
        priority_actions=_list(data.get("priority_actions")),
    )


def meeting_preparation(payload: dict[str, Any]) -> MeetingPrepOut:
    system = (
        "You prepare B2B sales meetings. Return only JSON with keys company_summary, "
        "decision_maker_profile, likely_objections, suggested_questions, sales_strategy. "
        "Be specific and practical."
    )
    data = _json_completion(system, payload)
    return MeetingPrepOut(
        company_summary=str(data.get("company_summary") or ""),
        decision_maker_profile=str(data.get("decision_maker_profile") or ""),
        likely_objections=_list(data.get("likely_objections")),
        suggested_questions=_list(data.get("suggested_questions")),
        sales_strategy=str(data.get("sales_strategy") or ""),
    )


def adaptive_follow_ups(payload: dict[str, Any]) -> FollowUpSequenceOut:
    system = (
        "You generate adaptive outbound follow-up sequences. Return only JSON with keys "
        "no_open, opened, clicked, replied. Each key must contain concise email bodies "
        "for that behavior state."
    )
    data = _json_completion(system, payload)
    return FollowUpSequenceOut(
        no_open=_list(data.get("no_open"))[:3],
        opened=_list(data.get("opened"))[:3],
        clicked=_list(data.get("clicked"))[:3],
        replied=_list(data.get("replied"))[:3],
    )


def campaign_analytics(payload: dict[str, Any]) -> CampaignAnalyticsOut:
    system = (
        "You are OutreachAI's campaign analytics copilot. Return only JSON with keys "
        "campaign_success, predicted_reply_rate, predicted_conversion_rate, suggested_improvements. "
        "Use percentages for rates and specific tactical recommendations."
    )
    data = _json_completion(system, payload)
    return CampaignAnalyticsOut(
        campaign_id=payload.get("campaign_id"),
        campaign_success=_bounded_int(data.get("campaign_success"), 0, 100),
        predicted_reply_rate=max(0, float(data.get("predicted_reply_rate") or 0)),
        predicted_conversion_rate=max(0, float(data.get("predicted_conversion_rate") or 0)),
        suggested_improvements=_list(data.get("suggested_improvements")),
    )


def qualify_for_sales_employee(payload: dict[str, Any]) -> dict[str, Any]:
    system = (
        "You are OutreachAI's AI Sales Employee qualification engine. Return only JSON with keys "
        "industry, services, pain_points, icp_score, purchase_probability, best_sales_angle, "
        "best_cta, recommended_plan, summary. Scores are integers 0-100. Use the AI employee's "
        "product, offer, target customer, target countries, and target industries to decide fit. "
        "Do not invent contact data."
    )
    data = _json_completion(system, payload)
    return {
        "industry": str(data.get("industry") or payload.get("lead", {}).get("industry") or ""),
        "services": _list(data.get("services")),
        "pain_points": _list(data.get("pain_points")),
        "icp_score": _bounded_int(data.get("icp_score"), 0, 100),
        "purchase_probability": _bounded_int(data.get("purchase_probability"), 0, 100),
        "best_sales_angle": str(data.get("best_sales_angle") or ""),
        "best_cta": str(data.get("best_cta") or payload.get("employee", {}).get("cta") or ""),
        "recommended_plan": str(data.get("recommended_plan") or "Starter"),
        "summary": str(data.get("summary") or ""),
    }


def plan_sales_employee_task(payload: dict[str, Any]) -> dict[str, Any]:
    system = (
        "You are OutreachAI's autonomous AI Sales Employee planner. Return only JSON with keys "
        "goal, intent, priority, required_tools, estimated_execution_time, expected_result, steps, "
        "requires_approval, external_actions, safety_notes, memory_updates. The plan must feel like "
        "work assigned to a sales employee. Never plan to send emails, launch campaigns, modify CRM, "
        "or delete data without explicit approval. Use Review Mode as the default safety posture."
    )
    data = _json_completion(system, payload)
    external_actions = _list(data.get("external_actions"))
    requires_approval = bool(data.get("requires_approval", True)) or bool(external_actions)
    return {
        "goal": str(data.get("goal") or payload.get("command") or ""),
        "intent": str(data.get("intent") or "sales_research"),
        "priority": str(data.get("priority") or "Medium"),
        "required_tools": _list(data.get("required_tools")) or ["Lead Finder", "Website Analyzer", "AI Email Generator"],
        "estimated_execution_time": str(data.get("estimated_execution_time") or "5-10 minutes"),
        "expected_result": str(data.get("expected_result") or "A reviewed sales work plan with clear next steps."),
        "steps": _list(data.get("steps")) or ["Understand the goal", "Prepare safe execution steps", "Wait for approval"],
        "requires_approval": requires_approval,
        "external_actions": external_actions,
        "safety_notes": _list(data.get("safety_notes")) or ["No email will be sent without approval.", "No campaign will launch without approval."],
        "memory_updates": _list(data.get("memory_updates")),
    }


def route_ai_team_task(payload: dict[str, Any]) -> dict[str, Any]:
    system = (
        "You are OutreachAI's AI Team Router. Classify one user command and route it to "
        "one or more AI employees from this exact set: Sales, Marketing, Support, Operations. "
        "Return only JSON with keys detected_intent, primary_employee, assigned_employees, "
        "priority, risk_level, estimated_execution_time, subtasks, safety_notes. Each subtask "
        "must contain employee, title, objective, required_tools, expected_result, risk_level, "
        "required_approval. Split multi-domain work into separate subtasks. Never allow email "
        "sending, campaign launch, CRM modification, or deletion without approval."
    )
    data = _json_completion(system, payload)
    employees = _employee_list(data.get("assigned_employees"))
    subtasks = _router_subtasks(data.get("subtasks"), payload.get("command", ""))
    if not employees:
        employees = sorted({subtask["employee"] for subtask in subtasks})
    primary = _employee_name(data.get("primary_employee")) or (employees[0] if employees else "Sales")
    if primary not in employees:
        employees.insert(0, primary)
    return {
        "detected_intent": str(data.get("detected_intent") or _intent_from_subtasks(subtasks)),
        "primary_employee": primary,
        "assigned_employees": employees,
        "priority": str(data.get("priority") or "Medium"),
        "risk_level": _risk_level(data.get("risk_level"), subtasks),
        "estimated_execution_time": str(data.get("estimated_execution_time") or "5-10 minutes"),
        "subtasks": subtasks,
        "safety_notes": _list(data.get("safety_notes")) or [
            "Approval is required before external actions.",
            "No emails, campaigns, CRM changes, or deletion will happen without approval.",
        ],
    }


def stream_email_generation(payload: PersonalizeRequest) -> Iterator[str]:
    _enforce_rate_limit()
    settings = get_settings()
    client = _client()
    try:
        stream = client.chat.completions.create(
            model=settings.openai_model,
            messages=[
                {"role": "system", "content": "Stream a personalized cold email draft as plain text."},
                {"role": "user", "content": payload.model_dump_json()},
            ],
            stream=True,
        )
        for event in stream:
            chunk = event.choices[0].delta.content
            if chunk:
                yield chunk
    except OpenAIError as exc:
        logger.exception("OpenAI streaming request failed")
        capture_provider_exception(exc, provider="openai", endpoint="openai.streaming_completion", extra={"model": settings.openai_model})
        raise ProviderRequestError(str(exc)) from exc


def _list(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    if isinstance(value, str) and value.strip():
        return [value.strip()]
    return []


def _bounded_int(value: Any, minimum: int, maximum: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = minimum
    return max(minimum, min(maximum, parsed))


def _employee_name(value: Any) -> str:
    normalized = str(value or "").strip().lower()
    aliases = {
        "sales": "Sales",
        "sales employee": "Sales",
        "marketing": "Marketing",
        "marketing employee": "Marketing",
        "support": "Support",
        "support employee": "Support",
        "operations": "Operations",
        "operations employee": "Operations",
        "ops": "Operations",
    }
    return aliases.get(normalized, "")


def _employee_list(value: Any) -> list[str]:
    items = value if isinstance(value, list) else [value]
    employees: list[str] = []
    for item in items:
        employee = _employee_name(item)
        if employee and employee not in employees:
            employees.append(employee)
    return employees


def _router_subtasks(value: Any, command: str) -> list[dict[str, Any]]:
    raw_items = value if isinstance(value, list) else []
    subtasks: list[dict[str, Any]] = []
    for index, item in enumerate(raw_items):
        if not isinstance(item, dict):
            continue
        employee = _employee_name(item.get("employee"))
        if not employee:
            continue
        risk = str(item.get("risk_level") or "Low").title()
        subtasks.append(
            {
                "id": str(index + 1),
                "employee": employee,
                "title": str(item.get("title") or f"{employee} task"),
                "objective": str(item.get("objective") or command),
                "required_tools": _list(item.get("required_tools")),
                "expected_result": str(item.get("expected_result") or "Prepared work for review."),
                "risk_level": risk if risk in {"Low", "Medium", "High"} else "Medium",
                "required_approval": True,
                "status": "waiting_approval",
                "result": "",
            }
        )
    if subtasks:
        return subtasks
    return _heuristic_router_subtasks(command)


def _heuristic_router_subtasks(command: str) -> list[dict[str, Any]]:
    lowered = command.lower()
    mapping = [
        ("Sales", ["lead", "client", "company", "outreach", "email", "campaign", "prospect", "construction"]),
        ("Marketing", ["linkedin", "post", "content", "brand", "marketing", "social"]),
        ("Support", ["reply", "customer", "ticket", "summarize", "support", "complaint"]),
        ("Operations", ["performance", "report", "metric", "dashboard", "check", "sync", "operations"]),
    ]
    subtasks = []
    for employee, keywords in mapping:
        if any(keyword in lowered for keyword in keywords):
            tools = {
                "Sales": ["Lead Finder", "Website Analyzer", "AI Email Generator"],
                "Marketing": ["Content Planner", "Campaign Analytics"],
                "Support": ["Inbox", "Reply Assistant"],
                "Operations": ["Analytics", "Activity Timeline"],
            }[employee]
            subtasks.append(
                {
                    "id": str(len(subtasks) + 1),
                    "employee": employee,
                    "title": f"{employee} workstream",
                    "objective": command,
                    "required_tools": tools,
                    "expected_result": f"{employee} prepares reviewed results for the command.",
                    "risk_level": "Medium" if employee == "Sales" else "Low",
                    "required_approval": True,
                    "status": "waiting_approval",
                    "result": "",
                }
            )
    return subtasks or [
        {
            "id": "1",
            "employee": "Operations",
            "title": "Triage request",
            "objective": command,
            "required_tools": ["Workspace Context", "Activity Timeline"],
            "expected_result": "A safe internal plan and recommended owner.",
            "risk_level": "Low",
            "required_approval": True,
            "status": "waiting_approval",
            "result": "",
        }
    ]


def _intent_from_subtasks(subtasks: list[dict[str, Any]]) -> str:
    employees = ", ".join(sorted({str(item.get("employee")) for item in subtasks if item.get("employee")}))
    return f"Route work to {employees or 'Operations'}"


def _risk_level(value: Any, subtasks: list[dict[str, Any]]) -> str:
    requested = str(value or "").title()
    if requested in {"Low", "Medium", "High"}:
        return requested
    levels = [str(item.get("risk_level") or "Low") for item in subtasks]
    if "High" in levels:
        return "High"
    if "Medium" in levels:
        return "Medium"
    return "Low"
