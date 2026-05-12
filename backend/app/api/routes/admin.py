from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlmodel import Session, select

from app.api.deps import get_audit_context, get_session, get_settings, require_agent_token, require_permissions
from app.core.config import Settings
from app.schemas.admin import (
    AccessMatrixResponse,
    AccessRoleUserItem,
    AccessUserEmployeeBindingRequest,
    AttendanceClockRequest,
    AttendanceListResponse,
    AttendanceRecordItem,
    AttendanceReviewRequest,
    AttendanceRuleSummary,
    AttendanceRuleUpdateRequest,
    AuditLogListResponse,
    DeviceAgentTokenIssueResponse,
    DeviceAgentTokenRevokeResponse,
    DashboardSummaryResponse,
    DeviceListResponse,
    EmployeeRiskScoreListResponse,
    GitHubRiskEventCreateRequest,
    GitHubRiskEventItem,
    GitHubRiskEventListResponse,
    EmployeeImportResponse,
    EmployeeListResponse,
    PolicyActivationRequest,
    PolicyCreateRequest,
    PolicyItem,
    PolicyListResponse,
    PolicyUpdateRequest,
    ReviewQueueResponse,
    ScreenshotRetentionCleanupResponse,
)
from app.models import AttendanceRecord, Device, Employee, User
from app.services.queries import QueryService
from app.services.audit import AuditContext, AuditService
from app.services.agent_auth import (
    AgentPrincipal,
    create_device_agent_token,
    generate_device_agent_secret,
    hash_device_agent_secret,
)
from app.services.attendance import AttendanceService
from app.services.attendance_rules import AttendanceRuleService, format_rule_time
from app.services.employee_admin import EmployeeAdminService
from app.services.policies import PolicyService
from app.services.retention import ScreenshotRetentionService
from app.services.access_scope import require_employee_in_scope, resolve_employee_access_scope
from app.services.auth import AuthenticatedPrincipal

router = APIRouter(prefix="/api", tags=["admin"])


@router.get("/employees", response_model=EmployeeListResponse)
def list_employees(
    session: Session = Depends(get_session),
    principal: AuthenticatedPrincipal = Depends(require_permissions("directory.view")),
) -> EmployeeListResponse:
    scope = resolve_employee_access_scope(session, principal)
    return QueryService(session).list_employees(scope=scope)


@router.get("/devices", response_model=DeviceListResponse)
def list_devices(
    session: Session = Depends(get_session),
    principal: AuthenticatedPrincipal = Depends(require_permissions("directory.view")),
) -> DeviceListResponse:
    scope = resolve_employee_access_scope(session, principal)
    return QueryService(session).list_devices(scope=scope)


@router.post("/devices/{device_id}/agent-token", response_model=DeviceAgentTokenIssueResponse)
def issue_device_agent_token(
    device_id: UUID,
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
    audit_context: AuditContext = Depends(get_audit_context),
    _: object = Depends(require_permissions("device_tokens.manage")),
) -> DeviceAgentTokenIssueResponse:
    device = session.get(Device, device_id)
    if device is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device not found")

    issued_at = datetime.now(timezone.utc)
    expires_at = issued_at + timedelta(days=settings.device_agent_token_ttl_days)
    secret = generate_device_agent_secret()
    device.agent_token_hash = hash_device_agent_secret(secret)
    device.agent_token_revoked_at = None
    device.agent_token_expires_at = expires_at
    device.agent_token_last_used_at = None
    device.updated_at = issued_at
    session.add(device)
    AuditService(session).log(
        action="device.agent_token.issued",
        target_type="device",
        target_id=device.id,
        reason="Issued device-scoped agent token",
        context=audit_context,
    )
    session.commit()

    return DeviceAgentTokenIssueResponse(
        device_id=device.id,
        token=create_device_agent_token(device.id, secret),
        issued_at=issued_at,
        expires_at=expires_at,
    )


@router.post("/devices/{device_id}/agent-token/revoke", response_model=DeviceAgentTokenRevokeResponse)
def revoke_device_agent_token(
    device_id: UUID,
    session: Session = Depends(get_session),
    audit_context: AuditContext = Depends(get_audit_context),
    _: object = Depends(require_permissions("device_tokens.manage")),
) -> DeviceAgentTokenRevokeResponse:
    device = session.get(Device, device_id)
    if device is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device not found")

    revoked_at = datetime.now(timezone.utc)
    device.agent_token_revoked_at = revoked_at
    device.updated_at = revoked_at
    session.add(device)
    AuditService(session).log(
        action="device.agent_token.revoked",
        target_type="device",
        target_id=device.id,
        reason="Revoked device-scoped agent token",
        context=audit_context,
    )
    session.commit()

    return DeviceAgentTokenRevokeResponse(device_id=device.id, revoked_at=revoked_at)


