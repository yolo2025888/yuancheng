from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from io import BytesIO
import logging
from pathlib import Path
from typing import Any

from sqlalchemy import desc
from sqlmodel import Session, select

from app.core.config import Settings
from app.models import BehaviorEvent, Policy, ScreenDiff, Screenshot
from app.services.ai_analysis import AIAnalysisService, apply_ai_analysis_result
from app.services.policies import PolicyService
from app.services.storage import LocalScreenshotStorage

try:
    from PIL import Image, ImageChops, ImageOps, ImageStat
except ImportError:  # pragma: no cover - exercised via fallback behavior
    Image = None
    ImageChops = None
    ImageOps = None
    ImageStat = None


logger = logging.getLogger(__name__)


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


@dataclass(frozen=True)
class ActivityClassification:
    activity_type: str
    active_app: str | None
    confidence: float
    summary: str
    evidence: dict[str, Any]


PROCESS_ALIASES = {
    "arc": "arc",
    "bash": "bash",
    "brave": "brave",
    "chrome": "chrome",
    "cmd": "cmd",
    "code": "vscode",
    "confluence": "confluence",
    "cursor": "cursor",
    "discord": "discord",
    "excel": "excel",
    "firefox": "firefox",
    "goland": "goland",
    "idea": "intellij",
    "intellijidea": "intellij",
    "msedge": "edge",
    "notion": "notion",
    "onenote": "onenote",
    "outlook": "outlook",
    "pdf": "pdf",
    "powerpnt": "powerpoint",
    "powershell": "powershell",
    "pycharm": "pycharm",
    "safari": "safari",
    "slack": "slack",
    "teams": "teams",
    "terminal": "terminal",
    "webex": "webex",
    "winword": "word",
    "zoom": "zoom",
}

SAFE_TITLE_TOKENS = (
    ("pull request", "pull_request"),
    ("merge request", "merge_request"),
    ("visual studio code", "vscode"),
    ("visual studio", "visualstudio"),
    ("google docs", "docs"),
    ("github", "github"),
    ("gitlab", "gitlab"),
    ("bitbucket", "bitbucket"),
    ("repository", "repo"),
    ("review", "review"),
    ("diff", "diff"),
    ("cursor", "cursor"),
    ("vscode", "vscode"),
    ("terminal", "terminal"),
    ("powershell", "powershell"),
    ("meeting", "meeting"),
    ("teams", "teams"),
    ("zoom", "zoom"),
    ("webex", "webex"),
    ("notion", "notion"),
    ("confluence", "confluence"),
    ("docs", "docs"),
    ("document", "document"),
    ("spreadsheet", "spreadsheet"),
    ("slides", "slides"),
    ("wiki", "wiki"),
    ("readme", "readme"),
    ("word", "word"),
    ("excel", "excel"),
    ("powerpoint", "powerpoint"),
    ("pdf", "pdf"),
    ("editor", "editor"),
)

DEVELOPMENT_APPS = {"bash", "cmd", "cursor", "goland", "intellij", "powershell", "pycharm", "terminal", "vscode"}
DEVELOPMENT_TOKENS = {"cursor", "editor", "powershell", "terminal", "vscode"}
MEETING_APPS = {"discord", "slack", "teams", "webex", "zoom"}
MEETING_TOKENS = {"meeting", "teams", "webex", "zoom"}
DOCUMENTATION_APPS = {"confluence", "docs", "excel", "notion", "onenote", "outlook", "pdf", "powerpoint", "word"}
DOCUMENTATION_TOKENS = {"confluence", "docs", "document", "notion", "pdf", "powerpoint", "readme", "slides", "spreadsheet", "wiki", "word", "excel"}
BROWSER_APPS = {"arc", "brave", "chrome", "edge", "firefox", "safari"}
CODE_REVIEW_TOKENS = {"bitbucket", "diff", "github", "gitlab", "merge_request", "pull_request", "repo", "review"}
IDLE_THRESHOLD_SECONDS = 300


