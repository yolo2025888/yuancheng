from __future__ import annotations

from pathlib import Path
import re

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.core.config import Settings


def test_login_bootstraps_dev_admin_and_me_excludes_password_hash(client: TestClient) -> None:
    login_response = client.post(
        "/api/auth/login",
        json={
            "username": client.app.state.settings.bootstrap_admin_username,
            "password": client.app.state.settings.bootstrap_admin_password,
        },
    )

    assert login_response.status_code == 200
    login_payload = login_response.json()
    assert login_payload["token_type"] == "bearer"
    assert login_payload["user"]["username"] == client.app.state.settings.bootstrap_admin_username
    assert "password_hash" not in login_payload["user"]
    assert "directory.manage" in login_payload["user"]["permissions"]

    me_response = client.get(
        "/api/auth/me",
        headers={"Authorization": f"Bearer {login_payload['access_token']}"},
    )
    assert me_response.status_code == 200
    me_payload = me_response.json()
    assert me_payload["username"] == client.app.state.settings.bootstrap_admin_username
    assert me_payload["role_name"] == "Admin"
    assert "password_hash" not in me_payload


def test_login_accepts_email_identifier_for_existing_user(client: TestClient, auth_headers) -> None:
    auth_headers(username="email.user", password="email-password", email="email.user@example.test")

    login_response = client.post(
        "/api/auth/login",
        json={
            "username": "email.user@example.test",
            "password": "email-password",
        },
    )

    assert login_response.status_code == 200
    assert login_response.json()["user"]["username"] == "email.user"


def test_login_bootstraps_dev_admin_with_email_identifier(client: TestClient) -> None:
    login_response = client.post(
        "/api/auth/login",
        json={
            "username": client.app.state.settings.bootstrap_admin_email,
            "password": client.app.state.settings.bootstrap_admin_password,
        },
    )

    assert login_response.status_code == 200
    assert login_response.json()["user"]["username"] == client.app.state.settings.bootstrap_admin_username


def test_permission_denial_returns_403_for_missing_policy_permission(
    client: TestClient,
    auth_headers,
) -> None:
    headers = auth_headers(role_name="Manager", username="manager.user", password="manager-password")

    response = client.post(
        "/api/policies",
        headers=headers,
        json={
            "name": "blocked",
            "version": "2026.05",
            "screenshot_interval_seconds": 15,
            "no_change_threshold": 4,
            "retention_days": 21,
            "is_active": False,
            "rules_json": {},
        },
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "Missing permissions: policies.manage"


def test_production_settings_reject_default_auth_secret() -> None:
    with pytest.raises(ValidationError, match="EBM_AUTH_SECRET"):
        Settings(environment="production", auth_secret="dev-only-change-me")


def test_production_settings_reject_default_agent_token() -> None:
    with pytest.raises(ValidationError, match="EBM_AGENT_API_TOKEN"):
        Settings(
            environment="production",
            auth_secret="production-secret-with-enough-entropy-2026",
            agent_api_token="dev-agent-token-change-me",
        )


def test_production_settings_reject_placeholder_secrets() -> None:
    with pytest.raises(ValidationError, match="EBM_AUTH_SECRET"):
        Settings(
            environment="production",
            auth_secret="replace-with-32-plus-character-auth-secret",
            agent_api_token="production-agent-token-with-enough-entropy",
        )

    with pytest.raises(ValidationError, match="EBM_AGENT_API_TOKEN"):
        Settings(
            environment="production",
            auth_secret="production-secret-with-enough-entropy-2026",
            agent_api_token="replace-with-24-plus-character-agent-token",
        )


def test_production_settings_accept_strong_auth_secret() -> None:
    settings = Settings(
        environment="production",
        auth_secret="production-secret-with-enough-entropy-2026",
        agent_api_token="production-agent-token-with-enough-entropy",
    )

    assert settings.is_production is True


def test_custom_role_name_does_not_gain_admin_permissions_by_substring(
    client: TestClient,
    auth_headers,
) -> None:
    headers = auth_headers(role_name="admin assistant", username="assistant", password="assistant-password")

    dashboard_response = client.get("/api/dashboard/summary", headers=headers)
    employees_response = client.get("/api/employees", headers=headers)

    response = client.post(
        "/api/policies",
        headers=headers,
        json={
            "name": "blocked-custom",
            "version": "2026.05",
            "screenshot_interval_seconds": 15,
            "no_change_threshold": 4,
            "retention_days": 21,
            "is_active": False,
            "rules_json": {},
        },
    )

    assert dashboard_response.status_code == 403
    assert employees_response.status_code == 403
    assert response.status_code == 403


def test_root_env_example_uses_backend_security_setting_names() -> None:
    env_example = Path(__file__).resolve().parents[2] / ".env.example"
    text = env_example.read_text(encoding="utf-8")

    assert re.search(r"(?m)^APP_ENV=", text) is None
    assert re.search(r"(?m)^DATABASE_URL=", text) is None
    assert "EBM_ENVIRONMENT=production" in text
    assert "EBM_AUTH_SECRET=replace-with-32-plus-character-auth-secret" in text
    assert "EBM_AGENT_API_TOKEN=replace-with-24-plus-character-agent-token" in text
