from __future__ import annotations

from collections import defaultdict
from collections.abc import Mapping
from datetime import date, datetime, time, timezone
from zoneinfo import ZoneInfo
from uuid import UUID

from sqlalchemy import and_, func, or_
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
    GitHubRiskEventCreateRequest,
    GitHubRiskEventItem,
    GitHubRiskEventListResponse,
    GitHubRiskTrendPoint,
    PolicyListResponse,
    PolicySummary,
    ReviewQueueItem,
    ReviewQueueResponse,
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
from app.services.access_scope import EmployeeAccessScope
from app.services.audit import AuditContext, AuditService
from app.services.policies import PolicyService
from app.services.screen_analysis import classify_screenshot_activity
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

SENSITIVE_DETAIL_KEY_MARKERS = ("token", "secret", "password", "passwd", "key", "email", "url")

STALE_DEVICE_AFTER_SECONDS = 10 * 60
AGED_DEVICE_AFTER_SECONDS = 30 * 60
REVIEWABLE_EVENT_STATUSES = {"open", "new", "reviewing", "in_progress"}
SEVERITY_ORDER = {
    "critical": 0,
    "high": 1,
    "medium": 2,
    "low": 3,
}


DISPLAY_TIMEZONE = ZoneInfo("Asia/Shanghai")


def day_bounds(date_value: date) -> tuple[datetime, datetime]:
    start_local = datetime.combine(date_value, time.min, tzinfo=DISPLAY_TIMEZONE)
    end_local = datetime.combine(date_value, time.max, tzinfo=DISPLAY_TIMEZONE)
    return start_local.astimezone(timezone.utc), end_local.astimezone(timezone.utc)


