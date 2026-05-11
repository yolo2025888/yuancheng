from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "employee-behavior-monitor-backend"
    environment: str = "development"
    api_prefix: str = "/api"
    database_url: str = "sqlite:///./employee_behavior.db"
    default_policy_name: str = "default"
    default_policy_version: str = "mvp"
    default_screenshot_interval_seconds: int = 10
    default_no_change_threshold: int = 6
    default_retention_days: int = 30

    model_config = SettingsConfigDict(env_prefix="EBM_", env_file=".env", extra="ignore")


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
