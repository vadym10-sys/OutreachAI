from __future__ import annotations

import hashlib
import json
import logging
from typing import Any

import httpx

from app.core.config import get_settings
from app.core.observability import capture_provider_exception

logger = logging.getLogger("outreachai.cache")


def cache_enabled() -> bool:
    settings = get_settings()
    return bool(settings.upstash_redis_rest_url and settings.upstash_redis_rest_token)


def cache_key(namespace: str, *parts: Any) -> str:
    raw = json.dumps(parts, sort_keys=True, default=str, separators=(",", ":"))
    digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()
    return f"outreachai:{namespace}:{digest}"


def _request(command: list[Any]) -> Any | None:
    settings = get_settings()
    if not cache_enabled():
        return None
    try:
        response = httpx.post(
            settings.upstash_redis_rest_url.rstrip("/"),
            headers={"Authorization": f"Bearer {settings.upstash_redis_rest_token}"},
            json=command,
            timeout=1.5,
        )
        response.raise_for_status()
        payload = response.json()
        if isinstance(payload, dict) and "error" in payload:
            raise RuntimeError(str(payload["error"]))
        return payload.get("result") if isinstance(payload, dict) else None
    except Exception as exc:
        logger.warning("Redis cache unavailable command=%s", command[0] if command else "unknown")
        capture_provider_exception(exc, provider="redis", endpoint="cache.request", extra={"command": command[0] if command else "unknown"})
        return None


def get_json(key: str) -> Any | None:
    value = _request(["GET", key])
    if not value:
        return None
    try:
        return json.loads(value)
    except Exception as exc:
        capture_provider_exception(exc, provider="redis", endpoint="cache.decode", extra={"cache_key": key})
        return None


def set_json(key: str, value: Any, ttl_seconds: int) -> None:
    if ttl_seconds <= 0:
        return
    serialized = json.dumps(value, default=str, separators=(",", ":"))
    _request(["SET", key, serialized, "EX", int(ttl_seconds)])


def delete_key(key: str) -> None:
    _request(["DEL", key])
