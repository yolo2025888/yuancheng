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
    assert timeline_payload["items"][0]["keyboard_count"] == 23
    assert timeline_payload["items"][0]["mouse_count"] == 23
    assert timeline_payload["items"][0]["risk_events"][0]["severity"] == "high"

    assert events_response.status_code == 200
    events_payload = events_response.json()
    assert events_payload["total"] == 1
    assert events_payload["items"][0]["event_type"] == "no_change_streak_triggered"

    assert event_detail_response.status_code == 200
    assert event_detail_response.json()["id"] == str(event.id)
