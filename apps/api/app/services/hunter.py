from __future__ import annotations

import json
import logging
import re
import time
from typing import Any
from urllib.parse import urlparse

import httpx
from pydantic import ValidationError

from app.core.config import get_settings
from app.core.observability import capture_provider_exception
from app.schemas.dto import LeadOut

logger = logging.getLogger("outreachai.hunter")

HUNTER_BASE_URL = "https://api.hunter.io/v2"
DECISION_MAKER_TITLES = ("CEO", "Founder", "Owner", "Sales Director", "Marketing Director")


class HunterConfigurationError(RuntimeError):
    pass


class HunterRequestError(RuntimeError):
    pass


def hunter_key_loaded() -> bool:
    return bool(get_settings().hunter_api_key)


def test_hunter_connection() -> dict[str, Any]:
    started = time.monotonic()
    data = _hunter_get("/account", {}, operation="hunter.connection_test")
    return {
        "connected": True,
        "duration_ms": _duration_ms(started),
        "records": int((data.get("data") or {}).get("requests", {}).get("searches", {}).get("used") or 0)
        if isinstance(data.get("data"), dict)
        else 0,
    }


def enrich_leads_with_hunter(leads: list[LeadOut]) -> list[LeadOut]:
    if not leads or not hunter_key_loaded():
        logger.info("hunter.enrichment skipped leads=%s configured=%s", len(leads), hunter_key_loaded())
        return leads
    enriched: list[LeadOut] = []
    logger.info("hunter.enrichment started leads=%s", len(leads))
    for lead in leads:
        try:
            enriched.append(enrich_lead_with_hunter(lead))
        except HunterConfigurationError:
            return leads
        except HunterRequestError as exc:
            logger.warning("hunter.enrichment_failed company=%s reason=%s", lead.company, exc)
            enriched.append(_with_hunter_metadata(lead, {"hunter_status": "error", "hunter_error": str(exc)}))
    logger.info(
        "hunter.enrichment completed leads=%s verified=%s",
        len(enriched),
        sum(1 for lead in enriched if lead.hunter_verified),
    )
    return enriched


def enrich_lead_with_hunter(lead: LeadOut) -> LeadOut:
    domain = _lead_domain(lead)
    if not domain:
        logger.info("hunter.lead skipped company=%s reason=no_domain", lead.company)
        return _with_hunter_metadata(lead, {"hunter_status": "no_domain"})

    started = time.monotonic()
    logger.info("hunter.lead request company=%s domain=%s", lead.company, domain)
    candidates = _domain_search(domain)
    logger.info("hunter.domain_search response company=%s domain=%s candidates=%s", lead.company, domain, len(candidates))
    verified = [_verify_candidate(candidate, domain) for candidate in candidates]
    verified = [candidate for candidate in verified if candidate.get("verified")]
    if not verified:
        logger.info("hunter.lead no_verified_email company=%s domain=%s duration_ms=%s", lead.company, domain, _duration_ms(started))
        return _with_hunter_metadata(
            lead,
            {
                "hunter_status": "no_verified_email",
                "hunter_checked": True,
                "hunter_domain": domain,
                "source": _source_after_enrichment(lead, verified=False),
            },
        )

    best = sorted(verified, key=_candidate_score, reverse=True)[0]
    contact = str(best.get("name") or "").strip() or None
    email = _clean_email(str(best.get("email") or ""))
    title = str(best.get("position") or best.get("title") or "").strip() or None
    metadata = {
        "source": "hunter",
        "apollo_source": lead.source or "apollo",
        "domain": domain,
        "employee_count": lead.employee_count,
        "revenue": lead.revenue_range,
        "apollo_company_id": lead.apollo_company_id,
        "apollo_contact_id": lead.apollo_contact_id,
        "hunter_contact_id": best.get("id") or email,
        "hunter_verified": True,
        "hunter_status": "verified",
        "hunter_confidence": best.get("score"),
        "confidence": best.get("score"),
        "title": title,
        "source_payload": "hunter_enrichment",
        "hunter_duration_ms": _duration_ms(started),
    }
    try:
        logger.info(
            "hunter.lead verified company=%s domain=%s title=%s confidence=%s duration_ms=%s",
            lead.company,
            domain,
            title,
            best.get("score"),
            _duration_ms(started),
        )
        return lead.model_copy(
            update={
                "contact": contact or lead.contact,
                "email": email or lead.email,
                "title": title or lead.title,
                "confidence": str(best.get("score") or lead.confidence or "") or None,
                "hunter_contact_id": str(best.get("id") or email or "") or None,
                "hunter_verified": True,
                "hunter_status": "verified",
                "source": "hunter",
                "notes": _merge_metadata_notes(lead, metadata),
            }
        )
    except ValidationError:
        logger.info("hunter.verified_email_rejected_by_schema company=%s domain=%s", lead.company, domain)
        return _with_hunter_metadata(
            lead,
            {
                **metadata,
                "hunter_verified": False,
                "hunter_status": "invalid_email_format",
                "source": _source_after_enrichment(lead, verified=False),
            },
        )


