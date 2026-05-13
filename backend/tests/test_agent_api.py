from __future__ import annotations

import base64
import struct
import zlib
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import UUID, uuid4

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.core.config import Settings
from app.models import AuditLog, BehaviorEvent, Device, Employee, Policy, Screenshot
from app.services.agent_auth import (
    authenticate_agent_token,
    create_device_agent_token,
    create_scoped_agent_token,
    generate_device_agent_secret,
    hash_device_agent_secret,
)
from app.services.ai_analysis import AIAnalysisResult
from app.services.storage import LocalScreenshotStorage

ONE_PIXEL_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO9W0WQAAAAASUVORK5CYII="
)


def solid_png_bytes(*, red: int, green: int, blue: int, width: int = 8, height: int = 8) -> bytes:
    rows = []
    pixel = bytes([red, green, blue])
    for _ in range(height):
        rows.append(b"\x00" + (pixel * width))
    raw = b"".join(rows)

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    return b"".join(
        [
            b"\x89PNG\r\n\x1a\n",
            chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)),
            chunk(b"IDAT", zlib.compress(raw)),
            chunk(b"IEND", b""),
        ]
    )


def test_agent_endpoints_require_bearer_token(client: TestClient, seeded_device: dict[str, str]) -> None:
    response = client.get("/api/agent/policy", params={"device_id": seeded_device["device_id"]})

    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid agent token"


def test_agent_can_resolve_employee_by_employee_no(
    client: TestClient,
    seeded_device: dict[str, str],
    agent_headers: dict[str, str],
    auth_headers,
) -> None:
    admin_headers = auth_headers(bootstrap=True)

    unauthenticated_response = client.get("/api/agent/employees/resolve", params={"employee_no": "E-001"})
    admin_token_response = client.get(
        "/api/agent/employees/resolve",
        headers=admin_headers,
        params={"employee_no": "E-001"},
    )
    response = client.get(
        "/api/agent/employees/resolve",
        headers=agent_headers,
        params={"employee_no": " E-001 "},
    )
    missing_response = client.get(
        "/api/agent/employees/resolve",
        headers=agent_headers,
        params={"employee_no": "E-404"},
    )

    assert unauthenticated_response.status_code == 401
    assert admin_token_response.status_code == 401
    assert response.status_code == 200
    payload = response.json()
    assert payload == {
        "id": seeded_device["employee_id"],
        "name": "Alice",
        "employee_no": "E-001",
        "department": "Engineering",
        "manager_name": None,
        "job_role": None,
        "status": "active",
    }
    assert missing_response.status_code == 404
    assert missing_response.json()["detail"] == "Employee not found"