def classify_screenshot_activity(
    *,
    screenshot: Screenshot,
    change_level: str | None,
    is_effective_change: bool | None,
) -> ActivityClassification:
    process_label = _normalize_process_name(screenshot.foreground_process)
    title_tokens = _extract_safe_title_tokens(screenshot.window_title)
    session_mode = _session_mode(screenshot)
    idle_bucket = _idle_bucket(screenshot.idle_seconds)
    evidence: dict[str, Any] = {
        "classifier": "metadata_v1",
        "matched_signals": [],
        "matched_keywords": sorted(title_tokens),
        "session_mode": session_mode,
        "idle_bucket": idle_bucket,
        "change_level": change_level or "unknown",
        "effective_change": bool(is_effective_change),
    }

    if process_label:
        evidence["matched_signals"].append(f"process:{process_label}")
    for token in sorted(title_tokens):
        evidence["matched_signals"].append(f"title:{token}")
    if not is_effective_change and (change_level or "unknown") in {"minor", "none"}:
        evidence["risk_hint"] = "steady_screen"

    if _is_locked_session(screenshot):
        return _finalize_activity(
            activity_type="locked",
            active_app="lock_screen",
            process_label=process_label,
            title_tokens=title_tokens,
            session_mode=session_mode,
            change_level=change_level,
            evidence=evidence,
        )

    if _is_idle_session(screenshot):
        return _finalize_activity(
            activity_type="idle",
            active_app=process_label,
            process_label=process_label,
            title_tokens=title_tokens,
            session_mode=session_mode,
            change_level=change_level,
            evidence=evidence,
        )

    if process_label in MEETING_APPS or title_tokens & MEETING_TOKENS:
        active_app = _preferred_app(process_label, title_tokens, MEETING_APPS | MEETING_TOKENS)
        return _finalize_activity(
            activity_type="meeting",
            active_app=active_app,
            process_label=process_label,
            title_tokens=title_tokens,
            session_mode=session_mode,
            change_level=change_level,
            evidence=evidence,
        )

    if process_label in DEVELOPMENT_APPS:
        return _finalize_activity(
            activity_type="development",
            active_app=process_label,
            process_label=process_label,
            title_tokens=title_tokens,
            session_mode=session_mode,
            change_level=change_level,
            evidence=evidence,
        )

    if process_label in DOCUMENTATION_APPS or title_tokens & DOCUMENTATION_TOKENS:
        active_app = _preferred_app(process_label, title_tokens, DOCUMENTATION_APPS | DOCUMENTATION_TOKENS)
        return _finalize_activity(
            activity_type="documentation",
            active_app=active_app,
            process_label=process_label,
            title_tokens=title_tokens,
            session_mode=session_mode,
            change_level=change_level,
            evidence=evidence,
        )

    if process_label in BROWSER_APPS or title_tokens & CODE_REVIEW_TOKENS:
        active_app = _preferred_browser_app(process_label, title_tokens)
        return _finalize_activity(
            activity_type="code_review_or_browser",
            active_app=active_app,
            process_label=process_label,
            title_tokens=title_tokens,
            session_mode=session_mode,
            change_level=change_level,
            evidence=evidence,
        )

    if title_tokens & DEVELOPMENT_TOKENS:
        active_app = _preferred_app(process_label, title_tokens, DEVELOPMENT_APPS | DEVELOPMENT_TOKENS)
        return _finalize_activity(
            activity_type="development",
            active_app=active_app,
            process_label=process_label,
            title_tokens=title_tokens,
            session_mode=session_mode,
            change_level=change_level,
            evidence=evidence,
        )

    return _finalize_activity(
        activity_type="unknown",
        active_app=process_label,
        process_label=process_label,
        title_tokens=title_tokens,
        session_mode=session_mode,
        change_level=change_level,
        evidence=evidence,
    )


def _normalize_process_name(process_name: str | None) -> str | None:
    if not process_name:
        return None
    normalized = process_name.replace("\\", "/").rsplit("/", maxsplit=1)[-1].strip().casefold()
    if normalized.endswith(".exe"):
        normalized = normalized[:-4]
    return PROCESS_ALIASES.get(normalized)


def _extract_safe_title_tokens(window_title: str | None) -> set[str]:
    if not window_title:
        return set()
    lowered = window_title.casefold()
    return {
        canonical
        for needle, canonical in SAFE_TITLE_TOKENS
        if needle in lowered
    }


