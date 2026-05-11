from __future__ import annotations

from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class TimelineRiskEvent(BaseModel):
    id: UUID
    event_type: str
    severity: str
    status: str


class TimelineChange(BaseModel):
    level: str
    effective: bool
    changed_block_ratio: float | None = None
    reason: str | None = None


class TimelineActivity(BaseModel):
    type: str
    keyboard_count: int
    mouse_count: int


class TimelineItem(BaseModel):
    time: str
    screenshot_id: UUID
    thumbnail_url: str | None = None
    thumb_uri: str | None = None
    image_uri: str | None = None
    activity_type: str
    activity: TimelineActivity
    change_level: str
    change: TimelineChange
    keyboard_count: int
    mouse_count: int
    risk_events: list[TimelineRiskEvent]


class TimelineResponse(BaseModel):
    employee_id: UUID
    date: date
    items: list[TimelineItem]


class ScreenshotItem(BaseModel):
    id: UUID
    employee_id: UUID
    device_id: UUID
    captured_at: datetime
    screen_index: int
    image_uri: str | None = None
    thumb_uri: str | None = None
    width: int
    height: int
    foreground_process: str | None = None
    window_title: str | None = None
    keyboard_count: int
    mouse_click_count: int
    mouse_move_count: int
    is_locked: bool
    is_remote_session: bool
    phash: str | None = None
    upload_status: str
    ocr_status: str
    analysis_status: str
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ScreenshotListResponse(BaseModel):
    items: list[ScreenshotItem]
    total: int


class BehaviorEventDetail(BaseModel):
    id: UUID
    employee_id: UUID
    device_id: UUID
    event_type: str
    severity: str
    start_at: datetime
    end_at: datetime | None = None
    duration_seconds: int | None = None
    related_screenshot_id: UUID | None = None
    related_diff_id: UUID | None = None
    streak_count: int
    status: str
    reason: str | None = None
    details_json: dict[str, object]
    reviewed_by: UUID | None = None
    reviewed_at: datetime | None = None
    review_note: str | None = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class BehaviorEventListResponse(BaseModel):
    items: list[BehaviorEventDetail]
    total: int
