from __future__ import annotations

from functools import lru_cache
import os

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_env: str = "development"
    database_url: str = "sqlite:///./outreachai.db"
    clerk_secret_key: str = "dev"
    clerk_jwt_issuer: str = "https://example.clerk.accounts.dev"
    jwt_audience: str = "outreachai-api"
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
    encryption_key: str = "replace-with-32-byte-url-safe-key"
    auto_create_tables: bool = False
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
    def missing_optional_services(self) -> list[str]:
        missing = []
        if not self.openai_api_key:
            missing.append("OPENAI_API_KEY")
        if not self.resend_api_key:
            missing.append("RESEND_API_KEY")
        if not self.apollo_api_key:
            missing.append("APOLLO_API_KEY")
        if not self.hunter_api_key:
            missing.append("HUNTER_API_KEY")
        if not self.clay_api_key:
            missing.append("CLAY_API_KEY")
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


@lru_cache
def get_settings() -> Settings:
    return Settings()
