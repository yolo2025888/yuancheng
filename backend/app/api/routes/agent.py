from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
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
