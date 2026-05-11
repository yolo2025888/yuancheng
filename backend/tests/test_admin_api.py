from __future__ import annotations

import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import UUID, uuid4

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.api.deps import get_current_auth_principal
from app.core.config import Settings
from app.main import create_app
from app.models import AuditLog, AttendanceRecord, BehaviorEvent, Device, Employee, Policy, Role, Screenshot, User
from app.services.agent_auth import create_device_agent_token, generate_device_agent_secret, hash_device_agent_secret
from app.services.auth import AuthenticatedPrincipal, hash_password


def test_attendance_clock_records_are_listed_with_anomaly_status(
    client: TestClient,
    seeded_device: dict[str, str],
    auth_headers,
    agent_headers: dict[str, str],
) -> None:
    headers = auth_headers(bootstrap=True)

    late_response = client.post(
        "/api/agent/attendance",
        headers=agent_headers,
        json={
            "user_name": "Alice",
            "employee_no": "E-001",
            "machine_name": "DEV-PC-001",
            "event_type": "clock_in",
            "occurred_at": "2026-05-12T09:47:00+08:00",
            "source": "launcher",
        },
    )
    normal_response = client.post(
        "/api/agent/attendance",
        headers=agent_headers,
        json={
            "user_name": "Alice",
            "employee_no": "E-001",
            "machine_name": "DEV-PC-001",
            "event_type": "clock_out",
            "occurred_at": "2026-05-12T18:12:00+08:00",
            "source": "launcher",
        },
    )

    assert late_response.status_code == 201
    assert normal_response.status_code == 201
    assert late_response.json()["anomaly_status"] == "late"
    assert late_response.json()["review_status"] == "pending"
    assert normal_response.json()["anomaly_status"] == "normal"
    assert normal_response.json()["review_status"] == "reviewed"

    list_response = client.get("/api/attendance?work_date=2026-05-12", headers=headers)

    assert list_response.status_code == 200
    payload = list_response.json()
    assert payload["total"] == 2
    assert payload["items"][0]["employee_name"] == "Alice"
    assert {item["anomaly_status"] for item in payload["items"]} == {"late", "normal"}

    review_response = client.post(
        f"/api/attendance/{late_response.json()['id']}/review",
        headers=headers,
        json={"review_status": "confirmed", "review_note": "Manager approved late arrival reason."},
    )

    assert review_response.status_code == 200
    assert review_response.json()["review_status"] == "confirmed"
    assert review_response.json()["review_note"] == "Manager approved late arrival reason."


