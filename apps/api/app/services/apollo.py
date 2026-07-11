from __future__ import annotations

import logging
import json
import re
import time
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlparse

import httpx

from app.core.config import get_settings
from app.core.observability import capture_provider_exception
from app.schemas.dto import LeadFinderRequest, LeadOut

logger = logging.getLogger("outreachai.apollo")

APOLLO_BASE_URL = "https://api.apollo.io/api/v1"


class ApolloConfigurationError(RuntimeError):
    pass


class ApolloRequestError(RuntimeError):
    pass


@dataclass(frozen=True)
class ApolloSearchResult:
    leads: list[LeadOut]
    raw_count: int
    duration_ms: int


def apollo_key_loaded() -> bool:
    return bool(get_settings().apollo_api_key)


def test_apollo_connection() -> dict[str, Any]:
    started = time.monotonic()
    response = _apollo_post(
        "/mixed_companies/search",
        {"q_organization_keywords": "construction", "page": 1, "per_page": 1},
        operation="apollo.connection_test",
    )
    return {
        "connected": True,
        "duration_ms": _duration_ms(started),
        "records": len(_records(response, "organizations", "companies", "accounts")),
    }


def search_apollo_companies(payload: LeadFinderRequest) -> ApolloSearchResult:
    started = time.monotonic()
    body = _company_search_body(payload)
    logger.info("apollo.company_search request payload=%s", _safe_json(body))
    data = _apollo_post("/mixed_companies/search", body, operation="apollo.company_search")
    records = _records(data, "organizations", "companies", "accounts")
    logger.info(
        "apollo.company_search response raw_count=%s parsed_leads=%s sample=%s",
        len(records),
        len([item for item in records if isinstance(item, dict)]),
        _record_sample(records),
    )
    leads = [_company_to_lead(item, payload) for item in records if isinstance(item, dict)]
    leads = [lead for lead in leads if lead.company]
    return ApolloSearchResult(leads=_dedupe(leads, payload.limit), raw_count=len(records), duration_ms=_duration_ms(started))


def search_apollo_contacts(payload: LeadFinderRequest) -> ApolloSearchResult:
    started = time.monotonic()
    body = _contact_search_body(payload)
    logger.info("apollo.contact_search request payload=%s", _safe_json(body))
    data = _apollo_post("/mixed_people/search", body, operation="apollo.contact_search")
    records = _records(data, "people", "contacts")
    logger.info(
        "apollo.contact_search response raw_count=%s parsed_leads=%s sample=%s",
        len(records),
        len([item for item in records if isinstance(item, dict)]),
        _record_sample(records),
    )
    leads = [_contact_to_lead(item, payload) for item in records if isinstance(item, dict)]
    leads = [lead for lead in leads if lead.company]
    return ApolloSearchResult(leads=_dedupe(leads, payload.limit), raw_count=len(records), duration_ms=_duration_ms(started))


def _apollo_post(path: str, body: dict[str, Any], operation: str) -> dict[str, Any]:
    api_key = get_settings().apollo_api_key
    if not api_key:
        raise ApolloConfigurationError("Apollo is not connected yet. Add APOLLO_API_KEY to the backend environment and redeploy.")

    headers = {
        "Cache-Control": "no-cache",
        "Content-Type": "application/json",
        "X-Api-Key": api_key,
    }
    last_error: Exception | None = None
    started = time.monotonic()
    for attempt in range(1, 3):
        try:
            with httpx.Client(timeout=httpx.Timeout(8.0, connect=3.0), headers=headers) as client:
                response = client.post(f"{APOLLO_BASE_URL}{path}", json=body)
                response.raise_for_status()
                data = response.json()
                logger.info(
                    "%s succeeded attempt=%s status=%s duration_ms=%s records=%s",
                    operation,
                    attempt,
                    response.status_code,
                    _duration_ms(started),
                    sum(len(_records(data, key)) for key in ("organizations", "companies", "accounts", "people", "contacts")),
                )
                return data
        except httpx.TimeoutException as exc:
            last_error = exc
            logger.warning("%s timeout attempt=%s duration_ms=%s", operation, attempt, _duration_ms(started))
            capture_provider_exception(exc, provider="apollo", endpoint=operation, extra={"attempt": attempt, "duration_ms": _duration_ms(started)})
        except httpx.HTTPStatusError as exc:
            status = exc.response.status_code
            detail = _safe_response_detail(exc.response)
            logger.warning(
                "%s failed status=%s attempt=%s duration_ms=%s response=%s",
                operation,
                status,
                attempt,
                _duration_ms(started),
                detail,
            )
            capture_provider_exception(exc, provider="apollo", endpoint=operation, extra={"attempt": attempt, "status": status, "duration_ms": _duration_ms(started), "detail": detail[:1000]})
            if status in {401, 403}:
                raise ApolloRequestError(f"Apollo rejected the backend API key or account access. Apollo status={status}. Detail: {detail}") from exc
            if status == 429:
                last_error = exc
            elif 500 <= status < 600:
                last_error = exc
            else:
                raise ApolloRequestError(f"Apollo could not complete the request. Apollo status={status}. Detail: {detail}") from exc
        except (httpx.HTTPError, ValueError) as exc:
            last_error = exc
            logger.warning("%s request_error attempt=%s duration_ms=%s", operation, attempt, _duration_ms(started))
            capture_provider_exception(exc, provider="apollo", endpoint=operation, extra={"attempt": attempt, "duration_ms": _duration_ms(started)})
        if attempt < 2:
            time.sleep(0.35 * attempt)

    raise ApolloRequestError(f"Apollo is temporarily unavailable after retries. Last error: {last_error}") from last_error


