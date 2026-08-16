from __future__ import annotations

from typing import Any

from app.services.agent_runtime.schemas import ModelUsage


def usage_from_openai_response(response: Any) -> ModelUsage:
    raw = getattr(response, "usage", None)
    if raw is None:
        return ModelUsage()
    prompt_tokens = int(getattr(raw, "prompt_tokens", 0) or 0)
    completion_tokens = int(getattr(raw, "completion_tokens", 0) or 0)
    total_tokens = int(getattr(raw, "total_tokens", 0) or prompt_tokens + completion_tokens)
    return ModelUsage(
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        total_tokens=total_tokens,
    )


def merge_token_usage(*items: dict[str, Any] | ModelUsage | None) -> dict[str, int]:
    total = ModelUsage()
    for item in items:
        if item is None:
            continue
        usage = item if isinstance(item, ModelUsage) else ModelUsage.model_validate(item)
        total.prompt_tokens += usage.prompt_tokens
        total.completion_tokens += usage.completion_tokens
        total.total_tokens += usage.total_tokens
    return total.model_dump()


def estimated_cost_for_usage(*, model: str, usage: ModelUsage) -> float | None:
    # Pricing changes often; keep storage nullable unless a current internal price table is supplied.
    if not model or usage.total_tokens <= 0:
        return None
    return None
