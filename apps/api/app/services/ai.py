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
from app.schemas.dto import (
    AnalysisOut,
    EmailVariantOut,
    PersonalizeRequest,
    ReplyAssistantOut,
    ReplyAssistantRequest,
    RewriteEmailRequest,
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
            temperature=0.4,
        )
    except OpenAIError as exc:
        logger.exception("OpenAI request failed")
        raise ProviderRequestError(str(exc)) from exc

    content = response.choices[0].message.content or "{}"
    try:
        parsed = json.loads(content)
    except json.JSONDecodeError as exc:
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
        "services, technologies, strengths, weaknesses, summary. Do not invent contact "
        "details. Mark unknown fields as empty strings or empty arrays."
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
        summary=str(data.get("summary") or ""),
    )


def personalize_email(payload: PersonalizeRequest) -> EmailVariantOut:
    system = (
        "You are OutreachAI's production outbound copywriter. Return only JSON with keys "
        "subject, preview, full_email, cta, cold_email, follow_ups, ab_tests. Write concise, "
        "personalized B2B email copy in the requested language and tone. Do not use unverified metrics."
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
        follow_ups=_list(data.get("follow_ups"))[:2],
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
            temperature=0.4,
            stream=True,
        )
        for event in stream:
            chunk = event.choices[0].delta.content
            if chunk:
                yield chunk
    except OpenAIError as exc:
        logger.exception("OpenAI streaming request failed")
        raise ProviderRequestError(str(exc)) from exc


def _list(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    if isinstance(value, str) and value.strip():
        return [value.strip()]
    return []