def _company_search_body(payload: LeadFinderRequest) -> dict[str, Any]:
    body: dict[str, Any] = {
        "page": 1,
        "per_page": min(payload.limit, 25),
    }
    keyword_query = " ".join([payload.industry or payload.niche, *payload.keywords]).strip()
    if keyword_query:
        body["q_organization_keywords"] = keyword_query
    locations = [part for part in [payload.city, payload.country] if part]
    if locations:
        body["organization_locations"] = locations
    employee_range = _employee_range(payload.employee_count)
    if employee_range:
        body["organization_num_employees_ranges"] = [employee_range]
    if payload.technologies:
        body["q_organization_technology_names"] = payload.technologies[:10]
    return body


def _contact_search_body(payload: LeadFinderRequest) -> dict[str, Any]:
    body = _company_search_body(payload)
    locations = [part for part in [payload.city, payload.country] if part]
    if locations:
        body["person_locations"] = locations
    return body


def _company_to_lead(item: dict[str, Any], payload: LeadFinderRequest) -> LeadOut:
    domain = _domain(str(item.get("primary_domain") or item.get("domain") or ""))
    website = _clean_url(str(item.get("website_url") or item.get("website") or domain or ""))
    employee_count = _int_value(item.get("estimated_num_employees") or item.get("num_employees"))
    revenue_text = str(item.get("annual_revenue") or item.get("estimated_annual_revenue") or item.get("revenue") or payload.revenue or "")
    metadata = {
        "source": "apollo",
        "domain": domain,
        "employee_count": employee_count,
        "revenue": revenue_text,
        "apollo_company_id": item.get("id") or item.get("organization_id"),
        "confidence": item.get("confidence") or item.get("score"),
        "source_payload": "company_search",
    }
    return LeadOut(
        company=str(item.get("name") or item.get("organization_name") or "").strip(),
        website=website or None,
        industry=str(item.get("industry") or payload.industry or payload.niche or "B2B"),
        country=str(item.get("country") or payload.country or ""),
        city=str(item.get("city") or payload.city or ""),
        contact=None,
        email=None,
        phone=_phone(item) or None,
        linkedin=str(item.get("linkedin_url") or "") or None,
        niche=payload.industry or payload.niche,
        status="New",
        notes=_metadata_notes(metadata),
        revenue=0,
        domain=domain or None,
        employee_count=employee_count,
        revenue_range=revenue_text or None,
        apollo_company_id=str(metadata["apollo_company_id"] or "") or None,
        source="apollo",
    )