def _domain_search(domain: str) -> list[dict[str, Any]]:
    logger.info("hunter.domain_search request domain=%s", domain)
    data = _hunter_get(
        "/domain-search",
        {
            "domain": domain,
            "type": "personal",
            "limit": "10",
        },
        operation="hunter.domain_search",
    )
    payload = data.get("data") if isinstance(data.get("data"), dict) else {}
    emails = payload.get("emails") if isinstance(payload.get("emails"), list) else []
    logger.info("hunter.domain_search parsed domain=%s emails=%s decision_maker_candidates=%s", domain, len(emails), len([item for item in emails if isinstance(item, dict) and _is_decision_maker(item)]))
    return [item for item in emails if isinstance(item, dict) and _is_decision_maker(item)]


def _verify_candidate(candidate: dict[str, Any], domain: str) -> dict[str, Any]:
    email = _clean_email(str(candidate.get("value") or candidate.get("email") or ""))
    if not email:
        return {**candidate, "verified": False}
    data = _hunter_get("/email-verifier", {"email": email}, operation="hunter.email_verifier")
    payload = data.get("data") if isinstance(data.get("data"), dict) else {}
    result = str(payload.get("result") or payload.get("status") or "").lower()
    score = payload.get("score") if payload.get("score") is not None else candidate.get("confidence")
    return {
        **candidate,
        "email": email,
        "id": candidate.get("id") or email,
        "score": score,
        "verified": result in {"deliverable", "valid"} and email.endswith(f"@{domain}"),
    }


def _hunter_get(path: str, params: dict[str, Any], operation: str) -> dict[str, Any]:
    api_key = get_settings().hunter_api_key
    if not api_key:
        raise HunterConfigurationError("Hunter is not connected yet. Add HUNTER_API_KEY to the backend environment and redeploy.")

    query = {key: value for key, value in params.items() if value not in {None, ""}}
    query["api_key"] = api_key
    last_error: Exception | None = None
    started = time.monotonic()
    for attempt in range(1, 3):
        try:
            with httpx.Client(timeout=httpx.Timeout(5.0, connect=2.0)) as client:
                response = client.get(f"{HUNTER_BASE_URL}{path}", params=query)
                response.raise_for_status()
                data = response.json()
                logger.info(
                    "%s succeeded attempt=%s status=%s duration_ms=%s result=%s",
                    operation,
                    attempt,
                    response.status_code,
                    _duration_ms(started),
                    _safe_hunter_result_summary(data),
                )
                return data
        except httpx.TimeoutException as exc:
            last_error = exc
            logger.warning("%s timeout attempt=%s duration_ms=%s", operation, attempt, _duration_ms(started))
            capture_provider_exception(exc, provider="hunter", endpoint=operation, extra={"attempt": attempt, "duration_ms": _duration_ms(started)})
        except httpx.HTTPStatusError as exc:
            status = exc.response.status_code
            detail = _safe_response_detail(exc.response)
            logger.warning("%s failed status=%s attempt=%s duration_ms=%s response=%s", operation, status, attempt, _duration_ms(started), detail)
            capture_provider_exception(exc, provider="hunter", endpoint=operation, extra={"attempt": attempt, "status": status, "duration_ms": _duration_ms(started), "detail": detail[:1000]})
            if status in {401, 403}:
                raise HunterRequestError(f"Hunter rejected the backend API key or account access. Hunter status={status}. Detail: {detail}") from exc
            if status == 429 or 500 <= status < 600:
                last_error = exc
            else:
                raise HunterRequestError(f"Hunter could not complete the request. Hunter status={status}. Detail: {detail}") from exc
        except (httpx.HTTPError, ValueError) as exc:
            last_error = exc
            logger.warning("%s request_error attempt=%s duration_ms=%s", operation, attempt, _duration_ms(started))
            capture_provider_exception(exc, provider="hunter", endpoint=operation, extra={"attempt": attempt, "duration_ms": _duration_ms(started)})
        if attempt < 2:
            time.sleep(0.35 * attempt)
    raise HunterRequestError(f"Hunter is temporarily unavailable after retries. Apollo leads were saved without verified Hunter emails. Last error: {last_error}") from last_error


