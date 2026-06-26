from __future__ import annotations

import re
from urllib.parse import urlparse

import httpx

from app.schemas.dto import LeadFinderRequest, LeadOut


class LeadSourceConfigurationError(RuntimeError):
    pass


class LeadSourceRequestError(RuntimeError):
    pass


def find_leads(payload: LeadFinderRequest) -> list[LeadOut]:
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
