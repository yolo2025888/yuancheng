from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class PolicyResponse(BaseModel):
    version: str
    screenshot_interval_seconds: int
    no_change_threshold: int
    retention_days: int

    model_config = ConfigDict(from_attributes=True)


class HeartbeatSessionState(BaseModel):
    collected_at: datetime | None = None
    session_id: int | None = None
    user_name: str | None = None
    is_locked: bool = False
    is_remote_session: bool = False
    is_rdp_session: bool = False
    is_active_session: bool | None = None
    is_console_session: bool | None = None
    active_console_session_id: int | None = None
    idle_seconds: int | None = Field(default=None, ge=0)
    input_desktop_name: str | None = None
    session_connect_state: str | None = None
    status_detail: str | None = None


class HeartbeatForegroundWindow(BaseModel):
    collected_at: datetime | None = None
    process_name: str | None = None
    executable_path: str | None = None
    window_title: str | None = None


class HeartbeatInputActivity(BaseModel):
    collected_from: datetime | None = None
    collected_to: datetime | None = None
    keyboard_event_count: int = Field(default=0, ge=0)
    mouse_event_count: int = Field(default=0, ge=0)
    mouse_move_count: int = Field(default=0, ge=0)
    mouse_click_count: int = Field(default=0, ge=0)
    mouse_wheel_count: int = Field(default=0, ge=0)
    window_switch_count: int = Field(default=0, ge=0)


class HeartbeatRequest(BaseModel):
    device_id: UUID
    employee_id: UUID | None = None
    hostname: str
    os_type: str | None = None
    agent_version: str
    screen_count: int = Field(ge=1)
    status: str
    session_state: HeartbeatSessionState | None = None
    foreground_window: HeartbeatForegroundWindow | None = None
    input_activity: HeartbeatInputActivity | None = None


class HeartbeatResponse(BaseModel):
    server_time: datetime
    policy: PolicyResponse


class ScreenshotMetadataRequest(BaseModel):
    device_id: UUID
    captured_at: datetime
    screen_index: int = Field(default=0, ge=0)
    width: int = Field(ge=1)
    height: int = Field(ge=1)
    foreground_process: str | None = None
    window_title: str | None = None
    keyboard_count: int = Field(default=0, ge=0)
    mouse_click_count: int = Field(default=0, ge=0)
    mouse_move_count: int = Field(default=0, ge=0)
    mouse_wheel_count: int = Field(default=0, ge=0)
    window_switch_count: int = Field(default=0, ge=0)
    is_locked: bool = False
    is_remote_session: bool = False
    is_rdp_session: bool = False
    idle_seconds: int | None = Field(default=None, ge=0)
    input_desktop_name: str | None = None
    session_connect_state: str | None = None


class ScreenshotMetadataResponse(BaseModel):
    screenshot_id: UUID
    upload_status: str


class ScreenshotUploadResponse(BaseModel):
    screenshot_id: UUID
    upload_status: str
    image_uri: str
    thumb_uri: str


class ScreenshotCompleteRequest(BaseModel):
    image_uri: str
    thumb_uri: str
    phash: str


class ScreenshotCompleteResponse(BaseModel):
    screenshot_id: UUID
    upload_status: str
