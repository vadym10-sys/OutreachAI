from __future__ import annotations

import logging
import re
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any
from urllib.parse import urlparse

import httpx

from app.core.config import get_settings
from app.core.observability import capture_provider_exception

logger = logging.getLogger("outreachai.deep_contact_search")

APOLLO_BASE_URL = "https://api.apollo.io/api/v1"
HUNTER_BASE_URL = "https://api.hunter.io/v2"
BUILTWITH_BASE_URL = "https://api.builtwith.com/v21/api.json"
DEEP_CONTACT_CACHE_TTL_HOURS = 24
DECISION_MAKER_TITLES = (
    "Founder",
    "CEO",
    "Owner",
    "Head of Sales",
    "Sales Director",
    "CRO",
    "CMO",
    "Head of Marketing",
    "CTO",
)


class DeepContactSearchError(RuntimeError):
    pass


@dataclass
class DeepContactCandidate:
    name: str = ""
    title: str = ""
    linkedin: str = ""
    email: str = ""
    source: str = ""
    confidence: int = 0
    verification_status: str = "unknown"
    apollo_contact_id: str = ""
    reason: str = ""


@dataclass
class DeepContactSearchResult:
    status: str = "partial_success"
    cached: bool = False
    company_profile: dict[str, Any] = field(default_factory=dict)
    candidates: list[DeepContactCandidate] = field(default_factory=list)
    selected_decision_maker: DeepContactCandidate | None = None
    verified_email: str = ""
    email_status: str = "not_found"
    confidence_score: int = 0
    lead_score: int = 0
    technologies: list[str] = field(default_factory=list)
    sources: list[str] = field(default_factory=list)
    errors: list[dict[str, str]] = field(default_factory=list)
    stages: dict[str, str] = field(default_factory=dict)
    last_enriched_at: str = ""

    def to_metadata(self) -> dict[str, Any]:
        selected = self.selected_decision_maker
        return {
            "deep_contact_search": {
                "status": self.status,
                "cached": self.cached,
                "company_profile": self.company_profile,
                "candidates": [candidate.__dict__ for candidate in self.candidates],
                "selected_decision_maker": selected.__dict__ if selected else None,
                "verified_email": self.verified_email,
                "email_status": self.email_status,
                "confidence_score": self.confidence_score,
                "lead_score": self.lead_score,
                "technologies": self.technologies,
                "sources": self.sources,
                "errors": self.errors,
                "stages": self.stages,
                "last_enriched_at": self.last_enriched_at,
            }
        }


