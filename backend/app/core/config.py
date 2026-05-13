from __future__ import annotations

from functools import lru_cache

from pydantic import Field, model_validator
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
    device_agent_token_ttl_days: int = Field(default=90, ge=1)
    session_token_ttl_seconds: int = 43200
    password_hash_iterations: int = 120000
    bootstrap_admin_username: str = "admin"
    bootstrap_admin_password: str = "replace-with-dev-bootstrap-password"
    bootstrap_admin_display_name: str = "Development Admin"
    bootstrap_admin_email: str = "admin@example.test"
    ai_analysis_default_provider: str = "openai_compatible"
    ai_analysis_default_base_url: str = "https://api.openai.com/v1"
    ai_analysis_default_model: str = "gpt-4.1-mini"
    ai_analysis_default_api_key: str | None = None
    ai_analysis_default_timeout_seconds: int = Field(default=20, ge=1)
    ai_analysis_default_enabled: bool = False
    ai_analysis_default_use_previous_screenshot: bool = True
    ai_analysis_default_confidence_threshold: float = Field(default=0.7, ge=0.0, le=1.0)
    ai_analysis_default_risk_threshold: float = Field(default=0.7, ge=0.0, le=1.0)
    ai_analysis_enabled: bool = False
    ai_analysis_base_url: str | None = None
    ai_analysis_api_key: str | None = None
    ai_analysis_model: str | None = None
    ai_analysis_timeout_seconds: float = Field(default=8.0, gt=0, le=60)
    ai_analysis_max_completion_tokens: int = Field(default=350, ge=64, le=2048)
    ai_analysis_image_detail: str = "low"
    ai_analysis_organization: str | None = None
    ai_analysis_project: str | None = None

    model_config = SettingsConfigDict(env_prefix="EBM_", env_file=".env", extra="ignore")

    @property
    def is_production(self) -> bool:
        return self.environment.strip().casefold() == "production"

    @property
    def is_test(self) -> bool:
        return self.environment.strip().casefold() == "test"

    @property
    def allows_bootstrap_admin(self) -> bool:
        return self.environment.strip().casefold() in {"development", "test"}

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

        if self.ai_analysis_enabled:
            if not self.ai_analysis_base_url:
                raise ValueError("EBM_AI_ANALYSIS_BASE_URL must be set when AI analysis is enabled")
            if not self.ai_analysis_api_key or _looks_like_placeholder(self.ai_analysis_api_key):
                raise ValueError("EBM_AI_ANALYSIS_API_KEY must be set to a non-placeholder value when AI analysis is enabled")
            if not self.ai_analysis_model or _looks_like_placeholder(self.ai_analysis_model):
                raise ValueError("EBM_AI_ANALYSIS_MODEL must be set to a non-placeholder value when AI analysis is enabled")

        return self


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
