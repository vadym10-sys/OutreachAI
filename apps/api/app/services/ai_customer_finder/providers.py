from __future__ import annotations

import re
from typing import Protocol

from app.schemas.dto import LeadFinderRequest
from app.services.ai_customer_finder.dedupe import company_dedupe_key
from app.services.ai_customer_finder.schemas import CustomerFinderCriteria, PublicCustomerCandidate
from app.services.google_maps import GoogleMapsConfigurationError, GoogleMapsRequestError, search_google_places


class CustomerSearchProvider(Protocol):
    key: str

    def search(self, criteria: CustomerFinderCriteria, *, max_candidates: int) -> list[PublicCustomerCandidate]:
        ...


class GooglePlacesCustomerSearchProvider:
    key = "google_places"

    def search(self, criteria: CustomerFinderCriteria, *, max_candidates: int) -> list[PublicCustomerCandidate]:
        candidates: list[PublicCustomerCandidate] = []
        seen: set[str] = set()
        limit = max(1, min(25, max_candidates))
        for keyword in _search_keywords(criteria):
            if len(candidates) >= limit:
                break
            payload = LeadFinderRequest(
                industry="",
                category="",
                keyword=keyword,
                country=criteria.target_country,
                city="",
                company_size=criteria.company_size or None,
                keywords=[],
                technologies=[],
                limit=min(20, max(limit - len(candidates), 1)),
            )
            result = search_google_places(payload)
            for lead in result.leads:
                if not lead.website:
                    continue
                key = company_dedupe_key(
                    website=str(lead.website or ""),
                    company_name=lead.company,
                    country=lead.country or criteria.target_country,
                )
                if key in seen:
                    continue
                seen.add(key)
                candidates.append(
                    PublicCustomerCandidate(
                        company_name=lead.company,
                        website=str(lead.website or ""),
                        industry=lead.industry or criteria.target_industry,
                        country=lead.country or criteria.target_country,
                        source_provider=self.key,
                        source_payload={
                            "place_id": lead.place_id,
                            "google_rating": lead.google_rating,
                            "business_category": lead.business_category,
                            "address": lead.address,
                            "search_keyword": keyword,
                        },
                    )
                )
                if len(candidates) >= limit:
                    break
        return candidates


def _search_keywords(criteria: CustomerFinderCriteria) -> list[str]:
    """Build short business-category queries for Google Places.

    Google Places text search performs poorly when buyer role, ICP narrative,
    and timing signals are packed into one query. We use Places to discover real
    companies, then verify timing and fit against the company's public website.
    """
    market = " ".join(
        [
            criteria.target_industry,
            criteria.desired_customers,
            criteria.additional_criteria,
        ]
    ).lower()
    candidates = [
        _business_term(criteria.target_industry),
        *(_saas_terms() if any(token in market for token in ("saas", "software", "crm")) else []),
        *(_agency_terms() if "agency" in market else []),
        *(_recruiting_terms() if any(token in market for token in ("recruit", "hiring", "talent")) else []),
        *(_services_terms() if any(token in market for token in ("service", "consulting", "consultancy")) else []),
        "company",
    ]
    output: list[str] = []
    seen: set[str] = set()
    for candidate in candidates:
        keyword = _bounded_keyword(candidate)
        key = keyword.lower()
        if not keyword or key in seen:
            continue
        seen.add(key)
        output.append(keyword)
        if len(output) >= 6:
            break
    return output or ["company"]


def _business_term(value: str) -> str:
    text = re.sub(r"[^a-zA-Z0-9 &/+.-]+", " ", str(value or "")).strip()
    text = re.sub(r"\s+", " ", text)
    lower = text.lower()
    if not text or lower in {"any", "b2b", "business", "companies", "company"}:
        return ""
    return text


def _saas_terms() -> list[str]:
    return ["software company", "SaaS company", "business software company", "technology company"]


def _agency_terms() -> list[str]:
    return ["marketing agency", "digital agency", "creative agency"]


def _recruiting_terms() -> list[str]:
    return ["recruiting company", "staffing agency", "talent acquisition company"]


def _services_terms() -> list[str]:
    return ["business services company", "consulting company", "professional services company"]


def _bounded_keyword(value: str) -> str:
    return str(value or "").strip()[:160]


def provider_for_key(key: str) -> CustomerSearchProvider:
    normalized = (key or "google_places").strip().lower()
    if normalized in {"google_places", "google_maps", "places"}:
        return GooglePlacesCustomerSearchProvider()
    raise GoogleMapsConfigurationError(f"Unsupported AI Customer Finder provider: {key}")


__all__ = [
    "CustomerSearchProvider",
    "GooglePlacesCustomerSearchProvider",
    "GoogleMapsConfigurationError",
    "GoogleMapsRequestError",
    "provider_for_key",
]
