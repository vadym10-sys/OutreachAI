from __future__ import annotations

import hashlib
import re
from urllib.parse import urlparse, urlunparse


def canonical_url(value: str) -> str:
    raw = (value or "").strip()
    if not raw:
        return ""
    if "://" not in raw:
        raw = f"https://{raw}"
    parsed = urlparse(raw)
    host = (parsed.hostname or "").lower().removeprefix("www.")
    path = re.sub(r"/+$", "", parsed.path or "")
    return urlunparse(("https", host, path, "", "", ""))


def normalized_domain(value: str) -> str:
    url = canonical_url(value)
    return (urlparse(url).hostname or "").lower().removeprefix("www.")


def normalized_name(value: str) -> str:
    cleaned = re.sub(r"[^a-z0-9]+", " ", (value or "").lower()).strip()
    return re.sub(r"\s+", " ", cleaned)


def company_dedupe_key(*, website: str, company_name: str, country: str) -> str:
    domain = normalized_domain(website)
    if domain:
        return f"domain:{domain}"
    return f"name-country:{normalized_name(company_name)}:{normalized_name(country)}"


def signal_fingerprint(*, source_url: str, signal_type: str, evidence: str, company_name: str) -> str:
    payload = "|".join(
        [
            canonical_url(source_url),
            normalized_name(signal_type),
            normalized_name(company_name),
            normalized_name(evidence)[:500],
        ]
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def content_hash(text: str) -> str:
    return hashlib.sha256((text or "").encode("utf-8")).hexdigest()