def _contact_to_lead(item: dict[str, Any], payload: LeadFinderRequest) -> LeadOut:
    organization = item.get("organization") if isinstance(item.get("organization"), dict) else {}
    company = str(organization.get("name") or item.get("organization_name") or "").strip()
    domain = _domain(str(organization.get("primary_domain") or organization.get("domain") or ""))
    website = _clean_url(str(organization.get("website_url") or organization.get("website") or domain or ""))
    employee_count = _int_value(organization.get("estimated_num_employees") or organization.get("num_employees"))
    contact_name = " ".join(str(part).strip() for part in [item.get("first_name"), item.get("last_name")] if part).strip()
    email = _clean_email(str(item.get("email") or ""))
    metadata = {
        "source": "apollo",
        "domain": domain,
        "employee_count": employee_count,
        "revenue": str(organization.get("annual_revenue") or organization.get("estimated_annual_revenue") or payload.revenue or ""),
        "apollo_company_id": organization.get("id") or item.get("organization_id"),
        "apollo_contact_id": item.get("id"),
        "title": item.get("title"),
        "confidence": item.get("email_confidence") or item.get("confidence") or item.get("score"),
        "source_payload": "contact_search",
    }
    return LeadOut(
        company=company,
        website=website or None,
        industry=str(organization.get("industry") or payload.industry or payload.niche or "B2B"),
        country=str(organization.get("country") or payload.country or ""),
        city=str(organization.get("city") or payload.city or ""),
        contact=contact_name or None,
        email=email or None,
        phone=str(item.get("phone") or organization.get("phone") or "") or None,
        linkedin=str(item.get("linkedin_url") or organization.get("linkedin_url") or "") or None,
        niche=payload.industry or payload.niche,
        status="New",
        notes=_metadata_notes(metadata),
        revenue=0,
        domain=domain or None,
        employee_count=employee_count,
        revenue_range=str(metadata["revenue"] or "") or None,
        apollo_company_id=str(metadata["apollo_company_id"] or "") or None,
        apollo_contact_id=str(metadata["apollo_contact_id"] or "") or None,
        title=str(metadata["title"] or "") or None,
        confidence=str(metadata["confidence"] or "") or None,
        source="apollo",
    )


def _records(data: dict[str, Any], *keys: str) -> list[dict[str, Any]]:
    for key in keys:
        value = data.get(key)
        if isinstance(value, list):
            return value
    return []


def _phone(item: dict[str, Any]) -> str:
    primary_phone = item.get("primary_phone")
    if isinstance(primary_phone, dict) and primary_phone.get("number"):
        return str(primary_phone.get("number"))
    return str(item.get("phone") or "")


def _dedupe(leads: list[LeadOut], limit: int) -> list[LeadOut]:
    seen: set[str] = set()
    deduped: list[LeadOut] = []
    for lead in leads:
        key = (lead.apollo_contact_id or lead.apollo_company_id or lead.email or lead.domain or lead.website or lead.company).lower()
        if not key or key in seen:
            continue
        seen.add(key)
        deduped.append(lead)
        if len(deduped) >= limit:
            break
    return deduped


def _employee_range(value: str | None) -> str:
    if not value:
        return ""
    normalized = value.lower().replace("employees", "").strip()
    if "+" in normalized:
        start = re.sub(r"\D", "", normalized) or "500"
        return f"{start},1000000"
    numbers = re.findall(r"\d+", normalized)
    if len(numbers) >= 2:
        return f"{numbers[0]},{numbers[1]}"
    if len(numbers) == 1:
        return f"{numbers[0]},{numbers[0]}"
    return ""


def _clean_url(value: str) -> str:
    if not value:
        return ""
    raw = value.strip().split()[0]
    if not raw:
        return ""
    if not raw.startswith(("http://", "https://")):
        raw = f"https://{raw}"
    parsed = urlparse(raw)
    return raw if parsed.netloc else ""


def _domain(value: str) -> str:
    if not value:
        return ""
    parsed = urlparse(_clean_url(value))
    return parsed.netloc.replace("www.", "") if parsed.netloc else value.replace("www.", "").strip("/")


def _clean_email(value: str) -> str:
    match = re.search(r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}", value)
    return match.group(0) if match else ""


def _int_value(value: Any) -> int | None:
    try:
        return int(value) if value not in {None, ""} else None
    except (TypeError, ValueError):
        return None


def _metadata_notes(metadata: dict[str, Any]) -> str:
    import json

    return json.dumps({key: value for key, value in metadata.items() if value not in {None, ""}}, sort_keys=True)


def _duration_ms(started: float) -> int:
    return int((time.monotonic() - started) * 1000)


def _safe_response_detail(response: httpx.Response) -> str:
    try:
        data = response.json()
        message = data.get("message") or data.get("error") or data.get("detail")
        if message:
            return str(message)
        return f"HTTP {response.status_code}"
    except ValueError:
        pass
    return (response.text or f"HTTP {response.status_code}")[:4000]


def _safe_json(value: Any) -> str:
    try:
        return json.dumps(value, sort_keys=True, ensure_ascii=False)[:4000]
    except TypeError:
        return str(value)[:4000]


def _preview(value: Any) -> str:
    return _safe_json(value)


def _record_sample(records: list[dict[str, Any]]) -> str:
    sample = []
    for item in records[:3]:
        if not isinstance(item, dict):
            continue
        sample.append(
            {
                "id": item.get("id") or item.get("organization_id"),
                "name": item.get("name") or item.get("organization_name"),
                "domain": item.get("primary_domain") or item.get("domain"),
                "website_url": item.get("website_url") or item.get("website"),
            }
        )
    return _safe_json(sample)
