from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID, uuid4

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.core.config import Settings
from app.main import create_app
from app.models import AuditLog, BehaviorEvent, Device, Employee, Policy


def test_admin_list_apis_return_employees_devices_and_policies(
    client: TestClient,
    seeded_device: dict[str, str],
) -> None:
    app = client.app
    employee_id = UUID(seeded_device["employee_id"])
    device_id = UUID(seeded_device["device_id"])

    heartbeat_response = client.post(
        "/api/agent/heartbeat",
        json={
            "device_id": seeded_device["device_id"],
            "employee_id": seeded_device["employee_id"],
            "hostname": "DEV-PC-001",
            "os_type": "windows",
            "agent_version": "0.2.0",
            "screen_count": 2,
            "status": "online",
            "session_state": {
                "collected_at": "2026-05-11T12:00:00Z",
                "is_locked": False,
                "is_remote_session": True,
                "is_rdp_session": True,
                "idle_seconds": 8,
                "input_desktop_name": "Default",
                "session_connect_state": "Active",
            },
            "foreground_window": {
                "collected_at": "2026-05-11T12:00:00Z",
                "process_name": "Cursor.exe",
                "window_title": "ignored",
            },
            "input_activity": {
                "collected_from": "2026-05-11T11:59:00Z",
                "collected_to": "2026-05-11T12:00:00Z",
                "keyboard_event_count": 10,
                "mouse_event_count": 12,
                "mouse_move_count": 6,
                "mouse_click_count": 4,
                "mouse_wheel_count": 1,
                "window_switch_count": 2,
            },
        },
    )
    assert heartbeat_response.status_code == 200

    with Session(app.state.engine) as session:
        employee = session.get(Employee, employee_id)
        assert employee is not None
        employee.job_role = "Engineer"
        employee.manager_name = "Dana"
        session.add(employee)

        inactive_policy = Policy(
            name="legacy",
            version="0.0.1",
            screenshot_interval_seconds=30,
            no_change_threshold=10,
            retention_days=7,
            is_active=False,
        )
        session.add(inactive_policy)
        session.commit()

    employees_response = client.get("/api/employees")
    devices_response = client.get("/api/devices")
    policies_response = client.get("/api/policies")

    assert employees_response.status_code == 200
    employees_payload = employees_response.json()
    assert employees_payload["total"] == 1
    assert employees_payload["items"][0]["id"] == str(employee_id)
    assert employees_payload["items"][0]["job_role"] == "Engineer"
    assert employees_payload["items"][0]["manager_name"] == "Dana"
    assert employees_payload["items"][0]["active_device_count"] == 1
    assert employees_payload["items"][0]["policy_summary"]["version"] == "mvp"

    assert devices_response.status_code == 200
    devices_payload = devices_response.json()
    assert devices_payload["total"] == 1
    assert devices_payload["items"][0]["id"] == str(device_id)
    assert devices_payload["items"][0]["employee_name"] == "Alice"
    assert devices_payload["items"][0]["last_foreground_window"]["process_name"] == "Cursor.exe"
    assert devices_payload["items"][0]["last_session_state"]["is_rdp_session"] is True
    assert devices_payload["items"][0]["last_input_activity"]["mouse_wheel_count"] == 1

    assert policies_response.status_code == 200
    policies_payload = policies_response.json()
    assert policies_payload["total"] == 2
    assert policies_payload["items"][0]["is_active"] is True
    assert policies_payload["items"][0]["rules_json"] == {}
    assert policies_payload["items"][1]["version"] == "0.0.1"


def test_policy_crud_and_activation_write_audit_logs(client: TestClient) -> None:
    create_response = client.post(
        "/api/policies",
        json={
            "name": "engineering-focus",
            "version": "2026.05",
            "screenshot_interval_seconds": 15,
            "no_change_threshold": 4,
            "retention_days": 21,
            "is_active": False,
            "rules_json": {
                "roles": ["Engineer"],
                "departments": ["Engineering"],
                "positions": ["Senior Engineer"],
            },
        },
    )

    assert create_response.status_code == 201
    created_policy = create_response.json()
    assert created_policy["is_active"] is False
    assert created_policy["rules_json"] == {
        "roles": ["engineer"],
        "departments": ["engineering"],
        "positions": ["senior engineer"],
    }

    update_response = client.put(
        f"/api/policies/{created_policy['id']}",
        json={
            "version": "2026.05.1",
            "retention_days": 28,
            "rules_json": {
                "roles": ["Engineer", "Lead Engineer"],
                "departments": ["Engineering"],
            },
        },
    )

    assert update_response.status_code == 200
    updated_policy = update_response.json()
    assert updated_policy["version"] == "2026.05.1"
    assert updated_policy["retention_days"] == 28
    assert updated_policy["rules_json"] == {
        "roles": ["engineer", "lead engineer"],
        "departments": ["engineering"],
    }

    activation_response = client.post(
        f"/api/policies/{created_policy['id']}/activation",
        json={"is_active": True},
    )

    assert activation_response.status_code == 200
    activated_policy = activation_response.json()
    assert activated_policy["is_active"] is True

    with Session(client.app.state.engine) as session:
        persisted_policy = session.get(Policy, UUID(created_policy["id"]))
        assert persisted_policy is not None
        assert persisted_policy.version == "2026.05.1"
        assert persisted_policy.is_active is True
        assert persisted_policy.rules_json == {
            "roles": ["engineer", "lead engineer"],
            "departments": ["engineering"],
        }

        audit_logs = session.exec(select(AuditLog).order_by(AuditLog.created_at.asc())).all()
        assert [audit.action for audit in audit_logs] == [
            "policy.created",
            "policy.updated",
            "policy.activated",
        ]
        assert all(audit.target_id == persisted_policy.id for audit in audit_logs)
        assert all(audit.target_type == "policy" for audit in audit_logs)
        assert all(audit.ip_address == "testclient" for audit in audit_logs)
        assert all(audit.user_agent is not None for audit in audit_logs)

    audit_response = client.get("/api/audit-logs")
    assert audit_response.status_code == 200
    audit_payload = audit_response.json()
    assert audit_payload["total"] == 3
    assert audit_payload["items"][0]["action"] == "policy.activated"
    assert audit_payload["items"][0]["target_type"] == "policy"