def _is_decision_maker(candidate: dict[str, Any]) -> bool:
    title = str(candidate.get("position") or candidate.get("title") or "").lower()
    return any(role.lower() in title for role in DECISION_MAKER_TITLES)


def _candidate_score(candidate: dict[str, Any]) -> tuple[int, int]:
    title = str(candidate.get("position") or candidate.get("title") or "").lower()
    role_score = len(DECISION_MAKER_TITLES)
    for index, role in enumerate(DECISION_MAKER_TITLES):
        if role.lower() in title:
            role_score = len(DECISION_MAKER_TITLES) - index
            break
    try:
        confidence = int(candidate.get("score") or candidate.get("confidence") or 0)
    except (TypeError, ValueError):
        confidence = 0
    return role_score, confidence


def _with_hunter_metadata(lead: LeadOut, updates: dict[str, Any]) -> LeadOut:
    source = str(updates.get("source") or lead.source or "apollo")
    return lead.model_copy(
        update={
            "hunter_verified": bool(updates.get("hunter_verified")),
            "hunter_status": str(updates.get("hunter_status") or "") or None,
            "source": source,
            "notes": _merge_metadata_notes(lead, updates),
        }
    )


def _merge_metadata_notes(lead: LeadOut, updates: dict[str, Any]) -> str:
    current = _lead_metadata(lead)
    merged = {**current, **{key: value for key, value in updates.items() if value not in {None, ""}}}
    return json.dumps(merged, sort_keys=True)


def _lead_metadata(lead: LeadOut) -> dict[str, Any]:
    notes = lead.notes or ""
    candidate = notes.splitlines()[0] if isinstance(notes, str) and notes else notes
    try:
        parsed = json.loads(candidate)
        return parsed if isinstance(parsed, dict) else {}
    except (TypeError, ValueError):
        return {}


def _source_after_enrichment(lead: LeadOut, *, verified: bool) -> str:
    if verified:
        return "hunter"
    return lead.source or "apollo"


def _lead_domain(lead: LeadOut) -> str:
    for value in [lead.domain, lead.website, lead.email]:
        domain = _domain(str(value or ""))
        if domain:
            return domain
    return ""


def _domain(value: str) -> str:
    if not value:
        return ""
    if "@" in value:
        value = value.rsplit("@", 1)[-1]
    raw = value.strip().split()[0]
    if raw and not raw.startswith(("http://", "https://")):
        raw = f"https://{raw}"
    parsed = urlparse(raw)
    return parsed.netloc.replace("www.", "") if parsed.netloc else value.replace("www.", "").strip("/")


def _clean_email(value: str) -> str:
    match = re.search(r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}", value)
    return match.group(0).lower() if match else ""


def _duration_ms(started: float) -> int:
    return int((time.monotonic() - started) * 1000)


def _safe_response_detail(response: httpx.Response) -> str:
    try:
        data = response.json()
        errors = data.get("errors")
        if isinstance(errors, list) and errors:
            first = errors[0]
            if isinstance(first, dict) and first.get("details"):
                return str(first.get("details"))
        message = data.get("message") or data.get("error") or data.get("detail")
        if message:
            return str(message)
        return f"HTTP {response.status_code}"
    except ValueError:
        pass
    return (response.text or f"HTTP {response.status_code}")[:4000]


def _safe_hunter_result_summary(data: dict[str, Any]) -> dict[str, Any]:
    payload = data.get("data") if isinstance(data, dict) else None
    if not isinstance(payload, dict):
        return {"has_data": bool(payload)}
    if isinstance(payload.get("emails"), list):
        return {"emails": len(payload.get("emails") or []), "has_domain": bool(payload.get("domain"))}
    return {
        "has_data": True,
        "status": payload.get("status") or payload.get("result"),
        "score": payload.get("score"),
    }


def _preview(value: Any) -> str:
    try:
        return json.dumps(value, sort_keys=True, ensure_ascii=False)[:4000]
    except TypeError:
        return str(value)[:4000]
