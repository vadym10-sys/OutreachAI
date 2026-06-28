from __future__ import annotations

from typing import Any

import sentry_sdk
from fastapi import Request
from sentry_sdk.integrations.fastapi import FastApiIntegration
from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration

from app.core.config import Settings


def init_sentry(settings: Settings) -> None:
    if not settings.sentry_dsn:
        return

    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.app_env,
        release="outreachai-api@1.0.0",
        traces_sample_rate=0.1,
        integrations=[
            FastApiIntegration(transaction_style="endpoint"),
            SqlalchemyIntegration(),
        ],
    )


def set_request_context(request: Request) -> None:
    endpoint = request.url.path
    workspace_id = request.headers.get("x-workspace-id") or request.query_params.get("workspace_id") or "unknown"
    lead_id = request.query_params.get("lead_id") or request.path_params.get("lead_id")

    sentry_sdk.set_tag("endpoint", endpoint)
    sentry_sdk.set_tag("workspace_id", workspace_id)
    sentry_sdk.set_context(
        "outreachai_request",
        {
            "endpoint": endpoint,
            "workspace_id": workspace_id,
            "lead_id": str(lead_id) if lead_id else None,
        },
    )
    if lead_id:
        sentry_sdk.set_tag("lead_id", str(lead_id))


def set_workspace_context(workspace_id: Any) -> None:
    sentry_sdk.set_tag("workspace_id", str(workspace_id))
    sentry_sdk.set_context("outreachai_workspace", {"workspace_id": str(workspace_id)})


def set_lead_context(lead_id: Any) -> None:
    sentry_sdk.set_tag("lead_id", str(lead_id))
    sentry_sdk.set_context("outreachai_lead", {"lead_id": str(lead_id)})


def capture_provider_exception(
    exc: BaseException,
    *,
    provider: str,
    endpoint: str = "",
    workspace_id: Any = None,
    lead_id: Any = None,
    extra: dict[str, Any] | None = None,
) -> None:
    with sentry_sdk.new_scope() as scope:
        scope.set_tag("provider", provider)
        if endpoint:
            scope.set_tag("endpoint", endpoint)
        if workspace_id:
            scope.set_tag("workspace_id", str(workspace_id))
        if lead_id:
            scope.set_tag("lead_id", str(lead_id))
        scope.set_context(
            "outreachai_provider",
            {
                "provider": provider,
                "endpoint": endpoint or None,
                "workspace_id": str(workspace_id) if workspace_id else None,
                "lead_id": str(lead_id) if lead_id else None,
                **(extra or {}),
            },
        )
        sentry_sdk.capture_exception(exc)


def sentry_transaction_name(request: Request) -> str:
    route = request.scope.get("route")
    path = getattr(route, "path", None)
    return str(path or request.url.path)