def test_admin_list_apis_return_employees_devices_and_policies(
    client: TestClient,
    seeded_device: dict[str, str],
    auth_headers,
    agent_headers: dict[str, str],
) -> None:
    headers = auth_headers(bootstrap=True)
    app = client.app
    employee_id = UUID(seeded_device["employee_id"])
    device_id = UUID(seeded_device["device_id"])

    heartbeat_response = client.post(
        "/api/agent/heartbeat",
        headers=agent_headers,
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

    employees_response = client.get("/api/employees", headers=headers)
    devices_response = client.get("/api/devices", headers=headers)
    policies_response = client.get("/api/policies", headers=headers)

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
    assert devices_payload["items"][0]["agent_token_expires_at"] is not None
    assert devices_payload["items"][0]["agent_token_last_used_at"] is not None

    assert policies_response.status_code == 200
    policies_payload = policies_response.json()
    assert policies_payload["total"] == 2
    assert policies_payload["items"][0]["is_active"] is True
    assert policies_payload["items"][0]["rules_json"] == {}
    assert policies_payload["items"][1]["version"] == "0.0.1"


def test_device_agent_token_can_be_issued_used_and_revoked(
    client: TestClient,
    seeded_device: dict[str, str],
    auth_headers,
) -> None:
    headers = auth_headers(bootstrap=True)
    blocked_headers = auth_headers(
        username="device.token.blocked",
        password="blocked-password",
        role_name="No Directory",
    )

    blocked_response = client.post(
        f"/api/devices/{seeded_device['device_id']}/agent-token",
        headers=blocked_headers,
    )
    issue_response = client.post(
        f"/api/devices/{seeded_device['device_id']}/agent-token",
        headers=headers,
    )

    assert blocked_response.status_code == 403
    assert issue_response.status_code == 200
    issued = issue_response.json()
    issued_token = issued["token"]
    assert issued["device_id"] == seeded_device["device_id"]
    assert issued_token.startswith(f"v2:{seeded_device['device_id']}:")
    assert issued["expires_at"] is not None

    with Session(client.app.state.engine) as session:
        device = session.get(Device, UUID(seeded_device["device_id"]))
        assert device is not None
        assert device.agent_token_hash is not None
        assert issued_token.split(":", maxsplit=2)[2] not in device.agent_token_hash
        assert device.agent_token_revoked_at is None
        assert device.agent_token_expires_at is not None
        assert device.agent_token_last_used_at is None
        issued_audit = session.exec(
            select(AuditLog).where(AuditLog.action == "device.agent_token.issued")
        ).first()
        assert issued_audit is not None
        assert issued_audit.target_id == device.id

    policy_response = client.get(
        "/api/agent/policy",
        headers={"Authorization": f"Bearer {issued_token}"},
        params={"device_id": seeded_device["device_id"]},
    )
    revoke_response = client.post(
        f"/api/devices/{seeded_device['device_id']}/agent-token/revoke",
        headers=headers,
    )
    revoked_policy_response = client.get(
        "/api/agent/policy",
        headers={"Authorization": f"Bearer {issued_token}"},
        params={"device_id": seeded_device["device_id"]},
    )
    devices_response = client.get("/api/devices", headers=headers)

    assert policy_response.status_code == 200
    assert revoke_response.status_code == 200
    assert revoked_policy_response.status_code == 401
    assert revoked_policy_response.json()["detail"] == "Invalid agent token"
    device_item = devices_response.json()["items"][0]
    assert device_item["has_agent_token"] is True
    assert device_item["agent_token_expires_at"] is not None
    assert device_item["agent_token_last_used_at"] is not None
    assert device_item["agent_token_revoked_at"] is not None

    with Session(client.app.state.engine) as session:
        device = session.get(Device, UUID(seeded_device["device_id"]))
        assert device is not None
        assert device.agent_token_last_used_at is not None
        revoked_audit = session.exec(
            select(AuditLog).where(AuditLog.action == "device.agent_token.revoked")
        ).first()
        assert revoked_audit is not None
        assert revoked_audit.target_id == UUID(seeded_device["device_id"])


def test_device_agent_token_endpoints_reject_directory_manage_without_device_tokens_manage(
    client: TestClient,
    seeded_device: dict[str, str],
) -> None:
    app = client.app
    principal = AuthenticatedPrincipal(
        user=User(
            username="directory.operator",
            password_hash="placeholder",
            status="active",
        ),
        role_name="Directory Operator",
        permissions={"directory.manage"},
    )

    app.dependency_overrides[get_current_auth_principal] = lambda: principal
    try:
        issue_response = client.post(f"/api/devices/{seeded_device['device_id']}/agent-token")
        revoke_response = client.post(f"/api/devices/{seeded_device['device_id']}/agent-token/revoke")
    finally:
        app.dependency_overrides.pop(get_current_auth_principal, None)

    assert issue_response.status_code == 403
    assert revoke_response.status_code == 403
    assert issue_response.json()["detail"] == "Missing permissions: device_tokens.manage"
    assert revoke_response.json()["detail"] == "Missing permissions: device_tokens.manage"


def test_compliance_role_can_issue_and_revoke_device_agent_token(
    client: TestClient,
    seeded_device: dict[str, str],
    auth_headers,
) -> None:
    headers = auth_headers(
        username="compliance.device.tokens",
        password="compliance-password",
        role_name="Compliance",
    )

    issue_response = client.post(
        f"/api/devices/{seeded_device['device_id']}/agent-token",
        headers=headers,
    )
    revoke_response = client.post(
        f"/api/devices/{seeded_device['device_id']}/agent-token/revoke",
        headers=headers,
    )

    assert issue_response.status_code == 200
    assert revoke_response.status_code == 200


def test_device_agent_token_revoke_requires_device_tokens_manage_permission(
    client: TestClient,
    seeded_device: dict[str, str],
    auth_headers,
) -> None:
    headers = auth_headers(bootstrap=True)
    blocked_headers = auth_headers(
        username="device.token.revoke.blocked",
        password="blocked-password",
        role_name="No Directory",
    )

    issue_response = client.post(
        f"/api/devices/{seeded_device['device_id']}/agent-token",
        headers=headers,
    )
    blocked_response = client.post(
        f"/api/devices/{seeded_device['device_id']}/agent-token/revoke",
        headers=blocked_headers,
    )

    assert issue_response.status_code == 200
    assert blocked_response.status_code == 403

    with Session(client.app.state.engine) as session:
        device = session.get(Device, UUID(seeded_device["device_id"]))
        assert device is not None
        assert device.agent_token_revoked_at is None
        revoked_audit = session.exec(
            select(AuditLog).where(AuditLog.action == "device.agent_token.revoked")
        ).first()
        assert revoked_audit is None


def test_reissuing_device_agent_token_rotates_secret_and_invalidates_old_token(
    client: TestClient,
    seeded_device: dict[str, str],
    auth_headers,
) -> None:
    headers = auth_headers(bootstrap=True)

    first_issue_response = client.post(
        f"/api/devices/{seeded_device['device_id']}/agent-token",
        headers=headers,
    )
    second_issue_response = client.post(
        f"/api/devices/{seeded_device['device_id']}/agent-token",
        headers=headers,
    )

    assert first_issue_response.status_code == 200
    assert second_issue_response.status_code == 200

    first_token = first_issue_response.json()["token"]
    second_token = second_issue_response.json()["token"]
    assert first_token != second_token
    assert first_issue_response.json().keys() == {"device_id", "token", "issued_at", "expires_at"}
    assert second_issue_response.json().keys() == {"device_id", "token", "issued_at", "expires_at"}

    first_policy_response = client.get(
        "/api/agent/policy",
        headers={"Authorization": f"Bearer {first_token}"},
        params={"device_id": seeded_device["device_id"]},
    )
    second_policy_response = client.get(
        "/api/agent/policy",
        headers={"Authorization": f"Bearer {second_token}"},
        params={"device_id": seeded_device["device_id"]},
    )

    assert first_policy_response.status_code == 401
    assert first_policy_response.json()["detail"] == "Invalid agent token"
    assert second_policy_response.status_code == 200

    second_secret = second_token.split(":", maxsplit=2)[2]
    with Session(client.app.state.engine) as session:
        device = session.get(Device, UUID(seeded_device["device_id"]))
        assert device is not None
        assert device.agent_token_hash == hash_device_agent_secret(second_secret)
        assert device.agent_token_hash != second_token
        assert second_secret not in device.agent_token_hash


def test_policy_crud_and_activation_write_audit_logs(client: TestClient, auth_headers) -> None:
    headers = auth_headers(bootstrap=True)
    create_response = client.post(
        "/api/policies",
        headers=headers,
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
        headers=headers,
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
        headers=headers,
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

    audit_response = client.get("/api/audit-logs", headers=headers)
    assert audit_response.status_code == 200
    audit_payload = audit_response.json()
    assert audit_payload["total"] == 3
    assert audit_payload["items"][0]["action"] == "policy.activated"
    assert audit_payload["items"][0]["target_type"] == "policy"


def test_event_review_updates_status_and_note(client: TestClient, seeded_device: dict[str, str], auth_headers) -> None:
    headers = auth_headers(bootstrap=True)
    app = client.app
    event_id = uuid4()

    with Session(app.state.engine) as session:
        reviewer = session.exec(select(User).where(User.username == app.state.settings.bootstrap_admin_username)).one()
        reviewer_id = reviewer.id
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
        headers=headers,
        json={"status": "reviewed", "review_note": "Confirmed benign activity."},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "reviewed"
    assert payload["review_note"] == "Confirmed benign activity."
    assert payload["reviewed_at"] is not None
    assert payload["reviewed_by"] == str(reviewer_id)
    assert payload["reviewer_name"] == "Dev Admin"
    assert payload["reviewer_username"] == app.state.settings.bootstrap_admin_username

    with Session(app.state.engine) as session:
        event = session.get(BehaviorEvent, event_id)
        assert event is not None
        assert event.status == "reviewed"
        assert event.review_note == "Confirmed benign activity."
        assert event.reviewed_at is not None
        assert event.reviewed_by == reviewer_id

        audit_logs = session.exec(
            select(AuditLog).where(AuditLog.target_id == event_id).order_by(AuditLog.created_at.asc())
        ).all()
        assert len(audit_logs) == 1
        assert audit_logs[0].action == "event.reviewed"
        assert audit_logs[0].target_type == "behavior_event"
        assert audit_logs[0].reason == "Confirmed benign activity."

    list_response = client.get("/api/events", headers=headers)
    assert list_response.status_code == 200
    listed_event = next(item for item in list_response.json()["items"] if item["id"] == str(event_id))
    assert listed_event["reviewed_by"] == str(reviewer_id)
    assert listed_event["reviewer_name"] == "Dev Admin"
    assert listed_event["reviewer_username"] == app.state.settings.bootstrap_admin_username


def test_events_endpoint_filters_reviewable_status_and_severity(
    client: TestClient,
    seeded_device: dict[str, str],
    auth_headers,
) -> None:
    headers = auth_headers(bootstrap=True)
    employee_id = UUID(seeded_device["employee_id"])
    device_id = UUID(seeded_device["device_id"])

    with Session(client.app.state.engine) as session:
        for event_type, severity, status_value in (
            ("needs_attention", "high", "open"),
            ("active_review", "medium", "reviewing"),
            ("already_done", "high", "reviewed"),
            ("low_signal", "low", "open"),
        ):
            session.add(
                BehaviorEvent(
                    employee_id=employee_id,
                    device_id=device_id,
                    event_type=event_type,
                    severity=severity,
                    start_at=datetime(2026, 5, 11, 13, 0, tzinfo=timezone.utc),
                    status=status_value,
                    details_json={},
                )
            )
        session.commit()

    reviewable_response = client.get("/api/events?status=reviewable", headers=headers)
    high_reviewable_response = client.get("/api/events?status=reviewable&severity=high", headers=headers)

    assert reviewable_response.status_code == 200
    assert {item["event_type"] for item in reviewable_response.json()["items"]} == {
        "needs_attention",
        "active_review",
        "low_signal",
    }
    assert high_reviewable_response.status_code == 200
    assert [item["event_type"] for item in high_reviewable_response.json()["items"]] == ["needs_attention"]


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
        "activity_type",
        "active_app",
        "activity_confidence",
        "activity_summary",
        "activity_evidence_json",
    } <= screenshot_columns


def test_dashboard_summary_reports_real_counts_and_top_risks(
    client: TestClient,
    seeded_device: dict[str, str],
    auth_headers,
) -> None:
    headers = auth_headers(bootstrap=True)
    app = client.app
    now = datetime.now(timezone.utc)
    alice_id = UUID(seeded_device["employee_id"])
    alice_device_id = UUID(seeded_device["device_id"])
    bob_id = uuid4()
    bob_device_id = uuid4()

    with Session(app.state.engine) as session:
        alice = session.get(Employee, alice_id)
        assert alice is not None
        alice.job_role = "Engineer"
        alice.department = "Engineering"

        bob = Employee(
            id=bob_id,
            name="Bob",
            employee_no="E-002",
            department="Support",
            job_role="Support Specialist",
            status="active",
        )
        bob_device = Device(
            id=bob_device_id,
            employee_id=bob_id,
            hostname="SUP-PC-002",
            os_type="windows",
            agent_version="0.1.0",
            screen_count=1,
            last_heartbeat_at=now,
            status="offline",
        )
        targeted_policy = Policy(
            name="engineering-ops",
            version="2026.05",
            screenshot_interval_seconds=10,
            no_change_threshold=4,
            retention_days=30,
            is_active=True,
            rules_json={"roles": ["engineer"], "departments": ["engineering"]},
        )
        screenshot = Screenshot(
            employee_id=alice_id,
            device_id=alice_device_id,
            captured_at=now.replace(microsecond=0) - timedelta(minutes=20),
            screen_index=0,
            image_uri="/storage/screens/alice.png",
            thumb_uri="/storage/thumbs/alice.png",
            width=1920,
            height=1080,
            foreground_process="Cursor.exe",
            window_title="Project Dashboard",
            keyboard_count=12,
            mouse_click_count=4,
            mouse_move_count=8,
            mouse_wheel_count=1,
            window_switch_count=2,
            is_locked=False,
            is_remote_session=False,
            is_rdp_session=False,
            idle_seconds=12,
            upload_status="uploaded",
            ocr_status="skipped",
            analysis_status="complete",
        )
        event = BehaviorEvent(
            employee_id=alice_id,
            device_id=alice_device_id,
            event_type="no_change_streak_triggered",
            severity="high",
            start_at=now.replace(microsecond=0) - timedelta(minutes=30),
            streak_count=6,
            status="open",
            reason="No visual changes detected across repeated captures.",
            details_json={"screen_index": 0},
        )
        session.add(bob)
        session.add(bob_device)
        session.add(targeted_policy)
        session.add(screenshot)
        session.add(event)
        session.commit()

    response = client.get("/api/dashboard/summary", headers=headers)

    assert response.status_code == 200
    payload = response.json()
    assert payload["employee_count"] == 2
    assert payload["active_employee_count"] == 2
    assert payload["device_count"] == 2
    assert payload["online_device_count"] == 1
    assert payload["stale_device_count"] == 0
    assert payload["offline_device_count"] == 1
    assert payload["screenshot_count_24h"] == 1
    assert payload["open_event_count"] == 1
    assert payload["unresolved_high_risk_event_count"] == 1
    assert payload["policy_coverage"] == {
        "active_policy_count": 2,
        "targeted_active_policy_count": 1,
        "employees_with_targeted_policy": 1,
        "employees_default_only": 1,
    }
    assert payload["risk_distribution"]["high"] == 1
    assert payload["risk_distribution"]["medium"] == 1
    assert payload["top_risks"][0]["employee_name"] == "Alice"
    assert payload["top_risks"][0]["label"] == "high"
    assert any("No-change activity" in reason for reason in payload["top_risks"][0]["reasons"])


def test_risk_scores_endpoint_returns_transparent_employee_scores(
    client: TestClient,
    seeded_device: dict[str, str],
    auth_headers,
) -> None:
    headers = auth_headers(bootstrap=True)
    app = client.app
    now = datetime.now(timezone.utc).replace(microsecond=0)
    employee_id = UUID(seeded_device["employee_id"])
    device_id = UUID(seeded_device["device_id"])

    with Session(app.state.engine) as session:
        employee = session.get(Employee, employee_id)
        assert employee is not None
        employee.job_role = "Engineer"
        employee.department = "Engineering"

        device = session.get(Device, device_id)
        assert device is not None
        device.last_heartbeat_at = now - timedelta(minutes=45)
        device.status = "online"

        policy = Policy(
            name="sales-only",
            version="2026.05",
            screenshot_interval_seconds=15,
            no_change_threshold=4,
            retention_days=30,
            is_active=True,
            rules_json={"roles": ["sales"]},
        )
        event = BehaviorEvent(
            employee_id=employee_id,
            device_id=device_id,
            event_type="no_change_streak_triggered",
            severity="high",
            start_at=now - timedelta(hours=1),
            streak_count=7,
            status="open",
            reason="Repeated identical screenshots exceeded threshold.",
            details_json={"screen_index": 0, "threshold": 4},
        )
        session.add(policy)
        session.add(event)
        session.commit()

    response = client.get("/api/risk/scores", params={"limit": 1}, headers=headers)

    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == 1
    assert len(payload["items"]) == 1
    item = payload["items"][0]
    assert item["employee_id"] == str(employee_id)
    assert item["employee_name"] == "Alice"
    assert item["score"] >= 75
    assert item["label"] == "critical"
    assert item["open_event_count"] == 1
    assert item["high_severity_event_count"] == 1
    assert item["stalled_event_count"] == 1
    assert item["policy_name"] == "default"
    assert item["policy_version"] == "mvp"
    assert item["has_targeted_policy"] is False
    factor_codes = {factor["code"] for factor in item["factors"]}
    assert {
        "behavior_events",
        "no_change_streak",
        "heartbeat_aged",
        "screenshot_missing",
        "policy_coverage",
    } <= factor_codes
    assert all(isinstance(reason, str) and reason for reason in item["reasons"])


def test_github_risks_endpoint_maps_github_behavior_events(
    client: TestClient,
    seeded_device: dict[str, str],
    auth_headers,
) -> None:
    headers = auth_headers(bootstrap=True)
    app = client.app
    employee_id = UUID(seeded_device["employee_id"])
    device_id = UUID(seeded_device["device_id"])

    with Session(app.state.engine) as session:
        employee = session.get(Employee, employee_id)
        assert employee is not None
        employee.github_username = "alice-dev"
        session.add(employee)
        session.add(
            BehaviorEvent(
                employee_id=employee_id,
                device_id=device_id,
                event_type="github_sensitive_repo_clone",
                severity="critical",
                start_at=datetime(2026, 5, 11, 10, 15, tzinfo=timezone.utc),
                status="open",
                reason="Sensitive repository cloned repeatedly.",
                details_json={
                    "repository": "corp/infra-secrets",
                    "action": "clone",
                    "risk_rule": "Sensitive repository clone",
                    "correlation": "Linked to DEV-PC-001",
                },
            )
        )
        session.add(
            BehaviorEvent(
                employee_id=employee_id,
                device_id=device_id,
                event_type="github_frequent_fetch",
                severity="high",
                start_at=datetime(2026, 5, 11, 10, 45, tzinfo=timezone.utc),
                status="reviewing",
                reason="Frequent fetch burst.",
                details_json={
                    "repository": "corp/core-platform",
                    "action": "fetch",
                    "risk_rule": "Short-window frequent fetch",
                },
            )
        )
        session.add(
            BehaviorEvent(
                employee_id=employee_id,
                device_id=device_id,
                event_type="no_change_streak_triggered",
                severity="medium",
                start_at=datetime(2026, 5, 11, 11, 0, tzinfo=timezone.utc),
                status="open",
                reason="Unrelated event",
                details_json={},
            )
        )
        session.commit()

    response = client.get("/api/github-risks", headers=headers)

    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == 2
    assert payload["trend"] == [{"bucket": "10:00", "count": 2}]
    assert payload["items"][0]["repository"] == "corp/core-platform"
    assert payload["items"][0]["action"] == "fetch"
    assert payload["items"][0]["risk_rule"] == "Short-window frequent fetch"
    assert payload["items"][0]["employee_name"] == "Alice"
    assert payload["items"][0]["github_username"] == "alice-dev"
    assert payload["items"][1]["severity"] == "critical"
    assert payload["items"][1]["correlation"] == "Linked to DEV-PC-001"


def test_review_queue_endpoint_prioritizes_open_events_and_stale_devices(
    client: TestClient,
    seeded_device: dict[str, str],
    auth_headers,
) -> None:
    headers = auth_headers(bootstrap=True)
    employee_id = UUID(seeded_device["employee_id"])
    device_id = UUID(seeded_device["device_id"])
    stale_device_id = uuid4()

    with Session(client.app.state.engine) as session:
        device = session.get(Device, device_id)
        assert device is not None
        device.status = "online"
        device.last_heartbeat_at = datetime.now(timezone.utc)
        session.add(device)
        session.add(
            BehaviorEvent(
                employee_id=employee_id,
                device_id=device_id,
                event_type="github_sensitive_repo_clone",
                severity="critical",
                start_at=datetime.now(timezone.utc) - timedelta(minutes=2),
                status="open",
                reason="Sensitive repository cloned repeatedly.",
                details_json={
                    "repository": "corp/infra-secrets",
                    "risk_rule": "Sensitive repository clone",
                    "token": "ghp_should_not_persist",
                },
            )
        )
        session.add(
            BehaviorEvent(
                employee_id=employee_id,
                device_id=device_id,
                event_type="no_change_streak_triggered",
                severity="high",
                start_at=datetime.now(timezone.utc) - timedelta(minutes=1),
                status="resolved",
                reason="Already resolved.",
                details_json={},
            )
        )
        session.add(
            Device(
                id=stale_device_id,
                employee_id=employee_id,
                hostname="DEV-PC-STALE",
                os_type="windows",
                agent_version="0.1.0",
                screen_count=1,
                last_heartbeat_at=datetime.now(timezone.utc) - timedelta(minutes=45),
                status="online",
            )
        )
        session.commit()

    response = client.get("/api/review-queue", headers=headers)

    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == 2
    assert [item["item_type"] for item in payload["items"]] == ["behavior_event", "device_health"]
    assert payload["items"][0]["title"] == "Sensitive repository clone"
    assert payload["items"][0]["is_actionable"] is True
    assert payload["items"][0]["event_type"] == "github_sensitive_repo_clone"
    assert payload["items"][0]["employee_name"] == "Alice"
    assert payload["items"][0]["details_json"]["repository"] == "corp/infra-secrets"
    assert payload["items"][0]["details_json"]["token"] == "[redacted]"
    assert payload["items"][1]["is_actionable"] is False
    assert payload["items"][1]["device_hostname"] == "DEV-PC-STALE"
    assert payload["items"][1]["severity"] == "high"

    limited_response = client.get("/api/review-queue?limit=1", headers=headers)
    assert limited_response.status_code == 200
    assert limited_response.json()["total"] == 2
    assert len(limited_response.json()["items"]) == 1


def test_review_queue_requires_event_review_permission(
    client: TestClient,
    auth_headers,
) -> None:
    headers = auth_headers(role_name="Manager")

    response = client.get("/api/review-queue", headers=headers)

    assert response.status_code == 403


def test_review_queue_limit_is_applied_after_priority_sort(
    client: TestClient,
    seeded_device: dict[str, str],
    auth_headers,
) -> None:
    headers = auth_headers(bootstrap=True)
    employee_id = UUID(seeded_device["employee_id"])
    device_id = UUID(seeded_device["device_id"])
    now = datetime.now(timezone.utc)

    with Session(client.app.state.engine) as session:
        for minutes_ago, severity, reason in (
            (1, "medium", "Recent medium review"),
            (2, "medium", "Second recent medium review"),
            (100, "critical", "Older critical review"),
        ):
            session.add(
                BehaviorEvent(
                    employee_id=employee_id,
                    device_id=device_id,
                    event_type="priority_test",
                    severity=severity,
                    start_at=now - timedelta(minutes=minutes_ago),
                    status="open",
                    reason=reason,
                    details_json={},
                )
            )
        session.commit()

    response = client.get("/api/review-queue?limit=2", headers=headers)

    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == 3
    assert payload["items"][0]["severity"] == "critical"
    assert payload["items"][0]["reason"] == "Older critical review"


def test_github_risk_create_endpoint_records_sanitized_behavior_event(
    client: TestClient,
    seeded_device: dict[str, str],
    auth_headers,
) -> None:
    headers = auth_headers(bootstrap=True)
    employee_id = seeded_device["employee_id"]
    device_id = seeded_device["device_id"]

    response = client.post(
        "/api/github-risks",
        headers=headers,
        json={
            "employee_id": employee_id,
            "device_id": device_id,
            "repository": "corp/infra-secrets",
            "action": "clone",
            "risk_rule": "Sensitive repository clone",
            "severity": "critical",
            "occurred_at": "2026-05-11T10:15:00Z",
            "correlation": "Linked to DEV-PC-001",
            "details_json": {
                "source": "github_audit",
                "token": "ghp_should_not_persist",
                "actor_email": "alice@example.test",
                "request_url": "https://github.example.test/org/repo?token=secret",
                "attempts": 3,
            },
        },
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["repository"] == "corp/infra-secrets"
    assert payload["action"] == "clone"
    assert payload["risk_rule"] == "Sensitive repository clone"
    assert payload["severity"] == "critical"
    assert payload["status"] == "open"
    assert payload["github_username"] is None
    assert payload["details_json"]["source"] == "github_audit"
    assert payload["details_json"]["attempts"] == 3
    assert payload["details_json"]["token"] == "[redacted]"
    assert payload["details_json"]["actor_email"] == "[redacted]"
    assert payload["details_json"]["request_url"] == "[redacted]"

    list_response = client.get("/api/github-risks", headers=headers)
    assert list_response.status_code == 200
    list_payload = list_response.json()
    assert list_payload["total"] == 1
    assert list_payload["items"][0]["id"] == payload["id"]

    with Session(client.app.state.engine) as session:
        audit = session.exec(select(AuditLog).where(AuditLog.action == "github_risk.created")).first()
        assert audit is not None
        assert audit.target_id == UUID(payload["id"])


def test_github_risk_create_requires_manage_permission(
    client: TestClient,
    seeded_device: dict[str, str],
    auth_headers,
) -> None:
    headers = auth_headers(role_name="Manager")

    response = client.post(
        "/api/github-risks",
        headers=headers,
        json={
            "employee_id": seeded_device["employee_id"],
            "device_id": seeded_device["device_id"],
            "repository": "corp/core-platform",
            "action": "fetch",
            "risk_rule": "Short-window frequent fetch",
            "severity": "high",
            "occurred_at": "2026-05-11T10:15:00Z",
        },
    )

    assert response.status_code == 403


def test_github_risk_create_rejects_unsupported_action_and_sensitive_correlation(
    client: TestClient,
    seeded_device: dict[str, str],
    auth_headers,
) -> None:
    headers = auth_headers(bootstrap=True)
    base_payload = {
        "employee_id": seeded_device["employee_id"],
        "device_id": seeded_device["device_id"],
        "repository": "corp/core-platform",
        "risk_rule": "Unexpected GitHub action",
        "severity": "medium",
        "occurred_at": "2026-05-11T10:15:00Z",
    }

    unsupported_response = client.post(
        "/api/github-risks",
        headers=headers,
        json={**base_payload, "action": "admin_override"},
    )
    sensitive_correlation_response = client.post(
        "/api/github-risks",
        headers=headers,
        json={**base_payload, "action": "fetch", "correlation": "https://example.test/?token=secret"},
    )

    assert unsupported_response.status_code == 422
    assert sensitive_correlation_response.status_code == 422


def test_github_risk_create_requires_authentication(
    client: TestClient,
    seeded_device: dict[str, str],
) -> None:
    response = client.post(
        "/api/github-risks",
        json={
            "employee_id": seeded_device["employee_id"],
            "device_id": seeded_device["device_id"],
            "repository": "corp/core-platform",
            "action": "fetch",
            "risk_rule": "Short-window frequent fetch",
            "severity": "high",
            "occurred_at": "2026-05-11T10:15:00Z",
        },
    )

    assert response.status_code == 401


def test_access_matrix_endpoint_returns_roles_users_and_recommended_planning_matrix(
    client: TestClient,
    auth_headers,
) -> None:
    app = client.app
    admin_role_id = uuid4()
    reviewer_role_id = uuid4()
    assigned_user_id = uuid4()
    unassigned_user_id = uuid4()

    with Session(app.state.engine) as session:
        session.add(
            Role(
                id=admin_role_id,
                name="Admin",
                description="Platform administrators",
            )
        )
        session.add(
            Role(
                id=reviewer_role_id,
                name="Reviewer",
                description="Investigates escalations",
            )
        )
        session.add(
            User(
                id=assigned_user_id,
                username="alice.admin",
                display_name="Alice Admin",
                email="alice@example.com",
                password_hash=hash_password("secret-1", iterations=client.app.state.settings.password_hash_iterations),
                role_id=admin_role_id,
                status="active",
            )
        )
        session.add(
            User(
                id=unassigned_user_id,
                username="bob.pending",
                display_name="Bob Pending",
                email="bob@example.com",
                password_hash=hash_password("secret-2", iterations=client.app.state.settings.password_hash_iterations),
                role_id=None,
                status="pending",
            )
        )
        session.commit()

    headers = auth_headers(username="alice.admin", password="secret-1", role_name="Admin", display_name="Alice Admin", email="alice@example.com")
    response = client.get("/api/access/matrix", headers=headers)
    legacy_response = client.get("/api/access-matrix", headers=headers)

    assert response.status_code == 200
    assert legacy_response.status_code == 200
    payload = response.json()
    assert legacy_response.json()["roles"] == payload["roles"]
    admin_role = next(role for role in payload["roles"] if role["name"] == "Admin")
    assert admin_role["source"] == "existing"
    assert admin_role["member_count"] == 1
    assert admin_role["users"][0]["username"] == "alice.admin"
    assert "password_hash" not in admin_role["users"][0]
    assert "dashboard.view" in admin_role["permission_keys"]
    assert "screenshots.metadata.view" in admin_role["permission_keys"]
    assert "screenshots.image.view" in admin_role["permission_keys"]

    reviewer_role = next(role for role in payload["roles"] if role["name"] == "Reviewer")
    assert reviewer_role["source"] == "existing"
    assert "events.review" in reviewer_role["permission_keys"]
    assert "screenshots.metadata.view" in reviewer_role["permission_keys"]
    assert "screenshots.image.view" not in reviewer_role["permission_keys"]

    recommended_roles = {role["name"] for role in payload["roles"] if role["source"] == "recommended"}
    assert {"Compliance", "Manager", "Risk Analyst"} <= recommended_roles
    compliance_role = next(role for role in payload["roles"] if role["name"] == "Compliance")
    assert "device_tokens.manage" in compliance_role["permission_keys"]
    assert payload["unassigned_users"] == [
        {
            "id": str(unassigned_user_id),
            "username": "bob.pending",
            "display_name": "Bob Pending",
            "email": "bob@example.com",
            "status": "pending",
        }
    ]


def test_agent_attendance_records_are_token_gated_listed_and_reviewed(
    client: TestClient,
    seeded_device: dict[str, str],
    auth_headers,
    agent_headers: dict[str, str],
) -> None:
    payload = {
        "employee_no": "E-001",
        "user_name": "Alice",
        "machine_name": "DEV-PC-001",
        "event_type": "clock_in",
        "occurred_at": "2026-05-11T10:15:00Z",
        "source": "launcher",
    }

    unauthenticated_response = client.post("/api/agent/attendance", json=payload)
    assert unauthenticated_response.status_code == 401

    create_response = client.post("/api/agent/attendance", headers=agent_headers, json=payload)
    assert create_response.status_code == 201
    created = create_response.json()
    assert created["employee_id"] == seeded_device["employee_id"]
    assert created["device_id"] == seeded_device["device_id"]
    assert created["employee_no"] == "E-001"
    assert created["employee_name"] == "Alice"
    assert created["anomaly_status"] == "late"
    assert created["review_status"] == "pending"
    assert created["anomaly_reasons"] == ["Clock-in after 09:30"]

    duplicate_payload = {
        **payload,
        "occurred_at": "2026-05-11T10:45:00Z",
    }
    duplicate_response = client.post("/api/agent/attendance", headers=agent_headers, json=duplicate_payload)
    assert duplicate_response.status_code == 201
    duplicate = duplicate_response.json()
    assert duplicate["anomaly_status"] == "duplicate_clock_in"
    assert duplicate["review_status"] == "pending"
    assert duplicate["anomaly_reasons"] == [
        "Clock-in after 09:30",
        "Duplicate clock-in for 2026-05-11",
    ]

    clock_out_payload = {
        **payload,
        "event_type": "clock_out",
        "occurred_at": "2026-05-11T18:30:00Z",
    }
    clock_out_response = client.post("/api/agent/attendance", headers=agent_headers, json=clock_out_payload)
    assert clock_out_response.status_code == 201
    duplicate_clock_out_payload = {
        **clock_out_payload,
        "occurred_at": "2026-05-11T17:45:00Z",
    }
    duplicate_clock_out_response = client.post(
        "/api/agent/attendance",
        headers=agent_headers,
        json=duplicate_clock_out_payload,
    )
    assert duplicate_clock_out_response.status_code == 201
    duplicate_clock_out = duplicate_clock_out_response.json()
    assert duplicate_clock_out["anomaly_status"] == "duplicate_clock_out"
    assert duplicate_clock_out["review_status"] == "pending"
    assert duplicate_clock_out["anomaly_reasons"] == [
        "Clock-out before 18:00",
        "Duplicate clock-out for 2026-05-11",
    ]

    manager_headers = auth_headers(
        username="attendance.manager",
        password="manager-password",
        role_name="Manager",
    )
    list_response = client.get(
        "/api/attendance",
        headers=manager_headers,
        params={"anomaly_status": "late"},
    )
    assert list_response.status_code == 200
    assert [item["id"] for item in list_response.json()["items"]] == [created["id"]]

    filtered_response = client.get(
        "/api/attendance",
        headers=manager_headers,
        params={
            "event_type": "clock_in",
            "employee_no": "E-001",
            "machine_name": "DEV-PC-001",
        },
    )
    assert filtered_response.status_code == 200
    assert [item["id"] for item in filtered_response.json()["items"]] == [duplicate["id"], created["id"]]

    manager_review_response = client.post(
        f"/api/attendance/{created['id']}/review",
        headers=manager_headers,
        json={"review_status": "confirmed", "review_note": "Manager cannot review."},
    )
    assert manager_review_response.status_code == 403

    admin_headers = auth_headers(
        username="attendance.admin",
        password="admin-password",
        role_name="Admin",
    )
    review_response = client.post(
        f"/api/attendance/{created['id']}/review",
        headers=admin_headers,
        json={"review_status": "confirmed", "review_note": "Confirmed late clock-in."},
    )
    assert review_response.status_code == 200
    reviewed = review_response.json()
    assert reviewed["review_status"] == "confirmed"
    assert reviewed["review_note"] == "Confirmed late clock-in."
    assert reviewed["reviewed_at"] is not None

    with Session(client.app.state.engine) as session:
        attendance_record = session.get(AttendanceRecord, UUID(created["id"]))
        assert attendance_record is not None
        audit_log = session.exec(
            select(AuditLog).where(AuditLog.action == "attendance.reviewed").order_by(AuditLog.created_at.desc())
        ).first()
        assert audit_log is not None
        assert audit_log.target_type == "attendance_record"
        assert attendance_record.reviewed_by == audit_log.actor_id


def test_attendance_list_resolves_employee_by_employee_no_when_id_is_missing(
    client: TestClient,
    seeded_device: dict[str, str],
    auth_headers,
) -> None:
    _ = seeded_device
    occurred_at = datetime(2026, 5, 12, 9, 40, tzinfo=timezone.utc)
    record_id = uuid4()

    with Session(client.app.state.engine) as session:
        session.add(
            AttendanceRecord(
                id=record_id,
                employee_no="E-001",
                user_name="Alice",
                machine_name="DEV-PC-001",
                event_type="clock_in",
                occurred_at=occurred_at,
                work_date=occurred_at.date(),
                anomaly_status="late",
                anomaly_reasons_json=["Clock-in after 09:30"],
                source="launcher",
            )
        )
        session.commit()

    headers = auth_headers(
        username="attendance.lookup",
        password="manager-password",
        role_name="Manager",
    )
    response = client.get(
        "/api/attendance",
        headers=headers,
        params={"employee_no": "E-001"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert [item["id"] for item in payload["items"]] == [str(record_id)]
    assert payload["items"][0]["employee_name"] == "Alice"
    assert payload["items"][0]["department"] == "Engineering"


def test_attendance_rules_endpoint_uses_view_permission(client: TestClient, auth_headers) -> None:
    manager_headers = auth_headers(
        username="attendance.rule.viewer",
        password="manager-password",
        role_name="Manager",
    )
    blocked_headers = auth_headers(
        username="attendance.rule.blocked",
        password="blocked-password",
        role_name="No Attendance",
    )

    response = client.get("/api/attendance/rules/default", headers=manager_headers)
    blocked_response = client.get("/api/attendance/rules/default", headers=blocked_headers)

    assert response.status_code == 200
    assert response.json() == {
        "name": "Default attendance rule",
        "clock_in_late_after": "09:30",
        "clock_out_early_before": "18:00",
        "timezone": "Local time",
    }
    assert blocked_response.status_code == 403


def test_attendance_rules_can_be_updated_with_manage_permission(client: TestClient, auth_headers) -> None:
    manager_headers = auth_headers(
        username="attendance.rule.manager.blocked",
        password="manager-password",
        role_name="Manager",
    )
    compliance_headers = auth_headers(
        username="attendance.rule.manager.allowed",
        password="compliance-password",
        role_name="Compliance",
    )

    blocked_response = client.put(
        "/api/attendance/rules/default",
        headers=manager_headers,
        json={
            "name": "Flexible summer schedule",
            "clock_in_late_after": "10:00",
            "clock_out_early_before": "17:30",
        },
    )
    response = client.put(
        "/api/attendance/rules/default",
        headers=compliance_headers,
        json={
            "name": "Flexible summer schedule",
            "clock_in_late_after": "10:00",
            "clock_out_early_before": "17:30",
        },
    )

    assert blocked_response.status_code == 403
    assert response.status_code == 200
    assert response.json() == {
        "name": "Flexible summer schedule",
        "clock_in_late_after": "10:00",
        "clock_out_early_before": "17:30",
        "timezone": "Local time",
    }

    get_response = client.get("/api/attendance/rules/default", headers=manager_headers)
    assert get_response.status_code == 200
    assert get_response.json() == response.json()

    with Session(client.app.state.engine) as session:
        persisted_policy = session.exec(select(Policy).where(Policy.is_active.is_(True))).first()
        assert persisted_policy is not None
        assert persisted_policy.rules_json["attendance_rule"] == {
            "name": "Flexible summer schedule",
            "clock_in_late_after": "10:00",
            "clock_out_early_before": "17:30",
        }


def test_attendance_rules_update_rejects_invalid_time(client: TestClient, auth_headers) -> None:
    headers = auth_headers(
        username="attendance.rule.invalid",
        password="compliance-password",
        role_name="Compliance",
    )

    response = client.put(
        "/api/attendance/rules/default",
        headers=headers,
        json={
            "clock_in_late_after": "24:00",
            "clock_out_early_before": "17:30",
        },
    )

    assert response.status_code == 422


def test_agent_attendance_scoped_token_uses_bound_device_for_early_leave(
    client: TestClient,
    seeded_device: dict[str, str],
) -> None:
    scoped_headers = {"Authorization": f"Bearer {seeded_device['agent_token']}"}
    forged_device_id = str(uuid4())

    response = client.post(
        "/api/agent/attendance",
        headers=scoped_headers,
        json={
            "device_id": forged_device_id,
            "employee_no": "E-001",
            "user_name": "Alice",
            "machine_name": "FORGED-PC-999",
            "event_type": "clock_out",
            "occurred_at": "2026-05-11T09:00:00Z",
            "source": "launcher",
        },
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["device_id"] == seeded_device["device_id"]
    assert payload["device_id"] != forged_device_id
    assert payload["anomaly_status"] == "early_leave"
    assert payload["review_status"] == "pending"
    assert payload["anomaly_reasons"] == ["Clock-out before 18:00"]


def test_agent_attendance_scoped_token_can_create_unmatched_employee_record(
    client: TestClient,
) -> None:
    orphan_device_id = uuid4()
    orphan_secret = generate_device_agent_secret()
    with Session(client.app.state.engine) as session:
        session.add(
            Device(
                id=orphan_device_id,
                employee_id=None,
                hostname="ORPHAN-PC-001",
                os_type="windows",
                agent_version="0.1.0",
                screen_count=1,
                last_heartbeat_at=datetime.now(timezone.utc),
                agent_token_hash=hash_device_agent_secret(orphan_secret),
                status="online",
            )
        )
        session.commit()

    scoped_headers = {
        "Authorization": f"Bearer {create_device_agent_token(orphan_device_id, orphan_secret)}"
    }
    forged_device_id = str(uuid4())
    response = client.post(
        "/api/agent/attendance",
        headers=scoped_headers,
        json={
            "device_id": forged_device_id,
            "employee_no": "E-404",
            "user_name": "Unknown User",
            "machine_name": "FORGED-PC-404",
            "event_type": "clock_in",
            "occurred_at": "2026-05-11T08:30:00Z",
            "source": "launcher",
        },
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["employee_id"] is None
    assert payload["employee_name"] is None
    assert payload["device_id"] == str(orphan_device_id)
    assert payload["device_id"] != forged_device_id
    assert payload["employee_no"] == "E-404"
    assert payload["anomaly_status"] == "normal"
    assert payload["review_status"] == "reviewed"


def test_attendance_review_returns_404_for_missing_record(client: TestClient, auth_headers) -> None:
    response = client.post(
        f"/api/attendance/{uuid4()}/review",
        headers=auth_headers(bootstrap=True),
        json={"review_status": "ignored"},
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Attendance record not found"


def test_attendance_review_without_note_uses_default_audit_reason(
    client: TestClient,
    seeded_device: dict[str, str],
    auth_headers,
    agent_headers: dict[str, str],
) -> None:
    create_response = client.post(
        "/api/agent/attendance",
        headers=agent_headers,
        json={
            "employee_no": "E-001",
            "user_name": "Alice",
            "machine_name": "DEV-PC-001",
            "event_type": "clock_out",
            "occurred_at": "2026-05-11T09:30:00Z",
            "source": "launcher",
        },
    )
    assert create_response.status_code == 201

    review_response = client.post(
        f"/api/attendance/{create_response.json()['id']}/review",
        headers=auth_headers(bootstrap=True),
        json={"review_status": "ignored"},
    )

    assert review_response.status_code == 200
    payload = review_response.json()
    assert payload["review_status"] == "ignored"
    assert payload["review_note"] is None

    with Session(client.app.state.engine) as session:
        audit_log = session.exec(
            select(AuditLog).where(AuditLog.action == "attendance.reviewed").order_by(AuditLog.created_at.desc())
        ).first()
        assert audit_log is not None
        assert audit_log.target_id == UUID(create_response.json()["id"])
        assert audit_log.reason == "Set attendance review status to ignored"


def test_agent_attendance_rejects_blank_required_text(
    client: TestClient,
    agent_headers: dict[str, str],
) -> None:
    response = client.post(
        "/api/agent/attendance",
        headers=agent_headers,
        json={
            "user_name": "   ",
            "event_type": "clock_in",
            "occurred_at": "2026-05-11T09:00:00Z",
            "source": "launcher",
        },
    )

    assert response.status_code == 422


def test_employee_export_returns_csv_and_audits_action(
    client: TestClient,
    seeded_device: dict[str, str],
    auth_headers,
) -> None:
    headers = auth_headers(bootstrap=True)

    response = client.get("/api/admin/export/employees", headers=headers)

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/csv")
    lines = response.text.strip().splitlines()
    assert lines[0] == "name,employee_no,department,job_role,manager,github,status"
    assert lines[1] == "Alice,E-001,Engineering,,,,active"

    with Session(client.app.state.engine) as session:
        audit_logs = session.exec(
            select(AuditLog).where(AuditLog.action == "employees.exported").order_by(AuditLog.created_at.desc())
        ).all()
        assert len(audit_logs) == 1
        assert audit_logs[0].target_type == "employee_directory"


def test_employee_import_upserts_csv_rows_and_audits_action(
    client: TestClient,
    seeded_device: dict[str, str],
    auth_headers,
) -> None:
    headers = auth_headers(bootstrap=True)
    csv_payload = "\n".join(
        [
            "name,employee_no,department,job_role,manager,github,status",
            "Alice Updated,E-001,Platform,Senior Engineer,Dana,alicehub,active",
            "Bob,E-002,Support,Support Specialist,Morgan,bobhub,inactive",
        ]
    )

    response = client.post(
        "/api/admin/import/employees",
        headers={**headers, "Content-Type": "text/csv"},
        content=csv_payload,
    )

    assert response.status_code == 200
    assert response.json() == {
        "total_rows": 2,
        "created_count": 1,
        "updated_count": 1,
        "skipped_count": 0,
    }

    with Session(client.app.state.engine) as session:
        alice = session.exec(select(Employee).where(Employee.employee_no == "E-001")).first()
        bob = session.exec(select(Employee).where(Employee.employee_no == "E-002")).first()
        audit_log = session.exec(
            select(AuditLog).where(AuditLog.action == "employees.imported").order_by(AuditLog.created_at.desc())
        ).first()

        assert alice is not None
        assert alice.name == "Alice Updated"
        assert alice.department == "Platform"
        assert alice.job_role == "Senior Engineer"
        assert alice.manager_name == "Dana"
        assert alice.github_username == "alicehub"

        assert bob is not None
        assert bob.name == "Bob"
        assert bob.status == "inactive"
        assert audit_log is not None
        assert audit_log.target_type == "employee_directory"


def test_employee_import_rejects_non_utf8_csv_with_400(
    client: TestClient,
    auth_headers,
) -> None:
    headers = auth_headers(bootstrap=True)

    response = client.post(
        "/api/admin/import/employees",
        headers={**headers, "Content-Type": "text/csv"},
        content=b"name,employee_no\nAlice,\xff\n",
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "CSV payload must be UTF-8 text"