def test_event_review_updates_status_and_note(client: TestClient, seeded_device: dict[str, str]) -> None:
    app = client.app
    event_id = uuid4()

    with Session(app.state.engine) as session:
        event = BehaviorEvent(
            id=event_id,
            employee_id=UUID(seeded_device["employee_id"]),
            device_id=UUID(seeded_device["device_id"]),
            event_type="manual_review_needed",
            severity="medium",
            start_at=datetime(2026, 5, 11, 13, 0, tzinfo=timezone.utc),
            streak_count=0,
            status="open",
            details_json={"source": "test"},
        )
        session.add(event)
        session.commit()

    response = client.post(
        f"/api/events/{event_id}/review",
        json={"status": "reviewed", "review_note": "Confirmed benign activity."},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "reviewed"
    assert payload["review_note"] == "Confirmed benign activity."
    assert payload["reviewed_at"] is not None

    with Session(app.state.engine) as session:
        event = session.get(BehaviorEvent, event_id)
        assert event is not None
        assert event.status == "reviewed"
        assert event.review_note == "Confirmed benign activity."
        assert event.reviewed_at is not None

        audit_logs = session.exec(
            select(AuditLog).where(AuditLog.target_id == event_id).order_by(AuditLog.created_at.asc())
        ).all()
        assert len(audit_logs) == 1
        assert audit_logs[0].action == "event.reviewed"
        assert audit_logs[0].target_type == "behavior_event"
        assert audit_logs[0].reason == "Confirmed benign activity."


def test_sqlite_schema_ensure_adds_new_columns_to_existing_db(tmp_path: Path) -> None:
    database_path = tmp_path / "legacy.db"
    connection = sqlite3.connect(database_path)
    connection.executescript(
        """
        CREATE TABLE employees (
            id TEXT PRIMARY KEY,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            name TEXT NOT NULL,
            employee_no TEXT NOT NULL,
            department TEXT,
            manager_id TEXT,
            github_username TEXT,
            status TEXT NOT NULL
        );
        CREATE TABLE devices (
            id TEXT PRIMARY KEY,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            employee_id TEXT,
            hostname TEXT NOT NULL,
            os_type TEXT,
            agent_version TEXT NOT NULL,
            screen_count INTEGER NOT NULL,
            last_heartbeat_at TEXT,
            status TEXT NOT NULL
        );
        CREATE TABLE screenshots (
            id TEXT PRIMARY KEY,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            employee_id TEXT NOT NULL,
            device_id TEXT NOT NULL,
            captured_at TEXT NOT NULL,
            screen_index INTEGER NOT NULL,
            image_uri TEXT,
            thumb_uri TEXT,
            width INTEGER NOT NULL,
            height INTEGER NOT NULL,
            foreground_process TEXT,
            window_title TEXT,
            keyboard_count INTEGER NOT NULL,
            mouse_click_count INTEGER NOT NULL,
            mouse_move_count INTEGER NOT NULL,
            is_locked BOOLEAN NOT NULL,
            is_remote_session BOOLEAN NOT NULL,
            phash TEXT,
            upload_status TEXT NOT NULL,
            ocr_status TEXT NOT NULL,
            analysis_status TEXT NOT NULL
        );
        """
    )
    connection.commit()
    connection.close()

    settings = Settings(
        database_url=f"sqlite:///{database_path}",
        environment="test",
        storage_root_dir=str(tmp_path / "storage"),
    )
    app = create_app(settings)
    with TestClient(app):
        pass

    connection = sqlite3.connect(database_path)
    try:
        employee_columns = {row[1] for row in connection.execute("PRAGMA table_info(employees)").fetchall()}
        device_columns = {row[1] for row in connection.execute("PRAGMA table_info(devices)").fetchall()}
        screenshot_columns = {row[1] for row in connection.execute("PRAGMA table_info(screenshots)").fetchall()}
    finally:
        connection.close()

    assert {"manager_name", "job_role"} <= employee_columns
    assert {
        "last_foreground_window_json",
        "last_session_state_json",
        "last_input_activity_json",
    } <= device_columns
    assert {
        "mouse_wheel_count",
        "window_switch_count",
        "is_rdp_session",
        "idle_seconds",
        "input_desktop_name",
        "session_connect_state",
    } <= screenshot_columns
