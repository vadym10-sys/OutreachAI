from __future__ import annotations

import re
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from app.models.entities import AgentTraceEvent
from app.services.ai_memory import redact_sensitive_text

SENSITIVE_KEY_RE = re.compile(
    r"(authorization|cookie|set_cookie|set-cookie|api_key|apikey|access_token|refresh_token|oauth|password|secret|client_secret|private_key|token)",
    re.IGNORECASE,
)
EMAIL_CONTENT_KEY_RE = re.compile(
    r"(^|_)(body|email_body|draft_body|message_body|html_body|text_body)($|_)",
    re.IGNORECASE,
)


def _is_email_content_fingerprint(value: Any) -> bool:
    return (
        isinstance(value, dict)
        and set(value.keys()).issubset({"sha256", "length"})
        and isinstance(value.get("sha256"), str)
        and isinstance(value.get("length"), int)
    )


def sanitize_for_trace(value: Any, *, max_string_length: int = 4000, _depth: int = 0) -> Any:
    if _depth > 8:
        return "[REDACTED_DEPTH]"
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, str):
        return redact_sensitive_text(value, max_length=max_string_length)
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, dict):
        clean: dict[str, Any] = {}
        for key, item in value.items():
            key_text = str(key)
            if SENSITIVE_KEY_RE.search(key_text):
                clean[key_text] = "[REDACTED_SECRET]"
            elif EMAIL_CONTENT_KEY_RE.search(key_text):
                if _is_email_content_fingerprint(item):
                    clean[key_text] = sanitize_for_trace(
                        item, max_string_length=max_string_length, _depth=_depth + 1
                    )
                else:
                    clean[key_text] = "[REDACTED_CONTENT]"
            else:
                clean[key_text] = sanitize_for_trace(
                    item, max_string_length=max_string_length, _depth=_depth + 1
                )
        return clean
    if isinstance(value, (list, tuple, set)):
        return [
            sanitize_for_trace(item, max_string_length=max_string_length, _depth=_depth + 1)
            for item in list(value)[:100]
        ]
    return redact_sensitive_text(str(value), max_length=max_string_length)


def safe_trace_message(message: str, *, error_category_value: str = "") -> str:
    if error_category_value:
        return "This step could not be completed safely."
    return redact_sensitive_text(message, max_length=1000)


def error_category(exc: Exception) -> str:
    category = getattr(exc, "category", "")
    if category:
        return str(category)
    return exc.__class__.__name__


def record_trace(
    db: Session,
    *,
    run_id: UUID,
    workspace_id: UUID,
    user_id: str,
    event_type: str,
    step_id: UUID | None = None,
    tool_call_id: UUID | None = None,
    status: str = "",
    model: str = "",
    tool_name: str = "",
    latency_ms: int = 0,
    token_usage: dict[str, Any] | None = None,
    estimated_cost: float | None = None,
    approval_decision: str = "",
    error: Exception | str | None = None,
    message: str = "",
    data: dict[str, Any] | None = None,
    untrusted_input: bool = False,
) -> AgentTraceEvent:
    err_category = ""
    if isinstance(error, Exception):
        err_category = error_category(error)
        message = message or str(error)
    elif isinstance(error, str):
        err_category = error
    event = AgentTraceEvent(
        run_id=run_id,
        step_id=step_id,
        tool_call_id=tool_call_id,
        workspace_id=workspace_id,
        user_id=user_id,
        event_type=event_type,
        status=status,
        model=model,
        tool_name=tool_name,
        latency_ms=max(0, int(latency_ms or 0)),
        token_usage=sanitize_for_trace(token_usage or {}),
        estimated_cost=estimated_cost,
        approval_decision=approval_decision,
        error_category=err_category,
        message=safe_trace_message(message, error_category_value=err_category),
        data_json=sanitize_for_trace(data or {}),
        untrusted_input=untrusted_input,
    )
    db.add(event)
    return event
