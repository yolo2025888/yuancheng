from __future__ import annotations

from collections.abc import Generator
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.core.config import Settings
from app.main import create_app
from app.models import Device, Employee, Role, User
from app.services.auth import hash_password


@pytest.fixture
def client(tmp_path: Path) -> Generator[TestClient, None, None]:
    settings = Settings(
        database_url=f"sqlite:///{tmp_path / 'test.db'}",
        environment="test",
        storage_root_dir=str(tmp_path / "storage"),
        auth_secret="test-secret",
        agent_api_token="test-agent-token",
        session_token_ttl_seconds=3600,
        password_hash_iterations=1000,
        bootstrap_admin_username="dev-admin",
        bootstrap_admin_password="dev-password",
        bootstrap_admin_display_name="Dev Admin",
        bootstrap_admin_email="dev-admin@example.test",
    )
    app = create_app(settings)
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def seeded_device(client: TestClient) -> dict[str, str]:
    app = client.app
    employee_id = uuid4()
    device_id = uuid4()

    with Session(app.state.engine) as session:
        employee = Employee(
            id=employee_id,
            name="Alice",
            employee_no="E-001",
            department="Engineering",
        )
        device = Device(
            id=device_id,
            employee_id=employee_id,
            hostname="DEV-PC-001",
            os_type="windows",
            agent_version="0.1.0",
            screen_count=2,
            last_heartbeat_at=datetime.now(timezone.utc),
            status="online",
        )
        session.add(employee)
        session.add(device)
        session.commit()

    return {"employee_id": str(employee_id), "device_id": str(device_id)}


@pytest.fixture
def auth_headers(client: TestClient):
    def issue_headers(
        *,
        username: str = "test-admin",
        password: str = "test-password",
        role_name: str | None = "Admin",
        display_name: str = "Test Admin",
        email: str | None = "test-admin@example.test",
        status: str = "active",
        bootstrap: bool = False,
    ) -> dict[str, str]:
        if bootstrap:
            username = client.app.state.settings.bootstrap_admin_username
            password = client.app.state.settings.bootstrap_admin_password
        else:
            with Session(client.app.state.engine) as session:
                role_id = None
                if role_name is not None:
                    role = session.exec(select(Role).where(Role.name == role_name)).first()
                    if role is None:
                        role = Role(name=role_name, description=f"{role_name} role")
                        session.add(role)
                        session.flush()
                    role_id = role.id

                user = session.exec(select(User).where(User.username == username)).first()
                if user is None:
                    user = User(
                        username=username,
                        display_name=display_name,
                        email=email,
                        password_hash=hash_password(
                            password,
                            iterations=client.app.state.settings.password_hash_iterations,
                        ),
                        role_id=role_id,
                        status=status,
                    )
                    session.add(user)
                else:
                    user.display_name = display_name
                    user.email = email
                    user.password_hash = hash_password(
                        password,
                        iterations=client.app.state.settings.password_hash_iterations,
                    )
                    user.role_id = role_id
                    user.status = status
                    session.add(user)
                session.commit()

        response = client.post("/api/auth/login", json={"username": username, "password": password})
        assert response.status_code == 200, response.text
        token = response.json()["access_token"]
        return {"Authorization": f"Bearer {token}"}

    return issue_headers


@pytest.fixture
def agent_headers(client: TestClient) -> dict[str, str]:
    return {"Authorization": f"Bearer {client.app.state.settings.agent_api_token}"}
