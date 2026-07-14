from __future__ import annotations

from datetime import datetime
from typing import Any

WORKFLOW_STATE_ORDER = [
    "company_saved",
    "needs_enrichment",
    "needs_website_analysis",
    "needs_decision_maker",
    "needs_ai_report",
    "needs_email",
    "needs_follow_up",
    "needs_retry",
    "needs_manual_review",
]


def _state(status: str, reason: str, next_if_pending: str = "") -> dict[str, Any]:
    return {
        "status": status,
        "reason": reason,
        "next_if_pending": next_if_pending,
    }


def _has_email_draft_or_sent(emails: list[Any], metadata: dict[str, Any]) -> bool:
    if metadata.get("email_generated_at"):
        return True
    for email in emails:
        if str(getattr(email, "direction", "") or "").lower() != "outbound":
            continue
        if str(getattr(email, "delivery_status", "") or "").lower() in {"draft", "approved", "sent", "delivered", "opened", "replied"}:
            return True
    return False


def _has_sent_email(emails: list[Any]) -> bool:
    for email in emails:
        if str(getattr(email, "direction", "") or "").lower() != "outbound":
            continue
        status = str(getattr(email, "delivery_status", "") or "").lower()
        if status in {"sent", "delivered", "opened", "replied"}:
            return True
    return False


def _has_reply(emails: list[Any], metadata: dict[str, Any]) -> bool:
    if metadata.get("replied_at"):
        return True
    for email in emails:
        status = str(getattr(email, "delivery_status", "") or "").lower()
        direction = str(getattr(email, "direction", "") or "").lower()
        if status == "replied" or direction == "inbound":
            return True
    return False


def _needs_manual_review(emails: list[Any], metadata: dict[str, Any]) -> bool:
    if metadata.get("email_approved_at"):
        return False
    for email in emails:
        if str(getattr(email, "direction", "") or "").lower() != "outbound":
            continue
        status = str(getattr(email, "delivery_status", "") or "").lower()
        if status in {"approved", "sent", "delivered", "opened", "replied"}:
            return False
    return _has_email_draft_or_sent(emails, metadata)


