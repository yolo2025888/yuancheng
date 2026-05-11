from __future__ import annotations

from datetime import date, datetime, time, timezone
from uuid import UUID

from sqlmodel import Session, select

from app.models import BehaviorEvent, ScreenDiff, Screenshot
from app.schemas.query import (
    BehaviorEventDetail,
    BehaviorEventListResponse,
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
            is_locked=screenshot.is_locked,
            is_remote_session=screenshot.is_remote_session,
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
