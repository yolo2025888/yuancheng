from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlmodel import Session

from app.api.deps import get_audit_context, get_session
from app.schemas.admin import (
    AccessMatrixResponse,
    AuditLogListResponse,
    DashboardSummaryResponse,
    DeviceListResponse,
    EmployeeRiskScoreListResponse,
    EmployeeListResponse,
    PolicyActivationRequest,
    PolicyCreateRequest,
    PolicyItem,
    PolicyListResponse,
    PolicyUpdateRequest,
)
from app.services.queries import QueryService
from app.services.audit import AuditContext
from app.services.policies import PolicyService

router = APIRouter(prefix="/api", tags=["admin"])


@router.get("/employees", response_model=EmployeeListResponse)
def list_employees(session: Session = Depends(get_session)) -> EmployeeListResponse:
    return QueryService(session).list_employees()


@router.get("/devices", response_model=DeviceListResponse)
def list_devices(session: Session = Depends(get_session)) -> DeviceListResponse:
    return QueryService(session).list_devices()


@router.get("/dashboard/summary", response_model=DashboardSummaryResponse)
def get_dashboard_summary(session: Session = Depends(get_session)) -> DashboardSummaryResponse:
    return QueryService(session).get_dashboard_summary()


@router.get("/risk/scores", response_model=EmployeeRiskScoreListResponse)
def list_risk_scores(
    limit: int = Query(default=100, ge=1, le=500),
    session: Session = Depends(get_session),
) -> EmployeeRiskScoreListResponse:
    return QueryService(session).list_risk_scores(limit=limit)


@router.get("/access-matrix", response_model=AccessMatrixResponse, include_in_schema=False)
@router.get("/access/matrix", response_model=AccessMatrixResponse)
def get_access_matrix(session: Session = Depends(get_session)) -> AccessMatrixResponse:
    return QueryService(session).get_access_matrix()


@router.get("/policies", response_model=PolicyListResponse)
def list_policies(session: Session = Depends(get_session)) -> PolicyListResponse:
    return QueryService(session).list_policies()


@router.get("/audit-logs", response_model=AuditLogListResponse)
def list_audit_logs(
    limit: int = Query(default=100, ge=1, le=500),
    session: Session = Depends(get_session),
) -> AuditLogListResponse:
    return QueryService(session).list_audit_logs(limit=limit)


@router.post("/policies", response_model=PolicyItem, status_code=status.HTTP_201_CREATED)
def create_policy(
    payload: PolicyCreateRequest,
    session: Session = Depends(get_session),
    audit_context: AuditContext = Depends(get_audit_context),
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
) -> PolicyItem:
    policy = PolicyService(session).set_policy_activation(policy_id, payload, audit_context=audit_context)
    if policy is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Policy not found")
    return PolicyItem.model_validate(policy)
