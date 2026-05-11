from __future__ import annotations

from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from sqlmodel import Session, select

from app.api.deps import get_session, get_settings, require_agent_device, require_agent_token
from app.core.config import Settings
from app.models import Employee
from app.schemas.agent import (
    AgentEmployeeResponse,
    AttendanceRuleResponse,
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
from app.services.agent_auth import AgentPrincipal
from app.services.attendance_rules import AttendanceRuleService, format_rule_time

router = APIRouter(prefix="/api/agent", tags=["agent"])


@router.get("/employees/resolve", response_model=AgentEmployeeResponse)
def resolve_employee(
    employee_no: str = Query(..., min_length=1, max_length=64),
    _: AgentPrincipal = Depends(require_agent_token),
    session: Session = Depends(get_session),
) -> AgentEmployeeResponse:
    normalized_employee_no = employee_no.strip()
    if not normalized_employee_no:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="employee_no must not be blank")

    employee = session.exec(select(Employee).where(Employee.employee_no == normalized_employee_no)).first()
    if employee is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee not found")
    return AgentEmployeeResponse.model_validate(employee)


@router.get("/attendance/rules", response_model=AttendanceRuleResponse)
def get_attendance_rules(
    employee_no: str | None = Query(default=None, max_length=64),
    _: AgentPrincipal = Depends(require_agent_token),
) -> AttendanceRuleResponse:
    normalized_employee_no = (employee_no.strip() or None) if employee_no is not None else None
    rules = AttendanceRuleService().get_rules(employee_no=normalized_employee_no)
    return AttendanceRuleResponse(
        clock_in_late_after=format_rule_time(rules.clock_in_late_after),
        clock_out_early_before=format_rule_time(rules.clock_out_early_before),
    )


@router.post("/heartbeat", response_model=HeartbeatResponse)
def heartbeat(
    payload: HeartbeatRequest,
    agent_principal: AgentPrincipal = Depends(require_agent_token),
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> HeartbeatResponse:
    require_agent_device(agent_principal, payload.device_id)
    return AgentService(session, settings).heartbeat(payload)


@router.get("/policy", response_model=PolicyResponse)
def get_policy(
    device_id: UUID | None = Query(default=None),
    agent_principal: AgentPrincipal = Depends(require_agent_token),
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> PolicyResponse:
    if device_id is not None:
        require_agent_device(agent_principal, device_id)
    return AgentService(session, settings).get_policy(device_id)


@router.post(
    "/screenshots",
    response_model=ScreenshotMetadataResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_screenshot(
    payload: ScreenshotMetadataRequest,
    agent_principal: AgentPrincipal = Depends(require_agent_token),
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> ScreenshotMetadataResponse:
    require_agent_device(agent_principal, payload.device_id)
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
    mouse_wheel_count: int = Form(default=0),
    window_switch_count: int = Form(default=0),
    is_locked: bool = Form(default=False),
    is_remote_session: bool = Form(default=False),
    is_rdp_session: bool = Form(default=False),
    idle_seconds: int | None = Form(default=None),
    input_desktop_name: str | None = Form(default=None),
    session_connect_state: str | None = Form(default=None),
    phash: str | None = Form(default=None),
    file: UploadFile = File(...),
    agent_principal: AgentPrincipal = Depends(require_agent_token),
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> ScreenshotUploadResponse:
    require_agent_device(agent_principal, device_id)
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
        mouse_wheel_count=mouse_wheel_count,
        window_switch_count=window_switch_count,
        is_locked=is_locked,
        is_remote_session=is_remote_session,
        is_rdp_session=is_rdp_session,
        idle_seconds=idle_seconds,
        input_desktop_name=input_desktop_name,
        session_connect_state=session_connect_state,
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
    agent_principal: AgentPrincipal = Depends(require_agent_token),
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> ScreenshotCompleteResponse:
    try:
        require_agent_device(agent_principal, payload.device_id)
        return AgentService(session, settings).complete_screenshot(screenshot_id, payload)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