def test_scoped_agent_employee_resolver_does_not_enumerate_other_employees(
    client: TestClient,
    seeded_device: dict[str, str],
    agent_headers: dict[str, str],
) -> None:
    with Session(client.app.state.engine) as session:
        session.add(
            Employee(
                id=uuid4(),
                name="Bob",
                employee_no="E-002",
                department="Engineering",
            )
        )
        session.commit()

    response = client.get(
        "/api/agent/employees/resolve",
        headers=agent_headers,
        params={"employee_no": "E-002"},
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Employee not found"


def test_agent_employee_resolver_rejects_inactive_employee(
    client: TestClient,
    seeded_device: dict[str, str],
    agent_headers: dict[str, str],
) -> None:
    with Session(client.app.state.engine) as session:
        employee = session.get(Employee, UUID(seeded_device["employee_id"]))
        assert employee is not None
        employee.status = "inactive"
        session.add(employee)
        session.commit()

    response = client.get(
        "/api/agent/employees/resolve",
        headers=agent_headers,
        params={"employee_no": "E-001"},
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "Employee is not active"


def test_legacy_global_agent_token_can_resolve_employee_in_test_environment(
    client: TestClient,
    seeded_device: dict[str, str],
) -> None:
    response = client.get(
        "/api/agent/employees/resolve",
        headers={"Authorization": f"Bearer {client.app.state.settings.agent_api_token}"},
        params={"employee_no": "E-001"},
    )

    assert response.status_code == 200
    assert response.json()["id"] == seeded_device["employee_id"]


def test_agent_can_fetch_default_attendance_rules(client: TestClient, agent_headers: dict[str, str]) -> None:
    unauthenticated_response = client.get("/api/agent/attendance/rules")
    response = client.get("/api/agent/attendance/rules", headers=agent_headers)
    employee_response = client.get(
        "/api/agent/attendance/rules",
        headers=agent_headers,
        params={"employee_no": "E-001"},
    )

    assert unauthenticated_response.status_code == 401
    assert response.status_code == 200
    assert response.json() == {
        "clock_in_late_after": "09:30",
        "clock_out_early_before": "18:00",
    }
    assert employee_response.status_code == 200
    assert employee_response.json() == response.json()


def test_agent_attendance_uses_persisted_default_rules(
    client: TestClient,
    seeded_device: dict[str, str],
    agent_headers: dict[str, str],
    auth_headers,
) -> None:
    update_response = client.put(
        "/api/attendance/rules/default",
        headers=auth_headers(
            username="attendance.rule.compliance",
            password="compliance-password",
            role_name="Compliance",
        ),
        json={
            "name": "Later core hours",
            "clock_in_late_after": "10:00",
            "clock_out_early_before": "17:30",
        },
    )
    assert update_response.status_code == 200

    rules_response = client.get("/api/agent/attendance/rules", headers=agent_headers)
    assert rules_response.status_code == 200
    assert rules_response.json() == {
        "clock_in_late_after": "10:00",
        "clock_out_early_before": "17:30",
    }

    normal_clock_in_response = client.post(
        "/api/agent/attendance",
        headers=agent_headers,
        json={
            "employee_no": "E-001",
            "user_name": "Alice",
            "machine_name": "DEV-PC-001",
            "event_type": "clock_in",
            "occurred_at": "2026-05-11T09:45:00Z",
            "source": "launcher",
        },
    )
    late_clock_in_response = client.post(
        "/api/agent/attendance",
        headers=agent_headers,
        json={
            "employee_no": "E-001",
            "user_name": "Alice",
            "machine_name": "DEV-PC-001",
            "event_type": "clock_in",
            "occurred_at": "2026-05-12T10:10:00Z",
            "source": "launcher",
        },
    )
    early_clock_out_response = client.post(
        "/api/agent/attendance",
        headers=agent_headers,
        json={
            "employee_no": "E-001",
            "user_name": "Alice",
            "machine_name": "DEV-PC-001",
            "event_type": "clock_out",
            "occurred_at": "2026-05-13T17:20:00Z",
            "source": "launcher",
        },
    )

    assert normal_clock_in_response.status_code == 201
    assert normal_clock_in_response.json()["anomaly_status"] == "normal"
    assert normal_clock_in_response.json()["review_status"] == "reviewed"

    assert late_clock_in_response.status_code == 201
    assert late_clock_in_response.json()["anomaly_status"] == "late"
    assert late_clock_in_response.json()["anomaly_reasons"] == ["Clock-in after 10:00"]

    assert early_clock_out_response.status_code == 201
    assert early_clock_out_response.json()["anomaly_status"] == "early_leave"
    assert early_clock_out_response.json()["anomaly_reasons"] == ["Clock-out before 17:30"]


def test_scoped_agent_token_is_bound_to_device(client: TestClient, seeded_device: dict[str, str]) -> None:
    mismatch_device_id = uuid4()
    mismatch_secret = generate_device_agent_secret()
    mismatch_token = create_device_agent_token(mismatch_device_id, mismatch_secret)
    with Session(client.app.state.engine) as session:
        session.add(
            Device(
                id=mismatch_device_id,
                employee_id=None,
                hostname="DEV-PC-OTHER",
                os_type="windows",
                agent_version="0.1.0",
                screen_count=1,
                agent_token_hash=hash_device_agent_secret(mismatch_secret),
                status="online",
            )
        )
        session.commit()

    matching_response = client.post(
        "/api/agent/heartbeat",
        headers={"Authorization": f"Bearer {seeded_device['agent_token']}"},
        json={
            "device_id": seeded_device["device_id"],
            "employee_id": seeded_device["employee_id"],
            "hostname": "DEV-PC-001",
            "os_type": "windows",
            "agent_version": "0.1.1",
            "screen_count": 2,
            "status": "online",
        },
    )
    mismatch_response = client.post(
        "/api/agent/heartbeat",
        headers={"Authorization": f"Bearer {mismatch_token}"},
        json={
            "device_id": seeded_device["device_id"],
            "employee_id": seeded_device["employee_id"],
            "hostname": "DEV-PC-001",
            "os_type": "windows",
            "agent_version": "0.1.1",
            "screen_count": 2,
            "status": "online",
        },
    )

    assert matching_response.status_code == 200
    assert mismatch_response.status_code == 403
    assert mismatch_response.json()["detail"] == "Agent token/device mismatch"


def test_global_and_v1_agent_tokens_are_rejected_outside_dev_and_test(
    client: TestClient,
    seeded_device: dict[str, str],
) -> None:
    settings = Settings(
        environment="production",
        auth_secret="production-secret-with-enough-entropy-2026",
        agent_api_token="production-agent-token-with-enough-entropy",
    )
    legacy_scoped = create_scoped_agent_token(seeded_device["device_id"], settings)

    with Session(client.app.state.engine) as session:
        assert authenticate_agent_token(settings.agent_api_token, settings, session) is None
        assert authenticate_agent_token(legacy_scoped, settings, session) is None
        assert authenticate_agent_token(seeded_device["agent_token"], settings, session) is not None


def test_global_and_v1_agent_tokens_remain_compatible_in_test_environment(
    client: TestClient,
    seeded_device: dict[str, str],
) -> None:
    settings = client.app.state.settings
    legacy_scoped = create_scoped_agent_token(seeded_device["device_id"], settings)
    global_headers = {"Authorization": f"Bearer {settings.agent_api_token}"}
    legacy_headers = {"Authorization": f"Bearer {legacy_scoped}"}

    with Session(client.app.state.engine) as session:
        global_principal = authenticate_agent_token(settings.agent_api_token, settings, session)
        legacy_principal = authenticate_agent_token(legacy_scoped, settings, session)
        scoped_principal = authenticate_agent_token(seeded_device["agent_token"], settings, session)

    assert global_principal is not None
    assert global_principal.legacy_global_token is True
    assert global_principal.device_id is None
    assert global_principal.token_version == "global"
    assert legacy_principal is not None
    assert legacy_principal.device_id == UUID(seeded_device["device_id"])
    assert legacy_principal.token_version == "v1"
    assert scoped_principal is not None
    assert scoped_principal.token_version == "v2"

    global_policy_response = client.get(
        "/api/agent/policy",
        params={"device_id": seeded_device["device_id"]},
        headers=global_headers,
    )
    legacy_policy_response = client.get(
        "/api/agent/policy",
        params={"device_id": seeded_device["device_id"]},
        headers=legacy_headers,
    )

    assert global_policy_response.status_code == 200
    assert legacy_policy_response.status_code == 200
    assert global_policy_response.json() == legacy_policy_response.json()


def test_v2_agent_token_rejects_missing_hash_and_revoked_device(
    client: TestClient,
    seeded_device: dict[str, str],
) -> None:
    no_hash_device_id = uuid4()
    no_hash_secret = generate_device_agent_secret()
    with Session(client.app.state.engine) as session:
        session.add(
            Device(
                id=no_hash_device_id,
                employee_id=None,
                hostname="NO-HASH-PC",
                os_type="windows",
                agent_version="0.1.0",
                screen_count=1,
                status="online",
            )
        )
        session.commit()

    missing_hash_response = client.get(
        "/api/agent/policy",
        params={"device_id": str(no_hash_device_id)},
        headers={"Authorization": f"Bearer {create_device_agent_token(no_hash_device_id, no_hash_secret)}"},
    )

    with Session(client.app.state.engine) as session:
        device = session.get(Device, UUID(seeded_device["device_id"]))
        assert device is not None
        device.agent_token_revoked_at = datetime.now(timezone.utc)
        session.add(device)
        session.commit()

    revoked_response = client.get(
        "/api/agent/policy",
        params={"device_id": seeded_device["device_id"]},
        headers={"Authorization": f"Bearer {seeded_device['agent_token']}"},
    )

    assert missing_hash_response.status_code == 401
    assert missing_hash_response.json()["detail"] == "Invalid agent token"
    assert revoked_response.status_code == 401
    assert revoked_response.json()["detail"] == "Invalid agent token"


def test_v2_agent_token_rejects_expired_device_secret(
    client: TestClient,
    seeded_device: dict[str, str],
) -> None:
    with Session(client.app.state.engine) as session:
        device = session.get(Device, UUID(seeded_device["device_id"]))
        assert device is not None
        device.agent_token_expires_at = datetime.now(timezone.utc) - timedelta(days=1)
        device.agent_token_last_used_at = None
        session.add(device)
        session.commit()

    response = client.get(
        "/api/agent/policy",
        params={"device_id": seeded_device["device_id"]},
        headers={"Authorization": f"Bearer {seeded_device['agent_token']}"},
    )

    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid agent token"

    with Session(client.app.state.engine) as session:
        device = session.get(Device, UUID(seeded_device["device_id"]))
        assert device is not None
        assert device.agent_token_last_used_at is None


def test_v2_agent_token_updates_last_used_at_on_success(
    client: TestClient,
    seeded_device: dict[str, str],
) -> None:
    with Session(client.app.state.engine) as session:
        device = session.get(Device, UUID(seeded_device["device_id"]))
        assert device is not None
        assert device.agent_token_last_used_at is None

    response = client.get(
        "/api/agent/policy",
        params={"device_id": seeded_device["device_id"]},
        headers={"Authorization": f"Bearer {seeded_device['agent_token']}"},
    )

    assert response.status_code == 200

    with Session(client.app.state.engine) as session:
        device = session.get(Device, UUID(seeded_device["device_id"]))
        assert device is not None
        assert device.agent_token_last_used_at is not None


def test_heartbeat_returns_policy(client: TestClient, seeded_device: dict[str, str], agent_headers: dict[str, str]) -> None:
    response = client.post(
        "/api/agent/heartbeat",
        headers=agent_headers,
        json={
            "device_id": seeded_device["device_id"],
            "employee_id": seeded_device["employee_id"],
            "hostname": "DEV-PC-001",
            "os_type": "windows",
            "agent_version": "0.1.1",
            "screen_count": 2,
            "status": "online",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["policy"]["screenshot_interval_seconds"] == 10
    assert payload["policy"]["no_change_threshold"] == 6


def test_agent_policy_endpoint_resolves_role_targeted_policy(
    client: TestClient,
    seeded_device: dict[str, str],
    agent_headers: dict[str, str],
) -> None:
    app = client.app
    employee_id = UUID(seeded_device["employee_id"])

    with Session(app.state.engine) as session:
        employee = session.get(Employee, employee_id)
        assert employee is not None
        employee.job_role = "Engineer"
        session.add(employee)

        session.add(
            Policy(
                name="sales-only",
                version="2026.sales",
                screenshot_interval_seconds=45,
                no_change_threshold=12,
                retention_days=14,
                is_active=True,
                rules_json={"roles": ["sales"], "departments": ["sales"]},
            )
        )
        session.add(
            Policy(
                name="engineering-targeted",
                version="2026.engineering",
                screenshot_interval_seconds=18,
                no_change_threshold=3,
                retention_days=10,
                is_active=True,
                rules_json={"roles": ["engineer"], "departments": ["engineering"]},
            )
        )
        session.commit()

    response = client.get("/api/agent/policy", params={"device_id": seeded_device["device_id"]}, headers=agent_headers)

    assert response.status_code == 200
    payload = response.json()
    assert payload["name"] == "engineering-targeted"
    assert payload["version"] == "2026.engineering"
    assert payload["scope_type"] == "targeted"
    assert payload["screenshot_interval_seconds"] == 18
    assert payload["no_change_threshold"] == 3
    assert payload["retention_days"] == 10
    assert payload["policy_id"] is not None


def test_heartbeat_persists_safe_nested_metadata(
    client: TestClient,
    seeded_device: dict[str, str],
    agent_headers: dict[str, str],
) -> None:
    response = client.post(
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
                "collected_at": "2026-05-11T10:00:00Z",
                "session_id": 7,
                "user_name": "alice",
                "is_locked": False,
                "is_remote_session": True,
                "is_rdp_session": True,
                "is_active_session": True,
                "is_console_session": False,
                "active_console_session_id": 1,
                "idle_seconds": 12,
                "input_desktop_name": "Default",
                "session_connect_state": "Active",
                "status_detail": "ignored-private-text",
            },
            "foreground_window": {
                "collected_at": "2026-05-11T10:00:01Z",
                "process_name": "Cursor.exe",
                "executable_path": "C:/Users/Alice/AppData/Local/Programs/Cursor/Cursor.exe",
                "window_title": "private project title",
            },
            "input_activity": {
                "collected_from": "2026-05-11T09:59:00Z",
                "collected_to": "2026-05-11T10:00:00Z",
                "keyboard_event_count": 8,
                "mouse_event_count": 13,
                "mouse_move_count": 5,
                "mouse_click_count": 4,
                "mouse_wheel_count": 2,
                "window_switch_count": 3,
            },
        },
    )

    assert response.status_code == 200

    with Session(client.app.state.engine) as session:
        device = session.get(Device, UUID(seeded_device["device_id"]))
        assert device is not None
        assert device.last_foreground_window_json == {
            "collected_at": "2026-05-11T10:00:01+00:00",
            "process_name": "Cursor.exe",
        }
        assert device.last_session_state_json == {
            "collected_at": "2026-05-11T10:00:00+00:00",
            "is_locked": False,
            "is_remote_session": True,
            "is_rdp_session": True,
            "is_active_session": True,
            "is_console_session": False,
            "active_console_session_id": 1,
            "idle_seconds": 12,
            "input_desktop_name": "Default",
            "session_connect_state": "Active",
        }
        assert device.last_input_activity_json == {
            "collected_from": "2026-05-11T09:59:00+00:00",
            "collected_to": "2026-05-11T10:00:00+00:00",
            "keyboard_event_count": 8,
            "mouse_event_count": 13,
            "mouse_move_count": 5,
            "mouse_click_count": 4,
            "mouse_wheel_count": 2,
            "window_switch_count": 3,
        }
        assert "window_title" not in device.last_foreground_window_json
        assert "executable_path" not in device.last_foreground_window_json
        assert "user_name" not in device.last_session_state_json
        assert "session_id" not in device.last_session_state_json
        assert "status_detail" not in device.last_session_state_json


def test_screenshot_metadata_and_complete_flow(
    client: TestClient,
    seeded_device: dict[str, str],
    agent_headers: dict[str, str],
) -> None:
    metadata_response = client.post(
        "/api/agent/screenshots",
        headers=agent_headers,
        json={
            "device_id": seeded_device["device_id"],
            "captured_at": datetime(2026, 5, 11, 10, 0, tzinfo=timezone.utc).isoformat(),
            "screen_index": 0,
            "width": 1920,
            "height": 1080,
            "foreground_process": "Cursor.exe",
            "window_title": "project - Cursor",
            "keyboard_count": 23,
            "mouse_click_count": 4,
            "mouse_move_count": 19,
            "is_locked": False,
            "is_remote_session": True,
        },
    )

    assert metadata_response.status_code == 201
    screenshot_id = metadata_response.json()["screenshot_id"]

    complete_response = client.post(
        f"/api/agent/screenshots/{screenshot_id}/complete",
        headers=agent_headers,
        json={
            "device_id": seeded_device["device_id"],
            "image_uri": "screenshots/emp/dev/2026/05/11/example.jpg",
            "thumb_uri": "thumbnails/emp/dev/2026/05/11/example.jpg",
            "phash": "abc123",
        },
    )

    assert complete_response.status_code == 200
    assert complete_response.json()["upload_status"] == "completed"

    with Session(client.app.state.engine) as session:
        screenshot = session.get(Screenshot, UUID(screenshot_id))
        assert screenshot is not None
        assert screenshot.image_uri == "screenshots/emp/dev/2026/05/11/example.jpg"
        assert screenshot.thumb_uri == "thumbnails/emp/dev/2026/05/11/example.jpg"
        assert screenshot.phash == "abc123"
        assert screenshot.upload_status == "completed"
        assert screenshot.analysis_status in {"completed", "failed"}
        assert screenshot.ocr_status == "skipped"
        assert screenshot.activity_type == "development"
        assert screenshot.active_app == "cursor"
        assert screenshot.activity_confidence is not None
        assert screenshot.activity_confidence >= 0.8
        assert screenshot.activity_summary is not None
        assert "Development activity" in screenshot.activity_summary
        assert screenshot.activity_evidence_json is not None
        assert "project - Cursor" not in str(screenshot.activity_evidence_json)
        assert "title:cursor" in screenshot.activity_evidence_json["matched_signals"]


def test_screenshot_complete_requires_existing_record(
    client: TestClient,
    seeded_device: dict[str, str],
    agent_headers: dict[str, str],
) -> None:
    response = client.post(
        f"/api/agent/screenshots/{uuid4()}/complete",
        headers=agent_headers,
        json={
            "device_id": seeded_device["device_id"],
            "image_uri": "screenshots/missing.jpg",
            "thumb_uri": "screenshots/missing_thumb.jpg",
            "phash": "missing",
        },
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Screenshot not found"


def test_screenshot_complete_scoped_token_requires_bound_device_id(
    client: TestClient,
    seeded_device: dict[str, str],
    agent_headers: dict[str, str],
) -> None:
    metadata_response = client.post(
        "/api/agent/screenshots",
        headers=agent_headers,
        json={
            "device_id": seeded_device["device_id"],
            "captured_at": datetime(2026, 5, 11, 10, 5, tzinfo=timezone.utc).isoformat(),
            "screen_index": 0,
            "width": 1280,
            "height": 720,
            "keyboard_count": 2,
            "mouse_click_count": 1,
            "mouse_move_count": 4,
            "is_locked": False,
            "is_remote_session": False,
        },
    )
    assert metadata_response.status_code == 201
    screenshot_id = metadata_response.json()["screenshot_id"]

    missing_device_response = client.post(
        f"/api/agent/screenshots/{screenshot_id}/complete",
        headers=agent_headers,
        json={
            "image_uri": "screenshots/emp/dev/2026/05/11/missing-device.jpg",
            "thumb_uri": "thumbnails/emp/dev/2026/05/11/missing-device.jpg",
            "phash": "missing-device",
        },
    )

    mismatch_device_id = uuid4()
    mismatch_secret = generate_device_agent_secret()
    with Session(client.app.state.engine) as session:
        session.add(
            Device(
                id=mismatch_device_id,
                employee_id=None,
                hostname="SCREENSHOT-PC-OTHER",
                os_type="windows",
                agent_version="0.1.0",
                screen_count=1,
                agent_token_hash=hash_device_agent_secret(mismatch_secret),
                status="online",
            )
        )
        session.commit()

    mismatched_headers = {
        "Authorization": f"Bearer {create_device_agent_token(mismatch_device_id, mismatch_secret)}"
    }
    mismatched_device_response = client.post(
        f"/api/agent/screenshots/{screenshot_id}/complete",
        headers=mismatched_headers,
        json={
            "device_id": seeded_device["device_id"],
            "image_uri": "screenshots/emp/dev/2026/05/11/mismatched-device.jpg",
            "thumb_uri": "thumbnails/emp/dev/2026/05/11/mismatched-device.jpg",
            "phash": "mismatched-device",
        },
    )

    assert missing_device_response.status_code == 403
    assert missing_device_response.json()["detail"] == "Agent token/device mismatch"
    assert mismatched_device_response.status_code == 403
    assert mismatched_device_response.json()["detail"] == "Agent token/device mismatch"


def test_screenshot_requires_known_device(client: TestClient, agent_headers: dict[str, str]) -> None:
    response = client.post(
        "/api/agent/screenshots",
        headers=agent_headers,
        json={
            "device_id": str(uuid4()),
            "captured_at": datetime(2026, 5, 11, 10, 0, tzinfo=timezone.utc).isoformat(),
            "screen_index": 0,
            "width": 1920,
            "height": 1080,
            "keyboard_count": 1,
            "mouse_click_count": 0,
            "mouse_move_count": 0,
            "is_locked": False,
            "is_remote_session": False,
        },
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "Agent token/device mismatch"


def test_screenshot_direct_upload_requires_known_device(client: TestClient, agent_headers: dict[str, str]) -> None:
    response = client.post(
        "/api/agent/screenshots/upload",
        headers=agent_headers,
        data={
            "device_id": str(uuid4()),
            "captured_at": datetime(2026, 5, 11, 10, 30, tzinfo=timezone.utc).isoformat(),
            "screen_index": "0",
            "width": "1",
            "height": "1",
            "keyboard_count": "1",
            "mouse_click_count": "0",
            "mouse_move_count": "0",
            "is_locked": "false",
            "is_remote_session": "false",
        },
        files={"file": ("screen.png", ONE_PIXEL_PNG, "image/png")},
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "Agent token/device mismatch"


def test_screenshot_direct_upload_marks_record_failed_when_storage_rejects_image(
    client: TestClient,
    seeded_device: dict[str, str],
    agent_headers: dict[str, str],
) -> None:
    captured_at = datetime(2026, 5, 11, 11, 5, tzinfo=timezone.utc)
    response = client.post(
        "/api/agent/screenshots/upload",
        headers=agent_headers,
        data={
            "device_id": seeded_device["device_id"],
            "captured_at": captured_at.isoformat(),
            "screen_index": "0",
            "width": "1",
            "height": "1",
            "keyboard_count": "1",
            "mouse_click_count": "0",
            "mouse_move_count": "0",
            "is_locked": "false",
            "is_remote_session": "false",
        },
        files={"file": ("screen.png", b"", "image/png")},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Screenshot image is empty"

    with Session(client.app.state.engine) as session:
        screenshot = session.exec(
            select(Screenshot)
            .where(Screenshot.device_id == UUID(seeded_device["device_id"]))
            .where(Screenshot.captured_at == captured_at)
        ).first()
        assert screenshot is not None
        assert screenshot.upload_status == "failed"
        assert screenshot.image_uri is None
        assert screenshot.thumb_uri is None


def test_screenshot_direct_upload_persists_image_and_thumb(
    client: TestClient,
    seeded_device: dict[str, str],
    agent_headers: dict[str, str],
    auth_headers,
) -> None:
    response = client.post(
        "/api/agent/screenshots/upload",
        headers=agent_headers,
        data={
            "device_id": seeded_device["device_id"],
            "captured_at": datetime(2026, 5, 11, 11, 0, tzinfo=timezone.utc).isoformat(),
            "screen_index": "0",
            "width": "1",
            "height": "1",
            "foreground_process": "Cursor.exe",
            "window_title": "upload flow",
            "keyboard_count": "7",
            "mouse_click_count": "2",
            "mouse_move_count": "3",
            "is_locked": "false",
            "is_remote_session": "false",
            "phash": "direct-upload",
        },
        files={"file": ("screen.png", ONE_PIXEL_PNG, "image/png")},
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["upload_status"] == "completed"
    assert payload["image_uri"].startswith("storage/screenshots/")
    assert payload["thumb_uri"].startswith("storage/screenshots/")

    storage_base = Path(client.app.state.settings.storage_root_dir).parent
    assert (storage_base / payload["image_uri"]).exists()
    assert (storage_base / payload["thumb_uri"]).exists()

    raw_storage_response = client.get(f"/{payload['image_uri']}")
    assert raw_storage_response.status_code == 404

    protected_image_response = client.get(f"/api/screenshots/{payload['screenshot_id']}/image")
    assert protected_image_response.status_code == 401

    admin_headers = auth_headers(bootstrap=True)
    missing_reason_response = client.get(
        f"/api/screenshots/{payload['screenshot_id']}/image",
        headers=admin_headers,
    )
    assert missing_reason_response.status_code == 400
    assert missing_reason_response.json()["detail"] == "Screenshot image access requires a non-empty reason"

    reviewer_headers = auth_headers(
        username="reviewer.screenshots",
        password="reviewer-password",
        role_name="Reviewer",
        employee_id=seeded_device["employee_id"],
    )
    metadata_response = client.get(f"/api/screenshots/{payload['screenshot_id']}", headers=reviewer_headers)
    assert metadata_response.status_code == 200
    reviewer_image_response = client.get(
        f"/api/screenshots/{payload['screenshot_id']}/image",
        params={"reason": "Reviewer should not access images"},
        headers=reviewer_headers,
    )
    assert reviewer_image_response.status_code == 403
    assert reviewer_image_response.json()["detail"] == "Missing permissions: screenshots.image.view"

    protected_image_response = client.get(
        f"/api/screenshots/{payload['screenshot_id']}/image",
        params={"reason": "Investigate screenshot risk event"},
        headers=admin_headers,
    )
    protected_thumb_response = client.get(
        f"/api/screenshots/{payload['screenshot_id']}/thumbnail",
        params={"reason": "Investigate screenshot risk event"},
        headers=admin_headers,
    )
    assert protected_image_response.status_code == 200
    assert protected_image_response.content == ONE_PIXEL_PNG
    assert protected_thumb_response.status_code == 200

    with Session(client.app.state.engine) as session:
        audit_logs = session.exec(select(AuditLog).order_by(AuditLog.created_at.asc())).all()
        assert [audit.action for audit in audit_logs] == [
            "screenshot.image.viewed",
            "screenshot.thumbnail.viewed",
        ]
        assert all(audit.target_type == "screenshot" for audit in audit_logs)
        assert all(audit.target_id == UUID(payload["screenshot_id"]) for audit in audit_logs)
        assert all(audit.reason == "Investigate screenshot risk event" for audit in audit_logs)
        assert all(audit.actor_id is not None for audit in audit_logs)
        assert all(audit.ip_address == "testclient" for audit in audit_logs)
        assert all(audit.user_agent is not None for audit in audit_logs)


def test_screenshot_direct_upload_persists_ai_analysis_when_enabled(
    client: TestClient,
    seeded_device: dict[str, str],
    agent_headers: dict[str, str],
    monkeypatch,
) -> None:
    def fake_analyze(
        self,
        *,
        current_image_bytes: bytes,
        previous_image_bytes: bytes | None,
        safe_metadata: dict[str, object],
        rules_json: dict[str, object] | None = None,
    ):
        assert current_image_bytes
        assert safe_metadata["activity"]["type"] == "development"
        return AIAnalysisResult(
            summary="Likely focused development work with low apparent risk.",
            task_label="development_work",
            risk_level="low",
            non_work_likelihood=0.06,
            confidence=0.88,
            evidence=["editor-like layout", "development process metadata", "limited frame-to-frame drift"],
            recommended_follow_up="No immediate escalation; keep this as assistive context only.",
            model="gpt-4.1-mini",
            response_id="resp_test_success",
        )

    settings = client.app.state.settings
    settings.ai_analysis_enabled = True
    settings.ai_analysis_base_url = "https://api.openai.com/v1"
    settings.ai_analysis_api_key = "test-ai-key"
    settings.ai_analysis_model = "gpt-4.1-mini"
    monkeypatch.setattr("app.services.ai_analysis.AIAnalysisService.analyze", fake_analyze)

    response = client.post(
        "/api/agent/screenshots/upload",
        headers=agent_headers,
        data={
            "device_id": seeded_device["device_id"],
            "captured_at": datetime(2026, 5, 11, 13, 0, tzinfo=timezone.utc).isoformat(),
            "screen_index": "0",
            "width": "1",
            "height": "1",
            "foreground_process": "Cursor.exe",
            "window_title": "implementation branch",
            "keyboard_count": "5",
            "mouse_click_count": "1",
            "mouse_move_count": "2",
            "is_locked": "false",
            "is_remote_session": "false",
            "phash": "ai-enabled-upload",
        },
        files={"file": ("screen.png", ONE_PIXEL_PNG, "image/png")},
    )

    assert response.status_code == 201
    screenshot_id = response.json()["screenshot_id"]

    with Session(client.app.state.engine) as session:
        screenshot = session.get(Screenshot, UUID(screenshot_id))
        assert screenshot is not None
        assert screenshot.analysis_status == "completed"
        assert screenshot.activity_evidence_json is not None
        assert screenshot.activity_evidence_json["ai_analysis"]["status"] == "completed"
        assert screenshot.activity_evidence_json["ai_analysis"]["task_label"] == "development_work"
        assert screenshot.activity_evidence_json["ai_analysis"]["risk_level"] == "low"
        assert screenshot.activity_evidence_json["ai_analysis"]["response_id"] == "resp_test_success"


def test_screenshot_direct_upload_ignores_ai_analysis_failure(
    client: TestClient,
    seeded_device: dict[str, str],
    agent_headers: dict[str, str],
    monkeypatch,
) -> None:
    def failing_analyze(
        self,
        *,
        current_image_bytes: bytes,
        previous_image_bytes: bytes | None,
        safe_metadata: dict[str, object],
        rules_json: dict[str, object] | None = None,
    ):
        raise RuntimeError("synthetic upstream timeout")

    settings = client.app.state.settings
    settings.ai_analysis_enabled = True
    settings.ai_analysis_base_url = "https://api.openai.com/v1"
    settings.ai_analysis_api_key = "test-ai-key"
    settings.ai_analysis_model = "gpt-4.1-mini"
    monkeypatch.setattr("app.services.ai_analysis.AIAnalysisService.analyze", failing_analyze)

    response = client.post(
        "/api/agent/screenshots/upload",
        headers=agent_headers,
        data={
            "device_id": seeded_device["device_id"],
            "captured_at": datetime(2026, 5, 11, 13, 5, tzinfo=timezone.utc).isoformat(),
            "screen_index": "0",
            "width": "1",
            "height": "1",
            "foreground_process": "Cursor.exe",
            "window_title": "implementation branch",
            "keyboard_count": "5",
            "mouse_click_count": "1",
            "mouse_move_count": "2",
            "is_locked": "false",
            "is_remote_session": "false",
            "phash": "ai-failure-upload",
        },
        files={"file": ("screen.png", ONE_PIXEL_PNG, "image/png")},
    )

    assert response.status_code == 201
    screenshot_id = response.json()["screenshot_id"]

    with Session(client.app.state.engine) as session:
        screenshot = session.get(Screenshot, UUID(screenshot_id))
        assert screenshot is not None
        assert screenshot.analysis_status == "completed"
        assert screenshot.activity_evidence_json is not None
        assert screenshot.activity_evidence_json["ai_analysis"]["status"] == "failed"
        assert "synthetic upstream timeout" in screenshot.activity_evidence_json["ai_analysis"]["reason"]


def test_normal_screenshot_visuals_are_discarded_after_next_completed_capture(
    client: TestClient,
    seeded_device: dict[str, str],
    agent_headers: dict[str, str],
    monkeypatch,
) -> None:
    def fake_analyze(
        self,
        *,
        current_image_bytes: bytes,
        previous_image_bytes: bytes | None,
        safe_metadata: dict[str, object],
        rules_json: dict[str, object] | None = None,
    ):
        return AIAnalysisResult(
            summary="Normal focused work.",
            task_label="development_work",
            risk_level="low",
            non_work_likelihood=0.05,
            confidence=0.92,
            evidence=["editor visible", "no risky app context"],
            recommended_follow_up="No follow-up needed.",
            model="gpt-4.1-mini",
            response_id="resp_normal_keep",
        )

    settings = client.app.state.settings
    settings.ai_analysis_enabled = True
    settings.ai_analysis_base_url = "https://api.openai.com/v1"
    settings.ai_analysis_api_key = "test-ai-key"
    settings.ai_analysis_model = "gpt-4.1-mini"
    monkeypatch.setattr("app.services.ai_analysis.AIAnalysisService.analyze", fake_analyze)

    first_response = client.post(
        "/api/agent/screenshots/upload",
        headers=agent_headers,
        data={
            "device_id": seeded_device["device_id"],
            "captured_at": datetime(2026, 5, 11, 14, 0, tzinfo=timezone.utc).isoformat(),
            "screen_index": "0",
            "width": "8",
            "height": "8",
            "foreground_process": "Cursor.exe",
            "window_title": "normal frame one",
            "keyboard_count": "1",
            "mouse_click_count": "1",
            "mouse_move_count": "0",
            "is_locked": "false",
            "is_remote_session": "false",
            "phash": "1111111111111111",
        },
        files={"file": ("screen.png", solid_png_bytes(red=10, green=20, blue=30), "image/png")},
    )
    assert first_response.status_code == 201
    first_payload = first_response.json()
    first_screenshot_id = UUID(first_payload["screenshot_id"])
    stored_first_image = LocalScreenshotStorage(settings).resolve_stored_uri(first_payload["image_uri"])
    assert stored_first_image is not None and stored_first_image.exists()

    second_response = client.post(
        "/api/agent/screenshots/upload",
        headers=agent_headers,
        data={
            "device_id": seeded_device["device_id"],
            "captured_at": datetime(2026, 5, 11, 14, 1, tzinfo=timezone.utc).isoformat(),
            "screen_index": "0",
            "width": "8",
            "height": "8",
            "foreground_process": "Cursor.exe",
            "window_title": "normal frame two",
            "keyboard_count": "2",
            "mouse_click_count": "1",
            "mouse_move_count": "0",
            "is_locked": "false",
            "is_remote_session": "false",
            "phash": "2222222222222222",
        },
        files={"file": ("screen.png", solid_png_bytes(red=40, green=50, blue=60), "image/png")},
    )
    assert second_response.status_code == 201

    with Session(client.app.state.engine) as session:
        first_screenshot = session.get(Screenshot, first_screenshot_id)
        assert first_screenshot is not None
        assert first_screenshot.retention_decision == "normal"
        assert first_screenshot.file_retention_status == "metadata_only"
        assert first_screenshot.image_uri is None
        assert first_screenshot.thumb_uri is None
        assert first_screenshot.image_deleted_at is not None
        assert first_screenshot.thumb_deleted_at is not None

    assert not stored_first_image.exists()


def test_screenshot_direct_upload_creates_ai_risk_event_and_exposes_it_in_queries(
    client: TestClient,
    seeded_device: dict[str, str],
    agent_headers: dict[str, str],
    auth_headers,
    monkeypatch,
) -> None:
    def fake_analyze(
        self,
        *,
        current_image_bytes: bytes,
        previous_image_bytes: bytes | None,
        safe_metadata: dict[str, object],
        rules_json: dict[str, object] | None = None,
    ):
        assert current_image_bytes
        assert safe_metadata["activity"]["type"] == "code_review_or_browser"
        return AIAnalysisResult(
            summary="Browser activity appears unrelated to assigned work and needs review.",
            task_label="possible_non_work_browsing",
            risk_level="high",
            non_work_likelihood=0.96,
            confidence=0.94,
            evidence=["browser-only activity", "high non-work likelihood", "limited input activity"],
            recommended_follow_up="Retain this frame for reviewer confirmation.",
            model="gpt-4.1-mini",
            response_id="resp_test_high_risk",
        )

    settings = client.app.state.settings
    settings.ai_analysis_enabled = True
    settings.ai_analysis_base_url = "https://api.openai.com/v1"
    settings.ai_analysis_api_key = "test-ai-key"
    settings.ai_analysis_model = "gpt-4.1-mini"
    monkeypatch.setattr("app.services.ai_analysis.AIAnalysisService.analyze", fake_analyze)

    response = client.post(
        "/api/agent/screenshots/upload",
        headers=agent_headers,
        data={
            "device_id": seeded_device["device_id"],
            "captured_at": datetime(2026, 5, 11, 13, 10, tzinfo=timezone.utc).isoformat(),
            "screen_index": "0",
            "width": "1",
            "height": "1",
            "foreground_process": "chrome.exe",
            "window_title": "shopping comparison",
            "keyboard_count": "1",
            "mouse_click_count": "1",
            "mouse_move_count": "1",
            "is_locked": "false",
            "is_remote_session": "false",
            "phash": "ai-high-risk-upload",
        },
        files={"file": ("screen.png", ONE_PIXEL_PNG, "image/png")},
    )

    assert response.status_code == 201
    screenshot_id = response.json()["screenshot_id"]
    headers = auth_headers(bootstrap=True)

    detail_response = client.get(f"/api/screenshots/{screenshot_id}", headers=headers)
    timeline_response = client.get(
        f"/api/employees/{seeded_device['employee_id']}/timeline",
        params={"date": "2026-05-11"},
        headers=headers,
    )
    filtered_timeline_response = client.get(
        "/api/timeline",
        params={
            "employee_id": seeded_device["employee_id"],
            "date": "2026-05-11",
            "abnormal_only": "true",
            "page": 1,
            "page_size": 10,
        },
        headers=headers,
    )
    filtered_screenshots_response = client.get(
        "/api/screenshots",
        params={
            "employee_id": seeded_device["employee_id"],
            "risk_level": "high_risk",
            "abnormal_only": "true",
            "page": 1,
            "page_size": 10,
        },
        headers=headers,
    )
    events_response = client.get(
        "/api/events",
        params={
            "employee_id": seeded_device["employee_id"],
            "event_type": "ai_suspected_non_work_activity",
        },
        headers=headers,
    )

    assert detail_response.status_code == 200
    detail_payload = detail_response.json()
    assert detail_payload["ai_analysis_status"] == "completed"
    assert detail_payload["ai_summary"] == "Browser activity appears unrelated to assigned work and needs review."
    assert {event["event_type"] for event in detail_payload["risk_events"]} == {"ai_suspected_non_work_activity"}

    assert timeline_response.status_code == 200
    timeline_item = next(
        item for item in timeline_response.json()["items"] if item["screenshot_id"] == screenshot_id
    )
    assert timeline_item["ai_analysis_status"] == "completed"
    assert timeline_item["ai_details"]["risk_level"] == "high"
    assert {event["event_type"] for event in timeline_item["risk_events"]} == {"ai_suspected_non_work_activity"}
    assert timeline_item["retention_decision"] == "high_risk"
    assert timeline_item["is_abnormal"] is True

    assert filtered_timeline_response.status_code == 200
    filtered_timeline_payload = filtered_timeline_response.json()
    assert filtered_timeline_payload["total"] == 1
    assert filtered_timeline_payload["items"][0]["screenshot_id"] == screenshot_id

    assert filtered_screenshots_response.status_code == 200
    filtered_screenshots_payload = filtered_screenshots_response.json()
    assert filtered_screenshots_payload["total"] == 1
    assert filtered_screenshots_payload["items"][0]["retention_decision"] == "high_risk"

    assert events_response.status_code == 200
    events_payload = events_response.json()
    assert events_payload["total"] == 1
    assert events_payload["items"][0]["event_type"] == "ai_suspected_non_work_activity"
    assert events_payload["items"][0]["severity"] == "high"
    assert events_payload["items"][0]["related_screenshot_id"] == screenshot_id

    with Session(client.app.state.engine) as session:
        event = session.exec(
            select(BehaviorEvent)
            .where(BehaviorEvent.related_screenshot_id == UUID(screenshot_id))
            .where(BehaviorEvent.event_type == "ai_suspected_non_work_activity")
        ).first()
        assert event is not None
        assert event.severity == "high"
        assert event.details_json["source"] == "ai_analysis"
        assert event.details_json["risk_level"] == "high"
        assert event.details_json["provider"] == "openai_compatible"

        screenshot = session.get(Screenshot, UUID(screenshot_id))
        assert screenshot is not None
        assert screenshot.retention_decision == "high_risk"
        assert screenshot.file_retention_status == "full"
        assert screenshot.is_abnormal is True
        assert screenshot.retain_until is not None


def test_screenshot_direct_upload_skips_ai_analysis_when_key_is_missing(
    client: TestClient,
    seeded_device: dict[str, str],
    agent_headers: dict[str, str],
    monkeypatch,
) -> None:
    def unexpected_analyze(*args, **kwargs):
        raise AssertionError("AI analysis should not be called when configuration is incomplete")

    settings = client.app.state.settings
    settings.ai_analysis_enabled = True
    settings.ai_analysis_base_url = "https://api.openai.com/v1"
    settings.ai_analysis_api_key = None
    settings.ai_analysis_default_api_key = None
    settings.ai_analysis_model = "gpt-4.1-mini"
    monkeypatch.setattr("app.services.ai_analysis.AIAnalysisService.analyze", unexpected_analyze)

    response = client.post(
        "/api/agent/screenshots/upload",
        headers=agent_headers,
        data={
            "device_id": seeded_device["device_id"],
            "captured_at": datetime(2026, 5, 11, 13, 15, tzinfo=timezone.utc).isoformat(),
            "screen_index": "0",
            "width": "1",
            "height": "1",
            "foreground_process": "Cursor.exe",
            "window_title": "implementation branch",
            "keyboard_count": "5",
            "mouse_click_count": "1",
            "mouse_move_count": "2",
            "is_locked": "false",
            "is_remote_session": "false",
            "phash": "ai-skipped-upload",
        },
        files={"file": ("screen.png", ONE_PIXEL_PNG, "image/png")},
    )

    assert response.status_code == 201
    screenshot_id = response.json()["screenshot_id"]

    with Session(client.app.state.engine) as session:
        screenshot = session.get(Screenshot, UUID(screenshot_id))
        event = session.exec(
            select(BehaviorEvent)
            .where(BehaviorEvent.related_screenshot_id == UUID(screenshot_id))
            .where(BehaviorEvent.event_type == "ai_suspected_non_work_activity")
        ).first()
        assert screenshot is not None
        assert screenshot.analysis_status == "completed"
        assert screenshot.ai_analysis_status == "skipped"
        assert screenshot.ai_error is None
        assert screenshot.ai_details_json == {
            "status": "skipped",
            "reason": "AI analysis is enabled but not fully configured.",
        }
        assert screenshot.activity_evidence_json is not None
        assert screenshot.activity_evidence_json["ai_analysis"]["status"] == "skipped"
        assert event is None


def test_protected_screenshot_files_return_404_when_missing_or_outside_storage(
    client: TestClient,
    seeded_device: dict[str, str],
    auth_headers,
) -> None:
    admin_headers = auth_headers(bootstrap=True)
    screenshot_id = uuid4()

    with Session(client.app.state.engine) as session:
        session.add(
            Screenshot(
                id=screenshot_id,
                employee_id=UUID(seeded_device["employee_id"]),
                device_id=UUID(seeded_device["device_id"]),
                captured_at=datetime(2026, 5, 11, 11, 0, tzinfo=timezone.utc),
                width=1,
                height=1,
                image_uri="../outside.png",
                thumb_uri="storage/screenshots/missing_thumb.png",
                upload_status="completed",
            )
        )
        session.commit()

    image_response = client.get(
        f"/api/screenshots/{screenshot_id}/image",
        params={"reason": "Investigate missing screenshot image"},
        headers=admin_headers,
    )
    thumbnail_response = client.get(
        f"/api/screenshots/{screenshot_id}/thumbnail",
        params={"reason": "Investigate missing screenshot thumbnail"},
        headers=admin_headers,
    )

    assert image_response.status_code == 404
    assert image_response.json()["detail"] == "Screenshot image not found"
    assert thumbnail_response.status_code == 404
    assert thumbnail_response.json()["detail"] == "Screenshot thumbnail not found"


def test_local_storage_rejects_path_traversal(client: TestClient) -> None:
    storage = LocalScreenshotStorage(client.app.state.settings)

    assert storage.resolve_stored_uri("../outside.png") is None


def test_screenshot_upload_persists_extended_telemetry_fields(
    client: TestClient,
    seeded_device: dict[str, str],
    auth_headers,
    agent_headers: dict[str, str],
) -> None:
    headers = auth_headers(bootstrap=True)
    response = client.post(
        "/api/agent/screenshots/upload",
        headers=agent_headers,
        data={
            "device_id": seeded_device["device_id"],
            "captured_at": datetime(2026, 5, 11, 11, 30, tzinfo=timezone.utc).isoformat(),
            "screen_index": "0",
            "width": "1",
            "height": "1",
            "foreground_process": "Cursor.exe",
            "window_title": "upload flow",
            "keyboard_count": "7",
            "mouse_click_count": "2",
            "mouse_move_count": "3",
            "mouse_wheel_count": "4",
            "window_switch_count": "5",
            "is_locked": "false",
            "is_remote_session": "true",
            "is_rdp_session": "true",
            "idle_seconds": "21",
            "input_desktop_name": "Default",
            "session_connect_state": "Active",
            "phash": "extended-telemetry",
        },
        files={"file": ("screen.png", ONE_PIXEL_PNG, "image/png")},
    )

    assert response.status_code == 201
    screenshot_id = response.json()["screenshot_id"]

    detail_response = client.get(f"/api/screenshots/{screenshot_id}", headers=headers)
    assert detail_response.status_code == 200
    detail_payload = detail_response.json()
    assert detail_payload["mouse_wheel_count"] == 4
    assert detail_payload["window_switch_count"] == 5
    assert detail_payload["is_rdp_session"] is True
    assert detail_payload["idle_seconds"] == 21
    assert detail_payload["input_desktop_name"] == "Default"
    assert detail_payload["session_connect_state"] == "Active"

    with Session(client.app.state.engine) as session:
        screenshot = session.get(Screenshot, UUID(screenshot_id))
        assert screenshot is not None
        assert screenshot.mouse_wheel_count == 4
        assert screenshot.window_switch_count == 5
        assert screenshot.is_rdp_session is True
        assert screenshot.idle_seconds == 21
        assert screenshot.input_desktop_name == "Default"
        assert screenshot.session_connect_state == "Active"


def test_repeated_same_uploads_trigger_no_change_event_and_changed_upload_closes_it(
    client: TestClient,
    seeded_device: dict[str, str],
    auth_headers,
    agent_headers: dict[str, str],
) -> None:
    headers = auth_headers(bootstrap=True)
    app = client.app
    with Session(app.state.engine) as session:
        policy = session.exec(select(Policy).where(Policy.is_active.is_(True))).first()
        assert policy is not None
        policy.no_change_threshold = 2
        session.add(policy)
        session.commit()

    unchanged_image = solid_png_bytes(red=32, green=32, blue=32)
    changed_image = solid_png_bytes(red=240, green=240, blue=240)

    for minute in range(3):
        response = client.post(
            "/api/agent/screenshots/upload",
            headers=agent_headers,
            data={
                "device_id": seeded_device["device_id"],
                "captured_at": datetime(2026, 5, 11, 12, minute, tzinfo=timezone.utc).isoformat(),
                "screen_index": "0",
                "width": "8",
                "height": "8",
                "foreground_process": "Cursor.exe",
                "window_title": "steady frame",
                "keyboard_count": "0",
                "mouse_click_count": "0",
                "mouse_move_count": "0",
                "is_locked": "false",
                "is_remote_session": "false",
                "phash": "0000000000000000",
            },
            files={"file": ("steady.png", unchanged_image, "image/png")},
        )
        assert response.status_code == 201

    events_response = client.get(
        "/api/events",
        params={
            "employee_id": seeded_device["employee_id"],
            "event_type": "no_change_streak_triggered",
        },
        headers=headers,
    )
    assert events_response.status_code == 200
    events_payload = events_response.json()
    assert events_payload["total"] == 1
    assert events_payload["items"][0]["status"] == "open"
    assert events_payload["items"][0]["streak_count"] == 2
    assert events_payload["items"][0]["screen_index"] == 0
    assert events_payload["items"][0]["related_diff"]["is_effective_change"] is False

    screenshots_response = client.get(
        "/api/screenshots",
        params={
            "device_id": seeded_device["device_id"],
            "limit": 1,
        },
        headers=headers,
    )
    assert screenshots_response.status_code == 200
    screenshot_payload = screenshots_response.json()["items"][0]
    assert screenshot_payload["diff"]["change_level"] == "none"
    assert screenshot_payload["diff"]["is_effective_change"] is False
    assert screenshot_payload["risk_events"][0]["event_type"] == "no_change_streak_triggered"

    changed_response = client.post(
        "/api/agent/screenshots/upload",
        headers=agent_headers,
        data={
            "device_id": seeded_device["device_id"],
            "captured_at": datetime(2026, 5, 11, 12, 3, tzinfo=timezone.utc).isoformat(),
            "screen_index": "0",
            "width": "8",
            "height": "8",
            "foreground_process": "Cursor.exe",
            "window_title": "changed frame",
            "keyboard_count": "1",
            "mouse_click_count": "1",
            "mouse_move_count": "1",
            "is_locked": "false",
            "is_remote_session": "false",
            "phash": "ffffffffffffffff",
        },
        files={"file": ("changed.png", changed_image, "image/png")},
    )
    assert changed_response.status_code == 201

    events_response = client.get(
        "/api/events",
        params={
            "employee_id": seeded_device["employee_id"],
            "event_type": "no_change_streak_triggered",
        },
        headers=headers,
    )
    assert events_response.status_code == 200
    updated_event = events_response.json()["items"][0]
    assert updated_event["status"] == "closed"
    assert updated_event["related_diff"]["is_effective_change"] is True
    assert updated_event["related_diff"]["change_level"] == "major"

    detail_response = client.get(
        f"/api/screenshots/{changed_response.json()['screenshot_id']}",
        headers=headers,
    )
    assert detail_response.status_code == 200
    detail_payload = detail_response.json()
    assert detail_payload["diff"]["is_effective_change"] is True
    assert detail_payload["diff"]["hash_distance"] is not None

    with Session(app.state.engine) as session:
        persisted_event = session.exec(
            select(BehaviorEvent).where(BehaviorEvent.event_type == "no_change_streak_triggered")
        ).first()
        assert persisted_event is not None
        assert persisted_event.status == "closed"
