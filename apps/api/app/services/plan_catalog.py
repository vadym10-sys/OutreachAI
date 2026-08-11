from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from typing import Any, Literal

from app.core.config import get_settings

BillingPeriod = Literal["monthly"]
PLAN_ORDER = ("Starter", "Pro", "Agency")
SUPPORTED_BILLING_PERIODS: tuple[BillingPeriod, ...] = ("monthly",)
TRIAL_DAYS = 14


@dataclass(frozen=True)
class StripePriceMapping:
    env_name: str
    legacy_env_name: str
    lookup_key: str
    amount: int
    currency: str = "eur"
    interval: str = "month"


@dataclass(frozen=True)
class PlanSpec:
    name: str
    display_name: str
    description: str
    monthly_price: int
    currency: str
    trial_days: int
    limits: dict[str, int | bool]
    features: dict[str, bool]
    reserved_features: dict[str, str]
    roadmap_limits: dict[str, int]
    upgrade_to: tuple[str, ...]
    downgrade_to: tuple[str, ...]
    stripe_monthly: StripePriceMapping


def _limits(
    *,
    mrr: int,
    leads: int,
    ai_generations: int,
    email_sends: int,
    sales_employees: int,
    workspaces: int,
    team_members: int,
    campaigns: int,
    review_mode: bool,
    semi_auto_mode: bool,
    autonomous_mode: bool,
    basic_analytics: bool,
    advanced_analytics: bool,
    reply_ai: bool,
    api_access: bool,
    webhooks: bool,
    white_label: bool,
) -> dict[str, int | bool]:
    return {
        "mrr": mrr,
        "leads": leads,
        "ai_generations": ai_generations,
        "email_sends": email_sends,
        "sales_employees": sales_employees,
        "workspaces": workspaces,
        "team_members": team_members,
        "campaigns": campaigns,
        "review_mode": review_mode,
        "semi_auto_mode": semi_auto_mode,
        "autonomous_mode": autonomous_mode,
        "basic_analytics": basic_analytics,
        "advanced_analytics": advanced_analytics,
        "reply_ai": reply_ai,
        "api_access": api_access,
        "webhooks": webhooks,
        "white_label": white_label,
    }


