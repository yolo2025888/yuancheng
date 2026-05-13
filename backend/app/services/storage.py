from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from io import BytesIO
from pathlib import Path
from uuid import UUID

from app.core.config import Settings

try:
    from PIL import Image
except ImportError:  # pragma: no cover - exercised via fallback behavior
    Image = None


@dataclass(frozen=True)
class StoredScreenshot:
    image_uri: str
    thumb_uri: str


@dataclass(frozen=True)
class StoredUriDeleteResult:
    handled: bool
    deleted: bool = False
    missing: bool = False
    path: Path | None = None
    error: str | None = None


class LocalScreenshotStorage:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.backend_root = Path(__file__).resolve().parents[2]
        self.storage_root = Path(settings.storage_root_dir)
        if not self.storage_root.is_absolute():
            self.storage_root = self.backend_root / self.storage_root
        self.screenshots_root = self.storage_root / "screenshots"

    def save(
        self,
        *,
        screenshot_id: UUID,
        employee_id: UUID,
        device_id: UUID,
        captured_at: datetime,
        filename: str | None,
        content_type: str | None,
        image_bytes: bytes,
    ) -> StoredScreenshot:
        if not image_bytes:
            raise ValueError("Screenshot image is empty")
        if content_type is not None and not content_type.startswith("image/"):
            raise ValueError("Unsupported screenshot content type")

        extension = self._resolve_extension(filename=filename, content_type=content_type)
        dated_dir = (
            self.screenshots_root
            / str(employee_id)
            / str(device_id)
            / f"{captured_at.year:04d}"
            / f"{captured_at.month:02d}"
            / f"{captured_at.day:02d}"
        )
        dated_dir.mkdir(parents=True, exist_ok=True)

        image_path = dated_dir / f"{screenshot_id}{extension}"
        thumb_path = dated_dir / f"{screenshot_id}_thumb{extension}"

        image_path.write_bytes(image_bytes)
        thumb_path.write_bytes(self._build_thumbnail_bytes(image_bytes=image_bytes, extension=extension))

        return StoredScreenshot(
            image_uri=image_path.relative_to(self.storage_root.parent).as_posix(),
            thumb_uri=thumb_path.relative_to(self.storage_root.parent).as_posix(),
        )

    def resolve_stored_uri(self, uri: str | None) -> Path | None:
        if not uri:
            return None

        relative_path = Path(uri.lstrip("/"))
        candidate = (self.storage_root.parent / relative_path).resolve()
        storage_root = self.storage_root.resolve()
        try:
            candidate.relative_to(storage_root)
        except ValueError:
            return None

        if not candidate.is_file():
            return None

        return candidate

    def delete(self, uri: str | None) -> StoredUriDeleteResult:
        if not uri:
            return StoredUriDeleteResult(handled=False)

        path = self.resolve_stored_uri(uri)
        if path is None:
            return StoredUriDeleteResult(handled=True, missing=True)

        try:
            path.unlink()
        except OSError as exc:
            return StoredUriDeleteResult(handled=False, error=f"{type(exc).__name__}: {exc}")

        return StoredUriDeleteResult(handled=True, deleted=True, path=path)

    def _resolve_extension(self, *, filename: str | None, content_type: str | None) -> str:
        file_extension = Path(filename or "").suffix.lower()
        if file_extension in {".png", ".jpg", ".jpeg", ".webp", ".bmp"}:
            return file_extension

        if content_type == "image/png":
            return ".png"
        if content_type == "image/webp":
            return ".webp"
        if content_type == "image/bmp":
            return ".bmp"
        return ".jpg"

    def _build_thumbnail_bytes(self, *, image_bytes: bytes, extension: str) -> bytes:
        if Image is None:
            return image_bytes

        with Image.open(BytesIO(image_bytes)) as image:
            thumbnail = image.copy()
            thumbnail.thumbnail(
                (self.settings.screenshot_thumbnail_max_size, self.settings.screenshot_thumbnail_max_size)
            )

            image_format = image.format or self._format_from_extension(extension)
            if image_format.upper() == "JPEG" and thumbnail.mode not in {"RGB", "L"}:
                thumbnail = thumbnail.convert("RGB")

            output = BytesIO()
            save_kwargs: dict[str, object] = {"format": image_format}
            if image_format.upper() in {"JPEG", "WEBP"}:
                save_kwargs["quality"] = 85
            thumbnail.save(output, **save_kwargs)
            return output.getvalue()

    def _format_from_extension(self, extension: str) -> str:
        if extension in {".jpg", ".jpeg"}:
            return "JPEG"
        if extension == ".png":
            return "PNG"
        if extension == ".webp":
            return "WEBP"
        if extension == ".bmp":
            return "BMP"
        return "JPEG"