def build_company_workflow_engine(
    *,
    company: Any,
    metadata: dict[str, Any],
    contacts: list[Any],
    emails: list[Any],
    workflow_stages: dict[str, str],
) -> dict[str, Any]:
    company_intelligence = metadata.get("company_intelligence") if isinstance(metadata.get("company_intelligence"), dict) else {}
    decision_maker_intelligence = metadata.get("decision_maker_intelligence") if isinstance(metadata.get("decision_maker_intelligence"), dict) else {}
    ai_revenue_engine_report = metadata.get("ai_revenue_engine_report") if isinstance(metadata.get("ai_revenue_engine_report"), dict) else {}

    has_enrichment = bool(
        company_intelligence
        or metadata.get("ai_summary")
        or metadata.get("opportunity_analysis")
        or metadata.get("suggested_offer")
        or metadata.get("outreach_strategy")
    )
    has_website_analysis = bool(
        metadata.get("website_analyzed_at")
        or metadata.get("ai_summary")
        or metadata.get("opportunity_analysis")
        or metadata.get("pain_points")
    )
    has_decision_maker = bool(
        contacts
        or metadata.get("selected_decision_maker")
        or metadata.get("deep_contact_search")
        or (decision_maker_intelligence.get("profiles") if isinstance(decision_maker_intelligence.get("profiles"), list) else [])
        or getattr(company, "email", None)
    )
    has_ai_report = bool(
        ai_revenue_engine_report
        or metadata.get("ai_executive_dashboard")
        or metadata.get("ai_final_orchestrator")
        or metadata.get("opportunity_ranking")
    )
    has_email = _has_email_draft_or_sent(emails, metadata)
    has_sent = _has_sent_email(emails)
    has_reply = _has_reply(emails, metadata)
    needs_follow_up = bool(has_sent and not has_reply)
    needs_retry = any(str(value) == "error" for value in (workflow_stages or {}).values())
    manual_review_required = _needs_manual_review(emails, metadata)

    states = {
        "company_saved": _state(
            "completed",
            "Company record is present in CRM.",
        ),
        "needs_enrichment": _state(
            "completed" if has_enrichment else "pending",
            "AI enrichment data is available." if has_enrichment else "Company needs AI enrichment before deeper workflow steps.",
            "run_enrichment",
        ),
        "needs_website_analysis": _state(
            "completed" if has_website_analysis else "pending",
            "Website analysis exists in metadata." if has_website_analysis else "Website analysis is missing and should run next.",
            "run_website_analysis",
        ),
        "needs_decision_maker": _state(
            "completed" if has_decision_maker else "pending",
            "Decision-maker data is available." if has_decision_maker else "Decision-maker contact is required before outreach.",
            "find_decision_maker",
        ),
        "needs_ai_report": _state(
            "completed" if has_ai_report else "pending",
            "AI report exists for this company." if has_ai_report else "Generate AI report before drafting outreach.",
            "generate_ai_report",
        ),
        "needs_email": _state(
            "completed" if has_email else "pending",
            "Email draft or sent email already exists." if has_email else "Generate first outbound email draft.",
            "generate_email",
        ),
        "needs_follow_up": _state(
            "pending" if needs_follow_up else "completed",
            "Follow-up is due because outreach was sent without reply." if needs_follow_up else "No follow-up currently required.",
            "send_follow_up",
        ),
        "needs_retry": _state(
            "pending" if needs_retry else "completed",
            "One or more workflow stages failed and should be retried." if needs_retry else "No failed stage requires retry.",
            "retry_failed_stages",
        ),
        "needs_manual_review": _state(
            "pending" if manual_review_required else "completed",
            "Manual approval is required before sending." if manual_review_required else "Manual review requirement is satisfied.",
            "manual_review",
        ),
    }

    if needs_retry:
        current_state = "needs_retry"
        next_action = "Retry failed enrichment and contact steps before continuing."
    elif not has_enrichment:
        current_state = "needs_enrichment"
        next_action = "Run enrichment for company profile and outreach signals."
    elif not has_website_analysis:
        current_state = "needs_website_analysis"
        next_action = "Run website analysis to generate AI research fields."
    elif not has_decision_maker:
        current_state = "needs_decision_maker"
        next_action = "Find or add a decision maker with verified contact details."
    elif not has_ai_report:
        current_state = "needs_ai_report"
        next_action = "Generate AI revenue report from existing enrichment data."
    elif not has_email:
        current_state = "needs_email"
        next_action = "Generate personalized email draft for review."
    elif needs_follow_up:
        current_state = "needs_follow_up"
        next_action = "Prepare and send follow-up message to the recipient."
    elif manual_review_required:
        current_state = "needs_manual_review"
        next_action = "Review and approve the draft before sending."
    else:
        current_state = "workflow_completed"
        next_action = "Monitor replies and update pipeline stage as outcomes arrive."

    status = "completed" if current_state == "workflow_completed" else "in_progress"
    transitions = [
        {"from": "company_saved", "to": "needs_enrichment", "condition": "company_saved"},
        {"from": "needs_enrichment", "to": "needs_website_analysis", "condition": "enrichment_completed"},
        {"from": "needs_website_analysis", "to": "needs_decision_maker", "condition": "website_analysis_completed"},
        {"from": "needs_decision_maker", "to": "needs_ai_report", "condition": "decision_maker_available"},
        {"from": "needs_ai_report", "to": "needs_email", "condition": "ai_report_available"},
        {"from": "needs_email", "to": "needs_follow_up", "condition": "email_sent"},
        {"from": "needs_follow_up", "to": "needs_retry", "condition": "follow_up_failed"},
        {"from": "needs_retry", "to": "needs_manual_review", "condition": "retry_complete"},
    ]

    return {
        "version": 1,
        "generated_at": datetime.utcnow().isoformat(),
        "status": status,
        "current_state": current_state,
        "next_action": next_action,
        "states": states,
        "state_order": WORKFLOW_STATE_ORDER,
        "transitions": transitions,
        "needs": {
            "enrichment": not has_enrichment,
            "website_analysis": not has_website_analysis,
            "decision_maker": not has_decision_maker,
            "ai_report": not has_ai_report,
            "email": not has_email,
            "follow_up": needs_follow_up,
            "retry": needs_retry,
            "manual_review": manual_review_required,
        },
    }
