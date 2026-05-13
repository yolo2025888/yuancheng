from __future__ import annotations

from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlmodel import Session

from app.api.deps import get_session, require_permissions
from app.schemas.query import TimelineResponse
from app.services.access_scope import require_employee_in_scope, resolve_employee_access_scope
from app.services.auth import AuthenticatedPrincipal
from app.services.queries import QueryService

router = APIRouter(prefix="/api", tags=["timeline"])


@router.get("/timeline", response_model=TimelineResponse)
def list_timeline(
    employee_id: UUID | None = Query(default=None),
    department: str | None = Query(default=None, max_length=120),
    date_value: date | None = Query(default=None, alias="date"),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    risk_level: str | None = Query(default=None, max_length=64),
    abnormal_only: bool = Query(default=False),
    descending: bool = Query(default=True),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    session: Session = Depends(get_session),
    principal: AuthenticatedPrincipal = Depends(require_permissions("screenshots.metadata.view")),
) -> TimelineResponse:
    scope = resolve_employee_access_scope(session, principal)
    if employee_id is not None:
        require_employee_in_scope(scope, employee_id)
    return QueryService(session).list_timeline(
        employee_id=employee_id,
        department=department,
        date_value=date_value,
        date_from=date_from,
        date_to=date_to,
        risk_level=risk_level,
        abnormal_only=abnormal_only,
        descending=descending,
        page=page,
        page_size=page_size,
        scope=scope,
    )


@router.get("/employees/{employee_id}/timeline", response_model=TimelineResponse)
def get_employee_timeline(
    employee_id: UUID,
    date_value: date = Query(alias="date"),
    risk_level: str | None = Query(default=None, max_length=64),
    abnormal_only: bool = Query(default=False),
    descending: bool = Query(default=True),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    session: Session = Depends(get_session),
    principal: AuthenticatedPrincipal = Depends(require_permissions("screenshots.metadata.view")),
) -> TimelineResponse:
    scope = resolve_employee_access_scope(session, principal)
    require_employee_in_scope(scope, employee_id)
    return QueryService(session).list_timeline(
        employee_id=employee_id,
        department=None,
        date_value=date_value,
        date_from=None,
        date_to=None,
        risk_level=risk_level,
        abnormal_only=abnormal_only,
        descending=descending,
        page=page,
        page_size=page_size,
        scope=scope,
    )
