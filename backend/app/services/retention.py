from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

from sqlalchemy import and_, or_
from sqlmodel import Session, select

from app.core.config import Settings
from app.models import Policy, Screenshot
from app.services.audit import AuditContext, AuditService
from app.services.storage import LocalScreenshotStorage, StoredUriDeleteResult


@dataclass(frozen=True)
class ScreenshotRetentionCleanupResult:
    job_id: UUID
    retention_days: int
    cutoff_at: datetime
    expired_count: int
    records_updated: int
    records_failed: int
    files_deleted: int
    files_missing: int
    files_failed: int


class ScreenshotRetentionService:
    def __init__(self, session: Session, settings: Settings):
        self.session = session
        self.settings = settings
        self.storage = LocalScreenshotStorage(settings)
        self.audit = AuditService(session)

    def cleanup_expired_screenshot_files(
        self,
        *,
        audit_context: AuditContext,
        now: datetime | None = None,
    ) -> ScreenshotRetentionCleanupResult:
        job_id = uuid4()
        retention_days = self._effective_retention_days()
        effective_now = now or datetime.now(timezone.utc)
        cutoff_at = effective_now - timedelta(days=retention_days)

        screenshots = self.session.exec(
            select(Screenshot)
            .where(
                or_(
                    Screenshot.retain_until < effective_now,
                    and_(Screenshot.retain_until.is_(None), Screenshot.captured_at < cutoff_at),
                )
            )
            .where(or_(Screenshot.image_uri.is_not(None), Screenshot.thumb_uri.is_not(None)))
            .where(Screenshot.file_retention_status == "full")
            .order_by(Screenshot.captured_at.asc())
        ).all()

        files_deleted = 0
        files_missing = 0
        files_failed = 0
        records_updated = 0
        records_failed = 0
        for screenshot in screenshots:
            original_image_uri = screenshot.image_uri
            original_thumb_uri = screenshot.thumb_uri
            image_result = self.storage.delete(screenshot.image_uri)
            thumb_result = self.storage.delete(screenshot.thumb_uri)
            results = (image_result, thumb_result)

            files_deleted += sum(1 for result in results if result.deleted)
            files_missing += sum(1 for result in results if result.missing)
            file_failure_count = sum(1 for result in results if result.error is not None)
            files_failed += file_failure_count

            if image_result.handled:
                screenshot.image_uri = None
                if original_image_uri is not None:
                    screenshot.image_deleted_at = effective_now
            if thumb_result.handled:
                screenshot.thumb_uri = None
                if original_thumb_uri is not None:
                    screenshot.thumb_deleted_at = effective_now

            if image_result.handled or thumb_result.handled:
                screenshot.file_retention_status = "metadata_only"
                screenshot.updated_at = effective_now
                self.session.add(screenshot)
                records_updated += 1

            if file_failure_count > 0:
                screenshot.file_retention_status = "delete_failed"
                screenshot.updated_at = effective_now
                self.session.add(screenshot)
                records_failed += 1

            action = "screenshot.retention.failed" if file_failure_count > 0 else "screenshot.retention.deleted"
            self.audit.log(
                action=action,
                target_type="screenshot",
                target_id=screenshot.id,
                reason=(
                    f"job_id={job_id}; retention_days={retention_days}; "
                    f"cutoff_at={cutoff_at.isoformat()}; files_deleted="
                    f"{sum(1 for result in results if result.deleted)}; files_missing="
                    f"{sum(1 for result in results if result.missing)}; files_failed={file_failure_count}"
                ),
                context=audit_context,
            )
            self.session.commit()

        result = ScreenshotRetentionCleanupResult(
            job_id=job_id,
            retention_days=retention_days,
            cutoff_at=cutoff_at,
            expired_count=len(screenshots),
            records_updated=records_updated,
            records_failed=records_failed,
            files_deleted=files_deleted,
            files_missing=files_missing,
            files_failed=files_failed,
        )

        self.audit.log(
            action="screenshots.retention.cleaned",
            target_type="screenshot_retention",
            target_id=None,
            reason=(
                f"job_id={result.job_id}; "
                f"Cleaned {result.records_updated} screenshot record(s) older than "
                f"{result.retention_days} day(s); files_deleted={result.files_deleted}; "
                f"files_missing={result.files_missing}; files_failed={result.files_failed}; "
                f"records_failed={result.records_failed}"
            ),
            context=audit_context,
        )
        self.session.commit()

        return result

    def _effective_retention_days(self) -> int:
        active_retention_days = self.session.exec(
            select(Policy.retention_days).where(Policy.is_active.is_(True))
        ).all()
        if not active_retention_days:
            return self.settings.default_retention_days
        return min(int(days) for days in active_retention_days)
