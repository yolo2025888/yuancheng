from __future__ import annotations

import json
import os
import shutil
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlmodel import Session


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

os.environ["EBM_ENVIRONMENT"] = "test"

from app.core.config import Settings  # noqa: E402
from app.main import create_app  # noqa: E402
from app.models import Device, Employee  # noqa: E402
from app.services.agent_auth import (  # noqa: E402
    create_device_agent_token,
    generate_device_agent_secret,
    hash_device_agent_secret,
)


def main() -> int:
    temp_root = Path(os.environ.get("EBM_SMOKE_TMP") or tempfile.gettempdir()).resolve()
    temp_path = temp_root / f"ebm-attendance-smoke-{uuid4().hex}"
    temp_path.mkdir(parents=True, exist_ok=False)
    app = None

    try:
        database_path = (temp_path / "smoke.db").resolve()
        database_path.touch()
        settings = Settings(
            database_url=f"sqlite:///{database_path.as_posix()}",
            environment="test",
            storage_root_dir=str(temp_path / "storage"),
            auth_secret="smoke-secret",
            agent_api_token="smoke-agent-token",
            session_token_ttl_seconds=3600,
            password_hash_iterations=1000,
            bootstrap_admin_username="dev-admin",
            bootstrap_admin_password="dev-password",
            bootstrap_admin_display_name="Dev Admin",
            bootstrap_admin_email="dev-admin@example.test",
        )
        app = create_app(settings)

        with TestClient(app) as client:
            admin_headers = _login_bootstrap_admin(client)
            seeded = _seed_employee_and_device(client)
            agent_headers = {"Authorization": f"Bearer {seeded['agent_token']}"}

            late_record = _create_attendance(
                client,
                agent_headers,
                occurred_at="2026-05-12T09:47:00+08:00",
                event_type="clock_in",
            )
            normal_record = _create_attendance(
                client,
                agent_headers,
                occurred_at="2026-05-12T18:12:00+08:00",
                event_type="clock_out",
            )

            assert late_record["anomaly_status"] == "late", late_record
            assert late_record["review_status"] == "pending", late_record
            assert normal_record["anomaly_status"] == "normal", normal_record
            assert normal_record["review_status"] == "reviewed", normal_record

            list_response = client.get(
                "/api/attendance",
                headers=admin_headers,
                params={"work_date": "2026-05-12"},
            )
            _assert_status(list_response, 200, "list attendance")
            attendance_payload = list_response.json()
            assert attendance_payload["total"] == 2, attendance_payload

            review_response = client.post(
                f"/api/attendance/{late_record['id']}/review",
                headers=admin_headers,
                json={
                    "review_status": "confirmed",
                    "review_note": "Smoke confirmed late clock-in.",
                },
            )
            _assert_status(review_response, 200, "review attendance")
            reviewed = review_response.json()
            assert reviewed["review_status"] == "confirmed", reviewed
            assert reviewed["review_note"] == "Smoke confirmed late clock-in.", reviewed

            print(
                json.dumps(
                    {
                        "status": "passed",
                        "employee_no": "E-001",
                        "device_id": seeded["device_id"],
                        "created_record_ids": [late_record["id"], normal_record["id"]],
                        "late_anomaly": late_record["anomaly_status"],
                        "normal_anomaly": normal_record["anomaly_status"],
                        "review_status": reviewed["review_status"],
                    },
                    indent=2,
                    sort_keys=True,
                )
            )
    finally:
        if app is not None:
            app.state.engine.dispose()
        shutil.rmtree(temp_path, ignore_errors=True)

    return 0


def _login_bootstrap_admin(client: TestClient) -> dict[str, str]:
    response = client.post(
        "/api/auth/login",
        json={"username": "dev-admin", "password": "dev-password"},
    )
    _assert_status(response, 200, "login bootstrap admin")
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def _seed_employee_and_device(client: TestClient) -> dict[str, str]:
    employee_id = uuid4()
    device_id = uuid4()
    agent_secret = generate_device_agent_secret()

    with Session(client.app.state.engine) as session:
        session.add(
            Employee(
                id=employee_id,
                name="Alice",
                employee_no="E-001",
                department="Engineering",
            )
        )
        session.add(
            Device(
                id=device_id,
                employee_id=employee_id,
                hostname="DEV-PC-001",
                os_type="windows",
                agent_version="0.1.0",
                screen_count=2,
                last_heartbeat_at=datetime.now(timezone.utc),
                agent_token_hash=hash_device_agent_secret(agent_secret),
                agent_token_expires_at=(
                    datetime.now(timezone.utc) + timedelta(days=client.app.state.settings.device_agent_token_ttl_days)
                ),
                status="online",
            )
        )
        session.commit()

    return {
        "employee_id": str(employee_id),
        "device_id": str(device_id),
        "agent_token": create_device_agent_token(device_id, agent_secret),
    }


def _create_attendance(
    client: TestClient,
    agent_headers: dict[str, str],
    *,
    occurred_at: str,
    event_type: str,
) -> dict[str, object]:
    response = client.post(
        "/api/agent/attendance",
        headers=agent_headers,
        json={
            "employee_no": "E-001",
            "user_name": "Alice",
            "machine_name": "DEV-PC-001",
            "event_type": event_type,
            "occurred_at": occurred_at,
            "source": "launcher",
        },
    )
    _assert_status(response, 201, f"create {event_type}")
    return response.json()


def _assert_status(response, expected_status: int, action: str) -> None:
    if response.status_code != expected_status:
        raise AssertionError(
            f"{action} returned {response.status_code}, expected {expected_status}: {response.text}"
        )


if __name__ == "__main__":
    raise SystemExit(main())
