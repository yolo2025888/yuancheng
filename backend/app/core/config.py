from __future__ import annotations

from functools import lru_cache

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def _looks_like_placeholder(value: str) -> bool:
    normalized = value.strip().casefold()
    return any(marker in normalized for marker in ("change-me", "changeme", "replace-with", "placeholder"))


class Settings(BaseSettings):
    app_name: str = "employee-behavior-monitor-backend"
    environment: str = "production"
    api_prefix: str = "/api"
    database_url: str = "sqlite:///./employee_behavior.db"
    storage_root_dir: str = "storage"
    screenshot_thumbnail_max_size: int = 320
    default_policy_name: str = "default"
    default_policy_version: str = "mvp"
    default_screenshot_interval_seconds: int = 10
    default_no_change_threshold: int = 6
    default_retention_days: int = 30
    auth_secret: str = "dev-only-change-me"
    agent_api_token: str = "dev-agent-token-change-me"
    session_token_ttl_seconds: int = 43200
    password_hash_iterations: int = 120000
    bootstrap_admin_username: str = "admin"
    bootstrap_admin_password: str = "admin123!"
    bootstrap_admin_display_name: str = "Development Admin"
    bootstrap_admin_email: str = "admin@example.test"

    model_config = SettingsConfigDict(env_prefix="EBM_", env_file=".env", extra="ignore")

    @property
    def is_production(self) -> bool:
        return self.environment.strip().casefold() == "production"

    @property
    def is_test(self) -> bool:
        return self.environment.strip().casefold() == "test"

    @model_validator(mode="after")
    def validate_production_auth_settings(self) -> "Settings":
        normalized_environment = self.environment.strip().casefold()
        if normalized_environment not in {"production", "staging", "development", "test"}:
            raise ValueError("EBM_ENVIRONMENT must be one of production, staging, development, or test")
        if self.is_test:
            return self

        normalized_secret = self.auth_secret.strip()
        if (
            normalized_secret == "dev-only-change-me"
            or len(normalized_secret) < 32
            or _looks_like_placeholder(normalized_secret)
        ):
            raise ValueError("EBM_AUTH_SECRET must be set to a non-default value of at least 32 characters in production")

        normalized_agent_token = self.agent_api_token.strip()
        if (
            normalized_agent_token == "dev-agent-token-change-me"
            or len(normalized_agent_token) < 24
            or _looks_like_placeholder(normalized_agent_token)
        ):
            raise ValueError("EBM_AGENT_API_TOKEN must be set to a non-default value of at least 24 characters in production")

        return self


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
