from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import FileResponse
from sqlmodel import Session

from app.api.deps import get_audit_context, get_session, get_settings, require_permissions
from app.core.config import Settings
from app.models import Screenshot
from app.schemas.query import ScreenshotItem, ScreenshotListResponse
from app.services.audit import AuditContext, AuditService
from app.services.queries import QueryService
from app.services.storage import LocalScreenshotStorage

router = APIRouter(prefix="/api/screenshots", tags=["screenshots"])


@router.get("", response_model=ScreenshotListResponse)
def list_screenshots(
    device_id: UUID | None = Query(default=None),
    employee_id: UUID | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=200),
    session: Session = Depends(get_session),
    _: object = Depends(require_permissions("screenshots.metadata.view")),
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
    _: object = Depends(require_permissions("screenshots.metadata.view")),
) -> ScreenshotItem:
    screenshot = QueryService(session).get_screenshot(screenshot_id)
    if screenshot is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Screenshot not found")
    return screenshot


@router.get("/{screenshot_id}/image")
def get_screenshot_image(
    screenshot_id: UUID,
    reason: str | None = Query(default=None, max_length=500),
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
    audit_context: AuditContext = Depends(get_audit_context),
    _: object = Depends(require_permissions("screenshots.image.view")),
) -> FileResponse:
    screenshot = _get_screenshot_record(session, screenshot_id)
    access_reason = _validate_access_reason(reason)
    response = _build_screenshot_file_response(settings, screenshot.image_uri, "Screenshot image not found")
    _log_screenshot_file_access(
        session=session,
        screenshot=screenshot,
        kind="image",
        reason=access_reason,
        audit_context=audit_context,
    )
    return response


@router.get("/{screenshot_id}/thumbnail")
def get_screenshot_thumbnail(
    screenshot_id: UUID,
    reason: str | None = Query(default=None, max_length=500),
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
    audit_context: AuditContext = Depends(get_audit_context),
    _: object = Depends(require_permissions("screenshots.image.view")),
) -> FileResponse:
    screenshot = _get_screenshot_record(session, screenshot_id)
    access_reason = _validate_access_reason(reason)
    response = _build_screenshot_file_response(settings, screenshot.thumb_uri, "Screenshot thumbnail not found")
    _log_screenshot_file_access(
        session=session,
        screenshot=screenshot,
        kind="thumbnail",
        reason=access_reason,
        audit_context=audit_context,
    )
    return response


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


def _validate_access_reason(reason: str | None) -> str:
    normalized_reason = (reason or "").strip()
    if not normalized_reason:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Screenshot image access requires a non-empty reason",
        )
    return normalized_reason


def _log_screenshot_file_access(
    *,
    session: Session,
    screenshot: Screenshot,
    kind: str,
    reason: str,
    audit_context: AuditContext,
) -> None:
    AuditService(session).log(
        action=f"screenshot.{kind}.viewed",
        target_type="screenshot",
        target_id=screenshot.id,
        reason=reason,
        context=audit_context,
    )
    session.commit()
