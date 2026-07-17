from __future__ import annotations

from typing import Protocol

from app.schemas.dto import LeadFinderRequest
from app.services.ai_customer_finder.schemas import CustomerFinderCriteria, PublicCustomerCandidate
from app.services.google_maps import GoogleMapsConfigurationError, GoogleMapsRequestError, search_google_places


class CustomerSearchProvider(Protocol):
    key: str

    def search(self, criteria: CustomerFinderCriteria, *, max_candidates: int) -> list[PublicCustomerCandidate]:
        ...


class GooglePlacesCustomerSearchProvider:
    key = "google_places"

    def search(self, criteria: CustomerFinderCriteria, *, max_candidates: int) -> list[PublicCustomerCandidate]:
        payload = LeadFinderRequest(
            industry=criteria.target_industry,
            category=criteria.target_industry,
            keyword=" ".join(criteria.keywords[:4]) or criteria.target_industry,
            country=criteria.target_country,
            city="",
            company_size=criteria.company_size or None,
            keywords=criteria.keywords,
            technologies=[],
            limit=max(1, min(25, max_candidates)),
        )
        result = search_google_places(payload)
        candidates: list[PublicCustomerCandidate] = []
        for lead in result.leads:
            if not lead.website:
                continue
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
                    },
                )
            )
        return candidates


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
