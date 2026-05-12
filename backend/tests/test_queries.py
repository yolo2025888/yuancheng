from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID, uuid4

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.models import AttendanceRecord, BehaviorEvent, Device, Employee, ScreenDiff, Screenshot, User


def test_timeline_and_events_queries(client: TestClient, seeded_device: dict[str, str], auth_headers) -> None:
    headers = auth_headers(bootstrap=True)
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
            foreground_process="Cursor.exe",
            window_title="employee-monitor - Cursor",
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
        headers=headers,
    )
    events_response = client.get(
        "/api/events",
        params={
            "employee_id": seeded_device["employee_id"],
            "severity": "high",
            "from": "2026-05-11T00:00:00Z",
            "to": "2026-05-11T23:59:59Z",
        },
        headers=headers,
    )
    event_detail_response = client.get(f"/api/events/{event.id}", headers=headers)

    assert timeline_response.status_code == 200
    timeline_payload = timeline_response.json()
    assert timeline_payload["items"][0]["change_level"] == "major"
    assert timeline_payload["items"][0]["change"]["level"] == "major"
    assert timeline_payload["items"][0]["change"]["effective"] is True
    assert timeline_payload["items"][0]["change"]["hash_distance"] == 1.2
    assert timeline_payload["items"][0]["change"]["ssim_score"] == 0.92
    assert timeline_payload["items"][0]["change"]["reason"] is None
    assert timeline_payload["items"][0]["thumb_uri"].endswith("/thumbnail")
    assert timeline_payload["items"][0]["image_uri"] is None
    assert timeline_payload["items"][0]["keyboard_count"] == 23
    assert timeline_payload["items"][0]["mouse_count"] == 23
    assert timeline_payload["items"][0]["activity_type"] == "development"
    assert timeline_payload["items"][0]["active_app"] == "cursor"
    assert timeline_payload["items"][0]["activity_confidence"] >= 0.8
    assert "Development activity" in timeline_payload["items"][0]["activity_summary"]
    assert timeline_payload["items"][0]["activity"]["type"] == "development"
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


def test_screenshot_list_and_detail_queries(client: TestClient, seeded_device: dict[str, str], auth_headers) -> None:
    headers = auth_headers(bootstrap=True)
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
        headers=headers,
    )

    assert list_response.status_code == 200
    list_payload = list_response.json()
    assert list_payload["total"] == 1
    assert list_payload["items"][0]["screen_index"] == 1
    assert list_payload["items"][0]["thumb_uri"].endswith("/thumbnail")
    assert list_payload["items"][0]["foreground_process"] is None
    assert list_payload["items"][0]["window_title"] is None
    assert list_payload["items"][0]["diff"] is None
    assert list_payload["items"][0]["activity_type"] == "development"
    assert list_payload["items"][0]["active_app"] == "cursor"

    screenshot_id = list_payload["items"][0]["id"]
    detail_response = client.get(f"/api/screenshots/{screenshot_id}", headers=headers)

    assert detail_response.status_code == 200
    detail_payload = detail_response.json()
    assert detail_payload["employee_id"] == str(employee_id)
    assert detail_payload["device_id"] == str(device_id)
    assert detail_payload["image_uri"].endswith("/image")
    assert detail_payload["foreground_process"] is None
    assert detail_payload["window_title"] is None
    assert detail_payload["risk_events"] == []
    assert detail_payload["activity_type"] == "development"
    assert detail_payload["activity_summary"]


