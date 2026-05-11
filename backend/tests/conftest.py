from __future__ import annotations

from collections.abc import Generator
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.config import Settings
from app.main import create_app
from app.models import Device, Employee


@pytest.fixture
def client(tmp_path: Path) -> Generator[TestClient, None, None]:
    settings = Settings(
        database_url=f"sqlite:///{tmp_path / 'test.db'}",
        environment="test",
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
