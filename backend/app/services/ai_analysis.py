from __future__ import annotations

import base64
import json
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any
from urllib import error, request

from sqlmodel import Session, select

from app.core.config import Settings
from app.models import Policy
from app.schemas.admin import AIScreenshotAnalysisSettings, AIScreenshotAnalysisSettingsUpdateRequest
from app.services.audit import AuditContext, AuditService

logger = logging.getLogger(__name__)

AI_ANALYSIS_RULE_KEY = "ai_analysis"
ROLE_TARGET_KEYS = {"roles", "job_roles", "positions", "target_roles", "target_positions"}
DEPARTMENT_TARGET_KEYS = {"departments", "target_departments"}


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


@dataclass(frozen=True)
class AIAnalysisResult:
    summary: str
    task_label: str
    risk_level: str
    non_work_likelihood: float
    confidence: float
    evidence: list[str]
    recommended_follow_up: str
    provider: str = "openai_compatible"
    model: str | None = None
    response_id: str | None = None

    def to_payload(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "status": "completed",
            "summary": self.summary,
            "task_label": self.task_label,
            "risk_level": self.risk_level,
            "non_work_likelihood": self.non_work_likelihood,
            "confidence": self.confidence,
            "evidence": self.evidence,
            "recommended_follow_up": self.recommended_follow_up,
            "provider": self.provider,
        }
        if self.model:
            payload["model"] = self.model
        if self.response_id:
            payload["response_id"] = self.response_id
        return payload


@dataclass(frozen=True)
class ResolvedAIAnalysisConfig:
    enabled: bool
    provider: str
    base_url: str | None
    model: str | None
    api_key: str | None
    timeout_seconds: float
    max_completion_tokens: int
    image_detail: str
    organization: str | None
    project: str | None
    use_previous_screenshot: bool
    confidence_threshold: float
    risk_threshold: float


FIELD_ALIASES = {
    "summary": ("ai_summary",),
    "task_label": ("ai_activity_label", "ai_task_label"),
    "risk_level": ("ai_risk_level",),
    "non_work_likelihood": ("ai_non_work_likelihood",),
    "confidence": ("ai_confidence",),
    "details": ("ai_details_json", "ai_evidence_json"),
    "recommended_follow_up": ("ai_recommended_action", "ai_recommended_follow_up"),
    "provider": ("ai_provider",),
    "model": ("ai_model",),
    "response_id": ("ai_response_id",),
}


def apply_ai_analysis_result(target: Any, result: AIAnalysisResult) -> list[str]:
    applied: list[str] = []
    values = {
        "summary": result.summary,
        "task_label": result.task_label,
        "risk_level": result.risk_level,
        "non_work_likelihood": result.non_work_likelihood,
        "confidence": result.confidence,
        "details": result.to_payload(),
        "recommended_follow_up": result.recommended_follow_up,
        "provider": result.provider,
        "model": result.model,
        "response_id": result.response_id,
    }
    for key, aliases in FIELD_ALIASES.items():
        value = values[key]
        if value is None:
            continue
        for field_name in aliases:
            if hasattr(target, field_name):
                setattr(target, field_name, value)
                applied.append(field_name)
                break
    return applied