def ensure_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def format_local_time(value: datetime) -> str:
    return ensure_utc(value).astimezone(DISPLAY_TIMEZONE).strftime("%H:%M:%S")


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

    def _activity_payload(self, screenshot: Screenshot, diff: ScreenDiff | None) -> dict[str, object]:
        if screenshot.activity_type:
            return {
                "type": screenshot.activity_type,
                "active_app": screenshot.active_app,
                "confidence": screenshot.activity_confidence,
                "summary": screenshot.activity_summary,
                "evidence": screenshot.activity_evidence_json or {},
            }

        activity = classify_screenshot_activity(
            screenshot=screenshot,
            change_level=diff.change_level if diff is not None else None,
            is_effective_change=diff.is_effective_change if diff is not None else None,
        )
        return {
            "type": activity.activity_type,
            "active_app": activity.active_app,
            "confidence": activity.confidence,
            "summary": activity.summary,
            "evidence": activity.evidence,
        }

    def _ai_analysis_payload(self, screenshot: Screenshot) -> dict[str, object]:
        details = getattr(screenshot, "ai_details_json", None)
        if not isinstance(details, Mapping):
            details = getattr(screenshot, "ai_evidence_json", None)
        if isinstance(details, Mapping):
            normalized_details = dict(details)
        else:
            normalized_details = {}
        return {
            "analysis_status": getattr(screenshot, "ai_analysis_status", "skipped"),
            "summary": getattr(screenshot, "ai_summary", None),
            "confidence": getattr(screenshot, "ai_confidence", None),
            "provider": getattr(screenshot, "ai_provider", None),
            "model": getattr(screenshot, "ai_model", None),
            "details": normalized_details,
            "error": getattr(screenshot, "ai_error", None),
            "analyzed_at": getattr(screenshot, "ai_analyzed_at", None),
        }

    def _build_screenshot_item(
        self,
        *,
        screenshot: Screenshot,
        diff: ScreenDiff | None,
        events: list[BehaviorEvent],
    ) -> ScreenshotItem:
        activity = self._activity_payload(screenshot, diff)
        ai_analysis = self._ai_analysis_payload(screenshot)
        employee = self.session.get(Employee, screenshot.employee_id)
        return ScreenshotItem(
            id=screenshot.id,
            employee_id=screenshot.employee_id,
            employee_name=employee.name if employee is not None else None,
            employee_no=employee.employee_no if employee is not None else None,
            department=employee.department if employee is not None else None,
            device_id=screenshot.device_id,
            captured_at=screenshot.captured_at,
            capture_batch_key=screenshot.capture_batch_key,
            screen_index=screenshot.screen_index,
            image_uri=self._secured_screenshot_uri(screenshot.id, "image", screenshot.image_uri),
            thumb_uri=self._secured_screenshot_uri(screenshot.id, "thumbnail", screenshot.thumb_uri),
            width=screenshot.width,
            height=screenshot.height,
            foreground_process=None,
            window_title=None,
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
            activity_type=str(activity["type"]),
            active_app=activity["active_app"] if isinstance(activity["active_app"], str) else None,
            activity_confidence=(
                float(activity["confidence"])
                if isinstance(activity["confidence"], (int, float))
                else None
            ),
            activity_summary=activity["summary"] if isinstance(activity["summary"], str) else None,
            activity_evidence=(
                activity["evidence"] if isinstance(activity["evidence"], dict) else {}
            ),
            ai_analysis_status=(
                ai_analysis["analysis_status"]
                if isinstance(ai_analysis["analysis_status"], str)
                else "skipped"
            ),
            ai_summary=ai_analysis["summary"] if isinstance(ai_analysis["summary"], str) else None,
            ai_task_label=screenshot.ai_task_label,
            ai_risk_level=screenshot.ai_risk_level,
            ai_non_work_likelihood=screenshot.ai_non_work_likelihood,
            ai_confidence=(
                float(ai_analysis["confidence"])
                if isinstance(ai_analysis["confidence"], (int, float))
                else None
            ),
            ai_provider=ai_analysis["provider"] if isinstance(ai_analysis["provider"], str) else None,
            ai_model=ai_analysis["model"] if isinstance(ai_analysis["model"], str) else None,
            ai_recommended_action=screenshot.ai_recommended_action,
            ai_response_id=screenshot.ai_response_id,
            ai_details=ai_analysis["details"] if isinstance(ai_analysis["details"], dict) else {},
            ai_error=ai_analysis["error"] if isinstance(ai_analysis["error"], str) else None,
            ai_analyzed_at=(
                ai_analysis["analyzed_at"] if isinstance(ai_analysis["analyzed_at"], datetime) else None
            ),
            file_retention_status=screenshot.file_retention_status,
            retention_decision=screenshot.retention_decision,
            retention_reason=screenshot.retention_reason,
            is_abnormal=screenshot.is_abnormal,
            retain_until=screenshot.retain_until,
            image_deleted_at=screenshot.image_deleted_at,
            thumb_deleted_at=screenshot.thumb_deleted_at,
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
        reviewer_map: dict[UUID, User] | None = None,
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

        reviewer = None
        if event.reviewed_by is not None:
            reviewer = reviewer_map.get(event.reviewed_by) if reviewer_map is not None else self.session.get(User, event.reviewed_by)

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
            reviewer_name=reviewer.display_name if reviewer is not None else None,
            reviewer_username=reviewer.username if reviewer is not None else None,
            reviewed_at=event.reviewed_at,
            review_note=event.review_note,
            created_at=event.created_at,
            updated_at=event.updated_at,
        )

    def _department_employee_ids(self, department: str | None) -> list[UUID] | None:
        normalized = (department or "").strip()
        if not normalized:
            return None
        return list(
            self.session.exec(select(Employee.id).where(Employee.department == normalized)).all()
        )

    def _build_screenshot_statement(
        self,
        *,
        device_id: UUID | None = None,
        employee_id: UUID | None = None,
        department: str | None = None,
        date_value: date | None = None,
        date_from: date | None = None,
        date_to: date | None = None,
        risk_level: str | None = None,
        abnormal_only: bool = False,
        scope: EmployeeAccessScope | None = None,
    ):
        statement = select(Screenshot)
        applied_filters: dict[str, object] = {}

        if device_id is not None:
            statement = statement.where(Screenshot.device_id == device_id)
            applied_filters["device_id"] = str(device_id)
        if employee_id is not None:
            statement = statement.where(Screenshot.employee_id == employee_id)
            applied_filters["employee_id"] = str(employee_id)
        if scope is not None and not scope.all_employees:
            if not scope.employee_ids:
                return None, applied_filters
            statement = statement.where(Screenshot.employee_id.in_(list(scope.employee_ids)))
        if department:
            department_employee_ids = self._department_employee_ids(department)
            applied_filters["department"] = department
            if not department_employee_ids:
                return None, applied_filters
            statement = statement.where(Screenshot.employee_id.in_(department_employee_ids))
        if date_value is not None:
            start_at, end_at = day_bounds(date_value)
            statement = statement.where(Screenshot.captured_at >= start_at).where(Screenshot.captured_at <= end_at)
            applied_filters["date"] = str(date_value)
        else:
            if date_from is not None:
                start_at, _ = day_bounds(date_from)
                statement = statement.where(Screenshot.captured_at >= start_at)
                applied_filters["date_from"] = str(date_from)
            if date_to is not None:
                _, end_at = day_bounds(date_to)
                statement = statement.where(Screenshot.captured_at <= end_at)
                applied_filters["date_to"] = str(date_to)
        if abnormal_only:
            statement = statement.where(Screenshot.is_abnormal.is_(True))
            applied_filters["abnormal_only"] = True
        normalized_risk = (risk_level or "").strip().casefold()
        if normalized_risk:
            applied_filters["risk_level"] = normalized_risk
            if normalized_risk == "high":
                statement = statement.where(
                    or_(Screenshot.ai_risk_level == "high", Screenshot.retention_decision == "high_risk")
                )
            elif normalized_risk == "medium":
                statement = statement.where(
                    or_(Screenshot.ai_risk_level == "medium", Screenshot.retention_decision == "needs_review")
                )
            elif normalized_risk == "low":
                statement = statement.where(Screenshot.ai_risk_level == "low")
            elif normalized_risk == "normal":
                statement = statement.where(Screenshot.retention_decision == "normal")
            elif normalized_risk == "review":
                statement = statement.where(Screenshot.retention_decision.in_(["ai_failed", "skipped"]))
            else:
                statement = statement.where(Screenshot.retention_decision == normalized_risk)

        return statement, applied_filters

    def list_timeline(
        self,
        *,
        employee_id: UUID | None,
        department: str | None,
        date_value: date | None,
        date_from: date | None,
        date_to: date | None,
        risk_level: str | None,
        abnormal_only: bool,
        descending: bool,
        page: int,
        page_size: int,
        scope: EmployeeAccessScope | None = None,
    ) -> TimelineResponse:
        statement, applied_filters = self._build_screenshot_statement(
            employee_id=employee_id,
            department=department,
            date_value=date_value,
            date_from=date_from,
            date_to=date_to,
            risk_level=risk_level,
            abnormal_only=abnormal_only,
            scope=scope,
        )
        if statement is None:
            return TimelineResponse(
                employee_id=employee_id,
                department=department,
                date=date_value,
                total=0,
                page=page,
                page_size=page_size,
                applied_filters=applied_filters,
                items=[],
            )

        if descending:
            ordered = statement.order_by(Screenshot.captured_at.desc(), Screenshot.created_at.desc())
        else:
            ordered = statement.order_by(Screenshot.captured_at.asc(), Screenshot.created_at.asc())
        total = int(self.session.exec(select(func.count()).select_from(ordered.subquery())).one())
        offset = max(page - 1, 0) * page_size
        screenshots = self.session.exec(ordered.offset(offset).limit(page_size)).all()
        diff_map = self._screen_diff_map([screenshot.id for screenshot in screenshots])
        events = self._relevant_events(screenshots)

        items: list[TimelineItem] = []
        for screenshot in screenshots:
            risk_events = self._risk_events_for_screenshot(screenshot=screenshot, events=events)
            diff = diff_map.get(screenshot.id)
            activity = self._activity_payload(screenshot, diff)
            ai_analysis = self._ai_analysis_payload(screenshot)
            employee = self.session.get(Employee, screenshot.employee_id)
            items.append(
                TimelineItem(
                    time=format_local_time(screenshot.captured_at),
                    screenshot_id=screenshot.id,
                    employee_id=screenshot.employee_id,
                    employee_name=employee.name if employee is not None else None,
                    employee_no=employee.employee_no if employee is not None else None,
                    department=employee.department if employee is not None else None,
                    captured_at=screenshot.captured_at,
                    capture_batch_key=screenshot.capture_batch_key,
                    screen_index=screenshot.screen_index,
                    thumbnail_url=self._secured_screenshot_uri(screenshot.id, "thumbnail", screenshot.thumb_uri),
                    thumb_uri=self._secured_screenshot_uri(screenshot.id, "thumbnail", screenshot.thumb_uri),
                    image_uri=self._secured_screenshot_uri(screenshot.id, "image", screenshot.image_uri),
                    file_retention_status=screenshot.file_retention_status,
                    retention_decision=screenshot.retention_decision,
                    retention_reason=screenshot.retention_reason,
                    is_abnormal=screenshot.is_abnormal,
                    retain_until=screenshot.retain_until,
                    image_deleted_at=screenshot.image_deleted_at,
                    thumb_deleted_at=screenshot.thumb_deleted_at,
                    activity_type=str(activity["type"]),
                    active_app=activity["active_app"] if isinstance(activity["active_app"], str) else None,
                    activity_confidence=(
                        float(activity["confidence"])
                        if isinstance(activity["confidence"], (int, float))
                        else None
                    ),
                    activity_summary=activity["summary"] if isinstance(activity["summary"], str) else None,
                    activity_evidence=activity["evidence"] if isinstance(activity["evidence"], dict) else {},
                    ai_analysis_status=(
                        ai_analysis["analysis_status"]
                        if isinstance(ai_analysis["analysis_status"], str)
                        else "skipped"
                    ),
                    ai_summary=ai_analysis["summary"] if isinstance(ai_analysis["summary"], str) else None,
                    ai_task_label=screenshot.ai_task_label,
                    ai_risk_level=screenshot.ai_risk_level,
                    ai_non_work_likelihood=screenshot.ai_non_work_likelihood,
                    ai_confidence=(
                        float(ai_analysis["confidence"])
                        if isinstance(ai_analysis["confidence"], (int, float))
                        else None
                    ),
                    ai_provider=ai_analysis["provider"] if isinstance(ai_analysis["provider"], str) else None,
                    ai_model=ai_analysis["model"] if isinstance(ai_analysis["model"], str) else None,
                    ai_recommended_action=screenshot.ai_recommended_action,
                    ai_response_id=screenshot.ai_response_id,
                    ai_details=ai_analysis["details"] if isinstance(ai_analysis["details"], dict) else {},
                    ai_error=ai_analysis["error"] if isinstance(ai_analysis["error"], str) else None,
                    ai_analyzed_at=(
                        ai_analysis["analyzed_at"] if isinstance(ai_analysis["analyzed_at"], datetime) else None
                    ),
                    activity=TimelineActivity(
                        type=str(activity["type"]),
                        active_app=activity["active_app"] if isinstance(activity["active_app"], str) else None,
                        confidence=(
                            float(activity["confidence"])
                            if isinstance(activity["confidence"], (int, float))
                            else None
                        ),
                        summary=activity["summary"] if isinstance(activity["summary"], str) else None,
                        evidence=activity["evidence"] if isinstance(activity["evidence"], dict) else {},
                        keyboard_count=screenshot.keyboard_count,
                        mouse_count=screenshot.mouse_click_count,
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
                    mouse_count=screenshot.mouse_click_count,
                    risk_events=risk_events,
                )
            )

        return TimelineResponse(
            employee_id=employee_id,
            department=department,
            date=date_value,
            total=total,
            page=page,
            page_size=page_size,
            applied_filters=applied_filters,
            items=items,
        )

    def get_employee_timeline(self, employee_id: UUID, date_value: date) -> TimelineResponse:
        return self.list_timeline(
            employee_id=employee_id,
            department=None,
            date_value=date_value,
            date_from=None,
            date_to=None,
            risk_level=None,
            abnormal_only=False,
            descending=True,
            page=1,
            page_size=200,
            scope=None,
        )

    def _secured_screenshot_uri(self, screenshot_id: UUID, kind: str, stored_uri: str | None) -> str | None:
        if not stored_uri:
            return None
        return f"/api/screenshots/{screenshot_id}/{kind}"

    def list_events(
        self,
        employee_id: UUID | None,
        severity: str | None,
        status: str | None,
        event_type: str | None,
        start_from: datetime | None,
        end_to: datetime | None,
        scope: EmployeeAccessScope | None = None,
    ) -> BehaviorEventListResponse:
        if scope is not None and not scope.all_employees:
            if not scope.employee_ids:
                return BehaviorEventListResponse(items=[], total=0)
            if employee_id is not None and employee_id not in scope.employee_ids:
                return BehaviorEventListResponse(items=[], total=0)

        statement = select(BehaviorEvent).order_by(BehaviorEvent.start_at.desc())
        if employee_id is not None:
            statement = statement.where(BehaviorEvent.employee_id == employee_id)
        if scope is not None and not scope.all_employees:
            statement = statement.where(BehaviorEvent.employee_id.in_(list(scope.employee_ids)))
        if severity is not None:
            statement = statement.where(BehaviorEvent.severity == severity)
        if status is not None:
            normalized_status = status.strip().casefold()
            if normalized_status == "reviewable":
                statement = statement.where(BehaviorEvent.status.in_(REVIEWABLE_EVENT_STATUSES))
            else:
                statement = statement.where(BehaviorEvent.status == normalized_status)
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
        reviewer_ids = {event.reviewed_by for event in events if event.reviewed_by is not None}
        reviewer_map = (
            {
                user.id: user
                for user in self.session.exec(select(User).where(User.id.in_(reviewer_ids))).all()
            }
            if reviewer_ids
            else {}
        )
        return BehaviorEventListResponse(
            items=[
                self._build_event_detail(event=event, diff_map=diff_map, reviewer_map=reviewer_map)
                for event in events
            ],
            total=len(events),
        )

    def get_event(self, event_id: UUID, scope: EmployeeAccessScope | None = None) -> BehaviorEventDetail | None:
        event = self.session.get(BehaviorEvent, event_id)
        if event is None:
            return None
        if scope is not None and not scope.all_employees and event.employee_id not in scope.employee_ids:
            return None
        return self._build_event_detail(event=event)

    def review_event(
        self,
        event_id: UUID,
        payload: BehaviorEventReviewRequest,
        *,
        audit_context: AuditContext | None = None,
        scope: EmployeeAccessScope | None = None,
    ) -> BehaviorEventDetail | None:
        event = self.session.get(BehaviorEvent, event_id)
        if event is None:
            return None
        if scope is not None and not scope.all_employees and event.employee_id not in scope.employee_ids:
            return None

        if payload.status is not None:
            event.status = payload.status
        event.review_note = payload.review_note
        event.reviewed_at = datetime.now(timezone.utc)
        if audit_context is not None and audit_context.actor_id is not None:
            event.reviewed_by = audit_context.actor_id
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
        department: str | None = None,
        risk_level: str | None = None,
        abnormal_only: bool = False,
        date_value: date | None = None,
        date_from: date | None = None,
        date_to: date | None = None,
        descending: bool = True,
        page: int = 1,
        page_size: int | None = None,
        scope: EmployeeAccessScope | None = None,
    ) -> ScreenshotListResponse:
        resolved_page_size = page_size or limit
        statement, applied_filters = self._build_screenshot_statement(
            device_id=device_id,
            employee_id=employee_id,
            department=department,
            date_value=date_value,
            date_from=date_from,
            date_to=date_to,
            risk_level=risk_level,
            abnormal_only=abnormal_only,
            scope=scope,
        )
        if statement is None:
            return ScreenshotListResponse(
                items=[],
                total=0,
                page=page,
                page_size=resolved_page_size,
                applied_filters=applied_filters,
            )

        if descending:
            ordered = statement.order_by(Screenshot.captured_at.desc(), Screenshot.created_at.desc())
        else:
            ordered = statement.order_by(Screenshot.captured_at.asc(), Screenshot.created_at.asc())
        total = int(self.session.exec(select(func.count()).select_from(ordered.subquery())).one())
        offset = max(page - 1, 0) * resolved_page_size
        screenshots = self.session.exec(ordered.offset(offset).limit(resolved_page_size)).all()
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
            total=total,
            page=page,
            page_size=resolved_page_size,
            applied_filters=applied_filters,
        )

    def get_screenshot(self, screenshot_id: UUID, scope: EmployeeAccessScope | None = None) -> ScreenshotItem | None:
        screenshot = self.session.get(Screenshot, screenshot_id)
        if screenshot is None:
            return None
        if scope is not None and not scope.all_employees and screenshot.employee_id not in scope.employee_ids:
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
        event_type: str | None,
        employee_no: str | None,
        machine_name: str | None,
        limit: int,
        scope: EmployeeAccessScope | None = None,
    ) -> AttendanceListResponse:
        if scope is not None and not scope.all_employees and not scope.employee_ids:
            return AttendanceListResponse(items=[], total=0, generated_at=datetime.now(timezone.utc))

        statement = select(AttendanceRecord).order_by(AttendanceRecord.occurred_at.desc())
        if work_date is not None:
            statement = statement.where(AttendanceRecord.work_date == work_date)
        if anomaly_status is not None:
            statement = statement.where(AttendanceRecord.anomaly_status == anomaly_status)
        if review_status is not None:
            statement = statement.where(AttendanceRecord.review_status == review_status)
        if event_type is not None:
            statement = statement.where(AttendanceRecord.event_type == event_type)
        if employee_no is not None:
            statement = statement.where(AttendanceRecord.employee_no == employee_no)
        if machine_name is not None:
            statement = statement.where(AttendanceRecord.machine_name == machine_name)
        if scope is not None and not scope.all_employees:
            employee_ids = list(scope.employee_ids)
            scoped_employee_nos = self._unambiguous_employee_nos_for_scope(scope)
            statement = statement.where(
                or_(
                    AttendanceRecord.employee_id.in_(employee_ids),
                    and_(
                        AttendanceRecord.employee_id.is_(None),
                        AttendanceRecord.employee_no.in_(scoped_employee_nos),
                    ),
                )
            )

        records = self.session.exec(statement.limit(limit)).all()
        employee_ids = [record.employee_id for record in records if record.employee_id is not None]
        employee_nos = sorted({record.employee_no for record in records if record.employee_no})
        employees_by_id = {
            employee.id: employee
            for employee in self.session.exec(select(Employee).where(Employee.id.in_(employee_ids))).all()
        } if employee_ids else {}
        employees_by_no = {
            employee.employee_no: employee
            for employee in self.session.exec(select(Employee).where(Employee.employee_no.in_(employee_nos))).all()
        } if employee_nos else {}
        return AttendanceListResponse(
            items=[
                self._build_attendance_item(
                    record=record,
                    employee=(
                        employees_by_id.get(record.employee_id)
                        if record.employee_id is not None
                        else employees_by_no.get(record.employee_no or "")
                    ) or employees_by_no.get(record.employee_no or ""),
                )
                for record in records
            ],
            total=len(records),
            generated_at=datetime.now(timezone.utc),
        )

    def _unambiguous_employee_nos_for_scope(self, scope: EmployeeAccessScope) -> list[str]:
        if scope.all_employees or not scope.employee_ids:
            return []

        scoped_employees = self.session.exec(
            select(Employee).where(Employee.id.in_(list(scope.employee_ids)))
        ).all()
        candidate_employee_nos = sorted({employee.employee_no for employee in scoped_employees})
        if not candidate_employee_nos:
            return []

        employees_by_no: dict[str, list[Employee]] = defaultdict(list)
        for employee in self.session.exec(select(Employee).where(Employee.employee_no.in_(candidate_employee_nos))).all():
            employees_by_no[employee.employee_no].append(employee)

        return [
            employee_no
            for employee_no, employees in employees_by_no.items()
            if len(employees) == 1 and employees[0].id in scope.employee_ids
        ]

    def list_employees(self, scope: EmployeeAccessScope | None = None) -> EmployeeListResponse:
        statement = (
            select(Employee)
            .where(Employee.status != "deleted")
            .order_by(Employee.employee_no.asc(), Employee.name.asc())
        )
        if scope is not None and not scope.all_employees:
            if not scope.employee_ids:
                return EmployeeListResponse(items=[], total=0)
            statement = statement.where(Employee.id.in_(list(scope.employee_ids)))

        employees = self.session.exec(statement).all()
        employee_ids = {employee.id for employee in employees}
        device_statement = select(Device)
        if scope is not None and not scope.all_employees:
            if not employee_ids:
                devices = []
            else:
                device_statement = device_statement.where(Device.employee_id.in_(employee_ids))
                devices = self.session.exec(device_statement).all()
        else:
            devices = self.session.exec(device_statement).all()
        policy_service = PolicyService(self.session)
        active_policy = policy_service.ensure_default_policy()
        policy_summary = policy_service.serialize_policy_summary(active_policy) if active_policy is not None else None

        active_device_counts: dict[UUID, int] = {}
        for device in devices:
            if device.employee_id is None or device.status == "offline":
                continue
            active_device_counts[device.employee_id] = active_device_counts.get(device.employee_id, 0) + 1

        return EmployeeListResponse(
            items=[
                self._build_employee_item(employee, active_device_counts.get(employee.id, 0), policy_summary)
                for employee in employees
            ],
            total=len(employees),
        )

    def get_employee_item(self, employee_id: UUID) -> EmployeeItem | None:
        employee = self.session.get(Employee, employee_id)
        if employee is None or employee.status == "deleted":
            return None

        active_device_count = len(
            self.session.exec(
                select(Device)
                .where(Device.employee_id == employee.id)
                .where(Device.status != "offline")
            ).all()
        )
        policy_service = PolicyService(self.session)
        active_policy = policy_service.ensure_default_policy()
        policy_summary = policy_service.serialize_policy_summary(active_policy) if active_policy is not None else None
        return self._build_employee_item(employee, active_device_count, policy_summary)

    def _build_employee_item(
        self,
        employee: Employee,
        active_device_count: int,
        policy_summary: PolicySummary | None,
    ) -> EmployeeItem:
        return EmployeeItem(
            id=employee.id,
            name=employee.name,
            employee_no=employee.employee_no,
            department=employee.department,
            manager_name=employee.manager_name,
            job_role=employee.job_role,
            github_username=employee.github_username,
            status=employee.status,
            active_device_count=active_device_count,
            policy_summary=policy_summary,
            created_at=employee.created_at,
            updated_at=employee.updated_at,
        )

    def list_devices(self, scope: EmployeeAccessScope | None = None) -> DeviceListResponse:
        statement = select(Device).order_by(Device.last_heartbeat_at.desc(), Device.hostname.asc())
        if scope is not None and not scope.all_employees:
            if not scope.employee_ids:
                return DeviceListResponse(items=[], total=0)
            statement = statement.where(Device.employee_id.in_(list(scope.employee_ids)))

        devices = self.session.exec(statement).all()
        employee_ids = {device.employee_id for device in devices if device.employee_id is not None}
        employees = self.session.exec(select(Employee).where(Employee.id.in_(employee_ids))).all() if employee_ids else []
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
                    has_agent_token=device.agent_token_hash is not None,
                    agent_token_revoked_at=device.agent_token_revoked_at,
                    agent_token_expires_at=device.agent_token_expires_at,
                    agent_token_last_used_at=device.agent_token_last_used_at,
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

    def _build_risk_snapshot(
        self,
        scope: EmployeeAccessScope | None = None,
    ) -> tuple[
        datetime,
        list[EmployeeRiskScoreItem],
        dict[str, int],
        list[Employee],
        list[Device],
        list[BehaviorEvent],
        list[Screenshot],
    ]:
        generated_at = datetime.now(timezone.utc)
        employee_statement = select(Employee).order_by(Employee.employee_no.asc(), Employee.name.asc())
        device_statement = select(Device).order_by(Device.hostname.asc())
        event_statement = select(BehaviorEvent).order_by(BehaviorEvent.start_at.desc())
        screenshot_statement = select(Screenshot).order_by(Screenshot.captured_at.desc())
        if scope is not None and not scope.all_employees:
            if not scope.employee_ids:
                empty_coverage = {
                    "active_policy_count": 0,
                    "targeted_active_policy_count": 0,
                    "employees_with_targeted_policy": 0,
                    "employees_default_only": 0,
                }
                return generated_at, [], empty_coverage, [], [], [], []
            employee_ids = list(scope.employee_ids)
            employee_statement = employee_statement.where(Employee.id.in_(employee_ids))
            device_statement = device_statement.where(Device.employee_id.in_(employee_ids))
            event_statement = event_statement.where(BehaviorEvent.employee_id.in_(employee_ids))
            screenshot_statement = screenshot_statement.where(Screenshot.employee_id.in_(employee_ids))

        employees = self.session.exec(employee_statement).all()
        devices = self.session.exec(device_statement).all()
        events = self.session.exec(event_statement).all()
        screenshots = self.session.exec(screenshot_statement).all()

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
        return generated_at, risk_scores, coverage, employees, devices, events, screenshots

    def get_dashboard_summary(self, scope: EmployeeAccessScope | None = None) -> DashboardSummaryResponse:
        generated_at, risk_scores, coverage, employees, devices, events, screenshots = self._build_risk_snapshot(
            scope=scope
        )
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

    def list_review_queue(self, limit: int = 100, scope: EmployeeAccessScope | None = None) -> ReviewQueueResponse:
        generated_at = datetime.now(timezone.utc)
        if scope is not None and not scope.all_employees and not scope.employee_ids:
            return ReviewQueueResponse(items=[], total=0, generated_at=generated_at)

        event_statement = (
            select(BehaviorEvent)
            .where(BehaviorEvent.status.in_(REVIEWABLE_EVENT_STATUSES))
            .order_by(BehaviorEvent.start_at.desc())
        )
        device_statement = select(Device)
        if scope is not None and not scope.all_employees:
            employee_ids = list(scope.employee_ids)
            event_statement = event_statement.where(BehaviorEvent.employee_id.in_(employee_ids))
            device_statement = device_statement.where(Device.employee_id.in_(employee_ids))

        events = self.session.exec(event_statement).all()
        devices = self.session.exec(device_statement).all()
        employee_ids = {event.employee_id for event in events} | {
            device.employee_id for device in devices if device.employee_id is not None
        }
        employees = (
            {
                employee.id: employee
                for employee in self.session.exec(select(Employee).where(Employee.id.in_(employee_ids))).all()
            }
            if employee_ids
            else {}
        )
        device_map = {device.id: device for device in devices}
        items = [
            self._review_item_from_event(
                event=event,
                employee=employees.get(event.employee_id),
                device=device_map.get(event.device_id),
                generated_at=generated_at,
            )
            for event in events
        ]
        items.extend(
            self._review_item_from_device(device=device, employee=employees.get(device.employee_id), generated_at=generated_at)
            for device in devices
            if self._device_needs_review(device, generated_at)
        )
        items.sort(key=_review_queue_sort_key)
        limited_items = items[:limit]
        return ReviewQueueResponse(items=limited_items, total=len(items), generated_at=generated_at)

    def _review_item_from_event(
        self,
        *,
        event: BehaviorEvent,
        employee: Employee | None,
        device: Device | None,
        generated_at: datetime,
    ) -> ReviewQueueItem:
        title = _event_review_title(event)
        return ReviewQueueItem(
            id=f"event:{event.id}",
            item_type="behavior_event",
            severity=event.severity,
            status=event.status,
            title=title,
            reason=event.reason or title,
            occurred_at=event.start_at,
            age_seconds=_age_seconds(event.start_at, generated_at),
            is_actionable=True,
            employee_id=event.employee_id,
            employee_name=employee.name if employee is not None else None,
            employee_no=employee.employee_no if employee is not None else None,
            device_id=event.device_id,
            device_hostname=device.hostname if device is not None else None,
            event_type=event.event_type,
            related_event_id=event.id,
            related_screenshot_id=event.related_screenshot_id,
            details_json=_safe_review_details(event.details_json or {}),
        )

    def _review_item_from_device(
        self,
        *,
        device: Device,
        employee: Employee | None,
        generated_at: datetime,
    ) -> ReviewQueueItem:
        last_seen = device.last_heartbeat_at or device.updated_at
        age_seconds = _age_seconds(last_seen, generated_at)
        severity = "high" if device.status == "offline" or age_seconds >= AGED_DEVICE_AFTER_SECONDS else "medium"
        title = "Agent offline" if device.status == "offline" else "Agent heartbeat stale"
        return ReviewQueueItem(
            id=f"device:{device.id}",
            item_type="device_health",
            severity=severity,
            status=device.status,
            title=title,
            reason=f"{device.hostname} last heartbeat is {age_seconds // 60} minute(s) old.",
            occurred_at=last_seen,
            age_seconds=age_seconds,
            is_actionable=False,
            employee_id=device.employee_id,
            employee_name=employee.name if employee is not None else None,
            employee_no=employee.employee_no if employee is not None else None,
            device_id=device.id,
            device_hostname=device.hostname,
            details_json={
                "agent_version": device.agent_version,
                "os_type": device.os_type,
                "last_heartbeat_at": device.last_heartbeat_at.isoformat() if device.last_heartbeat_at else None,
            },
        )

    def _device_needs_review(self, device: Device, generated_at: datetime) -> bool:
        if device.status == "offline":
            return True
        if device.last_heartbeat_at is None:
            return False
        return _age_seconds(device.last_heartbeat_at, generated_at) >= STALE_DEVICE_AFTER_SECONDS

    def list_risk_scores(
        self,
        limit: int | None = None,
        scope: EmployeeAccessScope | None = None,
    ) -> EmployeeRiskScoreListResponse:
        generated_at, risk_scores, _, _, _, _, _ = self._build_risk_snapshot(scope=scope)
        items = risk_scores if limit is None else risk_scores[:limit]
        return EmployeeRiskScoreListResponse(
            items=items,
            total=len(risk_scores),
            generated_at=generated_at,
        )

    def list_github_risks(
        self,
        limit: int = 200,
        scope: EmployeeAccessScope | None = None,
    ) -> GitHubRiskEventListResponse:
        if scope is not None and not scope.all_employees and not scope.employee_ids:
            return GitHubRiskEventListResponse(
                items=[],
                total=0,
                generated_at=datetime.now(timezone.utc),
                trend=[],
            )
        statement = (
            select(BehaviorEvent)
            .where(BehaviorEvent.event_type.like("github_%"))
            .order_by(BehaviorEvent.start_at.desc())
        )
        if scope is not None and not scope.all_employees:
            statement = statement.where(BehaviorEvent.employee_id.in_(list(scope.employee_ids)))
        events = self.session.exec(statement.limit(limit)).all()
        employees = (
            {
                employee.id: employee
                for employee in self.session.exec(
                    select(Employee).where(Employee.id.in_({event.employee_id for event in events}))
                ).all()
            }
            if events
            else {}
        )
        items = [
            self._build_github_risk_item(event=event, employee=employees.get(event.employee_id))
            for event in events
        ]
        trend_counts: dict[str, int] = defaultdict(int)
        for event in events:
            bucket = ensure_utc(event.start_at).strftime("%H:00")
            trend_counts[bucket] += 1
        trend = [
            GitHubRiskTrendPoint(bucket=bucket, count=trend_counts[bucket])
            for bucket in sorted(trend_counts)
        ]
        return GitHubRiskEventListResponse(
            items=items,
            total=len(items),
            generated_at=datetime.now(timezone.utc),
            trend=trend,
        )

    def create_github_risk(
        self,
        payload: GitHubRiskEventCreateRequest,
        *,
        audit_context: AuditContext | None = None,
    ) -> GitHubRiskEventItem:
        employee = self.session.get(Employee, payload.employee_id)
        if employee is None:
            raise ValueError("Employee not found")
        device = self.session.get(Device, payload.device_id) if payload.device_id is not None else None
        if payload.device_id is not None and device is None:
            raise ValueError("Device not found")
        if device is None:
            device = self.session.exec(select(Device).where(Device.employee_id == employee.id)).first()
            if device is None:
                raise ValueError("Employee has no bound device")
        if device is not None and device.employee_id != employee.id:
            raise ValueError("Device is not bound to the employee")

        details = _safe_github_details(payload.details_json)
        details.update(
            {
                "repository": payload.repository,
                "action": payload.action,
                "risk_rule": payload.risk_rule,
            }
        )
        if payload.correlation:
            details["correlation"] = payload.correlation

        event = BehaviorEvent(
            employee_id=employee.id,
            device_id=device.id,
            event_type=_github_event_type_for_action(payload.action),
            severity=payload.severity,
            start_at=payload.occurred_at,
            status="open",
            reason=payload.risk_rule,
            details_json=details,
        )
        self.session.add(event)
        self.audit.log(
            action="github_risk.created",
            target_type="behavior_event",
            target_id=event.id,
            reason=f"{payload.risk_rule}: {payload.repository}",
            context=audit_context,
        )
        self.session.commit()
        self.session.refresh(event)
        return self._build_github_risk_item(event=event, employee=employee)

    def _build_github_risk_item(
        self,
        *,
        event: BehaviorEvent,
        employee: Employee | None,
    ) -> GitHubRiskEventItem:
        details = event.details_json or {}
        repository = _safe_detail_string(details, "repository") or "unknown"
        action = _safe_detail_string(details, "action") or event.event_type.replace("github_", "")
        risk_rule = _safe_detail_string(details, "risk_rule") or event.reason or event.event_type
        correlation = _safe_detail_string(details, "correlation") or event.reason
        return GitHubRiskEventItem(
            id=event.id,
            employee_id=event.employee_id,
            employee_name=employee.name if employee is not None else "Unknown employee",
            employee_no=employee.employee_no if employee is not None else None,
            github_username=(
                _safe_detail_string(details, "github_username")
                or (employee.github_username if employee is not None else None)
            ),
            device_id=event.device_id,
            related_screenshot_id=event.related_screenshot_id,
            repository=repository,
            action=action,
            risk_rule=risk_rule,
            severity=event.severity,
            occurred_at=event.start_at,
            correlation=correlation,
            status=event.status,
            details_json=details,
        )

    def get_access_matrix(self) -> AccessMatrixResponse:
        roles = self.session.exec(select(Role).order_by(Role.name.asc())).all()
        users = self.session.exec(select(User).order_by(User.username.asc())).all()
        employee_ids = {user.employee_id for user in users if user.employee_id is not None}
        employees = (
            self.session.exec(select(Employee).where(Employee.id.in_(employee_ids))).all()
            if employee_ids
            else []
        )
        employees_by_id = {employee.id: employee for employee in employees}

        users_by_role: dict[UUID, list[AccessRoleUserItem]] = defaultdict(list)
        unassigned_users: list[AccessRoleUserItem] = []
        for user in users:
            employee = employees_by_id.get(user.employee_id) if user.employee_id is not None else None
            user_item = AccessRoleUserItem(
                id=user.id,
                username=user.username,
                display_name=user.display_name,
                email=user.email,
                employee_id=user.employee_id,
                employee_name=employee.name if employee is not None else None,
                employee_no=employee.employee_no if employee is not None else None,
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
        policy_service = PolicyService(self.session)
        return PolicyListResponse(
            items=[policy_service.serialize_policy(policy) for policy in policies],
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


def _safe_detail_string(details: dict[str, object], key: str) -> str | None:
    value = details.get(key)
    if not isinstance(value, str):
        return None
    stripped = value.strip()
    return stripped or None


def _safe_github_details(details: dict[str, object]) -> dict[str, object]:
    safe: dict[str, object] = {}
    for key, value in details.items():
        normalized_key = str(key).strip()
        if not normalized_key:
            continue
        if any(marker in normalized_key.casefold() for marker in SENSITIVE_DETAIL_KEY_MARKERS):
            safe[normalized_key] = "[redacted]"
            continue
        if isinstance(value, str):
            stripped = value.strip()
            if stripped:
                safe[normalized_key] = stripped[:500]
        elif isinstance(value, bool | int | float) or value is None:
            safe[normalized_key] = value
    return safe


def _github_event_type_for_action(action: str) -> str:
    normalized = action.strip().casefold()
    if normalized == "clone":
        return "github_sensitive_repo_clone"
    if normalized in {"fetch", "pull"}:
        return "github_frequent_fetch"
    if normalized in {"review", "comment"}:
        return "github_offhours_review"
    raise ValueError("Unsupported GitHub action")


def _review_queue_sort_key(item: ReviewQueueItem) -> tuple[int, int, float]:
    return (
        SEVERITY_ORDER.get(item.severity, len(SEVERITY_ORDER)),
        0 if item.is_actionable else 1,
        -ensure_utc(item.occurred_at).timestamp(),
    )


def _age_seconds(value: datetime, generated_at: datetime) -> int:
    return max(0, int((generated_at - ensure_utc(value)).total_seconds()))


def _event_review_title(event: BehaviorEvent) -> str:
    details = event.details_json or {}
    risk_rule = _safe_detail_string(details, "risk_rule")
    if risk_rule:
        return risk_rule
    return event.event_type.replace("_", " ").title()


def _safe_review_details(details: dict[str, object]) -> dict[str, object]:
    safe: dict[str, object] = {}
    for key, value in details.items():
        normalized_key = str(key).strip()
        if not normalized_key:
            continue
        if any(marker in normalized_key.casefold() for marker in SENSITIVE_DETAIL_KEY_MARKERS):
            safe[normalized_key] = "[redacted]"
            continue
        if isinstance(value, str):
            stripped = value.strip()
            if stripped:
                safe[normalized_key] = stripped[:500]
        elif isinstance(value, bool | int | float) or value is None:
            safe[normalized_key] = value
    return safe
