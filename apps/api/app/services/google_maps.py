from __future__ import annotations

import json
import logging
import re
import time
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlparse

import httpx

from app.core.config import get_settings
from app.core.observability import capture_provider_exception
from app.schemas.dto import LeadFinderRequest, LeadOut

logger = logging.getLogger("outreachai.google_maps")

GOOGLE_PLACES_TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText"
GOOGLE_PLACES_FIELD_MASK = ",".join(
    [
        "places.id",
        "places.name",
        "places.displayName",
        "places.formattedAddress",
        "places.nationalPhoneNumber",
        "places.internationalPhoneNumber",
        "places.websiteUri",
        "places.rating",
        "places.primaryType",
        "places.primaryTypeDisplayName",
        "places.types",
        "places.location",
        "places.businessStatus",
        "nextPageToken",
    ]
)


class GoogleMapsConfigurationError(RuntimeError):
    pass


class GoogleMapsRequestError(RuntimeError):
    pass


@dataclass(frozen=True)
class GooglePlacesSearchResult:
    leads: list[LeadOut]
    raw_count: int
    duration_ms: int


def google_maps_key_loaded() -> bool:
    return bool(get_settings().google_maps_api_key)


def search_google_places(payload: LeadFinderRequest) -> GooglePlacesSearchResult:
    started = time.monotonic()
    body = _search_body(payload)
    logger.info("google_maps.place_search request payload=%s", _safe_json(body))
    data = _google_places_post(body, operation="google_maps.place_search")
    records = data.get("places") if isinstance(data.get("places"), list) else []
    logger.info(
        "google_maps.place_search response raw_count=%s parsed_leads=%s sample=%s",
        len(records),
        len([item for item in records if isinstance(item, dict)]),
        _record_sample(records),
    )
    leads = [_place_to_lead(item, payload) for item in records if isinstance(item, dict)]
    leads = [lead for lead in leads if lead.company]
    return GooglePlacesSearchResult(leads=_dedupe(leads, payload.limit), raw_count=len(records), duration_ms=_duration_ms(started))


def _search_body(payload: LeadFinderRequest) -> dict[str, Any]:
    query = _text_query(payload)
    if not query:
        raise GoogleMapsRequestError("Enter a country and either an industry, category, or keyword to search companies with Google Maps.")
    body: dict[str, Any] = {
        "textQuery": query,
        "pageSize": min(payload.limit, 20),
        "includePureServiceAreaBusinesses": True,
    }
    return body


def _text_query(payload: LeadFinderRequest) -> str:
    business_terms = [
        payload.keyword,
        payload.category,
        payload.industry or payload.niche,
        *payload.keywords,
    ]
    cleaned_business_terms = [_clean_term(term) for term in business_terms if _clean_term(term)]
    location = ", ".join([term for term in [_clean_term(payload.city), _clean_term(payload.country)] if term])
    business_query = " ".join(cleaned_business_terms)
    if location and business_query:
        return f"{business_query} in {location}"[:500]
    if location:
        return f"companies in {location}"[:500]
    return business_query[:500]


def _google_places_post(body: dict[str, Any], operation: str) -> dict[str, Any]:
    settings = get_settings()
    api_key = settings.google_maps_api_key
    if not api_key:
        raise GoogleMapsConfigurationError("Google Maps is not connected yet. Add GOOGLE_MAPS_API_KEY to the backend environment and redeploy.")

    app_origin = settings.public_app_url.rstrip("/")
    headers = {
        "Content-Type": "application/json",
        "Origin": app_origin,
        "Referer": f"{app_origin}/",
        "X-Goog-Api-Key": api_key,
        "X-Goog-FieldMask": GOOGLE_PLACES_FIELD_MASK,
    }
    last_error: Exception | None = None
    started = time.monotonic()
    for attempt in range(1, 3):
        try:
            with httpx.Client(timeout=httpx.Timeout(8.0, connect=3.0), headers=headers) as client:
                response = client.post(GOOGLE_PLACES_TEXT_SEARCH_URL, json=body)
                response.raise_for_status()
                data = response.json()
                logger.info(
                    "%s succeeded attempt=%s status=%s duration_ms=%s raw_response_preview=%s",
                    operation,
                    attempt,
                    response.status_code,
                    _duration_ms(started),
                    _preview(data),
                )
                return data
        except httpx.TimeoutException as exc:
            last_error = exc
            logger.warning("%s timeout attempt=%s duration_ms=%s", operation, attempt, _duration_ms(started))
            capture_provider_exception(exc, provider="google_maps", endpoint=operation, extra={"attempt": attempt, "duration_ms": _duration_ms(started)})
        except httpx.HTTPStatusError as exc:
            status = exc.response.status_code
            detail = _safe_response_detail(exc.response)
            logger.warning("%s failed status=%s attempt=%s duration_ms=%s response=%s", operation, status, attempt, _duration_ms(started), detail)
            capture_provider_exception(exc, provider="google_maps", endpoint=operation, extra={"attempt": attempt, "status": status, "duration_ms": _duration_ms(started), "detail": detail[:1000]})
            if status in {401, 403}:
                raise GoogleMapsRequestError(f"Google Maps rejected the backend API key or Places API access. Google status={status}. Detail: {detail}") from exc
            if status == 429:
                last_error = exc
            elif 500 <= status < 600:
                last_error = exc
            else:
                raise GoogleMapsRequestError(f"Google Maps could not complete the request. Google status={status}. Detail: {detail}") from exc
        except (httpx.HTTPError, ValueError) as exc:
            last_error = exc
            logger.warning("%s request_error attempt=%s duration_ms=%s", operation, attempt, _duration_ms(started))
            capture_provider_exception(exc, provider="google_maps", endpoint=operation, extra={"attempt": attempt, "duration_ms": _duration_ms(started)})
        if attempt < 2:
            time.sleep(0.35 * attempt)

    raise GoogleMapsRequestError(f"Google Maps is temporarily unavailable after retries. Last error: {last_error}") from last_error


