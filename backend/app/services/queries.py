from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, time, timezone
from uuid import UUID

from sqlmodel import Session, select

from app.models import AttendanceRecord, AuditLog, BehaviorEvent, Device, Employee, Policy, Role, ScreenDiff, Screenshot, User
from app.schemas.admin import (
    AccessCapabilityItem,
    AccessMatrixResponse,
    AccessRoleMatrixItem,
    AccessRoleUserItem,
    AttendanceListResponse,
    AttendanceRecordItem,
    AuditLogItem,
    AuditLogListResponse,
    DashboardPolicyCoverage,
    DashboardSummaryResponse,
    DeviceItem,
    DeviceListResponse,
    EmployeeRiskScoreItem,
    EmployeeRiskScoreListResponse,
    EmployeeItem,
    EmployeeListResponse,
    PolicyItem,
    PolicyListResponse,
    PolicySummary,
    RiskFactorItem,
    RiskLevelBreakdown,
    SafeForegroundWindow,
    SafeInputActivity,
    SafeSessionState,
)
from app.services.access_control import (
    ACCESS_CAPABILITY_DEFINITIONS,
    ACCESS_ROLE_TEMPLATES,
    access_template_for_role,
)
from app.services.audit import AuditContext, AuditService
from app.services.policies import PolicyService
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

SEVERITY_WEIGHTS = {
    "low": 8,
    "medium": 18,
    "high": 30,
    "critical": 42,
}

STATUS_MULTIPLIERS = {
    "open": 1.0,
    "in_progress": 0.85,
    "reviewed": 0.6,
    "resolved": 0.25,
    "dismissed": 0.15,
}

