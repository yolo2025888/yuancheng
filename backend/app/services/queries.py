from __future__ import annotations

from datetime import date, datetime, time, timezone
from uuid import UUID

from sqlmodel import Session, select

from app.models import BehaviorEvent, Device, Employee, Policy, ScreenDiff, Screenshot
from app.schemas.admin import (
    DeviceItem,
    DeviceListResponse,
    EmployeeItem,
    EmployeeListResponse,
    PolicyItem,
    PolicyListResponse,
    PolicySummary,
    SafeForegroundWindow,
    SafeInputActivity,
    SafeSessionState,
)
from app.schemas.query import (
    BehaviorEventDetail,
    BehaviorEventListResponse,
    BehaviorEventReviewRequest,
    ScreenDiffSummary,
    ScreenshotItem,
    ScreenshotListResponse,
    TimelineActivity,
    TimelineChange,
    TimelineItem,
    TimelineResponse,
    TimelineRiskEvent,
)


def day_bounds(date_value: date) -> tuple[datetime, datetime]:
    start = datetime.combine(date_value, time.min, tzinfo=timezone.utc)
    end = datetime.combine(date_value, time.max, tzinfo=timezone.utc)
    return start, end


def ensure_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


class QueryService:
    def __init__(self, session: Session):
        self.session = session

    def _screen_diff_map(self, screenshot_ids: list[UUID]) -> dict[UUID, ScreenDiff]:
        if not screenshot_ids:
            return {}
        diffs = self.session.exec(
            select(ScreenDiff).where(ScreenDiff.current_screenshot_id.in_(screenshot_ids))
        ).all()
        return {diff.current_screenshot_id: diff for diff in diffs}

    def _relevant_events(
        self,
        screenshots: list[Screenshot],
    ) -> list[BehaviorEvent]:
        if not screenshots:
            return []

        employee_ids = list({screenshot.employee_id for screenshot in screenshots})
        device_ids = list({screenshot.device_id for screenshot in screenshots})
        start_at = min(screenshot.captured_at for screenshot in screenshots)
        end_at = max(screenshot.captured_at for screenshot in screenshots)
        return self.session.exec(
            select(BehaviorEvent)
            .where(BehaviorEvent.employee_id.in_(employee_ids))
            .where(BehaviorEvent.device_id.in_(device_ids))
            .where(BehaviorEvent.start_at <= end_at)
            .where((BehaviorEvent.end_at.is_(None)) | (BehaviorEvent.end_at >= start_at))
            .order_by(BehaviorEvent.start_at.asc())
        ).all()

    def _risk_events_for_screenshot(
        self,
        *,
        screenshot: Screenshot,
        events: list[BehaviorEvent],
    ) -> list[TimelineRiskEvent]:
        return [
            TimelineRiskEvent(
                id=event.id,
                event_type=event.event_type,
                severity=event.severity,
                status=event.status,
                streak_count=event.streak_count,
                related_diff_id=event.related_diff_id,
                reason=event.reason,
            )
            for event in events
            if (
                event.device_id == screenshot.device_id
                and (
                    event.related_screenshot_id == screenshot.id
                    or (
                        event.start_at <= screenshot.captured_at
                        and (event.end_at is None or event.end_at >= screenshot.captured_at)
                    )
                )
            )
        ]

    def _build_diff_summary(self, diff: ScreenDiff | None) -> ScreenDiffSummary | None:
        if diff is None:
            return None
        return ScreenDiffSummary.model_validate(diff)

    def _build_screenshot_item(
        self,
        *,
        screenshot: Screenshot,
        diff: ScreenDiff | None,
        events: list[BehaviorEvent],
    ) -> ScreenshotItem:
        return ScreenshotItem(
            id=screenshot.id,
            employee_id=screenshot.employee_id,
            device_id=screenshot.device_id,
            captured_at=screenshot.captured_at,
            screen_index=screenshot.screen_index,
            image_uri=screenshot.image_uri,
            thumb_uri=screenshot.thumb_uri,
            width=screenshot.width,
            height=screenshot.height,
            foreground_process=screenshot.foreground_process,
            window_title=screenshot.window_title,
            keyboard_count=screenshot.keyboard_count,
            mouse_click_count=screenshot.mouse_click_count,
            mouse_move_count=screenshot.mouse_move_count,
            mouse_wheel_count=screenshot.mouse_wheel_count,
            window_switch_count=screenshot.window_switch_count,
            is_locked=screenshot.is_locked,
            is_remote_session=screenshot.is_remote_session,
            is_rdp_session=screenshot.is_rdp_session,
            idle_seconds=screenshot.idle_seconds,
            input_desktop_name=screenshot.input_desktop_name,
            session_connect_state=screenshot.session_connect_state,
            phash=screenshot.phash,
            upload_status=screenshot.upload_status,
            ocr_status=screenshot.ocr_status,
            analysis_status=screenshot.analysis_status,
            diff=self._build_diff_summary(diff),
            risk_events=self._risk_events_for_screenshot(screenshot=screenshot, events=events),
            created_at=screenshot.created_at,
            updated_at=screenshot.updated_at,
        )

    def _event_screen_index(self, event: BehaviorEvent) -> int | None:
        screen_index = event.details_json.get("screen_index")
        if isinstance(screen_index, int):
            return screen_index
        if event.related_screenshot_id is None:
            return None
        screenshot = self.session.get(Screenshot, event.related_screenshot_id)
        return screenshot.screen_index if screenshot is not None else None

    def _build_event_detail(
        self,
        *,
        event: BehaviorEvent,
        diff_map: dict[UUID, ScreenDiff] | None = None,
    ) -> BehaviorEventDetail:
        related_diff = None
        if event.related_diff_id is not None and diff_map is not None:
            related_diff = diff_map.get(event.related_diff_id)
        elif event.related_diff_id is not None:
            related_diff = self.session.get(ScreenDiff, event.related_diff_id)
        elif event.related_screenshot_id is not None:
            related_diff = self.session.exec(
                select(ScreenDiff).where(ScreenDiff.current_screenshot_id == event.related_screenshot_id)
            ).first()

        return BehaviorEventDetail(
            id=event.id,
            employee_id=event.employee_id,
            device_id=event.device_id,
            event_type=event.event_type,
            severity=event.severity,
            screen_index=self._event_screen_index(event),
            start_at=event.start_at,
            end_at=event.end_at,
            duration_seconds=event.duration_seconds,
            related_screenshot_id=event.related_screenshot_id,
            related_diff_id=event.related_diff_id,
            streak_count=event.streak_count,
            status=event.status,
            reason=event.reason,
            details_json=event.details_json,
            related_diff=self._build_diff_summary(related_diff),
            reviewed_by=event.reviewed_by,
            reviewed_at=event.reviewed_at,
            review_note=event.review_note,
            created_at=event.created_at,
            updated_at=event.updated_at,
        )

    def get_employee_timeline(self, employee_id: UUID, date_value: date) -> TimelineResponse:
        start_at, end_at = day_bounds(date_value)
        screenshots = self.session.exec(
            select(Screenshot)
            .where(Screenshot.employee_id == employee_id)
            .where(Screenshot.captured_at >= start_at)
            .where(Screenshot.captured_at <= end_at)
            .order_by(Screenshot.captured_at.asc())
        ).all()
        diff_map = self._screen_diff_map([screenshot.id for screenshot in screenshots])
        events = self.session.exec(
            select(BehaviorEvent)
            .where(BehaviorEvent.employee_id == employee_id)
            .where(BehaviorEvent.start_at <= end_at)
            .where((BehaviorEvent.end_at.is_(None)) | (BehaviorEvent.end_at >= start_at))
            .order_by(BehaviorEvent.start_at.asc())
        ).all()

        items: list[TimelineItem] = []
        for screenshot in screenshots:
            risk_events = self._risk_events_for_screenshot(screenshot=screenshot, events=events)
            diff = diff_map.get(screenshot.id)
            items.append(
                TimelineItem(
                    time=ensure_utc(screenshot.captured_at).strftime("%H:%M:%S"),
                    screenshot_id=screenshot.id,
                    thumbnail_url=screenshot.thumb_uri,
                    thumb_uri=screenshot.thumb_uri,
                    image_uri=screenshot.image_uri,
                    activity_type="unknown",
                    activity=TimelineActivity(
                        type="unknown",
                        keyboard_count=screenshot.keyboard_count,
                        mouse_count=screenshot.mouse_click_count + screenshot.mouse_move_count,
                    ),
                    change_level=diff.change_level if diff is not None else "unknown",
                    change=TimelineChange(
                        level=diff.change_level if diff is not None else "unknown",
                        effective=diff.is_effective_change if diff is not None else False,
                        hash_distance=diff.hash_distance if diff is not None else None,
                        ssim_score=diff.ssim_score if diff is not None else None,
                        changed_block_ratio=diff.changed_block_ratio if diff is not None else None,
                        previous_screenshot_id=diff.previous_screenshot_id if diff is not None else None,
                        reason=diff.reason if diff is not None else None,
                    ),
                    keyboard_count=screenshot.keyboard_count,
                    mouse_count=screenshot.mouse_click_count + screenshot.mouse_move_count,
                    risk_events=risk_events,
                )
            )

        return TimelineResponse(employee_id=employee_id, date=date_value, items=items)

    def list_events(
        self,
        employee_id: UUID | None,
        severity: str | None,
        event_type: str | None,
        start_from: datetime | None,
        end_to: datetime | None,
    ) -> BehaviorEventListResponse:
        statement = select(BehaviorEvent).order_by(BehaviorEvent.start_at.desc())
        if employee_id is not None:
            statement = statement.where(BehaviorEvent.employee_id == employee_id)
        if severity is not None:
            statement = statement.where(BehaviorEvent.severity == severity)
        if event_type is not None:
            statement = statement.where(BehaviorEvent.event_type == event_type)
        if start_from is not None:
            statement = statement.where(BehaviorEvent.start_at >= start_from)
        if end_to is not None:
            statement = statement.where(BehaviorEvent.start_at <= end_to)

        events = self.session.exec(statement).all()
        diff_ids = [event.related_diff_id for event in events if event.related_diff_id is not None]
        diff_map = {}
        if diff_ids:
            diff_map = {
                diff.id: diff
                for diff in self.session.exec(select(ScreenDiff).where(ScreenDiff.id.in_(diff_ids))).all()
            }
        return BehaviorEventListResponse(
            items=[self._build_event_detail(event=event, diff_map=diff_map) for event in events],
            total=len(events),
        )

    def get_event(self, event_id: UUID) -> BehaviorEventDetail | None:
        event = self.session.get(BehaviorEvent, event_id)
        if event is None:
            return None
        return self._build_event_detail(event=event)

    def review_event(self, event_id: UUID, payload: BehaviorEventReviewRequest) -> BehaviorEventDetail | None:
        event = self.session.get(BehaviorEvent, event_id)
        if event is None:
            return None

        if payload.status is not None:
            event.status = payload.status
        event.review_note = payload.review_note
        event.reviewed_at = datetime.now(timezone.utc)
        event.updated_at = event.reviewed_at
        self.session.add(event)
        self.session.commit()
        self.session.refresh(event)
        return self._build_event_detail(event=event)

    def list_screenshots(
        self,
        *,
        device_id: UUID | None,
        employee_id: UUID | None,
        limit: int,
    ) -> ScreenshotListResponse:
        statement = select(Screenshot).order_by(Screenshot.captured_at.desc())
        if device_id is not None:
            statement = statement.where(Screenshot.device_id == device_id)
        if employee_id is not None:
            statement = statement.where(Screenshot.employee_id == employee_id)

        screenshots = self.session.exec(statement.limit(limit)).all()
        diff_map = self._screen_diff_map([screenshot.id for screenshot in screenshots])
        events = self._relevant_events(screenshots)
        return ScreenshotListResponse(
            items=[
                self._build_screenshot_item(
                    screenshot=screenshot,
                    diff=diff_map.get(screenshot.id),
                    events=events,
                )
                for screenshot in screenshots
            ],
            total=len(screenshots),
        )

    def get_screenshot(self, screenshot_id: UUID) -> ScreenshotItem | None:
        screenshot = self.session.get(Screenshot, screenshot_id)
        if screenshot is None:
            return None
        diff_map = self._screen_diff_map([screenshot.id])
        return self._build_screenshot_item(
            screenshot=screenshot,
            diff=diff_map.get(screenshot.id),
            events=self._relevant_events([screenshot]),
        )

    def list_employees(self) -> EmployeeListResponse:
        employees = self.session.exec(select(Employee).order_by(Employee.employee_no.asc(), Employee.name.asc())).all()
        devices = self.session.exec(select(Device)).all()
        active_policy = self.session.exec(
            select(Policy).where(Policy.is_active.is_(True)).order_by(Policy.created_at.desc())
        ).first()
        policy_summary = PolicySummary.model_validate(active_policy) if active_policy is not None else None

        active_device_counts: dict[UUID, int] = {}
        for device in devices:
            if device.employee_id is None or device.status == "offline":
                continue
            active_device_counts[device.employee_id] = active_device_counts.get(device.employee_id, 0) + 1

        return EmployeeListResponse(
            items=[
                EmployeeItem(
                    id=employee.id,
                    name=employee.name,
                    employee_no=employee.employee_no,
                    department=employee.department,
                    manager_name=employee.manager_name,
                    job_role=employee.job_role,
                    github_username=employee.github_username,
                    status=employee.status,
                    active_device_count=active_device_counts.get(employee.id, 0),
                    policy_summary=policy_summary,
                    created_at=employee.created_at,
                    updated_at=employee.updated_at,
                )
                for employee in employees
            ],
            total=len(employees),
        )

    def list_devices(self) -> DeviceListResponse:
        devices = self.session.exec(select(Device).order_by(Device.last_heartbeat_at.desc(), Device.hostname.asc())).all()
        employees = self.session.exec(select(Employee)).all()
        employees_by_id = {employee.id: employee for employee in employees}

        items = []
        for device in devices:
            employee = employees_by_id.get(device.employee_id) if device.employee_id is not None else None
            items.append(
                DeviceItem(
                    id=device.id,
                    employee_id=device.employee_id,
                    employee_name=employee.name if employee is not None else None,
                    employee_no=employee.employee_no if employee is not None else None,
                    hostname=device.hostname,
                    os_type=device.os_type,
                    agent_version=device.agent_version,
                    screen_count=device.screen_count,
                    status=device.status,
                    last_heartbeat_at=device.last_heartbeat_at,
                    last_foreground_window=(
                        SafeForegroundWindow.model_validate(device.last_foreground_window_json)
                        if device.last_foreground_window_json
                        else None
                    ),
                    last_session_state=(
                        SafeSessionState.model_validate(device.last_session_state_json)
                        if device.last_session_state_json
                        else None
                    ),
                    last_input_activity=(
                        SafeInputActivity.model_validate(device.last_input_activity_json)
                        if device.last_input_activity_json
                        else None
                    ),
                    created_at=device.created_at,
                    updated_at=device.updated_at,
                )
            )
        return DeviceListResponse(items=items, total=len(items))

    def list_policies(self) -> PolicyListResponse:
        policies = self.session.exec(select(Policy).order_by(Policy.is_active.desc(), Policy.created_at.desc())).all()
        return PolicyListResponse(
            items=[PolicyItem.model_validate(policy) for policy in policies],
            total=len(policies),
        )
