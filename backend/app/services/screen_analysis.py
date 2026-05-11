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

        activity = classify_screenshot_activity(
            screenshot=screenshot,
            change_level=metrics.change_level,
            is_effective_change=metrics.is_effective_change,
        )
        screenshot.ocr_status = "skipped" if screenshot.ocr_status == "pending" else screenshot.ocr_status
        screenshot.analysis_status = "completed"
        screenshot.activity_type = activity.activity_type
        screenshot.active_app = activity.active_app
        screenshot.activity_confidence = activity.confidence
        screenshot.activity_summary = activity.summary
        screenshot.activity_evidence_json = activity.evidence
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
