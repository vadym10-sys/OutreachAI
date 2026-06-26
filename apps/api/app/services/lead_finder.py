from __future__ import annotations

import re
from urllib.parse import urlparse

import httpx

from app.core.config import get_settings
from app.schemas.dto import LeadFinderRequest, LeadOut


class LeadSourceConfigurationError(RuntimeError):
    pass


class LeadSourceRequestError(RuntimeError):
    pass


def find_leads(payload: LeadFinderRequest) -> list[LeadOut]:
    settings = get_settings()
    provider_results: list[LeadOut] = []
    provider_errors: list[str] = []
    if settings.apollo_api_key:
        try:
            provider_results.extend(_apollo_people_search(payload, settings.apollo_api_key))
        except LeadSourceRequestError as exc:
            provider_errors.append(str(exc))
    if settings.clay_api_key:
        try:
            provider_results.extend(_clay_company_search(payload, settings.clay_api_key, settings.clay_workspace_id))
        except LeadSourceRequestError as exc:
            provider_errors.append(str(exc))
    deduped = _dedupe(provider_results, payload.limit)
    if deduped:
        return deduped
    if provider_errors and (settings.apollo_api_key or settings.clay_api_key):
        raise LeadSourceRequestError("; ".join(provider_errors))

    query = _query(payload)
    headers = {"User-Agent": "OutreachAI/1.0 lead discovery (+https://outreachaiaiai.com)"}
    try:
        with httpx.Client(timeout=18, headers=headers, follow_redirects=True) as client:
            response = client.get(
                "https://nominatim.openstreetmap.org/search",
                params={
                    "q": query,
                    "format": "jsonv2",
                    "addressdetails": 1,
                    "extratags": 1,
                    "namedetails": 1,
                    "limit": payload.limit,
                },
            )
            response.raise_for_status()
    except httpx.HTTPError as exc:
        raise LeadSourceRequestError(f"Lead discovery provider request failed: {exc}") from exc

    leads: list[LeadOut] = []
    seen: set[str] = set()
    for item in response.json():
        if not isinstance(item, dict):
            continue
        lead = _lead_from_place(item, payload)
        key = (lead.website or lead.company).lower()
        if not key or key in seen:
            continue
        seen.add(key)
        leads.append(lead)
    return leads


def _apollo_people_search(payload: LeadFinderRequest, api_key: str) -> list[LeadOut]:
    body: dict[str, object] = {
        "q_organization_keywords": " ".join([payload.industry or payload.niche, *payload.keywords]).strip(),
        "person_locations": [part for part in [payload.city, payload.country] if part],
        "page": 1,
        "per_page": min(payload.limit, 25),
    }
    if payload.employee_count:
        body["organization_num_employees_ranges"] = [payload.employee_count]
    try:
        with httpx.Client(timeout=25, headers={"Cache-Control": "no-cache", "Content-Type": "application/json", "X-Api-Key": api_key}) as client:
            response = client.post("https://api.apollo.io/v1/mixed_people/search", json=body)
            response.raise_for_status()
    except httpx.HTTPError as exc:
        raise LeadSourceRequestError(f"Apollo lead discovery failed: {exc}") from exc

    data = response.json()
    people = data.get("people") or data.get("contacts") or []
    leads: list[LeadOut] = []
    for item in people:
        if not isinstance(item, dict):
            continue
        org = item.get("organization") if isinstance(item.get("organization"), dict) else {}
        company = str(org.get("name") or item.get("organization_name") or "").strip()
        email = _clean_email(str(item.get("email") or ""))
        if not company or not email:
            continue
        lead = LeadOut(
            company=company,
            website=_clean_url(str(org.get("website_url") or org.get("primary_domain") or "")) or None,
            industry=str(org.get("industry") or payload.industry or payload.niche or "B2B"),
            country=payload.country,
            city=payload.city,
            contact=" ".join(part for part in [item.get("first_name"), item.get("last_name")] if part) or None,
            email=email,
            phone=str(item.get("phone") or org.get("phone") or "") or None,
            linkedin=str(item.get("linkedin_url") or org.get("linkedin_url") or "") or None,
            niche=payload.industry or payload.niche,
            status="New",
            notes=str(
                {
                    "source": "Apollo",
                    "title": item.get("title"),
                    "employee_count_filter": payload.employee_count,
                    "revenue_filter": payload.revenue,
                    "technology_filters": payload.technologies,
                    "keywords": payload.keywords,
                }
            ),
        )
        leads.append(lead)
    return leads


