from __future__ import annotations

from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlmodel import Session

from app.api.deps import get_session, require_permissions
from app.schemas.query import TimelineResponse
from app.services.queries import QueryService

router = APIRouter(prefix="/api/employees", tags=["timeline"])


@router.get("/{employee_id}/timeline", response_model=TimelineResponse)
def get_employee_timeline(
    employee_id: UUID,
    date_value: date = Query(alias="date"),
    session: Session = Depends(get_session),
    _: object = Depends(require_permissions("screenshots.view")),
) -> TimelineResponse:
    return QueryService(session).get_employee_timeline(employee_id=employee_id, date_value=date_value)
