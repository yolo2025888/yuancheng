from __future__ import annotations

import base64
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient

ONE_PIXEL_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO9W0WQAAAAASUVORK5CYII="
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
