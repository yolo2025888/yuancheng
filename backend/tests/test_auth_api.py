from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path
import re
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlmodel import Session

from app.core.config import Settings
from app.models import User
from app.services.auth import AuthService, hash_password


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
    assert "device_tokens.manage" in login_payload["user"]["permissions"]

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


def test_auth_responses_include_employee_binding(
    client: TestClient,
    seeded_device: dict[str, str],
    auth_headers,
) -> None:
    auth_headers(
        username="bound.reviewer",
        password="bound-password",
        role_name="Reviewer",
        employee_id=seeded_device["employee_id"],
    )

    login_response = client.post(
        "/api/auth/login",
        json={"username": "bound.reviewer", "password": "bound-password"},
    )

    assert login_response.status_code == 200
    login_payload = login_response.json()
    assert login_payload["user"]["employee_id"] == seeded_device["employee_id"]

    me_response = client.get(
        "/api/auth/me",
        headers={"Authorization": f"Bearer {login_payload['access_token']}"},
    )
    assert me_response.status_code == 200
    assert me_response.json()["employee_id"] == seeded_device["employee_id"]


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


def test_login_rejects_bad_password_and_inactive_user(client: TestClient) -> None:
    with Session(client.app.state.engine) as session:
        user = User(
            username="inactive.user",
            display_name="Inactive User",
            email="inactive@example.test",
            password_hash=hash_password(
                "correct-password",
                iterations=client.app.state.settings.password_hash_iterations,
            ),
            status="inactive",
        )
        session.add(user)
        session.commit()

    bad_password_response = client.post(
        "/api/auth/login",
        json={"username": "inactive.user", "password": "wrong-password"},
    )
    inactive_response = client.post(
        "/api/auth/login",
        json={"username": "inactive.user", "password": "correct-password"},
    )

    assert bad_password_response.status_code == 401
    assert bad_password_response.json()["detail"] == "Invalid username or password"
    assert inactive_response.status_code == 403
    assert inactive_response.json()["detail"] == "User is not active"


def test_me_rejects_missing_bad_wrong_scheme_and_expired_tokens(client: TestClient, auth_headers) -> None:
    headers = auth_headers(username="token.user", password="token-password", role_name="Admin")
    good_token = headers["Authorization"].removeprefix("Bearer ")

    missing_response = client.get("/api/auth/me")
    bad_response = client.get("/api/auth/me", headers={"Authorization": "Bearer not-a-valid-token"})
    wrong_scheme_response = client.get("/api/auth/me", headers={"Authorization": f"Basic {good_token}"})

    with Session(client.app.state.engine) as session:
        user = session.get(User, UUID(client.get("/api/auth/me", headers=headers).json()["id"]))
        assert user is not None
        expired_token = AuthService(
            session,
            client.app.state.settings,
            now_provider=lambda: datetime(2026, 5, 12, tzinfo=timezone.utc),
        ).create_session_token(
            user,
            expires_at=datetime.now(timezone.utc) - timedelta(seconds=1),
        )

    expired_response = client.get("/api/auth/me", headers={"Authorization": f"Bearer {expired_token}"})

    assert missing_response.status_code == 401
    assert bad_response.status_code == 401
    assert wrong_scheme_response.status_code == 401
    assert expired_response.status_code == 401


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


def test_staging_settings_do_not_allow_bootstrap_admin() -> None:
    settings = Settings(
        environment="staging",
        auth_secret="staging-secret-with-enough-entropy-2026",
        agent_api_token="staging-agent-token-with-enough-entropy",
    )

    assert settings.allows_bootstrap_admin is False


def test_settings_default_fail_closed_without_explicit_secrets(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("EBM_ENVIRONMENT", raising=False)
    monkeypatch.delenv("EBM_AUTH_SECRET", raising=False)
    monkeypatch.delenv("EBM_AGENT_API_TOKEN", raising=False)

    with pytest.raises(ValidationError, match="EBM_AUTH_SECRET"):
        Settings(_env_file=None)


def test_development_settings_reject_default_secrets() -> None:
    with pytest.raises(ValidationError, match="EBM_AUTH_SECRET"):
        Settings(
            environment="development",
            auth_secret="dev-only-change-me",
            agent_api_token="dev-agent-token-change-me",
        )


def test_test_environment_allows_dev_secrets_for_isolated_fixtures() -> None:
    settings = Settings(environment="test")

    assert settings.is_test is True


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
