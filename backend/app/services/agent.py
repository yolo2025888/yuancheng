from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from sqlmodel import Session

from app.core.config import Settings, get_settings
from app.models import Device, Policy, Screenshot
from app.schemas.agent import (
    HeartbeatForegroundWindow,
    HeartbeatInputActivity,
    HeartbeatRequest,
    HeartbeatResponse,
    HeartbeatSessionState,
    PolicyResponse,
    ScreenshotCompleteRequest,
    ScreenshotCompleteResponse,
    ScreenshotMetadataRequest,
    ScreenshotMetadataResponse,
    ScreenshotUploadResponse,
)
from app.services.policies import PolicyService
from app.services.screen_analysis import ScreenshotAnalysisService
from app.services.storage import LocalScreenshotStorage


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class AgentService:
    def __init__(self, session: Session, settings: Settings | None = None):
        self.session = session
        self.settings = settings or get_settings()
        self.storage = LocalScreenshotStorage(self.settings)
        self.policies = PolicyService(session, self.settings)

    def ensure_default_policy(self) -> Policy:
        return self.policies.ensure_default_policy()

    def get_policy(self, device_id: UUID | None = None) -> PolicyResponse:
        policy = self.policies.resolve_policy_for_device(device_id)
        return PolicyResponse.model_validate(policy)

    def _get_bound_device(self, device_id: UUID) -> Device:
        device = self.session.get(Device, device_id)
        if device is None:
            raise ValueError("Device not found")
        if device.employee_id is None:
            raise ValueError("Device is not bound to an employee")
        return device

    def _new_screenshot(self, payload: ScreenshotMetadataRequest, device: Device) -> Screenshot:
        return Screenshot(
            employee_id=device.employee_id,
            device_id=device.id,
            captured_at=payload.captured_at,
            screen_index=payload.screen_index,
            width=payload.width,
            height=payload.height,
            foreground_process=payload.foreground_process,
            window_title=payload.window_title,
            keyboard_count=payload.keyboard_count,
            mouse_click_count=payload.mouse_click_count,
            mouse_move_count=payload.mouse_move_count,
            mouse_wheel_count=payload.mouse_wheel_count,
            window_switch_count=payload.window_switch_count,
            is_locked=payload.is_locked,
            is_remote_session=payload.is_remote_session,
            is_rdp_session=payload.is_rdp_session,
            idle_seconds=payload.idle_seconds,
            input_desktop_name=payload.input_desktop_name,
            session_connect_state=payload.session_connect_state,
            upload_status="pending",
            ocr_status="pending",
            analysis_status="pending",
        )

    def _safe_foreground_window(
        self,
        foreground_window: HeartbeatForegroundWindow | None,
    ) -> dict[str, Any] | None:
        if foreground_window is None:
            return None
        return {
            "collected_at": foreground_window.collected_at.isoformat() if foreground_window.collected_at else None,
            "process_name": foreground_window.process_name,
        }

    def _safe_session_state(
        self,
        session_state: HeartbeatSessionState | None,
    ) -> dict[str, Any] | None:
        if session_state is None:
            return None
        return {
            "collected_at": session_state.collected_at.isoformat() if session_state.collected_at else None,
            "is_locked": session_state.is_locked,
            "is_remote_session": session_state.is_remote_session,
            "is_rdp_session": session_state.is_rdp_session,
            "is_active_session": session_state.is_active_session,
            "is_console_session": session_state.is_console_session,
            "active_console_session_id": session_state.active_console_session_id,
            "idle_seconds": session_state.idle_seconds,
            "input_desktop_name": session_state.input_desktop_name,
            "session_connect_state": session_state.session_connect_state,
        }

    def _safe_input_activity(
        self,
        input_activity: HeartbeatInputActivity | None,
    ) -> dict[str, Any] | None:
        if input_activity is None:
            return None
        return {
            "collected_from": input_activity.collected_from.isoformat() if input_activity.collected_from else None,
            "collected_to": input_activity.collected_to.isoformat() if input_activity.collected_to else None,
            "keyboard_event_count": input_activity.keyboard_event_count,
            "mouse_event_count": input_activity.mouse_event_count,
            "mouse_move_count": input_activity.mouse_move_count,
            "mouse_click_count": input_activity.mouse_click_count,
            "mouse_wheel_count": input_activity.mouse_wheel_count,
            "window_switch_count": input_activity.window_switch_count,
        }

    def _finalize_screenshot(
        self,
        *,
        screenshot: Screenshot,
        image_uri: str,
        thumb_uri: str,
        phash: str | None,
        image_bytes: bytes | None = None,
    ) -> None:
        screenshot.image_uri = image_uri
        screenshot.thumb_uri = thumb_uri
        screenshot.phash = phash
        screenshot.upload_status = "completed"
        screenshot.analysis_status = "pending"
        screenshot.updated_at = utc_now()
        self.session.add(screenshot)
        self.session.commit()
        self.session.refresh(screenshot)

        analysis_service = ScreenshotAnalysisService(self.session, self.settings)
        try:
            analysis_service.analyze_completed_screenshot(
                screenshot=screenshot,
                image_bytes=image_bytes,
            )
        except Exception as exc:
            analysis_service.mark_analysis_failed(screenshot, str(exc))
            self.session.refresh(screenshot)

    def heartbeat(self, payload: HeartbeatRequest) -> HeartbeatResponse:
        device = self.session.get(Device, payload.device_id)
        now = utc_now()

        if device is None:
            device = Device(
                id=payload.device_id,
                employee_id=payload.employee_id,
                hostname=payload.hostname,
                os_type=payload.os_type,
                agent_version=payload.agent_version,
                screen_count=payload.screen_count,
                last_heartbeat_at=now,
                last_foreground_window_json=self._safe_foreground_window(payload.foreground_window),
                last_session_state_json=self._safe_session_state(payload.session_state),
                last_input_activity_json=self._safe_input_activity(payload.input_activity),
                status=payload.status,
            )
            self.session.add(device)
        else:
            if payload.employee_id is not None:
                device.employee_id = payload.employee_id
            device.hostname = payload.hostname
            device.os_type = payload.os_type
            device.agent_version = payload.agent_version
            device.screen_count = payload.screen_count
            device.status = payload.status
            device.last_heartbeat_at = now
            if payload.foreground_window is not None:
                device.last_foreground_window_json = self._safe_foreground_window(payload.foreground_window)
            if payload.session_state is not None:
                device.last_session_state_json = self._safe_session_state(payload.session_state)
            if payload.input_activity is not None:
                device.last_input_activity_json = self._safe_input_activity(payload.input_activity)
            device.updated_at = now
            self.session.add(device)

        self.session.commit()
        policy = self.policies.resolve_policy_for_device(payload.device_id)
        return HeartbeatResponse(server_time=now, policy=PolicyResponse.model_validate(policy))

    def create_screenshot(self, payload: ScreenshotMetadataRequest) -> ScreenshotMetadataResponse:
        device = self._get_bound_device(payload.device_id)
        screenshot = self._new_screenshot(payload, device)
        self.session.add(screenshot)
        self.session.commit()
        self.session.refresh(screenshot)

        # TODO: Replace this DB-only handoff with presigned object storage upload + async queue dispatch.
        return ScreenshotMetadataResponse(screenshot_id=screenshot.id, upload_status=screenshot.upload_status)

    def upload_screenshot(
        self,
        *,
        payload: ScreenshotMetadataRequest,
        filename: str | None,
        content_type: str | None,
        image_bytes: bytes,
        phash: str | None = None,
    ) -> ScreenshotUploadResponse:
        device = self._get_bound_device(payload.device_id)
        screenshot = self._new_screenshot(payload, device)
        self.session.add(screenshot)
        self.session.commit()
        self.session.refresh(screenshot)

        try:
            stored = self.storage.save(
                screenshot_id=screenshot.id,
                employee_id=screenshot.employee_id,
                device_id=screenshot.device_id,
                captured_at=screenshot.captured_at,
                filename=filename,
                content_type=content_type,
                image_bytes=image_bytes,
            )
        except Exception:
            screenshot.upload_status = "failed"
            screenshot.updated_at = utc_now()
            self.session.add(screenshot)
            self.session.commit()
            raise

        self._finalize_screenshot(
            screenshot=screenshot,
            image_uri=stored.image_uri,
            thumb_uri=stored.thumb_uri,
            phash=phash,
            image_bytes=image_bytes,
        )

        return ScreenshotUploadResponse(
            screenshot_id=screenshot.id,
            upload_status=screenshot.upload_status,
            image_uri=screenshot.image_uri,
            thumb_uri=screenshot.thumb_uri,
        )

    def complete_screenshot(
        self,
        screenshot_id: str,
        payload: ScreenshotCompleteRequest,
    ) -> ScreenshotCompleteResponse:
        screenshot = self.session.get(Screenshot, UUID(screenshot_id))
        if screenshot is None:
            raise ValueError("Screenshot not found")

        self._finalize_screenshot(
            screenshot=screenshot,
            image_uri=payload.image_uri,
            thumb_uri=payload.thumb_uri,
            phash=payload.phash,
        )
        return ScreenshotCompleteResponse(screenshot_id=screenshot.id, upload_status=screenshot.upload_status)
