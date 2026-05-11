from __future__ import annotations

from typing import Any
from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


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


class AttendanceClockRequest(BaseModel):
    device_id: UUID | None = None
    user_name: str = Field(min_length=1, max_length=120)
    employee_no: str | None = Field(default=None, max_length=64)
    machine_name: str | None = Field(default=None, max_length=160)
    event_type: str = Field(pattern="^(clock_in|clock_out)$")
    occurred_at: datetime
    source: str = Field(default="launcher", min_length=1, max_length=64)

    @field_validator("user_name", "source")
    @classmethod
    def strip_required_text(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("Value must not be blank")
        return stripped

    @field_validator("employee_no", "machine_name")
    @classmethod
    def strip_optional_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None


class AttendanceRuleSummary(BaseModel):
    name: str = "Default attendance rule"
    clock_in_late_after: str
    clock_out_early_before: str
    timezone: str = "Local time"


class AttendanceReviewRequest(BaseModel):
    review_status: str = Field(pattern="^(pending|reviewed|confirmed|ignored)$")
    review_note: str | None = None


class AttendanceRecordItem(BaseModel):
    id: UUID
    employee_id: UUID | None = None
    device_id: UUID | None = None
    employee_no: str | None = None
    employee_name: str | None = None
    department: str | None = None
    user_name: str
    machine_name: str | None = None
    event_type: str
    occurred_at: datetime
    work_date: date | None = None
    anomaly_status: str
    anomaly_reasons: list[str] = Field(default_factory=list)
    review_status: str
    review_note: str | None = None
    reviewed_at: datetime | None = None
    source: str
    created_at: datetime
    updated_at: datetime


class AttendanceListResponse(BaseModel):
    items: list[AttendanceRecordItem]
    total: int
    generated_at: datetime


class RiskFactorItem(BaseModel):
    code: str
    label: str
    points: int = Field(ge=0)
    reason: str


class EmployeeRiskScoreItem(BaseModel):
    employee_id: UUID
    employee_no: str
    employee_name: str
    department: str | None = None
    job_role: str | None = None
    score: int = Field(ge=0, le=100)
    label: str
    reasons: list[str] = Field(default_factory=list)
    active_device_count: int = 0
    total_device_count: int = 0
    latest_heartbeat_at: datetime | None = None
    latest_screenshot_at: datetime | None = None
    open_event_count: int = 0
    high_severity_event_count: int = 0
    stalled_event_count: int = 0
    policy_name: str | None = None
    policy_version: str | None = None
    has_targeted_policy: bool = False
    factors: list[RiskFactorItem] = Field(default_factory=list)


class EmployeeRiskScoreListResponse(BaseModel):
    items: list[EmployeeRiskScoreItem]
    total: int
    generated_at: datetime


class RiskLevelBreakdown(BaseModel):
    low: int = 0
    medium: int = 0
    high: int = 0
    critical: int = 0


class DashboardPolicyCoverage(BaseModel):
    active_policy_count: int
    targeted_active_policy_count: int
    employees_with_targeted_policy: int
    employees_default_only: int


class DashboardSummaryResponse(BaseModel):
    generated_at: datetime
    employee_count: int
    active_employee_count: int
    device_count: int
    online_device_count: int
    stale_device_count: int
    offline_device_count: int
    screenshot_count_24h: int
    open_event_count: int
    unresolved_high_risk_event_count: int
    risk_distribution: RiskLevelBreakdown
    policy_coverage: DashboardPolicyCoverage
    top_risks: list[EmployeeRiskScoreItem] = Field(default_factory=list)


class AccessCapabilityItem(BaseModel):
    key: str
    label: str
    description: str


class AccessRoleUserItem(BaseModel):
    id: UUID
    username: str
    display_name: str | None = None
    email: str | None = None
    status: str


class AccessRoleMatrixItem(BaseModel):
    role_id: UUID | None = None
    name: str
    description: str | None = None
    source: str
    permission_keys: list[str] = Field(default_factory=list)
    member_count: int = 0
    users: list[AccessRoleUserItem] = Field(default_factory=list)


class AccessMatrixResponse(BaseModel):
    generated_at: datetime
    capabilities: list[AccessCapabilityItem]
    roles: list[AccessRoleMatrixItem]
    unassigned_users: list[AccessRoleUserItem] = Field(default_factory=list)


class EmployeeImportResponse(BaseModel):
    total_rows: int
    created_count: int
    updated_count: int
    skipped_count: int
