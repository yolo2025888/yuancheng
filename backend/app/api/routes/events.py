from __future__ import annotations

from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlmodel import Session

from app.api.deps import get_audit_context, get_session, require_permissions
from app.schemas.query import BehaviorEventDetail, BehaviorEventListResponse, BehaviorEventReviewRequest
from app.services.audit import AuditContext
from app.services.queries import QueryService

router = APIRouter(prefix="/api/events", tags=["events"])


@router.get("", response_model=BehaviorEventListResponse)
def list_events(
    employee_id: UUID | None = Query(default=None),
    severity: str | None = Query(default=None),
    event_type: str | None = Query(default=None),
    start_from: datetime | None = Query(default=None, alias="from"),
    end_to: datetime | None = Query(default=None, alias="to"),
    session: Session = Depends(get_session),
    _: object = Depends(require_permissions("events.review")),
) -> BehaviorEventListResponse:
    return QueryService(session).list_events(
        employee_id=employee_id,
        severity=severity,
        event_type=event_type,
        start_from=start_from,
        end_to=end_to,
    )


@router.get("/{event_id}", response_model=BehaviorEventDetail)
def get_event(
    event_id: UUID,
    session: Session = Depends(get_session),
    _: object = Depends(require_permissions("events.review")),
) -> BehaviorEventDetail:
    event = QueryService(session).get_event(event_id)
    if event is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")
    return event


@router.post("/{event_id}/review", response_model=BehaviorEventDetail)
def review_event(
    event_id: UUID,
    payload: BehaviorEventReviewRequest,
    session: Session = Depends(get_session),
    audit_context: AuditContext = Depends(get_audit_context),
    _: object = Depends(require_permissions("events.review")),
) -> BehaviorEventDetail:
    event = QueryService(session).review_event(event_id, payload, audit_context=audit_context)
    if event is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")
    return event