PLAN_CATALOG: dict[str, PlanSpec] = {
    "Starter": PlanSpec(
        name="Starter",
        display_name="OutreachAI Starter",
        description="OutreachAI Starter monthly subscription with a 14-day free trial.",
        monthly_price=49,
        currency="EUR",
        trial_days=TRIAL_DAYS,
        limits=_limits(
            mrr=49,
            leads=500,
            ai_generations=1000,
            email_sends=1000,
            sales_employees=1,
            workspaces=1,
            team_members=1,
            campaigns=3,
            review_mode=True,
            semi_auto_mode=False,
            autonomous_mode=False,
            basic_analytics=True,
            advanced_analytics=False,
            reply_ai=False,
            api_access=False,
            webhooks=False,
            white_label=False,
        ),
        features={"manual_approval": True, "basic_analytics": True},
        reserved_features={"team_members": "unavailable", "api_access": "reserved", "webhooks": "reserved", "white_label": "reserved"},
        roadmap_limits={"workspaces": 1, "team_members": 1},
        upgrade_to=("Pro", "Agency"),
        downgrade_to=(),
        stripe_monthly=StripePriceMapping(env_name="STRIPE_STARTER_PRICE_ID", legacy_env_name="STRIPE_PRICE_STARTER", lookup_key="outreachai_starter_monthly", amount=4900),
    ),
    "Pro": PlanSpec(
        name="Pro",
        display_name="OutreachAI Pro",
        description="OutreachAI Pro monthly subscription with a 14-day free trial.",
        monthly_price=149,
        currency="EUR",
        trial_days=TRIAL_DAYS,
        limits=_limits(
            mrr=149,
            leads=5000,
            ai_generations=10000,
            email_sends=10000,
            sales_employees=3,
            workspaces=1,
            team_members=1,
            campaigns=25,
            review_mode=True,
            semi_auto_mode=True,
            autonomous_mode=False,
            basic_analytics=True,
            advanced_analytics=True,
            reply_ai=True,
            api_access=False,
            webhooks=False,
            white_label=False,
        ),
        features={"manual_approval": True, "semi_auto_mode": True, "advanced_analytics": True, "reply_ai": True},
        reserved_features={"workspaces": "reserved", "team_members": "reserved", "api_access": "reserved", "webhooks": "reserved", "white_label": "reserved"},
        roadmap_limits={"workspaces": 3, "team_members": 10},
        upgrade_to=("Agency",),
        downgrade_to=("Starter",),
        stripe_monthly=StripePriceMapping(env_name="STRIPE_PRO_PRICE_ID", legacy_env_name="STRIPE_PRICE_PRO", lookup_key="outreachai_pro_monthly", amount=14900),
    ),
    "Agency": PlanSpec(
        name="Agency",
        display_name="OutreachAI Agency",
        description="OutreachAI Agency monthly subscription with a 14-day free trial.",
        monthly_price=499,
        currency="EUR",
        trial_days=TRIAL_DAYS,
        limits=_limits(
            mrr=499,
            leads=50000,
            ai_generations=100000,
            email_sends=100000,
            sales_employees=10,
            workspaces=1,
            team_members=1,
            campaigns=0,
            review_mode=True,
            semi_auto_mode=True,
            autonomous_mode=True,
            basic_analytics=True,
            advanced_analytics=True,
            reply_ai=True,
            api_access=False,
            webhooks=False,
            white_label=False,
        ),
        features={"manual_approval": True, "semi_auto_mode": True, "autonomous_mode": True, "advanced_analytics": True, "reply_ai": True},
        reserved_features={"workspaces": "reserved", "team_members": "reserved", "campaigns": "reserved", "api_access": "reserved", "webhooks": "reserved", "white_label": "reserved"},
        roadmap_limits={"workspaces": 0, "team_members": 0, "campaigns": 0},
        upgrade_to=(),
        downgrade_to=("Starter", "Pro"),
        stripe_monthly=StripePriceMapping(env_name="STRIPE_AGENCY_PRICE_ID", legacy_env_name="STRIPE_PRICE_AGENCY", lookup_key="outreachai_agency_monthly", amount=49900),
    ),
}

PLAN_LIMITS: dict[str, dict[str, int | bool]] = {name: deepcopy(spec.limits) for name, spec in PLAN_CATALOG.items()}


def is_plan_name(plan: str) -> bool:
    return plan in PLAN_CATALOG


def normalize_billing_period(period: str | None) -> BillingPeriod:
    if (period or "monthly").strip().lower() != "monthly":
        raise ValueError("Only monthly billing is configured")
    return "monthly"


def plan_limits(plan: str) -> dict[str, int | bool]:
    if plan not in PLAN_CATALOG:
        raise ValueError("Unknown subscription plan")
    return deepcopy(PLAN_CATALOG[plan].limits)


def configured_price_id(plan: str, billing_period: BillingPeriod = "monthly") -> str:
    normalize_billing_period(billing_period)
    settings = get_settings()
    configured = {
        "Starter": settings.stripe_starter_price_id,
        "Pro": settings.stripe_pro_price_id,
        "Agency": settings.stripe_agency_price_id,
    }
    return configured[plan]


def plan_from_configured_price_id(price_id: str) -> tuple[str, BillingPeriod] | None:
    if not price_id:
        return None
    for plan in PLAN_ORDER:
        if configured_price_id(plan, "monthly") == price_id:
            return plan, "monthly"
    return None


def public_plan_catalog() -> list[dict[str, Any]]:
    return [
        {
            "name": spec.name,
            "display_name": spec.display_name,
            "price": spec.monthly_price,
            "monthly_price": spec.monthly_price,
            "currency": spec.currency,
            "billing_period": "monthly",
            "trial_days": spec.trial_days,
            "limits": deepcopy(spec.limits),
            "features": deepcopy(spec.features),
            "reserved_features": deepcopy(spec.reserved_features),
            "roadmap_limits": deepcopy(spec.roadmap_limits),
            "upgrade_to": list(spec.upgrade_to),
            "downgrade_to": list(spec.downgrade_to),
        }
        for spec in PLAN_CATALOG.values()
    ]
