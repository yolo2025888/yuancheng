from __future__ import annotations

from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlmodel import Session

from app.api.deps import get_session
from app.schemas.query import BehaviorEventDetail, BehaviorEventListResponse
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
) -> BehaviorEventDetail:
    event = QueryService(session).get_event(event_id)
    if event is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")
    return event
