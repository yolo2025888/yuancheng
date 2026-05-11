from __future__ import annotations

from typing import Any
from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class PolicySummary(BaseModel):
    id: UUID
    name: str
    version: str
    screenshot_interval_seconds: int
    no_change_threshold: int
    retention_days: int
    is_active: bool
    rules_json: dict[str, Any] = Field(default_factory=dict)

    model_config = ConfigDict(from_attributes=True)


class SafeForegroundWindow(BaseModel):
    collected_at: datetime | None = None
    process_name: str | None = None


class SafeSessionState(BaseModel):
    collected_at: datetime | None = None
    is_locked: bool = False
    is_remote_session: bool = False
    is_rdp_session: bool = False
    is_active_session: bool | None = None
    is_console_session: bool | None = None
    active_console_session_id: int | None = None
    idle_seconds: int | None = None
    input_desktop_name: str | None = None
    session_connect_state: str | None = None


class SafeInputActivity(BaseModel):
    collected_from: datetime | None = None
    collected_to: datetime | None = None
    keyboard_event_count: int = 0
    mouse_event_count: int = 0
    mouse_move_count: int = 0
    mouse_click_count: int = 0
    mouse_wheel_count: int = 0
    window_switch_count: int = 0


class EmployeeItem(BaseModel):
    id: UUID
    name: str
    employee_no: str
    department: str | None = None
    manager_name: str | None = None
    job_role: str | None = None
    github_username: str | None = None
    status: str
    active_device_count: int
    policy_summary: PolicySummary | None = None
    created_at: datetime
    updated_at: datetime


class EmployeeListResponse(BaseModel):
    items: list[EmployeeItem]
    total: int


class DeviceItem(BaseModel):
    id: UUID
    employee_id: UUID | None = None
    employee_name: str | None = None
    employee_no: str | None = None
    hostname: str
    os_type: str | None = None
    agent_version: str
    screen_count: int
    status: str
    last_heartbeat_at: datetime | None = None
    last_foreground_window: SafeForegroundWindow | None = None
    last_session_state: SafeSessionState | None = None
    last_input_activity: SafeInputActivity | None = None
    created_at: datetime
    updated_at: datetime


class DeviceListResponse(BaseModel):
    items: list[DeviceItem]
    total: int


class PolicyItem(PolicySummary):
    created_at: datetime
    updated_at: datetime


class PolicyListResponse(BaseModel):
    items: list[PolicyItem]
    total: int


class PolicyCreateRequest(BaseModel):
    name: str
    version: str
    screenshot_interval_seconds: int = Field(ge=1)
    no_change_threshold: int = Field(ge=1)
    retention_days: int = Field(ge=1)
    is_active: bool = True
    rules_json: dict[str, Any] = Field(default_factory=dict)


class PolicyUpdateRequest(BaseModel):
    name: str | None = None
    version: str | None = None
    screenshot_interval_seconds: int | None = Field(default=None, ge=1)
    no_change_threshold: int | None = Field(default=None, ge=1)
    retention_days: int | None = Field(default=None, ge=1)
    is_active: bool | None = None
    rules_json: dict[str, Any] | None = None


class PolicyActivationRequest(BaseModel):
    is_active: bool


class AuditLogItem(BaseModel):
    id: UUID
    actor_id: UUID | None = None
    action: str
    target_type: str
    target_id: UUID | None = None
    reason: str | None = None
    ip_address: str | None = None
    user_agent: str | None = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class AuditLogListResponse(BaseModel):
    items: list[AuditLogItem]
    total: int
