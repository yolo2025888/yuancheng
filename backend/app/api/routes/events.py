from __future__ import annotations

from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlmodel import Session

from app.api.deps import get_audit_context, get_session, require_permissions
from app.schemas.query import BehaviorEventDetail, BehaviorEventListResponse, BehaviorEventReviewRequest
from app.services.access_scope import resolve_employee_access_scope
from app.services.audit import AuditContext
from app.services.auth import AuthenticatedPrincipal
from app.services.queries import QueryService

router = APIRouter(prefix="/api/events", tags=["events"])


@router.get("", response_model=BehaviorEventListResponse)
def list_events(
    employee_id: UUID | None = Query(default=None),
    severity: str | None = Query(default=None),
    status: str | None = Query(default=None),
    event_type: str | None = Query(default=None),
    start_from: datetime | None = Query(default=None, alias="from"),
    end_to: datetime | None = Query(default=None, alias="to"),
    session: Session = Depends(get_session),
    principal: AuthenticatedPrincipal = Depends(require_permissions("events.review")),
) -> BehaviorEventListResponse:
    scope = resolve_employee_access_scope(session, principal)
    return QueryService(session).list_events(
        employee_id=employee_id,
        severity=severity,
        status=status,
        event_type=event_type,
        start_from=start_from,
        end_to=end_to,
        scope=scope,
    )


@router.get("/{event_id}", response_model=BehaviorEventDetail)
def get_event(
    event_id: UUID,
    session: Session = Depends(get_session),
    principal: AuthenticatedPrincipal = Depends(require_permissions("events.review")),
) -> BehaviorEventDetail:
    scope = resolve_employee_access_scope(session, principal)
    event = QueryService(session).get_event(event_id, scope=scope)
    if event is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")
    return event


@router.post("/{event_id}/review", response_model=BehaviorEventDetail)
def review_event(
    event_id: UUID,
    payload: BehaviorEventReviewRequest,
    session: Session = Depends(get_session),
    audit_context: AuditContext = Depends(get_audit_context),
    principal: AuthenticatedPrincipal = Depends(require_permissions("events.review")),
) -> BehaviorEventDetail:
    scope = resolve_employee_access_scope(session, principal)
    event = QueryService(session).review_event(event_id, payload, audit_context=audit_context, scope=scope)
    if event is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")
    return event
