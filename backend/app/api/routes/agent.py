from __future__ import annotations

from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from sqlmodel import Session

from app.api.deps import get_session, get_settings
from app.core.config import Settings
from app.schemas.agent import (
    HeartbeatRequest,
    HeartbeatResponse,
    PolicyResponse,
    ScreenshotCompleteRequest,
    ScreenshotCompleteResponse,
    ScreenshotMetadataRequest,
    ScreenshotMetadataResponse,
    ScreenshotUploadResponse,
)
from app.services.agent import AgentService

router = APIRouter(prefix="/api/agent", tags=["agent"])


@router.post("/heartbeat", response_model=HeartbeatResponse)
def heartbeat(
    payload: HeartbeatRequest,
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> HeartbeatResponse:
    return AgentService(session, settings).heartbeat(payload)


@router.get("/policy", response_model=PolicyResponse)
def get_policy(
    device_id: str | None = Query(default=None),
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> PolicyResponse:
    return AgentService(session, settings).get_policy(device_id)


@router.post(
    "/screenshots",
    response_model=ScreenshotMetadataResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_screenshot(
    payload: ScreenshotMetadataRequest,
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> ScreenshotMetadataResponse:
    try:
        return AgentService(session, settings).create_screenshot(payload)
    except ValueError as exc:
        detail = str(exc)
        status_code = status.HTTP_404_NOT_FOUND if detail == "Device not found" else status.HTTP_400_BAD_REQUEST
        raise HTTPException(status_code=status_code, detail=detail) from exc


@router.post(
    "/screenshots/upload",
    response_model=ScreenshotUploadResponse,
    status_code=status.HTTP_201_CREATED,
)
async def upload_screenshot(
    device_id: UUID = Form(...),
    captured_at: datetime = Form(...),
    screen_index: int = Form(default=0),
    width: int = Form(...),
    height: int = Form(...),
    foreground_process: str | None = Form(default=None),
    window_title: str | None = Form(default=None),
    keyboard_count: int = Form(default=0),
    mouse_click_count: int = Form(default=0),
    mouse_move_count: int = Form(default=0),
    is_locked: bool = Form(default=False),
    is_remote_session: bool = Form(default=False),
    phash: str | None = Form(default=None),
    file: UploadFile = File(...),
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> ScreenshotUploadResponse:
    payload = ScreenshotMetadataRequest(
        device_id=device_id,
        captured_at=captured_at,
        screen_index=screen_index,
        width=width,
        height=height,
        foreground_process=foreground_process,
        window_title=window_title,
        keyboard_count=keyboard_count,
        mouse_click_count=mouse_click_count,
        mouse_move_count=mouse_move_count,
        is_locked=is_locked,
        is_remote_session=is_remote_session,
    )

    try:
        return AgentService(session, settings).upload_screenshot(
            payload=payload,
            filename=file.filename,
            content_type=file.content_type,
            image_bytes=await file.read(),
            phash=phash,
        )
    except ValueError as exc:
        detail = str(exc)
        status_code = status.HTTP_404_NOT_FOUND if detail == "Device not found" else status.HTTP_400_BAD_REQUEST
        raise HTTPException(status_code=status_code, detail=detail) from exc


@router.post(
    "/screenshots/{screenshot_id}/complete",
    response_model=ScreenshotCompleteResponse,
)
def complete_screenshot(
    screenshot_id: str,
    payload: ScreenshotCompleteRequest,
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> ScreenshotCompleteResponse:
    try:
        return AgentService(session, settings).complete_screenshot(screenshot_id, payload)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
