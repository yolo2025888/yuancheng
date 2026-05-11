from __future__ import annotations

from datetime import date, datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlmodel import Session

from app.api.deps import get_audit_context, get_session, require_agent_token, require_permissions
from app.schemas.admin import (
    AccessMatrixResponse,
    AttendanceClockRequest,
    AttendanceListResponse,
    AttendanceRecordItem,
    AttendanceReviewRequest,
    AuditLogListResponse,
    DashboardSummaryResponse,
    DeviceListResponse,
    EmployeeRiskScoreListResponse,
    EmployeeImportResponse,
    EmployeeListResponse,
    PolicyActivationRequest,
    PolicyCreateRequest,
    PolicyItem,
    PolicyListResponse,
    PolicyUpdateRequest,
)
from app.services.queries import QueryService
from app.services.audit import AuditContext
from app.services.attendance import AttendanceService
from app.services.employee_admin import EmployeeAdminService
from app.services.policies import PolicyService

router = APIRouter(prefix="/api", tags=["admin"])


@router.get("/employees", response_model=EmployeeListResponse)
def list_employees(
    session: Session = Depends(get_session),
    _: object = Depends(require_permissions("directory.view")),
) -> EmployeeListResponse:
    return QueryService(session).list_employees()


@router.get("/devices", response_model=DeviceListResponse)
def list_devices(
    session: Session = Depends(get_session),
    _: object = Depends(require_permissions("directory.view")),
) -> DeviceListResponse:
    return QueryService(session).list_devices()


@router.get("/dashboard/summary", response_model=DashboardSummaryResponse)
def get_dashboard_summary(
    session: Session = Depends(get_session),
    _: object = Depends(require_permissions("dashboard.view")),
) -> DashboardSummaryResponse:
    return QueryService(session).get_dashboard_summary()


@router.get("/risk/scores", response_model=EmployeeRiskScoreListResponse)
def list_risk_scores(
    limit: int = Query(default=100, ge=1, le=500),
    session: Session = Depends(get_session),
    _: object = Depends(require_permissions("risk_scores.view")),
) -> EmployeeRiskScoreListResponse:
    return QueryService(session).list_risk_scores(limit=limit)


@router.get("/access-matrix", response_model=AccessMatrixResponse, include_in_schema=False)
@router.get("/access/matrix", response_model=AccessMatrixResponse)
def get_access_matrix(
    session: Session = Depends(get_session),
    _: object = Depends(require_permissions("access_matrix.view")),
) -> AccessMatrixResponse:
    return QueryService(session).get_access_matrix()


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


@router.get("/attendance", response_model=AttendanceListResponse)
def list_attendance(
    work_date: date | None = Query(default=None),
    anomaly_status: str | None = Query(default=None),
    review_status: str | None = Query(default=None),
    limit: int = Query(default=200, ge=1, le=1000),
    session: Session = Depends(get_session),
    _: object = Depends(require_permissions("attendance.view")),
) -> AttendanceListResponse:
    return QueryService(session).list_attendance(
        work_date=work_date,
        anomaly_status=anomaly_status,
        review_status=review_status,
        limit=limit,
    )


@router.post("/attendance/{record_id}/review", response_model=AttendanceRecordItem)
def review_attendance_record(
    record_id: UUID,
    payload: AttendanceReviewRequest,
    session: Session = Depends(get_session),
    audit_context: AuditContext = Depends(get_audit_context),
    _: object = Depends(require_permissions("attendance.manage")),
) -> AttendanceRecordItem:
    record = AttendanceService(session).review_record(record_id, payload, audit_context=audit_context)
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Attendance record not found")

    refreshed = QueryService(session).list_attendance(
        work_date=record.work_date,
        anomaly_status=None,
        review_status=None,
        limit=1000,
    )
    for item in refreshed.items:
        if item.id == record.id:
            return item

    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Attendance record not found")


@router.post("/agent/attendance", response_model=AttendanceRecordItem, status_code=status.HTTP_201_CREATED)
def create_agent_attendance_record(
    payload: AttendanceClockRequest,
    _: None = Depends(require_agent_token),
    session: Session = Depends(get_session),
) -> AttendanceRecordItem:
    record = AttendanceService(session).create_clock_record(payload)
    refreshed = QueryService(session).list_attendance(
        work_date=record.work_date,
        anomaly_status=None,
        review_status=None,
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
