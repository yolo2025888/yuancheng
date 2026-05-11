from __future__ import annotations

import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import UUID, uuid4

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.core.config import Settings
from app.main import create_app
from app.models import AuditLog, BehaviorEvent, Device, Employee, Policy, Role, Screenshot, User
from app.services.auth import hash_password


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

    assert policies_response.status_code == 200
    policies_payload = policies_response.json()
    assert policies_payload["total"] == 2
    assert policies_payload["items"][0]["is_active"] is True
    assert policies_payload["items"][0]["rules_json"] == {}
    assert policies_payload["items"][1]["version"] == "0.0.1"


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

    reviewer_role = next(role for role in payload["roles"] if role["name"] == "Reviewer")
    assert reviewer_role["source"] == "existing"
    assert "events.review" in reviewer_role["permission_keys"]

    recommended_roles = {role["name"] for role in payload["roles"] if role["source"] == "recommended"}
    assert {"Compliance", "Manager", "Risk Analyst"} <= recommended_roles
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
    assert created["employee_no"] == "E-001"
    assert created["anomaly_status"] == "late"
    assert created["review_status"] == "pending"
    assert created["anomaly_reasons"] == ["Clock-in after 09:30"]

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
        audit_log = session.exec(
            select(AuditLog).where(AuditLog.action == "attendance.reviewed").order_by(AuditLog.created_at.desc())
        ).first()
        assert audit_log is not None
        assert audit_log.target_type == "attendance_record"


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
