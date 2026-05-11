from __future__ import annotations

import base64
import struct
import zlib
from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID, uuid4

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.models import BehaviorEvent, Device, Policy, Screenshot

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


def test_heartbeat_returns_policy(client: TestClient, seeded_device: dict[str, str]) -> None:
    response = client.post(
        "/api/agent/heartbeat",
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


def test_heartbeat_persists_safe_nested_metadata(client: TestClient, seeded_device: dict[str, str]) -> None:
    response = client.post(
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


def test_screenshot_metadata_and_complete_flow(client: TestClient, seeded_device: dict[str, str]) -> None:
    metadata_response = client.post(
        "/api/agent/screenshots",
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
        json={
            "image_uri": "screenshots/emp/dev/2026/05/11/example.jpg",
            "thumb_uri": "thumbnails/emp/dev/2026/05/11/example.jpg",
            "phash": "abc123",
        },
    )

    assert complete_response.status_code == 200
    assert complete_response.json()["upload_status"] == "completed"


def test_screenshot_requires_known_device(client: TestClient) -> None:
    response = client.post(
        "/api/agent/screenshots",
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

    assert response.status_code == 404


def test_screenshot_direct_upload_persists_image_and_thumb(
    client: TestClient,
    seeded_device: dict[str, str],
) -> None:
    response = client.post(
        "/api/agent/screenshots/upload",
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


def test_screenshot_upload_persists_extended_telemetry_fields(
    client: TestClient,
    seeded_device: dict[str, str],
) -> None:
    response = client.post(
        "/api/agent/screenshots/upload",
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

    detail_response = client.get(f"/api/screenshots/{screenshot_id}")
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
) -> None:
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
    )
    assert screenshots_response.status_code == 200
    screenshot_payload = screenshots_response.json()["items"][0]
    assert screenshot_payload["diff"]["change_level"] == "none"
    assert screenshot_payload["diff"]["is_effective_change"] is False
    assert screenshot_payload["risk_events"][0]["event_type"] == "no_change_streak_triggered"

    changed_response = client.post(
        "/api/agent/screenshots/upload",
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
    )
    assert events_response.status_code == 200
    updated_event = events_response.json()["items"][0]
    assert updated_event["status"] == "closed"
    assert updated_event["related_diff"]["is_effective_change"] is True
    assert updated_event["related_diff"]["change_level"] == "major"

    detail_response = client.get(f"/api/screenshots/{changed_response.json()['screenshot_id']}")
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
