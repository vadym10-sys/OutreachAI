from __future__ import annotations

from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_env: str = "development"
    database_url: str = "sqlite:///./outreachai.db"
    clerk_secret_key: str = "dev"
    clerk_jwt_issuer: str = "https://example.clerk.accounts.dev"
    jwt_audience: str = "outreachai-api"
    openai_api_key: str = ""
    resend_api_key: str = ""
    resend_from_email: str = "OutreachAI <hello@example.com>"
    stripe_secret_key: str = ""
    stripe_webhook_secret: str = ""
    stripe_price_starter: str = ""
    stripe_price_pro: str = ""
    stripe_price_agency: str = ""
    encryption_key: str = "replace-with-32-byte-url-safe-key"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    @field_validator("database_url")
    @classmethod
    def normalize_database_url(cls, value: str) -> str:
        if value.startswith("postgresql://"):
            return value.replace("postgresql://", "postgresql+psycopg://", 1)
        if value.startswith("postgres://"):
            return value.replace("postgres://", "postgresql+psycopg://", 1)
        return value

    @property
    def missing_optional_services(self) -> list[str]:
        missing = []
        if not self.openai_api_key:
            missing.append("OPENAI_API_KEY")
        if not self.resend_api_key:
            missing.append("RESEND_API_KEY")
        if not self.stripe_secret_key:
            missing.append("STRIPE_SECRET_KEY")
        if not self.stripe_webhook_secret:
            missing.append("STRIPE_WEBHOOK_SECRET")
        return missing


@lru_cache
def get_settings() -> Settings:
    return Settings()
