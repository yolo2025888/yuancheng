from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from sqlmodel import Session, select

from app.core.config import Settings, get_settings
from app.models import Device, Policy, Screenshot
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
from app.services.storage import LocalScreenshotStorage


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class AgentService:
    def __init__(self, session: Session, settings: Settings | None = None):
        self.session = session
        self.settings = settings or get_settings()
        self.storage = LocalScreenshotStorage(self.settings)

    def ensure_default_policy(self) -> Policy:
        statement = select(Policy).where(Policy.is_active.is_(True)).order_by(Policy.created_at.desc())
        policy = self.session.exec(statement).first()
        if policy is not None:
            return policy

        policy = Policy(
            name=self.settings.default_policy_name,
            version=self.settings.default_policy_version,
            screenshot_interval_seconds=self.settings.default_screenshot_interval_seconds,
            no_change_threshold=self.settings.default_no_change_threshold,
            retention_days=self.settings.default_retention_days,
        )
        self.session.add(policy)
        self.session.commit()
        self.session.refresh(policy)
        return policy

    def get_policy(self, device_id: str | None = None) -> PolicyResponse:
        del device_id
        policy = self.ensure_default_policy()
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
            is_locked=payload.is_locked,
            is_remote_session=payload.is_remote_session,
            upload_status="pending",
            ocr_status="pending",
            analysis_status="pending",
        )

    def heartbeat(self, payload: HeartbeatRequest) -> HeartbeatResponse:
        policy = self.ensure_default_policy()
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
            device.updated_at = now
            self.session.add(device)

        self.session.commit()
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

        screenshot.image_uri = stored.image_uri
        screenshot.thumb_uri = stored.thumb_uri
        screenshot.phash = phash
        screenshot.upload_status = "completed"
        screenshot.updated_at = utc_now()
        self.session.add(screenshot)
        self.session.commit()
        self.session.refresh(screenshot)

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

        screenshot.image_uri = payload.image_uri
        screenshot.thumb_uri = payload.thumb_uri
        screenshot.phash = payload.phash
        screenshot.upload_status = "completed"
        screenshot.updated_at = utc_now()
        self.session.add(screenshot)
        self.session.commit()
        self.session.refresh(screenshot)
        return ScreenshotCompleteResponse(screenshot_id=screenshot.id, upload_status=screenshot.upload_status)
