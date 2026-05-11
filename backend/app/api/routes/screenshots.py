from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import FileResponse
from sqlmodel import Session

from app.api.deps import get_session, get_settings, require_permissions
from app.core.config import Settings
from app.models import Screenshot
from app.schemas.query import ScreenshotItem, ScreenshotListResponse
from app.services.queries import QueryService
from app.services.storage import LocalScreenshotStorage

router = APIRouter(prefix="/api/screenshots", tags=["screenshots"])


@router.get("", response_model=ScreenshotListResponse)
def list_screenshots(
    device_id: UUID | None = Query(default=None),
    employee_id: UUID | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=200),
    session: Session = Depends(get_session),
    _: object = Depends(require_permissions("screenshots.view")),
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
    _: object = Depends(require_permissions("screenshots.view")),
) -> ScreenshotItem:
    screenshot = QueryService(session).get_screenshot(screenshot_id)
    if screenshot is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Screenshot not found")
    return screenshot


@router.get("/{screenshot_id}/image")
def get_screenshot_image(
    screenshot_id: UUID,
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
    _: object = Depends(require_permissions("screenshots.view")),
) -> FileResponse:
    screenshot = _get_screenshot_record(session, screenshot_id)
    return _build_screenshot_file_response(settings, screenshot.image_uri, "Screenshot image not found")


@router.get("/{screenshot_id}/thumbnail")
def get_screenshot_thumbnail(
    screenshot_id: UUID,
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
    _: object = Depends(require_permissions("screenshots.view")),
) -> FileResponse:
    screenshot = _get_screenshot_record(session, screenshot_id)
    return _build_screenshot_file_response(settings, screenshot.thumb_uri, "Screenshot thumbnail not found")


def _get_screenshot_record(session: Session, screenshot_id: UUID) -> Screenshot:
    screenshot = session.get(Screenshot, screenshot_id)
    if screenshot is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Screenshot not found")
    return screenshot


def _build_screenshot_file_response(settings: Settings, uri: str | None, not_found_detail: str) -> FileResponse:
    resolved_path = LocalScreenshotStorage(settings).resolve_stored_uri(uri)
    if resolved_path is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=not_found_detail)
    return FileResponse(resolved_path)