def _session_mode(screenshot: Screenshot) -> str:
    if screenshot.is_locked:
        return "locked"
    if screenshot.is_rdp_session:
        return "remote_rdp"
    if screenshot.is_remote_session:
        return "remote"
    return "local"


def _idle_bucket(idle_seconds: int | None) -> str:
    if idle_seconds is None:
        return "unknown"
    if idle_seconds >= IDLE_THRESHOLD_SECONDS:
        return "high"
    if idle_seconds >= 60:
        return "medium"
    return "low"


def _is_locked_session(screenshot: Screenshot) -> bool:
    connect_state = (screenshot.session_connect_state or "").casefold()
    desktop_name = (screenshot.input_desktop_name or "").casefold()
    return (
        screenshot.is_locked
        or "lock" in connect_state
        or "winlogon" in desktop_name
        or "lock" in desktop_name
    )


def _is_idle_session(screenshot: Screenshot) -> bool:
    connect_state = (screenshot.session_connect_state or "").casefold()
    return bool(
        screenshot.idle_seconds is not None and screenshot.idle_seconds >= IDLE_THRESHOLD_SECONDS
    ) or connect_state in {"idle", "disconnected"}


def _preferred_app(process_label: str | None, title_tokens: set[str], candidates: set[str]) -> str | None:
    if process_label in candidates:
        return process_label
    for token in sorted(title_tokens):
        if token in candidates:
            return token
    return process_label


def _preferred_browser_app(process_label: str | None, title_tokens: set[str]) -> str:
    for token in ("github", "gitlab", "bitbucket"):
        if token in title_tokens:
            return token
    return process_label if process_label in BROWSER_APPS else "browser"


def _finalize_activity(
    *,
    activity_type: str,
    active_app: str | None,
    process_label: str | None,
    title_tokens: set[str],
    session_mode: str,
    change_level: str | None,
    evidence: dict[str, Any],
) -> ActivityClassification:
    confidence = _activity_confidence(
        activity_type=activity_type,
        active_app=active_app,
        process_label=process_label,
        title_tokens=title_tokens,
    )
    return ActivityClassification(
        activity_type=activity_type,
        active_app=active_app,
        confidence=confidence,
        summary=_activity_summary(
            activity_type=activity_type,
            active_app=active_app,
            session_mode=session_mode,
            change_level=change_level,
        ),
        evidence=evidence,
    )


def _activity_confidence(
    *,
    activity_type: str,
    active_app: str | None,
    process_label: str | None,
    title_tokens: set[str],
) -> float:
    if activity_type == "locked":
        return 0.99
    if activity_type == "idle":
        return 0.93
    if activity_type == "unknown":
        return 0.4 if process_label or title_tokens else 0.25

    confidence = 0.58
    if process_label is not None:
        confidence += 0.18
    if title_tokens:
        confidence += 0.12
    if process_label is not None and title_tokens:
        confidence += 0.05
    if active_app is not None and active_app not in {"browser"}:
        confidence += 0.05
    return round(min(confidence, 0.97), 2)


def _activity_summary(
    *,
    activity_type: str,
    active_app: str | None,
    session_mode: str,
    change_level: str | None,
) -> str:
    change_descriptions = {
        "major": "major screen change",
        "minor": "minor screen change",
        "none": "stable screen",
        "unknown": "limited visual signal",
        None: "limited visual signal",
    }
    session_descriptions = {
        "locked": "locked",
        "remote_rdp": "remote RDP",
        "remote": "remote",
        "local": "local",
    }
    labels = {
        "development": "Development",
        "code_review_or_browser": "Browser/review",
        "meeting": "Meeting",
        "documentation": "Documentation",
        "idle": "Idle",
        "locked": "Locked",
        "unknown": "Unknown",
    }
    app_fragment = f" in {active_app}" if active_app else ""
    change_fragment = change_descriptions.get(change_level, "limited visual signal")
    session_fragment = session_descriptions.get(session_mode, "local")
    if activity_type == "locked":
        return f"Locked session with {change_fragment}."
    if activity_type == "idle":
        return f"Idle {session_fragment} session{app_fragment} with {change_fragment}."
    return f"{labels.get(activity_type, 'Unknown')} activity{app_fragment} during {session_fragment} session with {change_fragment}."


