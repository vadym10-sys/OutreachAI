from __future__ import annotations

import re
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
        query = _google_places_query_terms(criteria)
        country, city = _google_places_location(criteria)
        payload = LeadFinderRequest(
            industry=query["industry"],
            category=query["category"],
            keyword=query["keyword"],
            country=country,
            city=city,
            company_size=criteria.company_size or None,
            keywords=query["keywords"],
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


def _google_places_location(criteria: CustomerFinderCriteria) -> tuple[str, str]:
    text = " ".join(
        [
            criteria.target_country,
            criteria.target_industry,
            criteria.desired_customers,
            criteria.product_or_service,
            criteria.additional_criteria,
            *criteria.keywords,
        ]
    ).lower()
    city = ""
    country = "" if criteria.target_country.strip().lower() == "any" else criteria.target_country.strip()
    city_country_hints = [
        (r"\b(warsaw|warszawa)\b|варшав", "Warsaw", "Poland"),
        (r"\b(berlin)\b|берлин", "Berlin", "Germany"),
        (r"\b(munich|münchen)\b|мюнхен", "Munich", "Germany"),
        (r"\b(london)\b|лондон", "London", "United Kingdom"),
        (r"\b(new york)\b|нью[- ]йорк", "New York", "United States"),
    ]
    for pattern, next_city, next_country in city_country_hints:
        if re.search(pattern, text, flags=re.IGNORECASE):
            city = next_city
            country = country or next_country
            break
    country_hints = [
        (r"\b(poland|polska)\b|польш", "Poland"),
        (r"\b(germany|deutschland)\b|германи|немец", "Germany"),
        (r"\b(united states|usa)\b|сша", "United States"),
        (r"\b(united kingdom|uk|britain)\b|британ", "United Kingdom"),
    ]
    if not country:
        for pattern, next_country in country_hints:
            if re.search(pattern, text, flags=re.IGNORECASE):
                country = next_country
                break
    return country or "Any", city


def _google_places_query_terms(criteria: CustomerFinderCriteria) -> dict[str, str | list[str]]:
    explicit_keywords = [keyword.strip() for keyword in criteria.keywords if keyword.strip()]
    phrase_sources = [
        criteria.additional_criteria,
        criteria.product_or_service,
        criteria.desired_customers,
        criteria.target_industry,
    ]
    phrase = next((_clean_customer_search_phrase(source) for source in phrase_sources if _clean_customer_search_phrase(source)), "")
    industry = criteria.target_industry.strip()
    generic_industry = industry.lower() in {"b2b", "any", "companies"}
    category = "" if generic_industry else industry
    keyword = " ".join(explicit_keywords[:4]) or phrase or ("" if generic_industry else industry) or "companies"
    keywords = explicit_keywords if explicit_keywords else ([phrase] if phrase and phrase != keyword else [])
    return {"industry": "" if generic_industry else industry, "category": category, "keyword": keyword[:160], "keywords": [item[:120] for item in keywords[:6]]}


def _clean_customer_search_phrase(value: str) -> str:
    text = re.sub(r"https?://\S+|[\w.-]+\.[a-z]{2,}(?:/\S*)?", " ", str(value or ""), flags=re.IGNORECASE)
    text = re.sub(r"\b(find|search|show|get)\b\s+\d*\s*(companies|customers|clients|leads)?", " ", text, flags=re.IGNORECASE)
    text = re.sub(r"найди\s+\d*\s*(компани[ийяю]|клиент[а-я]*)?", " ", text, flags=re.IGNORECASE)
    text = re.sub(r"\b(in|near|around)\s+(warsaw|warszawa|berlin|munich|münchen|london|new york|poland|germany|usa|uk|united kingdom)\b", " ", text, flags=re.IGNORECASE)
    text = re.sub(r"\b(в|во|около)\s+(варшаве|берлине|мюнхене|лондоне|польше|германии|сша)\b", " ", text, flags=re.IGNORECASE)
    text = re.sub(r"\b(who|that|which)\s+(make|produce|sell|build|offer|do|are)\b", " ", text, flags=re.IGNORECASE)
    text = re.sub(r"\bкто\s+(занимается|производит|продает|продаёт|делает)\b", " ", text, flags=re.IGNORECASE)
    text = re.sub(r"\b(b2b|saas|companies|customers|clients|leads)\b", " ", text, flags=re.IGNORECASE)
    text = re.sub(r"\s+", " ", text).strip(" ,.;:-")
    return text[:160]


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