def _place_to_lead(item: dict[str, Any], payload: LeadFinderRequest) -> LeadOut:
    display = item.get("displayName") if isinstance(item.get("displayName"), dict) else {}
    category_display = item.get("primaryTypeDisplayName") if isinstance(item.get("primaryTypeDisplayName"), dict) else {}
    name = str(display.get("text") or item.get("name") or "").strip()
    place_id = str(item.get("id") or item.get("name") or "").replace("places/", "").strip()
    website = _clean_url(str(item.get("websiteUri") or ""))
    phone = str(item.get("nationalPhoneNumber") or item.get("internationalPhoneNumber") or "").strip()
    location = item.get("location") if isinstance(item.get("location"), dict) else {}
    latitude = _float_value(location.get("latitude"))
    longitude = _float_value(location.get("longitude"))
    category = str(category_display.get("text") or item.get("primaryType") or "").strip()
    if not category:
        types = item.get("types") if isinstance(item.get("types"), list) else []
        category = str(types[0]).replace("_", " ").title() if types else payload.category or payload.industry or payload.niche or "Business"
    rating = _float_value(item.get("rating"))
    address = str(item.get("formattedAddress") or "").strip()
    metadata = {
        "source": "google_maps",
        "source_payload": "places_text_search",
        "domain": _domain(website),
        "address": address,
        "google_rating": rating,
        "business_category": category,
        "place_id": place_id,
        "latitude": latitude,
        "longitude": longitude,
        "google_business_status": item.get("businessStatus"),
        "google_types": item.get("types") if isinstance(item.get("types"), list) else [],
        "radius": payload.radius,
        "requested_company_size": payload.company_size or payload.employee_count,
    }
    return LeadOut(
        company=name,
        website=website or None,
        industry=payload.industry or payload.niche or category,
        country=payload.country,
        city=payload.city,
        contact=None,
        email=None,
        phone=phone or None,
        linkedin=None,
        niche=payload.industry or payload.niche or category,
        status="New",
        notes=_metadata_notes(metadata),
        revenue=0,
        domain=str(metadata["domain"] or "") or None,
        source="google_maps",
        address=address or None,
        google_rating=rating,
        business_category=category or None,
        place_id=place_id or None,
        latitude=latitude,
        longitude=longitude,
    )


def _dedupe(leads: list[LeadOut], limit: int) -> list[LeadOut]:
    seen: set[str] = set()
    deduped: list[LeadOut] = []
    for lead in leads:
        key = (lead.place_id or lead.domain or lead.website or lead.phone or lead.company).lower()
        if not key or key in seen:
            continue
        seen.add(key)
        deduped.append(lead)
        if len(deduped) >= limit:
            break
    return deduped


def _clean_term(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip())


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


def _float_value(value: Any) -> float | None:
    try:
        return float(value) if value not in {None, ""} else None
    except (TypeError, ValueError):
        return None


def _metadata_notes(metadata: dict[str, Any]) -> str:
    clean = {key: value for key, value in metadata.items() if value not in (None, "", [], {})}
    return json.dumps(clean, sort_keys=True)


def _duration_ms(started: float) -> int:
    return int((time.monotonic() - started) * 1000)


def _safe_response_detail(response: httpx.Response) -> str:
    try:
        data = response.json()
        error = data.get("error")
        if isinstance(error, dict):
            message = error.get("message") or error.get("status")
            if message:
                return str(message)
        message = data.get("message") or data.get("detail")
        if message:
            return str(message)
        return _preview(data)
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


def _record_sample(records: list[Any]) -> str:
    sample = []
    for item in records[:3]:
        if not isinstance(item, dict):
            continue
        display = item.get("displayName") if isinstance(item.get("displayName"), dict) else {}
        sample.append(
            {
                "id": item.get("id"),
                "name": display.get("text"),
                "address": item.get("formattedAddress"),
                "website": item.get("websiteUri"),
            }
        )
    return _safe_json(sample)