@router.get("/dashboard/summary", response_model=DashboardSummaryResponse)
def get_dashboard_summary(
    session: Session = Depends(get_session),
    principal: AuthenticatedPrincipal = Depends(require_permissions("dashboard.view")),
) -> DashboardSummaryResponse:
    scope = resolve_employee_access_scope(session, principal)
    return QueryService(session).get_dashboard_summary(scope=scope)


@router.get("/risk/scores", response_model=EmployeeRiskScoreListResponse)
def list_risk_scores(
    limit: int = Query(default=100, ge=1, le=500),
    session: Session = Depends(get_session),
    principal: AuthenticatedPrincipal = Depends(require_permissions("risk_scores.view")),
) -> EmployeeRiskScoreListResponse:
    scope = resolve_employee_access_scope(session, principal)
    return QueryService(session).list_risk_scores(limit=limit, scope=scope)


@router.get("/github-risks", response_model=GitHubRiskEventListResponse)
def list_github_risks(
    limit: int = Query(default=200, ge=1, le=1000),
    session: Session = Depends(get_session),
    principal: AuthenticatedPrincipal = Depends(require_permissions("github_risks.view")),
) -> GitHubRiskEventListResponse:
    scope = resolve_employee_access_scope(session, principal)
    return QueryService(session).list_github_risks(limit=limit, scope=scope)


@router.get("/review-queue", response_model=ReviewQueueResponse)
def list_review_queue(
    limit: int = Query(default=100, ge=1, le=500),
    session: Session = Depends(get_session),
    principal: AuthenticatedPrincipal = Depends(require_permissions("events.review")),
) -> ReviewQueueResponse:
    scope = resolve_employee_access_scope(session, principal)
    return QueryService(session).list_review_queue(limit=limit, scope=scope)


@router.post("/github-risks", response_model=GitHubRiskEventItem, status_code=status.HTTP_201_CREATED)
def create_github_risk(
    payload: GitHubRiskEventCreateRequest,
    session: Session = Depends(get_session),
    audit_context: AuditContext = Depends(get_audit_context),
    principal: AuthenticatedPrincipal = Depends(require_permissions("github_risks.manage")),
) -> GitHubRiskEventItem:
    scope = resolve_employee_access_scope(session, principal)
    require_employee_in_scope(scope, payload.employee_id)
    try:
        return QueryService(session).create_github_risk(payload, audit_context=audit_context)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.get("/access-matrix", response_model=AccessMatrixResponse, include_in_schema=False)
@router.get("/access/matrix", response_model=AccessMatrixResponse)
def get_access_matrix(
    session: Session = Depends(get_session),
    _: object = Depends(require_permissions("access_matrix.view")),
) -> AccessMatrixResponse:
    return QueryService(session).get_access_matrix()


@router.put("/access/users/{user_id}/employee", response_model=AccessRoleUserItem)
def bind_access_user_employee(
    user_id: UUID,
    payload: AccessUserEmployeeBindingRequest,
    session: Session = Depends(get_session),
    _: object = Depends(require_permissions("access_matrix.manage")),
) -> AccessRoleUserItem:
    user = session.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    employee = None
    if payload.employee_id is not None:
        employee = session.get(Employee, payload.employee_id)
        if employee is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee not found")

    user.employee_id = payload.employee_id
    session.add(user)
    session.commit()
    session.refresh(user)

    return AccessRoleUserItem(
        id=user.id,
        username=user.username,
        display_name=user.display_name,
        email=user.email,
        employee_id=user.employee_id,
        employee_name=employee.name if employee is not None else None,
        employee_no=employee.employee_no if employee is not None else None,
        status=user.status,
    )


@router.get("/policies", response_model=PolicyListResponse)
def list_policies(
    session: Session = Depends(get_session),
    _: object = Depends(require_permissions("policies.manage")),
) -> PolicyListResponse:
    return QueryService(session).list_policies()


@router.get("/audit-logs", response_model=AuditLogListResponse)
def list_audit_logs(
    limit: int = Query(default=100, ge=1, le=500),
    session: Session = Depends(get_session),
    _: object = Depends(require_permissions("audit_logs.view")),
) -> AuditLogListResponse:
    return QueryService(session).list_audit_logs(limit=limit)