def _clay_company_search(payload: LeadFinderRequest, api_key: str, workspace_id: str) -> list[LeadOut]:
    query = {
        "country": payload.country,
        "city": payload.city,
        "industry": payload.industry or payload.niche,
        "keywords": payload.keywords,
        "employee_count": payload.employee_count,
        "revenue": payload.revenue,
        "technologies": payload.technologies,
        "limit": min(payload.limit, 25),
    }
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    if workspace_id:
        headers["X-Clay-Workspace-Id"] = workspace_id
    try:
        with httpx.Client(timeout=30, headers=headers) as client:
            response = client.post("https://api.clay.com/v1/prospects/search", json=query)
            response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code in {404, 405}:
            return []
        raise LeadSourceRequestError(f"Clay lead discovery failed: {exc}") from exc
    except httpx.HTTPError as exc:
        raise LeadSourceRequestError(f"Clay lead discovery failed: {exc}") from exc

    data = response.json()
    records = data.get("data") or data.get("prospects") or data.get("results") or []
    leads: list[LeadOut] = []
    for item in records:
        if not isinstance(item, dict):
            continue
        company = str(item.get("company") or item.get("company_name") or item.get("name") or "").strip()
        email = _clean_email(str(item.get("email") or item.get("work_email") or ""))
        if not company:
            continue
        leads.append(
            LeadOut(
                company=company,
                website=_clean_url(str(item.get("website") or item.get("domain") or "")) or None,
                industry=str(item.get("industry") or payload.industry or payload.niche or "B2B"),
                country=str(item.get("country") or payload.country),
                city=str(item.get("city") or payload.city),
                contact=str(item.get("contact") or item.get("full_name") or "") or None,
                email=email or None,
                phone=str(item.get("phone") or "") or None,
                linkedin=str(item.get("linkedin") or item.get("linkedin_url") or "") or None,
                niche=payload.industry or payload.niche,
                status="New",
                notes=str({"source": "Clay", "keywords": payload.keywords, "technologies": payload.technologies}),
                revenue=float(item.get("estimated_revenue") or 0),
            )
        )
    return leads


def _dedupe(leads: list[LeadOut], limit: int) -> list[LeadOut]:
    seen: set[str] = set()
    deduped: list[LeadOut] = []
    for lead in leads:
        key = (str(lead.email or lead.website or lead.company)).lower()
        if not key or key in seen:
            continue
        seen.add(key)
        deduped.append(lead)
        if len(deduped) >= limit:
            break
    return deduped


def _query(payload: LeadFinderRequest) -> str:
    parts = [
        payload.industry or payload.niche,
        *payload.keywords[:3],
        payload.city,
        payload.country,
    ]
    return " ".join(part for part in parts if part).strip()


def _lead_from_place(item: dict, payload: LeadFinderRequest) -> LeadOut:
    address = item.get("address") if isinstance(item.get("address"), dict) else {}
    extratags = item.get("extratags") if isinstance(item.get("extratags"), dict) else {}
    namedetails = item.get("namedetails") if isinstance(item.get("namedetails"), dict) else {}
    company = (
        str(namedetails.get("name") or item.get("name") or item.get("display_name") or "")
        .split(",", 1)[0]
        .strip()
    )
    website = _clean_url(str(extratags.get("website") or extratags.get("contact:website") or ""))
    phone = str(extratags.get("phone") or extratags.get("contact:phone") or "")
    email = _clean_email(str(extratags.get("email") or extratags.get("contact:email") or ""))
    linkedin = str(extratags.get("linkedin") or extratags.get("contact:linkedin") or "")
    city = str(address.get("city") or address.get("town") or address.get("village") or payload.city or "")
    country = str(address.get("country") or payload.country)
    industry = payload.industry or payload.niche or str(item.get("type") or item.get("class") or "B2B")
    notes = {
        "source": "OpenStreetMap Nominatim",
        "osm_type": item.get("osm_type"),
        "osm_id": item.get("osm_id"),
        "employee_count_filter": payload.employee_count,
        "revenue_filter": payload.revenue,
        "technology_filters": payload.technologies,
        "keywords": payload.keywords,
        "display_name": item.get("display_name"),
    }
    return LeadOut(
        company=company or "Unknown company",
        website=website or None,
        industry=industry,
        country=country,
        city=city,
        contact=None,
        email=email or None,
        phone=phone or None,
        linkedin=linkedin or None,
        niche=industry,
        status="New",
        notes=str(notes),
    )


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


def _clean_email(value: str) -> str:
    match = re.search(r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}", value)
    return match.group(0) if match else ""
