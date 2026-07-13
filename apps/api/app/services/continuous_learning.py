from __future__ import annotations

from datetime import datetime
from typing import Any

DEFAULT_OPPORTUNITY_WEIGHTS: dict[str, float] = {
    "Buying Intent": 0.20,
    "Company Intelligence": 0.12,
    "Decision Maker Quality": 0.16,
    "Technology Match": 0.08,
    "Company Size": 0.08,
    "Hiring Signals": 0.08,
    "Growth Signals": 0.10,
    "Geography": 0.06,
    "Website Quality": 0.06,
    "Verified Contacts": 0.06,
}

DEFAULT_PRIORITIZATION_WEIGHTS: dict[str, float] = {
    "buying_intent": 0.24,
    "opportunity_score": 0.24,
    "decision_maker_quality": 0.18,
    "website_activity": 0.12,
    "freshness": 0.12,
    "ai_confidence": 0.10,
}


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _normalize_weight_map(raw: dict[str, float], defaults: dict[str, float]) -> dict[str, float]:
    adjusted = {key: max(0.01, _safe_float(raw.get(key), defaults[key])) for key in defaults.keys()}
    total = sum(adjusted.values())
    if total <= 0:
        return defaults.copy()
    return {key: adjusted[key] / total for key in defaults.keys()}


def _profile_from_ai_settings(ai_settings: dict[str, Any] | None) -> dict[str, Any]:
    source = ai_settings if isinstance(ai_settings, dict) else {}
    profile = source.get("continuous_learning") if isinstance(source.get("continuous_learning"), dict) else {}

    opportunities = _normalize_weight_map(
        profile.get("opportunity_weights") if isinstance(profile.get("opportunity_weights"), dict) else {},
        DEFAULT_OPPORTUNITY_WEIGHTS,
    )
    prioritization = _normalize_weight_map(
        profile.get("prioritization_weights") if isinstance(profile.get("prioritization_weights"), dict) else {},
        DEFAULT_PRIORITIZATION_WEIGHTS,
    )

    opportunity_signal = profile.get("opportunity_signal") if isinstance(profile.get("opportunity_signal"), dict) else {}
    prioritization_signal = profile.get("prioritization_signal") if isinstance(profile.get("prioritization_signal"), dict) else {}
    outcomes = profile.get("outcomes") if isinstance(profile.get("outcomes"), dict) else {}

    return {
        "version": int(profile.get("version") or 1),
        "updated_at": str(profile.get("updated_at") or ""),
        "total_events": int(profile.get("total_events") or 0),
        "outcomes": {
            "sent": int(outcomes.get("sent") or 0),
            "reply": int(outcomes.get("reply") or 0),
            "meeting": int(outcomes.get("meeting") or 0),
            "won": int(outcomes.get("won") or 0),
            "lost": int(outcomes.get("lost") or 0),
        },
        "opportunity_weights": opportunities,
        "prioritization_weights": prioritization,
        "opportunity_signal": {key: _safe_float(opportunity_signal.get(key), 0.0) for key in DEFAULT_OPPORTUNITY_WEIGHTS.keys()},
        "prioritization_signal": {key: _safe_float(prioritization_signal.get(key), 0.0) for key in DEFAULT_PRIORITIZATION_WEIGHTS.keys()},
    }


def _event_strength(outcome: str) -> float:
    mapping = {
        "sent": 0.15,
        "reply": 1.0,
        "meeting": 1.6,
        "won": 2.8,
        "lost": -2.2,
    }
    return mapping.get(str(outcome or "").strip().lower(), 0.0)


def _factor_centered_score(factor_value: Any) -> float:
    score = _safe_float(factor_value, 0.0)
    bounded = _clamp(score, 0.0, 100.0)
    return (bounded - 50.0) / 50.0


def _recompute_weights(defaults: dict[str, float], signal: dict[str, float], total_events: int) -> dict[str, float]:
    normalizer = max(6.0, float(total_events))
    adjusted: dict[str, float] = {}
    for key, base_weight in defaults.items():
        influence = _clamp(signal.get(key, 0.0) / normalizer, -0.40, 0.40)
        adjusted[key] = max(0.01, base_weight * (1.0 + influence))
    return _normalize_weight_map(adjusted, defaults)


def _updated_profile(
    profile: dict[str, Any],
    *,
    outcome: str,
    opportunity_factors: dict[str, Any] | None,
    prioritization_factors: dict[str, Any] | None,
) -> dict[str, Any]:
    strength = _event_strength(outcome)
    if strength == 0:
        return profile

    profile = {
        **profile,
        "outcomes": {**(profile.get("outcomes") or {})},
        "opportunity_signal": {**(profile.get("opportunity_signal") or {})},
        "prioritization_signal": {**(profile.get("prioritization_signal") or {})},
    }
    profile["total_events"] = int(profile.get("total_events") or 0) + 1
    profile["outcomes"][outcome] = int(profile["outcomes"].get(outcome) or 0) + 1

    for key in DEFAULT_OPPORTUNITY_WEIGHTS.keys():
        centered = _factor_centered_score((opportunity_factors or {}).get(key))
        profile["opportunity_signal"][key] = _safe_float(profile["opportunity_signal"].get(key), 0.0) + strength * centered

    for key in DEFAULT_PRIORITIZATION_WEIGHTS.keys():
        centered = _factor_centered_score((prioritization_factors or {}).get(key))
        profile["prioritization_signal"][key] = _safe_float(profile["prioritization_signal"].get(key), 0.0) + strength * centered

    profile["opportunity_weights"] = _recompute_weights(
        DEFAULT_OPPORTUNITY_WEIGHTS,
        profile.get("opportunity_signal") if isinstance(profile.get("opportunity_signal"), dict) else {},
        int(profile.get("total_events") or 0),
    )
    profile["prioritization_weights"] = _recompute_weights(
        DEFAULT_PRIORITIZATION_WEIGHTS,
        profile.get("prioritization_signal") if isinstance(profile.get("prioritization_signal"), dict) else {},
        int(profile.get("total_events") or 0),
    )
    profile["updated_at"] = datetime.utcnow().isoformat()
    return profile


def continuous_learning_snapshot(ai_settings: dict[str, Any] | None) -> dict[str, Any]:
    return _profile_from_ai_settings(ai_settings)


def continuous_learning_weights(ai_settings: dict[str, Any] | None) -> dict[str, dict[str, float]]:
    profile = _profile_from_ai_settings(ai_settings)
    return {
        "opportunity": profile.get("opportunity_weights") if isinstance(profile.get("opportunity_weights"), dict) else DEFAULT_OPPORTUNITY_WEIGHTS.copy(),
        "prioritization": profile.get("prioritization_weights") if isinstance(profile.get("prioritization_weights"), dict) else DEFAULT_PRIORITIZATION_WEIGHTS.copy(),
    }


def apply_continuous_learning_event(
    ai_settings: dict[str, Any] | None,
    *,
    outcome: str,
    opportunity_factors: dict[str, Any] | None = None,
    prioritization_factors: dict[str, Any] | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    profile = _profile_from_ai_settings(ai_settings)
    normalized_outcome = str(outcome or "").strip().lower()
    profile = _updated_profile(
        profile,
        outcome=normalized_outcome,
        opportunity_factors=opportunity_factors,
        prioritization_factors=prioritization_factors,
    )
    base = ai_settings.copy() if isinstance(ai_settings, dict) else {}
    updated_ai = {**base, "continuous_learning": profile}
    return updated_ai, profile
