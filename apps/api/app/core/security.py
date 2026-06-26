from __future__ import annotations

import time
from collections import defaultdict, deque
from functools import lru_cache
from typing import Annotated, Optional

from fastapi import Depends, Header, HTTPException, Request, status
import httpx
from jose import JWTError, jwt

from app.core.config import get_settings


class SlidingWindowRateLimiter:
    def __init__(self, limit: int = 120, window_seconds: int = 60) -> None:
        self.limit = limit
        self.window_seconds = window_seconds
        self.hits: dict[str, deque[float]] = defaultdict(deque)

    def check(self, key: str) -> None:
        now = time.monotonic()
        bucket = self.hits[key]
        while bucket and now - bucket[0] > self.window_seconds:
            bucket.popleft()
        if len(bucket) >= self.limit:
            raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Rate limit exceeded")
        bucket.append(now)


limiter = SlidingWindowRateLimiter()


async def rate_limit(request: Request) -> None:
    forwarded = request.headers.get("x-forwarded-for", "")
    key = forwarded.split(",")[0] or request.client.host if request.client else "unknown"
    limiter.check(key)


@lru_cache(maxsize=8)
def _fetch_clerk_jwks(issuer: str) -> dict:
    jwks_url = f"{issuer.rstrip('/')}/.well-known/jwks.json"
    response = httpx.get(jwks_url, timeout=5)
    response.raise_for_status()
    return response.json()


def _unauthorized(detail: str = "Invalid token") -> HTTPException:
    return HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=detail)


def _verify_clerk_token(token: str) -> dict:
    settings = get_settings()
    issuer = settings.clerk_jwt_issuer.rstrip("/")
    audience = settings.jwt_audience.strip()

    try:
        header = jwt.get_unverified_header(token)
    except JWTError as exc:
        raise _unauthorized() from exc

    kid = header.get("kid")
    alg = header.get("alg")
    if not kid or alg != "RS256":
        raise _unauthorized()

    try:
        jwks = _fetch_clerk_jwks(issuer)
    except (httpx.HTTPError, ValueError) as exc:
        raise _unauthorized("Unable to verify token") from exc

    key = next((item for item in jwks.get("keys", []) if item.get("kid") == kid), None)
    if not key:
        _fetch_clerk_jwks.cache_clear()
        try:
            jwks = _fetch_clerk_jwks(issuer)
        except (httpx.HTTPError, ValueError) as exc:
            raise _unauthorized("Unable to verify token") from exc
        key = next((item for item in jwks.get("keys", []) if item.get("kid") == kid), None)
    if not key:
        raise _unauthorized()

    decode_options = {"verify_aud": bool(audience)}
    decode_kwargs = {
        "algorithms": ["RS256"],
        "issuer": issuer,
        "options": decode_options,
    }
    if audience:
        decode_kwargs["audience"] = audience

    try:
        claims = jwt.decode(token, key, **decode_kwargs)
    except JWTError as exc:
        raise _unauthorized() from exc

    if not claims.get("sub"):
        raise _unauthorized()
    return claims


def get_current_user(authorization: Annotated[Optional[str], Header()] = None) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token")

    token = authorization.removeprefix("Bearer ").strip()
    settings = get_settings()

    if settings.app_env == "development" and token == "dev":
        return "dev_user"

    claims = _verify_clerk_token(token)
    return str(claims["sub"])


CurrentUser = Annotated[str, Depends(get_current_user)]
