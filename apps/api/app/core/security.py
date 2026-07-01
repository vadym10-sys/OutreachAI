from __future__ import annotations

import time
from collections import defaultdict, deque
from dataclasses import dataclass
from functools import lru_cache
from typing import Annotated, Optional

from fastapi import Depends, Header, HTTPException, Request, status
import httpx
from jose import JWTError, jwt

from app.core.config import get_settings

OWNER_EMAIL = "romaniukvadym10@gmail.com"


@dataclass(frozen=True)
class AuthenticatedUser:
    user_id: str
    email: str = ""


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


def get_current_user(
    authorization: Annotated[Optional[str], Header()] = None,
    x_test_user_email: Annotated[Optional[str], Header(alias="X-Test-User-Email")] = None,
) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token")

    token = authorization.removeprefix("Bearer ").strip()
    settings = get_settings()

    if settings.app_env == "development" and token == "dev":
        test_user = (x_test_user_email or "").strip().lower()
        return test_user or "dev_user"

    claims = _verify_clerk_token(token)
    return str(claims["sub"])


CurrentUser = Annotated[str, Depends(get_current_user)]


def _email_from_claims(claims: dict) -> str:
    for key in ("email", "primary_email_address", "email_address"):
        value = claims.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip().lower()
    email_addresses = claims.get("email_addresses")
    if isinstance(email_addresses, list):
        for item in email_addresses:
            if isinstance(item, dict):
                value = item.get("email_address") or item.get("email")
                if isinstance(value, str) and value.strip():
                    return value.strip().lower()
    return ""


@lru_cache(maxsize=256)
def _fetch_clerk_user_email(user_id: str) -> str:
    settings = get_settings()
    if not settings.clerk_secret_key or settings.clerk_secret_key == "dev":
        return ""

    response = httpx.get(
        f"https://api.clerk.com/v1/users/{user_id}",
        headers={"Authorization": f"Bearer {settings.clerk_secret_key}"},
        timeout=5,
    )
    response.raise_for_status()
    payload = response.json()
    primary_id = payload.get("primary_email_address_id")
    email_addresses = payload.get("email_addresses")
    if isinstance(email_addresses, list):
        primary = next((item for item in email_addresses if isinstance(item, dict) and item.get("id") == primary_id), None)
        ordered = [primary] if primary else []
        ordered.extend(item for item in email_addresses if item is not primary)
        for item in ordered:
            if isinstance(item, dict):
                value = item.get("email_address") or item.get("email")
                if isinstance(value, str) and value.strip():
                    return value.strip().lower()
    return ""


def get_current_user_context(
    authorization: Annotated[Optional[str], Header()] = None,
    x_test_user_email: Annotated[Optional[str], Header(alias="X-Test-User-Email")] = None,
) -> AuthenticatedUser:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token")

    token = authorization.removeprefix("Bearer ").strip()
    settings = get_settings()

    if settings.app_env == "development" and token == "dev":
        test_user = (x_test_user_email or "").strip().lower()
        return AuthenticatedUser(user_id=test_user or "dev_user", email=test_user)

    claims = _verify_clerk_token(token)
    user_id = str(claims["sub"])
    email = _email_from_claims(claims)
    if not email:
        try:
            email = _fetch_clerk_user_email(user_id)
        except (httpx.HTTPError, ValueError) as exc:
            raise _unauthorized("Unable to verify owner email") from exc
    return AuthenticatedUser(user_id=user_id, email=email)


CurrentUserContext = Annotated[AuthenticatedUser, Depends(get_current_user_context)]


def is_owner(email: str) -> bool:
    return email.strip().lower() == OWNER_EMAIL


def require_owner(user: CurrentUserContext) -> AuthenticatedUser:
    if not is_owner(user.email):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied.")
    return user


OwnerUser = Annotated[AuthenticatedUser, Depends(require_owner)]
