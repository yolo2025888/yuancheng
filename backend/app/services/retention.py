from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import UUID, uuid4

from sqlalchemy import or_
from sqlmodel import Session, select

from app.core.config import Settings
from app.models import Policy, Screenshot
from app.services.audit import AuditContext, AuditService
from app.services.storage import LocalScreenshotStorage


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
            .where(Screenshot.captured_at < cutoff_at)
            .where(or_(Screenshot.image_uri.is_not(None), Screenshot.thumb_uri.is_not(None)))
            .order_by(Screenshot.captured_at.asc())
        ).all()

        files_deleted = 0
        files_missing = 0
        files_failed = 0
        records_updated = 0
        records_failed = 0
        for screenshot in screenshots:
            image_result = self._delete_stored_uri(screenshot.image_uri)
            thumb_result = self._delete_stored_uri(screenshot.thumb_uri)
            results = (image_result, thumb_result)

            files_deleted += sum(1 for result in results if result.deleted)
            files_missing += sum(1 for result in results if result.missing)
            file_failure_count = sum(1 for result in results if result.error is not None)
            files_failed += file_failure_count

            if image_result.handled:
                screenshot.image_uri = None
            if thumb_result.handled:
                screenshot.thumb_uri = None

            if image_result.handled or thumb_result.handled:
                screenshot.updated_at = effective_now
                self.session.add(screenshot)
                records_updated += 1

            if file_failure_count > 0:
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

    def _delete_stored_uri(self, uri: str | None) -> "_DeleteStoredUriResult":
        if not uri:
            return _DeleteStoredUriResult(handled=False)

        path = self.storage.resolve_stored_uri(uri)
        if path is None:
            return _DeleteStoredUriResult(handled=True, missing=True)

        try:
            path.unlink()
        except OSError as exc:
            return _DeleteStoredUriResult(handled=False, error=f"{type(exc).__name__}: {exc}")

        return _DeleteStoredUriResult(handled=True, deleted=True, path=path)

    def _effective_retention_days(self) -> int:
        active_retention_days = self.session.exec(
            select(Policy.retention_days).where(Policy.is_active.is_(True))
        ).all()
        if not active_retention_days:
            return self.settings.default_retention_days
        return min(int(days) for days in active_retention_days)


@dataclass(frozen=True)
class _DeleteStoredUriResult:
    handled: bool
    deleted: bool = False
    missing: bool = False
    path: Path | None = None
    error: str | None = None
