from __future__ import annotations

import time
from collections import defaultdict, deque
from typing import Annotated, Optional

from fastapi import Depends, Header, HTTPException, Request, status
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


def get_current_user(authorization: Annotated[Optional[str], Header()] = None) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token")

    token = authorization.removeprefix("Bearer ").strip()
    settings = get_settings()

    if settings.app_env == "development" and token == "dev":
        return "dev_user"

    try:
        claims = jwt.get_unverified_claims(token)
        issuer = claims.get("iss")
        if issuer != settings.clerk_jwt_issuer:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token issuer")
        return str(claims["sub"])
    except (JWTError, KeyError) as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token") from exc


CurrentUser = Annotated[str, Depends(get_current_user)]
