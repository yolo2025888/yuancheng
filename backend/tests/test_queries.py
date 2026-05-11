from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.models import BehaviorEvent, ScreenDiff, Screenshot


def test_timeline_and_events_queries(client: TestClient, seeded_device: dict[str, str]) -> None:
    app = client.app
    employee_id = UUID(seeded_device["employee_id"])
    device_id = UUID(seeded_device["device_id"])

    with Session(app.state.engine) as session:
        screenshot = Screenshot(
            employee_id=employee_id,
            device_id=device_id,
            captured_at=datetime(2026, 5, 11, 10, 21, 30, tzinfo=timezone.utc),
            screen_index=0,
            thumb_uri="thumbnails/example.jpg",
            width=1920,
            height=1080,
            keyboard_count=23,
            mouse_click_count=4,
            mouse_move_count=19,
            is_locked=False,
            is_remote_session=True,
            upload_status="completed",
            ocr_status="pending",
            analysis_status="pending",
        )
        session.add(screenshot)
        session.commit()
        session.refresh(screenshot)

        diff = ScreenDiff(
            employee_id=employee_id,
            device_id=device_id,
            current_screenshot_id=screenshot.id,
            hash_distance=1.2,
            ssim_score=0.92,
            changed_block_ratio=0.34,
            ignored_region_ratio=0.05,
            change_level="major",
            is_effective_change=True,
        )
        event = BehaviorEvent(
            employee_id=employee_id,
            device_id=device_id,
            event_type="no_change_streak_triggered",
            severity="high",
            start_at=datetime(2026, 5, 11, 10, 20, 0, tzinfo=timezone.utc),
            end_at=datetime(2026, 5, 11, 10, 25, 0, tzinfo=timezone.utc),
            duration_seconds=300,
            related_screenshot_id=screenshot.id,
            streak_count=6,
            status="open",
            reason="Repeated frames detected",
            details_json={"source": "rule-engine"},
        )
        session.add(diff)
        session.add(event)
        session.commit()
        session.refresh(event)

    timeline_response = client.get(
        f"/api/employees/{seeded_device['employee_id']}/timeline",
        params={"date": "2026-05-11"},
    )
    events_response = client.get(
        "/api/events",
        params={
            "employee_id": seeded_device["employee_id"],
            "severity": "high",
            "from": "2026-05-11T00:00:00Z",
            "to": "2026-05-11T23:59:59Z",
        },
    )
    event_detail_response = client.get(f"/api/events/{event.id}")

    assert timeline_response.status_code == 200
    timeline_payload = timeline_response.json()
    assert timeline_payload["items"][0]["change_level"] == "major"
    assert timeline_payload["items"][0]["change"]["level"] == "major"
    assert timeline_payload["items"][0]["change"]["effective"] is True
    assert timeline_payload["items"][0]["change"]["hash_distance"] == 1.2
    assert timeline_payload["items"][0]["change"]["ssim_score"] == 0.92
    assert timeline_payload["items"][0]["change"]["reason"] is None
    assert timeline_payload["items"][0]["thumb_uri"] == "thumbnails/example.jpg"
    assert timeline_payload["items"][0]["image_uri"] is None
    assert timeline_payload["items"][0]["keyboard_count"] == 23
    assert timeline_payload["items"][0]["mouse_count"] == 23
    assert timeline_payload["items"][0]["activity"]["keyboard_count"] == 23
    assert timeline_payload["items"][0]["risk_events"][0]["severity"] == "high"
    assert timeline_payload["items"][0]["risk_events"][0]["streak_count"] == 6

    assert events_response.status_code == 200
    events_payload = events_response.json()
    assert events_payload["total"] == 1
    assert events_payload["items"][0]["event_type"] == "no_change_streak_triggered"
    assert events_payload["items"][0]["screen_index"] == 0
    assert events_payload["items"][0]["related_diff"]["change_level"] == "major"

    assert event_detail_response.status_code == 200
    event_detail_payload = event_detail_response.json()
    assert event_detail_payload["id"] == str(event.id)
    assert event_detail_payload["related_diff"]["hash_distance"] == 1.2


def test_screenshot_list_and_detail_queries(client: TestClient, seeded_device: dict[str, str]) -> None:
    app = client.app
    employee_id = UUID(seeded_device["employee_id"])
    device_id = UUID(seeded_device["device_id"])

    with Session(app.state.engine) as session:
        screenshots = [
            Screenshot(
                employee_id=employee_id,
                device_id=device_id,
                captured_at=datetime(2026, 5, 11, 9, 0, index, tzinfo=timezone.utc),
                screen_index=index,
                image_uri=f"storage/screenshots/{index}.jpg",
                thumb_uri=f"storage/screenshots/{index}_thumb.jpg",
                width=1920,
                height=1080,
                foreground_process="Cursor.exe",
                window_title=f"Window {index}",
                keyboard_count=index,
                mouse_click_count=index,
                mouse_move_count=index,
                is_locked=False,
                is_remote_session=False,
                upload_status="completed",
                ocr_status="pending",
                analysis_status="pending",
            )
            for index in range(2)
        ]
        for screenshot in screenshots:
            session.add(screenshot)
        session.commit()
        for screenshot in screenshots:
            session.refresh(screenshot)

    list_response = client.get(
        "/api/screenshots",
        params={
            "employee_id": seeded_device["employee_id"],
            "device_id": seeded_device["device_id"],
            "limit": 1,
        },
    )

    assert list_response.status_code == 200
    list_payload = list_response.json()
    assert list_payload["total"] == 1
    assert list_payload["items"][0]["screen_index"] == 1
    assert list_payload["items"][0]["thumb_uri"].endswith("_thumb.jpg")
    assert list_payload["items"][0]["diff"] is None

    screenshot_id = list_payload["items"][0]["id"]
    detail_response = client.get(f"/api/screenshots/{screenshot_id}")

    assert detail_response.status_code == 200
    detail_payload = detail_response.json()
    assert detail_payload["employee_id"] == str(employee_id)
    assert detail_payload["device_id"] == str(device_id)
    assert detail_payload["image_uri"].endswith(".jpg")
    assert detail_payload["risk_events"] == []
