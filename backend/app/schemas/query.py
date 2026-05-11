from __future__ import annotations

from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class ScreenDiffSummary(BaseModel):
    id: UUID
    current_screenshot_id: UUID
    previous_screenshot_id: UUID | None = None
    hash_distance: float | None = None
    ssim_score: float | None = None
    changed_block_ratio: float | None = None
    ignored_region_ratio: float | None = None
    change_level: str
    is_effective_change: bool
    reason: str | None = None

    model_config = ConfigDict(from_attributes=True)


class TimelineRiskEvent(BaseModel):
    id: UUID
    event_type: str
    severity: str
    status: str
    streak_count: int = 0
    related_diff_id: UUID | None = None
    reason: str | None = None


class TimelineChange(BaseModel):
    level: str
    effective: bool
    hash_distance: float | None = None
    ssim_score: float | None = None
    changed_block_ratio: float | None = None
    previous_screenshot_id: UUID | None = None
    reason: str | None = None


class TimelineActivity(BaseModel):
    type: str
    active_app: str | None = None
    confidence: float | None = None
    summary: str | None = None
    evidence: dict[str, object] = Field(default_factory=dict)
    keyboard_count: int
    mouse_count: int


class TimelineItem(BaseModel):
    time: str
    screenshot_id: UUID
    thumbnail_url: str | None = None
    thumb_uri: str | None = None
    image_uri: str | None = None
    activity_type: str
    active_app: str | None = None
    activity_confidence: float | None = None
    activity_summary: str | None = None
    activity_evidence: dict[str, object] = Field(default_factory=dict)
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
    mouse_wheel_count: int
    window_switch_count: int
    is_locked: bool
    is_remote_session: bool
    is_rdp_session: bool
    idle_seconds: int | None = None
    input_desktop_name: str | None = None
    session_connect_state: str | None = None
    phash: str | None = None
    upload_status: str
    ocr_status: str
    analysis_status: str
    activity_type: str
    active_app: str | None = None
    activity_confidence: float | None = None
    activity_summary: str | None = None
    activity_evidence: dict[str, object] = Field(default_factory=dict)
    diff: ScreenDiffSummary | None = None
    risk_events: list[TimelineRiskEvent] = Field(default_factory=list)
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
    screen_index: int | None = None
    start_at: datetime
    end_at: datetime | None = None
    duration_seconds: int | None = None
    related_screenshot_id: UUID | None = None
    related_diff_id: UUID | None = None
    streak_count: int
    status: str
    reason: str | None = None
    details_json: dict[str, object]
    related_diff: ScreenDiffSummary | None = None
    reviewed_by: UUID | None = None
    reviewer_name: str | None = None
    reviewer_username: str | None = None
    reviewed_at: datetime | None = None
    review_note: str | None = None
    created_at: datetime
    updated_at: datetime


class BehaviorEventListResponse(BaseModel):
    items: list[BehaviorEventDetail]
    total: int


class BehaviorEventReviewRequest(BaseModel):
    status: str | None = None
    review_note: str | None = None
