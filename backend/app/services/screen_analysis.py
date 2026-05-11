from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from typing import Any

from sqlalchemy import desc
from sqlmodel import Session, select

from app.core.config import Settings
from app.models import BehaviorEvent, Policy, ScreenDiff, Screenshot

try:
    from PIL import Image, ImageChops, ImageOps, ImageStat
except ImportError:  # pragma: no cover - exercised via fallback behavior
    Image = None
    ImageChops = None
    ImageOps = None
    ImageStat = None


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


@dataclass(frozen=True)
class DiffMetrics:
    hash_distance: float | None
    ssim_score: float | None
    changed_block_ratio: float | None
    ignored_region_ratio: float
    change_level: str
    is_effective_change: bool
    reason: str


class ScreenshotAnalysisService:
    event_type = "no_change_streak_triggered"

    def __init__(self, session: Session, settings: Settings):
        self.session = session
        self.settings = settings
        self.backend_root = Path(__file__).resolve().parents[2]
        self.storage_root = Path(settings.storage_root_dir)
        if not self.storage_root.is_absolute():
            self.storage_root = self.backend_root / self.storage_root

    def analyze_completed_screenshot(
        self,
        *,
        screenshot: Screenshot,
        image_bytes: bytes | None = None,
    ) -> ScreenDiff:
        previous = self._get_previous_completed_screenshot(screenshot)
        metrics = self._build_metrics(
            current=screenshot,
            previous=previous,
            current_image_bytes=image_bytes,
        )

        diff = self.session.exec(
            select(ScreenDiff).where(ScreenDiff.current_screenshot_id == screenshot.id)
        ).first()
        if diff is None:
            diff = ScreenDiff(
                employee_id=screenshot.employee_id,
                device_id=screenshot.device_id,
                current_screenshot_id=screenshot.id,
            )

        diff.previous_screenshot_id = previous.id if previous is not None else None
        diff.hash_distance = metrics.hash_distance
        diff.ssim_score = metrics.ssim_score
        diff.changed_block_ratio = metrics.changed_block_ratio
        diff.ignored_region_ratio = metrics.ignored_region_ratio
        diff.change_level = metrics.change_level
        diff.is_effective_change = metrics.is_effective_change
        diff.reason = metrics.reason
        self.session.add(diff)

        screenshot.analysis_status = "completed"
        screenshot.updated_at = utc_now()
        self.session.add(screenshot)
        self.session.commit()
        self.session.refresh(diff)
        self.session.refresh(screenshot)

        self._apply_no_change_state_machine(screenshot=screenshot, diff=diff)
        self.session.refresh(diff)
        return diff

    def mark_analysis_failed(self, screenshot: Screenshot, reason: str) -> None:
        screenshot.analysis_status = "failed"
        screenshot.updated_at = utc_now()
        self.session.add(screenshot)
        self.session.commit()

    def _get_previous_completed_screenshot(self, screenshot: Screenshot) -> Screenshot | None:
        statement = (
            select(Screenshot)
            .where(Screenshot.device_id == screenshot.device_id)
            .where(Screenshot.screen_index == screenshot.screen_index)
            .where(Screenshot.upload_status == "completed")
            .where(Screenshot.id != screenshot.id)
            .where(Screenshot.captured_at <= screenshot.captured_at)
            .order_by(desc(Screenshot.captured_at), desc(Screenshot.created_at))
        )
        return self.session.exec(statement).first()

    def _build_metrics(
        self,
        *,
        current: Screenshot,
        previous: Screenshot | None,
        current_image_bytes: bytes | None,
    ) -> DiffMetrics:
        if previous is None:
            return DiffMetrics(
                hash_distance=None,
                ssim_score=None,
                changed_block_ratio=None,
                ignored_region_ratio=0.0,
                change_level="unknown",
                is_effective_change=False,
                reason="No previous completed screenshot on this device screen.",
            )

        hash_distance = self._hash_distance(previous.phash, current.phash)
        pixel_metrics = self._pixel_metrics(
            current_image_bytes=current_image_bytes,
            current_image_uri=current.image_uri,
            previous_image_uri=previous.image_uri,
        )

        if pixel_metrics is None and hash_distance is None:
            return DiffMetrics(
                hash_distance=None,
                ssim_score=None,
                changed_block_ratio=None,
                ignored_region_ratio=0.0,
                change_level="unknown",
                is_effective_change=False,
                reason="Unable to compare screenshots because no diff inputs were available.",
            )

        ssim_score = pixel_metrics["ssim_score"] if pixel_metrics is not None else None
        changed_block_ratio = (
            pixel_metrics["changed_block_ratio"] if pixel_metrics is not None else None
        )
        change_level = self._classify_change_level(
            hash_distance=hash_distance,
            ssim_score=ssim_score,
            changed_block_ratio=changed_block_ratio,
        )
        is_effective_change = self._is_effective_change(
            change_level=change_level,
            hash_distance=hash_distance,
            ssim_score=ssim_score,
            changed_block_ratio=changed_block_ratio,
        )

        if change_level == "unknown":
            reason = "Insufficient image signal; fallback hash comparison was inconclusive."
        elif is_effective_change:
            reason = (
                "Effective visual change detected "
                f"(hash_distance={self._fmt(hash_distance)}, similarity={self._fmt(ssim_score)}, "
                f"changed_block_ratio={self._fmt(changed_block_ratio)})."
            )
        else:
            reason = (
                "Frame stayed effectively unchanged "
                f"(hash_distance={self._fmt(hash_distance)}, similarity={self._fmt(ssim_score)}, "
                f"changed_block_ratio={self._fmt(changed_block_ratio)})."
            )

        return DiffMetrics(
            hash_distance=hash_distance,
            ssim_score=ssim_score,
            changed_block_ratio=changed_block_ratio,
            ignored_region_ratio=0.0,
            change_level=change_level,
            is_effective_change=is_effective_change,
            reason=reason,
        )

    def _pixel_metrics(
        self,
        *,
        current_image_bytes: bytes | None,
        current_image_uri: str | None,
        previous_image_uri: str | None,
    ) -> dict[str, float] | None:
        if Image is None or ImageChops is None or ImageOps is None or ImageStat is None:
            return None

        current_bytes = current_image_bytes or self._read_image_bytes(current_image_uri)
        previous_bytes = self._read_image_bytes(previous_image_uri)
        if current_bytes is None or previous_bytes is None:
            return None

        try:
            with Image.open(BytesIO(previous_bytes)) as previous_image, Image.open(
                BytesIO(current_bytes)
            ) as current_image:
                previous_gray = self._normalize_image(previous_image)
                current_gray = self._normalize_image(current_image)
                difference = ImageChops.difference(previous_gray, current_gray)
                histogram = difference.histogram()
        except Exception:
            return None

        total_pixels = previous_gray.width * previous_gray.height
        if total_pixels <= 0:
            return None

        mse = sum(count * (index**2) for index, count in enumerate(histogram)) / total_pixels
        ssim_score = max(0.0, 1.0 - (mse / (255.0**2)))
        changed_block_ratio = self._changed_block_ratio(difference)
        return {
            "ssim_score": round(ssim_score, 6),
            "changed_block_ratio": round(changed_block_ratio, 6),
        }

    def _normalize_image(self, image: Any):
        normalized = ImageOps.exif_transpose(image)
        return normalized.convert("L").resize((64, 64))

    def _changed_block_ratio(self, difference: Any) -> float:
        blocks_per_side = 8
        block_width = difference.width // blocks_per_side
        block_height = difference.height // blocks_per_side
        if block_width <= 0 or block_height <= 0:
            return 0.0

        changed_blocks = 0
        total_blocks = blocks_per_side * blocks_per_side
        for row in range(blocks_per_side):
            for column in range(blocks_per_side):
                box = (
                    column * block_width,
                    row * block_height,
                    (column + 1) * block_width,
                    (row + 1) * block_height,
                )
                block = difference.crop(box)
                mean_delta = ImageStat.Stat(block).mean[0]
                if mean_delta >= 12:
                    changed_blocks += 1
        return changed_blocks / total_blocks

    def _hash_distance(self, previous_hash: str | None, current_hash: str | None) -> float | None:
        if not previous_hash or not current_hash:
            return None

        left = previous_hash.strip().lower()
        right = current_hash.strip().lower()
        if not left or not right:
            return None

        if self._is_hex_hash(left) and self._is_hex_hash(right) and len(left) == len(right):
            bit_width = len(left) * 4
            left_bits = format(int(left, 16), f"0{bit_width}b")
            right_bits = format(int(right, 16), f"0{bit_width}b")
            return float(sum(left_bit != right_bit for left_bit, right_bit in zip(left_bits, right_bits)))

        max_len = max(len(left), len(right))
        padded_left = left.ljust(max_len)
        padded_right = right.ljust(max_len)
        return float(sum(left_char != right_char for left_char, right_char in zip(padded_left, padded_right)))

    def _is_hex_hash(self, value: str) -> bool:
        return all(character in "0123456789abcdef" for character in value)

    def _classify_change_level(
        self,
        *,
        hash_distance: float | None,
        ssim_score: float | None,
        changed_block_ratio: float | None,
    ) -> str:
        if hash_distance is None and ssim_score is None and changed_block_ratio is None:
            return "unknown"

        if (
            (hash_distance is None or hash_distance <= 2)
            and (ssim_score is None or ssim_score >= 0.995)
            and (changed_block_ratio is None or changed_block_ratio < 0.03)
        ):
            return "none"

        if (
            (hash_distance is not None and hash_distance >= 12)
            or (ssim_score is not None and ssim_score < 0.92)
            or (changed_block_ratio is not None and changed_block_ratio >= 0.2)
        ):
            return "major"

        return "minor"

    def _is_effective_change(
        self,
        *,
        change_level: str,
        hash_distance: float | None,
        ssim_score: float | None,
        changed_block_ratio: float | None,
    ) -> bool:
        if change_level == "major":
            return True
        if change_level == "unknown":
            return False

        signals = 0
        if hash_distance is not None and hash_distance >= 10:
            signals += 1
        if ssim_score is not None and ssim_score < 0.94:
            signals += 1
        if changed_block_ratio is not None and changed_block_ratio >= 0.12:
            signals += 1
        return signals >= 2

    def _apply_no_change_state_machine(self, *, screenshot: Screenshot, diff: ScreenDiff) -> None:
        policy = self._get_active_policy()
        open_event = self._get_open_no_change_event(
            device_id=screenshot.device_id,
            screen_index=screenshot.screen_index,
        )

        if diff.is_effective_change:
            if open_event is not None:
                open_event.end_at = screenshot.captured_at
                open_event.duration_seconds = max(
                    0,
                    int((self._ensure_utc(screenshot.captured_at) - self._ensure_utc(open_event.start_at)).total_seconds()),
                )
                open_event.related_screenshot_id = screenshot.id
                open_event.related_diff_id = diff.id
                open_event.status = "closed"
                open_event.reason = (
                    f"Closed after effective change on screen {screenshot.screen_index}."
                )
                details = dict(open_event.details_json)
                details["closed_by_screenshot_id"] = str(screenshot.id)
                details["closed_by_diff_id"] = str(diff.id)
                details["closed_change_level"] = diff.change_level
                open_event.details_json = details
                open_event.updated_at = utc_now()
                self.session.add(open_event)
                self.session.commit()
            return

        if diff.change_level == "unknown" or diff.previous_screenshot_id is None:
            return

        streak_count, streak_start_at = self._no_change_streak(screenshot)
        if streak_count < policy.no_change_threshold:
            return

        details = {
            "screen_index": screenshot.screen_index,
            "threshold": policy.no_change_threshold,
            "change_level": diff.change_level,
            "hash_distance": diff.hash_distance,
            "ssim_score": diff.ssim_score,
            "changed_block_ratio": diff.changed_block_ratio,
        }
        reason = (
            f"No effective screen change for {streak_count} consecutive captures on "
            f"screen {screenshot.screen_index}."
        )
        severity = "high" if streak_count >= policy.no_change_threshold * 2 else "medium"

        if open_event is None:
            open_event = BehaviorEvent(
                employee_id=screenshot.employee_id,
                device_id=screenshot.device_id,
                event_type=self.event_type,
                severity=severity,
                start_at=streak_start_at,
                related_screenshot_id=screenshot.id,
                related_diff_id=diff.id,
                streak_count=streak_count,
                status="open",
                reason=reason,
                details_json=details,
            )
        else:
            open_event.severity = severity
            open_event.related_screenshot_id = screenshot.id
            open_event.related_diff_id = diff.id
            open_event.streak_count = streak_count
            open_event.reason = reason
            open_event.details_json = details
            open_event.updated_at = utc_now()
            open_event.duration_seconds = max(
                0,
                int((self._ensure_utc(screenshot.captured_at) - self._ensure_utc(open_event.start_at)).total_seconds()),
            )

        self.session.add(open_event)
        self.session.commit()

    def _get_active_policy(self) -> Policy:
        statement = select(Policy).where(Policy.is_active.is_(True)).order_by(desc(Policy.created_at))
        policy = self.session.exec(statement).first()
        if policy is None:
            raise ValueError("Active policy not found")
        return policy

    def _get_open_no_change_event(self, *, device_id, screen_index: int) -> BehaviorEvent | None:
        statement = (
            select(BehaviorEvent)
            .where(BehaviorEvent.device_id == device_id)
            .where(BehaviorEvent.event_type == self.event_type)
            .where(BehaviorEvent.status == "open")
            .order_by(desc(BehaviorEvent.start_at))
        )
        for event in self.session.exec(statement).all():
            event_screen_index = event.details_json.get("screen_index")
            if event_screen_index == screen_index:
                return event
            if event_screen_index is None and event.related_screenshot_id is not None:
                related_screenshot = self.session.get(Screenshot, event.related_screenshot_id)
                if related_screenshot is not None and related_screenshot.screen_index == screen_index:
                    return event
        return None

    def _no_change_streak(self, screenshot: Screenshot) -> tuple[int, datetime]:
        screenshots = self.session.exec(
            select(Screenshot)
            .where(Screenshot.device_id == screenshot.device_id)
            .where(Screenshot.screen_index == screenshot.screen_index)
            .where(Screenshot.upload_status == "completed")
            .where(Screenshot.captured_at <= screenshot.captured_at)
            .order_by(desc(Screenshot.captured_at), desc(Screenshot.created_at))
        ).all()
        screenshot_ids = [item.id for item in screenshots]
        diff_map = {
            diff.current_screenshot_id: diff
            for diff in self.session.exec(
                select(ScreenDiff).where(ScreenDiff.current_screenshot_id.in_(screenshot_ids))
            ).all()
        }

        streak_count = 0
        streak_start_at = screenshot.captured_at
        for item in screenshots:
            diff = diff_map.get(item.id)
            if diff is None or diff.previous_screenshot_id is None:
                break
            if diff.change_level == "unknown" or diff.is_effective_change:
                break
            streak_count += 1
            streak_start_at = item.captured_at
        return streak_count, streak_start_at

    def _read_image_bytes(self, image_uri: str | None) -> bytes | None:
        path = self._resolve_image_path(image_uri)
        if path is None or not path.exists() or not path.is_file():
            return None
        try:
            return path.read_bytes()
        except OSError:
            return None

    def _resolve_image_path(self, image_uri: str | None) -> Path | None:
        if not image_uri:
            return None
        path = Path(image_uri)
        if path.is_absolute():
            return path
        return self.storage_root.parent / path

    def _ensure_utc(self, value: datetime) -> datetime:
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)

    def _fmt(self, value: float | None) -> str:
        if value is None:
            return "n/a"
        return f"{value:.4f}"