STALE_DEVICE_AFTER_SECONDS = 10 * 60
AGED_DEVICE_AFTER_SECONDS = 30 * 60


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
        self.audit = AuditService(session)

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
            image_uri=self._secured_screenshot_uri(screenshot.id, "image", screenshot.image_uri),
            thumb_uri=self._secured_screenshot_uri(screenshot.id, "thumbnail", screenshot.thumb_uri),
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
                    thumbnail_url=self._secured_screenshot_uri(screenshot.id, "thumbnail", screenshot.thumb_uri),
                    thumb_uri=self._secured_screenshot_uri(screenshot.id, "thumbnail", screenshot.thumb_uri),
                    image_uri=self._secured_screenshot_uri(screenshot.id, "image", screenshot.image_uri),
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

    def _secured_screenshot_uri(self, screenshot_id: UUID, kind: str, stored_uri: str | None) -> str | None:
        if not stored_uri:
            return None
        return f"/api/screenshots/{screenshot_id}/{kind}"

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

    def review_event(
        self,
        event_id: UUID,
        payload: BehaviorEventReviewRequest,
        *,
        audit_context: AuditContext | None = None,
    ) -> BehaviorEventDetail | None:
        event = self.session.get(BehaviorEvent, event_id)
        if event is None:
            return None

        if payload.status is not None:
            event.status = payload.status
        event.review_note = payload.review_note
        event.reviewed_at = datetime.now(timezone.utc)
        event.updated_at = event.reviewed_at
        self.session.add(event)
        self.audit.log(
            action="event.reviewed",
            target_type="behavior_event",
            target_id=event.id,
            reason=payload.review_note or (f"Set status to {payload.status}" if payload.status is not None else None),
            context=audit_context,
        )
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

    def _build_attendance_item(
        self,
        *,
        record: AttendanceRecord,
        employee: Employee | None,
    ) -> AttendanceRecordItem:
        return AttendanceRecordItem(
            id=record.id,
            employee_id=record.employee_id,
            device_id=record.device_id,
            employee_no=record.employee_no or (employee.employee_no if employee is not None else None),
            employee_name=employee.name if employee is not None else None,
            department=employee.department if employee is not None else None,
            user_name=record.user_name,
            machine_name=record.machine_name,
            event_type=record.event_type,
            occurred_at=record.occurred_at,
            work_date=record.work_date,
            anomaly_status=record.anomaly_status,
            anomaly_reasons=record.anomaly_reasons_json,
            review_status=record.review_status,
            review_note=record.review_note,
            reviewed_at=record.reviewed_at,
            source=record.source,
            created_at=record.created_at,
            updated_at=record.updated_at,
        )

    def list_attendance(
        self,
        *,
        work_date: date | None,
        anomaly_status: str | None,
        review_status: str | None,
        limit: int,
    ) -> AttendanceListResponse:
        statement = select(AttendanceRecord).order_by(AttendanceRecord.occurred_at.desc())
        if work_date is not None:
            statement = statement.where(AttendanceRecord.work_date == work_date)
        if anomaly_status is not None:
            statement = statement.where(AttendanceRecord.anomaly_status == anomaly_status)
        if review_status is not None:
            statement = statement.where(AttendanceRecord.review_status == review_status)

        records = self.session.exec(statement.limit(limit)).all()
        employee_ids = [record.employee_id for record in records if record.employee_id is not None]
        employees_by_id = {
            employee.id: employee
            for employee in self.session.exec(select(Employee).where(Employee.id.in_(employee_ids))).all()
        } if employee_ids else {}
        return AttendanceListResponse(
            items=[
                self._build_attendance_item(
                    record=record,
                    employee=employees_by_id.get(record.employee_id) if record.employee_id is not None else None,
                )
                for record in records
            ],
            total=len(records),
            generated_at=datetime.now(timezone.utc),
        )

    def list_employees(self) -> EmployeeListResponse:
        employees = self.session.exec(select(Employee).order_by(Employee.employee_no.asc(), Employee.name.asc())).all()
        devices = self.session.exec(select(Device)).all()
        active_policy = PolicyService(self.session).ensure_default_policy()
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

    def _risk_label(self, score: int) -> str:
        if score >= 75:
            return "critical"
        if score >= 50:
            return "high"
        if score >= 25:
            return "medium"
        return "low"

    def _format_elapsed(self, delta_seconds: float) -> str:
        seconds = max(int(delta_seconds), 0)
        if seconds < 60:
            return f"{seconds} seconds"
        minutes = seconds // 60
        if minutes < 60:
            unit = "minute" if minutes == 1 else "minutes"
            return f"{minutes} {unit}"
        hours = minutes // 60
        if hours < 24:
            unit = "hour" if hours == 1 else "hours"
            return f"{hours} {unit}"
        days = hours // 24
        unit = "day" if days == 1 else "days"
        return f"{days} {unit}"

    def _build_employee_risk_score(
        self,
        *,
        employee: Employee,
        devices: list[Device],
        events: list[BehaviorEvent],
        latest_screenshot: Screenshot | None,
        generated_at: datetime,
        resolved_policy: Policy,
        has_targeted_policy: bool,
        targeted_active_policy_count: int,
    ) -> EmployeeRiskScoreItem:
        factors: list[RiskFactorItem] = []

        open_event_count = sum(1 for event in events if event.status == "open")
        unresolved_high_event_count = sum(
            1
            for event in events
            if event.severity in {"high", "critical"} and event.status not in {"resolved", "dismissed"}
        )
        event_points = min(
            55,
            sum(
                round(
                    SEVERITY_WEIGHTS.get(event.severity, SEVERITY_WEIGHTS["medium"])
                    * STATUS_MULTIPLIERS.get(event.status, 0.7)
                )
                for event in events
            ),
        )
        if event_points > 0:
            if open_event_count and unresolved_high_event_count:
                reason = (
                    f"{open_event_count} open behavior events include "
                    f"{unresolved_high_event_count} unresolved high-severity signals."
                )
            elif open_event_count:
                reason = f"{open_event_count} open behavior events still need admin review."
            else:
                reason = f"{len(events)} behavior events contribute to the current score."
            factors.append(
                RiskFactorItem(
                    code="behavior_events",
                    label="Behavior events",
                    points=event_points,
                    reason=reason,
                )
            )

        stalled_events = [
            event
            for event in events
            if event.event_type == "no_change_streak_triggered" and event.status not in {"resolved", "dismissed"}
        ]
        if stalled_events:
            max_streak = max(event.streak_count for event in stalled_events)
            stalled_points = min(20, 8 + max(max_streak, 0))
            factors.append(
                RiskFactorItem(
                    code="no_change_streak",
                    label="No-change activity",
                    points=stalled_points,
                    reason=(
                        f"No-change activity has persisted for {max_streak} capture"
                        f"{'' if max_streak == 1 else 's'}."
                    ),
                )
            )

        total_device_count = len(devices)
        active_device_count = sum(1 for device in devices if device.status == "online")
        latest_heartbeat_at = max(
            (ensure_utc(device.last_heartbeat_at) for device in devices if device.last_heartbeat_at is not None),
            default=None,
        )
        if total_device_count == 0:
            factors.append(
                RiskFactorItem(
                    code="device_assignment",
                    label="Device assignment",
                    points=20,
                    reason="No company-owned device is currently assigned to this employee.",
                )
            )
        elif active_device_count == 0:
            factors.append(
                RiskFactorItem(
                    code="device_connectivity",
                    label="Device connectivity",
                    points=18,
                    reason="All assigned company-owned devices are currently offline.",
                )
            )
        elif latest_heartbeat_at is None:
            factors.append(
                RiskFactorItem(
                    code="heartbeat_missing",
                    label="Device heartbeat",
                    points=10,
                    reason="No heartbeat metadata has been received from the assigned devices.",
                )
            )
        else:
            heartbeat_age_seconds = (generated_at - latest_heartbeat_at).total_seconds()
            if heartbeat_age_seconds > AGED_DEVICE_AFTER_SECONDS:
                factors.append(
                    RiskFactorItem(
                        code="heartbeat_aged",
                        label="Device heartbeat",
                        points=16,
                        reason=f"The most recent heartbeat is {self._format_elapsed(heartbeat_age_seconds)} old.",
                    )
                )
            elif heartbeat_age_seconds > STALE_DEVICE_AFTER_SECONDS:
                factors.append(
                    RiskFactorItem(
                        code="heartbeat_stale",
                        label="Device heartbeat",
                        points=8,
                        reason=f"The most recent heartbeat is {self._format_elapsed(heartbeat_age_seconds)} old.",
                    )
                )

        latest_screenshot_at = ensure_utc(latest_screenshot.captured_at) if latest_screenshot is not None else None
        stale_screenshot_after_seconds = max(resolved_policy.screenshot_interval_seconds * 90, 15 * 60)
        aged_screenshot_after_seconds = max(resolved_policy.screenshot_interval_seconds * 360, 60 * 60)
        if latest_screenshot_at is None:
            factors.append(
                RiskFactorItem(
                    code="screenshot_missing",
                    label="Screenshot recency",
                    points=12,
                    reason="No screenshot metadata has been received for this employee yet.",
                )
            )
        else:
            screenshot_age_seconds = (generated_at - latest_screenshot_at).total_seconds()
            if screenshot_age_seconds > aged_screenshot_after_seconds:
                factors.append(
                    RiskFactorItem(
                        code="screenshot_aged",
                        label="Screenshot recency",
                        points=16,
                        reason=f"The latest screenshot metadata is {self._format_elapsed(screenshot_age_seconds)} old.",
                    )
                )
            elif screenshot_age_seconds > stale_screenshot_after_seconds:
                factors.append(
                    RiskFactorItem(
                        code="screenshot_stale",
                        label="Screenshot recency",
                        points=8,
                        reason=f"The latest screenshot metadata is {self._format_elapsed(screenshot_age_seconds)} old.",
                    )
                )

        if targeted_active_policy_count > 0 and not has_targeted_policy:
            reason = "Only the default monitoring policy currently applies to this employee."
            if not employee.job_role and not employee.department:
                reason = "Role and department metadata are missing, so targeted policy coverage cannot be verified."
            factors.append(
                RiskFactorItem(
                    code="policy_coverage",
                    label="Policy coverage",
                    points=8,
                    reason=reason,
                )
            )

        score = min(100, sum(factor.points for factor in factors))
        sorted_factors = sorted(factors, key=lambda factor: (-factor.points, factor.label))
        reasons = [factor.reason for factor in sorted_factors[:3]]
        if not reasons:
            reasons = ["No elevated risk signals detected from current activity metadata."]

        return EmployeeRiskScoreItem(
            employee_id=employee.id,
            employee_no=employee.employee_no,
            employee_name=employee.name,
            department=employee.department,
            job_role=employee.job_role,
            score=score,
            label=self._risk_label(score),
            reasons=reasons,
            active_device_count=active_device_count,
            total_device_count=total_device_count,
            latest_heartbeat_at=latest_heartbeat_at,
            latest_screenshot_at=latest_screenshot_at,
            open_event_count=open_event_count,
            high_severity_event_count=unresolved_high_event_count,
            stalled_event_count=len(stalled_events),
            policy_name=resolved_policy.name,
            policy_version=resolved_policy.version,
            has_targeted_policy=has_targeted_policy,
            factors=sorted_factors,
        )

    def _build_risk_snapshot(self) -> tuple[datetime, list[EmployeeRiskScoreItem], dict[str, int], list[Device], list[BehaviorEvent], list[Screenshot]]:
        generated_at = datetime.now(timezone.utc)
        employees = self.session.exec(select(Employee).order_by(Employee.employee_no.asc(), Employee.name.asc())).all()
        devices = self.session.exec(select(Device).order_by(Device.hostname.asc())).all()
        events = self.session.exec(select(BehaviorEvent).order_by(BehaviorEvent.start_at.desc())).all()
        screenshots = self.session.exec(select(Screenshot).order_by(Screenshot.captured_at.desc())).all()

        devices_by_employee: dict[UUID, list[Device]] = defaultdict(list)
        for device in devices:
            if device.employee_id is not None:
                devices_by_employee[device.employee_id].append(device)

        events_by_employee: dict[UUID, list[BehaviorEvent]] = defaultdict(list)
        for event in events:
            events_by_employee[event.employee_id].append(event)

        latest_screenshot_by_employee: dict[UUID, Screenshot] = {}
        for screenshot in screenshots:
            latest_screenshot_by_employee.setdefault(screenshot.employee_id, screenshot)

        policy_service = PolicyService(self.session)
        default_policy = policy_service.ensure_default_policy()
        active_policies = self.session.exec(
            select(Policy).where(Policy.is_active.is_(True)).order_by(Policy.updated_at.desc(), Policy.created_at.desc())
        ).all()
        if all(policy.id != default_policy.id for policy in active_policies):
            active_policies.append(default_policy)

        targeted_active_policy_count = sum(
            1 for policy in active_policies if policy_service._has_target_rules(policy.rules_json)
        )
        employees_with_targeted_policy = 0
        employees_default_only = 0
        risk_scores: list[EmployeeRiskScoreItem] = []

        for employee in employees:
            matching_targeted_policies = [
                policy
                for policy in active_policies
                if policy_service._has_target_rules(policy.rules_json)
                and policy_service._policy_matches_employee(policy, employee)
            ]
            has_targeted_policy = bool(matching_targeted_policies)
            if has_targeted_policy:
                employees_with_targeted_policy += 1
                resolved_policy = max(matching_targeted_policies, key=policy_service._policy_priority)
            else:
                employees_default_only += 1
                resolved_policy = default_policy

            risk_scores.append(
                self._build_employee_risk_score(
                    employee=employee,
                    devices=devices_by_employee.get(employee.id, []),
                    events=events_by_employee.get(employee.id, []),
                    latest_screenshot=latest_screenshot_by_employee.get(employee.id),
                    generated_at=generated_at,
                    resolved_policy=resolved_policy,
                    has_targeted_policy=has_targeted_policy,
                    targeted_active_policy_count=targeted_active_policy_count,
                )
            )

        risk_scores.sort(key=lambda item: (-item.score, item.employee_no, item.employee_name.casefold()))
        coverage = {
            "active_policy_count": len(active_policies),
            "targeted_active_policy_count": targeted_active_policy_count,
            "employees_with_targeted_policy": employees_with_targeted_policy,
            "employees_default_only": employees_default_only,
        }
        return generated_at, risk_scores, coverage, devices, events, screenshots

    def get_dashboard_summary(self) -> DashboardSummaryResponse:
        generated_at, risk_scores, coverage, devices, events, screenshots = self._build_risk_snapshot()
        risk_distribution = RiskLevelBreakdown()
        for item in risk_scores:
            setattr(risk_distribution, item.label, getattr(risk_distribution, item.label) + 1)

        stale_device_count = sum(
            1
            for device in devices
            if device.status != "offline"
            and (
                device.last_heartbeat_at is None
                or (generated_at - ensure_utc(device.last_heartbeat_at)).total_seconds() > STALE_DEVICE_AFTER_SECONDS
            )
        )
        screenshot_window_start = generated_at.replace(microsecond=0)  # keeps response stable for tests
        screenshot_count_24h = sum(
            1
            for screenshot in screenshots
            if (screenshot_window_start - ensure_utc(screenshot.captured_at)).total_seconds() <= 24 * 60 * 60
        )

        employees = self.session.exec(select(Employee)).all()
        return DashboardSummaryResponse(
            generated_at=generated_at,
            employee_count=len(employees),
            active_employee_count=sum(1 for employee in employees if employee.status == "active"),
            device_count=len(devices),
            online_device_count=sum(1 for device in devices if device.status == "online"),
            stale_device_count=stale_device_count,
            offline_device_count=sum(1 for device in devices if device.status == "offline"),
            screenshot_count_24h=screenshot_count_24h,
            open_event_count=sum(1 for event in events if event.status == "open"),
            unresolved_high_risk_event_count=sum(
                1
                for event in events
                if event.severity in {"high", "critical"} and event.status not in {"resolved", "dismissed"}
            ),
            risk_distribution=risk_distribution,
            policy_coverage=DashboardPolicyCoverage(**coverage),
            top_risks=risk_scores[:5],
        )

    def list_risk_scores(self, limit: int | None = None) -> EmployeeRiskScoreListResponse:
        generated_at, risk_scores, _, _, _, _ = self._build_risk_snapshot()
        items = risk_scores if limit is None else risk_scores[:limit]
        return EmployeeRiskScoreListResponse(
            items=items,
            total=len(risk_scores),
            generated_at=generated_at,
        )

    def get_access_matrix(self) -> AccessMatrixResponse:
        roles = self.session.exec(select(Role).order_by(Role.name.asc())).all()
        users = self.session.exec(select(User).order_by(User.username.asc())).all()

        users_by_role: dict[UUID, list[AccessRoleUserItem]] = defaultdict(list)
        unassigned_users: list[AccessRoleUserItem] = []
        for user in users:
            user_item = AccessRoleUserItem(
                id=user.id,
                username=user.username,
                display_name=user.display_name,
                email=user.email,
                status=user.status,
            )
            if user.role_id is None:
                unassigned_users.append(user_item)
                continue
            users_by_role[user.role_id].append(user_item)

        role_items: list[AccessRoleMatrixItem] = []
        existing_role_names: set[str] = set()
        for role in roles:
            existing_role_names.add(role.name.casefold())
            template = access_template_for_role(role.name)
            assigned_users = users_by_role.get(role.id, [])
            role_items.append(
                AccessRoleMatrixItem(
                    role_id=role.id,
                    name=role.name,
                    description=role.description or str(template["description"]),
                    source="existing",
                    permission_keys=list(template["permission_keys"]),
                    member_count=len(assigned_users),
                    users=assigned_users,
                )
            )

        for template in ACCESS_ROLE_TEMPLATES:
            if template["name"].casefold() in existing_role_names:
                continue
            role_items.append(
                AccessRoleMatrixItem(
                    role_id=None,
                    name=str(template["name"]),
                    description=str(template["description"]),
                    source="recommended",
                    permission_keys=list(template["permission_keys"]),
                    member_count=0,
                    users=[],
                )
            )

        role_items.sort(key=lambda item: (item.source != "existing", item.name.casefold()))
        unassigned_users.sort(key=lambda item: item.username.casefold())
        return AccessMatrixResponse(
            generated_at=datetime.now(timezone.utc),
            capabilities=[AccessCapabilityItem(**definition) for definition in ACCESS_CAPABILITY_DEFINITIONS],
            roles=role_items,
            unassigned_users=unassigned_users,
        )

    def list_policies(self) -> PolicyListResponse:
        policies = self.session.exec(select(Policy).order_by(Policy.is_active.desc(), Policy.created_at.desc())).all()
        return PolicyListResponse(
            items=[PolicyItem.model_validate(policy) for policy in policies],
            total=len(policies),
        )

    def list_audit_logs(self, limit: int) -> AuditLogListResponse:
        audit_logs = self.session.exec(
            select(AuditLog).order_by(AuditLog.created_at.desc()).limit(limit)
        ).all()
        return AuditLogListResponse(
            items=[AuditLogItem.model_validate(audit_log) for audit_log in audit_logs],
            total=len(audit_logs),
        )
