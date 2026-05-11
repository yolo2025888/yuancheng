from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlmodel import Session

from app.api.deps import get_session
from app.schemas.query import ScreenshotItem, ScreenshotListResponse
from app.services.queries import QueryService

router = APIRouter(prefix="/api/screenshots", tags=["screenshots"])


@router.get("", response_model=ScreenshotListResponse)
def list_screenshots(
    device_id: UUID | None = Query(default=None),
    employee_id: UUID | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=200),
    session: Session = Depends(get_session),
) -> ScreenshotListResponse:
    return QueryService(session).list_screenshots(
        device_id=device_id,
        employee_id=employee_id,
        limit=limit,
    )


@router.get("/{screenshot_id}", response_model=ScreenshotItem)
def get_screenshot(
    screenshot_id: UUID,
    session: Session = Depends(get_session),
) -> ScreenshotItem:
    screenshot = QueryService(session).get_screenshot(screenshot_id)
    if screenshot is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Screenshot not found")
    return screenshot
