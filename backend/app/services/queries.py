from __future__ import annotations

from datetime import date, datetime, time, timezone
from uuid import UUID

from sqlmodel import Session, select

from app.models import BehaviorEvent, ScreenDiff, Screenshot
from app.schemas.query import (
    BehaviorEventDetail,
    BehaviorEventListResponse,
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

    def get_employee_timeline(self, employee_id: UUID, date_value: date) -> TimelineResponse:
        start_at, end_at = day_bounds(date_value)
        screenshots = self.session.exec(
            select(Screenshot)
            .where(Screenshot.employee_id == employee_id)
            .where(Screenshot.captured_at >= start_at)
            .where(Screenshot.captured_at <= end_at)
            .order_by(Screenshot.captured_at.asc())
        ).all()
        screenshot_ids = [screenshot.id for screenshot in screenshots]

        diffs = self.session.exec(
            select(ScreenDiff).where(ScreenDiff.current_screenshot_id.in_(screenshot_ids))
        ).all() if screenshot_ids else []
        diff_map = {diff.current_screenshot_id: diff for diff in diffs}

        events = self.session.exec(
            select(BehaviorEvent)
            .where(BehaviorEvent.employee_id == employee_id)
            .where(BehaviorEvent.start_at <= end_at)
            .where((BehaviorEvent.end_at.is_(None)) | (BehaviorEvent.end_at >= start_at))
            .order_by(BehaviorEvent.start_at.asc())
        ).all()

        items: list[TimelineItem] = []
        for screenshot in screenshots:
            risk_events = [
                TimelineRiskEvent(
                    id=event.id,
                    event_type=event.event_type,
                    severity=event.severity,
                    status=event.status,
                )
                for event in events
                if event.related_screenshot_id == screenshot.id
                or (
                    event.start_at <= screenshot.captured_at
                    and (event.end_at is None or event.end_at >= screenshot.captured_at)
                )
            ]
            diff = diff_map.get(screenshot.id)
            items.append(
                TimelineItem(
                    time=ensure_utc(screenshot.captured_at).strftime("%H:%M:%S"),
                    screenshot_id=screenshot.id,
                    thumbnail_url=screenshot.thumb_uri,
                    activity_type="unknown",
                    change_level=diff.change_level if diff is not None else "unknown",
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
        return BehaviorEventListResponse(
            items=[BehaviorEventDetail.model_validate(event) for event in events],
            total=len(events),
        )

    def get_event(self, event_id: UUID) -> BehaviorEventDetail | None:
        event = self.session.get(BehaviorEvent, event_id)
        if event is None:
            return None
        return BehaviorEventDetail.model_validate(event)
