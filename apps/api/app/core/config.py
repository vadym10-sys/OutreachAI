from __future__ import annotations

from functools import lru_cache

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


@lru_cache
def get_settings() -> Settings:
    return Settings()