@router.post("/admin/screenshots/retention/cleanup", response_model=ScreenshotRetentionCleanupResponse)
def cleanup_expired_screenshot_files(
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
    audit_context: AuditContext = Depends(get_audit_context),
    _: object = Depends(require_permissions("screenshots.retention.manage")),
) -> ScreenshotRetentionCleanupResponse:
    result = ScreenshotRetentionService(session, settings).cleanup_expired_screenshot_files(
        audit_context=audit_context,
    )
    return ScreenshotRetentionCleanupResponse(
        job_id=result.job_id,
        retention_days=result.retention_days,
        cutoff_at=result.cutoff_at,
        expired_count=result.expired_count,
        records_updated=result.records_updated,
        records_failed=result.records_failed,
        files_deleted=result.files_deleted,
        files_missing=result.files_missing,
        files_failed=result.files_failed,
    )


@router.get("/attendance", response_model=AttendanceListResponse)
def list_attendance(
    work_date: date | None = Query(default=None),
    anomaly_status: str | None = Query(default=None),
    review_status: str | None = Query(default=None),
    event_type: str | None = Query(default=None, pattern="^(clock_in|clock_out)$"),
    employee_no: str | None = Query(default=None),
    machine_name: str | None = Query(default=None),
    limit: int = Query(default=200, ge=1, le=1000),
    session: Session = Depends(get_session),
    principal: AuthenticatedPrincipal = Depends(require_permissions("attendance.view")),
) -> AttendanceListResponse:
    scope = resolve_employee_access_scope(session, principal)
    return QueryService(session).list_attendance(
        work_date=work_date,
        anomaly_status=anomaly_status,
        review_status=review_status,
        event_type=event_type,
        employee_no=(employee_no.strip() or None) if employee_no is not None else None,
        machine_name=(machine_name.strip() or None) if machine_name is not None else None,
        limit=limit,
        scope=scope,
    )


@router.get("/attendance/rules/default", response_model=AttendanceRuleSummary)
def get_default_attendance_rules(
    session: Session = Depends(get_session),
    _: object = Depends(require_permissions("attendance.view")),
) -> AttendanceRuleSummary:
    rules = AttendanceRuleService(session).get_rules()
    return AttendanceRuleSummary(
        name=rules.name,
        clock_in_late_after=format_rule_time(rules.clock_in_late_after),
        clock_out_early_before=format_rule_time(rules.clock_out_early_before),
    )


@router.put("/attendance/rules/default", response_model=AttendanceRuleSummary)
def update_default_attendance_rules(
    payload: AttendanceRuleUpdateRequest,
    session: Session = Depends(get_session),
    audit_context: AuditContext = Depends(get_audit_context),
    _: object = Depends(require_permissions("attendance.manage")),
) -> AttendanceRuleSummary:
    rules = AttendanceRuleService(session).update_default_rules(payload, audit_context=audit_context)
    return AttendanceRuleSummary(
        name=rules.name,
        clock_in_late_after=format_rule_time(rules.clock_in_late_after),
        clock_out_early_before=format_rule_time(rules.clock_out_early_before),
    )


@router.post("/attendance/{record_id}/review", response_model=AttendanceRecordItem)
def review_attendance_record(
    record_id: UUID,
    payload: AttendanceReviewRequest,
    session: Session = Depends(get_session),
    audit_context: AuditContext = Depends(get_audit_context),
    principal: AuthenticatedPrincipal = Depends(require_permissions("attendance.manage")),
) -> AttendanceRecordItem:
    scope = resolve_employee_access_scope(session, principal)
    existing_record = session.get(AttendanceRecord, record_id)
    if existing_record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Attendance record not found")
    scoped_record_employee_id = existing_record.employee_id
    if scoped_record_employee_id is None and existing_record.employee_no is not None:
        matching_employees = session.exec(
            select(Employee).where(Employee.employee_no == existing_record.employee_no)
        ).all()
        if len(matching_employees) == 1:
            scoped_record_employee_id = matching_employees[0].id
    if scoped_record_employee_id is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Attendance record not found")
    if not scope.all_employees and scoped_record_employee_id not in scope.employee_ids:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Attendance record not found")

    record = AttendanceService(session).review_record(record_id, payload, audit_context=audit_context)
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Attendance record not found")

    refreshed = QueryService(session).list_attendance(
        work_date=record.work_date,
        anomaly_status=None,
        review_status=None,
        event_type=None,
        employee_no=None,
        machine_name=None,
        limit=1000,
        scope=scope,
    )
    for item in refreshed.items:
        if item.id == record.id:
            return item

    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Attendance record not found")


