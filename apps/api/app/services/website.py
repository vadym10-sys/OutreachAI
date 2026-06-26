from __future__ import annotations

import re
from dataclasses import dataclass
from functools import lru_cache
from html import unescape
from urllib.parse import urlparse

import httpx


class WebsiteFetchError(RuntimeError):
    pass


@dataclass(frozen=True)
class WebsiteSnapshot:
    url: str
    title: str
    meta_description: str
    text: str
    technologies: list[str]


@lru_cache(maxsize=256)
def collect_website(url: str) -> WebsiteSnapshot:
    headers = {
        "User-Agent": "OutreachAI/1.0 website analyzer (+https://outreachaiaiai.com)",
        "Accept": "text/html,application/xhtml+xml",
    }
    try:
        with httpx.Client(timeout=12, follow_redirects=True, headers=headers) as client:
            response = client.get(url)
            response.raise_for_status()
    except httpx.HTTPError as exc:
        raise WebsiteFetchError(f"Could not fetch website: {exc}") from exc

    content_type = response.headers.get("content-type", "")
    if "text/html" not in content_type and "application/xhtml+xml" not in content_type:
        raise WebsiteFetchError("Website did not return HTML content.")

    html = response.text[:500_000]
    return WebsiteSnapshot(
        url=str(response.url),
        title=_first_match(r"<title[^>]*>(.*?)</title>", html),
        meta_description=_meta_description(html),
        text=_visible_text(html),
        technologies=_detect_technologies(html, response.headers, str(response.url)),
    )


def _first_match(pattern: str, html: str) -> str:
    match = re.search(pattern, html, flags=re.IGNORECASE | re.DOTALL)
    return _clean(match.group(1)) if match else ""


def _meta_description(html: str) -> str:
    patterns = [
        r'<meta[^>]+name=["\']description["\'][^>]+content=["\']([^"\']+)["\']',
        r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+name=["\']description["\']',
        r'<meta[^>]+property=["\']og:description["\'][^>]+content=["\']([^"\']+)["\']',
    ]
    for pattern in patterns:
        value = _first_match(pattern, html)
        if value:
            return value
    return ""


def _visible_text(html: str) -> str:
    html = re.sub(r"<(script|style|noscript|svg)[^>]*>.*?</\1>", " ", html, flags=re.IGNORECASE | re.DOTALL)
    html = re.sub(r"<!--.*?-->", " ", html, flags=re.DOTALL)
    text = re.sub(r"<[^>]+>", " ", html)
    return _clean(text)[:20000]


def _clean(value: str) -> str:
    return re.sub(r"\s+", " ", unescape(value)).strip()


def _detect_technologies(html: str, headers: httpx.Headers, url: str) -> list[str]:
    haystack = html.lower()
    detected: set[str] = set()
    checks = {
        "WordPress": ["wp-content", "wp-json"],
        "Shopify": ["cdn.shopify.com", "myshopify"],
        "Webflow": ["webflow.js", "webflow.com"],
        "Wix": ["wixstatic.com", "wix.com"],
        "Squarespace": ["squarespace.com", "static1.squarespace.com"],
        "HubSpot": ["hs-scripts.com", "hubspot"],
        "Intercom": ["intercom.io", "intercomcdn.com"],
        "React": ["react-dom", "__next_data__", "vite"],
        "Next.js": ["__next_data__", "/_next/"],
        "Google Analytics": ["googletagmanager.com", "google-analytics.com"],
        "Calendly": ["calendly.com"],
        "Stripe": ["js.stripe.com"],
    }
    for name, needles in checks.items():
        if any(needle in haystack for needle in needles):
            detected.add(name)
    server = headers.get("server")
    if server:
        detected.add(f"Server: {server[:80]}")
    hostname = urlparse(url).hostname or ""
    if hostname:
        detected.add(f"Host: {hostname}")
    return sorted(detected)