def test_scoped_role_limits_directory_screenshots_images_and_timeline(
    client: TestClient,
    seeded_device: dict[str, str],
    auth_headers,
) -> None:
    admin_headers = auth_headers(bootstrap=True)
    scoped_headers = auth_headers(
        username="dana.manager",
        password="manager-password",
        role_name="Risk Analyst",
        display_name="Dana",
        email="dana@example.test",
    )
    unbound_headers = auth_headers(
        username="E-001",
        password="unbound-password",
        role_name="Risk Analyst",
        display_name="Unbound Analyst",
        email="E-001@example.test",
    )
    employee_id = UUID(seeded_device["employee_id"])
    device_id = UUID(seeded_device["device_id"])
    manager_employee_id = uuid4()
    other_manager_employee_id = uuid4()
    other_employee_id = uuid4()
    other_device_id = uuid4()
    storage_root = Path(client.app.state.settings.storage_root_dir)
    in_scope_image = storage_root / "screenshots" / "in-scope.png"
    in_scope_thumb = storage_root / "screenshots" / "in-scope-thumb.png"
    out_scope_image = storage_root / "screenshots" / "out-scope.png"
    out_scope_thumb = storage_root / "screenshots" / "out-scope-thumb.png"
    for path in (in_scope_image, in_scope_thumb, out_scope_image, out_scope_thumb):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"image")

    with Session(client.app.state.engine) as session:
        user = session.exec(select(User).where(User.username == "dana.manager")).one()
        user.employee_id = manager_employee_id
        session.add(user)

        session.add(
            Employee(
                id=manager_employee_id,
                name="Dana",
                employee_no="M-001",
                department="Engineering",
                job_role="Engineering Manager",
            )
        )
        session.add(
            Employee(
                id=other_manager_employee_id,
                name="Dana",
                employee_no="M-002",
                department="Engineering",
                job_role="Engineering Manager",
            )
        )
        employee = session.get(Employee, employee_id)
        assert employee is not None
        employee.manager_id = manager_employee_id
        employee.manager_name = "Dana"
        session.add(employee)

        session.add(
            Employee(
                id=other_employee_id,
                name="Bob",
                employee_no="E-002",
                department="Engineering",
                manager_id=other_manager_employee_id,
                manager_name="Dana",
            )
        )
        session.add(
            Device(
                id=other_device_id,
                employee_id=other_employee_id,
                hostname="DEV-PC-002",
                os_type="windows",
                agent_version="0.1.0",
                status="online",
            )
        )
        session.add(
            Screenshot(
                employee_id=employee_id,
                device_id=device_id,
                captured_at=datetime(2026, 5, 11, 9, 0, tzinfo=timezone.utc),
                image_uri=in_scope_image.relative_to(storage_root.parent).as_posix(),
                thumb_uri=in_scope_thumb.relative_to(storage_root.parent).as_posix(),
                width=1,
                height=1,
                upload_status="completed",
            )
        )
        session.add(
            Screenshot(
                employee_id=other_employee_id,
                device_id=other_device_id,
                captured_at=datetime(2026, 5, 11, 10, 0, tzinfo=timezone.utc),
                image_uri=out_scope_image.relative_to(storage_root.parent).as_posix(),
                thumb_uri=out_scope_thumb.relative_to(storage_root.parent).as_posix(),
                width=1,
                height=1,
                upload_status="completed",
            )
        )
        session.add(
            BehaviorEvent(
                employee_id=employee_id,
                device_id=device_id,
                event_type="github_clone",
                severity="high",
                start_at=datetime(2026, 5, 11, 9, 5, tzinfo=timezone.utc),
                status="open",
                reason="In-scope review.",
                details_json={
                    "repository": "company/private-repo",
                    "action": "clone",
                    "risk_rule": "Sensitive repository clone",
                },
            )
        )
        session.add(
            BehaviorEvent(
                employee_id=other_employee_id,
                device_id=other_device_id,
                event_type="github_fetch",
                severity="critical",
                start_at=datetime(2026, 5, 11, 10, 5, tzinfo=timezone.utc),
                status="open",
                reason="Out-of-scope review.",
                details_json={
                    "repository": "company/other-repo",
                    "action": "fetch",
                    "risk_rule": "Frequent fetch",
                },
            )
        )
        session.add(
            AttendanceRecord(
                employee_id=employee_id,
                device_id=device_id,
                employee_no="E-001",
                user_name="Alice",
                machine_name="DEV-PC-001",
                event_type="clock_in",
                occurred_at=datetime(2026, 5, 11, 8, 58, tzinfo=timezone.utc),
                work_date=datetime(2026, 5, 11, tzinfo=timezone.utc).date(),
            )
        )
        session.add(
            AttendanceRecord(
                employee_id=other_employee_id,
                device_id=other_device_id,
                employee_no="E-002",
                user_name="Bob",
                machine_name="DEV-PC-002",
                event_type="clock_in",
                occurred_at=datetime(2026, 5, 11, 8, 57, tzinfo=timezone.utc),
                work_date=datetime(2026, 5, 11, tzinfo=timezone.utc).date(),
            )
        )
        session.commit()

        screenshots = session.exec(select(Screenshot).order_by(Screenshot.captured_at.asc())).all()
        in_scope_screenshot_id = screenshots[0].id
        out_scope_screenshot_id = screenshots[1].id
        events = session.exec(select(BehaviorEvent).order_by(BehaviorEvent.start_at.asc())).all()
        in_scope_event_id = events[0].id
        out_scope_event_id = events[1].id
        attendance_records = session.exec(select(AttendanceRecord).order_by(AttendanceRecord.occurred_at.asc())).all()
        out_scope_attendance_id = attendance_records[0].id
        in_scope_attendance_id = attendance_records[1].id

    employees_response = client.get("/api/employees", headers=scoped_headers)
    unbound_employees_response = client.get("/api/employees", headers=unbound_headers)
    devices_response = client.get("/api/devices", headers=scoped_headers)
    dashboard_response = client.get("/api/dashboard/summary", headers=scoped_headers)
    risk_scores_response = client.get("/api/risk/scores", headers=scoped_headers)
    github_risks_response = client.get("/api/github-risks", headers=scoped_headers)
    attendance_response = client.get("/api/attendance", headers=scoped_headers)
    screenshots_response = client.get("/api/screenshots", headers=scoped_headers)
    in_scope_detail_response = client.get(f"/api/screenshots/{in_scope_screenshot_id}", headers=scoped_headers)
    out_scope_detail_response = client.get(f"/api/screenshots/{out_scope_screenshot_id}", headers=scoped_headers)
    out_scope_image_response = client.get(
        f"/api/screenshots/{out_scope_screenshot_id}/image",
        params={"reason": "Manager scope check"},
        headers=admin_headers,
    )
    scoped_out_scope_image_response = client.get(
        f"/api/screenshots/{out_scope_screenshot_id}/image",
        params={"reason": "Scoped role check"},
        headers=scoped_headers,
    )
    out_scope_timeline_response = client.get(
        f"/api/employees/{other_employee_id}/timeline",
        params={"date": "2026-05-11"},
        headers=scoped_headers,
    )
    review_queue_response = client.get("/api/review-queue", headers=scoped_headers)
    events_response = client.get("/api/events", headers=scoped_headers)
    in_scope_event_response = client.get(f"/api/events/{in_scope_event_id}", headers=scoped_headers)
    out_scope_event_response = client.get(f"/api/events/{out_scope_event_id}", headers=scoped_headers)
    out_scope_event_review_response = client.post(
        f"/api/events/{out_scope_event_id}/review",
        headers=scoped_headers,
        json={"status": "dismissed", "review_note": "Should not be allowed"},
    )
    out_scope_attendance_review_response = client.post(
        f"/api/attendance/{out_scope_attendance_id}/review",
        headers=scoped_headers,
        json={"review_status": "reviewed", "review_note": "Should not be allowed"},
    )

    assert employees_response.status_code == 200
    assert {item["id"] for item in employees_response.json()["items"]} == {
        str(manager_employee_id),
        str(employee_id),
    }
    assert unbound_employees_response.status_code == 200
    assert unbound_employees_response.json()["items"] == []
    assert devices_response.status_code == 200
    assert [item["id"] for item in devices_response.json()["items"]] == [str(device_id)]
    assert dashboard_response.status_code == 200
    assert dashboard_response.json()["employee_count"] == 2
    assert dashboard_response.json()["device_count"] == 1
    assert dashboard_response.json()["open_event_count"] == 1
    assert risk_scores_response.status_code == 200
    assert {item["employee_id"] for item in risk_scores_response.json()["items"]} == {
        str(manager_employee_id),
        str(employee_id),
    }
    assert github_risks_response.status_code == 200
    assert [item["id"] for item in github_risks_response.json()["items"]] == [str(in_scope_event_id)]
    assert attendance_response.status_code == 200
    assert [item["id"] for item in attendance_response.json()["items"]] == [str(in_scope_attendance_id)]
    assert screenshots_response.status_code == 200
    assert [item["id"] for item in screenshots_response.json()["items"]] == [str(in_scope_screenshot_id)]
    assert in_scope_detail_response.status_code == 200
    assert out_scope_detail_response.status_code == 404
    assert out_scope_image_response.status_code == 200
    assert scoped_out_scope_image_response.status_code == 403
    assert scoped_out_scope_image_response.json()["detail"] == "Employee is outside the current access scope"
    assert out_scope_timeline_response.status_code == 403
    assert review_queue_response.status_code == 200
    assert [item["related_event_id"] for item in review_queue_response.json()["items"]] == [str(in_scope_event_id)]
    assert events_response.status_code == 200
    assert [item["id"] for item in events_response.json()["items"]] == [str(in_scope_event_id)]
    assert in_scope_event_response.status_code == 200
    assert out_scope_event_response.status_code == 404
    assert out_scope_event_review_response.status_code == 404
    assert out_scope_attendance_review_response.status_code == 404