def deep_contact_cache_is_fresh(metadata: dict[str, Any]) -> bool:
    payload = metadata.get("deep_contact_search") if isinstance(metadata.get("deep_contact_search"), dict) else {}
    last_value = str(payload.get("last_enriched_at") or "")
    if not last_value:
        return False
    try:
        last = datetime.fromisoformat(last_value.replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
        return False
    return datetime.utcnow() - last < timedelta(hours=DEEP_CONTACT_CACHE_TTL_HOURS)


def deep_contact_result_from_cache(metadata: dict[str, Any]) -> DeepContactSearchResult | None:
    payload = metadata.get("deep_contact_search") if isinstance(metadata.get("deep_contact_search"), dict) else None
    if not payload or not deep_contact_cache_is_fresh(metadata):
        return None
    candidates = [_candidate_from_dict(item) for item in payload.get("candidates", []) if isinstance(item, dict)]
    selected_payload = payload.get("selected_decision_maker") if isinstance(payload.get("selected_decision_maker"), dict) else None
    return DeepContactSearchResult(
        status=str(payload.get("status") or "partial_success"),
        cached=True,
        company_profile=payload.get("company_profile") if isinstance(payload.get("company_profile"), dict) else {},
        candidates=candidates,
        selected_decision_maker=_candidate_from_dict(selected_payload) if selected_payload else None,
        verified_email=str(payload.get("verified_email") or ""),
        email_status=str(payload.get("email_status") or "not_found"),
        confidence_score=_safe_int(payload.get("confidence_score")),
        lead_score=_safe_int(payload.get("lead_score")),
        technologies=[str(item) for item in payload.get("technologies", []) if item],
        sources=[str(item) for item in payload.get("sources", []) if item],
        errors=[item for item in payload.get("errors", []) if isinstance(item, dict)],
        stages=payload.get("stages") if isinstance(payload.get("stages"), dict) else {},
        last_enriched_at=str(payload.get("last_enriched_at") or ""),
    )


def run_deep_contact_search(
    *,
    domain: str,
    company_name: str,
    industry: str = "",
    product_context: str = "",
    existing_metadata: dict[str, Any] | None = None,
    force: bool = False,
) -> DeepContactSearchResult:
    normalized_domain = normalize_domain(domain)
    if not normalized_domain:
        raise DeepContactSearchError("Add a company website before running deep contact search.")

    metadata = existing_metadata or {}
    if not force:
        cached = deep_contact_result_from_cache(metadata)
        if cached:
            cached.stages = {**cached.stages, "cache": "completed"}
            return cached

    result = DeepContactSearchResult(last_enriched_at=datetime.utcnow().isoformat())
    started = time.monotonic()
    logger.info("deep_contact_search.started domain=%s company=%s", normalized_domain, company_name[:120])

    profile: dict[str, Any] = {}
    people: list[DeepContactCandidate] = []
    if get_settings().apollo_api_key:
        result.stages["apollo_company_profile"] = "running"
        try:
            profile = _apollo_company_profile(normalized_domain)
            result.company_profile = profile
            result.sources.append("apollo_company")
            result.stages["apollo_company_profile"] = "completed" if profile else "empty"
        except Exception as exc:
            _record_error(result, "apollo_company_profile", exc)
        result.stages["apollo_people_search"] = "running"
        try:
            people = _apollo_people_search(normalized_domain)
            result.sources.append("apollo_people")
            result.stages["apollo_people_search"] = "completed" if people else "empty"
        except Exception as exc:
            _record_error(result, "apollo_people_search", exc)
    else:
        result.stages["apollo_company_profile"] = "missing_key"
        result.stages["apollo_people_search"] = "missing_key"
        result.errors.append({"stage": "apollo", "message": "Apollo is not connected."})

    if not people:
        result.stages["hunter_domain_search"] = "running"
        try:
            people = _hunter_domain_search(normalized_domain)
            result.sources.append("hunter_domain")
            result.stages["hunter_domain_search"] = "completed" if people else "empty"
        except Exception as exc:
            _record_error(result, "hunter_domain_search", exc)

    result.candidates = _dedupe_candidates(people)[:10]
    selected = select_best_decision_maker(
        result.candidates,
        company_profile=profile,
        industry=industry,
        product_context=product_context,
    )
    result.selected_decision_maker = selected

    if selected:
        result.stages["email_finder"] = "running"
        selected = _find_and_verify_email(selected, normalized_domain, company_name, result)
        result.selected_decision_maker = selected
        result.verified_email = selected.email if selected.verification_status == "verified" else ""
        result.email_status = selected.verification_status
        result.stages["email_finder"] = "completed" if result.verified_email else "partial"
    else:
        result.stages["email_finder"] = "empty"

    result.stages["technographics"] = "running"
    try:
        result.technologies = _builtwith_technologies(normalized_domain)
        if result.technologies:
            result.sources.append("builtwith")
        result.stages["technographics"] = "completed" if result.technologies else "empty"
    except Exception as exc:
        _record_error(result, "technographics", exc)

    result.confidence_score = _confidence_score(result)
    result.lead_score = _lead_score(result)
    result.status = "success" if result.verified_email and result.selected_decision_maker else "partial_success"
    if not result.verified_email:
        result.errors.append({"stage": "verified_email", "message": "No verified business email was found."})

    logger.info(
        "deep_contact_search.finished domain=%s status=%s candidates=%s verified=%s duration_ms=%s",
        normalized_domain,
        result.status,
        len(result.candidates),
        bool(result.verified_email),
        int((time.monotonic() - started) * 1000),
    )
    return result


def select_best_decision_maker(
    candidates: list[DeepContactCandidate],
    *,
    company_profile: dict[str, Any] | None = None,
    industry: str = "",
    product_context: str = "",
) -> DeepContactCandidate | None:
    if not candidates:
        return None
    scored = sorted(
        candidates,
        key=lambda candidate: (
            _role_score(candidate.title),
            candidate.confidence,
            1 if candidate.email else 0,
            1 if candidate.linkedin else 0,
        ),
        reverse=True,
    )
    best = scored[0]
    best.reason = _selection_reason(best, industry=industry, product_context=product_context, profile=company_profile or {})
    return best


def normalize_domain(value: str) -> str:
    raw = (value or "").strip().lower()
    if not raw:
        return ""
    if "@" in raw:
        email = _clean_email(raw)
        raw = email.rsplit("@", 1)[-1] if email else raw.rsplit("@", 1)[-1]
    raw = raw.strip("<>()[]{}.,;: ")
    if not raw.startswith(("http://", "https://")):
        raw = f"https://{raw}"
    parsed = urlparse(raw)
    host = parsed.netloc or parsed.path
    host = host.replace("www.", "").strip("/ <>()[]{}.,;: ")
    return host if "." in host and " " not in host else ""


def _apollo_company_profile(domain: str) -> dict[str, Any]:
    payload = _apollo_post("/organizations/enrich", {"domain": domain}, "apollo.deep_company_enrich")
    organization = payload.get("organization") if isinstance(payload.get("organization"), dict) else payload
    if not isinstance(organization, dict):
        return {}
    return {
        "name": organization.get("name") or "",
        "website": organization.get("website_url") or organization.get("website") or f"https://{domain}",
        "domain": organization.get("primary_domain") or organization.get("domain") or domain,
        "industry": organization.get("industry") or "",
        "employee_count": organization.get("estimated_num_employees") or organization.get("num_employees"),
        "linkedin": organization.get("linkedin_url") or "",
        "source": "apollo",
        "apollo_company_id": organization.get("id") or organization.get("organization_id") or "",
    }


def _apollo_people_search(domain: str) -> list[DeepContactCandidate]:
    body = {
        "q_organization_domains": domain,
        "person_titles": list(DECISION_MAKER_TITLES),
        "page": 1,
        "per_page": 10,
    }
    payload = _apollo_post("/mixed_people/search", body, "apollo.deep_people_search")
    records = payload.get("people") or payload.get("contacts") or []
    if not isinstance(records, list):
        return []
    candidates = []
    for item in records:
        if not isinstance(item, dict):
            continue
        name = " ".join(str(part).strip() for part in [item.get("first_name"), item.get("last_name")] if part).strip()
        email = _clean_email(str(item.get("email") or ""))
        candidates.append(
            DeepContactCandidate(
                name=name or str(item.get("name") or ""),
                title=str(item.get("title") or ""),
                linkedin=str(item.get("linkedin_url") or ""),
                email=email,
                source="apollo",
                confidence=_safe_int(item.get("email_confidence") or item.get("confidence") or item.get("score")),
                verification_status="found" if email else "unknown",
                apollo_contact_id=str(item.get("id") or ""),
            )
        )
    return [candidate for candidate in candidates if candidate.name or candidate.title or candidate.email]


def _hunter_domain_search(domain: str) -> list[DeepContactCandidate]:
    api_key = get_settings().hunter_api_key
    if not api_key:
        raise DeepContactSearchError("Hunter is not connected.")
    payload = _http_get_json(
        f"{HUNTER_BASE_URL}/domain-search",
        {"domain": domain, "type": "personal", "limit": "10", "api_key": api_key},
        "hunter.deep_domain_search",
    )
    data = payload.get("data") if isinstance(payload.get("data"), dict) else {}
    emails = data.get("emails") if isinstance(data.get("emails"), list) else []
    candidates = []
    for item in emails:
        if not isinstance(item, dict):
            continue
        title = str(item.get("position") or item.get("title") or "")
        if _role_score(title) <= 1:
            continue
        candidates.append(
            DeepContactCandidate(
                name=str(item.get("first_name") or item.get("last_name") or item.get("name") or "").strip(),
                title=title,
                linkedin=str(item.get("linkedin") or ""),
                email=_clean_email(str(item.get("value") or item.get("email") or "")),
                source="hunter",
                confidence=_safe_int(item.get("confidence") or item.get("score")),
                verification_status="found",
            )
        )
    return candidates


def _find_and_verify_email(candidate: DeepContactCandidate, domain: str, company_name: str, result: DeepContactSearchResult) -> DeepContactCandidate:
    email = candidate.email
    if not email and get_settings().hunter_api_key and candidate.name:
        try:
            payload = _http_get_json(
                f"{HUNTER_BASE_URL}/email-finder",
                {
                    "domain": domain,
                    "company": company_name,
                    "full_name": candidate.name,
                    "api_key": get_settings().hunter_api_key,
                },
                "hunter.deep_email_finder",
            )
            data = payload.get("data") if isinstance(payload.get("data"), dict) else {}
            email = _clean_email(str(data.get("email") or data.get("value") or ""))
            candidate.email = email or candidate.email
            candidate.source = candidate.source or "hunter"
            if data.get("score") is not None:
                candidate.confidence = max(candidate.confidence, _safe_int(data.get("score")))
            result.sources.append("hunter_email_finder")
        except Exception as exc:
            _record_error(result, "hunter_email_finder", exc)

    if email and get_settings().hunter_api_key:
        try:
            payload = _http_get_json(
                f"{HUNTER_BASE_URL}/email-verifier",
                {"email": email, "api_key": get_settings().hunter_api_key},
                "hunter.deep_email_verifier",
            )
            data = payload.get("data") if isinstance(payload.get("data"), dict) else {}
            status = str(data.get("result") or data.get("status") or "").lower()
            score = _safe_int(data.get("score") or candidate.confidence)
            candidate.confidence = max(candidate.confidence, score)
            candidate.verification_status = "verified" if status in {"deliverable", "valid"} else "unverified"
            result.sources.append("hunter_email_verifier")
        except Exception as exc:
            candidate.verification_status = "unverified"
            _record_error(result, "hunter_email_verifier", exc)
    elif email:
        candidate.verification_status = "unverified"
    return candidate


def _builtwith_technologies(domain: str) -> list[str]:
    api_key = get_settings().builtwith_api_key
    if not api_key:
        raise DeepContactSearchError("BuiltWith is not connected.")
    payload = _http_get_json(BUILTWITH_BASE_URL, {"KEY": api_key, "LOOKUP": domain}, "builtwith.technographics")
    technologies: list[str] = []
    for result in payload.get("Results", []) if isinstance(payload.get("Results"), list) else []:
        if not isinstance(result, dict):
            continue
        for path in result.get("Result", {}).get("Paths", []) if isinstance(result.get("Result"), dict) else []:
            for tech in path.get("Technologies", []) if isinstance(path, dict) else []:
                name = str(tech.get("Name") or tech.get("Tag") or "").strip()
                if name and name not in technologies:
                    technologies.append(name)
    return technologies[:30]


def _apollo_post(path: str, body: dict[str, Any], operation: str) -> dict[str, Any]:
    api_key = get_settings().apollo_api_key
    if not api_key:
        raise DeepContactSearchError("Apollo is not connected.")
    return _http_post_json(
        f"{APOLLO_BASE_URL}{path}",
        body,
        operation,
        headers={"Cache-Control": "no-cache", "Content-Type": "application/json", "X-Api-Key": api_key},
    )


def _http_post_json(url: str, body: dict[str, Any], operation: str, headers: dict[str, str] | None = None) -> dict[str, Any]:
    last_error: Exception | None = None
    for attempt in range(1, 3):
        try:
            with httpx.Client(timeout=httpx.Timeout(12.0, connect=3.0), headers=headers) as client:
                response = client.post(url, json=body)
                response.raise_for_status()
                return response.json()
        except Exception as exc:
            last_error = exc
            _capture_provider(operation, exc, attempt)
            if not _is_retryable(exc):
                break
            time.sleep(0.4 * attempt)
    raise DeepContactSearchError(_friendly_provider_failure(operation)) from last_error


def _http_get_json(url: str, params: dict[str, Any], operation: str) -> dict[str, Any]:
    last_error: Exception | None = None
    for attempt in range(1, 3):
        try:
            with httpx.Client(timeout=httpx.Timeout(10.0, connect=3.0)) as client:
                response = client.get(url, params=params)
                response.raise_for_status()
                return response.json()
        except Exception as exc:
            last_error = exc
            _capture_provider(operation, exc, attempt)
            if not _is_retryable(exc):
                break
            time.sleep(0.4 * attempt)
    raise DeepContactSearchError(_friendly_provider_failure(operation)) from last_error


def _capture_provider(operation: str, exc: Exception, attempt: int) -> None:
    provider = operation.split(".", 1)[0]
    logger.warning("%s failed attempt=%s reason=%s", operation, attempt, exc.__class__.__name__)
    capture_provider_exception(exc, provider=provider, endpoint=operation, extra={"attempt": attempt})


def _is_retryable(exc: Exception) -> bool:
    if isinstance(exc, (httpx.TimeoutException, httpx.NetworkError)):
        return True
    if isinstance(exc, httpx.HTTPStatusError):
        return exc.response.status_code == 429 or exc.response.status_code >= 500
    return False


def _friendly_provider_failure(operation: str) -> str:
    provider = operation.split(".", 1)[0]
    return f"{provider} could not complete this enrichment step."


def _record_error(result: DeepContactSearchResult, stage: str, exc: Exception) -> None:
    result.stages[stage] = "error"
    result.errors.append({"stage": stage, "message": str(exc)[:220]})
    logger.info("deep_contact_search.stage_failed stage=%s reason=%s", stage, exc.__class__.__name__)


def _dedupe_candidates(candidates: list[DeepContactCandidate]) -> list[DeepContactCandidate]:
    seen: set[str] = set()
    output: list[DeepContactCandidate] = []
    for candidate in candidates:
        key = (candidate.email or candidate.linkedin or f"{candidate.name}:{candidate.title}").lower()
        if not key or key in seen:
            continue
        seen.add(key)
        output.append(candidate)
    return output


def _candidate_from_dict(value: dict[str, Any] | None) -> DeepContactCandidate:
    value = value or {}
    return DeepContactCandidate(
        name=str(value.get("name") or ""),
        title=str(value.get("title") or ""),
        linkedin=str(value.get("linkedin") or ""),
        email=str(value.get("email") or ""),
        source=str(value.get("source") or ""),
        confidence=_safe_int(value.get("confidence")),
        verification_status=str(value.get("verification_status") or "unknown"),
        apollo_contact_id=str(value.get("apollo_contact_id") or ""),
        reason=str(value.get("reason") or ""),
    )


def _role_score(title: str) -> int:
    normalized = (title or "").lower()
    scores = {
        "founder": 100,
        "chief executive": 98,
        "ceo": 98,
        "owner": 94,
        "cro": 92,
        "chief revenue": 92,
        "head of sales": 90,
        "sales director": 86,
        "cmo": 84,
        "head of marketing": 82,
        "cto": 74,
    }
    return max([score for key, score in scores.items() if key in normalized] or [0])


def _selection_reason(candidate: DeepContactCandidate, *, industry: str, product_context: str, profile: dict[str, Any]) -> str:
    if "sales" in candidate.title.lower() or "revenue" in candidate.title.lower():
        return "Owns revenue growth and is likely to care about outbound pipeline quality."
    if "founder" in candidate.title.lower() or "ceo" in candidate.title.lower() or "owner" in candidate.title.lower():
        return "Senior owner who can evaluate new B2B growth channels quickly."
    if "marketing" in candidate.title.lower():
        return "Owns demand generation and can evaluate personalization and campaign quality."
    if "cto" in candidate.title.lower():
        return "Technical leader; useful when the offer depends on automation, data or website infrastructure."
    return "Best available contact based on seniority, role relevance and available verification data."


def _confidence_score(result: DeepContactSearchResult) -> int:
    score = 20
    if result.company_profile:
        score += 15
    if result.candidates:
        score += min(20, len(result.candidates) * 4)
    if result.selected_decision_maker:
        score += 15
    if result.verified_email:
        score += 25
    if result.technologies:
        score += 5
    return min(score, 100)


def _lead_score(result: DeepContactSearchResult) -> int:
    score = result.confidence_score
    selected = result.selected_decision_maker
    if selected:
        score += 8 if _role_score(selected.title) >= 90 else 3
    if result.company_profile.get("employee_count"):
        score += 4
    return min(score, 100)


def _clean_email(value: str) -> str:
    match = re.search(r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}", value or "")
    return match.group(0).lower() if match else ""


def _safe_int(value: Any) -> int:
    try:
        return int(float(str(value).replace("%", "").strip())) if value not in {None, ""} else 0
    except (TypeError, ValueError):
        return 0
