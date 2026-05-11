from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import Column, DateTime, JSON, Text
from sqlmodel import Field, SQLModel


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class TimestampedUUIDModel(SQLModel):
    id: UUID = Field(default_factory=uuid4, primary_key=True)
    created_at: datetime = Field(
        default_factory=utc_now,
        sa_type=DateTime(timezone=True),
        sa_column_kwargs={"nullable": False},
    )
    updated_at: datetime = Field(
        default_factory=utc_now,
        sa_type=DateTime(timezone=True),
        sa_column_kwargs={"nullable": False},
    )


class Employee(TimestampedUUIDModel, table=True):
    __tablename__ = "employees"

    name: str
    employee_no: str = Field(index=True)
    department: str | None = None
    manager_id: UUID | None = Field(default=None, foreign_key="employees.id")
    manager_name: str | None = None
    job_role: str | None = None
    github_username: str | None = None
    status: str = Field(default="active", index=True)


class Device(TimestampedUUIDModel, table=True):
    __tablename__ = "devices"

    employee_id: UUID | None = Field(default=None, foreign_key="employees.id", index=True)
    hostname: str
    os_type: str | None = None
    agent_version: str
    screen_count: int = Field(default=1, ge=1)
    last_heartbeat_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    last_foreground_window_json: dict[str, Any] | None = Field(
        default=None,
        sa_column=Column(JSON, nullable=True),
    )
    last_session_state_json: dict[str, Any] | None = Field(
        default=None,
        sa_column=Column(JSON, nullable=True),
    )
    last_input_activity_json: dict[str, Any] | None = Field(
        default=None,
        sa_column=Column(JSON, nullable=True),
    )
    status: str = Field(default="offline", index=True)


class Screenshot(TimestampedUUIDModel, table=True):
    __tablename__ = "screenshots"

    employee_id: UUID = Field(foreign_key="employees.id", index=True)
    device_id: UUID = Field(foreign_key="devices.id", index=True)
    captured_at: datetime = Field(sa_column=Column(DateTime(timezone=True), nullable=False, index=True))
    screen_index: int = Field(default=0, ge=0)
    image_uri: str | None = None
    thumb_uri: str | None = None
    width: int = Field(ge=1)
    height: int = Field(ge=1)
    foreground_process: str | None = None
    window_title: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
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
    phash: str | None = None
    upload_status: str = Field(default="pending", index=True)
    ocr_status: str = Field(default="pending", index=True)
    analysis_status: str = Field(default="pending", index=True)


class ScreenDiff(SQLModel, table=True):
    __tablename__ = "screen_diffs"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    employee_id: UUID = Field(foreign_key="employees.id", index=True)
    device_id: UUID = Field(foreign_key="devices.id", index=True)
    current_screenshot_id: UUID = Field(foreign_key="screenshots.id", index=True)
    previous_screenshot_id: UUID | None = Field(default=None, foreign_key="screenshots.id")
    hash_distance: float | None = None
    ssim_score: float | None = None
    changed_block_ratio: float | None = None
    ignored_region_ratio: float | None = None
    change_level: str = Field(default="unknown", index=True)
    is_effective_change: bool = False
    reason: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


class BehaviorEvent(TimestampedUUIDModel, table=True):
    __tablename__ = "behavior_events"

    employee_id: UUID = Field(foreign_key="employees.id", index=True)
    device_id: UUID = Field(foreign_key="devices.id", index=True)
    event_type: str = Field(index=True)
    severity: str = Field(default="low", index=True)
    start_at: datetime = Field(sa_column=Column(DateTime(timezone=True), nullable=False, index=True))
    end_at: datetime | None = Field(default=None, sa_column=Column(DateTime(timezone=True), nullable=True))
    duration_seconds: int | None = Field(default=None, ge=0)
    related_screenshot_id: UUID | None = Field(default=None, foreign_key="screenshots.id", index=True)
    related_diff_id: UUID | None = Field(default=None, foreign_key="screen_diffs.id")
    streak_count: int = Field(default=0, ge=0)
    status: str = Field(default="open", index=True)
    reason: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    details_json: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON, nullable=False))
    reviewed_by: UUID | None = Field(default=None, foreign_key="users.id")
    reviewed_at: datetime | None = Field(default=None, sa_column=Column(DateTime(timezone=True), nullable=True))
    review_note: str | None = Field(default=None, sa_column=Column(Text, nullable=True))


class AuditLog(SQLModel, table=True):
    __tablename__ = "audit_logs"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    actor_id: UUID | None = Field(default=None, foreign_key="users.id", index=True)
    action: str = Field(index=True)
    target_type: str = Field(index=True)
    target_id: UUID | None = Field(default=None, index=True)
    reason: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    ip_address: str | None = None
    user_agent: str | None = None
    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


class Role(TimestampedUUIDModel, table=True):
    __tablename__ = "roles"

    name: str = Field(index=True)
    description: str | None = Field(default=None, sa_column=Column(Text, nullable=True))


class User(TimestampedUUIDModel, table=True):
    __tablename__ = "users"

    username: str = Field(index=True)
    display_name: str | None = None
    email: str | None = Field(default=None, index=True)
    password_hash: str
    role_id: UUID | None = Field(default=None, foreign_key="roles.id")
    status: str = Field(default="active", index=True)


class Policy(TimestampedUUIDModel, table=True):
    __tablename__ = "policies"

    name: str = Field(index=True)
    version: str = Field(index=True)
    screenshot_interval_seconds: int = Field(default=10, ge=1)
    no_change_threshold: int = Field(default=6, ge=1)
    retention_days: int = Field(default=30, ge=1)
    is_active: bool = Field(default=True, index=True)
    created_by: UUID | None = Field(default=None, foreign_key="users.id")
    rules_json: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON, nullable=False))