@router.post("/agent/attendance", response_model=AttendanceRecordItem, status_code=status.HTTP_201_CREATED)
def create_agent_attendance_record(
    payload: AttendanceClockRequest,
    agent_principal: AgentPrincipal = Depends(require_agent_token),
    session: Session = Depends(get_session),
) -> AttendanceRecordItem:
    if agent_principal.device_id is not None:
        payload = payload.model_copy(update={"device_id": agent_principal.device_id})
    record = AttendanceService(session).create_clock_record(payload)
    refreshed = QueryService(session).list_attendance(
        work_date=record.work_date,
        anomaly_status=None,
        review_status=None,
        event_type=None,
        employee_no=None,
        machine_name=None,
        limit=1000,
    )
    for item in refreshed.items:
        if item.id == record.id:
            return item
    return AttendanceRecordItem(
        id=record.id,
        employee_id=record.employee_id,
        device_id=record.device_id,
        employee_no=record.employee_no,
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


@router.get("/admin/export/employees")
def export_employees(
    session: Session = Depends(get_session),
    audit_context: AuditContext = Depends(get_audit_context),
    _: object = Depends(require_permissions("directory.manage")),
) -> Response:
    csv_payload = EmployeeAdminService(session).export_employees_csv(audit_context=audit_context)
    filename = f"employees-{datetime.now().strftime('%Y%m%d%H%M%S')}.csv"
    return Response(
        content=csv_payload,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/admin/import/employees", response_model=EmployeeImportResponse)
async def import_employees(
    request: Request,
    session: Session = Depends(get_session),
    audit_context: AuditContext = Depends(get_audit_context),
    _: object = Depends(require_permissions("directory.manage")),
) -> EmployeeImportResponse:
    content_type = request.headers.get("content-type", "")
    csv_text: str | None = None

    try:
        if content_type.startswith("multipart/form-data"):
            form = await request.form()
            upload = form.get("file")
            if upload is not None and hasattr(upload, "read"):
                csv_text = _decode_csv_bytes(await upload.read())
            else:
                text_payload = form.get("csv_text")
                if isinstance(text_payload, str):
                    csv_text = text_payload
        elif content_type.startswith("application/json"):
            payload = await request.json()
            if isinstance(payload, dict):
                raw_text = payload.get("csv_text")
                if isinstance(raw_text, str):
                    csv_text = raw_text
        else:
            raw_body = await request.body()
            if raw_body:
                csv_text = _decode_csv_bytes(raw_body)

        if csv_text is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="CSV file or csv_text payload is required")

        return EmployeeAdminService(session).import_employees_csv(csv_text, audit_context=audit_context)
    except UnicodeDecodeError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="CSV payload must be UTF-8 text") from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


def _decode_csv_bytes(payload: bytes) -> str:
    return payload.decode("utf-8-sig")


@router.post("/policies", response_model=PolicyItem, status_code=status.HTTP_201_CREATED)
def create_policy(
    payload: PolicyCreateRequest,
    session: Session = Depends(get_session),
    audit_context: AuditContext = Depends(get_audit_context),
    _: object = Depends(require_permissions("policies.manage")),
) -> PolicyItem:
    try:
        policy = PolicyService(session).create_policy(payload, audit_context=audit_context)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return PolicyItem.model_validate(policy)


@router.put("/policies/{policy_id}", response_model=PolicyItem)
def update_policy(
    policy_id: UUID,
    payload: PolicyUpdateRequest,
    session: Session = Depends(get_session),
    audit_context: AuditContext = Depends(get_audit_context),
    _: object = Depends(require_permissions("policies.manage")),
) -> PolicyItem:
    try:
        policy = PolicyService(session).update_policy(policy_id, payload, audit_context=audit_context)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    if policy is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Policy not found")
    return PolicyItem.model_validate(policy)


@router.post("/policies/{policy_id}/activation", response_model=PolicyItem)
def set_policy_activation(
    policy_id: UUID,
    payload: PolicyActivationRequest,
    session: Session = Depends(get_session),
    audit_context: AuditContext = Depends(get_audit_context),
    _: object = Depends(require_permissions("policies.manage")),
) -> PolicyItem:
    policy = PolicyService(session).set_policy_activation(policy_id, payload, audit_context=audit_context)
    if policy is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Policy not found")
    return PolicyItem.model_validate(policy)