class AIAnalysisService:
    def __init__(self, settings: Settings, session: Session | None = None):
        self.settings = settings
        self.session = session

    @property
    def is_enabled(self) -> bool:
        return self._resolved_config().enabled

    @property
    def is_configured(self) -> bool:
        config = self._resolved_config()
        return bool(config.base_url and config.api_key and config.model)

    @property
    def use_previous_screenshot(self) -> bool:
        return self._resolved_config().use_previous_screenshot

    @property
    def confidence_threshold(self) -> float:
        return self._resolved_config().confidence_threshold

    @property
    def risk_threshold(self) -> float:
        return self._resolved_config().risk_threshold

    def resolve_config(self, rules_json: dict[str, Any] | None = None) -> ResolvedAIAnalysisConfig:
        return self._resolved_config(rules_json)

    def get_settings(self) -> AIScreenshotAnalysisSettings:
        settings_map = self._policy_settings()
        config = self._resolved_config()
        api_key = settings_map.get("api_key") if isinstance(settings_map.get("api_key"), str) else None
        if not api_key:
            api_key = self.settings.ai_analysis_api_key or self.settings.ai_analysis_default_api_key
        return AIScreenshotAnalysisSettings(
            enabled=config.enabled,
            provider=config.provider,
            model=config.model,
            base_url=config.base_url,
            timeout_seconds=int(config.timeout_seconds),
            use_previous_screenshot=config.use_previous_screenshot,
            confidence_threshold=config.confidence_threshold,
            risk_threshold=config.risk_threshold,
            has_api_key=bool(api_key),
            api_key_masked=self._mask_secret(api_key) if api_key else None,
        )

    def update_settings(
        self,
        payload: AIScreenshotAnalysisSettingsUpdateRequest,
        *,
        audit_context: AuditContext | None = None,
    ) -> AIScreenshotAnalysisSettings:
        if self.session is None:
            raise ValueError("Session is required to update AI analysis settings")

        policy = self._ensure_default_policy()
        settings_map = self._policy_settings(policy.rules_json)
        provided_fields = payload.model_fields_set

        for field_name in (
            "enabled",
            "provider",
            "model",
            "base_url",
            "timeout_seconds",
            "use_previous_screenshot",
            "confidence_threshold",
            "risk_threshold",
        ):
            if field_name not in provided_fields:
                continue
            value = getattr(payload, field_name)
            if value is None:
                settings_map.pop(field_name, None)
                continue
            settings_map[field_name] = value

        if payload.clear_api_key:
            settings_map.pop("api_key", None)
        elif "api_key" in provided_fields and payload.api_key is not None:
            settings_map["api_key"] = payload.api_key

        rules_json = dict(policy.rules_json or {})
        rules_json[AI_ANALYSIS_RULE_KEY] = settings_map
        policy.rules_json = rules_json
        policy.updated_at = utc_now()
        self.session.add(policy)
        AuditService(self.session).log(
            action="ai_analysis.settings.updated",
            target_type="policy",
            target_id=policy.id,
            reason=f"Updated AI screenshot analysis settings on {policy.name} v{policy.version}",
            context=audit_context,
        )
        self.session.commit()
        self.session.refresh(policy)
        return self.get_settings()

    def analyze(
        self,
        *,
        current_image_bytes: bytes,
        previous_image_bytes: bytes | None,
        safe_metadata: dict[str, Any],
        rules_json: dict[str, Any] | None = None,
    ) -> AIAnalysisResult:
        config = self._resolved_config(rules_json)
        payload = self._build_request_payload(
            config=config,
            current_image_bytes=current_image_bytes,
            previous_image_bytes=previous_image_bytes if config.use_previous_screenshot else None,
            safe_metadata=safe_metadata,
        )
        response_json, response_headers = self._post_json(config=config, payload=payload)
        return self._parse_result(response_json, response_headers, config=config)

    def _ensure_default_policy(self) -> Policy:
        if self.session is None:
            raise ValueError("Session is required for policy-backed AI analysis settings")
        from app.services.policies import PolicyService

        return PolicyService(self.session, self.settings).ensure_default_policy()

    def _policy_settings(self, rules_json: dict[str, Any] | None = None) -> dict[str, Any]:
        if rules_json is None and self.session is not None:
            policy = self._ensure_default_policy()
            rules_json = policy.rules_json
        ai_settings = (rules_json or {}).get(AI_ANALYSIS_RULE_KEY)
        if not isinstance(ai_settings, dict):
            return {}

        normalized: dict[str, Any] = {}
        for field_name in ("enabled", "use_previous_screenshot"):
            value = ai_settings.get(field_name)
            if isinstance(value, bool):
                normalized[field_name] = value

        timeout_seconds = ai_settings.get("timeout_seconds")
        if isinstance(timeout_seconds, int) and timeout_seconds >= 1:
            normalized["timeout_seconds"] = timeout_seconds

        for field_name in ("confidence_threshold", "risk_threshold"):
            value = ai_settings.get(field_name)
            if isinstance(value, (int, float)):
                normalized[field_name] = float(value)

        for field_name in ("provider", "model", "base_url", "api_key"):
            value = ai_settings.get(field_name)
            if value is None:
                continue
            cleaned = str(value).strip()
            if cleaned:
                normalized[field_name] = cleaned

        return normalized

    def _resolved_config(self, rules_json: dict[str, Any] | None = None) -> ResolvedAIAnalysisConfig:
        settings_map = self._policy_settings(rules_json)
        enabled = bool(settings_map.get("enabled", self.settings.ai_analysis_enabled or self.settings.ai_analysis_default_enabled))
        provider = str(settings_map.get("provider") or self.settings.ai_analysis_default_provider)
        base_url = str(settings_map.get("base_url") or self.settings.ai_analysis_base_url or self.settings.ai_analysis_default_base_url)
        model = str(settings_map.get("model") or self.settings.ai_analysis_model or self.settings.ai_analysis_default_model)
        api_key = str(settings_map.get("api_key") or self.settings.ai_analysis_api_key or self.settings.ai_analysis_default_api_key or "").strip() or None
        timeout_seconds = float(settings_map.get("timeout_seconds") or self.settings.ai_analysis_timeout_seconds or self.settings.ai_analysis_default_timeout_seconds)
        use_previous_screenshot = bool(settings_map.get("use_previous_screenshot", self.settings.ai_analysis_default_use_previous_screenshot))
        confidence_threshold = float(settings_map.get("confidence_threshold", self.settings.ai_analysis_default_confidence_threshold))
        risk_threshold = float(settings_map.get("risk_threshold", self.settings.ai_analysis_default_risk_threshold))

        return ResolvedAIAnalysisConfig(
            enabled=enabled,
            provider=provider,
            base_url=base_url,
            model=model,
            api_key=api_key,
            timeout_seconds=timeout_seconds,
            max_completion_tokens=self.settings.ai_analysis_max_completion_tokens,
            image_detail=self.settings.ai_analysis_image_detail,
            organization=self.settings.ai_analysis_organization,
            project=self.settings.ai_analysis_project,
            use_previous_screenshot=use_previous_screenshot,
            confidence_threshold=confidence_threshold,
            risk_threshold=risk_threshold,
        )

    def _build_request_payload(
        self,
        *,
        config: ResolvedAIAnalysisConfig,
        current_image_bytes: bytes,
        previous_image_bytes: bytes | None,
        safe_metadata: dict[str, Any],
    ) -> dict[str, Any]:
        content: list[dict[str, Any]] = [
            {
                "type": "text",
                "text": (
                    "Analyze the current workstation screenshot and the previous screenshot when provided. "
                    "Use only coarse, assistive workplace interpretation. Do not reproduce raw visible text, "
                    "file paths, secrets, usernames, or personal data. Respond with JSON only using this shape: "
                    '{"summary":"string","task_label":"short_snake_case","risk_level":"low|medium|high",'
                    '"non_work_likelihood":0.0,"confidence":0.0,"evidence":["string"],'
                    '"recommended_follow_up":"string"}. Keep summary under 240 characters, keep evidence items '
                    "short, and use sanitized high-level observations only."
                ),
            },
            {
                "type": "text",
                "text": f"Safe metadata: {json.dumps(safe_metadata, separators=(',', ':'), ensure_ascii=True)}",
            },
            {"type": "text", "text": "Current screenshot follows."},
            self._image_part(current_image_bytes, config.image_detail),
        ]
        if previous_image_bytes is not None:
            content.extend(
                [
                    {"type": "text", "text": "Previous screenshot follows for comparison."},
                    self._image_part(previous_image_bytes, config.image_detail),
                ]
            )

        return {
            "model": config.model,
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "You produce structured assistive analysis for employee workstation monitoring. "
                        "Be conservative, privacy-preserving, and explicit about uncertainty."
                    ),
                },
                {
                    "role": "user",
                    "content": content,
                },
            ],
            "temperature": 0,
            "max_tokens": config.max_completion_tokens,
        }

    def _image_part(self, image_bytes: bytes, detail: str) -> dict[str, Any]:
        return {
            "type": "image_url",
            "image_url": {
                "url": self._to_data_url(image_bytes),
                "detail": detail,
            },
        }

    def _to_data_url(self, image_bytes: bytes) -> str:
        mime_type = _detect_image_mime_type(image_bytes)
        encoded = base64.b64encode(image_bytes).decode("ascii")
        return f"data:{mime_type};base64,{encoded}"

    def _post_json(
        self,
        *,
        config: ResolvedAIAnalysisConfig,
        payload: dict[str, Any],
    ) -> tuple[dict[str, Any], dict[str, str]]:
        endpoint = self._completion_endpoint(config.base_url)
        body = json.dumps(payload).encode("utf-8")
        headers = {
            "Authorization": f"Bearer {config.api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }
        if config.organization:
            headers["OpenAI-Organization"] = config.organization
        if config.project:
            headers["OpenAI-Project"] = config.project

        http_request = request.Request(endpoint, data=body, headers=headers, method="POST")
        try:
            with request.urlopen(http_request, timeout=config.timeout_seconds) as response:
                raw_body = response.read().decode("utf-8")
                response_json = json.loads(raw_body)
                response_headers = {key.lower(): value for key, value in response.headers.items()}
        except error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(
                f"AI analysis endpoint returned HTTP {exc.code}: {detail[:400]}"
            ) from exc
        except error.URLError as exc:
            raise RuntimeError(f"AI analysis endpoint request failed: {exc.reason}") from exc
        except TimeoutError as exc:
            raise RuntimeError("AI analysis endpoint request timed out") from exc
        except json.JSONDecodeError as exc:
            raise RuntimeError("AI analysis endpoint returned invalid JSON") from exc

        return response_json, response_headers

    def _completion_endpoint(self, base_url: str | None) -> str:
        normalized_base_url = (base_url or "").strip().rstrip("/")
        if normalized_base_url.endswith("/chat/completions"):
            return normalized_base_url
        return f"{normalized_base_url}/chat/completions"

    def _parse_result(
        self,
        response_json: dict[str, Any],
        response_headers: dict[str, str],
        *,
        config: ResolvedAIAnalysisConfig,
    ) -> AIAnalysisResult:
        choices = response_json.get("choices")
        if not isinstance(choices, list) or not choices:
            raise RuntimeError("AI analysis response did not include choices")

        message = choices[0].get("message") or {}
        content = self._message_text(message.get("content"))
        parsed = _extract_json_object(content)

        evidence = parsed.get("evidence")
        if not isinstance(evidence, list):
            evidence = []

        risk_level = str(parsed.get("risk_level") or "medium").strip().casefold()
        if risk_level not in {"low", "medium", "high"}:
            risk_level = "medium"

        return AIAnalysisResult(
            summary=_clean_text(parsed.get("summary"), fallback="AI analysis was inconclusive."),
            task_label=_clean_text(parsed.get("task_label"), fallback="unknown_task").replace(" ", "_"),
            risk_level=risk_level,
            non_work_likelihood=_bounded_float(parsed.get("non_work_likelihood"), fallback=0.5),
            confidence=_bounded_float(parsed.get("confidence"), fallback=0.4),
            evidence=[
                _clean_text(item, fallback="")
                for item in evidence
                if _clean_text(item, fallback="")
            ][:5],
            recommended_follow_up=_clean_text(
                parsed.get("recommended_follow_up"),
                fallback="Use this result as assistive context only and review alongside metadata signals.",
            ),
            provider=config.provider,
            model=response_json.get("model") or config.model,
            response_id=_clean_text(
                response_json.get("id") or response_headers.get("x-request-id"),
                fallback="",
            )
            or None,
        )

    def _message_text(self, content: Any) -> str:
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            parts: list[str] = []
            for item in content:
                if isinstance(item, dict) and item.get("type") == "text":
                    text = item.get("text")
                    if isinstance(text, str):
                        parts.append(text)
            return "\n".join(parts)
        raise RuntimeError("AI analysis response did not include text content")

    def _mask_secret(self, secret: str) -> str:
        stripped = secret.strip()
        if len(stripped) <= 8:
            return "*" * len(stripped)
        return f"{stripped[:4]}...{stripped[-4:]}"


def _detect_image_mime_type(image_bytes: bytes) -> str:
    if image_bytes.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if image_bytes.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if image_bytes.startswith(b"GIF87a") or image_bytes.startswith(b"GIF89a"):
        return "image/gif"
    if image_bytes.startswith(b"RIFF") and image_bytes[8:12] == b"WEBP":
        return "image/webp"
    return "application/octet-stream"


def _clean_text(value: Any, *, fallback: str) -> str:
    if not isinstance(value, str):
        return fallback
    normalized = " ".join(value.split())
    return normalized[:240] if normalized else fallback


def _bounded_float(value: Any, *, fallback: float) -> float:
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return fallback
    return round(min(1.0, max(0.0, numeric)), 3)


def _extract_json_object(content: str) -> dict[str, Any]:
    decoder = json.JSONDecoder()
    for index, character in enumerate(content):
        if character != "{":
            continue
        try:
            parsed, _ = decoder.raw_decode(content[index:])
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict):
            return parsed
    raise RuntimeError("AI analysis response did not contain a JSON object")
