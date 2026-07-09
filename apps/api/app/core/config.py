from __future__ import annotations

from functools import lru_cache
import os

from pydantic import Field
from pydantic import field_validator
from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def _google_maps_api_key_default() -> str:
    return (
        os.getenv("GOOGLE_PLACES_API_KEY")
        or os.getenv("GOOGLE_API_KEY")
        or os.getenv("MAPS_API_KEY")
        or os.getenv("NEXT_PUBLIC_GOOGLE_MAPS_API_KEY")
        or ""
    )


class Settings(BaseSettings):
    app_env: str = "development"
    database_url: str = "sqlite:///./outreachai.db"
    clerk_secret_key: str = "dev"
    clerk_jwt_issuer: str = "https://example.clerk.accounts.dev"
    jwt_audience: str = ""
    openai_api_key: str = ""
    openai_model: str = "gpt-5.5"
    openai_timeout_seconds: float = 40
    openai_max_retries: int = 2
    ai_rate_limit_per_minute: int = 30
    resend_api_key: str = ""
    resend_from_email: str = ""
    resend_reply_to: str = ""
    resend_webhook_secret: str = ""
    apollo_api_key: str = ""
    hunter_api_key: str = ""
    google_maps_api_key: str = Field(default_factory=_google_maps_api_key_default)
    clay_api_key: str = ""
    clay_workspace_id: str = ""
    crm_sync_webhook_url: str = ""
    automation_secret: str = ""
    automation_batch_size: int = 25
    automation_send_limit_per_run: int = 25
    public_api_url: str = "http://localhost:8000"
    public_app_url: str = "https://outreachaiaiai.com"
    stripe_secret_key: str = ""
    stripe_webhook_secret: str = ""
    stripe_publishable_key: str = ""
    stripe_price_starter: str = ""
    stripe_price_pro: str = ""
    stripe_price_agency: str = ""
    sentry_dsn: str = ""
    sentry_traces_sample_rate: float = 0.1
    slow_request_ms: int = 2500
    upstash_redis_rest_url: str = ""
    upstash_redis_rest_token: str = ""
    cache_dashboard_ttl_seconds: int = 15
    cache_crm_ttl_seconds: int = 5
    cache_billing_ttl_seconds: int = 60
    cache_lead_search_ttl_seconds: int = 600
    cache_website_analysis_ttl_seconds: int = 3600
    debug: bool = False
    encryption_key: str = "replace-with-32-byte-url-safe-key"
    auto_create_tables: bool = True
    cors_origins: str = "http://localhost:3000,https://outreachaiaiai.com,https://outreachaiweb-production.up.railway.app"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    @field_validator("database_url")
    @classmethod
    def normalize_database_url(cls, value: str) -> str:
        if value.startswith("postgresql://"):
            return value.replace("postgresql://", "postgresql+psycopg://", 1)
        if value.startswith("postgres://"):
            return value.replace("postgres://", "postgresql+psycopg://", 1)
        return value

    @model_validator(mode="after")
    def load_google_maps_key_aliases(self) -> "Settings":
        if not self.google_maps_api_key:
            self.google_maps_api_key = _google_maps_api_key_default()
        return self

    @property
    def allowed_origins(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def stripe_starter_price_id(self) -> str:
        return os.getenv("STRIPE_STARTER_PRICE_ID") or self.stripe_price_starter

    @property
    def stripe_pro_price_id(self) -> str:
        return os.getenv("STRIPE_PRO_PRICE_ID") or self.stripe_price_pro

    @property
    def stripe_agency_price_id(self) -> str:
        return os.getenv("STRIPE_AGENCY_PRICE_ID") or self.stripe_price_agency

    @property
    def stripe_public_key(self) -> str:
        return self.stripe_publishable_key

    @property
    def missing_customer_integrations(self) -> list[str]:
        missing = []
        if not self.openai_api_key:
            missing.append("OPENAI_API_KEY")
        if not self.resend_api_key:
            missing.append("RESEND_API_KEY")
        if not self.hunter_api_key:
            missing.append("HUNTER_API_KEY")
        if not self.google_maps_api_key:
            missing.append("GOOGLE_MAPS_API_KEY")
        if not self.stripe_secret_key:
            missing.append("STRIPE_SECRET_KEY")
        if not self.stripe_webhook_secret:
            missing.append("STRIPE_WEBHOOK_SECRET")
        if not self.stripe_starter_price_id:
            missing.append("STRIPE_STARTER_PRICE_ID")
        if not self.stripe_pro_price_id:
            missing.append("STRIPE_PRO_PRICE_ID")
        if not self.stripe_agency_price_id:
            missing.append("STRIPE_AGENCY_PRICE_ID")
        return missing

    @property
    def missing_optional_services(self) -> list[str]:
        return self.missing_customer_integrations


@lru_cache
def get_settings() -> Settings:
    return Settings()