class ScreenshotAnalysisService:
    event_type = "no_change_streak_triggered"

    def __init__(self, session: Session, settings: Settings):
        self.session = session
        self.settings = settings
        self.ai_analysis = AIAnalysisService(settings, session)
        self.storage = LocalScreenshotStorage(settings)
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
        policy_service = PolicyService(self.session, self.settings)
        policy = policy_service.resolve_policy_for_device(screenshot.device_id)
        previous = self._get_previous_completed_screenshot(screenshot)
        metrics = self._build_metrics(
            current=screenshot,
            previous=previous,
            current_image_bytes=image_bytes,
        )
        activity = classify_screenshot_activity(
            screenshot=screenshot,
            change_level=metrics.change_level,
            is_effective_change=metrics.is_effective_change,
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

        screenshot.ocr_status = "skipped" if screenshot.ocr_status == "pending" else screenshot.ocr_status
        screenshot.analysis_status = "completed"
        screenshot.activity_type = activity.activity_type
        screenshot.active_app = activity.active_app
        screenshot.activity_confidence = activity.confidence
        screenshot.activity_summary = activity.summary
        screenshot.activity_evidence_json = dict(activity.evidence)
        screenshot.updated_at = utc_now()
        self.session.add(screenshot)
        self.session.commit()
        self.session.refresh(diff)
        self.session.refresh(screenshot)

        self._apply_no_change_state_machine(screenshot=screenshot, diff=diff)
        self.session.refresh(diff)
        self._apply_ai_analysis(
            screenshot=screenshot,
            previous=previous,
            diff=diff,
            activity=activity,
            current_image_bytes=image_bytes,
            policy=policy,
        )
        self.session.refresh(screenshot)
        self._apply_retention_lifecycle(
            screenshot=screenshot,
            previous=previous,
            policy=policy,
        )
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

    def _apply_ai_analysis(
        self,
        *,
        screenshot: Screenshot,
        previous: Screenshot | None,
        diff: ScreenDiff,
        activity: ActivityClassification,
        current_image_bytes: bytes | None,
        policy: Policy,
    ) -> None:
        ai_config = self.ai_analysis.resolve_config(policy.rules_json)

        if not ai_config.enabled:
            self._set_ai_analysis_state(
                screenshot=screenshot,
                status="skipped",
                details={"status": "skipped", "reason": "AI analysis is disabled."},
            )
            self._persist_ai_updates(screenshot)
            return

        if not (ai_config.base_url and ai_config.api_key and ai_config.model):
            self._set_ai_analysis_state(
                screenshot=screenshot,
                status="skipped",
                details={
                    "status": "skipped",
                    "reason": "AI analysis is enabled but not fully configured.",
                },
            )
            self._persist_ai_updates(screenshot)
            return

        current_visual = self._read_ai_visual_bytes(
            screenshot=screenshot,
            preferred_bytes=current_image_bytes,
        )
        if current_visual is None:
            self._set_ai_analysis_state(
                screenshot=screenshot,
                status="skipped",
                details={
                    "status": "skipped",
                    "reason": "Current screenshot bytes were unavailable for AI analysis.",
                },
            )
            self._persist_ai_updates(screenshot)
            return

        previous_visual = (
            self._read_ai_visual_bytes(screenshot=previous)
            if previous is not None and ai_config.use_previous_screenshot
            else None
        )
        safe_metadata = self._build_ai_safe_metadata(
            screenshot=screenshot,
            previous=previous,
            diff=diff,
            activity=activity,
        )
        try:
            result = self.ai_analysis.analyze(
                current_image_bytes=current_visual,
                previous_image_bytes=previous_visual,
                safe_metadata=safe_metadata,
                rules_json=policy.rules_json,
            )
        except Exception as exc:
            logger.warning("AI screenshot analysis failed for screenshot %s: %s", screenshot.id, exc)
            self._set_ai_analysis_state(
                screenshot=screenshot,
                status="failed",
                details={
                    "status": "failed",
                    "reason": str(exc),
                },
            )
            self._persist_ai_updates(screenshot)
            return

        self._set_ai_analysis_state(
            screenshot=screenshot,
            status="completed",
            details=result.to_payload(),
        )
        apply_ai_analysis_result(screenshot, result)
        self._persist_ai_updates(screenshot)
        self._apply_ai_risk_event(screenshot=screenshot, diff=diff, result=result, ai_config=ai_config)

    def _apply_retention_lifecycle(
        self,
        *,
        screenshot: Screenshot,
        previous: Screenshot | None,
        policy: Policy,
    ) -> None:
        settings = PolicyService(self.session, self.settings).get_screenshot_retention_settings(policy)
        decision, is_abnormal, reason, retain_until = self._decide_retention_classification(
            screenshot=screenshot,
            policy=policy,
            settings_enabled=settings.enabled,
            needs_review_retention_days=settings.needs_review_retention_days,
            high_risk_retention_days=settings.high_risk_retention_days,
            ai_failure_retention_days=settings.ai_failure_retention_days,
            skipped_analysis_retention_days=settings.skipped_analysis_retention_days,
            normal_mode=settings.normal_mode,
        )
        self._set_screenshot_retention_state(
            screenshot=screenshot,
            decision=decision,
            is_abnormal=is_abnormal,
            reason=reason,
            retain_until=retain_until,
        )

        if previous is None or not settings.enabled:
            return

        current_time = screenshot.captured_at
        if settings.normal_mode == "delete_on_next_cycle":
            self._discard_superseded_normal_screenshots(
                screenshot=screenshot,
                keep_latest_normal_cycles=settings.keep_latest_normal_cycles,
                deleted_at=current_time,
            )

        if previous.retain_until is not None and self._ensure_utc(previous.retain_until) <= self._ensure_utc(current_time):
            self._discard_screenshot_visuals(
                previous,
                deleted_at=current_time,
                reason="Screenshot visuals expired under retention policy.",
            )

    def _decide_retention_classification(
        self,
        *,
        screenshot: Screenshot,
        policy: Policy,
        settings_enabled: bool,
        needs_review_retention_days: int,
        high_risk_retention_days: int,
        ai_failure_retention_days: int,
        skipped_analysis_retention_days: int,
        normal_mode: str,
    ) -> tuple[str, bool, str, datetime | None]:
        related_events = self.session.exec(
            select(BehaviorEvent)
            .where(BehaviorEvent.related_screenshot_id == screenshot.id)
            .order_by(desc(BehaviorEvent.created_at))
        ).all()
        has_related_events = bool(related_events)
        has_high_risk_events = any(event.severity in {"high", "critical"} for event in related_events)
        ai_status = (screenshot.ai_analysis_status or "skipped").casefold()
        ai_risk_level = (screenshot.ai_risk_level or "").casefold()
        non_work_likelihood = screenshot.ai_non_work_likelihood or 0.0

        if ai_status == "completed":
            if ai_risk_level == "high" or non_work_likelihood >= 0.85 or has_high_risk_events:
                return (
                    "high_risk",
                    True,
                    "High-risk AI or related risk-event evidence requires screenshot retention.",
                    self._expire_at(screenshot.captured_at, high_risk_retention_days) if settings_enabled else self._expire_at(screenshot.captured_at, policy.retention_days),
                )
            if ai_risk_level == "medium" or non_work_likelihood >= 0.5 or has_related_events:
                return (
                    "needs_review",
                    True,
                    "Screenshot retained for manual review due to medium AI signal or linked events.",
                    self._expire_at(screenshot.captured_at, needs_review_retention_days) if settings_enabled else self._expire_at(screenshot.captured_at, policy.retention_days),
                )
            if settings_enabled and normal_mode == "keep_until_cleanup":
                return (
                    "normal",
                    False,
                    "Normal screenshot kept until cleanup by policy.",
                    self._expire_at(screenshot.captured_at, policy.retention_days),
                )
            return ("normal", False, "Normal screenshot will be discarded on the next analyzed capture.", None)

        if ai_status == "failed":
            return (
                "ai_failed",
                True,
                "AI analysis failed; retain screenshot for later review.",
                self._expire_at(screenshot.captured_at, ai_failure_retention_days) if settings_enabled else self._expire_at(screenshot.captured_at, policy.retention_days),
            )

        return (
            "skipped",
            False,
            "AI analysis skipped or unavailable; keep screenshot for bounded retention.",
            self._expire_at(screenshot.captured_at, skipped_analysis_retention_days) if settings_enabled else self._expire_at(screenshot.captured_at, policy.retention_days),
        )

    def _set_screenshot_retention_state(
        self,
        *,
        screenshot: Screenshot,
        decision: str,
        is_abnormal: bool,
        reason: str,
        retain_until: datetime | None,
    ) -> None:
        screenshot.retention_decision = decision
        screenshot.is_abnormal = is_abnormal
        screenshot.retention_reason = reason
        screenshot.retain_until = retain_until
        if screenshot.file_retention_status not in {"metadata_only", "deleted"}:
            screenshot.file_retention_status = "full"
        screenshot.updated_at = utc_now()
        self.session.add(screenshot)
        self.session.commit()
        self.session.refresh(screenshot)

    def _discard_superseded_normal_screenshots(
        self,
        *,
        screenshot: Screenshot,
        keep_latest_normal_cycles: int,
        deleted_at: datetime,
    ) -> None:
        previous_normals = self.session.exec(
            select(Screenshot)
            .where(Screenshot.device_id == screenshot.device_id)
            .where(Screenshot.screen_index == screenshot.screen_index)
            .where(Screenshot.id != screenshot.id)
            .where(Screenshot.captured_at < screenshot.captured_at)
            .where(Screenshot.retention_decision == "normal")
            .where(Screenshot.file_retention_status == "full")
            .order_by(desc(Screenshot.captured_at), desc(Screenshot.created_at))
        ).all()
        preserve_count = max(keep_latest_normal_cycles - 1, 0)
        for stale_screenshot in previous_normals[preserve_count:]:
            self._discard_screenshot_visuals(
                stale_screenshot,
                deleted_at=deleted_at,
                reason="Normal screenshot discarded after a newer capture completed analysis.",
            )

    def _discard_screenshot_visuals(
        self,
        screenshot: Screenshot,
        *,
        deleted_at: datetime,
        reason: str,
    ) -> None:
        image_result = self.storage.delete(screenshot.image_uri)
        thumb_result = self.storage.delete(screenshot.thumb_uri)
        if screenshot.image_uri:
            if image_result.handled:
                screenshot.image_uri = None
                screenshot.image_deleted_at = deleted_at
        if screenshot.thumb_uri:
            if thumb_result.handled:
                screenshot.thumb_uri = None
                screenshot.thumb_deleted_at = deleted_at
        if image_result.error or thumb_result.error:
            screenshot.file_retention_status = "delete_failed"
        else:
            screenshot.file_retention_status = "metadata_only"
        screenshot.retention_reason = reason
        screenshot.updated_at = utc_now()
        self.session.add(screenshot)
        self.session.commit()
        self.session.refresh(screenshot)

    def _expire_at(self, captured_at: datetime, retention_days: int) -> datetime:
        return self._ensure_utc(captured_at) + timedelta(days=retention_days)

    def _build_ai_safe_metadata(
        self,
        *,
        screenshot: Screenshot,
        previous: Screenshot | None,
        diff: ScreenDiff,
        activity: ActivityClassification,
    ) -> dict[str, Any]:
        return {
            "capture": {
                "screen_index": screenshot.screen_index,
                "width": screenshot.width,
                "height": screenshot.height,
                "has_previous_screenshot": previous is not None,
            },
            "diff": {
                "change_level": diff.change_level,
                "is_effective_change": diff.is_effective_change,
                "hash_distance": diff.hash_distance,
                "ssim_score": diff.ssim_score,
                "changed_block_ratio": diff.changed_block_ratio,
            },
            "activity": {
                "type": activity.activity_type,
                "active_app": activity.active_app,
                "confidence": activity.confidence,
                "summary": activity.summary,
                "evidence": activity.evidence,
            },
            "input_activity": {
                "keyboard_count": screenshot.keyboard_count,
                "mouse_click_count": screenshot.mouse_click_count,
                "mouse_move_count": screenshot.mouse_move_count,
                "mouse_wheel_count": screenshot.mouse_wheel_count,
                "window_switch_count": screenshot.window_switch_count,
            },
            "session": {
                "is_locked": screenshot.is_locked,
                "is_remote_session": screenshot.is_remote_session,
                "is_rdp_session": screenshot.is_rdp_session,
                "idle_seconds": screenshot.idle_seconds,
                "input_desktop_name": self._sanitize_session_label(screenshot.input_desktop_name),
                "session_connect_state": self._sanitize_session_label(screenshot.session_connect_state),
            },
        }

    def _sanitize_session_label(self, value: str | None) -> str | None:
        if not value:
            return None
        normalized = value.strip().casefold()
        if normalized in {"active", "default", "connected", "console", "disconnected", "idle", "winlogon"}:
            return normalized
        return "other"

    def _read_ai_visual_bytes(
        self,
        *,
        screenshot: Screenshot | None,
        preferred_bytes: bytes | None = None,
    ) -> bytes | None:
        if screenshot is None:
            return None
        thumb_bytes = self._read_image_bytes(screenshot.thumb_uri)
        if thumb_bytes is not None:
            return thumb_bytes
        if preferred_bytes is not None:
            return preferred_bytes
        return self._read_image_bytes(screenshot.image_uri)

    def _set_ai_analysis_state(
        self,
        *,
        screenshot: Screenshot,
        status: str,
        details: dict[str, Any],
    ) -> None:
        screenshot.ai_analysis_status = status
        screenshot.ai_details_json = details
        screenshot.ai_error = details.get("reason") if status == "failed" else None
        screenshot.ai_analyzed_at = utc_now()
        activity_evidence = dict(screenshot.activity_evidence_json or {})
        activity_evidence["ai_analysis"] = details
        screenshot.activity_evidence_json = activity_evidence

    def _apply_ai_risk_event(
        self,
        *,
        screenshot: Screenshot,
        diff: ScreenDiff,
        result,
        ai_config,
    ) -> None:
        if result.confidence < ai_config.confidence_threshold:
            return
        exceeds_risk_threshold = result.non_work_likelihood >= ai_config.risk_threshold
        if not exceeds_risk_threshold and result.risk_level != "high":
            return

        severity = "high" if result.non_work_likelihood >= 0.9 or result.risk_level == "high" else "medium"
        reason = f"AI assistive analysis flagged possible non-work activity: {result.summary}"
        details = {
            "source": "ai_analysis",
            "screen_index": screenshot.screen_index,
            "change_level": diff.change_level,
            "summary": result.summary,
            "task_label": result.task_label,
            "risk_level": result.risk_level,
            "non_work_likelihood": result.non_work_likelihood,
            "confidence": result.confidence,
            "recommended_follow_up": result.recommended_follow_up,
            "provider": result.provider,
            "model": result.model,
        }
        existing = self.session.exec(
            select(BehaviorEvent)
            .where(BehaviorEvent.related_screenshot_id == screenshot.id)
            .where(BehaviorEvent.event_type == "ai_suspected_non_work_activity")
        ).first()
        if existing is None:
            existing = BehaviorEvent(
                employee_id=screenshot.employee_id,
                device_id=screenshot.device_id,
                event_type="ai_suspected_non_work_activity",
                severity=severity,
                start_at=screenshot.captured_at,
                related_screenshot_id=screenshot.id,
                related_diff_id=diff.id,
                status="open",
                reason=reason,
                details_json=details,
            )
        else:
            existing.severity = severity
            existing.reason = reason
            existing.details_json = details
            existing.related_diff_id = diff.id
            existing.updated_at = utc_now()
        self.session.add(existing)
        self.session.commit()

    def _persist_ai_updates(self, screenshot: Screenshot) -> None:
        screenshot.updated_at = utc_now()
        self.session.add(screenshot)
        self.session.commit()
        self.session.refresh(screenshot)

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
